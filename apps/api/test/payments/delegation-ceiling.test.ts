import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import { outstandingHeadroomMicros } from '../../src/engines/payments/delegation-ceiling.js';
import { recordSignedDelegation } from '../../src/engines/payments/permit2.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

const TREASURY = '0x7ea50000000000000000000000000000000000a1';
const USDC = '0x3600000000000000000000000000000000000000';

/**
 * Seeds one payer with two live delegations and one revoked, so the sum can
 * be checked against a number that is wrong in an obvious way if revoked or
 * expired rows leak in.
 */
async function seedTwoActiveAndOneRevoked(pool: pg.Pool): Promise<{ readonly orgId: string }> {
  const orgId = 'org_ceiling_sum';
  await pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Ceiling Org')", [orgId]);

  const insert = async (
    id: string,
    ceiling: string,
    drawn: string,
    status: string,
    nonce: number,
    expiresAt: Date,
  ): Promise<void> => {
    await pool.query(
      `INSERT INTO agent_delegations (
         id, org_id, payer_agent_id, payer_address, payee_agent_id, payee_address,
         mode, chain, token_address, ceiling_usdc, drawn_usdc, expires_at,
         permit_nonce, signature, status, approved_by, payer_kind
       ) VALUES ($1, $2, NULL, $3, NULL, $4, 'test', 'arc', $5, $6::numeric, $7::numeric,
                 $8, $9, '0xsig', $10, 'usr_1', 'treasury')`,
      [id, orgId, TREASURY, `0xpayee${id.slice(-2)}`, USDC, ceiling, drawn, expiresAt, nonce, status],
    );
  };

  const future = new Date(Date.now() + 3_600_000);
  await insert('dele_sum_a1', '10.00', '4.00', 'active', 0, future);
  await insert('dele_sum_b2', '5.00', '0.00', 'active', 1, future);
  // Revoked headroom is not headroom: the allowance is dead on-chain.
  await insert('dele_sum_c3', '100.00', '0.00', 'revoked', 2, future);
  // Expired likewise, and nothing sweeps 'active' rows to 'expired' on a
  // timer -- so this row is still status='active' and MUST be excluded by
  // expires_at, which is exactly the case status alone would get wrong.
  await insert('dele_sum_d4', '50.00', '0.00', 'active', 3, new Date(Date.now() - 1000));

  return { orgId };
}

function fakeProvider(overrides: Partial<CircleTreasuryProvider> = {}): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: vi.fn(),
    executePermit2Transaction: vi.fn(() => Promise.resolve({ txHash: '0xceilingtx' })),
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

function stubPermit2Nonce(nonce: bigint): void {
  vi.stubEnv('ARC_RPC_URL', 'https://rpc.testnet.arc.network');
  vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: `0x${'0'.repeat(64)}${'0'.repeat(64)}${nonce.toString(16).padStart(64, '0')}`,
  }))));
}

describe('outstandingHeadroomMicros', () => {
  let store: PostgresTestStore;
  beforeAll(async () => { store = await startPostgres(); }, 90_000);
  afterAll(async () => { if (store !== undefined) await store.stop(); });

  it('sums remaining headroom across every active delegation for one payer', async () => {
    const { orgId } = await seedTwoActiveAndOneRevoked(store.pool);
    const total = await outstandingHeadroomMicros(store.pool, {
      orgId, payerAddress: TREASURY, mode: 'test', chain: 'arc', tokenAddress: USDC,
    });
    expect(total).toBe(11_000_000n);
  });
});

