import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import {
  applyReputationAdjustment,
  evaluateTopUps,
  nextAllocation,
  setAllocation,
} from '../../src/engines/payments/allocations.js';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

function fakeProviderWithGatewayBalance(availableByChain: Record<string, string>): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: vi.fn(),
    getGatewayBalance: ({ chain }) => Promise.resolve({
      available: availableByChain[chain] ?? '0',
      domain: 0,
      providerMode: 'test',
      total: availableByChain[chain] ?? '0',
      withdrawable: availableByChain[chain] ?? '0',
      withdrawing: '0',
    }),
    getWalletBalances: vi.fn(),
    health: vi.fn(),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation: vi.fn(),
    executePermit2Transaction: vi.fn(),
    transferWallet: vi.fn(),
    transferNativeGas: vi.fn(),
  };
}

async function setupTreasuryFixture(
  store: PostgresTestStore,
  suffix: string,
  availableByChain: Record<string, string>,
) {
  const orgId = `org_alloc_${suffix}`;
  const teamId = `team_alloc_${suffix}`;
  const agentId = `agt_alloc_${suffix}`;
  const siblingAgentId = `agt_alloc_sibling_${suffix}`;
  const walletSetId = `ws_alloc_${suffix}`;

  await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Allocations Org')", [orgId]);
  await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
  await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
    agentId, orgId, teamId, 'Allocation Agent',
  ]);
  await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
    siblingAgentId, orgId, teamId, 'Sibling Allocation Agent',
  ]);
  await store.pool.query(
    `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
     VALUES ($1, $2, 'test', $3, 'Allocations wallet set', 'usr_alloc_test')`,
    [walletSetId, orgId, `circle_${walletSetId}`],
  );
  for (const [chain, address] of Object.entries({
    arc: `0xarc${suffix}0000000000000000000000000000000`.slice(0, 42),
    base: `0xbase${suffix}000000000000000000000000000000`.slice(0, 42),
  })) {
    await store.pool.query(
      `INSERT INTO circle_chain_wallets (
         id, org_id, wallet_set_id, mode, chain, circle_blockchain, circle_wallet_id, address
       ) VALUES ($1, $2, $3, 'test', $4, $5, $6, $7)`,
      [`cwallet_alloc_${chain}_${suffix}`, orgId, walletSetId, chain, chain === 'arc' ? 'ARC-TESTNET' : 'BASE-SEPOLIA', `circle_wallet_${chain}_${suffix}`, address],
    );
  }

  const provider = fakeProviderWithGatewayBalance(availableByChain);
  return { orgId, agentId, siblingAgentId, pool: store.pool, provider };
}

