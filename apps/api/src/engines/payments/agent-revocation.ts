import type pg from 'pg';
import { recordAuditEvent } from '../evidence/audit-writer.js';
import { prefixedId } from '../identity/ids.js';
import type { OperatorContext } from '../identity/types.js';
import { nativeBalanceMicros as defaultNativeBalanceMicros } from './agent-wallets.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import { withPostgresCircleOrgLock } from './circle-org-lock.js';
import type { PaymentChain, PaymentMode } from './types.js';

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

/**
 * Spendable-for-sweep amount: the balance minus what the sweep transaction
 * itself will cost in gas. On Arc, gas IS the USDC balance -- sweeping the
 * full amount would make the sweep unpayable. Clamps at zero rather than
 * going negative when the balance can't even cover its own gas.
 */
export function sweepAmountMicros(input: { readonly balanceMicros: bigint; readonly gasNeededMicros: bigint }): bigint {
  const amount = input.balanceMicros - input.gasNeededMicros;
  return amount > 0n ? amount : 0n;
}

/**
 * Revokes an agent in one transaction: suspends the agent (agents.status
 * = 'suspended' blocks runtime auth immediately -- authenticateConnection
 * already joins on status = 'active'), marks its allocation 'revoked' for
 * every chain, enqueues an agent_wallet.sweep job per active wallet, and
 * writes an audit event. The worker performs the actual sweep
 * (processAgentWalletSweepJob) under the org lock, then marks the wallet
 * 'swept'.
 */
export async function revokeAgent(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  agentId: string,
  mode: PaymentMode,
  reason: string,
): Promise<void> {
  await withPostgresCircleOrgLock(pool, orgId, () => withTransaction(pool, async (client) => {
    const agent = await client.query(
      `UPDATE agents SET status = 'suspended', updated_at = now()
        WHERE id = $1 AND org_id = $2
        RETURNING id`,
      [agentId, orgId],
    );
    if (agent.rows[0] === undefined) throw new Error('agent_not_found');

    await client.query(
      `UPDATE agent_allocations SET status = 'revoked', updated_at = now()
        WHERE agent_id = $1 AND mode = $2 AND status = 'active'`,
      [agentId, mode],
    );

    const wallets = await client.query<{ chain: PaymentChain }>(
      `SELECT chain FROM agent_chain_wallets
        WHERE agent_id = $1 AND mode = $2 AND status = 'active'`,
      [agentId, mode],
    );
    for (const wallet of wallets.rows) {
      await client.query(
        `INSERT INTO circle_provider_jobs
           (id, org_id, mode, job_type, chain, status, metadata, created_by)
         VALUES ($1, $2, $3, 'agent_wallet.sweep', $4, 'queued', $5::jsonb, $6)`,
        [
          prefixedId('cjob'),
          orgId,
          mode,
          wallet.chain,
          JSON.stringify({ agent_id: agentId, reason }),
          operator.actorId,
        ],
      );
    }

    await recordAuditEvent(client, {
      orgId,
      idempotencyKey: `agent.revoked:${agentId}`,
      eventType: 'agent.revoked',
      actor: { type: 'user', id: operator.actorId },
      action: 'agent.revoke',
      outcome: 'success',
      reasonCode: reason,
      resource: { type: 'agent', id: agentId },
      classification: {
        domain: 'payment',
        category: 'financial',
        severity: 'critical',
        tags: ['section_9', 'agent_revocation'],
      },
      relations: { agent: agentId },
      refs: {},
      source: { section: 'section_9', system: 'payments' },
      retentionClass: 'payment',
      payload: {
        chains_swept: wallets.rows.map((w) => w.chain),
        reason,
      },
    });
  }));
}

type AgentWalletSweepJobRow = {
  readonly id: string;
  readonly org_id: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain | null;
  readonly metadata: unknown;
};

function jobAgentId(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const agentId = (metadata as Record<string, unknown>).agent_id;
  return typeof agentId === 'string' && agentId.length > 0 ? agentId : null;
}

function formatUsdc(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const decimal = (micros % 1_000_000n).toString().padStart(6, '0');
  return `${whole.toString()}.${decimal}`;
}

export type ProcessAgentWalletSweepJobDeps = {
  readonly nativeBalanceMicros?: (address: string, chain: PaymentChain) => Promise<bigint>;
  readonly gasNeededMicros: bigint;
};

/**
 * Processes one queued 'agent_wallet.sweep' job: reads the agent wallet's
 * real native balance, transfers everything above gas cost back to the
 * org's treasury wallet, and marks the wallet 'swept' regardless of
 * whether a transfer actually happened -- a dust balance that can't
 * cover its own gas is not a failure, it's a wallet with nothing left to
 * sweep.
 */
export async function processAgentWalletSweepJob(
  db: pg.Pool | pg.PoolClient,
  jobId: string,
  provider: CircleTreasuryProvider,
  deps: ProcessAgentWalletSweepJobDeps,
): Promise<void> {
  const readBalance = deps.nativeBalanceMicros ?? defaultNativeBalanceMicros;
  const jobResult = await db.query<AgentWalletSweepJobRow>(
    `SELECT id, org_id, mode, chain, metadata
       FROM circle_provider_jobs
      WHERE id = $1 AND job_type = 'agent_wallet.sweep'
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
    const agentWallet = await db.query<{ address: string }>(
      `SELECT address FROM agent_chain_wallets
        WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
        LIMIT 1`,
      [agentId, job.mode, job.chain],
    );
    const agentWalletRow = agentWallet.rows[0];
    if (agentWalletRow === undefined) throw new Error('agent_wallet_not_found');

    const treasuryWallet = await db.query<{ address: string }>(
      `SELECT address FROM circle_chain_wallets
        WHERE org_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
        LIMIT 1`,
      [job.org_id, job.mode, job.chain],
    );
    const treasuryRow = treasuryWallet.rows[0];
    if (treasuryRow === undefined) throw new Error('circle_wallet_missing');

    const balance = await readBalance(agentWalletRow.address, job.chain);
    const amountMicros = sweepAmountMicros({ balanceMicros: balance, gasNeededMicros: deps.gasNeededMicros });

    let providerRef: string | null = null;
    if (amountMicros > 0n) {
      const transfer = await provider.transferWallet({
        amountMicros,
        chain: job.chain,
        destinationAddress: treasuryRow.address,
        mode: job.mode,
        refId: `agentops-sweep-${jobId}`,
        sourceAddress: agentWalletRow.address,
      });
      providerRef = transfer.transactionId;
    }

    await db.query(
      `UPDATE agent_chain_wallets
          SET status = 'swept', swept_at = now(), updated_at = now()
        WHERE agent_id = $1 AND mode = $2 AND chain = $3`,
      [agentId, job.mode, job.chain],
    );
    await db.query(
      `UPDATE circle_provider_jobs
          SET status = 'complete', amount_usdc = $2::numeric, provider_ref = $3, updated_at = now()
        WHERE id = $1`,
      [jobId, formatUsdc(amountMicros), providerRef],
    );
  } catch (error) {
    await db.query(
      `UPDATE circle_provider_jobs
          SET status = 'failed',
              error_code = $2,
              updated_at = now()
        WHERE id = $1`,
      [jobId, error instanceof Error ? error.message : 'agent_wallet_sweep_failed'],
    );
  }
}
