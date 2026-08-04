import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { createX402ResultCryptoCodec } from '../../src/engines/payments/x402-result-crypto.js';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

// The non-custodial path: the operator's OWN wallet is the delegation
// payer, so this platform holds no key for it. These routes are what the
// browser talks to -- build typed data to sign, record the signature,
// list, revoke. permit2.test.ts covers the engine; this covers the HTTP
// wrapper and, most importantly, that the platform never tries to sign or
// approve on behalf of an address it does not control.

const signPermit2Delegation = vi.fn(() => Promise.resolve({ signature: '0xplatform_should_not_sign' }));
const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xpermit' }));

function fakeProvider(): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: () => Promise.resolve({ circleWalletSetId: 'wallet_set_delegation_route' }),
    executePermit2Transaction,
    getGatewayBalance: vi.fn(),
    getWalletBalances: vi.fn(),
    health: () => ({ configured: true, missing: [], mode: 'test', provider: 'circle' }),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation,
    transferWallet: vi.fn(),
  };
}

const USER_WALLET = '0xa11ce00000000000000000000000000000000001';

describe('user-owned wallet delegation routes', () => {
  let api: FastifyInstance;
  let store: PostgresTestStore;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    api = buildApp({
      identity: { pool: store.pool, resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }) },
      payments: {
        circleProvider: fakeProvider(),
        pool: store.pool,
        resultCrypto: createX402ResultCryptoCodec(randomBytes(32).toString('base64')),
        resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }),
      },
      policy: { pool: store.pool, resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }) },
      approvals: { pool: store.pool, resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }) },
      runtime: { pool: store.pool },
    });
  }, 90_000);

  afterAll(async () => {
    if (api !== undefined) await api.close();
    if (store !== undefined) await store.stop();
    vi.unstubAllEnvs();
  });

  async function setupOrgWithAgent(label: string) {
    const org = await api.inject({
      method: 'POST',
      url: '/v1/orgs',
      payload: { name: `${label} Org`, owner: { email: `${label}@example.test`, name: 'Owner' } },
    });
    expect(org.statusCode, org.body).toBe(201);
    const orgId = org.json<{ org: { id: string } }>().org.id;
    await store.pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);

    const agent = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: `${label} agent` },
    });
    expect(agent.statusCode, agent.body).toBe(201);
    const agentId = agent.json<{ agent: { id: string } }>().agent.id;

    const walletSetId = `ws_dele_${label}`;
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Delegation route wallet set', 'usr_owner')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    const payeeAddress = `0xbeef${label.padEnd(36, '0').slice(0, 36)}`;
    await recordProvisionedWallet(store.pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: `w_dele_${label}`,
      address: payeeAddress,
      refId: `ref_dele_${label}`,
      walletSetId,
      circleBlockchain: 'ARC-TESTNET',
    });

    return { orgId, agentId, payeeAddress };
  }

  it('records a user-signed delegation without signing or approving for them', async () => {
    const { orgId, agentId, payeeAddress } = await setupOrgWithAgent('record');
    signPermit2Delegation.mockClear();
    executePermit2Transaction.mockClear();

    const response = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/delegations`,
      payload: {
        payer_address: USER_WALLET,
        signature: '0xdeadbeef',
        nonce: '3',
        chain: 'arc',
        ceiling_usdc: '5.00',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        payee_agent_id: agentId,
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    const { delegation } = response.json<{
      delegation: {
        payer_address: string;
        payer_agent_id: string | null;
        signature: string;
        permit_nonce: string;
      };
    }>();
    expect(delegation.payer_address).toBe(USER_WALLET);
    expect(delegation.payer_agent_id).toBeNull();
    expect(delegation.signature).toBe('0xdeadbeef');
    // The nonce the wallet signed over, not one re-read server-side.
    expect(Number(delegation.permit_nonce)).toBe(3);

    // The platform holds no key for USER_WALLET, so it must not have tried
    // to sign, and must not have sent the ERC-20 approve() either.
    expect(signPermit2Delegation).not.toHaveBeenCalled();
    expect(executePermit2Transaction).toHaveBeenCalledTimes(1);
    const call = (executePermit2Transaction.mock.calls as unknown[][])[0]?.[0] as {
      abiFunctionSignature?: string;
      senderAddress?: string;
    };
    expect(call.abiFunctionSignature).toContain('permit');
    // Submitted by the payee agent -- the payer cannot submit anything here.
    expect(call.senderAddress).toBe(payeeAddress);
  });

  it('reports that revoking a user-owned delegation did NOT kill the on-chain allowance', async () => {
    // Permit2's lockdown() may only be called by the allowance owner. The
    // row is revoked so this control plane stops issuing drawdowns, but the
    // on-chain allowance survives until the user signs lockdown themselves.
    // Reporting a plain success here would tell operators they are safe
    // when they are not.
    const { orgId, agentId } = await setupOrgWithAgent('revoke');

    const created = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/delegations`,
      payload: {
        payer_address: USER_WALLET,
        signature: '0xabc123',
        nonce: '0',
        chain: 'arc',
        ceiling_usdc: '2.00',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        payee_agent_id: agentId,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const delegationId = created.json<{ delegation: { id: string } }>().delegation.id;

    const revoked = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/delegations/${delegationId}/revoke`,
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect(revoked.json<{ onChainRevoked: boolean }>().onChainRevoked).toBe(false);
  });

  it('lists delegations with remaining headroom and payer ownership', async () => {
    const { orgId, agentId } = await setupOrgWithAgent('list');

    await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/delegations`,
      payload: {
        payer_address: USER_WALLET,
        signature: '0xfeed',
        nonce: '1',
        chain: 'arc',
        ceiling_usdc: '7.50',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        payee_agent_id: agentId,
      },
    });

    const listed = await api.inject({ method: 'GET', url: `/v1/orgs/${orgId}/payments/delegations` });
    expect(listed.statusCode, listed.body).toBe(200);
    const { delegations } = listed.json<{
      delegations: readonly {
        ceilingUsdc: string;
        remainingUsdc: string;
        platformControlsPayer: boolean;
      }[];
    }>();
    expect(delegations).toHaveLength(1);
    expect(delegations[0]?.ceilingUsdc).toBe('7.500000');
    expect(delegations[0]?.remainingUsdc).toBe('7.500000');
    // The UI needs this to know a revoke here cannot kill the allowance.
    expect(delegations[0]?.platformControlsPayer).toBe(false);
  });

  it('rejects a delegation with no payee', async () => {
    const { orgId } = await setupOrgWithAgent('nopayee');
    const response = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/delegations`,
      payload: {
        payer_address: USER_WALLET,
        signature: '0x01',
        nonce: '0',
        chain: 'arc',
        ceiling_usdc: '1.00',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed payer address rather than passing it to an RPC', async () => {
    const { orgId, agentId } = await setupOrgWithAgent('badaddr');
    const response = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/delegations`,
      payload: {
        payer_address: 'not-an-address',
        signature: '0x01',
        nonce: '0',
        chain: 'arc',
        ceiling_usdc: '1.00',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        payee_agent_id: agentId,
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
