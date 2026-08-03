import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  enqueueAgentWalletProvisioning,
  findAgentWallet,
  recordProvisionedWallet,
  readSpendableMicros,
  type AgentChainWalletRow,
} from '../../src/engines/payments/agent-wallets.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

async function setupAgentFixture(store: PostgresTestStore, suffix: string) {
  const orgId = `org_agentw_${suffix}`;
  const teamId = `team_agentw_${suffix}`;
  const agentId = `agt_agentw_${suffix}`;
  const siblingAgentId = `agt_agentw_sibling_${suffix}`;
  const walletSetId = `ws_agentw_${suffix}`;

  await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Agent Wallets Org')", [orgId]);
  await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
  await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
    agentId, orgId, teamId, 'Wallet Agent',
  ]);
  await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
    siblingAgentId, orgId, teamId, 'Sibling Agent',
  ]);
  await store.pool.query(
    `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
     VALUES ($1, $2, 'test', $3, 'Agent wallet set', 'usr_agentw_test')`,
    [walletSetId, orgId, `circle_${walletSetId}`],
  );

  return { orgId, agentId, siblingAgentId, walletSetId, pool: store.pool };
}

describe('agent wallet provisioning', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  it('enqueues one job per requested chain', async () => {
    const { orgId, agentId, pool } = await setupAgentFixture(store, 'enqueue');

    await enqueueAgentWalletProvisioning(pool, {
      orgId, agentId, mode: 'test', chains: ['arc', 'base'], createdBy: 'usr_1',
    });

    const jobs = await pool.query<{ chain: string }>(
      `SELECT chain FROM circle_provider_jobs
        WHERE org_id = $1 AND job_type = 'agent_wallet.create' ORDER BY chain`,
      [orgId],
    );
    expect(jobs.rows.map((r) => r.chain)).toEqual(['arc', 'base']);
  });

  it('binds distinct agents to distinct wallets', async () => {
    const { orgId, agentId, siblingAgentId, walletSetId, pool } = await setupAgentFixture(store, 'distinct');

    await recordProvisionedWallet(pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_1', address: '0xaaa0000000000000000000000000000000aaaa', refId: 'ref_a',
      walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    await recordProvisionedWallet(pool, {
      orgId, agentId: siblingAgentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_2', address: '0xbbb0000000000000000000000000000000bbbb', refId: 'ref_b',
      walletSetId, circleBlockchain: 'ARC-TESTNET',
    });

    const rows = await pool.query<{ agent_id: string; address: string }>(
      'SELECT agent_id, address FROM agent_chain_wallets WHERE org_id = $1 ORDER BY agent_id',
      [orgId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.address).not.toBe(rows.rows[1]?.address);
  });

  it('allows the same agent on two chains sharing one address', async () => {
    const { orgId, agentId, walletSetId, pool } = await setupAgentFixture(store, 'sameaddr');

    for (const chain of ['arc', 'base'] as const) {
      await recordProvisionedWallet(pool, {
        orgId, agentId, mode: 'test', chain,
        circleWalletId: `w_${chain}`, address: '0xccc0000000000000000000000000000000cccc', refId: 'ref_a',
        walletSetId, circleBlockchain: chain === 'arc' ? 'ARC-TESTNET' : 'BASE-SEPOLIA',
      });
    }

    const rows = await pool.query<{ chain: string; address: string }>(
      'SELECT chain, address FROM agent_chain_wallets WHERE agent_id = $1 ORDER BY chain',
      [agentId],
    );
    expect(rows.rows).toHaveLength(2);
    // Same refId => same address; balances are still per-chain state.
    expect(rows.rows[0]?.address).toBe(rows.rows[1]?.address);
  });

  it('rejects a non-EOA account type at the database level', async () => {
    const { orgId, agentId, walletSetId, pool } = await setupAgentFixture(store, 'scareject');
    await expect(pool.query(
      `INSERT INTO agent_chain_wallets
         (id, org_id, agent_id, wallet_set_id, mode, chain, circle_blockchain,
          circle_wallet_id, address, account_type, ref_id)
       VALUES ('acw_bad', $1, $2, $3, 'test', 'arc', 'ARC-TESTNET',
               'w_x', '0xddd0000000000000000000000000000000dddd', 'sca', 'ref_x')`,
      [orgId, agentId, walletSetId],
    )).rejects.toThrow();
  });

  it('is idempotent on the same (agent, mode, chain) grain', async () => {
    const { orgId, agentId, walletSetId, pool } = await setupAgentFixture(store, 'idempotent');

    await recordProvisionedWallet(pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_first', address: '0xeee0000000000000000000000000000000eeee', refId: 'ref_first',
      walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    // A second provisioning attempt for the same grain must not create a
    // second row or overwrite the first -- ON CONFLICT DO NOTHING.
    await recordProvisionedWallet(pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_second', address: '0xfff0000000000000000000000000000000ffff', refId: 'ref_second',
      walletSetId, circleBlockchain: 'ARC-TESTNET',
    });

    const rows = await pool.query(
      'SELECT circle_wallet_id FROM agent_chain_wallets WHERE agent_id = $1 AND chain = $2',
      [agentId, 'arc'],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.circle_wallet_id).toBe('w_first');
  });

  it('findAgentWallet returns null when no active wallet exists', async () => {
    const { agentId, pool } = await setupAgentFixture(store, 'notfound');
    const wallet = await findAgentWallet(pool, agentId, 'test', 'arc');
    expect(wallet).toBeNull();
  });

  it('findAgentWallet does not return a swept wallet', async () => {
    const { orgId, agentId, walletSetId, pool } = await setupAgentFixture(store, 'swept');
    await recordProvisionedWallet(pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_swept', address: '0x1230000000000000000000000000000000abcd', refId: 'ref_swept',
      walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    await pool.query("UPDATE agent_chain_wallets SET status = 'swept' WHERE agent_id = $1", [agentId]);

    const wallet = await findAgentWallet(pool, agentId, 'test', 'arc');
    expect(wallet).toBeNull();
  });
});

describe('Arc gas headroom', () => {
  it('reports zero spendable rather than negative when balance is below the reserve', async () => {
    const spendable = await readSpendableMicros(
      { address: '0xabc', chain: 'arc' } as AgentChainWalletRow,
      500_000n,                                   // $0.50 reserve
      { nativeBalanceMicros: async () => 200_000n }, // $0.20 held
    );
    expect(spendable).toBe(0n);   // must clamp, never go negative
  });

  it('does not treat a truncated ERC-20 zero as an empty wallet', async () => {
    // Arc's ERC-20 view truncates: balanceOf can read 0 while native is
    // non-zero. Gas decisions must use the native read.
    const spendable = await readSpendableMicros(
      { address: '0xabc', chain: 'arc' } as AgentChainWalletRow,
      0n,
      { nativeBalanceMicros: async () => 1n },   // sub-cent, non-zero
    );
    expect(spendable).toBe(1n);
  });

  it('is exactly zero when balance equals the reserve', async () => {
    const spendable = await readSpendableMicros(
      { address: '0xabc', chain: 'arc' } as AgentChainWalletRow,
      500_000n,
      { nativeBalanceMicros: async () => 500_000n },
    );
    expect(spendable).toBe(0n);
  });
});
