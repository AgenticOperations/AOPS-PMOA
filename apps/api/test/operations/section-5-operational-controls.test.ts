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

type OperationCheckResponse = {
  readonly operation: {
    readonly id: string;
    readonly action: string;
    readonly agent_id: string;
    readonly connection_id: string | null;
    readonly decision: 'allow' | 'deny' | 'approval_required' | 'observe' | 'rate_limited';
    readonly reasonCode: string;
    readonly approvalId: string | null;
    readonly tool_name: string | null;
    readonly resource_label: string | null;
  };
};

type BlockedOperationsResponse = {
  readonly blocked: Array<{
    readonly id: string;
    readonly action: string;
    readonly agent_id: string;
    readonly decision: 'deny' | 'rate_limited';
    readonly reasonCode: string;
    readonly tool_name: string | null;
  }>;
};

type ToolCatalogResponse = {
  readonly tools: Array<{
    readonly id: string;
    readonly name: string;
    readonly display_name: string;
    readonly category: string;
    readonly status: 'active' | 'archived';
  }>;
};

type RateLimitListResponse = {
  readonly rate_limits: Array<{
    readonly id: string;
    readonly target_type: string;
    readonly target_id: string;
    readonly limit: number;
    readonly status: 'active' | 'disabled';
    readonly utilization: {
      readonly current_count: number;
      readonly current_bucket: string | null;
      readonly current_window_start: string | null;
    };
  }>;
};

type AllowedActionsResponse = {
  readonly actions: Array<{
    readonly action: string;
    readonly label: string;
    readonly decision: string;
    readonly policyName: string | null;
  }>;
};

