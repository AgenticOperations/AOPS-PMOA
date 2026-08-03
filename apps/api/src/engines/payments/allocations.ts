import type pg from 'pg';
import { badRequest, conflict } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import { withPostgresCircleOrgLock } from './circle-org-lock.js';
import type { PaymentChain, PaymentMode } from './types.js';

// Duplicated from store.ts (not imported) and exported for agent-wallets.ts
// to reuse: store.ts will import from this module in Task 4 (to wire
// allocations into the budget path), and store.ts -> allocations.ts ->
// store.ts would be this codebase's first circular module dependency.
// agent-wallets.ts <-> allocations.ts has no such cycle either direction,
// so it imports this rather than holding a third copy. Small, pure,
// self-contained -- keep it byte-identical with store.ts's
// parseUsdcMicros if either ever changes.
export function parseUsdcMicros(value: string | number): bigint {
  const raw = typeof value === 'number' ? value.toString() : value.trim();
  const match = /^(\d+)(?:\.(\d{1,6})?)?$/.exec(raw);
  if (match === null) throw badRequest('invalid_usdc_amount', 'USDC amount must be a positive decimal with up to 6 places.');
  const whole = BigInt(match[1] ?? '0') * 1_000_000n;
  const decimals = (match[2] ?? '').padEnd(6, '0');
  return whole + BigInt(decimals.length === 0 ? '0' : decimals);
}

function formatUsdc(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const decimal = (micros % 1_000_000n).toString().padStart(6, '0');
  return `${whole.toString()}.${decimal}`;
}

export type AgentAllocationRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly allocated_usdc: string;
  readonly gas_reserve_usdc: string;
  readonly low_water_mark_usdc: string;
  readonly ceiling_usdc: string;
  readonly status: string;
};

export type SetAllocationInput = {
  readonly orgId: string;
  readonly agentId: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly allocatedUsdc: string;
  readonly gasReserveUsdc?: string | undefined;
  readonly lowWaterMarkUsdc?: string | undefined;
  readonly ceilingUsdc?: string | undefined;
  readonly createdBy: string;
};

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

