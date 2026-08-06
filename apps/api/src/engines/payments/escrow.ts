import { createHash } from 'node:crypto';
import type pg from 'pg';
import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import { badRequest, conflict } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import { chainRpcUrl, findAgentWallet } from './agent-wallets.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import {
  ESCROW_COMPLETE_SIGNATURE,
  ESCROW_CREATE_JOB_SIGNATURE,
  ESCROW_FUND_SIGNATURE,
  ESCROW_REJECT_SIGNATURE,
  ESCROW_SET_BUDGET_SIGNATURE,
  ESCROW_SUBMIT_SIGNATURE,
  escrowAddressFor,
  escrowTokenAddressFor,
  parseJobCreated,
  type EscrowReceiptLog,
} from './escrow-contract.js';
import { formatUsdc, parseUsdcMicros } from './permit2.js';
import { onEscrowCompleted, reputationRegistryFromProvider } from './reputation-hook.js';
import type { PaymentChain, PaymentMode } from './types.js';

// ---------------------------------------------------------------------------
// This engine mirrors permit2.ts deliberately: exported functions taking
// (pool, provider, input), one DB transaction each, `SELECT ... FOR UPDATE`
// to serialise, and every on-chain call injected through the provider so
// tests can fake it.
//
// The ESCROW_JOBS ROW IS A MIRROR. The chain is authoritative; where the two
// disagree the chain wins and the row is corrected, never the reverse.
//
// NOTE on `executePermit2Transaction`: despite the name it is a general
// contract-execution primitive -- abiFunctionSignature, abiParameters and
// contractAddress are all caller-supplied. Renaming it now that escrow is a
// second caller is deliberately out of scope for this piece.
// ---------------------------------------------------------------------------

/**
 * Escrow costs five-plus state-changing transactions per job (create, set
 * budget, approve, fund, submit, complete). Below a cent the orchestration
 * cost dominates the payment itself, so escrow is the wrong instrument --
 * refuse rather than quietly burn more gas than the job is worth.
 */
export const ESCROW_MINIMUM_BUDGET_MICROS = 10_000n;

// The zero address: no ERC-8183 hook. createJob reverts unless the hook is
// whitelisted, and address(0) is the only one piece 1's deployment allows.
const NO_HOOK = '0x0000000000000000000000000000000000000000';

// ERC-8004 provider agent id. This platform runs no ERC-8004 registry, so
// there is no honest id to supply and 0 means "unregistered" on-chain.
const NO_PROVIDER_AGENT_ID = '0';

// No hook parameters. Every ERC-8183 call that takes `optParams` forwards it
// to the job's hook, and jobs here are created with no hook at all.
const NO_HOOK_PARAMS = '0x';

// The zero bytes32. submit() carries a `deliverable` and complete()/reject()
// a `reason`; the contract only emits either one, nothing on-chain resolves
// them, and this platform runs no registry that could -- so zero means "none
// given", the same reasoning as NO_PROVIDER_AGENT_ID.
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

const RECEIPT_MAX_ATTEMPTS = 6;
const RECEIPT_RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Reads a transaction receipt's logs. Injected so tests can supply a fixture. */
export type ReadReceiptLogs = (txHash: string, chain: PaymentChain) => Promise<readonly EscrowReceiptLog[]>;

/**
 * The default receipt reader: a plain eth_getTransactionReceipt.
 *
 * The treasury provider hands back only a tx hash, but createJob's id lives
 * in the JobCreated event -- so the receipt has to be fetched separately.
 * Retried with backoff for the same reason nativeBalanceMicros is: Arc's
 * public RPC was measured failing ~56% of identical calls (spike S6), and a
 * receipt that is merely late must not be read as "no job id".
 */
export const readReceiptLogsViaRpc: ReadReceiptLogs = async (txHash, chain) => {
  const rpcUrl = chainRpcUrl(chain);
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    throw new Error(`escrow_receipt_rpc_not_configured:${chain}`);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= RECEIPT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }),
      });
      const body = await response.json() as {
        readonly result?: { readonly logs?: readonly EscrowReceiptLog[] } | null;
        readonly error?: { readonly message?: string };
      };
      if (body.error !== undefined) throw new Error(body.error.message ?? 'eth_getTransactionReceipt_rpc_error');
      // null means "not mined yet" rather than "no logs" -- retry, never
      // collapse it into an empty log list.
      if (body.result === undefined || body.result === null) throw new Error('escrow_receipt_not_available');
      return body.result.logs ?? [];
    } catch (error) {
      lastError = error;
      if (attempt < RECEIPT_MAX_ATTEMPTS) await sleep(RECEIPT_RETRY_DELAY_MS);
    }
  }
  throw new Error(`escrow_receipt_unavailable:${lastError instanceof Error ? lastError.message : 'unknown'}`);
};

export type EscrowState = 'open' | 'funded' | 'submitted' | 'completed' | 'rejected' | 'expired';

