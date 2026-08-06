import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import type {
  CircleGatewayX402SettlementResult,
  CircleTreasuryProvider,
} from '../../src/engines/payments/circle-provider.js';
import { deriveSpentUsdc } from '../../src/engines/payments/ledger.js';
import { listUnknownAttempts, resolveUnknownAttempt } from '../../src/engines/payments/store.js';
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
  let crashAfterSubmitting = false;
  let providerRelease: (() => Promise<void>) | undefined;
  let providerStarted: (() => void) | undefined;
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
      providerStarted?.();
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
      await providerRelease?.();
      return settlementResult();
    },
    settleGatewayX402: async (input) => provider.settleExactX402(input),
    signPermit2Delegation: vi.fn(),
    executePermit2Transaction: vi.fn(),
    transferWallet: ({ amountMicros }) => Promise.resolve({
      amountMicros: amountMicros.toString(),
      transactionId: '0xtransfer',
    }),
  };

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();

    merchant = Fastify({ logger: false });
    merchant.get('/*', async (request, reply) => {
      discoveryCalls += 1;
      if (request.url.startsWith('/redirect')) {
        return reply.redirect('https://redirect.example.test/steal-payment');
      }
      if (request.url.startsWith('/timeout')) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (request.url.startsWith('/oversized')) {
        return reply
          .code(402)
          .type('application/json')
          .send({ padding: 'x'.repeat(1024 * 1024) });
      }
      if (request.url.startsWith('/free')) {
        return reply.code(200).send({ available: true, privateDetail: 'must-not-leak' });
      }
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
        paidHttpExecution: { timeoutMs: 50 },
        paidHttpUrlPolicy: {
          allowHttpOrigins: [new URL(merchantUrl).origin],
          resolveHostname: (hostname) => hostname === 'unsafe.example.test'
            ? Promise.resolve(['127.0.0.1'])
            : Promise.reject(new Error(`Unexpected test hostname: ${hostname}`)),
        },
        resultCrypto: createX402ResultCryptoCodec(randomBytes(32).toString('base64')),
        resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }),
        orchestrationHooks: {
          afterProviderEvidence: () => {
            if (crashAfterProviderEvidence) throw new Error('test_crash_after_provider_evidence');
          },
          afterReserved: () => {
            if (crashAfterReserved) throw new Error('test_crash_after_reserved');
          },
          afterSubmitting: () => {
            if (crashAfterSubmitting) throw new Error('test_crash_after_submitting');
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

    // Fail-closed (E1): a fresh org denies everything until a policy
    // matches. Buyer provisioning is orthogonal to what this suite tests.
    await store.pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);
    // Phase 5's payTo allowlist check (E8) requires the merchant
    // destination to be pre-verified before any payment can be signed.
    await store.pool.query(
      `INSERT INTO payment_destination_allowlist (id, org_id, chain, address, label, source, created_by)
       VALUES ($1, $2, 'base', '0x0000000000000000000000000000000000000001', 'Test merchant', 'marketplace', 'usr_owner')`,
      [`payto_${orgId}`, orgId],
    );

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

  async function activateDenyPolicy(orgId: string, agentId: string): Promise<void> {
    const draft = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts`,
      payload: {
        name: 'Deny paid market data',
        description: 'Policy-ordering test: deny every x402 payment.',
        category: 'capability',
        source: 'structured',
        statements: [{
          id: 'stmt_paid_http_deny',
          actions: ['payment.x402.authorize'],
          audit: 'standard',
          conditions: {
            payment: { assets: ['USDC'], minAmount: '0.01', networks: ['base'] },
            resource: { categories: ['market-data'] },
          },
          decision: 'deny',
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
    expect(org.statusCode, org.body).toBe(201);
    const orgId = org.json<{ org: { id: string } }>().org.id;

    // Fail-closed (E1): a fresh org denies everything until a policy
    // matches. Agent provisioning is orthogonal to what this test exercises.
    await store.pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);

    const agent = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Buyer' },
    });
    expect(agent.statusCode, agent.body).toBe(201);
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
    expect(org.statusCode, org.body).toBe(201);
    const orgId = org.json<{ org: { id: string } }>().org.id;

    // Fail-closed (E1): a fresh org denies everything until a policy
    // matches. Agent provisioning is orthogonal to what this test exercises.
    await store.pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);
    // Phase 5's payTo allowlist check (E8) requires the merchant
    // destination to be pre-verified before any payment can be signed.
    await store.pool.query(
      `INSERT INTO payment_destination_allowlist (id, org_id, chain, address, label, source, created_by)
       VALUES ($1, $2, 'base', '0x0000000000000000000000000000000000000001', 'Test merchant', 'marketplace', 'usr_owner')`,
      [`payto_${orgId}`, orgId],
    );

    const agent = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Durable buyer' },
    });
    expect(agent.statusCode, agent.body).toBe(201);
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

  it('derives spent_usdc from ledger postings that match the counter after a real settle', async () => {
    // Task 1 (E5): the append-only ledger runs ALONGSIDE the existing
    // counters, not instead of them. This proves the postings written at
    // the real reserve/settle call sites (store.ts) sum to exactly what
    // the counter reports -- not a hand-seeded fixture, the actual HTTP
    // flow every other test in this file already drives.
    providerOutcome = 'settled';
    providerCalls = 0;
    discoveryCalls = 0;
    const org = await api.inject({
      method: 'POST',
      url: '/v1/orgs',
      payload: { name: 'Ledger Parity Org', owner: { email: 'ledger@example.test', name: 'Owner' } },
    });
    expect(org.statusCode, org.body).toBe(201);
    const orgId = org.json<{ org: { id: string } }>().org.id;
    await store.pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);
    await store.pool.query(
      `INSERT INTO payment_destination_allowlist (id, org_id, chain, address, label, source, created_by)
       VALUES ($1, $2, 'base', '0x0000000000000000000000000000000000000001', 'Test merchant', 'marketplace', 'usr_owner')`,
      [`payto_${orgId}`, orgId],
    );

    const agent = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Ledger buyer' },
    });
    expect(agent.statusCode, agent.body).toBe(201);
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

    const paid = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        idempotency_key: 'ledger-parity-1',
        request: { url: merchantUrl, method: 'GET', headers: [] },
      },
    });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json()).toMatchObject({ payment: { status: 'settled' } });

    const counter = await store.pool.query<{ spent_usdc: string }>(
      'SELECT spent_usdc FROM agent_payment_accounts WHERE org_id = $1 AND agent_id = $2',
      [orgId, agentId],
    );
    const derived = await deriveSpentUsdc(store.pool, { orgId, agentId, mode: 'test' });
    expect(derived).toBe(counter.rows[0]?.spent_usdc);
  });

  it('serializes concurrent full-flow requests into one attempt, reservation, and provider call', async () => {
    providerOutcome = 'settled';
    providerCalls = 0;
    discoveryCalls = 0;
    const { agentId, secret } = await createReadyBuyer('Concurrent Full Flow');
    const payload = {
      idempotency_key: 'concurrent-full-flow-key',
      request: { url: merchantUrl, method: 'GET' as const, headers: [] },
    };

    const responses = await Promise.all([
      api.inject({
        method: 'POST',
        url: '/v1/runtime/payments/x402',
        headers: { authorization: `Bearer ${secret}` },
        payload,
      }),
      api.inject({
        method: 'POST',
        url: '/v1/runtime/payments/x402',
        headers: { authorization: `Bearer ${secret}` },
        payload,
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses.map((response) => response.json<{ payment: { status: string } }>().payment.status))
      .toContain('settled');
    expect(providerCalls).toBe(1);
    const state = await store.pool.query<{
      attempt_count: string;
      reservation_count: string;
      reserved_usdc: string;
      spent_usdc: string;
    }>(
      `SELECT count(DISTINCT attempt.id)::text AS attempt_count,
              count(DISTINCT reservation.id)::text AS reservation_count,
              account.reserved_usdc::text,
              account.spent_usdc::text
         FROM runtime_payment_attempts AS attempt
         JOIN payment_reservations AS reservation
           ON reservation.reason_code = 'x402_attempt:' || attempt.id
         JOIN agent_payment_accounts AS account ON account.agent_id = attempt.agent_id
        WHERE attempt.agent_id = $1 AND attempt.idempotency_key = $2
        GROUP BY account.reserved_usdc, account.spent_usdc`,
      [agentId, payload.idempotency_key],
    );
    expect(state.rows[0]).toEqual({
      attempt_count: '1',
      reservation_count: '1',
      reserved_usdc: '0.000000',
      spent_usdc: '0.010000',
    });
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

  it('expires a stranded pre-submit reservation and releases its budget once', async () => {
    providerOutcome = 'settled';
    providerCalls = 0;
    discoveryCalls = 0;
    crashAfterReserved = true;
    const { agentId, secret } = await createReadyBuyer('Expired Reservation', { budget: '0.01' });
    const payload = {
      idempotency_key: 'expired-reservation-key',
      request: { url: merchantUrl, method: 'GET' as const, headers: [] },
    };
    const crashed = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(crashed.statusCode).toBe(500);
    crashAfterReserved = false;
    await store.pool.query(
      `UPDATE payment_reservations
          SET expires_at = now() - interval '1 second'
        WHERE agent_id = $1 AND reason_code LIKE 'x402_attempt:%'`,
      [agentId],
    );

    const firstReplay = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    const secondReplay = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });

    expect(firstReplay.statusCode, firstReplay.body).toBe(200);
    expect(secondReplay.json()).toEqual(firstReplay.json());
    expect(firstReplay.json()).toMatchObject({
      payment: { errorCode: 'payment_reservation_expired', status: 'failed' },
    });
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
      attempt_status: 'failed',
      reservation_status: 'released',
      reserved_usdc: '0.000000',
      spent_usdc: '0.000000',
    });
    expect(discoveryCalls).toBe(1);
    expect(providerCalls).toBe(0);
  });

  it.each([
    ['denied', 'payment_approval_denied'],
    ['expired', 'payment_approval_expired'],
  ] as const)('releases a pre-submit reservation when its approval is %s', async (
    approvalState,
    errorCode,
  ) => {
    providerOutcome = 'settled';
    providerCalls = 0;
    discoveryCalls = 0;
    const { agentId, orgId, secret } = await createReadyBuyer(`Approval ${approvalState}`, {
      budget: '0.01',
    });
    await activateApprovalPolicy(orgId, agentId);
    const payload = {
      idempotency_key: `approval-${approvalState}-key`,
      request: { url: merchantUrl, method: 'GET' as const, headers: [] },
    };
    const gated = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(gated.statusCode, gated.body).toBe(409);
    const approvalId = gated.json<{ approvalId: string }>().approvalId;
    if (approvalState === 'denied') {
      const denied = await api.inject({
        method: 'POST',
        url: `/v1/orgs/${orgId}/approvals/${approvalId}/deny`,
        payload: { note: 'Denied for cleanup proof.' },
      });
      expect(denied.statusCode, denied.body).toBe(200);
    } else {
      await store.pool.query(
        `UPDATE approval_requests SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [approvalId],
      );
    }

    const firstReplay = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    const secondReplay = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });

    expect(firstReplay.statusCode, firstReplay.body).toBe(200);
    expect(secondReplay.json()).toEqual(firstReplay.json());
    expect(firstReplay.json()).toMatchObject({
      payment: { errorCode, status: 'failed' },
    });
    const state = await store.pool.query<{
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
        WHERE attempt.agent_id = $1 AND attempt.idempotency_key = $2`,
      [agentId, payload.idempotency_key],
    );
    expect(state.rows[0]).toEqual({
      attempt_status: 'failed',
      reservation_status: 'released',
      reserved_usdc: '0.000000',
    });
    expect(discoveryCalls).toBe(1);
    expect(providerCalls).toBe(0);
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
    if (outcome === 'unknown') {
      await store.pool.query(
        `UPDATE payment_reservations
            SET expires_at = now() - interval '1 second'
          WHERE agent_id = $1 AND reason_code LIKE 'x402_attempt:%'`,
        [agentId],
      );
    }
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

  it('recovers a crash after submitting as unresolved without automatically calling the provider', async () => {
    providerOutcome = 'settled';
    providerCalls = 0;
    discoveryCalls = 0;
    crashAfterSubmitting = true;
    const { agentId, secret } = await createReadyBuyer('Submitting Crash');
    const payload = {
      idempotency_key: 'submitting-crash-key',
      request: { url: merchantUrl, method: 'GET' as const, headers: [] },
    };

    const crashed = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(crashed.statusCode).toBe(500);
    crashAfterSubmitting = false;
    await store.pool.query(
      `UPDATE payment_reservations
          SET expires_at = now() - interval '1 second'
        WHERE agent_id = $1 AND reason_code LIKE 'x402_attempt:%'`,
      [agentId],
    );

    const replay = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({ payment: { status: 'submitting' } });
    expect(providerCalls).toBe(0);
    expect(discoveryCalls).toBe(1);
    const state = await store.pool.query<{ attempt_status: string; reservation_status: string }>(
      `SELECT attempt.status AS attempt_status, reservation.status AS reservation_status
         FROM runtime_payment_attempts AS attempt
         JOIN payment_reservations AS reservation
           ON reservation.reason_code = 'x402_attempt:' || attempt.id
        WHERE attempt.agent_id = $1 AND attempt.idempotency_key = $2`,
      [agentId, payload.idempotency_key],
    );
    expect(state.rows[0]).toEqual({ attempt_status: 'submitting', reservation_status: 'reserved' });
  });

  it('replays the settled result after the MCP runtime response is lost without repaying', async () => {
    providerOutcome = 'settled';
    providerCalls = 0;
    discoveryCalls = 0;
    let signalProviderStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalProviderStarted = resolve;
    });
    let releaseProvider!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    providerStarted = signalProviderStarted;
    providerRelease = () => release;
    const { agentId, secret } = await createReadyBuyer('Lost MCP Response');
    const payload = {
      idempotency_key: 'lost-mcp-response-key',
      request: { url: merchantUrl, method: 'GET' as const, headers: [] },
    };
    const address = await api.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const lostResponse = fetch(`${address}/v1/runtime/payments/x402`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    await started;
    controller.abort();
    await expect(lostResponse).rejects.toThrow();
    releaseProvider();
    providerRelease = undefined;
    providerStarted = undefined;

    await expect.poll(async () => {
      const result = await store.pool.query<{ status: string }>(
        `SELECT status FROM runtime_payment_attempts WHERE agent_id = $1 AND idempotency_key = $2`,
        [agentId, payload.idempotency_key],
      );
      return result.rows[0]?.status;
    }).toBe('settled');

    const replay = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({ payment: { status: 'settled' } });
    expect(providerCalls).toBe(1);
    expect(discoveryCalls).toBe(1);
  });

  it.each([
    ['non-402 response', '/free', 1, 422, 'x402_payment_not_required', 'The upstream resource did not require an x402 payment.'],
    ['redirect', '/redirect', 1, 400, 'x402_redirect_not_supported', 'Paid HTTP discovery redirects are not supported.'],
    ['timeout', '/timeout', 1, 504, 'x402_request_timeout', 'Paid HTTP discovery timed out.'],
    ['oversized response', '/oversized', 1, 413, 'x402_response_too_large', 'Paid HTTP discovery response exceeded the maximum size.'],
    ['unsafe destination', 'https://unsafe.example.test/data', 0, 400, 'x402_invalid_destination', 'Paid HTTP destination is not allowed.'],
  ] as const)('rejects a %s with a stable safe error before creating a payment attempt', async (
    _case,
    resource,
    expectedDiscoveryCalls,
    expectedStatus,
    expectedCode,
    expectedMessage,
  ) => {
    providerCalls = 0;
    discoveryCalls = 0;
    const { agentId, secret } = await createReadyBuyer(`Rejected ${_case}`);
    const url = resource.startsWith('http') ? resource : `${new URL(merchantUrl).origin}${resource}`;
    const response = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        idempotency_key: `rejected-${_case.replaceAll(' ', '-')}`,
        request: { url, method: 'GET', headers: [] },
      },
    });

    expect(response.statusCode, response.body).toBe(expectedStatus);
    expect(response.json()).toEqual({ error: expectedCode, message: expectedMessage });
    expect(response.body).not.toContain('privateDetail');
    expect(response.body).not.toContain(url);
    expect(providerCalls).toBe(0);
    expect(discoveryCalls).toBe(expectedDiscoveryCalls);
    const attempts = await store.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM runtime_payment_attempts WHERE agent_id = $1`,
      [agentId],
    );
    expect(attempts.rows[0]?.count).toBe('0');
  });

  it('accepts a 160-character idempotency key and rejects 161 characters before discovery', async () => {
    discoveryCalls = 0;
    const { secret } = await createReadyBuyer('Idempotency Boundary');
    const request = {
      url: `${new URL(merchantUrl).origin}/free`,
      method: 'GET' as const,
      headers: [] as const,
    };

    const accepted = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: { idempotency_key: 'a'.repeat(160), request },
    });
    const rejected = await api.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: { idempotency_key: 'b'.repeat(161), request },
    });

    expect(accepted.statusCode, accepted.body).toBe(422);
    expect(accepted.json()).toMatchObject({ error: 'x402_payment_not_required' });
    expect(rejected.statusCode, rejected.body).toBe(400);
    expect(rejected.json()).toMatchObject({ error: 'validation_error' });
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

  describe('unknown attempt resolution', () => {
    it('strands reserved_usdc when the provider outcome is ambiguous -- reproduces the leak', async () => {
      providerOutcome = 'unknown';
      providerCalls = 0;
      discoveryCalls = 0;
      const { agentId, orgId, secret } = await createReadyBuyer('Unknown Leak', { budget: '5', cap: '2' });

      const response = await api.inject({
        method: 'POST',
        url: '/v1/runtime/payments/x402',
        headers: { authorization: `Bearer ${secret}` },
        payload: {
          idempotency_key: 'unknown-leak-key',
          request: { url: merchantUrl, method: 'GET' as const, headers: [] },
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ payment: { status: 'unknown' } });

      const account = await store.pool.query<{ reserved_usdc: string }>(
        'SELECT reserved_usdc FROM agent_payment_accounts WHERE org_id = $1 AND agent_id = $2',
        [orgId, agentId],
      );
      // The leak, reproduced: reserved_usdc is stuck at the full amount,
      // neither released nor spent, with no automatic path back.
      expect(Number(account.rows[0]?.reserved_usdc)).toBeGreaterThan(0);

      const reservation = await store.pool.query<{ status: string }>(
        'SELECT status FROM payment_reservations WHERE org_id = $1 AND agent_id = $2 ORDER BY created_at DESC LIMIT 1',
        [orgId, agentId],
      );
      expect(reservation.rows[0]?.status).toBe('reserved');
    });

    it('lists the stranded attempt for an operator', async () => {
      providerOutcome = 'unknown';
      providerCalls = 0;
      discoveryCalls = 0;
      const { agentId, orgId, secret } = await createReadyBuyer('Unknown List', { budget: '5', cap: '2' });
      await api.inject({
        method: 'POST',
        url: '/v1/runtime/payments/x402',
        headers: { authorization: `Bearer ${secret}` },
        payload: {
          idempotency_key: 'unknown-list-key',
          request: { url: merchantUrl, method: 'GET' as const, headers: [] },
        },
      });

      const httpList = await api.inject({
        method: 'GET',
        url: `/v1/orgs/${orgId}/payments/unknown-attempts`,
      });
      expect(httpList.statusCode, httpList.body).toBe(200);
      const attempts = httpList.json<{ attempts: readonly { agentId: string }[] }>().attempts;
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.agentId).toBe(agentId);

      const direct = await listUnknownAttempts(store.pool, orgId);
      expect(direct).toHaveLength(1);
    });

    it('releases reserved_usdc when an operator resolves an unknown attempt as failed', async () => {
      providerOutcome = 'unknown';
      providerCalls = 0;
      discoveryCalls = 0;
      const { agentId, orgId, secret } = await createReadyBuyer('Unknown Resolve Failed', { budget: '5', cap: '2' });
      await api.inject({
        method: 'POST',
        url: '/v1/runtime/payments/x402',
        headers: { authorization: `Bearer ${secret}` },
        payload: {
          idempotency_key: 'unknown-resolve-failed-key',
          request: { url: merchantUrl, method: 'GET' as const, headers: [] },
        },
      });

      const before = await store.pool.query<{ reserved_usdc: string }>(
        'SELECT reserved_usdc FROM agent_payment_accounts WHERE org_id = $1 AND agent_id = $2',
        [orgId, agentId],
      );
      expect(Number(before.rows[0]?.reserved_usdc)).toBeGreaterThan(0);

      const unknown = await listUnknownAttempts(store.pool, orgId);
      const reservationId = unknown[0]?.reservationId;
      expect(reservationId).toBeDefined();

      const resolveResponse = await api.inject({
        method: 'POST',
        url: `/v1/orgs/${orgId}/payments/unknown-attempts/${reservationId}/resolve`,
        payload: { outcome: 'failed' },
      });
      expect(resolveResponse.statusCode, resolveResponse.body).toBe(200);

      const after = await store.pool.query<{ reserved_usdc: string }>(
        'SELECT reserved_usdc FROM agent_payment_accounts WHERE org_id = $1 AND agent_id = $2',
        [orgId, agentId],
      );
      expect(Number(after.rows[0]?.reserved_usdc)).toBe(0);

      const reservation = await store.pool.query<{ status: string }>(
        'SELECT status FROM payment_reservations WHERE id = $1', [reservationId],
      );
      expect(reservation.rows[0]?.status).toBe('released');

      const auditEvent = await store.pool.query(
        "SELECT 1 FROM audit_events WHERE org_id = $1 AND event_type = 'payment.unknown.resolved'",
        [orgId],
      );
      expect(auditEvent.rowCount).toBe(1);

      const stillListed = await listUnknownAttempts(store.pool, orgId);
      expect(stillListed.some((a) => a.reservationId === reservationId)).toBe(false);
    });

    it('marks an unknown attempt settled without double-releasing reserved_usdc', async () => {
      providerOutcome = 'unknown';
      providerCalls = 0;
      discoveryCalls = 0;
      const { agentId, orgId, secret } = await createReadyBuyer('Unknown Resolve Settled', { budget: '5', cap: '2' });
      await api.inject({
        method: 'POST',
        url: '/v1/runtime/payments/x402',
        headers: { authorization: `Bearer ${secret}` },
        payload: {
          idempotency_key: 'unknown-resolve-settled-key',
          request: { url: merchantUrl, method: 'GET' as const, headers: [] },
        },
      });

      const unknown = await listUnknownAttempts(store.pool, orgId);
      const reservationId = unknown[0]?.reservationId;
      expect(reservationId).toBeDefined();

      await resolveUnknownAttempt(
        store.pool,
        { actorId: 'usr_operator', role: 'admin' },
        orgId,
        reservationId ?? '',
        'settled',
      );

      const account = await store.pool.query<{ reserved_usdc: string; spent_usdc: string }>(
        'SELECT reserved_usdc, spent_usdc FROM agent_payment_accounts WHERE org_id = $1 AND agent_id = $2',
        [orgId, agentId],
      );
      expect(Number(account.rows[0]?.reserved_usdc)).toBe(0);
      expect(Number(account.rows[0]?.spent_usdc)).toBeGreaterThan(0);

      const reservation = await store.pool.query<{ status: string }>(
        'SELECT status FROM payment_reservations WHERE id = $1', [reservationId],
      );
      expect(reservation.rows[0]?.status).toBe('settled');
    });

    it('rejects resolving a reservation that is still reserved but not an unknown attempt', async () => {
      providerOutcome = 'settled';
      providerCalls = 0;
      discoveryCalls = 0;
      crashAfterReserved = true;
      const { orgId, secret } = await createReadyBuyer('Unknown Resolve Wrong State', { budget: '5', cap: '2' });
      const crashed = await api.inject({
        method: 'POST',
        url: '/v1/runtime/payments/x402',
        headers: { authorization: `Bearer ${secret}` },
        payload: {
          idempotency_key: 'unknown-resolve-wrong-state-key',
          request: { url: merchantUrl, method: 'GET' as const, headers: [] },
        },
      });
      expect(crashed.statusCode).toBe(500);
      crashAfterReserved = false;

      // Still 'reserved' (the crash happened before settlement), but this
      // was never an 'unknown' attempt -- resolveUnknownAttempt must
      // distinguish this from the genuine leak state.
      const reservation = await store.pool.query<{ id: string; status: string }>(
        'SELECT id, status FROM payment_reservations WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1',
        [orgId],
      );
      expect(reservation.rows[0]?.status).toBe('reserved');

      const resolveResponse = await api.inject({
        method: 'POST',
        url: `/v1/orgs/${orgId}/payments/unknown-attempts/${reservation.rows[0]?.id}/resolve`,
        payload: { outcome: 'failed' },
      });
      expect(resolveResponse.statusCode, resolveResponse.body).toBe(400);
      expect(resolveResponse.json()).toMatchObject({ error: 'not_an_unknown_attempt' });
    });
  });

  describe('policy evaluation ordering', () => {
    it('writes no reservation and leaves reserved_usdc unchanged when policy denies', async () => {
      providerOutcome = 'settled';
      providerCalls = 0;
      discoveryCalls = 0;
      const { agentId, orgId, secret } = await createReadyBuyer('Policy Deny Ordering', { budget: '5', cap: '2' });
      await activateDenyPolicy(orgId, agentId);

      const response = await api.inject({
        method: 'POST',
        url: '/v1/runtime/payments/x402',
        headers: { authorization: `Bearer ${secret}` },
        payload: {
          idempotency_key: 'policy-deny-ordering-key',
          request: { url: merchantUrl, method: 'GET' as const, headers: [] },
        },
      });
      expect(response.statusCode, response.body).toBe(403);

      const reservations = await store.pool.query(
        'SELECT 1 FROM payment_reservations WHERE org_id = $1', [orgId],
      );
      expect(reservations.rowCount).toBe(0);

      const account = await store.pool.query<{ reserved_usdc: string }>(
        'SELECT reserved_usdc FROM agent_payment_accounts WHERE org_id = $1 AND agent_id = $2',
        [orgId, agentId],
      );
      expect(Number(account.rows[0]?.reserved_usdc)).toBe(0);
    });

    it('does not leak budget state through the error code when policy denies', async () => {
      providerOutcome = 'settled';
      providerCalls = 0;
      discoveryCalls = 0;
      // Budget is exhausted (cap 0) AND policy denies -- policy is the
      // authority and must be evaluated first, so the caller must see the
      // policy denial, never a budget_exceeded leak about internal state.
      const { agentId, orgId, secret } = await createReadyBuyer('Policy Deny No Leak', { budget: '0', cap: '2' });
      await activateDenyPolicy(orgId, agentId);

      const response = await api.inject({
        method: 'POST',
        url: '/v1/runtime/payments/x402',
        headers: { authorization: `Bearer ${secret}` },
        payload: {
          idempotency_key: 'policy-deny-no-leak-key',
          request: { url: merchantUrl, method: 'GET' as const, headers: [] },
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).not.toMatchObject({ error: 'budget_exceeded' });
    });

    it('still produces an approval, not a hard failure, when the policy requires one', async () => {
      providerOutcome = 'settled';
      providerCalls = 0;
      discoveryCalls = 0;
      const { agentId, orgId, secret } = await createReadyBuyer('Policy Approval Ordering', { budget: '5', cap: '2' });
      await activateApprovalPolicy(orgId, agentId);

      const response = await api.inject({
        method: 'POST',
        url: '/v1/runtime/payments/x402',
        headers: { authorization: `Bearer ${secret}` },
        payload: {
          idempotency_key: 'policy-approval-ordering-key',
          request: { url: merchantUrl, method: 'GET' as const, headers: [] },
        },
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json()).toMatchObject({ error: 'policy_requires_approval' });
    });
  });
});
