import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { setAllocation } from '../../src/engines/payments/allocations.js';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import { revokeAgent, sweepAmountMicros } from '../../src/engines/payments/agent-revocation.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

function fakeProvider(
  overrides: Partial<CircleTreasuryProvider> = {},
): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: vi.fn(),
    getGatewayBalance: vi.fn(),
    getWalletBalances: vi.fn(),
    health: vi.fn(),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation: vi.fn(),
    executePermit2Transaction: vi.fn(),
    transferWallet: vi.fn(),
    ...overrides,
  };
}

describe('sweepAmountMicros', () => {
  it('leaves gas behind so the sweep itself can execute', () => {
    // Sweeping costs gas, and on Arc gas IS the USDC balance. Sweeping the
    // full balance would make the sweep transaction itself unpayable.
    const amount = sweepAmountMicros({ balanceMicros: 5_000_000n, gasNeededMicros: 100_000n });
    expect(amount).toBe(4_900_000n);
  });

  it('does not attempt a sweep when the balance cannot cover gas', () => {
    const amount = sweepAmountMicros({ balanceMicros: 50_000n, gasNeededMicros: 100_000n });
    expect(amount).toBe(0n);
  });

  it('clamps at zero rather than going negative', () => {
    const amount = sweepAmountMicros({ balanceMicros: 0n, gasNeededMicros: 100_000n });
    expect(amount).toBe(0n);
  });
});

