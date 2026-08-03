import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import {
  enqueueAgentWalletProvisioning,
  findAgentWallet,
  nativeBalanceMicros,
  processAgentWalletCreateJob,
  recordProvisionedWallet,
  readSpendableMicros,
} from '../../src/engines/payments/agent-wallets.js';
import { setAgentPaymentAccess } from '../../src/engines/payments/store.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

function fakeProvider(createWallet: CircleTreasuryProvider['createWallet']): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet,
    createWalletSet: vi.fn(),
    getGatewayBalance: vi.fn(),
    getWalletBalances: vi.fn(),
    health: vi.fn(),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
  };
}

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

    const rows = await pool.query<{ circle_wallet_id: string }>(
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

describe('agent_wallet.create job processing', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  it('creates an independent wallet for an agent\'s first chain', async () => {
    const { orgId, agentId, pool } = await setupAgentFixture(store, 'job-first');
    await enqueueAgentWalletProvisioning(pool, {
      orgId, agentId, mode: 'test', chains: ['arc'], createdBy: 'usr_1',
    });
    const job = await pool.query<{ id: string }>(
      "SELECT id FROM circle_provider_jobs WHERE org_id = $1 AND job_type = 'agent_wallet.create'",
      [orgId],
    );

    const createWallet = vi.fn(() => Promise.resolve({ address: '0xfirst000000000000000000000000000000001', circleWalletId: 'w_first' }));
    await processAgentWalletCreateJob(pool, job.rows[0]!.id, fakeProvider(createWallet));

    // No prior wallet exists, so this must NOT ask the provider to derive.
    expect(createWallet).toHaveBeenCalledWith(expect.objectContaining({ chain: 'arc' }));
    const callArgs: unknown[] = createWallet.mock.calls[0] ?? [];
    expect((callArgs[0] as { deriveFromWalletId?: string }).deriveFromWalletId).toBeUndefined();

    const wallet = await findAgentWallet(pool, agentId, 'test', 'arc');
    expect(wallet?.address).toBe('0xfirst000000000000000000000000000000001');
    expect(wallet?.status).toBe('active');

    const jobStatus = await pool.query<{ status: string }>(
      'SELECT status FROM circle_provider_jobs WHERE id = $1', [job.rows[0]!.id],
    );
    expect(jobStatus.rows[0]?.status).toBe('complete');
  });

  it('derives the second chain from the first wallet, sharing one address', async () => {
    const { orgId, agentId, walletSetId, pool } = await setupAgentFixture(store, 'job-derive');

    // First chain, provisioned directly (bypassing the job path -- this
    // test is specifically about the SECOND chain's derive behavior).
    await recordProvisionedWallet(pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_primary', address: '0xshared00000000000000000000000000000001', refId: 'ref_primary',
      walletSetId, circleBlockchain: 'ARC-TESTNET',
    });

    await enqueueAgentWalletProvisioning(pool, {
      orgId, agentId, mode: 'test', chains: ['base'], createdBy: 'usr_1',
    });
    const job = await pool.query<{ id: string }>(
      "SELECT id FROM circle_provider_jobs WHERE org_id = $1 AND job_type = 'agent_wallet.create' AND chain = 'base'",
      [orgId],
    );

    const createWallet = vi.fn(() => Promise.resolve({ address: '0xshared00000000000000000000000000000001', circleWalletId: 'w_derived' }));
    await processAgentWalletCreateJob(pool, job.rows[0]!.id, fakeProvider(createWallet));

    // Must derive FROM the existing wallet's circle_wallet_id.
    expect(createWallet).toHaveBeenCalledWith(expect.objectContaining({ deriveFromWalletId: 'w_primary', chain: 'base' }));

    const baseWallet = await findAgentWallet(pool, agentId, 'test', 'base');
    expect(baseWallet?.address).toBe('0xshared00000000000000000000000000000001');

    const arcWallet = await findAgentWallet(pool, agentId, 'test', 'arc');
    expect(arcWallet?.address).toBe(baseWallet?.address);
  });

  it('marks the job failed, not thrown, when the provider errors', async () => {
    const { orgId, agentId, pool } = await setupAgentFixture(store, 'job-fail');
    await enqueueAgentWalletProvisioning(pool, {
      orgId, agentId, mode: 'test', chains: ['arc'], createdBy: 'usr_1',
    });
    const job = await pool.query<{ id: string }>(
      "SELECT id FROM circle_provider_jobs WHERE org_id = $1 AND job_type = 'agent_wallet.create'",
      [orgId],
    );

    const createWallet = vi.fn(() => Promise.reject(new Error('circle_wallet_missing_id_or_address')));
    await expect(processAgentWalletCreateJob(pool, job.rows[0]!.id, fakeProvider(createWallet))).resolves.not.toThrow();

    const jobStatus = await pool.query<{ status: string; error_code: string | null }>(
      'SELECT status, error_code FROM circle_provider_jobs WHERE id = $1', [job.rows[0]!.id],
    );
    expect(jobStatus.rows[0]?.status).toBe('failed');
    expect(jobStatus.rows[0]?.error_code).toBe('circle_wallet_missing_id_or_address');

    // Nothing partial gets recorded for a failed job.
    const wallet = await findAgentWallet(pool, agentId, 'test', 'arc');
    expect(wallet).toBeNull();
  });

  it('is a no-op for a job id that does not exist', async () => {
    const { pool } = await setupAgentFixture(store, 'job-missing');
    await expect(
      processAgentWalletCreateJob(pool, 'cjob_does_not_exist', fakeProvider(vi.fn())),
    ).resolves.not.toThrow();
  });
});

