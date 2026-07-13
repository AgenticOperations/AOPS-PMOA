import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { createX402ResultCryptoCodec } from '../../src/engines/payments/x402-result-crypto.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

describe('durable x402 paid HTTP flow', () => {
  let api: FastifyInstance;
  let merchant: FastifyInstance;
  let merchantUrl: string;
  let store: PostgresTestStore;
  let discoveryCalls = 0;
  let providerCalls = 0;

  const provider: CircleTreasuryProvider = {
    bridgeWalletTopUp: ({ amount, fromChain, mode, toChain }) => Promise.resolve({
      amount,
      fromChain,
      providerMode: mode,
      success: true,
      toChain,
      transaction: '0xbridge',
    }),
    createWallet: ({ chain }) => Promise.resolve({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      circleWalletId: `wallet_${chain}`,
    }),
    createWalletSet: () => Promise.resolve({ circleWalletSetId: 'wallet_set_paid_http' }),
    getGatewayBalance: ({ mode }) => Promise.resolve({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      available: '10',
      domain: 6,
      providerMode: mode,
      total: '10',
      withdrawable: '10',
      withdrawing: '0',
    }),
    getWalletBalances: ({ mode }) => Promise.resolve({
      balances: [{
        amount: '10',
        blockchain: 'BASE-SEPOLIA',
        isNative: false,
        symbol: 'USDC',
        tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      }],
      providerMode: mode,
    }),
    health: (mode = 'test') => ({ configured: true, missing: [], mode, provider: 'circle' }),
    initiateGatewayDeposit: ({ address, amountMicros, mode }) => Promise.resolve({
      amount: (Number(amountMicros) / 1_000_000).toString(),
      amountMicros: amountMicros.toString(),
      approvalTransactionId: '0xapproval',
      depositTransactionId: '0xdeposit',
      gatewayDepositorAddress: address,
      gatewayWalletAddress: address,
      providerMode: mode,
      usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    }),
    requestTestnetFunds: ({ address, chain, mode }) => Promise.resolve({
      address,
      chain,
      providerMode: mode,
      response: {},
    }),
    settleExactX402: async (input) => {
      providerCalls += 1;
      expect(input).toHaveProperty('attemptId');
      expect(input).toHaveProperty('destination');
      expect(input).toHaveProperty('request');
      const state = await store.pool.query<{ attempt_status: string; reservation_status: string }>(
        `SELECT attempt.status AS attempt_status, reservation.status AS reservation_status
           FROM runtime_payment_attempts AS attempt
           JOIN payment_reservations AS reservation
             ON reservation.reason_code = 'x402_attempt:' || attempt.id
          WHERE attempt.id = $1`,
        ['attemptId' in input ? input.attemptId : 'legacy'],
      );
      expect(state.rows[0]).toEqual({ attempt_status: 'submitting', reservation_status: 'reserved' });
      const activeTransactions = await store.pool.query<{ count: string }>(
        `SELECT count(*)::text
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND xact_start IS NOT NULL
            AND state <> 'idle'`,
      );
      expect(activeTransactions.rows[0]?.count).toBe('0');
      return {
        network: 'eip155:84532',
        payment: {
          network: 'eip155:84532',
          payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          status: 'settled',
          transaction: '0xpaid',
        },
        providerMode: 'test',
        response: {
          body: { delivered: false, reason: 'merchant validation failed' },
          bodyEncoding: 'json',
          contentType: 'application/json',
          headers: [['content-type', 'application/json']],
          sizeBytes: 57,
          status: 422,
          truncated: false,
        },
        success: true,
      };
    },
    settleGatewayX402: async (input) => provider.settleExactX402(input),
  };

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();

    merchant = Fastify({ logger: false });
    merchant.get('/*', async (request, reply) => {
      discoveryCalls += 1;
      const resourceUrl = new URL(request.url, merchantUrl).href;
      return reply.code(402).send({
        x402Version: 2,
        resource: { url: resourceUrl, description: 'Market data', mimeType: 'application/json' },
        accepts: [{
          scheme: 'exact',
          network: 'eip155:84532',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          amount: '10000',
          payTo: '0x0000000000000000000000000000000000000001',
          maxTimeoutSeconds: 60,
          extra: { name: 'USDC', version: '2' },
        }],
      });
    });
    const address = await merchant.listen({ host: '127.0.0.1', port: 0 });
    merchantUrl = `${address}/data`;

    api = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }),
      },
      payments: {
        circleProvider: provider,
        pool: store.pool,
        paidHttpUrlPolicy: { allowHttpOrigins: [new URL(merchantUrl).origin] },
        resultCrypto: createX402ResultCryptoCodec(randomBytes(32).toString('base64')),
        resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }),
      },
      runtime: { pool: store.pool },
    });
  }, 90_000);

  afterAll(async () => {
    if (api !== undefined) await api.close();
    if (merchant !== undefined) await merchant.close();
    if (store !== undefined) await store.stop();
    vi.unstubAllEnvs();
  });

  it('accepts the canonical request input and discovers the merchant quote internally', async () => {
    const org = await api.inject({
      method: 'POST',
      url: '/v1/orgs',
      payload: { name: 'Paid HTTP Org', owner: { email: 'owner@example.test', name: 'Owner' } },
    });
    const orgId = org.json<{ org: { id: string } }>().org.id;
    const agent = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Buyer' },
    });
    const agentId = agent.json<{ agent: { id: string } }>().agent.id;
    const connection = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime' },
    });
    const secret = connection.json<{ secret: string }>().secret;

    const response = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        idempotency_key: 'paid-http-discovery-1',
        request: { url: merchantUrl, method: 'GET', headers: [] },
      },
    });

    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({ error: 'payment_access_disabled' });
  });

  it('reserves before out-of-transaction provider execution and replays a settled 422 exactly once', async () => {
    discoveryCalls = 0;
    providerCalls = 0;
    const org = await api.inject({
      method: 'POST',
      url: '/v1/orgs',
      payload: { name: 'Durable Flow Org', owner: { email: 'durable@example.test', name: 'Owner' } },
    });
    const orgId = org.json<{ org: { id: string } }>().org.id;
    const agent = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Durable buyer' },
    });
    const agentId = agent.json<{ agent: { id: string } }>().agent.id;
    const connection = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime' },
    });
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

    const payload = {
      idempotency_key: 'durable-settled-422',
      request: { url: merchantUrl, method: 'GET' as const, headers: [] },
    };
    const first = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({
      payment: { status: 'settled', transaction: '0xpaid' },
      response: { status: 422, bodyEncoding: 'json' },
    });
    expect(discoveryCalls).toBe(1);
    expect(providerCalls).toBe(1);

    const replay = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(discoveryCalls).toBe(1);
    expect(providerCalls).toBe(1);

    const conflict = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        ...payload,
        request: { ...payload.request, url: `${merchantUrl}?changed=true` },
      },
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({ error: 'payment_idempotency_conflict' });
    expect(discoveryCalls).toBe(1);
    expect(providerCalls).toBe(1);
  });
});