/** Raw `escrow_jobs` row. Column names match the migration exactly. */
export type EscrowJobRow = {
  readonly id: string;
  readonly org_id: string;
  readonly client_agent_id: string;
  readonly provider_address: string;
  readonly evaluator_address: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly escrow_address: string;
  readonly token_address: string;
  readonly onchain_job_id: string | null;
  readonly budget_usdc: string;
  readonly reservation_id: string | null;
  readonly state: EscrowState;
  // 2 means evaluator == client: self-evaluated, NOT neutral arbitration.
  readonly escrow_mode: number;
  readonly deliverable_hash: string | null;
  readonly expires_at: Date;
  readonly create_tx_hash: string | null;
  readonly fund_tx_hash: string | null;
  readonly submit_tx_hash: string | null;
  readonly terminal_tx_hash: string | null;
  readonly created_by: string;
};

/** The caller-facing view of an escrow job. */
export type EscrowJob = {
  readonly id: string;
  readonly orgId: string;
  readonly clientAgentId: string;
  readonly providerAddress: string;
  readonly evaluatorAddress: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly escrowAddress: string;
  readonly tokenAddress: string;
  readonly onchainJobId: string | null;
  readonly budgetUsdc: string;
  readonly reservationId: string | null;
  readonly state: EscrowState;
  // 2 when the client evaluates its own job. Callers MUST NOT present a
  // mode-2 job as neutrally arbitrated -- there is no third party.
  readonly escrowMode: number;
  readonly deliverableHash: string | null;
  readonly expiresAt: Date;
  readonly createTxHash: string | null;
  readonly fundTxHash: string | null;
  readonly submitTxHash: string | null;
  readonly terminalTxHash: string | null;
};

function escrowJobFromRow(row: EscrowJobRow): EscrowJob {
  return {
    id: row.id,
    orgId: row.org_id,
    clientAgentId: row.client_agent_id,
    providerAddress: row.provider_address,
    evaluatorAddress: row.evaluator_address,
    mode: row.mode,
    chain: row.chain,
    escrowAddress: row.escrow_address,
    tokenAddress: row.token_address,
    onchainJobId: row.onchain_job_id,
    budgetUsdc: row.budget_usdc,
    reservationId: row.reservation_id,
    state: row.state,
    escrowMode: row.escrow_mode,
    deliverableHash: row.deliverable_hash,
    expiresAt: row.expires_at,
    createTxHash: row.create_tx_hash,
    fundTxHash: row.fund_tx_hash,
    submitTxHash: row.submit_tx_hash,
    terminalTxHash: row.terminal_tx_hash,
  };
}

/**
 * The budget in base units, refusing anything escrow cannot pay for.
 *
 * Runs before any on-chain call: a job refused after createJob would have
 * left a real, unfundable job on the chain.
 */
function escrowBudgetMicros(budgetUsdc: string): bigint {
  const micros = parseUsdcMicros(budgetUsdc);
  if (micros < ESCROW_MINIMUM_BUDGET_MICROS) {
    throw badRequest(
      'escrow_uneconomic_for_amount',
      'escrow_uneconomic_for_amount: escrow needs a budget of at least 0.01 USDC. Below that the five-plus '
      + 'state-changing transactions a job costs dominate the payment itself.',
    );
  }
  return micros;
}

/** The agent's own wallet address on this chain. Throws rather than guessing. */
async function clientWalletAddress(
  db: pg.PoolClient,
  agentId: string,
  mode: PaymentMode,
  chain: PaymentChain,
): Promise<string> {
  const wallet = await findAgentWallet(db, agentId, mode, chain);
  if (wallet === null) throw new Error(`escrow_client_wallet_not_found:${agentId}`);
  return wallet.address;
}

export type CreateEscrowJobInput = {
  readonly orgId: string;
  // The agent paying. Its own wallet is the on-chain `client`: ERC-8183 lets
  // only job.client fund the job, so this address has to be one we can send
  // from later.
  readonly clientAgentId: string;
  readonly providerAddress: string;
  // Omitted means the CLIENT evaluates its own job -- escrow mode 2. A
  // distinct address is mode 3, and only mode 3 is neutral arbitration.
  readonly evaluatorAddress?: string | undefined;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly budgetUsdc: string;
  readonly expiresAt: Date;
  readonly createdBy: string;
  // Free-form on-chain job description. Stored by the contract only; nothing
  // in this engine reads it back.
  readonly description?: string | undefined;
  readonly readReceiptLogs?: ReadReceiptLogs | undefined;
};

/**
 * Creates an ERC-8183 job on-chain and records the mirror row in state
 * `open`.
 *
 * createJob returns the job id on-chain but the provider hands back only a
 * tx hash, so the id is recovered from the JobCreated event in the receipt.
 * That id is the key every later call uses; a row without it is unusable, so
 * a receipt that does not carry one fails the whole call rather than
 * persisting a row that can never be reconciled.
 */
