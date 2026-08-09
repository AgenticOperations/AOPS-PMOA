import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { CircleGatewayX402SettlementResult, CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { createX402ResultCryptoCodec } from '../../src/engines/payments/x402-result-crypto.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

describe('payTo binding', () => {
  let api: FastifyInstance;
  let merchant: FastifyInstance;
  let merchantUrl: string;
  let store: PostgresTestStore;
  let merchantPayTo = '0x1111111111111111111111111111111111111111';

  function settlementResult(): CircleGatewayX402SettlementResult {
    return {
      network: 'eip155:84532',
      payment: {
        network: 'eip155:84532',
        payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: 'settled',
        transaction: '0xexact',
      },
      providerMode: 'test',
      success: true,
      transaction: '0xexact',
    };
  }

  const provider: CircleTreasuryProvider = {
    bridgeWalletTopUp: vi.fn(),
    createWallet: ({ chain }) => Promise.resolve({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      circleWalletId: `wallet_${chain}`,
    }),
    createWalletSet: () => Promise.resolve({ circleWalletSetId: 'wallet_set_payto_test' }),
    getGatewayBalance: () => Promise.resolve({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', available: '10', domain: 6,
      providerMode: 'test', total: '10', withdrawable: '10', withdrawing: '0',
    }),
    getWalletBalances: (input) => Promise.resolve({
      balances: [{
        amount: '10', blockchain: 'BASE-SEPOLIA', isNative: false, symbol: 'USDC',
        tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      }],
      providerMode: input.mode,
    }),
    health: (mode = 'test') => ({ configured: true, missing: [], mode, provider: 'circle' }),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: () => Promise.resolve(settlementResult()),
    settleGatewayX402: () => Promise.resolve(settlementResult()),
    signPermit2Delegation: vi.fn(),
    executePermit2Transaction: vi.fn(),
    transferWallet: vi.fn(),
    transferNativeGas: vi.fn(),
  };

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();

    merchant = Fastify({ logger: false });
    merchant.get('/*', async (request, reply) => {
      const resourceUrl = new URL(request.url, merchantUrl).href;
      return reply.code(402).send({
        x402Version: 2,
        resource: { url: resourceUrl, category: 'market-data', description: 'Market data', mimeType: 'application/json' },
        accepts: [{
          scheme: 'exact',
          network: 'eip155:84532',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          amount: '10000',
          payTo: merchantPayTo,
          maxTimeoutSeconds: 60,
          extra: { name: 'USDC', version: '2' },
        }],
      });
    });
    const address = await merchant.listen({ host: '127.0.0.1', port: 0 });
    merchantUrl = `${address}/data`;

    api = buildApp({
      identity: { pool: store.pool, resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }) },
      payments: {
        circleProvider: provider,
        pool: store.pool,
        paidHttpExecution: { timeoutMs: 50 },
        paidHttpUrlPolicy: {
          allowHttpOrigins: [new URL(merchantUrl).origin],
          resolveHostname: () => Promise.reject(new Error('unexpected hostname')),
        },
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
    if (merchant !== undefined) await merchant.close();
    if (store !== undefined) await store.stop();
    vi.unstubAllEnvs();
  });

  async function createReadyBuyer(label: string) {
    const org = await api.inject({
      method: 'POST',
      url: '/v1/orgs',
      payload: { name: `${label} Org`, owner: { email: `${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}@example.test`, name: 'Owner' } },
    });
    expect(org.statusCode, org.body).toBe(201);
    const orgId = org.json<{ org: { id: string } }>().org.id;
    await store.pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);

    const agent = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: `${label} buyer` },
    });
    expect(agent.statusCode, agent.body).toBe(201);
    const agentId = agent.json<{ agent: { id: string } }>().agent.id;
    const connection = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime' },
    });
    expect(connection.statusCode, connection.body).toBe(201);
    const secret = connection.json<{ secret: string }>().secret;
    expect((await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Treasury' },
    })).statusCode).toBe(201);
    expect((await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['exact_base'],
        budget_usdc: '5',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2',
        status: 'active',
      },
    })).statusCode).toBe(200);
    return { agentId, orgId, secret };
  }

  async function allowDestination(orgId: string, address: string) {
    await store.pool.query(
      `INSERT INTO payment_destination_allowlist (id, org_id, chain, address, label, source, created_by)
       VALUES ($1, $2, 'base', $3, 'Test merchant', 'marketplace', 'usr_owner')`,
      [`payto_${orgId}_${address}`, orgId, address.toLowerCase()],
    );
  }

  it('refuses to sign for an unlisted destination', async () => {
    merchantPayTo = '0xattacker000000000000000000000000000001';
    const { secret } = await createReadyBuyer('PayTo Unlisted');

    const response = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        idempotency_key: 'payto-unlisted-key',
        request: { url: merchantUrl, method: 'GET' as const, headers: [] },
      },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ error: 'payment_destination_not_allowed' });
  });

  it('signs for an allowlisted destination', async () => {
    merchantPayTo = '0xmerchant000000000000000000000000000001';
    const { orgId, secret } = await createReadyBuyer('PayTo Allowlisted');
    await allowDestination(orgId, merchantPayTo);

    const response = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        idempotency_key: 'payto-allowlisted-key',
        request: { url: merchantUrl, method: 'GET' as const, headers: [] },
      },
    });
    expect(response.statusCode, response.body).not.toBe(409);
  });

  it('matches addresses case-insensitively', async () => {
    // EVM addresses vary in checksum casing between providers.
    merchantPayTo = '0xABCDEF0000000000000000000000000000abc1';
    const { orgId, secret } = await createReadyBuyer('PayTo Case Insensitive');
    await allowDestination(orgId, merchantPayTo.toLowerCase());

    const response = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        idempotency_key: 'payto-case-insensitive-key',
        request: { url: merchantUrl, method: 'GET' as const, headers: [] },
      },
    });
    expect(response.statusCode, response.body).not.toBe(409);
  });
});
