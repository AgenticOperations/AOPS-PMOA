import type pg from 'pg';
import { prefixedId } from '../identity/ids.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import type { PaymentChain, PaymentMode } from './types.js';

type Db = pg.Pool | pg.PoolClient;

async function circleBlockchainForChain(db: Db, mode: PaymentMode, chain: PaymentChain): Promise<string> {
  const result = await db.query<{ circle_blockchain: string }>(
    'SELECT circle_blockchain FROM circle_chain_capabilities WHERE mode = $1 AND chain = $2',
    [mode, chain],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('circle_chain_capability_not_found');
  return row.circle_blockchain;
}

export type AgentChainWalletRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly chain: PaymentChain;
  readonly circle_wallet_id: string;
  readonly address: string;
  readonly status: string;
};

export async function enqueueAgentWalletProvisioning(
  db: Db,
  input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly mode: PaymentMode;
    readonly chains: readonly PaymentChain[];
    readonly createdBy: string;
  },
): Promise<void> {
  for (const chain of input.chains) {
    await db.query(
      `INSERT INTO circle_provider_jobs
         (id, org_id, mode, job_type, chain, status, metadata, created_by)
       VALUES ($1, $2, $3, 'agent_wallet.create', $4, 'queued', $5::jsonb, $6)`,
      [
        prefixedId('cjob'),
        input.orgId,
        input.mode,
        chain,
        JSON.stringify({ agent_id: input.agentId }),
        input.createdBy,
      ],
    );
  }
}

export async function recordProvisionedWallet(
  db: Db,
  input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly mode: PaymentMode;
    readonly chain: PaymentChain;
    readonly circleWalletId: string;
    readonly address: string;
    readonly refId: string;
    readonly walletSetId: string;
    readonly circleBlockchain: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO agent_chain_wallets
       (id, org_id, agent_id, wallet_set_id, mode, chain, circle_blockchain,
        circle_wallet_id, address, ref_id, status, provisioned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', now())
     ON CONFLICT (agent_id, mode, chain) DO NOTHING`,
    [
      prefixedId('acw'), input.orgId, input.agentId, input.walletSetId,
      input.mode, input.chain, input.circleBlockchain,
      input.circleWalletId, input.address, input.refId,
    ],
  );
}

export async function findAgentWallet(
  db: Db,
  agentId: string,
  mode: PaymentMode,
  chain: PaymentChain,
): Promise<AgentChainWalletRow | null> {
  const result = await db.query<AgentChainWalletRow>(
    `SELECT id, org_id, agent_id, chain, circle_wallet_id, address, status
       FROM agent_chain_wallets
      WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'`,
    [agentId, mode, chain],
  );
  return result.rows[0] ?? null;
}

/**
 * Any wallet already provisioned for this agent, on any chain -- used to
 * derive a new chain onto the SAME address (Circle's unified EVM
 * addressing via deriveWallet), rather than provisioning an unrelated
 * independent wallet. Deliberately picks the oldest (first-provisioned)
 * row so every later chain derives from the one true "primary" wallet
 * instead of chaining derivations off whichever row happens to be found.
 */
export async function findAnyAgentWallet(
  db: Db,
  agentId: string,
  mode: PaymentMode,
): Promise<AgentChainWalletRow | null> {
  const result = await db.query<AgentChainWalletRow>(
    `SELECT id, org_id, agent_id, chain, circle_wallet_id, address, status
       FROM agent_chain_wallets
      WHERE agent_id = $1 AND mode = $2 AND status = 'active'
      ORDER BY provisioned_at ASC
      LIMIT 1`,
    [agentId, mode],
  );
  return result.rows[0] ?? null;
}

type AgentWalletCreateJobRow = {
  readonly id: string;
  readonly org_id: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain | null;
  readonly status: string;
  readonly metadata: unknown;
};

function jobAgentId(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const agentId = (metadata as Record<string, unknown>).agent_id;
  return typeof agentId === 'string' && agentId.length > 0 ? agentId : null;
}