export async function createEscrowJob(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: CreateEscrowJobInput,
): Promise<EscrowJob> {
  // Both of these run before anything is sent: an uneconomic budget or an
  // undeployed chain must never reach the chain at all.
  const budgetMicros = escrowBudgetMicros(input.budgetUsdc);
  const escrowAddress = escrowAddressFor(input.chain);
  const tokenAddress = escrowTokenAddressFor(input.chain);
  const readReceiptLogs = input.readReceiptLogs ?? readReceiptLogsViaRpc;

  return withTransaction(pool, async (client) => {
    const clientAddress = await clientWalletAddress(client, input.clientAgentId, input.mode, input.chain);
    // No evaluator named means the client evaluates its own work. That is
    // escrow mode 2 and it is NOT neutral arbitration -- recorded on the row
    // so nothing downstream has to remember which kind this was.
    const evaluatorAddress = input.evaluatorAddress ?? clientAddress;
    const escrowMode = evaluatorAddress.toLowerCase() === clientAddress.toLowerCase() ? 2 : 3;
    const expiredAtSeconds = Math.floor(input.expiresAt.getTime() / 1000);

    // Sent from the client's own wallet: ERC-8183 takes msg.sender as
    // job.client, and only job.client may fund the job afterwards.
    const created = await provider.executePermit2Transaction({
      mode: input.mode,
      chain: input.chain,
      senderAddress: clientAddress,
      abiFunctionSignature: ESCROW_CREATE_JOB_SIGNATURE,
      abiParameters: [
        input.providerAddress,
        evaluatorAddress,
        expiredAtSeconds.toString(),
        input.description ?? '',
        NO_HOOK,
        NO_PROVIDER_AGENT_ID,
      ],
      contractAddress: escrowAddress,
      // Kept short -- Circle rejects long refIds with an opaque "API
      // parameter invalid" (see permit2.ts's note).
      refId: `agentops-escrow-create-${crypto.randomUUID()}`,
    });

    const logs = await readReceiptLogs(created.txHash, input.chain);
    const onchainJobId = parseJobCreated(logs, escrowAddress);
    if (onchainJobId === undefined) {
      // The job may well exist on-chain; we simply cannot prove which one it
      // is. Rolling back beats recording a row bound to a guess.
      throw new Error(`escrow_job_id_not_in_receipt:${created.txHash}`);
    }

    const inserted = await client.query<EscrowJobRow>(
      `INSERT INTO escrow_jobs (
         id, org_id, client_agent_id, provider_address, evaluator_address, mode, chain,
         escrow_address, token_address, onchain_job_id, budget_usdc, state, escrow_mode,
         expires_at, create_tx_hash, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11::numeric, 'open', $12, $13, $14, $15)
       RETURNING *`,
      [
        prefixedId('escrowjob'), input.orgId, input.clientAgentId, input.providerAddress, evaluatorAddress,
        input.mode, input.chain, escrowAddress, tokenAddress, onchainJobId.toString(),
        formatUsdc(budgetMicros), escrowMode, input.expiresAt, created.txHash, input.createdBy,
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error('escrow_job_insert_failed');
    return escrowJobFromRow(row);
  });
}

/**
 * The address, when it belongs to one of this org's own agents.
 *
 * ERC-8183 restricts every call to a named party -- only `job.provider` may
 * setBudget or submit, only `job.evaluator` may complete or reject -- so this
 * decides whether the platform holds the key that call needs or must leave it
 * to an outside party. Scoped by org: two orgs may legitimately transact with
 * the same address, and an unscoped lookup would let one act as the other.
 */
async function fleetWalletAddress(
  db: pg.PoolClient,
  input: {
    readonly orgId: string;
    readonly address: string;
    readonly mode: PaymentMode;
    readonly chain: PaymentChain;
  },
): Promise<string | null> {
  const result = await db.query<{ address: string }>(
    `SELECT address FROM agent_chain_wallets
      WHERE org_id = $1 AND lower(address) = lower($2) AND mode = $3 AND chain = $4 AND status = 'active'
      LIMIT 1`,
    [input.orgId, input.address, input.mode, input.chain],
  );
  return result.rows[0]?.address ?? null;
}

/**
 * Creates the `payment_reservations` row that holds this budget against the
 * org's books while the escrow does.
 *
 * Escrow deliberately drives the EXISTING reservation lifecycle rather than a
 * parallel one -- `completed` later settles it, `rejected`/`expired` release
 * it -- so escrowed money shows up in the same accounting as every other
 * payment instead of hiding in a second ledger.
 */
async function reserveEscrowBudget(
  db: pg.PoolClient,
  job: EscrowJobRow,
): Promise<string> {
  const source = await db.query<{ id: string; rail: string }>(
    `SELECT id, rail FROM payment_sources
      WHERE org_id = $1 AND chain = $2 AND status = 'active'
      ORDER BY rail ASC, created_at DESC
      LIMIT 1`,
    [job.org_id, job.chain],
  );
  const sourceRow = source.rows[0];
  if (sourceRow === undefined) throw new Error(`escrow_payment_source_not_found:${job.chain}`);

  const quote = {
    escrowJobId: job.id,
    chain: job.chain,
    escrowAddress: job.escrow_address,
    tokenAddress: job.token_address,
    onchainJobId: job.onchain_job_id,
    budgetUsdc: job.budget_usdc,
    providerAddress: job.provider_address,
    evaluatorAddress: job.evaluator_address,
    escrowMode: job.escrow_mode,
  };
  const quoteJson = JSON.stringify(quote);
  const reservationId = prefixedId('payres');

  await db.query(
    `INSERT INTO payment_reservations (
       id, org_id, agent_id, source_id, amount_usdc, rail, status,
       reason_code, quote_hash, quote, expires_at
     )
     VALUES ($1, $2, $3, $4, $5::numeric, $6, 'reserved', $7, $8, $9::jsonb, $10)`,
    [
      reservationId, job.org_id, job.client_agent_id, sourceRow.id, job.budget_usdc, sourceRow.rail,
      // Same shape as the existing 'x402_attempt:<id>' reason codes, so a
      // reservation can always be traced back to what created it.
      `escrow_job:${job.id}`,
      createHash('sha256').update(quoteJson).digest('hex'),
      quoteJson,
      // The escrow's own deadline. After it, the money is refundable and
      // holding it reserved would misstate the org's headroom.
      job.expires_at,
    ],
  );
  return reservationId;
}

export type FundEscrowJobInput = {
  readonly escrowJobId: string;
};

/**
 * Funds an open escrow job and reserves the budget against the org's books.
 *
 * THE EXACT-APPROVAL RULE. The token allowance is set to the budget and
 * nothing more -- never a margin, never max. An earlier overcharge was only
 * possible because a client approved MORE than it had been quoted, which let
 * a front-run raise the budget and take the difference. Combined with the
 * guarded fund(), which reverts on BudgetMismatch/PaymentTokenMismatch, a
 * raised budget now has no allowance to draw on and the transaction reverts
 * instead of overpaying. Both defences, not either.
 *
 * The row is locked FOR UPDATE so two concurrent funds serialise and the
 * second one sees `funded` rather than approving a second budget.
 */
export async function fundEscrowJob(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: FundEscrowJobInput,
): Promise<EscrowJob> {
  return withTransaction(pool, async (client) => {
    const locked = await client.query<EscrowJobRow>(
      'SELECT * FROM escrow_jobs WHERE id = $1 FOR UPDATE',
      [input.escrowJobId],
    );
    const job = locked.rows[0];
    if (job === undefined) throw new Error('escrow_job_not_found');
    if (job.state !== 'open') {
      // The chain would revert this with WrongStatus. Refusing here keeps us
      // from spending gas to learn what the local mirror already knows.
      throw conflict(
        'escrow_invalid_transition',
        `escrow_invalid_transition: escrow job is ${job.state}, and only an open job can be funded.`,
      );
    }
    if (job.onchain_job_id === null) {
      throw new Error(`escrow_onchain_job_id_missing:${job.id}`);
    }

    const budgetMicros = escrowBudgetMicros(job.budget_usdc);
    const clientAddress = await clientWalletAddress(client, job.client_agent_id, job.mode, job.chain);

    // ERC-8183 requires job.budget to be set before fund(), and only the
    // PROVIDER may set it. When the provider is one of our own agents we hold
    // that key and set it ourselves. When it is not, the provider sets its own
    // budget out of band -- and that is precisely the case the guarded fund()
    // below exists for: if what the provider set differs from what we quoted,
    // expectedBudget makes the transaction revert rather than overpay.
    const providerWallet = await fleetWalletAddress(client, {
      orgId: job.org_id,
      address: job.provider_address,
      mode: job.mode,
      chain: job.chain,
    });
    if (providerWallet !== null) {
      await provider.executePermit2Transaction({
        mode: job.mode,
        chain: job.chain,
        senderAddress: providerWallet,
        abiFunctionSignature: ESCROW_SET_BUDGET_SIGNATURE,
        abiParameters: [job.onchain_job_id, job.token_address, budgetMicros.toString(), NO_HOOK_PARAMS],
        contractAddress: job.escrow_address,
        // Kept short -- see permit2.ts's note on refId length.
        refId: `agentops-escrow-budget-${crypto.randomUUID()}`,
      });
    }

    // fund() pulls the budget through the token's own transferFrom, so the
    // approve MUST land first or it reverts with TRANSFER_FROM_FAILED.
    // Targets the TOKEN and names the ESCROW as spender.
    await provider.executePermit2Transaction({
      mode: job.mode,
      chain: job.chain,
      senderAddress: clientAddress,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [job.escrow_address, budgetMicros.toString()],
      contractAddress: job.token_address,
      refId: `agentops-escrow-approve-${crypto.randomUUID()}`,
    });

    // The GUARDED overload, always. expectedToken and expectedBudget are what
    // make a front-run revert instead of succeed; the stale two-argument
    // overload names neither and must never be used.
    const funded = await provider.executePermit2Transaction({
      mode: job.mode,
      chain: job.chain,
      senderAddress: clientAddress,
      abiFunctionSignature: ESCROW_FUND_SIGNATURE,
      abiParameters: [job.onchain_job_id, job.token_address, budgetMicros.toString(), NO_HOOK_PARAMS],
      contractAddress: job.escrow_address,
      refId: `agentops-escrow-fund-${crypto.randomUUID()}`,
    });

    const reservationId = await reserveEscrowBudget(client, job);

    const updated = await client.query<EscrowJobRow>(
      `UPDATE escrow_jobs
          SET state = 'funded', fund_tx_hash = $2, reservation_id = $3, updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [job.id, funded.txHash, reservationId],
    );
    const row = updated.rows[0];
    if (row === undefined) throw new Error('escrow_job_update_failed');
    return escrowJobFromRow(row);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

/**
 * The ERC-8183 lifecycle this function may drive.
 *
 * `open -> funded` is deliberately absent: funding is not a state write but an
 * approve-then-fund orchestration, and fundEscrowJob owns it. Everything not
 * listed is refused -- the chain would revert it, and a local row the chain
 * does not agree with is worse than an error.
 */
const ESCROW_TRANSITIONS: Partial<Record<EscrowState, readonly EscrowState[]>> = {
  funded: ['submitted'],
  submitted: ['completed', 'rejected', 'expired'],
};

function assertEscrowTransition(job: EscrowJobRow, next: EscrowState): void {
  if ((ESCROW_TRANSITIONS[job.state] ?? []).includes(next)) return;
  throw conflict(
    'escrow_invalid_transition',
    `escrow_invalid_transition: escrow job is ${job.state}, and ${next} is not reachable from there.`
    + (next === 'funded' ? ' Funding is an approve-then-fund orchestration -- use fundEscrowJob.' : ''),
  );
}

/**
 * Drives the `payment_reservations` row this job's budget is held against.
 *
 * Escrow keeps no ledger of its own: `completed` settles the reservation,
 * `rejected` and `expired` release it. Always called inside the SAME
 * transaction as the state write, so the books and the mirror can never
 * disagree. Guarded on 'reserved' so a second pass over the same job -- a
 * reconcile after a local transition, say -- cannot flip an already-settled
 * reservation into released.
 */
async function applyReservationOutcome(
  db: pg.PoolClient,
  job: EscrowJobRow,
  next: EscrowState,
): Promise<void> {
  if (job.reservation_id === null) return;
  if (next !== 'completed' && next !== 'rejected' && next !== 'expired') return;
  await db.query(
    `UPDATE payment_reservations
        SET status = $3, updated_at = now()
      WHERE id = $1 AND org_id = $2 AND status = 'reserved'`,
    [job.reservation_id, job.org_id, next === 'completed' ? 'settled' : 'released'],
  );
}

// ERC-8183 restricts each of these calls to one named party. `notHeldCode` is
// spelled out in full rather than built from `role`, so every error code this
// module can raise is greppable.
const ESCROW_CALLS = {
  submitted: {
    role: 'provider', verb: 'submit', signature: ESCROW_SUBMIT_SIGNATURE,
    notHeldCode: 'escrow_provider_wallet_not_held',
  },
  completed: {
    role: 'evaluator', verb: 'complete', signature: ESCROW_COMPLETE_SIGNATURE,
    notHeldCode: 'escrow_evaluator_wallet_not_held',
  },
  rejected: {
    role: 'evaluator', verb: 'reject', signature: ESCROW_REJECT_SIGNATURE,
    notHeldCode: 'escrow_evaluator_wallet_not_held',
  },
} as const;

/**
 * Sends the transition's on-chain call and returns its hash, or null when the
 * transition has no call to make.
 */
async function sendEscrowTransition(
  db: pg.PoolClient,
  provider: CircleTreasuryProvider,
  job: EscrowJobRow,
  onchainJobId: string,
  input: ApplyEscrowStateChangeInput,
): Promise<string | null> {
  if (input.next === 'expired') {
    // The chain expires a job through claimRefund, which anyone may call once
    // the evaluation grace period is up. Automating that is out of scope for
    // this piece, so expiry is RECORDED here rather than caused -- and it is
    // recorded as its own state, never folded into `rejected`.
    return null;
  }

  const call = ESCROW_CALLS[input.next as keyof typeof ESCROW_CALLS];
  // Unreachable: assertEscrowTransition has already refused every other
  // target. Kept so a new lifecycle state cannot silently send nothing.
  if (call === undefined) throw new Error(`escrow_no_call_for_state:${input.next}`);

  // Only job.provider may submit; only job.evaluator may complete or reject.
  // Scoped by org, so one org's job can never be resolved with another's key.
  const actorAddress = call.role === 'provider' ? job.provider_address : job.evaluator_address;
  const wallet = await fleetWalletAddress(db, {
    orgId: job.org_id, address: actorAddress, mode: job.mode, chain: job.chain,
  });
  if (wallet === null) {
    // An outside party makes this call itself, out of band. Recording the new
    // state anyway would claim something the chain never confirmed -- and for
    // complete/reject it would move the org's books on that claim. Reconciling
    // against the chain is the only honest way to learn what actually happened.
    throw conflict(
      call.notHeldCode,
      `${call.notHeldCode}: only ${actorAddress} may ${call.verb} this job, and this org holds no key `
      + 'for it. Reconcile against the chain instead.',
    );
  }

  const sent = await provider.executePermit2Transaction({
    mode: job.mode,
    chain: job.chain,
    senderAddress: wallet,
    abiFunctionSignature: call.signature,
    // submit()'s bytes32 is the deliverable; complete()/reject()'s is a
    // `reason` this platform has nothing honest to put in.
    abiParameters: [
      onchainJobId,
      call.role === 'provider' ? input.deliverableHash ?? ZERO_BYTES32 : ZERO_BYTES32,
      NO_HOOK_PARAMS,
    ],
    contractAddress: job.escrow_address,
    // Kept short -- see permit2.ts's note on refId length.
    refId: `agentops-escrow-${call.verb}-${crypto.randomUUID()}`,
  });
  return sent.txHash;
}

export type ApplyEscrowStateChangeInput = {
  readonly escrowJobId: string;
  readonly next: EscrowState;
  // The bytes32 a submit() carries. Opaque to this engine: recorded on the row
  // and handed to the contract, never interpreted.
  readonly deliverableHash?: string | undefined;
};

/**
 * Moves an escrow job along the ERC-8183 lifecycle and moves the money with
 * it.
 *
 * The on-chain call and the reservation outcome land in ONE database
 * transaction. A reservation settled without its complete(), or a complete()
 * whose settle was lost, is exactly the disagreement this engine exists to
 * prevent -- so either both happen or neither does.
 *
 * `expired` is recorded as its own state even though the contract refunds it
 * identically to `rejected`. "Delivered but never evaluated" is a different
 * failure from "rejected", and our evidence has to tell them apart when the
 * chain cannot.
 */
export async function applyEscrowStateChange(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: ApplyEscrowStateChangeInput,
): Promise<EscrowJob> {
  const result = await withTransaction(pool, async (client) => {
    const locked = await client.query<EscrowJobRow>(
      'SELECT * FROM escrow_jobs WHERE id = $1 FOR UPDATE',
      [input.escrowJobId],
    );
    const job = locked.rows[0];
    if (job === undefined) throw new Error('escrow_job_not_found');
    // Validated before anything is sent: an impossible transition must never
    // cost gas to discover.
    assertEscrowTransition(job, input.next);
    if (job.onchain_job_id === null) throw new Error(`escrow_onchain_job_id_missing:${job.id}`);

    const txHash = await sendEscrowTransition(client, provider, job, job.onchain_job_id, input);

    const updated = await client.query<EscrowJobRow>(
      `UPDATE escrow_jobs
          SET state = $2,
              deliverable_hash = COALESCE($4, deliverable_hash),
              submit_tx_hash = CASE WHEN $2::text = 'submitted'
                THEN COALESCE($3, submit_tx_hash) ELSE submit_tx_hash END,
              terminal_tx_hash = CASE WHEN $2::text = 'submitted'
                THEN terminal_tx_hash ELSE COALESCE($3, terminal_tx_hash) END,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [job.id, input.next, txHash, input.deliverableHash ?? null],
    );
    const row = updated.rows[0];
    if (row === undefined) throw new Error('escrow_job_update_failed');

    await applyReservationOutcome(client, job, input.next);
    return escrowJobFromRow(row);
  });

  // Fired AFTER commit, deliberately outside the transaction above: D4's
  // reputation write must never be able to roll back a settled escrow
  // completion, and onEscrowCompleted already swallows its own on-chain
  // failures -- this catch is only for something re-reading the row itself
  // going wrong (e.g. the pool being unavailable).
  if (input.next === 'completed') {
    try {
      await onEscrowCompleted(pool, { jobId: result.id }, reputationRegistryFromProvider(provider));
    } catch {
      // Operational problem, not a money problem -- the escrow completion
      // above already committed regardless.
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Evaluator liveness
// ---------------------------------------------------------------------------

/** A submitted job whose evaluation window is closing. */
export type EscrowLivenessRisk = {
  readonly escrowJobId: string;
  readonly onchainJobId: string | null;
  readonly chain: PaymentChain;
  readonly providerAddress: string;
  readonly evaluatorAddress: string;
  // 2 means the client evaluates its own job. It travels WITH the risk so no
  // caller can present a self-evaluated job as neutral arbitration -- and
  // because a mode-2 job at risk means the party that owes the money is the
  // one who has gone quiet.
  readonly escrowMode: number;
  readonly budgetUsdc: string;
  readonly expiresAt: Date;
};

export type ListEscrowLivenessRisksInput = {
  readonly orgId: string;
  readonly withinHours: number;
};

/**
 * Submitted jobs running out of time for their evaluator to answer.
 *
 * The sharpest trap in ERC-8183: once work is submitted, an evaluator who
 * simply goes silent costs the PROVIDER everything. claimRefund pays the
 * budget back to the client after expiry, and the contract cannot tell that
 * the work was delivered -- nothing on-chain distinguishes "rejected" from
 * "never looked at". Only watching the window closing can.
 *
 * Funded-but-unsubmitted jobs are deliberately not risks: nothing was
 * delivered, so a refund there costs the provider nothing.
 *
 * Shaped for `escrow_jobs_liveness_idx (state, expires_at) WHERE state =
 * 'submitted'` -- the literal state predicate and the range on expires_at are
 * what make that partial index usable rather than a full scan.
 */
export async function listEscrowLivenessRisks(
  pool: pg.Pool,
  input: ListEscrowLivenessRisksInput,
): Promise<readonly EscrowLivenessRisk[]> {
  const result = await pool.query<EscrowJobRow>(
    `SELECT * FROM escrow_jobs
      WHERE state = 'submitted'
        AND expires_at <= now() + make_interval(secs => $2)
        AND org_id = $1
      ORDER BY expires_at ASC`,
    // Seconds rather than hours so a fractional window stays exact; make_interval's
    // `hours` argument is an integer and would reject one.
    [input.orgId, input.withinHours * 3600],
  );
  return result.rows.map((row) => ({
    escrowJobId: row.id,
    onchainJobId: row.onchain_job_id,
    chain: row.chain,
    providerAddress: row.provider_address,
    evaluatorAddress: row.evaluator_address,
    escrowMode: row.escrow_mode,
    budgetUsdc: row.budget_usdc,
    expiresAt: row.expires_at,
  }));
}

export type EscrowCounterparty = {
  readonly chain: PaymentChain;
  readonly providerAddress: string;
};

export type ListEscrowCounterpartiesInput = {
  readonly orgId: string;
  readonly mode: PaymentMode;
};

/**
 * Distinct (chain, providerAddress) pairs this org has ANY escrow history
 * with. Nothing else discovers this -- the trust console needs it to know
 * which external addresses to pull `getTrustEvidence` for in the first
 * place, rather than requiring an operator to already know the address.
 */
export async function listEscrowCounterparties(
  pool: pg.Pool,
  input: ListEscrowCounterpartiesInput,
): Promise<readonly EscrowCounterparty[]> {
  const result = await pool.query<{ chain: PaymentChain; provider_address: string }>(
    `SELECT DISTINCT chain, provider_address
       FROM escrow_jobs
      WHERE org_id = $1 AND mode = $2
      ORDER BY chain, provider_address`,
    [input.orgId, input.mode],
  );
  return result.rows.map((row) => ({ chain: row.chain, providerAddress: row.provider_address }));
}

// ---------------------------------------------------------------------------
// Reconciliation against the chain
// ---------------------------------------------------------------------------

// getJob(uint256) -- selector 0xbf22c457, the same one
// ESCROW_GET_JOB_SIGNATURE names. The struct is spelled out field for field
// in its on-chain DECLARATION order, because an ABI tuple is positional: two
// fields of the same width swapped here decode silently into each other and
// nothing complains.
const escrowGetJobAbi = parseAbi([
  'function getJob(uint256 jobId) view returns ((address client, uint8 status, address provider, uint48 expiredAt, address evaluator, uint48 submittedAt, uint256 budget, address hook, address paymentToken, uint256 providerAgentId, string description, uint256 settledAmount, address payoutReceiver) job)',
]);

// ERC-8183's JobStatus enum, in its declared order. getJob returns the
// ordinal, and the enum is what our own `state` column mirrors.
const ESCROW_STATE_BY_STATUS: readonly EscrowState[] = [
  'open', 'funded', 'submitted', 'completed', 'rejected', 'expired',
];

const GET_JOB_MAX_ATTEMPTS = 6;
const GET_JOB_RETRY_DELAY_MS = 400;

/** What the chain says about a job. The authoritative version of our row. */
export type OnchainEscrowJob = {
  readonly state: EscrowState;
  readonly budgetMicros: bigint;
};

function decodeEscrowJob(callData: string): OnchainEscrowJob {
  const job = decodeFunctionResult({
    abi: escrowGetJobAbi,
    functionName: 'getJob',
    data: callData as `0x${string}`,
  });
  const state = ESCROW_STATE_BY_STATUS[job.status];
  // A status outside the enum means the deployed contract is not the one this
  // module was written against. Guessing a state from it would be worse than
  // refusing to reconcile at all.
  if (state === undefined) throw new Error(`escrow_unknown_onchain_status:${job.status}`);
  return { state, budgetMicros: job.budget };
}

/** Reads raw `getJob` return data. Injected so tests can supply a fixture. */
export type ReadJobCallData = (input: {
  readonly onchainJobId: string;
  readonly escrowAddress: string;
  readonly chain: PaymentChain;
}) => Promise<string>;

/**
 * The default job reader: a plain eth_call of getJob(uint256).
 *
 * Retried with backoff for the same reason the receipt reader is (Arc's
 * public RPC was measured failing ~56% of identical calls, spike S6). A read
 * that merely failed must never be mistaken for a job the chain disagrees
 * about -- this function throws rather than returning anything reconcilable.
 */
export const readJobCallDataViaRpc: ReadJobCallData = async ({ onchainJobId, escrowAddress, chain }) => {
  const rpcUrl = chainRpcUrl(chain);
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    throw new Error(`escrow_get_job_rpc_not_configured:${chain}`);
  }
  const data = encodeFunctionData({
    abi: escrowGetJobAbi,
    functionName: 'getJob',
    args: [BigInt(onchainJobId)],
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= GET_JOB_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [{ to: escrowAddress, data }, 'latest'],
        }),
      });
      const body = await response.json() as { readonly result?: string; readonly error?: { readonly message?: string } };
      if (body.error !== undefined) throw new Error(body.error.message ?? 'eth_call_rpc_error');
      if (body.result === undefined) throw new Error('eth_call_empty_response');
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt < GET_JOB_MAX_ATTEMPTS) await sleep(GET_JOB_RETRY_DELAY_MS);
    }
  }
  throw new Error(`escrow_get_job_unavailable:${lastError instanceof Error ? lastError.message : 'unknown'}`);
};

