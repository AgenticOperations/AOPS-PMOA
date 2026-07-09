import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type OrgResponse = {
  readonly org: {
    readonly id: string;
  };
};

type AgentResponse = {
  readonly agent: {
    readonly id: string;
  };
};

type ConnectionCreateResponse = {
  readonly secret: string;
};

type PaymentSourceResponse = {
  readonly source: {
    readonly id: string;
    readonly rail: string;
    readonly chain: string;
  };
};

type PolicyActivationResponse = {
  readonly policy: {
    readonly id: string;
    readonly version: number;
  };
};

type ApprovalRequiredResponse = {
  readonly approvalId: string;
  readonly decisionId: string;
  readonly error: 'policy_requires_approval';
};

type RuntimePaymentResponse = {
  readonly payment: {
    readonly id: string;
    readonly decision: 'submitted';
    readonly providerMode: 'simulation';
    readonly rail: 'gateway_base';
    readonly amount: string;
    readonly asset: 'USDC';
    readonly agentId: string;
    readonly sourceId: string;
    readonly reservationId: string;
  };
};

type AgentPaymentResponse = {
  readonly account: {
    readonly status: 'active' | 'disabled';
    readonly budget_usdc: string;
    readonly spent_usdc: string;
    readonly payment_access: boolean;
    readonly dedicated_wallet_required: boolean;
  };
  readonly sources: ReadonlyArray<{
    readonly rail: string;
    readonly chain: string;
  }>;
};

async function createOrgAgentAndConnection(app: FastifyInstance) {
  const orgResponse = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: {
      name: 'Payments Org',
      owner: { email: 'payments@example.test', name: 'Payments Owner' },
    },
  });
  expect(orgResponse.statusCode, orgResponse.body).toBe(201);
  const orgId = orgResponse.json<OrgResponse>().org.id;

  const agentResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload: { name: 'Trade research agent' },
  });
  expect(agentResponse.statusCode, agentResponse.body).toBe(201);
  const agentId = agentResponse.json<AgentResponse>().agent.id;

  const connectionResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
    payload: { kind: 'agent_credential', name: 'Runtime credential' },
  });
  expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
  const connection = connectionResponse.json<ConnectionCreateResponse>();

  return { agentId, orgId, secret: connection.secret };
}

async function createActivatedPaymentApprovalPolicy(app: FastifyInstance, orgId: string, agentId: string) {
  const draftResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/policy-drafts`,
    payload: {
      name: 'Paid market data needs approval',
      description: 'Require approval before paid market-data x402 payments at or above 1 USDC.',
      category: 'capability',
      source: 'structured',
      statements: [
        {
          id: 'stmt_paid_market_data_needs_approval',
          actions: ['payment.x402.authorize'],
          audit: 'standard',
          conditions: {
            payment: { assets: ['USDC'], minAmount: '1.00', networks: ['base'] },
            resource: { categories: ['market-data'] },
          },
          decision: 'approval_required',
          target: { types: ['agent'] },
        },
      ],
    },
  });
  expect(draftResponse.statusCode, draftResponse.body).toBe(201);
  const draftId = draftResponse.json<{ readonly draft: { readonly id: string } }>().draft.id;

  const validateResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/policy-drafts/${draftId}/validate`,
  });
  expect(validateResponse.statusCode, validateResponse.body).toBe(200);

  const activateResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/policy-drafts/${draftId}/activate`,
  });
  expect(activateResponse.statusCode, activateResponse.body).toBe(200);
  const policy = activateResponse.json<PolicyActivationResponse>().policy;

  const bindResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/policies/${policy.id}/bindings`,
    payload: {
      policy_version: policy.version,
      target_id: agentId,
      target_type: 'agent',
    },
  });
  expect(bindResponse.statusCode, bindResponse.body).toBe(201);

  return policy;
}