describe('dedicated_wallet_required triggers provisioning', () => {
  let store: PostgresTestStore;
  const operator = { actorId: 'usr_test_operator', role: 'operator' as const };

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  it('enqueues provisioning jobs when dedicated_wallet_required is set true', async () => {
    const { orgId, agentId, pool } = await setupAgentFixture(store, 'trigger-enable');

    await setAgentPaymentAccess(pool, operator, orgId, agentId, {
      status: 'active',
      allowed_rails: ['exact_arc', 'exact_base'],
      budget_usdc: '10.00',
      dedicated_wallet_required: true,
      per_request_cap_usdc: '5.00',
    });

    const jobs = await pool.query<{ chain: string }>(
      `SELECT chain FROM circle_provider_jobs
        WHERE org_id = $1 AND job_type = 'agent_wallet.create' ORDER BY chain`,
      [orgId],
    );
    expect(jobs.rows.map((r) => r.chain)).toEqual(['arc', 'base']);
  });

  it('does not enqueue anything when dedicated_wallet_required is false', async () => {
    const { orgId, agentId, pool } = await setupAgentFixture(store, 'trigger-disable');

    await setAgentPaymentAccess(pool, operator, orgId, agentId, {
      status: 'active',
      allowed_rails: ['exact_arc'],
      budget_usdc: '10.00',
      dedicated_wallet_required: false,
      per_request_cap_usdc: '5.00',
    });

    const jobs = await pool.query(
      "SELECT 1 FROM circle_provider_jobs WHERE org_id = $1 AND job_type = 'agent_wallet.create'",
      [orgId],
    );
    expect(jobs.rowCount).toBe(0);
  });

  it('does not re-enqueue a chain the agent already has an active wallet on', async () => {
    const { orgId, agentId, walletSetId, pool } = await setupAgentFixture(store, 'trigger-existing');

    await recordProvisionedWallet(pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_already', address: '0x9990000000000000000000000000000000abcd', refId: 'ref_already',
      walletSetId, circleBlockchain: 'ARC-TESTNET',
    });

    await setAgentPaymentAccess(pool, operator, orgId, agentId, {
      status: 'active',
      allowed_rails: ['exact_arc', 'exact_base'],
      budget_usdc: '10.00',
      dedicated_wallet_required: true,
      per_request_cap_usdc: '5.00',
    });

    // Only the missing chain (base) gets a job; arc already has an active wallet.
    const jobs = await pool.query<{ chain: string }>(
      `SELECT chain FROM circle_provider_jobs
        WHERE org_id = $1 AND job_type = 'agent_wallet.create' ORDER BY chain`,
      [orgId],
    );
    expect(jobs.rows.map((r) => r.chain)).toEqual(['base']);
  });

  it('does not enqueue a second time when called again with the same rails', async () => {
    const { orgId, agentId, pool } = await setupAgentFixture(store, 'trigger-idempotent');

    for (let i = 0; i < 2; i += 1) {
      await setAgentPaymentAccess(pool, operator, orgId, agentId, {
        status: 'active',
        allowed_rails: ['exact_arc'],
        budget_usdc: '10.00',
        dedicated_wallet_required: true,
        per_request_cap_usdc: '5.00',
      });
    }

    // A queued job from the first call already covers arc, so calling
    // setAgentPaymentAccess again (an operator adjusting budget, say)
    // must not pile up duplicate provisioning jobs.
    const jobs = await pool.query(
      "SELECT 1 FROM circle_provider_jobs WHERE org_id = $1 AND job_type = 'agent_wallet.create'",
      [orgId],
    );
    expect(jobs.rowCount).toBe(1);
  });
});