/** One field on which the local mirror and the chain disagreed. */
export type EscrowDrift = {
  readonly field: 'state' | 'budgetUsdc';
  readonly local: string;
  readonly onchain: string;
};

export type ReconcileEscrowJobInput = {
  readonly escrowJobId: string;
  readonly readJobCallData?: ReadJobCallData | undefined;
};

export type ReconcileEscrowJobResult = {
  readonly job: EscrowJob;
  readonly drift: readonly EscrowDrift[];
};

/**
 * Corrects one job's row from the chain, and reports what had drifted.
 *
 * The row is a MIRROR. Anything a third party does on-chain -- an outside
 * provider's setBudget, an outside evaluator's reject -- is invisible to us
 * until we look, and when the two disagree the chain is right by definition.
 * So this function only ever writes local <- chain, and returns the drift as
 * evidence rather than swallowing it.
 *
 * It sends nothing: reconciling is a read plus a local correction, never an
 * attempt to make the chain agree with us.
 *
 * The correction runs through the SAME reservation logic a local transition
 * does, so a job that reached a terminal state without us settles or releases
 * exactly as it would have had we driven it ourselves.
 */
export async function reconcileEscrowJob(
  pool: pg.Pool,
  input: ReconcileEscrowJobInput,
): Promise<ReconcileEscrowJobResult> {
  const readJobCallData = input.readJobCallData ?? readJobCallDataViaRpc;

  return withTransaction(pool, async (client) => {
    const locked = await client.query<EscrowJobRow>(
      'SELECT * FROM escrow_jobs WHERE id = $1 FOR UPDATE',
      [input.escrowJobId],
    );
    const job = locked.rows[0];
    if (job === undefined) throw new Error('escrow_job_not_found');
    if (job.onchain_job_id === null) throw new Error(`escrow_onchain_job_id_missing:${job.id}`);

    const onchain = decodeEscrowJob(await readJobCallData({
      onchainJobId: job.onchain_job_id,
      escrowAddress: job.escrow_address,
      chain: job.chain,
    }));

    const drift: EscrowDrift[] = [];
    if (onchain.state !== job.state) {
      drift.push({ field: 'state', local: job.state, onchain: onchain.state });
    }
    // A zero on-chain budget is not drift: only the provider may setBudget, so
    // until it does the chain genuinely holds 0 while our row holds what we
    // quoted. A NON-zero mismatch is the case worth surfacing -- it is a
    // budget moved behind our back, which is what the guarded fund() defends
    // against and what this report makes visible after the fact.
    const budgetDrifted = onchain.budgetMicros > 0n
      && onchain.budgetMicros !== parseUsdcMicros(job.budget_usdc);
    if (budgetDrifted) {
      drift.push({ field: 'budgetUsdc', local: job.budget_usdc, onchain: formatUsdc(onchain.budgetMicros) });
    }
    if (drift.length === 0) return { job: escrowJobFromRow(job), drift };

    const updated = await client.query<EscrowJobRow>(
      `UPDATE escrow_jobs
          SET state = $2,
              budget_usdc = COALESCE($3::numeric, budget_usdc),
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [job.id, onchain.state, budgetDrifted ? formatUsdc(onchain.budgetMicros) : null],
    );
    const row = updated.rows[0];
    if (row === undefined) throw new Error('escrow_job_update_failed');

    // Same transaction, same helper applyEscrowStateChange uses: a job the
    // chain finished without us must land on the books identically.
    await applyReservationOutcome(client, job, onchain.state);
    return { job: escrowJobFromRow(row), drift };
  });
}
