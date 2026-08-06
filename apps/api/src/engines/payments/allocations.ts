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

function clampBigint(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min;
  if (value > max) return max;
  return value;
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
  db: pg.Pool | pg.PoolClient,
  orgId: string,
  mode: PaymentMode,
  chain: PaymentChain,
): Promise<string> {
  const result = await db.query<{ address: string }>(
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
  db: pg.Pool | pg.PoolClient,
  provider: CircleTreasuryProvider,
  orgId: string,
  mode: PaymentMode,
  chain: PaymentChain,
): Promise<bigint> {
  const address = await treasuryAddress(db, orgId, mode, chain);
  const balance = await provider.getGatewayBalance({ address, chain, mode });
  return parseUsdcMicros(balance.available);
}

/**
 * Writes an allocation, enforcing the fleet solvency invariant:
 *
 *   sum(allocated across all agents) <= real treasury deposits
 *
 * Without this, two agents can each hold a $100 allocation against a $50
 * treasury and nothing fires.
 *
 * The treasury read happens BEFORE the org lock is acquired, deliberately
 * -- provider.getGatewayBalance is a real network call, and when the
 * provider is worker-backed (real dev/production config) that call goes
 * out over HTTP to a separate process (circle-worker) which independently
 * takes the SAME org advisory lock before answering. Holding the lock
 * across that call deadlocks: this process never releases the lock
 * because it's blocked waiting on the worker's response, and the worker
 * never gets the lock because this process holds it. (Invisible to any
 * test using an in-process fake provider -- only a real, worker-backed
 * provider ever makes the out-of-process call that creates the cycle.)
 *
 * This does widen the race window between reading the balance and
 * writing the allocation -- two concurrent setAllocation calls could both
 * read the same deposits figure before either writes. The sum-check AND
 * the write still happen together inside the lock, so the worst case is a
 * slightly stale solvency figure, not a torn read/write; the same
 * external-read-then-serialized-write shape every other real-money check
 * in this codebase already uses.
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
  const deposits = await treasuryDepositsMicros(pool, provider, input.orgId, input.mode, input.chain);

  return withPostgresCircleOrgLock(pool, input.orgId, () => withTransaction(pool, async (client) => {
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
  // Org-scoped, because the real deposits clamp reads Gateway per org.
  readonly providerFactory: (orgId: string) => CircleTreasuryProvider;
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
    await evaluateSingleTopUp(
      pool,
      input.nativeBalanceMicros,
      input.providerFactory(allocation.org_id),
      allocation,
    );
  }
}

/**
 * Sum of what every OTHER active agent on this org+chain is actually
 * holding on-chain right now. Deliberately real balances, not allocations:
 * the clamp protects against over-committing real deposits, and an
 * allocation nobody has drawn yet has not consumed any.
 */
async function otherAgentsOnChainMicros(
  db: pg.PoolClient,
  nativeBalanceMicros: NativeBalanceReader,
  allocation: AllocationWithWalletRow,
): Promise<bigint> {
  const others = await db.query<{ wallet_address: string }>(
    `SELECT w.address AS wallet_address
       FROM agent_allocations a
       JOIN agent_chain_wallets w
         ON w.agent_id = a.agent_id AND w.mode = a.mode AND w.chain = a.chain AND w.status = 'active'
      WHERE a.org_id = $1 AND a.mode = $2 AND a.chain = $3
        AND a.status = 'active' AND a.agent_id <> $4`,
    [allocation.org_id, allocation.mode, allocation.chain, allocation.agent_id],
  );

  let total = 0n;
  for (const row of others.rows) {
    total += await nativeBalanceMicros(row.wallet_address, allocation.chain, allocation.mode);
  }
  return total;
}

async function evaluateSingleTopUp(
  pool: pg.Pool,
  nativeBalanceMicros: NativeBalanceReader,
  provider: CircleTreasuryProvider,
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

    // This agent may be funded up to its own allocation -- that is what an
    // allocation means. (Subtracting other agents' allocations here would
    // be wrong: with N agents holding equal allocations, every agent's
    // entitlement collapses to zero and no agent is ever funded.)
    const allocated = parseUsdcMicros(allocation.allocated_usdc);
    const entitlement = allocated > rawBalance ? allocated - rawBalance : 0n;

    // Fleet solvency clamp: real Gateway deposits, minus what every OTHER
    // agent on this chain is already holding on-chain. An allocation is an
    // intent, not proof the money exists -- auto-topup must never
    // manufacture funds no deposit backed.
    const deposits = await treasuryDepositsMicros(
      client,
      provider,
      allocation.org_id,
      allocation.mode,
      allocation.chain,
    );
    const heldByOthers = await otherAgentsOnChainMicros(client, nativeBalanceMicros, allocation);
    const solvencyHeadroom = deposits > heldByOthers ? deposits - heldByOthers : 0n;

    // Smallest of: room under the ceiling, this agent's own entitlement,
    // and real fleet solvency headroom.
    const underCeiling = ceilingGap < entitlement ? ceilingGap : entitlement;
    const topUpMicros = underCeiling < solvencyHeadroom ? underCeiling : solvencyHeadroom;
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

// ---------------------------------------------------------------------------
// Reputation -> allocation feedback [manifest D5, K-6]. Formula recorded in
// docs/decisions.md under K-6 before this was written -- read that first if
// the bounds below look arbitrary; they are not.
// ---------------------------------------------------------------------------

// K-6's fixed bound: one adjustment can move allocation by at most 10% of
// its CURRENT value, never a flat USDC amount, so the bound stays
// proportionate as an agent's allocation grows.
const REPUTATION_MAX_STEP_BPS = 1000;
const BPS_DENOMINATOR = 10_000n;

export type NextAllocationInput = {
  readonly current: bigint;
  readonly floor: bigint;
  readonly ceiling: bigint;
  // 0-100. Not a fraction -- kept as the same 0-100 scale
  // agent_reputation_events.score already uses, so a caller never has to
  // convert between two different reputation scales.
  readonly reputation: number;
  readonly maxStepBps: number;
};

/**
 * Pure and exhaustively testable without a database on purpose -- this is
 * the one place in the build where a bug compounds automatically rather
 * than failing once (K-6), so its correctness has to be checkable without
 * spinning up Postgres or a fake provider.
 *
 * Never returns a value outside [floor, ceiling], and never moves further
 * than maxStepBps of `current` in one call -- both are hard bounds, not
 * defaults a caller can widen by passing a different reputation.
 */
export function nextAllocation(input: NextAllocationInput): bigint {
  const reputationBps = BigInt(Math.max(0, Math.min(100, Math.round(input.reputation)))) * 100n;
  const range = input.ceiling - input.floor;
  const target = input.floor + (range * reputationBps) / BPS_DENOMINATOR;
  const step = (input.current * BigInt(Math.max(0, Math.round(input.maxStepBps)))) / BPS_DENOMINATOR;
  const delta = clampBigint(target - input.current, -step, step);
  return clampBigint(input.current + delta, input.floor, input.ceiling);
}

export type ApplyReputationAdjustmentInput = {
  readonly orgId: string;
  readonly agentId: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly reputation: number;
  readonly createdBy?: string | undefined;
};

/**
 * Moves one agent's allocation toward its reputation-implied target, bounded
 * per nextAllocation, then writes it through the EXISTING setAllocation --
 * never a second write path. That is what keeps the Phase 4 solvency
 * invariant binding: a reputation-implied allocation that would exceed real
 * treasury deposits is refused exactly the way any other over-allocation is.
 */
export async function applyReputationAdjustment(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: ApplyReputationAdjustmentInput,
): Promise<AgentAllocationRow> {
  const existing = await pool.query<AgentAllocationRow>(
    `SELECT * FROM agent_allocations
      WHERE org_id = $1 AND agent_id = $2 AND mode = $3 AND chain = $4 AND status = 'active'`,
    [input.orgId, input.agentId, input.mode, input.chain],
  );
  const row = existing.rows[0];
  if (row === undefined) throw new Error('agent_allocation_not_found');

  const next = nextAllocation({
    current: parseUsdcMicros(row.allocated_usdc),
    // gas_reserve_usdc, not a new column: K-6's hard floor exists so
    // reputation can never strand an agent below what it needs to operate
    // at all, which is exactly what this column already represents.
    floor: parseUsdcMicros(row.gas_reserve_usdc),
    ceiling: parseUsdcMicros(row.ceiling_usdc),
    reputation: input.reputation,
    maxStepBps: REPUTATION_MAX_STEP_BPS,
  });

  return setAllocation(pool, provider, {
    orgId: input.orgId,
    agentId: input.agentId,
    mode: input.mode,
    chain: input.chain,
    allocatedUsdc: formatUsdc(next),
    gasReserveUsdc: row.gas_reserve_usdc,
    lowWaterMarkUsdc: row.low_water_mark_usdc,
    ceilingUsdc: row.ceiling_usdc,
    createdBy: input.createdBy ?? 'system',
  });
}