describe('Arc gas headroom', () => {
  it('reports zero spendable rather than negative when balance is below the reserve', async () => {
    const spendable = await readSpendableMicros(
      { address: '0xabc', chain: 'arc' },
      500_000n,                                   // $0.50 reserve
      { nativeBalanceMicros: () => Promise.resolve(200_000n) }, // $0.20 held
    );
    expect(spendable).toBe(0n);   // must clamp, never go negative
  });

  it('does not treat a truncated ERC-20 zero as an empty wallet', async () => {
    // Arc's ERC-20 view truncates: balanceOf can read 0 while native is
    // non-zero. Gas decisions must use the native read.
    const spendable = await readSpendableMicros(
      { address: '0xabc', chain: 'arc' },
      0n,
      { nativeBalanceMicros: () => Promise.resolve(1n) },   // sub-cent, non-zero
    );
    expect(spendable).toBe(1n);
  });

  it('is exactly zero when balance equals the reserve', async () => {
    const spendable = await readSpendableMicros(
      { address: '0xabc', chain: 'arc' },
      500_000n,
      { nativeBalanceMicros: () => Promise.resolve(500_000n) },
    );
    expect(spendable).toBe(0n);
  });
});

describe('nativeBalanceMicros', () => {
  const originalFetch = global.fetch;
  const originalRpcUrl = process.env.ARC_RPC_URL;

  beforeEach(() => {
    process.env.ARC_RPC_URL = 'https://rpc.testnet.arc.network';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalRpcUrl === undefined) delete process.env.ARC_RPC_URL;
    else process.env.ARC_RPC_URL = originalRpcUrl;
  });

  it('converts native wei to USDC micros -- 1e12 ratio confirmed by spike S6', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ result: '0x38d7ea4c68000' }), // 1_000_000_000_000_000 wei = 1000 micros
    })) as unknown as typeof fetch;

    const micros = await nativeBalanceMicros('0xabc', 'arc');
    expect(micros).toBe(1000n);
  });

  it('retries transient RPC failures rather than failing on the first error', async () => {
    // Spike S6 found Arc's public RPC failing ~56% of identical calls.
    let calls = 0;
    global.fetch = vi.fn(() => {
      calls += 1;
      if (calls < 3) return Promise.reject(new Error('transient RPC failure'));
      return Promise.resolve({ json: () => Promise.resolve({ result: '0xf4240' }) }); // 1_000_000 wei
    }) as unknown as typeof fetch;

    const micros = await nativeBalanceMicros('0xabc', 'arc');
    expect(micros).toBe(0n); // 1_000_000 wei / 1e12 truncates to 0 micros
    expect(calls).toBe(3);
  });

  it('throws rather than silently returning zero once retries are exhausted', async () => {
    // A coerced-zero on a genuinely failed read would reject valid
    // payments and could trigger a spurious top-up -- must fail loudly.
    global.fetch = vi.fn(() => Promise.reject(new Error('rpc down')));

    await expect(nativeBalanceMicros('0xabc', 'arc')).rejects.toThrow('agent_wallet_balance_unavailable');
  });

  it('throws for a chain with no configured RPC URL', async () => {
    await expect(nativeBalanceMicros('0xabc', 'base')).rejects.toThrow('agent_wallet_balance_rpc_not_configured:base');
  });
});