describe('org ceiling and treasury solvency', () => {
  let store: PostgresTestStore;
  beforeAll(async () => { store = await startPostgres(); }, 90_000);
  afterAll(async () => {
    if (store !== undefined) await store.stop();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /**
   * An org whose treasury already has `existingCeiling` USDC of undrawn
   * delegation outstanding, plus a payee agent ready to receive a new one.
   */
  async function seedTreasury(
    suffix: string,
    options: { readonly existingCeiling?: string; readonly orgCeiling?: string } = {},
  ): Promise<{ readonly orgId: string; readonly payeeAgentId: string; readonly payeeAddress: string }> {
    const orgId = `org_cap_${suffix}`;
    const teamId = `team_cap_${suffix}`;
    const payeeAgentId = `agt_cap_${suffix}`;
    const walletSetId = `ws_cap_${suffix}`;
    const hex = [...suffix].map((c) => c.charCodeAt(0).toString(16)).join('');
    const payeeAddress = `0xbee0${hex}`.padEnd(42, '0').slice(0, 42);
    const treasuryAddress = `0x7ea0${hex}`.padEnd(42, '0').slice(0, 42);

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Cap Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      payeeAgentId, orgId, teamId, 'Payee Agent',
    ]);
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Cap wallet set', 'usr_1')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: payeeAgentId, mode: 'test', chain: 'arc',
      circleWalletId: `w_cap_${suffix}`, address: payeeAddress,
      refId: `ref_cap_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    await store.pool.query(
      `INSERT INTO circle_chain_wallets
         (id, org_id, wallet_set_id, mode, chain, circle_blockchain,
          circle_wallet_id, address, account_type, metadata)
       VALUES ($1, $2, $3, 'test', 'arc', 'ARC-TESTNET', $4, $5, 'eoa', '{}'::jsonb)`,
      [`cwallet_cap_${suffix}`, orgId, walletSetId, `circlewallet_cap_${suffix}`, treasuryAddress],
    );

    if (options.existingCeiling !== undefined) {
      await store.pool.query(
        `INSERT INTO agent_delegations (
           id, org_id, payer_agent_id, payer_address, payee_agent_id, payee_address,
           mode, chain, token_address, ceiling_usdc, drawn_usdc, expires_at,
           permit_nonce, signature, status, approved_by, payer_kind
         ) VALUES ($1, $2, NULL, $3, NULL, $4, 'test', 'arc', $5, $6::numeric, '0'::numeric,
                   $7, 77, '0xsig', 'active', 'usr_1', 'treasury')`,
        [`dele_cap_${suffix}`, orgId, treasuryAddress, '0xdead0000000000000000000000000000000000ff',
          USDC, options.existingCeiling, new Date(Date.now() + 86_400_000)],
      );
    }
    if (options.orgCeiling !== undefined) {
      await store.pool.query(
        `INSERT INTO org_delegation_ceilings (org_id, mode, chain, ceiling_usdc, updated_by)
         VALUES ($1, 'test', 'arc', $2::numeric, 'usr_1')`,
        [orgId, options.orgCeiling],
      );
    }

    return { orgId, payeeAgentId, payeeAddress };
  }

  it('rejects a delegation that would push total headroom past the org ceiling', async () => {
    // Org ceiling 12.00, existing outstanding 10.00 -> a 5.00 delegation must fail.
    stubPermit2Nonce(0n);
    const { orgId, payeeAgentId, payeeAddress } = await seedTreasury('overcap', {
      existingCeiling: '10.00', orgCeiling: '12.00',
    });
    await expect(recordSignedDelegation(store.pool, fakeProvider(), {
      orgId, payeeAgentId, payeeAddress, mode: 'test', chain: 'arc',
      ceilingUsdc: '5.00',
      expiresAt: new Date(Date.now() + 86_400_000),
      approvedBy: 'usr_1',
      payerTreasury: true,
      // Solvent, so only the POLICY bound can be what rejects this.
      readPayerBalanceMicros: () => Promise.resolve(1_000_000_000n),
    })).rejects.toMatchObject({ code: 'org_delegation_ceiling_exceeded', statusCode: 409 });
  });

  it('rejects a delegation the treasury cannot actually cover', async () => {
    // Treasury balance 3.00, no org ceiling configured -> a 5.00 delegation fails.
    stubPermit2Nonce(0n);
    const { orgId, payeeAgentId, payeeAddress } = await seedTreasury('insolvent');
    await expect(recordSignedDelegation(store.pool, fakeProvider(), {
      orgId, payeeAgentId, payeeAddress, mode: 'test', chain: 'arc',
      ceilingUsdc: '5.00',
      expiresAt: new Date(Date.now() + 86_400_000),
      approvedBy: 'usr_1',
      payerTreasury: true,
      readPayerBalanceMicros: () => Promise.resolve(3_000_000n),
    })).rejects.toMatchObject({ code: 'treasury_insufficient_for_ceiling', statusCode: 409 });
  });

  it('allows a delegation that fits both bounds, and sends no on-chain call when it does not', async () => {
    // The rejections above must happen BEFORE any on-chain write -- a
    // delegation refused after approve() would leave the treasury's ERC-20
    // allowance raised for a delegation that does not exist.
    stubPermit2Nonce(0n);
    const { orgId, payeeAgentId, payeeAddress } = await seedTreasury('fits', {
      existingCeiling: '10.00', orgCeiling: '20.00',
    });
    const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xfits' }));
    const delegation = await recordSignedDelegation(
      store.pool,
      fakeProvider({ executePermit2Transaction }),
      {
        orgId, payeeAgentId, payeeAddress, mode: 'test', chain: 'arc',
        ceilingUsdc: '5.00',
        expiresAt: new Date(Date.now() + 86_400_000),
        approvedBy: 'usr_1',
        payerTreasury: true,
        readPayerBalanceMicros: () => Promise.resolve(50_000_000n),
      },
    );
    expect(delegation.status).toBe('active');
    expect(delegation.payer_kind).toBe('treasury');
  });

  it('does not solvency-gate an AGENT payer, whose ceiling is meant to exceed its balance', async () => {
    // The just-in-time model depends on this: payIntraFleet opens a 5.00
    // USDC delegation for an agent that holds cents, and the agent draws as
    // it spends. Gating an agent payer on solvency rejects every
    // agent-to-agent payment, so the bounds are treasury-only.
    stubPermit2Nonce(0n);
    const { orgId, payeeAgentId, payeeAddress } = await seedTreasury('agentpayer', { orgCeiling: '1.00' });
    const payerAgentId = 'agt_cap_agentpayer_payer';
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      payerAgentId, orgId, 'team_cap_agentpayer', 'Payer Agent',
    ]);
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: payerAgentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_cap_agentpayer_payer', address: '0xa9e70000000000000000000000000000000000b1',
      refId: 'ref_cap_agentpayer_payer', walletSetId: 'ws_cap_agentpayer', circleBlockchain: 'ARC-TESTNET',
    });

    // Broke and far over the org ceiling -- neither bound may apply.
    const delegation = await recordSignedDelegation(store.pool, fakeProvider(), {
      orgId, payerAgentId, payeeAgentId, payeeAddress, mode: 'test', chain: 'arc',
      ceilingUsdc: '5.00',
      expiresAt: new Date(Date.now() + 86_400_000),
      approvedBy: 'usr_1',
      readPayerBalanceMicros: () => Promise.resolve(0n),
    });
    expect(delegation.status).toBe('active');
    expect(delegation.payer_kind).toBe('agent');
  });

  it('makes no on-chain call when the ceiling check rejects', async () => {
    stubPermit2Nonce(0n);
    const { orgId, payeeAgentId, payeeAddress } = await seedTreasury('nocall', {
      existingCeiling: '10.00', orgCeiling: '12.00',
    });
    const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xnever' }));
    const signPermit2Delegation = vi.fn(() => Promise.resolve({ signature: '0xnever' }));
    await expect(recordSignedDelegation(
      store.pool,
      fakeProvider({ executePermit2Transaction, signPermit2Delegation }),
      {
        orgId, payeeAgentId, payeeAddress, mode: 'test', chain: 'arc',
        ceilingUsdc: '5.00',
        expiresAt: new Date(Date.now() + 86_400_000),
        approvedBy: 'usr_1',
        payerTreasury: true,
        readPayerBalanceMicros: () => Promise.resolve(1_000_000_000n),
      },
    )).rejects.toMatchObject({ code: 'org_delegation_ceiling_exceeded' });
    expect(executePermit2Transaction).not.toHaveBeenCalled();
    expect(signPermit2Delegation).not.toHaveBeenCalled();
  });
});