describe('solvency invariant', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  it('rejects an allocation that would exceed treasury deposits', async () => {
    const { orgId, agentId, siblingAgentId, pool, provider } = await setupTreasuryFixture(store, 'reject', { arc: '50.00' });

    await setAllocation(pool, provider, {
      orgId, agentId, mode: 'test', chain: 'arc', allocatedUsdc: '40.00', createdBy: 'usr_1',
    });

    await expect(setAllocation(pool, provider, {
      orgId, agentId: siblingAgentId, mode: 'test', chain: 'arc', allocatedUsdc: '20.00', createdBy: 'usr_1',
    })).rejects.toMatchObject({ code: 'allocation_exceeds_treasury_solvency' });
  });

  it('allows allocations up to exactly the deposit total', async () => {
    const { orgId, agentId, siblingAgentId, pool, provider } = await setupTreasuryFixture(store, 'exact', { arc: '50.00' });

    await setAllocation(pool, provider, {
      orgId, agentId, mode: 'test', chain: 'arc', allocatedUsdc: '30.00', createdBy: 'usr_1',
    });
    await expect(setAllocation(pool, provider, {
      orgId, agentId: siblingAgentId, mode: 'test', chain: 'arc', allocatedUsdc: '20.00', createdBy: 'usr_1',
    })).resolves.toBeDefined();
  });

  it('keeps per-chain allocations independent', async () => {
    const { orgId, agentId, pool, provider } = await setupTreasuryFixture(store, 'perchain', { arc: '50.00', base: '10.00' });

    await setAllocation(pool, provider, {
      orgId, agentId, mode: 'test', chain: 'arc', allocatedUsdc: '50.00', createdBy: 'usr_1',
    });
    // Arc being full must not block Base.
    await expect(setAllocation(pool, provider, {
      orgId, agentId, mode: 'test', chain: 'base', allocatedUsdc: '10.00', createdBy: 'usr_1',
    })).resolves.toBeDefined();
  });

  it('serializes concurrent allocation writers', async () => {
    const { orgId, agentId, siblingAgentId, pool, provider } = await setupTreasuryFixture(store, 'concurrent', { arc: '50.00' });

    const results = await Promise.allSettled([
      setAllocation(pool, provider, { orgId, agentId, mode: 'test', chain: 'arc', allocatedUsdc: '30.00', createdBy: 'usr_1' }),
      setAllocation(pool, provider, { orgId, agentId: siblingAgentId, mode: 'test', chain: 'arc', allocatedUsdc: '30.00', createdBy: 'usr_1' }),
    ]);
    // $30 + $30 > $50: exactly one must win.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('allows raising an existing allocation without double-counting its own prior value', async () => {
    const { orgId, agentId, pool, provider } = await setupTreasuryFixture(store, 'raise', { arc: '50.00' });

    await setAllocation(pool, provider, {
      orgId, agentId, mode: 'test', chain: 'arc', allocatedUsdc: '30.00', createdBy: 'usr_1',
    });
    // Raising the SAME agent's allocation to $45 must not fail by summing
    // its own old $30 plus the new $45 -- that would falsely read $75 > $50.
    await expect(setAllocation(pool, provider, {
      orgId, agentId, mode: 'test', chain: 'arc', allocatedUsdc: '45.00', createdBy: 'usr_1',
    })).resolves.toBeDefined();
  });
});

