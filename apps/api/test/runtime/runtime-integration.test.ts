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
  readonly connection: {
    readonly id: string;
  };
  readonly secret: string;
};

type PolicyActivationResponse = {
  readonly policy: {
    readonly id: string;
    readonly version: number;
  };
};

type RuntimeCheckResponse = {
  readonly decision: {
    readonly id: string;
    readonly decision: 'allow' | 'deny' | 'approval_required' | 'observe' | 'needs_more_info';
    readonly reasonCode: string;
    readonly approvalId: string | null;
    readonly normalized: {
      readonly action: string;
      readonly context: Record<string, unknown>;
    };
  };
};

type RuntimeOnboardResponse = {
  readonly agent: {
    readonly id: string;
    readonly name: string;
  };
  readonly runtime: {
    readonly checkEndpoint: string;
  };
  readonly actions: ReadonlyArray<{
    readonly action: string;
  }>;
};

type ApprovalMutationResponse = {
  readonly approval: {
    readonly id: string;
    readonly status: string;
  };
};

async function createOrgAgentAndConnection(app: FastifyInstance) {
  const orgResponse = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: {
      name: 'Runtime Org',
      owner: { email: 'runtime@example.test', name: 'Runtime Owner' },
    },
  });
  expect(orgResponse.statusCode, orgResponse.body).toBe(201);
  const orgId = orgResponse.json<OrgResponse>().org.id;

  const agentResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload: { name: 'Research agent' },
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

  return { orgId, agentId, connectionId: connection.connection.id, secret: connection.secret };
}

async function createPolicy(
  app: FastifyInstance,
  input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly name: string;
    readonly statement: Record<string, unknown>;
  },
) {
  const draftResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${input.orgId}/policy-drafts`,
    payload: {
      source: 'structured',
      name: input.name,
      category: 'operational',
      statements: [input.statement],
    },
  });
  expect(draftResponse.statusCode, draftResponse.body).toBe(201);
  const draftId = draftResponse.json<{ readonly draft: { readonly id: string } }>().draft.id;

  const validateResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${input.orgId}/policy-drafts/${draftId}/validate`,
  });
  expect(validateResponse.statusCode, validateResponse.body).toBe(200);

  const activateResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${input.orgId}/policy-drafts/${draftId}/activate`,
    payload: { change_reason: 'Runtime control' },
  });
  expect(activateResponse.statusCode, activateResponse.body).toBe(200);
  const policy = activateResponse.json<PolicyActivationResponse>().policy;

  const bindResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${input.orgId}/policies/${policy.id}/bindings`,
    payload: {
      policy_version: policy.version,
      target_type: 'agent',
      target_id: input.agentId,
    },
  });
  expect(bindResponse.statusCode, bindResponse.body).toBe(201);
  return policy;
}