describe('revokeAgent', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  async function setupRevocationFixture(suffix: string) {
    const orgId = `org_revoke_${suffix}`;
    const teamId = `team_revoke_${suffix}`;
    const agentId = `agt_revoke_${suffix}`;
    const walletSetId = `ws_revoke_${suffix}`;

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Revocation Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      agentId, orgId, teamId, 'Revocation Agent',
    ]);
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Revocation wallet set', 'usr_revoke_test')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await store.pool.query(
      `INSERT INTO circle_chain_wallets (
         id, org_id, wallet_set_id, mode, chain, circle_blockchain, circle_wallet_id, address
       ) VALUES ($1, $2, $3, 'test', 'arc', 'ARC-TESTNET', 'circle_treasury_revoke', $4)`,
      [`cwallet_revoke_${suffix}`, orgId, walletSetId, `0xtreasuryrevoke${suffix}0000000000000000000000`.slice(0, 42)],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: `w_revoke_${suffix}`,
      address: `0xagentrevoke${suffix}00000000000000000000000`.slice(0, 42),
      refId: `ref_revoke_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    await setAllocation(store.pool, fakeProvider({
      getGatewayBalance: () => Promise.resolve({
        available: '100.00', domain: 26, providerMode: 'test', total: '100.00', withdrawable: '100.00', withdrawing: '0',
      }),
    }), {
      orgId, agentId, mode: 'test', chain: 'arc', allocatedUsdc: '10.00', createdBy: 'usr_1',
    });

    return { orgId, agentId, pool: store.pool };
  }

  it('marks the allocation revoked, enqueues a sweep job, and writes an audit event', async () => {
    const { orgId, agentId, pool } = await setupRevocationFixture('revoke');

    await revokeAgent(pool, { actorId: 'usr_operator', role: 'admin' }, orgId, agentId, 'test', 'incident');

    const agent = await pool.query<{ status: string }>('SELECT status FROM agents WHERE id = $1', [agentId]);
    expect(agent.rows[0]?.status).toBe('suspended');

    const allocation = await pool.query<{ status: string }>(
      'SELECT status FROM agent_allocations WHERE agent_id = $1', [agentId],
    );
    expect(allocation.rows[0]?.status).toBe('revoked');

    const job = await pool.query<{ chain: string; status: string }>(
      "SELECT chain, status FROM circle_provider_jobs WHERE org_id = $1 AND job_type = 'agent_wallet.sweep'",
      [orgId],
    );
    expect(job.rows).toHaveLength(1);
    expect(job.rows[0]).toEqual({ chain: 'arc', status: 'queued' });

    const events = await pool.query(
      "SELECT 1 FROM audit_events WHERE org_id = $1 AND event_type = 'agent.revoked'",
      [orgId],
    );
    expect(events.rowCount).toBe(1);
  });

  it('blocks runtime auth immediately once suspended', async () => {
    const { orgId, agentId, pool } = await setupRevocationFixture('authblock');
    await pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
      `team_revoke_authblock`, orgId, 'Default Team',
    ]);
    await revokeAgent(pool, { actorId: 'usr_operator', role: 'admin' }, orgId, agentId, 'test', 'incident');

    const activeAgents = await pool.query(
      "SELECT 1 FROM agents WHERE id = $1 AND status = 'active'", [agentId],
    );
    expect(activeAgents.rowCount).toBe(0);
  });
});

describe('agent_wallet.sweep job processing (real transfer path)', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  it('sweeps the agent wallet back to treasury and marks it swept', async () => {
    const orgId = 'org_sweep_job';
    const teamId = 'team_sweep_job';
    const agentId = 'agt_sweep_job';
    const walletSetId = 'ws_sweep_job';
    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Sweep Job Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      agentId, orgId, teamId, 'Sweep Job Agent',
    ]);
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Sweep wallet set', 'usr_sweep_test')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await store.pool.query(
      `INSERT INTO circle_chain_wallets (
         id, org_id, wallet_set_id, mode, chain, circle_blockchain, circle_wallet_id, address
       ) VALUES ($1, $2, $3, 'test', 'arc', 'ARC-TESTNET', 'circle_treasury_sweep_job', '0xtreasurysweepjob000000000000000000000001')`,
      ['cwallet_sweep_job', orgId, walletSetId],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_sweep_job', address: '0xagentsweepjob0000000000000000000000000001',
      refId: 'ref_sweep_job', walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    await store.pool.query(
      `INSERT INTO circle_provider_jobs (id, org_id, mode, job_type, chain, status, metadata, created_by)
       VALUES ('cjob_sweep_job', $1, 'test', 'agent_wallet.sweep', 'arc', 'queued', $2::jsonb, 'usr_1')`,
      [orgId, JSON.stringify({ agent_id: agentId })],
    );

    const nativeBalanceMicros = vi.fn(() => Promise.resolve(5_000_000n));
    const transferWallet = vi.fn(() => Promise.resolve({ amountMicros: '4900000', transactionId: '0xsweeptx' }));
    const { processAgentWalletSweepJob } = await import('../../src/engines/payments/agent-revocation.js');
    await processAgentWalletSweepJob(store.pool, 'cjob_sweep_job', fakeProvider({ transferWallet }), {
      nativeBalanceMicros, gasNeededMicros: 100_000n,
    });

    expect(transferWallet).toHaveBeenCalledWith(expect.objectContaining({
      amountMicros: 4_900_000n,
      chain: 'arc',
      destinationAddress: '0xtreasurysweepjob000000000000000000000001',
      mode: 'test',
      sourceAddress: '0xagentsweepjob0000000000000000000000000001',
    }));

    const wallet = await store.pool.query<{ status: string; swept_at: Date | null }>(
      "SELECT status, swept_at FROM agent_chain_wallets WHERE agent_id = $1", [agentId],
    );
    expect(wallet.rows[0]?.status).toBe('swept');
    expect(wallet.rows[0]?.swept_at).not.toBeNull();

    const job = await store.pool.query<{ status: string; provider_ref: string | null }>(
      "SELECT status, provider_ref FROM circle_provider_jobs WHERE id = 'cjob_sweep_job'",
    );
    expect(job.rows[0]?.status).toBe('complete');
    expect(job.rows[0]?.provider_ref).toBe('0xsweeptx');
  });

  it('marks the wallet swept without a transfer when the balance cannot cover gas', async () => {
    const orgId = 'org_sweep_dust';
    const teamId = 'team_sweep_dust';
    const agentId = 'agt_sweep_dust';
    const walletSetId = 'ws_sweep_dust';
    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Sweep Dust Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      agentId, orgId, teamId, 'Sweep Dust Agent',
    ]);
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Sweep dust wallet set', 'usr_sweep_test')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await store.pool.query(
      `INSERT INTO circle_chain_wallets (
         id, org_id, wallet_set_id, mode, chain, circle_blockchain, circle_wallet_id, address
       ) VALUES ($1, $2, $3, 'test', 'arc', 'ARC-TESTNET', 'circle_treasury_sweep_dust', '0xtreasurysweepdust00000000000000000000001')`,
      ['cwallet_sweep_dust', orgId, walletSetId],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_sweep_dust', address: '0xagentsweepdust000000000000000000000000001',
      refId: 'ref_sweep_dust', walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    await store.pool.query(
      `INSERT INTO circle_provider_jobs (id, org_id, mode, job_type, chain, status, metadata, created_by)
       VALUES ('cjob_sweep_dust', $1, 'test', 'agent_wallet.sweep', 'arc', 'queued', $2::jsonb, 'usr_1')`,
      [orgId, JSON.stringify({ agent_id: agentId })],
    );

    const nativeBalanceMicros = vi.fn(() => Promise.resolve(50_000n));
    const transferWallet = vi.fn(() => Promise.resolve({ amountMicros: '0', transactionId: 'unused' }));
    const { processAgentWalletSweepJob } = await import('../../src/engines/payments/agent-revocation.js');
    await processAgentWalletSweepJob(store.pool, 'cjob_sweep_dust', fakeProvider({ transferWallet }), {
      nativeBalanceMicros, gasNeededMicros: 100_000n,
    });

    expect(transferWallet).not.toHaveBeenCalled();

    const wallet = await store.pool.query<{ status: string; swept_at: Date | null }>(
      "SELECT status, swept_at FROM agent_chain_wallets WHERE agent_id = $1", [agentId],
    );
    expect(wallet.rows[0]?.status).toBe('swept');
    expect(wallet.rows[0]?.swept_at).not.toBeNull();

    const job = await store.pool.query<{ status: string }>(
      "SELECT status FROM circle_provider_jobs WHERE id = 'cjob_sweep_dust'",
    );
    expect(job.rows[0]?.status).toBe('complete');
  });
});
