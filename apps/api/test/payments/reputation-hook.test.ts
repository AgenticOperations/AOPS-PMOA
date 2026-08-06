import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import type { EscrowReceiptLog } from '../../src/engines/payments/escrow-contract.js';
import { applyEscrowStateChange, createEscrowJob, fundEscrowJob } from '../../src/engines/payments/escrow.js';
import {
  onEscrowCompleted,
  writeReputation,
  type ReputationRegistryClient,
} from '../../src/engines/payments/reputation-hook.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

const ESCROW_ADDRESS = '0x31C050d9D20504c4E11b2A894051d8181B14e0F5';

// Same fixture log used by escrow.test.ts -- keccak256("JobCreated(uint256,address,address,address,uint48,address)").
const JOB_CREATED_TOPIC = '0x834a72f190664642fdcd90aae4371388adece09d5bbc96f411c84fc61b3e31aa';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function jobCreatedLog(jobId: bigint, address = ESCROW_ADDRESS): EscrowReceiptLog {
  return {
    address,
    topics: [
      JOB_CREATED_TOPIC,
      `0x${word(jobId.toString(16))}`,
      `0x${word('0x1111111111111111111111111111111111111111')}`,
      `0x${word('0x2222222222222222222222222222222222222222')}`,
    ],
    data: `0x${word('0x3333333333333333333333333333333333333333')}${word('68e7f100')}${word('0')}`,
  };
}

const DELIVERABLE_HASH = `0x${'ab'.repeat(32)}`;

function recordingExecutor() {
  return vi.fn((input: { readonly abiFunctionSignature: string }) =>
    Promise.resolve({ txHash: `0x${input.abiFunctionSignature.split('(')[0]}tx` }));
}

function fakeProvider(overrides: Partial<CircleTreasuryProvider> = {}): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: vi.fn(),
    executePermit2Transaction: recordingExecutor(),
    getGatewayBalance: vi.fn(),
    getWalletBalances: vi.fn(),
    health: vi.fn(),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation: vi.fn(),
    transferWallet: vi.fn(),
    ...overrides,
  };
}

function hexAddress(prefix: string, suffix: string): string {
  const seed = [...suffix].map((c) => c.charCodeAt(0).toString(16)).join('');
  return `0x${`${prefix}${seed}`.padEnd(40, '0').slice(0, 40)}`;
}

function noopRegistry(): ReputationRegistryClient {
  return { writeFeedback: vi.fn(() => Promise.resolve({ txHash: '0xfeedbacktx' })) };
}

