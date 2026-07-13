import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import type {
  CircleGatewayX402SettlementResult,
  CircleTreasuryProvider,
} from '../../src/engines/payments/circle-provider.js';
import { createX402ResultCryptoCodec } from '../../src/engines/payments/x402-result-crypto.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

describe('durable x402 paid HTTP flow', () => {
  let api: FastifyInstance;
  let merchant: FastifyInstance;
  let merchantUrl: string;
  let store: PostgresTestStore;
  let discoveryCalls = 0;
  let providerCalls = 0;
  let providerOutcome: 'base64' | 'failed' | 'settled' | 'unknown' = 'settled';
  let crashAfterProviderEvidence = false;
  let crashAfterReserved = false;
  let resumeReserved = false;

  function settlementResult(): CircleGatewayX402SettlementResult {
    if (providerOutcome === 'failed' || providerOutcome === 'unknown') {
      return {
        network: 'eip155:84532',
        payment: {
          errorCode: providerOutcome === 'failed' ? 'provider_pre_submit_failed' : 'provider_ambiguous',
          network: 'eip155:84532',
          status: providerOutcome,
        },
        providerMode: 'test',
        success: false,
      };
    }
    const response = providerOutcome === 'base64'
      ? {
          body: 'cHJpdmF0ZS1iaW5hcnktcHJvb2Y=',
          bodyEncoding: 'base64' as const,
          contentType: 'application/octet-stream',
          headers: [['content-type', 'application/octet-stream']] as const,
          sizeBytes: 20,
          status: 200,
          truncated: false as const,
        }
      : {
          body: { delivered: false, reason: 'merchant validation failed' },
          bodyEncoding: 'json' as const,
          contentType: 'application/json',
          headers: [['content-type', 'application/json']] as const,
          sizeBytes: 57,
          status: 422,
          truncated: false as const,
        };
    return {
      network: 'eip155:84532',
      payment: {
        network: 'eip155:84532',
        payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        receipt: { privateProof: 'proof-must-be-encrypted' },
        status: 'settled',
        transaction: '0xpaid',
      },
      providerMode: 'test',
      response,
      success: true,
    };
  }

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
      return settlementResult();
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
        resource: {
          url: resourceUrl,
          category: 'market-data',
          description: 'Market data',
          mimeType: 'application/json',
        },
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
        orchestrationHooks: {
          afterProviderEvidence: () => {
            if (crashAfterProviderEvidence) throw new Error('test_crash_after_provider_evidence');
          },
          afterReserved: () => {
            if (crashAfterReserved) throw new Error('test_crash_after_reserved');
          },
          canResumeReserved: () => resumeReserved,
        },
      },
      policy: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }),
      },
      approvals: {
        pool: store.pool,
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

  async function createReadyBuyer(label: string, access: {
    readonly budget?: string;
    readonly cap?: string;
  } = {}) {
    const org = await api.inject({
      method: 'POST',
      url: '/v1/orgs',
      payload: {
        name: `${label} Org`,
        owner: { email: `${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}@example.test`, name: 'Owner' },
      },
    });
    expect(org.statusCode, org.body).toBe(201);
    const orgId = org.json<{ org: { id: string } }>().org.id;
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
    const treasury = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);
    const paymentAccess = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['exact_base'],
        budget_usdc: access.budget ?? '5',
        dedicated_wallet_required: false,
        per_request_cap_usdc: access.cap ?? '2',
        status: 'active',
      },
    });
    expect(paymentAccess.statusCode, paymentAccess.body).toBe(200);
    return { agentId, orgId, secret };
  }

  async function activateApprovalPolicy(orgId: string, agentId: string): Promise<void> {
    const draft = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts`,
      payload: {
        name: 'Approve paid market data',
        description: 'Canonical paid HTTP approval policy.',
        category: 'capability',
        source: 'structured',
        statements: [{
          id: 'stmt_paid_http_approval',
          actions: ['payment.x402.authorize'],
          audit: 'standard',
          conditions: {
            payment: { assets: ['USDC'], minAmount: '0.01', networks: ['base'] },
            resource: { categories: ['market-data'] },
          },
          decision: 'approval_required',
          target: { types: ['agent'] },
        }],
      },
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const draftId = draft.json<{ draft: { id: string } }>().draft.id;
    expect((await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts/${draftId}/validate`,
    })).statusCode).toBe(200);
    const activated = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts/${draftId}/activate`,
    });
    expect(activated.statusCode, activated.body).toBe(200);
    const policy = activated.json<{ policy: { id: string; version: number } }>().policy;
    expect((await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.id}/bindings`,
      payload: { policy_version: policy.version, target_id: agentId, target_type: 'agent' },
    })).statusCode).toBe(201);
  }

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

  it('holds one reservation for approval and resumes the same key without rediscovery', async () => {
    providerOutcome = 'settled';
    providerCalls = 0;
    discoveryCalls = 0;
    const { agentId, orgId, secret } = await createReadyBuyer('Approval Resume');
    await activateApprovalPolicy(orgId, agentId);
    const payload = {
      idempotency_key: 'approval-resume-key',
      request: { url: merchantUrl, method: 'GET' as const, headers: [] },
    };
    const gated = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(gated.statusCode, gated.body).toBe(409);
    const approval = gated.json<{ approvalId: string; decisionId: string; error: string }>();
    expect(approval).toMatchObject({ error: 'policy_requires_approval' });
    const held = await store.pool.query<{
      attempt_status: string;
      reservation_status: string;
      reserved_usdc: string;
    }>(
      `SELECT attempt.status AS attempt_status,
              reservation.status AS reservation_status,
              account.reserved_usdc::text
         FROM runtime_payment_attempts AS attempt
         JOIN payment_reservations AS reservation
           ON reservation.reason_code = 'x402_attempt:' || attempt.id
         JOIN agent_payment_accounts AS account ON account.agent_id = attempt.agent_id
        WHERE attempt.idempotency_key = $1`,
      [payload.idempotency_key],
    );
    expect(held.rows[0]).toEqual({
      attempt_status: 'reserved',
      reservation_status: 'reserved',
      reserved_usdc: '0.010000',
    });
    expect(providerCalls).toBe(0);
    expect((await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/approvals/${approval.approvalId}/approve`,
      payload: { note: 'Approved exact canonical request.' },
    })).statusCode).toBe(200);

    const paid = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json()).toMatchObject({ payment: { status: 'settled' } });
    expect(discoveryCalls).toBe(1);
    expect(providerCalls).toBe(1);
  });

  it.each([
    ['failed', 'failed', 'released', '0.000000'],
    ['unknown', 'unknown', 'reserved', '0.010000'],
  ] as const)('finalizes %s once and never retries the provider', async (
    outcome,
    attemptStatus,
    reservationStatus,
    reservedUsdc,
  ) => {
    providerOutcome = outcome;
    providerCalls = 0;
    discoveryCalls = 0;
    const { agentId, secret } = await createReadyBuyer(`Terminal ${outcome}`);
    const payload = {
      idempotency_key: `terminal-${outcome}`,
      request: { url: merchantUrl, method: 'GET' as const, headers: [] },
    };
    const first = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ payment: { status: attemptStatus } });
    const state = await store.pool.query<{
      attempt_status: string;
      reservation_status: string;
      reserved_usdc: string;
      spent_usdc: string;
    }>(
      `SELECT attempt.status AS attempt_status,
              reservation.status AS reservation_status,
              account.reserved_usdc::text,
              account.spent_usdc::text
         FROM runtime_payment_attempts AS attempt
         JOIN payment_reservations AS reservation
           ON reservation.reason_code = 'x402_attempt:' || attempt.id
         JOIN agent_payment_accounts AS account ON account.agent_id = attempt.agent_id
        WHERE attempt.agent_id = $1 AND attempt.idempotency_key = $2`,
      [agentId, payload.idempotency_key],
    );
    expect(state.rows[0]).toEqual({
      attempt_status: attemptStatus,
      reservation_status: reservationStatus,
      reserved_usdc: reservedUsdc,
      spent_usdc: '0.000000',
    });
    const replay = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(replay.json()).toEqual(first.json());
    expect(discoveryCalls).toBe(1);
    expect(providerCalls).toBe(1);
  });

  it('recovers an explicitly authorized reserved crash and provider-success evidence without repaying', async () => {
    providerOutcome = 'settled';
    providerCalls = 0;
    discoveryCalls = 0;
    crashAfterReserved = true;
    resumeReserved = false;
    const { secret } = await createReadyBuyer('Reserved Crash');
    const reservedPayload = {
      idempotency_key: 'reserved-crash-key',
      request: { url: merchantUrl, method: 'GET' as const, headers: [] },
    };
    const crashedReserved = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: reservedPayload,
    });
    expect(crashedReserved.statusCode).toBe(500);
    crashAfterReserved = false;
    resumeReserved = true;
    const resumed = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: reservedPayload,
    });
    expect(resumed.json()).toMatchObject({ payment: { status: 'settled' } });
    expect(providerCalls).toBe(1);
    expect(discoveryCalls).toBe(1);

    providerCalls = 0;
    discoveryCalls = 0;
    resumeReserved = false;
    crashAfterProviderEvidence = true;
    const second = await createReadyBuyer('Provider Evidence Crash');
    const evidencePayload = {
      idempotency_key: 'provider-evidence-crash-key',
      request: { url: merchantUrl, method: 'GET' as const, headers: [] },
    };
    const crashedProvider = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${second.secret}` },
      payload: evidencePayload,
    });
    expect(crashedProvider.statusCode).toBe(500);
    crashAfterProviderEvidence = false;
    const recovered = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${second.secret}` },
      payload: evidencePayload,
    });
    expect(recovered.json()).toMatchObject({ payment: { status: 'settled' } });
    expect(providerCalls).toBe(1);
    expect(discoveryCalls).toBe(1);
  });

  it('caches binary privately and returns settled truth after result expiry without repayment', async () => {
    providerOutcome = 'base64';
    providerCalls = 0;
    discoveryCalls = 0;
    const { agentId, secret } = await createReadyBuyer('Binary Expiry');
    const payload = {
      idempotency_key: 'binary-expiry-key',
      request: { url: merchantUrl, method: 'GET' as const, headers: [] },
    };
    const first = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(first.json()).toMatchObject({
      payment: { status: 'settled', responseAvailable: true },
      response: { body: 'cHJpdmF0ZS1iaW5hcnktcHJvb2Y=', bodyEncoding: 'base64' },
    });
    const plaintext = await store.pool.query<{ db_text: string }>(
      `SELECT concat_ws(' ', attempt.encrypted_result::text, event.result::text,
                        COALESCE(activity.payload::text, ''), COALESCE(audit.payload::text, '')) AS db_text
         FROM runtime_payment_attempts AS attempt
         LEFT JOIN payment_events AS event ON event.agent_id = attempt.agent_id
         LEFT JOIN activity_items AS activity ON activity.id = event.activity_id
         LEFT JOIN audit_events AS audit ON audit.org_id = attempt.org_id AND audit.event_type = 'payment.x402.settled'
        WHERE attempt.agent_id = $1 AND attempt.idempotency_key = $2
        LIMIT 1`,
      [agentId, payload.idempotency_key],
    );
    expect(plaintext.rows[0]?.db_text).not.toContain('private-binary-proof');
    expect(plaintext.rows[0]?.db_text).not.toContain('proof-must-be-encrypted');
    await store.pool.query(
      `UPDATE runtime_payment_attempts SET result_expires_at = now() - interval '1 second'
        WHERE agent_id = $1 AND idempotency_key = $2`,
      [agentId, payload.idempotency_key],
    );
    const expired = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(expired.json()).toMatchObject({
      payment: { status: 'settled', responseAvailable: false },
    });
    expect(expired.json()).not.toHaveProperty('response');
    expect(providerCalls).toBe(1);
    expect(discoveryCalls).toBe(1);
  });
});
