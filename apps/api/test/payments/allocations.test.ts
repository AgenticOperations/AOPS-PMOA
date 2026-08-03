import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { setAllocation } from '../../src/engines/payments/allocations.js';
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
