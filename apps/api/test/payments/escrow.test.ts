import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import type { EscrowReceiptLog } from '../../src/engines/payments/escrow-contract.js';
import { createEscrowJob } from '../../src/engines/payments/escrow.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

const ESCROW_ADDRESS = '0x31C050d9D20504c4E11b2A894051d8181B14e0F5';
const ARC_USDC = '0x3600000000000000000000000000000000000000';

// keccak256("JobCreated(uint256,address,address,address,uint48,address)") --
// the same hardcoded topic escrow-contract.test.ts uses, so this fixture is
// a real log shape rather than a round-trip through viem's own encoder.
const JOB_CREATED_TOPIC = '0x834a72f190664642fdcd90aae4371388adece09d5bbc96f411c84fc61b3e31aa';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

/** A real JobCreated log: jobId/client/provider indexed, the rest in `data`. */
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

/** Every executePermit2Transaction call, tagged with the function it sent. */
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

/** Addresses must be real hex -- the engine hands them straight to Circle. */
function hexAddress(prefix: string, suffix: string): string {
  const seed = [...suffix].map((c) => c.charCodeAt(0).toString(16)).join('');
  return `0x${`${prefix}${seed}`.padEnd(40, '0').slice(0, 40)}`;
}

describe('escrow lifecycle engine', () => {
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

  /**
   * An org with a client agent that holds a wallet on Arc, plus a provider.
   * `providerInFleet` decides whether the provider is one of our own agents
   * (a wallet the platform holds a key for) or an outside address.
   */
  async function seedEscrowOrg(
    suffix: string,
    options: { readonly providerInFleet?: boolean } = {},
  ): Promise<EscrowFixture> {
    const orgId = `org_escrow_${suffix}`;
    const teamId = `team_escrow_${suffix}`;
    const clientAgentId = `agt_escrow_client_${suffix}`;
    const providerAgentId = `agt_escrow_provider_${suffix}`;
    const walletSetId = `ws_escrow_${suffix}`;
    const sourceId = `paysrc_escrow_${suffix}`;
    const clientAddress = hexAddress('c11e', suffix);
    const providerAddress = hexAddress('9201', suffix);

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Escrow Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      clientAgentId, orgId, teamId, 'Client Agent',
    ]);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      providerAgentId, orgId, teamId, 'Provider Agent',
    ]);
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Escrow wallet set', 'usr_1')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: clientAgentId, mode: 'test', chain: 'arc',
      circleWalletId: `w_escrow_client_${suffix}`, address: clientAddress,
      refId: `ref_escrow_client_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    if (options.providerInFleet === true) {
      await recordProvisionedWallet(store.pool, {
        orgId, agentId: providerAgentId, mode: 'test', chain: 'arc',
        circleWalletId: `w_escrow_provider_${suffix}`, address: providerAddress,
        refId: `ref_escrow_provider_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
      });
    }
    await store.pool.query(
      `INSERT INTO payment_sources (id, org_id, source_type, provider, rail, chain, label, created_by)
       VALUES ($1, $2, 'dedicated_wallet', 'circle_wallets', 'exact_arc', 'arc', 'Escrow source', 'usr_1')`,
      [sourceId, orgId],
    );

    return {
      orgId, clientAgentId, clientAddress, providerAgentId, providerAddress, sourceId,
      expiresAt: new Date(Date.now() + 86_400_000),
    };
  }

  // escrow_jobs is UNIQUE (chain, escrow_address, onchain_job_id), so every
  // fixture job must claim a distinct on-chain id -- exactly as two real jobs
  // on the same escrow would.
  // Starts above the ids tests name explicitly, so a default never collides
  // with one an assertion depends on.
  let nextOnchainJobId = 100n;

  function createInput(fixture: EscrowFixture, overrides: Record<string, unknown> = {}) {
    nextOnchainJobId += 1n;
    return {
      orgId: fixture.orgId,
      clientAgentId: fixture.clientAgentId,
      providerAddress: fixture.providerAddress,
      chain: 'arc' as const,
      mode: 'test' as const,
      budgetUsdc: '0.02',
      expiresAt: fixture.expiresAt,
      createdBy: 'usr_1',
      readReceiptLogs: (() => {
        const jobId = nextOnchainJobId;
        return () => Promise.resolve([jobCreatedLog(jobId)]);
      })(),
      ...overrides,
    };
  }

  it('refuses escrow for sub-cent payments', async () => {
    // Five-plus state-changing txs per job -- orchestration cost dominates.
    const fixture = await seedEscrowOrg('subcent');
    await expect(
      createEscrowJob(store.pool, fakeProvider(), createInput(fixture, { budgetUsdc: '0.005' })),
    ).rejects.toThrow(/escrow_uneconomic_for_amount/);
  });

  it('sends nothing on-chain when the budget is refused', async () => {
    const fixture = await seedEscrowOrg('subcentdry');
    const executePermit2Transaction = recordingExecutor();
    await expect(
      createEscrowJob(store.pool, fakeProvider({ executePermit2Transaction }), createInput(fixture, { budgetUsdc: '0.009' })),
    ).rejects.toThrow(/escrow_uneconomic_for_amount/);
    expect(executePermit2Transaction).not.toHaveBeenCalled();
  });

  it('records escrow_mode 2 when evaluator equals client', async () => {
    const fixture = await seedEscrowOrg('mode2');
    const job = await createEscrowJob(store.pool, fakeProvider(), createInput(fixture));

    // No neutral third party evaluates this job -- the client does. Recorded
    // so claim discipline is enforced from data rather than memory.
    expect(job.escrowMode).toBe(2);
    expect(job.evaluatorAddress.toLowerCase()).toBe(fixture.clientAddress.toLowerCase());
  });

  it('records escrow_mode 3 for a distinct evaluator', async () => {
    const fixture = await seedEscrowOrg('mode3');
    const evaluatorAddress = hexAddress('e7a1', 'mode3');
    const job = await createEscrowJob(
      store.pool,
      fakeProvider(),
      createInput(fixture, { evaluatorAddress }),
    );

    expect(job.escrowMode).toBe(3);
    expect(job.evaluatorAddress).toBe(evaluatorAddress);
  });

  it('stores the on-chain job id parsed from the receipt', async () => {
    const fixture = await seedEscrowOrg('jobid');
    const executePermit2Transaction = recordingExecutor();
    const job = await createEscrowJob(
      store.pool,
      fakeProvider({ executePermit2Transaction }),
      createInput(fixture, { readReceiptLogs: () => Promise.resolve([jobCreatedLog(42n)]) }),
    );

    expect(job.onchainJobId).toBe('42');
    expect(job.state).toBe('open');
    expect(job.createTxHash).toBe('0xcreateJobtx');

    const row = await store.pool.query<{ onchain_job_id: string; state: string; escrow_address: string }>(
      'SELECT onchain_job_id, state, escrow_address FROM escrow_jobs WHERE id = $1', [job.id],
    );
    expect(row.rows[0]).toEqual({ onchain_job_id: '42', state: 'open', escrow_address: ESCROW_ADDRESS });

    const call = (executePermit2Transaction.mock.calls as unknown[][])[0]?.[0] as {
      abiFunctionSignature?: string;
      contractAddress?: string;
      senderAddress?: string;
    };
    expect(call.abiFunctionSignature).toBe('createJob(address,address,uint48,string,address,uint256)');
    // Targets the escrow proxy, not Permit2 (the primitive's default).
    expect(call.contractAddress).toBe(ESCROW_ADDRESS);
    // Only the client may fund the job it created, so createJob must be sent
    // from the client's own wallet.
    expect(call.senderAddress).toBe(fixture.clientAddress);
  });

  it('refuses to record a job whose id is absent from the receipt', async () => {
    // A row with no on-chain job id can never be linked back to the chain,
    // and every later call keys off that id. Better to fail loudly.
    const fixture = await seedEscrowOrg('noid');
    await expect(
      createEscrowJob(store.pool, fakeProvider(), createInput(fixture, {
        // The right event, from the wrong contract.
        readReceiptLogs: () => Promise.resolve([jobCreatedLog(42n, '0xdead000000000000000000000000000000000001')]),
      })),
    ).rejects.toThrow(/escrow_job_id_not_in_receipt/);

    const rows = await store.pool.query('SELECT id FROM escrow_jobs WHERE org_id = $1', [fixture.orgId]);
    expect(rows.rowCount).toBe(0);
  });

  it('refuses chains where no escrow is deployed', async () => {
    const fixture = await seedEscrowOrg('nochain');
    await expect(
      createEscrowJob(store.pool, fakeProvider(), createInput(fixture, { chain: 'polygon' })),
    ).rejects.toThrow(/escrow_not_deployed_on_chain/);
  });

  it('records the token the escrow will actually accept', async () => {
    const fixture = await seedEscrowOrg('token');
    const job = await createEscrowJob(store.pool, fakeProvider(), createInput(fixture));
    expect(job.tokenAddress).toBe(ARC_USDC);
  });
});