describe('Sections 6-8 payment control plane', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_payments_owner', role: 'owner' }),
      },
      payments: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_payments_owner', role: 'owner' }),
      },
      policy: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_payments_owner', role: 'owner' }),
      },
      approvals: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_payments_owner', role: 'owner' }),
      },
      runtime: {
        pool: store.pool,
      },
    });
  }, 90_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (store !== undefined) await store.stop();
    vi.unstubAllEnvs();
  });

  it('keeps payment access off by default and only pays Gateway-compatible x402 from an active Base source', async () => {
    const { agentId, orgId, secret } = await createOrgAgentAndConnection(app);

    const denied = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        resource: { category: 'market-data', url: 'https://seller.example.test/data' },
        accepts: [
          {
            scheme: 'exact',
            network: 'base',
            asset: 'USDC',
            amount: '1.25',
            payTo: '0x0000000000000000000000000000000000000001',
            extra: { name: 'GatewayWalletBatched' },
          },
        ],
      },
    });
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'payment_access_disabled' });

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/treasury`,
      payload: {
        chain: 'base',
        label: 'Base treasury',
        treasury_type: 'gateway',
      },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const source = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/sources`,
      payload: {
        chain: 'base',
        label: 'Base Gateway source',
        provider: 'simulation',
        rail: 'gateway_base',
        simulated_balance_usdc: '100.00',
        source_type: 'gateway',
      },
    });
    expect(source.statusCode, source.body).toBe(201);
    const sourceBody = source.json<PaymentSourceResponse>();
    expect(sourceBody.source).toMatchObject({ chain: 'base', rail: 'gateway_base' });

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_base'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const exactOnly = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        resource: { category: 'market-data', url: 'https://seller.example.test/direct' },
        accepts: [
          {
            scheme: 'exact',
            network: 'base',
            asset: 'USDC',
            amount: '1.25',
            payTo: '0x0000000000000000000000000000000000000001',
          },
        ],
      },
    });
    expect(exactOnly.statusCode, exactOnly.body).toBe(403);
    expect(exactOnly.json()).toMatchObject({ error: 'payment_rail_not_allowed' });

    const paid = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        resource: { category: 'market-data', url: 'https://seller.example.test/gateway' },
        accepts: [
          {
            scheme: 'exact',
            network: 'base',
            asset: 'USDC',
            amount: '1.25',
            payTo: '0x0000000000000000000000000000000000000001',
            extra: { name: 'GatewayWalletBatched' },
          },
        ],
      },
    });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json<RuntimePaymentResponse>().payment).toMatchObject({
      agentId,
      amount: '1.25',
      asset: 'USDC',
      decision: 'submitted',
      providerMode: 'simulation',
      rail: 'gateway_base',
      sourceId: sourceBody.source.id,
    });

    const tooLarge = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        resource: { category: 'market-data', url: 'https://seller.example.test/gateway-expensive' },
        accepts: [
          {
            scheme: 'exact',
            network: 'base',
            asset: 'USDC',
            amount: '2.50',
            payTo: '0x0000000000000000000000000000000000000001',
            extra: { name: 'GatewayWalletBatched' },
          },
        ],
      },
    });
    expect(tooLarge.statusCode, tooLarge.body).toBe(409);
    expect(tooLarge.json()).toMatchObject({ error: 'per_request_cap_exceeded' });

    const agentPayments = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payments`,
    });
    expect(agentPayments.statusCode, agentPayments.body).toBe(200);
    expect(agentPayments.json<AgentPaymentResponse>().account).toMatchObject({
      budget_usdc: '5.00',
      dedicated_wallet_required: false,
      payment_access: true,
      spent_usdc: '1.25',
      status: 'active',
    });
    expect(agentPayments.json<AgentPaymentResponse>().sources).toEqual([
      expect.objectContaining({ chain: 'base', rail: 'gateway_base' }),
    ]);
  });

  it('enforces payment policies before submitting x402 payments', async () => {
    const { agentId, orgId, secret } = await createOrgAgentAndConnection(app);
    await createActivatedPaymentApprovalPolicy(app, orgId, agentId);

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/treasury`,
      payload: {
        chain: 'base',
        label: 'Base treasury',
        treasury_type: 'gateway',
      },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const source = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/sources`,
      payload: {
        chain: 'base',
        label: 'Base Gateway source',
        provider: 'simulation',
        rail: 'gateway_base',
        simulated_balance_usdc: '100.00',
        source_type: 'gateway',
      },
    });
    expect(source.statusCode, source.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_base'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const paymentPayload = {
      resource: { category: 'market-data', url: 'https://seller.example.test/approval-gated' },
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          asset: 'USDC',
          amount: '1.25',
          payTo: '0x0000000000000000000000000000000000000001',
          extra: { name: 'GatewayWalletBatched' },
        },
      ],
    };

    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: paymentPayload,
    });
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json<ApprovalRequiredResponse>()).toMatchObject({
      error: 'policy_requires_approval',
    });
    const approvalId = blocked.json<ApprovalRequiredResponse>().approvalId;
    const decisionId = blocked.json<ApprovalRequiredResponse>().decisionId;
    expect(approvalId).toMatch(/^apv_/);
    expect(decisionId).toMatch(/^pdec_/);

    const overCap = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        ...paymentPayload,
        accepts: [{ ...paymentPayload.accepts[0], amount: '2.50' }],
      },
    });
    expect(overCap.statusCode, overCap.body).toBe(409);
    expect(overCap.json()).toMatchObject({ error: 'per_request_cap_exceeded' });

    const approve = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/approvals/${approvalId}/approve`,
      payload: { note: 'Approving gated x402 test payment.' },
    });
    expect(approve.statusCode, approve.body).toBe(200);

    const paid = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        ...paymentPayload,
        context: { approval_id: approvalId, decision_id: decisionId },
      },
    });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json<RuntimePaymentResponse>().payment).toMatchObject({
      agentId,
      amount: '1.25',
      decision: 'submitted',
      rail: 'gateway_base',
    });
  });
});