describe('payment-gated reputation', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  type EscrowFixture = {
    readonly orgId: string;
    readonly clientAgentId: string;
    readonly clientAddress: string;
    readonly providerAgentId: string;
    readonly providerAddress: string;
    readonly sourceId: string;
    readonly expiresAt: Date;
  };

  // Mirrors escrow.test.ts's seedEscrowOrg. Duplicated deliberately -- this
  // file is self-contained, matching how escrow.test.ts does not import
  // fixtures from elsewhere either.
  async function seedEscrowOrg(suffix: string): Promise<EscrowFixture> {
    const orgId = `org_rephook_${suffix}`;
    const teamId = `team_rephook_${suffix}`;
    const clientAgentId = `agt_rephook_client_${suffix}`;
    const providerAgentId = `agt_rephook_provider_${suffix}`;
    const walletSetId = `ws_rephook_${suffix}`;
    const sourceId = `paysrc_rephook_${suffix}`;
    const clientAddress = hexAddress('c11e', suffix);
    const providerAddress = hexAddress('9201', suffix);

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Reputation Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      clientAgentId, orgId, teamId, 'Client Agent',
    ]);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      providerAgentId, orgId, teamId, 'Provider Agent',
    ]);
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Reputation wallet set', 'usr_1')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: clientAgentId, mode: 'test', chain: 'arc',
      circleWalletId: `w_rephook_client_${suffix}`, address: clientAddress,
      refId: `ref_rephook_client_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    // The provider is one of OUR agents -- required both for evaluator=client
    // mode-2 completion to be sendable at all, and for reputation to have an
    // agent_id to attach to.
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: providerAgentId, mode: 'test', chain: 'arc',
      circleWalletId: `w_rephook_provider_${suffix}`, address: providerAddress,
      refId: `ref_rephook_provider_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    await store.pool.query(
      `INSERT INTO payment_sources (id, org_id, source_type, provider, rail, chain, label, created_by)
       VALUES ($1, $2, 'dedicated_wallet', 'circle_wallets', 'exact_arc', 'arc', 'Reputation source', 'usr_1')`,
      [sourceId, orgId],
    );

    return {
      orgId, clientAgentId, clientAddress, providerAgentId, providerAddress, sourceId,
      expiresAt: new Date(Date.now() + 86_400_000),
    };
  }

  let nextOnchainJobId = 200n;

  /** Drives a fresh escrow job all the way through to 'completed'. */
  async function completedJob(fixture: EscrowFixture) {
    const jobId = (nextOnchainJobId += 1n);
    const created = await createEscrowJob(store.pool, fakeProvider(), {
      orgId: fixture.orgId,
      clientAgentId: fixture.clientAgentId,
      providerAddress: fixture.providerAddress,
      chain: 'arc',
      mode: 'test',
      budgetUsdc: '0.02',
      expiresAt: fixture.expiresAt,
      createdBy: 'usr_1',
      readReceiptLogs: () => Promise.resolve([jobCreatedLog(jobId)]),
    });
    const funded = await fundEscrowJob(store.pool, fakeProvider(), { escrowJobId: created.id });
    const submitted = await applyEscrowStateChange(store.pool, fakeProvider(), {
      escrowJobId: funded.id, next: 'submitted', deliverableHash: DELIVERABLE_HASH,
    });
    // Use a registry that never throws for the state-machine drive itself --
    // individual tests below install their own registry via onEscrowCompleted
    // directly, so this transition's own (already-swallowed) hook firing must
    // not interfere with what a test asserts next.
    return applyEscrowStateChange(store.pool, fakeProvider(), { escrowJobId: submitted.id, next: 'completed' });
  }

  it('writes feedback when an escrow job genuinely completes', async () => {
    const fixture = await seedEscrowOrg('completes');
    const job = await completedJob(fixture);

    await onEscrowCompleted(store.pool, { jobId: job.id }, noopRegistry());

    const events = await store.pool.query<{ escrow_job_id: string; score: number }>(
      'SELECT escrow_job_id, score FROM agent_reputation_events WHERE agent_id = $1', [fixture.providerAgentId],
    );
    expect(events.rowCount).toBe(1);
    expect(events.rows[0]?.escrow_job_id).toBe(job.id);
    expect(events.rows[0]?.score).toBe(100);
  });

  it('refuses to write feedback with no escrow job -- rejected at the database level', async () => {
    const fixture = await seedEscrowOrg('noescrow');
    await expect(
      writeReputation(store.pool, { orgId: fixture.orgId, agentId: fixture.providerAgentId, escrowJobId: null, score: 100 }),
    ).rejects.toThrow();
  });

  /** Drives a fresh job to 'submitted' -- the only state rejected/expired are reachable from. */
  async function submittedJobFor(fixture: EscrowFixture) {
    const jobId = (nextOnchainJobId += 1n);
    const created = await createEscrowJob(store.pool, fakeProvider(), {
      orgId: fixture.orgId, clientAgentId: fixture.clientAgentId, providerAddress: fixture.providerAddress,
      chain: 'arc', mode: 'test', budgetUsdc: '0.02', expiresAt: fixture.expiresAt, createdBy: 'usr_1',
      readReceiptLogs: () => Promise.resolve([jobCreatedLog(jobId)]),
    });
    const funded = await fundEscrowJob(store.pool, fakeProvider(), { escrowJobId: created.id });
    return applyEscrowStateChange(store.pool, fakeProvider(), {
      escrowJobId: funded.id, next: 'submitted', deliverableHash: DELIVERABLE_HASH,
    });
  }

  it('refuses to write feedback for a job that was rejected', async () => {
    const fixture = await seedEscrowOrg('rejected');
    const submitted = await submittedJobFor(fixture);
    const rejected = await applyEscrowStateChange(store.pool, fakeProvider(), { escrowJobId: submitted.id, next: 'rejected' });

    await expect(onEscrowCompleted(store.pool, { jobId: rejected.id }, noopRegistry()))
      .rejects.toThrow(/not_completed/);
  });

  it('refuses to write feedback for a job that merely expired', async () => {
    const fixture = await seedEscrowOrg('expired');
    const submitted = await submittedJobFor(fixture);
    const expired = await applyEscrowStateChange(store.pool, fakeProvider(), { escrowJobId: submitted.id, next: 'expired' });

    // expired means "delivered but never evaluated" -- NOT a proven completion.
    await expect(onEscrowCompleted(store.pool, { jobId: expired.id }, noopRegistry()))
      .rejects.toThrow(/not_completed/);
  });

  it('writes at most one feedback per job', async () => {
    const fixture = await seedEscrowOrg('atmostone');
    const job = await completedJob(fixture);

    await onEscrowCompleted(store.pool, { jobId: job.id }, noopRegistry());
    await onEscrowCompleted(store.pool, { jobId: job.id }, noopRegistry());

    const events = await store.pool.query('SELECT 1 FROM agent_reputation_events WHERE escrow_job_id = $1', [job.id]);
    expect(events.rowCount).toBe(1);
  });

  it('is a no-op when the provider is not one of this platform\'s own agents', async () => {
    // A real external provider can never reach 'completed' through THIS
    // engine -- submit() must be sent from job.provider's own wallet, which
    // we hold only for our own agents. So this forces the row into
    // 'completed' directly, isolating onEscrowCompleted's own
    // resolveProviderAgentId behavior from the (separately tested) state
    // machine that gets a job there for real.
    const fixture = await seedEscrowOrg('external');
    const externalProviderAddress = hexAddress('dead', 'external');
    const jobId = (nextOnchainJobId += 1n);
    const created = await createEscrowJob(store.pool, fakeProvider(), {
      orgId: fixture.orgId, clientAgentId: fixture.clientAgentId, providerAddress: externalProviderAddress,
      chain: 'arc', mode: 'test', budgetUsdc: '0.02', expiresAt: fixture.expiresAt, createdBy: 'usr_1',
      readReceiptLogs: () => Promise.resolve([jobCreatedLog(jobId)]),
    });
    await store.pool.query("UPDATE escrow_jobs SET state = 'completed' WHERE id = $1", [created.id]);

    const registry = noopRegistry();
    await onEscrowCompleted(store.pool, { jobId: created.id }, registry);

    const events = await store.pool.query('SELECT 1 FROM agent_reputation_events WHERE escrow_job_id = $1', [created.id]);
    expect(events.rowCount).toBe(0);
    expect(registry.writeFeedback).not.toHaveBeenCalled();
  });

  /**
   * A job forced straight to 'completed' via SQL rather than through
   * applyEscrowStateChange -- so the escrow.ts auto-fire wiring (tested
   * separately below) never runs and consumes the one-feedback-per-job slot
   * before the test gets a chance to control the registry itself.
   */
  async function directlyCompletedJob(fixture: EscrowFixture) {
    const jobId = (nextOnchainJobId += 1n);
    const created = await createEscrowJob(store.pool, fakeProvider(), {
      orgId: fixture.orgId, clientAgentId: fixture.clientAgentId, providerAddress: fixture.providerAddress,
      chain: 'arc', mode: 'test', budgetUsdc: '0.02', expiresAt: fixture.expiresAt, createdBy: 'usr_1',
      readReceiptLogs: () => Promise.resolve([jobCreatedLog(jobId)]),
    });
    await store.pool.query("UPDATE escrow_jobs SET state = 'completed' WHERE id = $1", [created.id]);
    return created;
  }

  it('does not fail the escrow completion path when the on-chain registry write fails', async () => {
    // The spec flags hooks as a footgun -- they run in the state-change
    // path. A reputation failure must never revert a settled payment. To
    // actually exercise the on-chain attempt (not just the DB write), this
    // agent needs a REGISTERED identity first -- otherwise onEscrowCompleted
    // returns before ever calling the registry.
    const fixture = await seedEscrowOrg('registryfails');
    await store.pool.query(
      `INSERT INTO agent_onchain_identities (id, org_id, agent_id, mode, chain, registry_address, token_id, agent_uri, status)
       VALUES ('agtid_registryfails', $1, $2, 'test', 'arc', '0x8004A818BFB912233c491871b3d84c89A494BD9e', '7', 'https://example.test/agent.json', 'registered')`,
      [fixture.orgId, fixture.providerAgentId],
    );
    const job = await directlyCompletedJob(fixture);

    const failing: ReputationRegistryClient = {
      writeFeedback: () => Promise.reject(new Error('registry down')),
    };
    await expect(onEscrowCompleted(store.pool, { jobId: job.id }, failing)).resolves.not.toThrow();

    // The DB-level earned-reputation record still exists even though the
    // on-chain broadcast failed.
    const events = await store.pool.query<{ feedback_tx_hash: string | null }>(
      'SELECT feedback_tx_hash FROM agent_reputation_events WHERE escrow_job_id = $1', [job.id],
    );
    expect(events.rowCount).toBe(1);
    expect(events.rows[0]?.feedback_tx_hash).toBeNull();
  });

  it('broadcasts on-chain feedback and records the tx hash when an identity is registered', async () => {
    const fixture = await seedEscrowOrg('broadcast');
    await store.pool.query(
      `INSERT INTO agent_onchain_identities (id, org_id, agent_id, mode, chain, registry_address, token_id, agent_uri, status)
       VALUES ('agtid_broadcast', $1, $2, 'test', 'arc', '0x8004A818BFB912233c491871b3d84c89A494BD9e', '9', 'https://example.test/agent.json', 'registered')`,
      [fixture.orgId, fixture.providerAgentId],
    );
    const job = await directlyCompletedJob(fixture);

    const writeFeedback = vi.fn((_input: Parameters<ReputationRegistryClient['writeFeedback']>[0]) =>
      Promise.resolve({ txHash: '0xfeedbacktx' }));
    await onEscrowCompleted(store.pool, { jobId: job.id }, { writeFeedback });

    expect(writeFeedback).toHaveBeenCalledTimes(1);
    expect(writeFeedback.mock.calls[0]?.[0]).toMatchObject({
      senderAddress: fixture.clientAddress,
      agentTokenId: '9',
      score: 100,
    });
    const events = await store.pool.query<{ feedback_tx_hash: string | null }>(
      'SELECT feedback_tx_hash FROM agent_reputation_events WHERE escrow_job_id = $1', [job.id],
    );
    expect(events.rows[0]?.feedback_tx_hash).toBe('0xfeedbacktx');
  });

  it('fires automatically from applyEscrowStateChange\'s completed transition', async () => {
    // Integration check: the wiring in escrow.ts, not just onEscrowCompleted
    // called directly.
    const fixture = await seedEscrowOrg('autofire');
    const job = await completedJob(fixture);

    const events = await store.pool.query(
      'SELECT 1 FROM agent_reputation_events WHERE escrow_job_id = $1', [job.id],
    );
    expect(events.rowCount).toBe(1);
  });
});
