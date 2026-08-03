import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { createX402ResultCryptoCodec } from '../../src/engines/payments/x402-result-crypto.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

// The demo's reset flow (Phase 6 Task 7) needs a real HTTP way to create
// an agent_allocations row so evaluateTopUps (run by circle-worker's poll
// loop) can automatically fund each agent's wallet from the org treasury.
// setAllocation itself already has thorough coverage in allocations.test.ts
// (solvency rejection, concurrency, per-chain independence) -- this file
// covers only the new HTTP route wrapper: does it wire params/body through
// correctly and surface setAllocation's solvency conflict as the route's
// own 409, the same way payment-access and every other admin route does.

function fakeProviderWithGatewayBalance(availableUsdc: string): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: () => Promise.resolve({ circleWalletSetId: 'wallet_set_alloc_route_test' }),
    executePermit2Transaction: vi.fn(),
    getGatewayBalance: () => Promise.resolve({
      available: availableUsdc, domain: 26, providerMode: 'test',
      total: availableUsdc, withdrawable: availableUsdc, withdrawing: '0',
    }),
    getWalletBalances: vi.fn(),
    health: () => ({ configured: true, missing: [], mode: 'test', provider: 'circle' }),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation: vi.fn(),
    transferWallet: vi.fn(),
  };
}

describe('POST /v1/orgs/:orgId/agents/:agentId/allocation', () => {
  let api: FastifyInstance;
  let store: PostgresTestStore;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    api = buildApp({
      identity: { pool: store.pool, resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }) },
      payments: {
        circleProvider: fakeProviderWithGatewayBalance('50.00'),
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

  async function setupOrgWithTreasury(label: string) {
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

    const walletSetId = `ws_alloc_route_${label}`;
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Route test wallet set', 'usr_owner')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await store.pool.query(
      `INSERT INTO circle_chain_wallets (id, org_id, wallet_set_id, mode, chain, circle_blockchain, circle_wallet_id, address)
       VALUES ($1, $2, $3, 'test', 'arc', 'ARC-TESTNET', $4, $5)`,
      [`cwallet_alloc_route_${label}`, orgId, walletSetId, `circle_wallet_${label}`, `0x${label.padEnd(40, '0').slice(0, 40)}`],
    );

    return { orgId, agentId };
  }

  it('creates an allocation within treasury solvency', async () => {
    const { orgId, agentId } = await setupOrgWithTreasury('within');

    const response = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/allocation`,
      payload: { chain: 'arc', allocated_usdc: '10.00' },
    });

    expect(response.statusCode, response.body).toBe(201);
    const body = response.json<{ allocation: { chain: string; allocated_usdc: string } }>();
    expect(body.allocation.chain).toBe('arc');
    expect(body.allocation.allocated_usdc).toBe('10.000000');
  });

  it('rejects an allocation that would exceed real treasury solvency, as a 409', async () => {
    const { orgId, agentId } = await setupOrgWithTreasury('exceeds');

    const response = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/allocation`,
      payload: { chain: 'arc', allocated_usdc: '999.00' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'allocation_exceeds_treasury_solvency' });
  });
});
