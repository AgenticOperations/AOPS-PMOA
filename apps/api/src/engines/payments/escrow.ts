import { createHash } from 'node:crypto';
import type pg from 'pg';
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

/**
 * Sends the transition's on-chain call and returns its hash, or null when
 * this platform is not the party that makes it.
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

  if (input.next === 'submitted') {
    // ERC-8183 lets ONLY job.provider submit. When the provider is an outside
    // party we hold no key for, it submits out of band and this call is just
    // the mirror catching up -- exactly as setBudget is handled in funding.
    const providerWallet = await fleetWalletAddress(db, {
      orgId: job.org_id, address: job.provider_address, mode: job.mode, chain: job.chain,
    });
    if (providerWallet === null) return null;
    const sent = await provider.executePermit2Transaction({
      mode: job.mode,
      chain: job.chain,
      senderAddress: providerWallet,
      abiFunctionSignature: ESCROW_SUBMIT_SIGNATURE,
      abiParameters: [onchainJobId, input.deliverableHash ?? ZERO_BYTES32, NO_HOOK_PARAMS],
      contractAddress: job.escrow_address,
      // Kept short -- see permit2.ts's note on refId length.
      refId: `agentops-escrow-submit-${crypto.randomUUID()}`,
    });
    return sent.txHash;
  }

  // complete() and reject() are the EVALUATOR's calls and no one else's.
  // Scoped by org, so one org's job can never be resolved with another's key.
  const evaluatorWallet = await fleetWalletAddress(db, {
    orgId: job.org_id, address: job.evaluator_address, mode: job.mode, chain: job.chain,
  });
  if (evaluatorWallet === null) {
    // An outside evaluator resolves the job itself. Writing the outcome anyway
    // would claim a result the chain never recorded; reconciling against the
    // chain is the only honest way to learn what it decided.
    throw conflict(
      'escrow_evaluator_wallet_not_held',
      `escrow_evaluator_wallet_not_held: only ${job.evaluator_address} may ${input.next === 'completed' ? 'complete' : 'reject'} `
      + 'this job, and this org holds no key for it. Reconcile against the chain instead.',
    );
  }
  const sent = await provider.executePermit2Transaction({
    mode: job.mode,
    chain: job.chain,
    senderAddress: evaluatorWallet,
    abiFunctionSignature: input.next === 'completed' ? ESCROW_COMPLETE_SIGNATURE : ESCROW_REJECT_SIGNATURE,
    abiParameters: [onchainJobId, ZERO_BYTES32, NO_HOOK_PARAMS],
    contractAddress: job.escrow_address,
    refId: `agentops-escrow-${input.next === 'completed' ? 'complete' : 'reject'}-${crypto.randomUUID()}`,
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
  return withTransaction(pool, async (client) => {
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
}
