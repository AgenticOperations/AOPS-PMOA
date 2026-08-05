import type pg from 'pg';
import { badRequest } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import { chainRpcUrl, findAgentWallet } from './agent-wallets.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import {
  ESCROW_CREATE_JOB_SIGNATURE,
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