async function createOrgAgentAndConnection(app: FastifyInstance) {
  const orgResponse = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: {
      name: 'Operations Org',
      owner: { email: 'ops@example.test', name: 'Ops Owner' },
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
    payload: { change_reason: 'Section 5 operational control' },
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

describe('Section 5 operational controls', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_ops_owner', role: 'owner' }),
      },
      policy: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_ops_owner', role: 'owner' }),
      },
      approvals: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_ops_owner', role: 'owner' }),
      },
      runtime: {
        pool: store.pool,
      },
      operations: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_ops_owner', role: 'owner' }),
      },
    });
  }, 90_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (store !== undefined) await store.stop();
    vi.unstubAllEnvs();
  });

  it('imports tools, checks policy, and exposes denied operational actions', async () => {
    const { orgId, agentId, connectionId } = await createOrgAgentAndConnection(app);

    const importResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/tools/import`,
      payload: {
        tools: [
          {
            name: 'browser.search',
            display_name: 'Browser search',
            category: 'browser',
            risk_level: 'low',
            description: 'Managed web search tool',
          },
        ],
      },
    });
    expect(importResponse.statusCode, importResponse.body).toBe(201);
    expect(importResponse.json<{ readonly tools: Array<{ readonly name: string }> }>().tools).toEqual([
      expect.objectContaining({ name: 'browser.search' }),
    ]);

    await createPolicy(app, {
      orgId,
      agentId,
      name: 'Block browser search',
      statement: {
        id: 'stmt_block_browser_search',
        decision: 'deny',
        actions: ['tool.call'],
        target: { types: ['agent'], ids: [agentId] },
        conditions: { tool: { names: ['browser.search'] } },
        audit: 'detailed',
      },
    });

    const checkResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/operations/check`,
      payload: {
        agent_id: agentId,
        connection_id: connectionId,
        action: 'tool.call',
        tool: { name: 'browser.search', riskLevel: 'low' },
        context: { purpose: 'research' },
      },
    });
    expect(checkResponse.statusCode, checkResponse.body).toBe(200);
    expect(checkResponse.json<OperationCheckResponse>().operation).toMatchObject({
      action: 'tool.call',
      agent_id: agentId,
      connection_id: connectionId,
      decision: 'deny',
      reasonCode: 'policy_denied',
      approvalId: null,
      tool_name: 'browser.search',
    });

    const blockedResponse = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/operations/blocked?agent_id=${agentId}`,
    });
    expect(blockedResponse.statusCode, blockedResponse.body).toBe(200);
    expect(blockedResponse.json<BlockedOperationsResponse>().blocked).toEqual([
      expect.objectContaining({
        action: 'tool.call',
        agent_id: agentId,
        decision: 'deny',
        reasonCode: 'policy_denied',
        tool_name: 'browser.search',
      }),
    ]);

    const allowedActionsResponse = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/agents/${agentId}/allowed-actions`,
    });
    expect(allowedActionsResponse.statusCode, allowedActionsResponse.body).toBe(200);
    expect(allowedActionsResponse.json<AllowedActionsResponse>().actions).toEqual([
      expect.objectContaining({
        action: 'tool.call',
        decision: 'deny',
        label: 'browser.search',
        policyName: 'Block browser search',
      }),
    ]);
  });

  it('creates approvals from runtime operation checks and records operational activity', async () => {
    const { orgId, agentId, secret } = await createOrgAgentAndConnection(app);

    await createPolicy(app, {
      orgId,
      agentId,
      name: 'Review high risk tools',
      statement: {
        id: 'stmt_review_high_risk_tool',
        decision: 'approval_required',
        actions: ['tool.call'],
        target: { types: ['agent'], ids: [agentId] },
        conditions: { tool: { riskLevels: ['high'] } },
        audit: 'detailed',
      },
    });

    const checkResponse = await app.inject({
      method: 'POST',
      url: '/v1/runtime/operations/check',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        action: 'tool.call',
        tool: { name: 'repo.write', riskLevel: 'high' },
        context: { purpose: 'write a generated patch' },
      },
    });
    expect(checkResponse.statusCode, checkResponse.body).toBe(200);
    const operation = checkResponse.json<OperationCheckResponse>().operation;
    expect(operation).toMatchObject({
      action: 'tool.call',
      agent_id: agentId,
      decision: 'approval_required',
      reasonCode: 'policy_requires_approval',
      tool_name: 'repo.write',
    });
    expect(operation.approvalId).toMatch(/^apv_/);

    const activityResponse = await app.inject({
      method: 'POST',
      url: '/v1/runtime/operations/record',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        action: 'tool.call',
        summary: 'Repo write completed after approval',
        tool: { name: 'repo.write', riskLevel: 'high' },
        outcome: 'success',
      },
    });
    expect(activityResponse.statusCode, activityResponse.body).toBe(200);
    expect(activityResponse.json<{ readonly activity: { readonly action: string; readonly summary: string } }>().activity).toMatchObject({
      action: 'operation.recorded',
      summary: 'Repo write completed after approval',
    });
  });

  it('rate-limits repeated operation checks per connection and action', async () => {
    const { orgId, agentId, secret } = await createOrgAgentAndConnection(app);

    const rateLimitResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/operations/rate-limits`,
      payload: {
        target_type: 'agent',
        target_id: agentId,
        action: 'tool.call',
        limit: 1,
        window_seconds: 60,
        bucket: 'tool:browser.search',
      },
    });
    expect(rateLimitResponse.statusCode, rateLimitResponse.body).toBe(201);

    const firstCheck = await app.inject({
      method: 'POST',
      url: '/v1/runtime/operations/check',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        action: 'tool.call',
        tool: { name: 'browser.search', riskLevel: 'low' },
      },
    });
    expect(firstCheck.statusCode, firstCheck.body).toBe(200);
    expect(firstCheck.json<OperationCheckResponse>().operation.decision).toBe('allow');

    const secondCheck = await app.inject({
      method: 'POST',
      url: '/v1/runtime/operations/check',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        action: 'tool.call',
        tool: { name: 'browser.search', riskLevel: 'low' },
      },
    });
    expect(secondCheck.statusCode, secondCheck.body).toBe(200);
    expect(secondCheck.json<OperationCheckResponse>().operation).toMatchObject({
      decision: 'rate_limited',
      reasonCode: 'operation_rate_limited',
      tool_name: 'browser.search',
    });
  });

  it('updates and archives imported tools from the catalog', async () => {
    const { orgId } = await createOrgAgentAndConnection(app);

    const importResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/tools/import`,
      payload: {
        tools: [
          {
            name: 'browser.search',
            display_name: 'Browser search',
            category: 'browser',
            risk_level: 'low',
            description: 'Managed web search tool',
          },
        ],
      },
    });
    expect(importResponse.statusCode, importResponse.body).toBe(201);
    const tool = importResponse.json<ToolCatalogResponse>().tools[0];
    expect(tool?.id).toMatch(/^tool_/);

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/orgs/${orgId}/tools/${tool?.id}`,
      payload: {
        display_name: 'Managed browser search',
        category: 'research',
        risk_level: 'medium',
        description: 'Search routed through agentOps.',
      },
    });
    expect(updateResponse.statusCode, updateResponse.body).toBe(200);
    expect(updateResponse.json<{ readonly tool: { readonly display_name: string; readonly category: string } }>().tool).toMatchObject({
      display_name: 'Managed browser search',
      category: 'research',
    });

    const archiveResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/tools/${tool?.id}/archive`,
    });
    expect(archiveResponse.statusCode, archiveResponse.body).toBe(200);
    expect(archiveResponse.json<{ readonly tool: { readonly id: string; readonly status: string } }>().tool).toMatchObject({
      id: tool?.id,
      status: 'archived',
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/tools`,
    });
    expect(listResponse.statusCode, listResponse.body).toBe(200);
    expect(listResponse.json<ToolCatalogResponse>().tools).toEqual([]);
  });

  it('lists, updates, disables, and reports utilization for rate limits', async () => {
    const { orgId, agentId, secret } = await createOrgAgentAndConnection(app);

    const createResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/operations/rate-limits`,
      payload: {
        target_type: 'agent',
        target_id: agentId,
        action: 'tool.call',
        limit: 2,
        window_seconds: 60,
        bucket: 'tool:browser.search',
      },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const rateLimitId = createResponse.json<{ readonly rate_limit: { readonly id: string } }>().rate_limit.id;

    const firstCheck = await app.inject({
      method: 'POST',
      url: '/v1/runtime/operations/check',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        action: 'tool.call',
        tool: { name: 'browser.search', riskLevel: 'low' },
      },
    });
    expect(firstCheck.statusCode, firstCheck.body).toBe(200);

    const listResponse = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/operations/rate-limits`,
    });
    expect(listResponse.statusCode, listResponse.body).toBe(200);
    const [listedRateLimit] = listResponse.json<RateLimitListResponse>().rate_limits;
    expect(listedRateLimit).toBeDefined();
    expect(listedRateLimit).toMatchObject({
      id: rateLimitId,
      target_type: 'agent',
      target_id: agentId,
      limit: 2,
      status: 'active',
    });
    expect(listedRateLimit?.utilization).toMatchObject({
      current_count: 1,
      current_bucket: 'tool:browser.search',
    });

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/orgs/${orgId}/operations/rate-limits/${rateLimitId}`,
      payload: {
        limit: 5,
        window_seconds: 120,
        status: 'active',
      },
    });
    expect(updateResponse.statusCode, updateResponse.body).toBe(200);
    expect(updateResponse.json<{ readonly rate_limit: { readonly limit: number; readonly window_seconds: number } }>().rate_limit).toMatchObject({
      limit: 5,
      window_seconds: 120,
    });

    const disableResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/operations/rate-limits/${rateLimitId}/disable`,
    });
    expect(disableResponse.statusCode, disableResponse.body).toBe(200);
    expect(disableResponse.json<{ readonly rate_limit: { readonly id: string; readonly status: string } }>().rate_limit).toMatchObject({
      id: rateLimitId,
      status: 'disabled',
    });

    const secondCheck = await app.inject({
      method: 'POST',
      url: '/v1/runtime/operations/check',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        action: 'tool.call',
        tool: { name: 'browser.search', riskLevel: 'low' },
      },
    });
    expect(secondCheck.statusCode, secondCheck.body).toBe(200);
    expect(secondCheck.json<OperationCheckResponse>().operation.decision).toBe('allow');
  });
});
