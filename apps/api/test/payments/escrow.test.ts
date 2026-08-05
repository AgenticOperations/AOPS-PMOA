import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import type { EscrowReceiptLog } from '../../src/engines/payments/escrow-contract.js';
import {
  applyEscrowStateChange,
  createEscrowJob,
  fundEscrowJob,
  listEscrowLivenessRisks,
} from '../../src/engines/payments/escrow.js';
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

/** The bytes32 a submit() carries. Opaque to the engine; only recorded. */
const DELIVERABLE_HASH = `0x${'ab'.repeat(32)}`;

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

  // ---------------------------------------------------------------------
  // Funding
  // ---------------------------------------------------------------------

  /**
   * An open job on Arc with a 0.02 USDC budget -- 20000 in the token's own
   * 6-decimal base units, which is the exact number every funding assertion
   * below turns on. Created through the engine, so the row under test is a
   * real one rather than a hand-written fixture.
   */
  async function openJob(suffix: string, options: { readonly providerInFleet?: boolean } = {}) {
    const fixture = await seedEscrowOrg(suffix, options);
    const job = await createEscrowJob(store.pool, fakeProvider(), createInput(fixture));
    return { fixture, job };
  }

  type ExecuteCall = {
    readonly abiFunctionSignature: string;
    readonly abiParameters: readonly unknown[];
    readonly contractAddress?: string;
    readonly senderAddress: string;
  };

  function callsOf(executor: ReturnType<typeof recordingExecutor>): readonly ExecuteCall[] {
    return (executor.mock.calls as unknown[][]).map(([arg]) => arg as ExecuteCall);
  }

  it('approves the EXACT budget, never a margin', async () => {
    const { job } = await openJob('approve');
    const executePermit2Transaction = recordingExecutor();
    await fundEscrowJob(store.pool, fakeProvider({ executePermit2Transaction }), { escrowJobId: job.id });

    const approve = callsOf(executePermit2Transaction)
      .find((call) => call.abiFunctionSignature.startsWith('approve'));
    // An earlier overcharge was only possible because the client approved
    // MORE than it was quoted. Exact approval makes a front-run revert.
    expect(approve?.abiParameters[1]).toBe('20000');
    // Spent by the ESCROW, on the TOKEN -- approving the token contract
    // itself would be a no-op the guard could never catch.
    expect(approve?.abiParameters[0]).toBe(ESCROW_ADDRESS);
    expect(approve?.contractAddress).toBe(ARC_USDC);
  });

  it('always funds through the guarded signature', async () => {
    const { job } = await openJob('guarded');
    const executePermit2Transaction = recordingExecutor();
    await fundEscrowJob(store.pool, fakeProvider({ executePermit2Transaction }), { escrowJobId: job.id });

    const fund = callsOf(executePermit2Transaction).find((call) => call.abiFunctionSignature.startsWith('fund'));
    expect(fund?.abiFunctionSignature).toBe('fund(uint256,address,uint256,bytes)');
    // expectedToken and expectedBudget are the guard. Both must be passed,
    // and expectedBudget must equal the quoted budget exactly.
    expect(fund?.abiParameters[0]).toBe(job.onchainJobId);
    expect(fund?.abiParameters[1]).toBe(ARC_USDC);
    expect(fund?.abiParameters[2]).toBe('20000');
    expect(fund?.contractAddress).toBe(ESCROW_ADDRESS);
  });

  it('approves before it funds', async () => {
    // fund() pulls through the token's own transferFrom, so an approve that
    // lands after it reverts with TRANSFER_FROM_FAILED.
    const { job } = await openJob('order');
    const executePermit2Transaction = recordingExecutor();
    await fundEscrowJob(store.pool, fakeProvider({ executePermit2Transaction }), { escrowJobId: job.id });

    const signatures = callsOf(executePermit2Transaction).map((call) => call.abiFunctionSignature.split('(')[0]);
    expect(signatures.indexOf('approve')).toBeLessThan(signatures.indexOf('fund'));
  });

  it('reserves against the payment reservation when funded', async () => {
    const { fixture, job } = await openJob('reserve');
    const funded = await fundEscrowJob(store.pool, fakeProvider(), { escrowJobId: job.id });

    expect(funded.state).toBe('funded');
    expect(funded.fundTxHash).toBe('0xfundtx');
    expect(funded.reservationId).not.toBeNull();

    const res = await store.pool.query<{
      status: string; amount_usdc: string; agent_id: string; source_id: string; reason_code: string;
    }>(
      'SELECT status, amount_usdc, agent_id, source_id, reason_code FROM payment_reservations WHERE id = $1',
      [funded.reservationId],
    );
    expect(res.rows[0]?.status).toBe('reserved');
    expect(Number(res.rows[0]?.amount_usdc)).toBe(0.02);
    expect(res.rows[0]?.agent_id).toBe(fixture.clientAgentId);
    expect(res.rows[0]?.source_id).toBe(fixture.sourceId);
    // Mirrors the 'x402_attempt:<id>' convention already in payment_reservations.
    expect(res.rows[0]?.reason_code).toBe(`escrow_job:${job.id}`);
  });

  it('refuses to fund a job that is not open', async () => {
    const { job } = await openJob('double');
    await fundEscrowJob(store.pool, fakeProvider(), { escrowJobId: job.id });

    // The chain would revert this with WrongStatus, and so must we rather
    // than approving a second budget against an already-funded job.
    const executePermit2Transaction = recordingExecutor();
    await expect(
      fundEscrowJob(store.pool, fakeProvider({ executePermit2Transaction }), { escrowJobId: job.id }),
    ).rejects.toThrow(/escrow_invalid_transition/);
    expect(executePermit2Transaction).not.toHaveBeenCalled();

    const rows = await store.pool.query<{ count: string }>(
      'SELECT count(*) FROM payment_reservations WHERE reason_code = $1', [`escrow_job:${job.id}`],
    );
    expect(Number(rows.rows[0]?.count)).toBe(1);
  });

  it('sets the budget from the provider wallet when the provider is one of ours', async () => {
    // ERC-8183 lets ONLY job.provider call setBudget, and fund() reverts with
    // BudgetMismatch while job.budget is still 0. When the provider is a
    // fleet agent we hold the key for, we can set it ourselves.
    const { fixture, job } = await openJob('setbudget', { providerInFleet: true });
    const executePermit2Transaction = recordingExecutor();
    await fundEscrowJob(store.pool, fakeProvider({ executePermit2Transaction }), { escrowJobId: job.id });

    const calls = callsOf(executePermit2Transaction);
    const setBudget = calls.find((call) => call.abiFunctionSignature.startsWith('setBudget'));
    expect(setBudget?.abiFunctionSignature).toBe('setBudget(uint256,address,uint256,bytes)');
    expect(setBudget?.senderAddress).toBe(fixture.providerAddress);
    expect(setBudget?.abiParameters[0]).toBe(job.onchainJobId);
    expect(setBudget?.abiParameters[1]).toBe(ARC_USDC);
    // The same exact number fund() will then assert against.
    expect(setBudget?.abiParameters[2]).toBe('20000');
    const names = calls.map((call) => call.abiFunctionSignature.split('(')[0]);
    expect(names.indexOf('setBudget')).toBeLessThan(names.indexOf('fund'));
  });

  it('leaves the budget to an outside provider and lets the guard catch a mismatch', async () => {
    // The platform holds no key for an off-fleet provider, so it cannot set
    // the budget -- the provider does, out of band. That is exactly the case
    // the guarded fund() protects: if the provider set a different budget,
    // expectedBudget makes the transaction revert instead of overpaying.
    const { job } = await openJob('outside', { providerInFleet: false });
    const executePermit2Transaction = recordingExecutor();
    await fundEscrowJob(store.pool, fakeProvider({ executePermit2Transaction }), { escrowJobId: job.id });

    const names = callsOf(executePermit2Transaction).map((call) => call.abiFunctionSignature.split('(')[0]);
    expect(names).toEqual(['approve', 'fund']);
  });

  it('leaves nothing half-written when the fund call fails', async () => {
    const { job } = await openJob('fundfail');
    const executePermit2Transaction = vi.fn((input: { readonly abiFunctionSignature: string }) =>
      input.abiFunctionSignature.startsWith('fund')
        ? Promise.reject(new Error('circle_permit2_transaction_failed'))
        : Promise.resolve({ txHash: '0xapprovetx' }));

    await expect(
      fundEscrowJob(store.pool, fakeProvider({ executePermit2Transaction }), { escrowJobId: job.id }),
    ).rejects.toThrow('circle_permit2_transaction_failed');

    const row = await store.pool.query<{ state: string; reservation_id: string | null }>(
      'SELECT state, reservation_id FROM escrow_jobs WHERE id = $1', [job.id],
    );
    expect(row.rows[0]).toEqual({ state: 'open', reservation_id: null });
    const reservations = await store.pool.query<{ count: string }>(
      'SELECT count(*) FROM payment_reservations WHERE reason_code = $1', [`escrow_job:${job.id}`],
    );
    expect(Number(reservations.rows[0]?.count)).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Lifecycle transitions
  // ---------------------------------------------------------------------

  function hoursFromNow(hours: number): Date {
    return new Date(Date.now() + hours * 3_600_000);
  }

  async function reservationStatus(reservationId: string | null): Promise<string | undefined> {
    const res = await store.pool.query<{ status: string }>(
      'SELECT status FROM payment_reservations WHERE id = $1', [reservationId],
    );
    return res.rows[0]?.status;
  }

  async function escrowStateOf(escrowJobId: string): Promise<string | undefined> {
    const row = await store.pool.query<{ state: string }>(
      'SELECT state FROM escrow_jobs WHERE id = $1', [escrowJobId],
    );
    return row.rows[0]?.state;
  }

  /** Drives one org's fixture through create -> fund, so several jobs can share an org. */
  async function fundJobFor(fixture: EscrowFixture, overrides: Record<string, unknown> = {}) {
    const job = await createEscrowJob(store.pool, fakeProvider(), createInput(fixture, overrides));
    return fundEscrowJob(store.pool, fakeProvider(), { escrowJobId: job.id });
  }

  /** ...and on to submitted. The provider must be in fleet for submit() to be sent. */
  async function submitJobFor(fixture: EscrowFixture, overrides: Record<string, unknown> = {}) {
    const funded = await fundJobFor(fixture, overrides);
    return applyEscrowStateChange(store.pool, fakeProvider(), {
      escrowJobId: funded.id, next: 'submitted', deliverableHash: DELIVERABLE_HASH,
    });
  }

  async function fundedJob(suffix: string, options: { readonly providerInFleet?: boolean } = {}) {
    const fixture = await seedEscrowOrg(suffix, options);
    return { fixture, job: await fundJobFor(fixture) };
  }

  async function submittedJob(suffix: string, overrides: Record<string, unknown> = {}) {
    const fixture = await seedEscrowOrg(suffix, { providerInFleet: true });
    return { fixture, job: await submitJobFor(fixture, overrides) };
  }

  it('records the submission and the deliverable it was made against', async () => {
    const { fixture, job } = await fundedJob('submitstep', { providerInFleet: true });
    const executePermit2Transaction = recordingExecutor();
    const submitted = await applyEscrowStateChange(
      store.pool,
      fakeProvider({ executePermit2Transaction }),
      { escrowJobId: job.id, next: 'submitted', deliverableHash: DELIVERABLE_HASH },
    );

    expect(submitted.state).toBe('submitted');
    expect(submitted.submitTxHash).toBe('0xsubmittx');
    expect(submitted.deliverableHash).toBe(DELIVERABLE_HASH);
    // Submitting does not resolve the money -- the reservation stays held.
    expect(await reservationStatus(job.reservationId)).toBe('reserved');

    const call = callsOf(executePermit2Transaction)[0];
    expect(call?.abiFunctionSignature).toBe('submit(uint256,bytes32,bytes)');
    // ERC-8183 lets ONLY job.provider submit.
    expect(call?.senderAddress).toBe(fixture.providerAddress);
    expect(call?.abiParameters[0]).toBe(job.onchainJobId);
    expect(call?.abiParameters[1]).toBe(DELIVERABLE_HASH);
  });

  it('settles the reservation on complete', async () => {
    const { fixture, job } = await submittedJob('complete');
    const executePermit2Transaction = recordingExecutor();
    const completed = await applyEscrowStateChange(
      store.pool,
      fakeProvider({ executePermit2Transaction }),
      { escrowJobId: job.id, next: 'completed' },
    );

    expect(completed.state).toBe('completed');
    expect(completed.terminalTxHash).toBe('0xcompletetx');
    expect(await reservationStatus(job.reservationId)).toBe('settled');

    const call = callsOf(executePermit2Transaction)[0];
    expect(call?.abiFunctionSignature).toBe('complete(uint256,bytes32,bytes)');
    // ERC-8183 lets ONLY job.evaluator complete. This is a mode-2 job, so the
    // evaluator IS the client -- self-evaluated, not neutral arbitration.
    expect(call?.senderAddress).toBe(fixture.clientAddress);
  });

  it('releases the reservation on reject', async () => {
    const { job } = await submittedJob('reject');
    const executePermit2Transaction = recordingExecutor();
    const rejected = await applyEscrowStateChange(
      store.pool,
      fakeProvider({ executePermit2Transaction }),
      { escrowJobId: job.id, next: 'rejected' },
    );

    expect(rejected.state).toBe('rejected');
    expect(rejected.terminalTxHash).toBe('0xrejecttx');
    expect(await reservationStatus(job.reservationId)).toBe('released');
    expect(callsOf(executePermit2Transaction)[0]?.abiFunctionSignature).toBe('reject(uint256,bytes32,bytes)');
  });

  it('releases on expiry but records it distinctly from reject', async () => {
    const { job } = await submittedJob('expire');
    const executePermit2Transaction = recordingExecutor();
    await applyEscrowStateChange(
      store.pool,
      fakeProvider({ executePermit2Transaction }),
      { escrowJobId: job.id, next: 'expired' },
    );

    expect(await reservationStatus(job.reservationId)).toBe('released');
    // The contract refunds identically, but our evidence must distinguish
    // "delivered but unevaluated" from "failed".
    expect(await escrowStateOf(job.id)).toBe('expired');
    // claimRefund automation is out of scope: expiry is recorded, not sent.
    expect(executePermit2Transaction).not.toHaveBeenCalled();
  });

  it('refuses transitions that the lifecycle does not allow', async () => {
    // open -> completed skips funding entirely; the chain would reject it and
    // so must we, rather than writing a state the chain does not agree with.
    const { job } = await openJob('badtransition');
    const executePermit2Transaction = recordingExecutor();
    await expect(
      applyEscrowStateChange(store.pool, fakeProvider({ executePermit2Transaction }), {
        escrowJobId: job.id, next: 'completed',
      }),
    ).rejects.toThrow(/escrow_invalid_transition/);
    expect(executePermit2Transaction).not.toHaveBeenCalled();
    expect(await escrowStateOf(job.id)).toBe('open');
  });

  it('refuses to complete a job whose evaluator key we do not hold', async () => {
    // A mode-3 job evaluated by an outside address. We cannot send complete()
    // as them, and writing `completed` anyway would claim an outcome the chain
    // never recorded. Reconciliation is the only honest path for those.
    const fixture = await seedEscrowOrg('outsideeval', { providerInFleet: true });
    const job = await submitJobFor(fixture, { evaluatorAddress: hexAddress('e7a1', 'outsideeval') });
    const executePermit2Transaction = recordingExecutor();

    await expect(
      applyEscrowStateChange(store.pool, fakeProvider({ executePermit2Transaction }), {
        escrowJobId: job.id, next: 'completed',
      }),
    ).rejects.toThrow(/escrow_evaluator_wallet_not_held/);
    expect(executePermit2Transaction).not.toHaveBeenCalled();
    expect(await escrowStateOf(job.id)).toBe('submitted');
    expect(await reservationStatus(job.reservationId)).toBe('reserved');
  });


  // ---------------------------------------------------------------------
  // Evaluator liveness
  // ---------------------------------------------------------------------

  it('flags submitted jobs approaching expiry', async () => {
    // The sharpest ERC-8183 trap: after submit, an evaluator who goes silent
    // lets claimRefund pay the CLIENT back for work that was delivered.
    const fixture = await seedEscrowOrg('liveness', { providerInFleet: true });
    const atRiskJob = await submitJobFor(fixture, { expiresAt: hoursFromNow(2) });
    await submitJobFor(fixture, { expiresAt: hoursFromNow(40) }); // not at risk
    await fundJobFor(fixture, { expiresAt: hoursFromNow(1) }); // not submitted, not the trap

    const atRisk = await listEscrowLivenessRisks(store.pool, { orgId: fixture.orgId, withinHours: 6 });
    expect(atRisk).toHaveLength(1);
    expect(atRisk[0]?.escrowJobId).toBe(atRiskJob.id);
    // Mode 2 means the client evaluates its own job. Callers must never
    // present that as neutral arbitration, so the mode travels with the risk.
    expect(atRisk[0]?.escrowMode).toBe(2);
  });

  it('scopes liveness risks to the org that asked', async () => {
    const mine = await seedEscrowOrg('livenessmine', { providerInFleet: true });
    const theirs = await seedEscrowOrg('livenesstheirs', { providerInFleet: true });
    await submitJobFor(theirs, { expiresAt: hoursFromNow(2) });

    const atRisk = await listEscrowLivenessRisks(store.pool, { orgId: mine.orgId, withinHours: 6 });
    expect(atRisk).toHaveLength(0);
  });
});
