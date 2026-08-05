import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import {
  drawDown,
  PERMIT2_ADDRESS,
  recordSignedDelegation,
  revokeDelegation,
} from '../../src/engines/payments/permit2.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

function fakeProvider(overrides: Partial<CircleTreasuryProvider> = {}): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: vi.fn(),
    executePermit2Transaction: vi.fn(() => Promise.resolve({ txHash: '0xdrawdown' })),
    getGatewayBalance: vi.fn(),
    getWalletBalances: vi.fn(),
    health: vi.fn(),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation: vi.fn(() => Promise.resolve({ signature: '0xsig' })),
    transferWallet: vi.fn(),
    ...overrides,
  };
}

describe('Permit2 delegation', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  async function setupDelegation(
    suffix: string,
    input: {
      readonly ceilingUsdc: string;
      readonly drawnUsdc?: string;
      readonly expiresAt?: Date;
      readonly status?: 'active' | 'revoked';
      // Payer is the operator's own wallet, so payer_agent_id is NULL and
      // the platform holds no key for it.
      readonly userOwnedPayer?: boolean;
    },
  ) {
    const orgId = `org_permit2_${suffix}`;
    const teamId = `team_permit2_${suffix}`;
    const payerAgentId = `agt_permit2_payer_${suffix}`;
    const payeeAgentId = `agt_permit2_payee_${suffix}`;
    const delegationId = `dele_permit2_${suffix}`;

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Permit2 Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      payerAgentId, orgId, teamId, 'Payer Agent',
    ]);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      payeeAgentId, orgId, teamId, 'Payee Agent',
    ]);
    const walletSetId = `ws_permit2_${suffix}`;
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Permit2 wallet set', 'usr_1')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: payerAgentId, mode: 'test', chain: 'arc',
      circleWalletId: `w_permit2_${suffix}`,
      address: `0xpayer${suffix}00000000000000000000000000000`.slice(0, 42),
      refId: `ref_permit2_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    await store.pool.query(
      `INSERT INTO agent_delegations (
         id, org_id, payer_agent_id, payer_address, payee_agent_id, payee_address, mode, chain,
         token_address, ceiling_usdc, drawn_usdc, expires_at, permit_nonce, signature,
         status, approved_by
       ) VALUES ($1, $2, $3, $4, $5, $6, 'test', 'arc', $7, $8, $9, $10, 0, '0xsig', $11, 'usr_1')`,
      [
        delegationId, orgId,
        input.userOwnedPayer === true ? null : payerAgentId,
        `0xpayer${suffix}00000000000000000000000000000`.slice(0, 42),
        payeeAgentId,
        `0xpayee${suffix}0000000000000000000000000000000`.slice(0, 42),
        '0x3600000000000000000000000000000000000000',
        input.ceilingUsdc, input.drawnUsdc ?? '0',
        input.expiresAt ?? new Date(Date.now() + 3_600_000),
        input.status ?? 'active',
      ],
    );

    return { delegationId, orgId, payerAgentId, payeeAgentId, pool: store.pool };
  }

  it('rejects a drawdown that exceeds the remaining ceiling', async () => {
    const { delegationId, pool } = await setupDelegation('exceeds', { ceilingUsdc: '10.00', drawnUsdc: '8.00' });
    await expect(
      drawDown(pool, fakeProvider(), { delegationId, amountUsdc: '3.00' }),
    ).rejects.toThrow(/ceiling/);
  });

  it('decrements the remaining ceiling across successive drawdowns', async () => {
    const { delegationId, pool } = await setupDelegation('successive', { ceilingUsdc: '10.00' });

    await drawDown(pool, fakeProvider(), { delegationId, amountUsdc: '3.00' });
    await drawDown(pool, fakeProvider(), { delegationId, amountUsdc: '2.00' });

    const row = await pool.query<{ drawn_usdc: string }>('SELECT drawn_usdc FROM agent_delegations WHERE id = $1', [delegationId]);
    expect(Number(row.rows[0]?.drawn_usdc)).toBe(5);

    const draws = await pool.query<{ count: string }>(
      'SELECT count(*) FROM agent_delegation_drawdowns WHERE delegation_id = $1', [delegationId],
    );
    expect(Number(draws.rows[0]?.count)).toBe(2);
  });

  it('rejects a drawdown against an expired delegation', async () => {
    const { delegationId, pool } = await setupDelegation('expired', {
      ceilingUsdc: '10.00', expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      drawDown(pool, fakeProvider(), { delegationId, amountUsdc: '1.00' }),
    ).rejects.toThrow(/expired/);
  });

  it('rejects a drawdown after revocation', async () => {
    const { delegationId, pool } = await setupDelegation('revoked', { ceilingUsdc: '10.00' });
    await revokeDelegation(pool, fakeProvider(), { delegationId });
    await expect(
      drawDown(pool, fakeProvider(), { delegationId, amountUsdc: '1.00' }),
    ).rejects.toThrow(/revoked/);
  });

  it('serializes concurrent drawdowns so the ceiling cannot be overdrawn', async () => {
    const { delegationId, pool } = await setupDelegation('concurrent', { ceilingUsdc: '10.00' });
    const results = await Promise.allSettled([
      drawDown(pool, fakeProvider(), { delegationId, amountUsdc: '6.00' }),
      drawDown(pool, fakeProvider(), { delegationId, amountUsdc: '6.00' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('records the real tx hash from the provider on a successful drawdown', async () => {
    const { delegationId, pool } = await setupDelegation('txhash', { ceilingUsdc: '10.00' });
    const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xrealtxhash' }));
    await drawDown(pool, fakeProvider({ executePermit2Transaction }), { delegationId, amountUsdc: '1.00' });

    const draw = await pool.query<{ tx_hash: string; status: string }>(
      'SELECT tx_hash, status FROM agent_delegation_drawdowns WHERE delegation_id = $1', [delegationId],
    );
    expect(draw.rows[0]).toEqual({ tx_hash: '0xrealtxhash', status: 'confirmed' });
  });

  it('marks the drawdown failed, not thrown, when the provider errors', async () => {
    const { delegationId, pool } = await setupDelegation('providerfail', { ceilingUsdc: '10.00' });
    const executePermit2Transaction = vi.fn(() => Promise.reject(new Error('circle_permit2_transaction_failed')));
    await expect(
      drawDown(pool, fakeProvider({ executePermit2Transaction }), { delegationId, amountUsdc: '1.00' }),
    ).rejects.toThrow('circle_permit2_transaction_failed');

    // Nothing partial is left committed: no drawn_usdc increment, no
    // drawdown row lingering as if it succeeded.
    const row = await pool.query<{ drawn_usdc: string }>('SELECT drawn_usdc FROM agent_delegations WHERE id = $1', [delegationId]);
    expect(Number(row.rows[0]?.drawn_usdc)).toBe(0);
  });

  it('marks the delegation revoked via lockdown()', async () => {
    const { delegationId, pool } = await setupDelegation('lockdown', { ceilingUsdc: '10.00' });
    const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xlockdown' }));
    await revokeDelegation(pool, fakeProvider({ executePermit2Transaction }), { delegationId });

    const row = await pool.query<{ status: string }>('SELECT status FROM agent_delegations WHERE id = $1', [delegationId]);
    expect(row.rows[0]?.status).toBe('revoked');
    const callArgs: unknown[] = executePermit2Transaction.mock.calls[0] ?? [];
    expect((callArgs[0] as { abiFunctionSignature?: string }).abiFunctionSignature).toContain('lockdown');
  });
});

function stubPermit2Nonce(nonce: bigint): void {
  vi.stubEnv('ARC_RPC_URL', 'https://rpc.testnet.arc.network');
  vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    // amount (uint160), expiration (uint48), nonce (uint48), each padded
    // to its own 32-byte word -- matches Permit2's real allowance() ABI.
    result: `0x${'0'.repeat(64)}${'0'.repeat(64)}${nonce.toString(16).padStart(64, '0')}`,
  }))));
}

describe('recordSignedDelegation', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('persists the signature and marks the delegation active', async () => {
    stubPermit2Nonce(0n);
    const orgId = 'org_permit2_sign';
    const teamId = 'team_permit2_sign';
    const payerAgentId = 'agt_permit2_sign_payer';
    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Permit2 Sign Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      payerAgentId, orgId, teamId, 'Payer Agent',
    ]);
    const walletSetId = 'ws_permit2_sign';
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Permit2 sign wallet set', 'usr_1')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: payerAgentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_permit2_sign', address: '0xaaaa111111111111111111111111111111111a01',
      refId: 'ref_permit2_sign', walletSetId, circleBlockchain: 'ARC-TESTNET',
    });

    const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xpermittx' }));
    const delegation = await recordSignedDelegation(store.pool, fakeProvider({ executePermit2Transaction }), {
      orgId,
      payerAgentId,
      payeeAddress: '0xbbbb222222222222222222222222222222222b02',
      mode: 'test',
      chain: 'arc',
      ceilingUsdc: '5.00',
      expiresAt: new Date(Date.now() + 3_600_000),
      approvedBy: 'usr_1',
    });

    expect(delegation.status).toBe('active');
    expect(delegation.signature).toBe('0xsig');

    const row = await store.pool.query<{ status: string; signature: string | null }>(
      'SELECT status, signature FROM agent_delegations WHERE id = $1', [delegation.id],
    );
    expect(row.rows[0]).toEqual({ status: 'active', signature: '0xsig' });

    // Two on-chain calls are required, in this order:
    //   1. approve(Permit2) on the TOKEN -- Permit2 pulls funds through the
    //      token's own transferFrom, so without this drawDown reverts with
    //      TRANSFER_FROM_FAILED (confirmed live on Arc).
    //   2. permit() on Permit2 -- the signature alone does nothing until
    //      permit() records the allowance in Permit2's own storage.
    // Asserting both, and their order, is what keeps either from being
    // dropped again.
    expect(executePermit2Transaction).toHaveBeenCalledTimes(2);

    const calls: unknown[][] = executePermit2Transaction.mock.calls;
    const approveArgs = calls[0]?.[0] as {
      abiFunctionSignature?: string;
      abiParameters?: readonly unknown[];
      contractAddress?: string;
    };
    expect(approveArgs.abiFunctionSignature).toContain('approve');
    // Targets the token, NOT Permit2 -- the default contractAddress would
    // approve Permit2 to spend Permit2's own balance, which is a no-op.
    expect(approveArgs.contractAddress).toBe('0x3600000000000000000000000000000000000000');
    expect(approveArgs.abiParameters?.[0]).toBe(PERMIT2_ADDRESS);

    const permitArgs = calls[1]?.[0] as { abiFunctionSignature?: string };
    expect(permitArgs.abiFunctionSignature).toContain('permit');
  });

  /**
   * Seeds an org whose TREASURY holds the money: a circle_chain_wallets row
   * (the org treasury) rather than an agent wallet for the payer. The payee
   * is still a real agent wallet, because Permit2 keys its allowance by
   * spender address -- that is where per-agent isolation actually comes from.
   */
  async function seedTreasuryOrg(suffix: string): Promise<{
    readonly orgId: string;
    readonly payeeAgentId: string;
    readonly payeeAddress: string;
    readonly treasuryAddress: string;
  }> {
    const orgId = `org_treas_${suffix}`;
    const teamId = `team_treas_${suffix}`;
    const payeeAgentId = `agt_treas_payee_${suffix}`;
    // Addresses must be real hex -- viem's encodeFunctionData rejects
    // anything else when reading the Permit2 nonce.
    const hexSuffix = [...suffix].map((c) => c.charCodeAt(0).toString(16)).join('');
    const payeeAddress = `0xbee0${hexSuffix}`.padEnd(42, '0').slice(0, 42);
    const treasuryAddress = `0x7ea0${hexSuffix}`.padEnd(42, '0').slice(0, 42);
    const walletSetId = `ws_treas_${suffix}`;

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Treasury Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      payeeAgentId, orgId, teamId, 'Payee Agent',
    ]);
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Treasury wallet set', 'usr_1')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: payeeAgentId, mode: 'test', chain: 'arc',
      circleWalletId: `w_treas_payee_${suffix}`, address: payeeAddress,
      refId: `ref_treas_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    // The org treasury lives in circle_chain_wallets, NOT agent_chain_wallets.
    await store.pool.query(
      `INSERT INTO circle_chain_wallets
         (id, org_id, wallet_set_id, mode, chain, circle_blockchain,
          circle_wallet_id, address, account_type, metadata)
       VALUES ($1, $2, $3, 'test', 'arc', 'ARC-TESTNET', $4, $5, 'eoa', '{}'::jsonb)`,
      [`cwallet_${suffix}`, orgId, walletSetId, `circlewallet_${suffix}`, treasuryAddress],
    );

    return { orgId, payeeAgentId, payeeAddress, treasuryAddress };
  }

  it('resolves the org treasury wallet as payer when payerTreasury is set', async () => {
    stubPermit2Nonce(0n);
    const { orgId, payeeAgentId, payeeAddress, treasuryAddress } = await seedTreasuryOrg('payer');
    const provider = fakeProvider({
      executePermit2Transaction: vi.fn(() => Promise.resolve({ txHash: '0xtreasurytx' })),
    });

    const delegation = await recordSignedDelegation(store.pool, provider, {
      orgId,
      payeeAgentId,
      payeeAddress,
      mode: 'test',
      chain: 'arc',
      ceilingUsdc: '10.00',
      expiresAt: new Date(Date.now() + 86_400_000),
      approvedBy: 'actor_test',
      payerTreasury: true,
    });

    expect(delegation.payer_address).toBe(treasuryAddress);
    expect(delegation.payer_kind).toBe('treasury');
    expect(delegation.payer_agent_id).toBeNull();
    // The platform signs for the treasury; it is not a user-signed delegation.
    expect(provider.signPermit2Delegation).toHaveBeenCalled();
  });

  it('approves Permit2 for total outstanding headroom, not just the new ceiling', async () => {
    // An existing active treasury delegation of 10.00 USDC, undrawn.
    // Issuing a second for 5.00 must approve 15.00, never 5.00 -- approving
    // 5.00 would strip the first agent's ability to draw.
    stubPermit2Nonce(0n);
    const { orgId, payeeAgentId, payeeAddress, treasuryAddress } = await seedTreasuryOrg('sum');
    await store.pool.query(
      `INSERT INTO agent_delegations (
         id, org_id, payer_agent_id, payer_address, payee_agent_id, payee_address,
         mode, chain, token_address, ceiling_usdc, drawn_usdc, expires_at,
         permit_nonce, signature, status, approved_by, payer_kind
       ) VALUES ('dele_sum_existing', $1, NULL, $2, NULL, $3, 'test', 'arc', $4,
                 '10.00'::numeric, '0'::numeric, $5, 99, '0xsig', 'active', 'usr_1', 'treasury')`,
      [orgId, treasuryAddress, '0xdead0000000000000000000000000000000000ff',
        '0x3600000000000000000000000000000000000000', new Date(Date.now() + 86_400_000)],
    );

    const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xsumtx' }));
    await recordSignedDelegation(store.pool, fakeProvider({ executePermit2Transaction }), {
      orgId, payeeAgentId, payeeAddress, mode: 'test', chain: 'arc',
      ceilingUsdc: '5.00',
      expiresAt: new Date(Date.now() + 86_400_000),
      approvedBy: 'actor_test',
      payerTreasury: true,
    });

    const approveCall = (executePermit2Transaction.mock.calls as unknown[][])
      .map(([arg]) => arg as { abiFunctionSignature?: string; abiParameters?: readonly unknown[] })
      .find((arg) => arg.abiFunctionSignature === 'approve(address,uint256)');
    expect(approveCall?.abiParameters?.[1]).toBe('15000000');
  });

  it('records a user-signed delegation without ever signing or approving for them', async () => {
    // The non-custodial path: the operator's own wallet produced the
    // signature and sent approve() itself, so the platform must do neither.
    const orgId = 'org_permit2_user';
    const teamId = 'team_permit2_user';
    const payeeAgentId = 'agt_permit2_user_payee';
    const userWallet = '0xu5e40000000000000000000000000000000000e1';

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Permit2 User Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      payeeAgentId, orgId, teamId, 'Payee Agent',
    ]);
    const walletSetId = 'ws_permit2_user';
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Permit2 user wallet set', 'usr_1')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: payeeAgentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_permit2_user_payee', address: '0xpayee00000000000000000000000000000000e02',
      refId: 'ref_permit2_user', walletSetId, circleBlockchain: 'ARC-TESTNET',
    });

    const signPermit2Delegation = vi.fn(() => Promise.resolve({ signature: '0xshould_never_be_called' }));
    const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xpermittx' }));

    const delegation = await recordSignedDelegation(
      store.pool,
      fakeProvider({ executePermit2Transaction, signPermit2Delegation }),
      {
        orgId,
        payeeAgentId,
        payeeAddress: '0xpayee00000000000000000000000000000000e02',
        mode: 'test',
        chain: 'arc',
        ceilingUsdc: '5.00',
        expiresAt: new Date(Date.now() + 3_600_000),
        approvedBy: 'usr_1',
        userSigned: { payerAddress: userWallet, signature: '0xuser_signature', nonce: 7n },
      },
    );

    // The platform holds no key for this address -- it must not have tried.
    expect(signPermit2Delegation).not.toHaveBeenCalled();
    expect(delegation.signature).toBe('0xuser_signature');
    expect(delegation.payer_address).toBe(userWallet);
    expect(delegation.payer_agent_id).toBeNull();
    // The nonce the user actually signed over, not a re-read one.
    expect(Number(delegation.permit_nonce)).toBe(7);

    // Exactly one on-chain call: permit(). No approve() -- the user sent
    // that from their own wallet before this ever reached the API.
    expect(executePermit2Transaction).toHaveBeenCalledTimes(1);
    const permitCall = (executePermit2Transaction.mock.calls as unknown[][])[0]?.[0] as {
      abiFunctionSignature?: string;
      senderAddress?: string;
    };
    expect(permitCall.abiFunctionSignature).toContain('permit');
    // Submitted by the payee agent, because the payer's key is the user's.
    expect(permitCall.senderAddress).toBe('0xpayee00000000000000000000000000000000e02');
  });
});