describe('auto top-up', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  async function setupAllocatedAgent(
    suffix: string,
    input: {
      readonly depositsUsdc: string;
      readonly allocatedUsdc: string;
      readonly lowWaterMarkUsdc: string;
      readonly ceilingUsdc: string;
      readonly gasReserveUsdc: string;
      readonly walletBalanceMicros: bigint;
    },
  ) {
    const { orgId, agentId, pool, provider } = await setupTreasuryFixture(store, suffix, { arc: input.depositsUsdc });
    await setAllocation(pool, provider, {
      orgId, agentId, mode: 'test', chain: 'arc',
      allocatedUsdc: input.allocatedUsdc,
      ceilingUsdc: input.ceilingUsdc,
      gasReserveUsdc: input.gasReserveUsdc,
      lowWaterMarkUsdc: input.lowWaterMarkUsdc,
      createdBy: 'usr_1',
    });
    const walletSet = await pool.query<{ id: string }>(
      "SELECT id FROM circle_wallet_sets WHERE org_id = $1 AND mode = 'test'", [orgId],
    );
    await recordProvisionedWallet(pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: `circle_wallet_agent_${suffix}`,
      address: `0xagent${suffix}00000000000000000000000000000`.slice(0, 42),
      refId: `ref_${suffix}`,
      walletSetId: walletSet.rows[0]!.id,
      circleBlockchain: 'ARC-TESTNET',
    });
    const nativeBalanceMicros = vi.fn(() => Promise.resolve(input.walletBalanceMicros));
    return { orgId, agentId, pool, provider, nativeBalanceMicros };
  }

  it('enqueues a top-up when spendable balance falls below the low-water mark', async () => {
    const { orgId, pool, nativeBalanceMicros, provider } = await setupAllocatedAgent('topup_low', {
      depositsUsdc: '50.00', allocatedUsdc: '10.00', lowWaterMarkUsdc: '2.00',
      ceilingUsdc: '10.00', gasReserveUsdc: '0.50',
      // $2.00 raw - $0.50 gas = $1.50 spendable, below the $2.00 mark.
      walletBalanceMicros: 2_000_000n,
    });

    await evaluateTopUps(pool, { mode: 'test', nativeBalanceMicros, providerFactory: () => provider });

    const jobs = await pool.query<{ amount_usdc: string }>(
      "SELECT amount_usdc FROM circle_provider_jobs WHERE job_type = 'agent_wallet.topup' AND org_id = $1",
      [orgId],
    );
    expect(jobs.rowCount).toBe(1);
    // Tops up to the ceiling: $10.00 ceiling - $2.00 raw balance = $8.00.
    expect(jobs.rows[0]?.amount_usdc).toBe('8.000000');
  });

  it('does not top up when spendable is at or above the low-water mark', async () => {
    const { orgId, pool, nativeBalanceMicros, provider } = await setupAllocatedAgent('topup_ok', {
      depositsUsdc: '50.00', allocatedUsdc: '10.00', lowWaterMarkUsdc: '2.00',
      ceilingUsdc: '10.00', gasReserveUsdc: '0.50',
      // $2.50 raw - $0.50 gas = $2.00 spendable, exactly at the mark.
      walletBalanceMicros: 2_500_000n,
    });

    await evaluateTopUps(pool, { mode: 'test', nativeBalanceMicros, providerFactory: () => provider });

    const jobs = await pool.query(
      "SELECT 1 FROM circle_provider_jobs WHERE job_type = 'agent_wallet.topup' AND org_id = $1",
      [orgId],
    );
    expect(jobs.rowCount).toBe(0);
  });

  it('triggers on spendable, not raw, balance', async () => {
    const { orgId, pool, nativeBalanceMicros, provider } = await setupAllocatedAgent('topup_spendable', {
      depositsUsdc: '50.00', allocatedUsdc: '10.00', lowWaterMarkUsdc: '2.00',
      ceilingUsdc: '10.00', gasReserveUsdc: '0.50',
      // Raw $2.40 -> spendable $1.90 -- must trigger even though raw > mark.
      walletBalanceMicros: 2_400_000n,
    });

    await evaluateTopUps(pool, { mode: 'test', nativeBalanceMicros, providerFactory: () => provider });

    const jobs = await pool.query(
      "SELECT 1 FROM circle_provider_jobs WHERE job_type = 'agent_wallet.topup' AND org_id = $1",
      [orgId],
    );
    expect(jobs.rowCount).toBe(1);
  });

  it('does not enqueue a second top-up while one is already pending', async () => {
    const { orgId, pool, nativeBalanceMicros, provider } = await setupAllocatedAgent('topup_dedupe', {
      depositsUsdc: '50.00', allocatedUsdc: '10.00', lowWaterMarkUsdc: '2.00',
      ceilingUsdc: '10.00', gasReserveUsdc: '0.50',
      walletBalanceMicros: 2_000_000n,
    });

    await evaluateTopUps(pool, { mode: 'test', nativeBalanceMicros, providerFactory: () => provider });
    await evaluateTopUps(pool, { mode: 'test', nativeBalanceMicros, providerFactory: () => provider });

    const jobs = await pool.query(
      "SELECT 1 FROM circle_provider_jobs WHERE job_type = 'agent_wallet.topup' AND org_id = $1",
      [orgId],
    );
    expect(jobs.rowCount).toBe(1);
  });

  it('refuses a top-up that would break fleet solvency', async () => {
    // Deposits are only $10 total, but this agent's own allocation already
    // claims all of it -- topping up to the $50 ceiling would require
    // funding that was never deposited.
    const { orgId, pool, nativeBalanceMicros, provider } = await setupAllocatedAgent('topup_solvency', {
      depositsUsdc: '10.00', allocatedUsdc: '10.00', lowWaterMarkUsdc: '2.00',
      ceilingUsdc: '50.00', gasReserveUsdc: '0.50',
      walletBalanceMicros: 1_000_000n,
    });

    await evaluateTopUps(pool, { mode: 'test', nativeBalanceMicros, providerFactory: () => provider });

    const jobs = await pool.query<{ amount_usdc: string }>(
      "SELECT amount_usdc FROM circle_provider_jobs WHERE job_type = 'agent_wallet.topup' AND org_id = $1",
      [orgId],
    );
    expect(jobs.rowCount).toBe(1);
    // Clamped to what's actually deposited, not the full ceiling gap.
    expect(jobs.rows[0]?.amount_usdc).toBe('9.000000');
  });

  it('funds every agent when several hold equal allocations on one chain', async () => {
    // Regression: the solvency clamp used to be
    //   entitlement = own_allocation - SUM(other agents' allocations)
    // so with N agents holding equal allocations every entitlement
    // collapsed to <= 0 and NO agent was ever topped up -- the fleet
    // silently starved. Deposits here ($20) genuinely back both agents.
    const { orgId, agentId: firstAgentId, pool, provider } =
      await setupTreasuryFixture(store, 'topup_fleet', { arc: '20.00' });
    const walletSet = await pool.query<{ id: string }>(
      "SELECT id FROM circle_wallet_sets WHERE org_id = $1 AND mode = 'test'", [orgId],
    );
    const secondAgentId = 'agt_alloc_topup_fleet_second';
    const teamId = await pool.query<{ id: string }>(
      'SELECT id FROM teams WHERE org_id = $1 LIMIT 1', [orgId],
    );
    await pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      secondAgentId, orgId, teamId.rows[0]!.id, 'Second Allocation Agent',
    ]);

    for (const [index, agentId] of [firstAgentId, secondAgentId].entries()) {
      await setAllocation(pool, provider, {
        orgId, agentId, mode: 'test', chain: 'arc',
        allocatedUsdc: '5.00', ceilingUsdc: '5.00',
        gasReserveUsdc: '0.00', lowWaterMarkUsdc: '1.00',
        createdBy: 'usr_1',
      });
      await recordProvisionedWallet(pool, {
        orgId, agentId, mode: 'test', chain: 'arc',
        circleWalletId: `circle_wallet_fleet_${index}`,
        address: `0xfleet${index}000000000000000000000000000000`.slice(0, 42),
        refId: `ref_fleet_${index}`,
        walletSetId: walletSet.rows[0]!.id,
        circleBlockchain: 'ARC-TESTNET',
      });
    }

    // Both wallets sit empty, so both are below their low-water mark.
    const nativeBalanceMicros = vi.fn(() => Promise.resolve(0n));
    await evaluateTopUps(pool, { mode: 'test', nativeBalanceMicros, providerFactory: () => provider });

    const jobs = await pool.query<{ amount_usdc: string }>(
      "SELECT amount_usdc FROM circle_provider_jobs WHERE job_type = 'agent_wallet.topup' AND org_id = $1",
      [orgId],
    );
    expect(jobs.rowCount).toBe(2);
    expect(jobs.rows.map((row) => row.amount_usdc)).toEqual(['5.000000', '5.000000']);
  });
});