/**
 * Processes one queued 'agent_wallet.create' job: resolves whether this is
 * the agent's first wallet (independent create) or an additional chain
 * (derive onto the same address via Circle's unified EVM addressing), calls
 * the provider, records the result, and marks the job complete or failed.
 *
 * Caller is responsible for the per-org advisory lock and for selecting
 * only 'agent_wallet.create' jobs with status 'queued' -- this function
 * does not re-check status itself, matching the shape of the existing
 * liquidity-worker job handlers it sits alongside.
 */
export async function processAgentWalletCreateJob(
  db: Db,
  jobId: string,
  provider: CircleTreasuryProvider,
): Promise<void> {
  const jobResult = await db.query<AgentWalletCreateJobRow>(
    `SELECT id, org_id, mode, chain, status, metadata
       FROM circle_provider_jobs
      WHERE id = $1 AND job_type = 'agent_wallet.create'
      LIMIT 1`,
    [jobId],
  );
  const job = jobResult.rows[0];
  if (job === undefined) return;

  const agentId = jobAgentId(job.metadata);
  if (agentId === null || job.chain === null) {
    await db.query(
      `UPDATE circle_provider_jobs
          SET status = 'failed', error_code = 'agent_wallet_job_metadata_invalid', updated_at = now()
        WHERE id = $1`,
      [jobId],
    );
    return;
  }

  try {
    const walletSet = await db.query<{ id: string; circle_wallet_set_id: string }>(
      `SELECT id, circle_wallet_set_id FROM circle_wallet_sets
        WHERE org_id = $1 AND mode = $2 AND status = 'active' LIMIT 1`,
      [job.org_id, job.mode],
    );
    const walletSetRow = walletSet.rows[0];
    if (walletSetRow === undefined) throw new Error('circle_wallet_set_not_found');

    const circleBlockchain = await circleBlockchainForChain(db, job.mode, job.chain);

    // An agent's FIRST wallet is created independently; every SUBSEQUENT
    // chain derives from it so all of the agent's wallets share one
    // address (K-13) -- same address, independent per-chain balances.
    const existingWallet = await findAnyAgentWallet(db, agentId, job.mode);

    const created = await provider.createWallet({
      chain: job.chain,
      circleBlockchain,
      mode: job.mode,
      orgId: job.org_id,
      walletSetId: walletSetRow.circle_wallet_set_id,
      ...(existingWallet === null ? {} : { deriveFromWalletId: existingWallet.circle_wallet_id }),
    });

    await recordProvisionedWallet(db, {
      orgId: job.org_id,
      agentId,
      mode: job.mode,
      chain: job.chain,
      circleWalletId: created.circleWalletId,
      address: created.address,
      refId: existingWallet?.id ?? prefixedId('aref'),
      walletSetId: walletSetRow.id,
      circleBlockchain,
    });

    await db.query(
      `UPDATE circle_provider_jobs
          SET status = 'complete', provider_ref = $2, updated_at = now()
        WHERE id = $1`,
      [jobId, created.circleWalletId],
    );
  } catch (error) {
    await db.query(
      `UPDATE circle_provider_jobs
          SET status = 'failed',
              error_code = $2,
              updated_at = now()
        WHERE id = $1`,
      [jobId, error instanceof Error ? error.message : 'agent_wallet_create_failed'],
    );
  }
}

/**
 * Spendable balance for budget decisions.
 *
 * On Arc, USDC IS the native gas asset -- the ERC-20 view and the native
 * balance are the same pool, and the ERC-20 view TRUNCATES (constraint I.8).
 * A balanceOf of 0 does NOT mean zero native balance. Gas decisions must
 * therefore read the native balance. See docs/spike-results.md (S6).
 *
 * Spendable = balance - gasReserve. Never compare against the raw balance:
 * an agent that spends to zero on Arc cannot transact at all, cannot be
 * swept, and is bricked.
 */
export async function readSpendableMicros(
  wallet: Pick<AgentChainWalletRow, 'address' | 'chain'>,
  gasReserveMicros: bigint,
  deps: { readonly nativeBalanceMicros: (address: string, chain: PaymentChain) => Promise<bigint> },
): Promise<bigint> {
  const balance = await deps.nativeBalanceMicros(wallet.address, wallet.chain);
  const spendable = balance - gasReserveMicros;
  return spendable > 0n ? spendable : 0n;
}