describe('Section 2-4 runtime control surface', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_runtime_owner', role: 'owner' }),
      },
      policy: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_runtime_owner', role: 'owner' }),
      },
      approvals: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_runtime_owner', role: 'owner' }),
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

  it('onboards an agent and denies a natural-language runtime check through direct API', async () => {
    const { orgId, agentId, secret } = await createOrgAgentAndConnection(app);
    await createPolicy(app, {
      orgId,
      agentId,
      name: 'Block weather APIs',
      statement: {
        id: 'stmt_block_weather',
        decision: 'deny',
        actions: ['runtime.http.request'],
        target: { types: ['agent'], ids: [agentId] },
        conditions: { resource: { categories: ['weather'] } },
        audit: 'detailed',
      },
    });

    const onboard = await app.inject({
      method: 'POST',
      url: '/v1/runtime/onboard',
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(onboard.statusCode, onboard.body).toBe(200);
    const onboardBody = onboard.json<RuntimeOnboardResponse>();
    expect(onboardBody.agent).toMatchObject({ id: agentId, name: 'Research agent' });
    expect(onboardBody.runtime.checkEndpoint).toBe('/v1/runtime/check');
    expect(onboardBody.actions.map((action) => action.action)).toEqual(
      expect.arrayContaining(['runtime.http.request', 'payment.x402.authorize']),
    );

    const check = await app.inject({
      method: 'POST',
      url: '/v1/runtime/check',
      headers: { authorization: `Bearer ${secret}` },
      payload: { intent: 'Can I access weather data for Delhi?' },
    });
    expect(check.statusCode, check.body).toBe(200);
    expect(check.json<RuntimeCheckResponse>().decision).toMatchObject({
      decision: 'deny',
      reasonCode: 'policy_denied',
      approvalId: null,
      normalized: {
        action: 'runtime.http.request',
      },
    });
  });

  it('creates, approves, and consumes a one-time approval for the same runtime context', async () => {
    const { orgId, agentId, secret } = await createOrgAgentAndConnection(app);
    await createPolicy(app, {
      orgId,
      agentId,
      name: 'Review paid data',
      statement: {
        id: 'stmt_review_paid_market_data',
        decision: 'approval_required',
        actions: ['payment.x402.authorize'],
        target: { types: ['agent'], ids: [agentId] },
        conditions: {
          resource: { categories: ['market-data'] },
          payment: { minAmount: '1.00', assets: ['USDC'] },
        },
        audit: 'detailed',
      },
    });

    const check = await app.inject({
      method: 'POST',
      url: '/v1/runtime/check',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        action: 'payment.x402.authorize',
        resource: { category: 'market-data', url: 'https://paid.example.test/research' },
        payment: { amount: '2.00', asset: 'USDC', network: 'base', recipient: '0xRecipient' },
      },
    });
    expect(check.statusCode, check.body).toBe(200);
    const approvalId = check.json<RuntimeCheckResponse>().decision.approvalId;
    expect(check.json<RuntimeCheckResponse>().decision.decision).toBe('approval_required');
    expect(approvalId).toMatch(/^apv_/);

    const approve = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/approvals/${approvalId}/approve`,
      payload: { note: 'Allowed for this run' },
    });
    expect(approve.statusCode, approve.body).toBe(200);
    expect(approve.json<ApprovalMutationResponse>().approval).toMatchObject({ id: approvalId, status: 'approved' });

    const consume = await app.inject({
      method: 'POST',
      url: `/v1/runtime/approvals/${approvalId}/consume`,
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        decision_id: check.json<RuntimeCheckResponse>().decision.id,
      },
    });
    expect(consume.statusCode, consume.body).toBe(200);
    expect(consume.json<ApprovalMutationResponse>().approval).toMatchObject({ id: approvalId, status: 'consumed' });

    const secondConsume = await app.inject({
      method: 'POST',
      url: `/v1/runtime/approvals/${approvalId}/consume`,
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        decision_id: check.json<RuntimeCheckResponse>().decision.id,
      },
    });
    expect(secondConsume.statusCode).toBe(409);
  });

  it('does not expose MCP as a backend-owned API route', async () => {
    const { orgId, agentId, secret } = await createOrgAgentAndConnection(app);
    await createPolicy(app, {
      orgId,
      agentId,
      name: 'Observe tool calls',
      statement: {
        id: 'stmt_observe_tool',
        decision: 'observe',
        actions: ['tool.call'],
        target: { types: ['agent'], ids: [agentId] },
        conditions: { tool: { names: ['browser.search'] } },
        audit: 'standard',
      },
    });

    const direct = await app.inject({
      method: 'POST',
      url: '/v1/runtime/check',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        action: 'tool.call',
        tool: { name: 'browser.search', riskLevel: 'low' },
      },
    });
    expect(direct.statusCode, direct.body).toBe(200);
    expect(direct.json<RuntimeCheckResponse>().decision.decision).toBe('observe');

    const mcp = await app.inject({
      method: 'POST',
      url: '/v1/mcp',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'agentops.policy_check',
          arguments: {
            action: 'tool.call',
            tool: { name: 'browser.search', riskLevel: 'low' },
          },
        },
      },
    });
    expect(mcp.statusCode).toBe(404);
  });
});