// K-6 (docs/decisions.md). Pure-function tests need no database at all --
// deliberately, since this is the one place in the build where a bug
// compounds automatically rather than failing once.
describe('reputation-driven allocation', () => {
  it('never drops allocation below the floor', () => {
    const next = nextAllocation({
      current: 5_000_000n, floor: 2_000_000n, ceiling: 20_000_000n,
      reputation: 0, maxStepBps: 1000,
    });
    expect(next).toBeGreaterThanOrEqual(2_000_000n);
  });

  it('never raises allocation above the operator ceiling', () => {
    const next = nextAllocation({
      current: 19_500_000n, floor: 2_000_000n, ceiling: 20_000_000n,
      reputation: 100, maxStepBps: 1000,
    });
    expect(next).toBeLessThanOrEqual(20_000_000n);
  });

  it('bounds how far a single adjustment can move allocation', () => {
    const next = nextAllocation({
      current: 10_000_000n, floor: 1_000_000n, ceiling: 100_000_000n,
      reputation: 100, maxStepBps: 1000, // 10% max step
    });
    expect(next).toBeLessThanOrEqual(11_000_000n);
  });

  it('moves toward the floor when reputation is at the bottom, not away from it', () => {
    const next = nextAllocation({
      current: 10_000_000n, floor: 1_000_000n, ceiling: 20_000_000n,
      reputation: 0, maxStepBps: 1000,
    });
    expect(next).toBeLessThan(10_000_000n);
    expect(next).toBeGreaterThanOrEqual(1_000_000n);
  });

  it('holds steady when current is already at the reputation-implied target', () => {
    const next = nextAllocation({
      current: 20_000_000n, floor: 1_000_000n, ceiling: 20_000_000n,
      reputation: 100, maxStepBps: 1000,
    });
    expect(next).toBe(20_000_000n);
  });

  it('converges rather than oscillating across repeated adjustments', () => {
    let current = 10_000_000n;
    for (let i = 0; i < 50; i += 1) {
      current = nextAllocation({
        current, floor: 1_000_000n, ceiling: 20_000_000n,
        reputation: 100, maxStepBps: 1000,
      });
    }
    expect(current).toBe(20_000_000n); // settles at the ceiling, no runaway
  });

  describe('applyReputationAdjustment', () => {
    let store: PostgresTestStore;

    beforeAll(async () => {
      store = await startPostgres();
    }, 90_000);

    afterAll(async () => {
      if (store !== undefined) await store.stop();
    });

    it('still refuses to breach the treasury solvency invariant', async () => {
      // Reputation adjusts allocation WITHIN deposits, never around them.
      const { orgId, agentId, pool, provider } = await setupTreasuryFixture(store, 'repufull', { arc: '50.00' });
      await setAllocation(pool, provider, {
        orgId, agentId, mode: 'test', chain: 'arc', allocatedUsdc: '50.00', ceilingUsdc: '50.00', createdBy: 'usr_1',
      });

      await expect(
        applyReputationAdjustment(pool, provider, { orgId, agentId, mode: 'test', chain: 'arc', reputation: 100 }),
      ).resolves.toMatchObject({ allocated_usdc: '50.000000' }); // capped, not raised
    });

    it('writes the adjusted allocation through setAllocation, bounded by the step', async () => {
      const { orgId, agentId, pool, provider } = await setupTreasuryFixture(store, 'repustep', { arc: '50.00' });
      await setAllocation(pool, provider, {
        orgId, agentId, mode: 'test', chain: 'arc',
        allocatedUsdc: '10.00', ceilingUsdc: '50.00', gasReserveUsdc: '1.00', createdBy: 'usr_1',
      });

      const adjusted = await applyReputationAdjustment(pool, provider, {
        orgId, agentId, mode: 'test', chain: 'arc', reputation: 100,
      });

      // Target is the ceiling (reputation 100), but the step bound (10% of
      // the prior 10.00) caps a single adjustment at +1.00.
      expect(adjusted.allocated_usdc).toBe('11.000000');
    });

    it('throws when the agent has no allocation to adjust', async () => {
      const { orgId, agentId, pool, provider } = await setupTreasuryFixture(store, 'repumissing', { arc: '50.00' });
      await expect(
        applyReputationAdjustment(pool, provider, { orgId, agentId, mode: 'test', chain: 'arc', reputation: 100 }),
      ).rejects.toThrow(/agent_allocation_not_found/);
    });
  });
});
