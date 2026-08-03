import type pg from 'pg';
import { badRequest, conflict } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import { withPostgresCircleOrgLock } from './circle-org-lock.js';
import type { PaymentChain, PaymentMode } from './types.js';

// Duplicated from store.ts rather than imported: store.ts will import from
// this module in Task 4 (to wire allocations into the budget path), and
// store.ts -> allocations.ts -> store.ts would be this codebase's first
// circular module dependency. This is a small, pure, self-contained
// function with no other dependencies -- keep it byte-identical with
// store.ts's parseUsdcMicros if either ever changes.
function parseUsdcMicros(value: string | number): bigint {
  const raw = typeof value === 'number' ? value.toString() : value.trim();
  const match = /^(\d+)(?:\.(\d{1,6})?)?$/.exec(raw);
  if (match === null) throw badRequest('invalid_usdc_amount', 'USDC amount must be a positive decimal with up to 6 places.');
  const whole = BigInt(match[1] ?? '0') * 1_000_000n;
  const decimals = (match[2] ?? '').padEnd(6, '0');
  return whole + BigInt(decimals.length === 0 ? '0' : decimals);
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