async function treasuryAddress(
  client: pg.PoolClient,
  orgId: string,
  mode: PaymentMode,
  chain: PaymentChain,
): Promise<string> {
  const result = await client.query<{ address: string }>(
    `SELECT address FROM circle_chain_wallets
      WHERE org_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
      LIMIT 1`,
    [orgId, mode, chain],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('circle_wallet_missing');
  return row.address;
}

/**
 * Real treasury deposits for org+mode+chain, read live from Circle's
 * Gateway API. There is no local ledger of deposited amounts anywhere in
 * this schema -- summing a local column would drift from the truth the
 * moment a deposit job's status update is ever missed, exactly the class
 * of bug Phase 3's balance ceiling was built to avoid for agent wallets.
 */
async function treasuryDepositsMicros(
  client: pg.PoolClient,
  provider: CircleTreasuryProvider,
  orgId: string,
  mode: PaymentMode,
  chain: PaymentChain,
): Promise<bigint> {
  const address = await treasuryAddress(client, orgId, mode, chain);
  const balance = await provider.getGatewayBalance({ address, chain, mode });
  return parseUsdcMicros(balance.available);
}

/**
 * Writes an allocation, enforcing the fleet solvency invariant:
 *
 *   sum(allocated across all agents) <= real treasury deposits
 *
 * Without this, two agents can each hold a $100 allocation against a $50
 * treasury and nothing fires. The check and the write share one
 * transaction; the whole thing runs under the org's advisory lock so two
 * concurrent writers can't both read the same stale sum and both pass.
 *
 * withPostgresCircleOrgLock takes the POOL and opens its own connection
 * for the advisory lock -- it must wrap the transaction, not sit inside
 * it (nesting it inside withTransaction would hand it a PoolClient where
 * a Pool is required, and would run the lock on a different connection
 * than the transaction it's meant to serialize).
 */
export async function setAllocation(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: SetAllocationInput,
): Promise<AgentAllocationRow> {
  return withPostgresCircleOrgLock(pool, input.orgId, () => withTransaction(pool, async (client) => {
    const deposits = await treasuryDepositsMicros(client, provider, input.orgId, input.mode, input.chain);

    const others = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(allocated_usdc), 0) AS total
         FROM agent_allocations
        WHERE org_id = $1 AND mode = $2 AND chain = $3
          AND status = 'active' AND agent_id <> $4`,
      [input.orgId, input.mode, input.chain, input.agentId],
    );

    const requested = parseUsdcMicros(input.allocatedUsdc);
    const committed = parseUsdcMicros(others.rows[0]?.total ?? '0');

    if (committed + requested > deposits) {
      throw conflict(
        'allocation_exceeds_treasury_solvency',
        'Total agent allocations would exceed treasury deposits for this chain.',
      );
    }

    const result = await client.query<AgentAllocationRow>(
      `INSERT INTO agent_allocations
         (id, org_id, agent_id, mode, chain, allocated_usdc, gas_reserve_usdc,
          low_water_mark_usdc, ceiling_usdc, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10)
       ON CONFLICT (agent_id, mode, chain) DO UPDATE
          SET allocated_usdc = EXCLUDED.allocated_usdc,
              gas_reserve_usdc = EXCLUDED.gas_reserve_usdc,
              low_water_mark_usdc = EXCLUDED.low_water_mark_usdc,
              ceiling_usdc = EXCLUDED.ceiling_usdc,
              updated_at = now()
       RETURNING *`,
      [
        prefixedId('aalloc'),
        input.orgId,
        input.agentId,
        input.mode,
        input.chain,
        input.allocatedUsdc,
        input.gasReserveUsdc ?? '0',
        input.lowWaterMarkUsdc ?? '0',
        input.ceilingUsdc ?? input.allocatedUsdc,
        input.createdBy,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('agent_allocation_insert_failed');
    return row;
  }));
}

type NativeBalanceReader = (address: string, chain: PaymentChain, mode: PaymentMode) => Promise<bigint>;

export type EvaluateTopUpsInput = {
  readonly mode: PaymentMode;
  readonly nativeBalanceMicros: NativeBalanceReader;
};

type AllocationWithWalletRow = AgentAllocationRow & {
  readonly wallet_address: string;
};

/**
 * Scans every active allocation for `mode`, and for any whose agent
 * wallet's SPENDABLE balance (raw − gas reserve, never raw alone -- see
 * agent-wallets.ts's readSpendableMicros) has fallen below its low-water
 * mark, enqueues an `agent_wallet.topup` job to fund it back toward its
 * ceiling.
 *
 * The top-up amount is clamped twice:
 *   1. Never above `ceiling_usdc − current raw balance` -- topping up
 *      further would exceed the ceiling this allocation itself declares.
 *   2. Never above real treasury solvency headroom for that org+chain --
 *      an allocation's ceiling is an intent, not a guarantee there's real
 *      money behind it. Auto-topup must never manufacture funds a
 *      deposit never backed.
 *
 * Idempotent: an org+agent+chain with an already-queued or submitted
 * agent_wallet.topup job is skipped, so repeated evaluation passes (the
 * worker's poll loop) don't pile up duplicate transfers for the same
 * shortfall.
 */
export async function evaluateTopUps(pool: pg.Pool, input: EvaluateTopUpsInput): Promise<void> {
  const allocations = await pool.query<AllocationWithWalletRow>(
    `SELECT a.*, w.address AS wallet_address
       FROM agent_allocations a
       JOIN agent_chain_wallets w
         ON w.agent_id = a.agent_id AND w.mode = a.mode AND w.chain = a.chain AND w.status = 'active'
      WHERE a.mode = $1 AND a.status = 'active'`,
    [input.mode],
  );

  for (const allocation of allocations.rows) {
    await evaluateSingleTopUp(pool, input.nativeBalanceMicros, allocation);
  }
}

async function evaluateSingleTopUp(
  pool: pg.Pool,
  nativeBalanceMicros: NativeBalanceReader,
  allocation: AllocationWithWalletRow,
): Promise<void> {
  const rawBalance = await nativeBalanceMicros(allocation.wallet_address, allocation.chain, allocation.mode);
  const gasReserve = parseUsdcMicros(allocation.gas_reserve_usdc);
  const spendable = rawBalance > gasReserve ? rawBalance - gasReserve : 0n;
  const lowWaterMark = parseUsdcMicros(allocation.low_water_mark_usdc);
  if (spendable >= lowWaterMark) return;

  const ceiling = parseUsdcMicros(allocation.ceiling_usdc);
  const ceilingGap = ceiling > rawBalance ? ceiling - rawBalance : 0n;
  if (ceilingGap <= 0n) return;

  await withPostgresCircleOrgLock(pool, allocation.org_id, () => withTransaction(pool, async (client) => {
    const pending = await client.query(
      `SELECT 1 FROM circle_provider_jobs
        WHERE org_id = $1 AND mode = $2 AND chain = $3 AND job_type = 'agent_wallet.topup'
          AND status IN ('queued', 'submitted') AND metadata->>'agent_id' = $4
        LIMIT 1`,
      [allocation.org_id, allocation.mode, allocation.chain, allocation.agent_id],
    );
    if ((pending.rowCount ?? 0) > 0) return;

    const others = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(allocated_usdc), 0) AS total
         FROM agent_allocations
        WHERE org_id = $1 AND mode = $2 AND chain = $3
          AND status = 'active' AND agent_id <> $4`,
      [allocation.org_id, allocation.mode, allocation.chain, allocation.agent_id],
    );
    const committed = parseUsdcMicros(others.rows[0]?.total ?? '0');

    // Solvency headroom for this specific agent's slice: real deposits
    // minus what every OTHER active agent already claims. A top-up must
    // never push this agent's on-chain balance past what its own
    // allocation is entitled to, even if the wider treasury holds more.
    const allocated = parseUsdcMicros(allocation.allocated_usdc);
    const entitlement = allocated > committed ? allocated - committed : 0n;
    const solvencyHeadroom = entitlement > rawBalance ? entitlement - rawBalance : 0n;

    const topUpMicros = ceilingGap < solvencyHeadroom ? ceilingGap : solvencyHeadroom;
    if (topUpMicros <= 0n) return;

    await client.query(
      `INSERT INTO circle_provider_jobs
         (id, org_id, mode, job_type, chain, status, amount_usdc, metadata, created_by)
       VALUES ($1, $2, $3, 'agent_wallet.topup', $4, 'queued', $5::numeric, $6::jsonb, $7)`,
      [
        prefixedId('cjob'),
        allocation.org_id,
        allocation.mode,
        allocation.chain,
        formatUsdc(topUpMicros),
        JSON.stringify({ agent_id: allocation.agent_id }),
        'agent-wallet-topup-evaluator',
      ],
    );
  }));
}
