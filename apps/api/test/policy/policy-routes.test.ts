import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type OrgResponse = {
  readonly org: {
    readonly id: string;
    readonly default_team_id: string;
  };
};

type AgentResponse = {
  readonly agent: {
    readonly id: string;
  };
};

type ConnectionResponse = {
  readonly connection: {
    readonly id: string;
  };
};

type PolicyDraftResponse = {
  readonly draft: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
  };
};

type PolicyValidationResponse = {
  readonly validation: {
    readonly valid: boolean;
    readonly errors: string[];
    readonly warnings: string[];
  };
};

type PolicyActivationResponse = {
  readonly policy: {
    readonly id: string;
    readonly version: number;
    readonly name: string;
  };
};

type PolicyBindingResponse = {
  readonly binding: {
    readonly id: string;
    readonly policy_id: string;
    readonly policy_version: number;
    readonly target_type: string;
    readonly target_id: string;
  };
};

type PolicyLibraryResponse = {
  readonly policies: Array<{
    readonly id: string;
    readonly binding_target_types: string[];
    readonly bindings_count: number;
    readonly bindings: Array<{
      readonly target_id: string;
      readonly target_type: string;
    }>;
  }>;
};

type AgentPoliciesResponse = {
  readonly policies: Array<{
    readonly id: string;
    readonly name: string;
    readonly binding: {
      readonly scope: string;
      readonly target_id: string;
      readonly target_type: string;
    };
  }>;
};

type DecisionResponse = {
  readonly decision: {
    readonly id: string;
    readonly decision: string;
    readonly reasonCode: string;
    readonly explanation: string;
  };
};

async function createOrgAndAgent(app: FastifyInstance): Promise<{ orgId: string; agentId: string }> {
  const orgResponse = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: {
      name: 'Policy Org',
      owner: { email: 'policy-owner@example.test', name: 'Policy Owner' },
    },
  });
  expect(orgResponse.statusCode, orgResponse.body).toBe(201);
  const orgId = orgResponse.json<OrgResponse>().org.id;

  const agentResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload: { name: 'Governed agent' },
  });
  expect(agentResponse.statusCode, agentResponse.body).toBe(201);

  return {
    orgId,
    agentId: agentResponse.json<AgentResponse>().agent.id,
  };
}

async function createActivatedPolicy(
  app: FastifyInstance,
  orgId: string,
  agentId: string,
): Promise<{ policyId: string; version: number }> {
  const draftResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/policy-drafts`,
    payload: {
      source: 'blank',
      name: 'Block credential issue',
      description: 'Operators cannot issue credentials for this agent.',
      category: 'management',
      statements: [
        {
          id: 'stmt_block_issue',
          decision: 'deny',
          actions: ['management.connection.issue'],
          actor: { roles: ['operator'] },
          target: { types: ['agent'], ids: [agentId] },
          audit: 'detailed',
        },
      ],
    },
  });
  expect(draftResponse.statusCode, draftResponse.body).toBe(201);
  const draft = draftResponse.json<PolicyDraftResponse>().draft;

  const validationResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/policy-drafts/${draft.id}/validate`,
  });
  expect(validationResponse.statusCode, validationResponse.body).toBe(200);
  expect(validationResponse.json()).toMatchObject({
    validation: { valid: true, errors: [], warnings: [] },
  });

  const activationResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/policy-drafts/${draft.id}/activate`,
    payload: { change_reason: 'Initial credential control' },
  });
  expect(activationResponse.statusCode, activationResponse.body).toBe(200);
  const policy = activationResponse.json<PolicyActivationResponse>().policy;
  return { policyId: policy.id, version: policy.version };
}

describe('Section 2 policy routes', () => {
  let store: PostgresTestStore;
  let ownerApp: FastifyInstance;
  let operatorApp: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    ownerApp = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }),
      },
      policy: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }),
      },
    });
    operatorApp = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_operator', role: 'operator' }),
      },
      policy: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_operator', role: 'operator' }),
      },
    });
  }, 90_000);

  afterAll(async () => {
    if (ownerApp !== undefined) await ownerApp.close();
    if (operatorApp !== undefined) await operatorApp.close();
    if (store !== undefined) await store.stop();
    vi.unstubAllEnvs();
  });

  it('creates, validates, activates, binds, and checks a structured policy', async () => {
    const { orgId, agentId } = await createOrgAndAgent(ownerApp);
    const policy = await createActivatedPolicy(ownerApp, orgId, agentId);

    const bindingResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.policyId}/bindings`,
      payload: {
        policy_version: policy.version,
        target_type: 'agent',
        target_id: agentId,
      },
    });
    expect(bindingResponse.statusCode, bindingResponse.body).toBe(201);
    expect(bindingResponse.json<PolicyBindingResponse>().binding).toMatchObject({
      policy_id: policy.policyId,
      policy_version: policy.version,
      target_type: 'agent',
      target_id: agentId,
    });

    const decisionResponse = await operatorApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-decisions/check`,
      payload: {
        actor: { type: 'user', id: 'usr_operator', role: 'operator' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: agentId },
        context: {},
      },
    });
    expect(decisionResponse.statusCode, decisionResponse.body).toBe(200);
    expect(decisionResponse.json<DecisionResponse>().decision).toMatchObject({
      decision: 'deny',
      reasonCode: 'policy_denied',
      explanation: 'A policy denied this request.',
    });

    const audit = await store.pool.query<{ action: string; event_domain: string; related_policy_id: string | null }>(
      `SELECT action, event_domain, related_policy_id
         FROM audit_events
        WHERE org_id = $1 AND action LIKE 'policy.%'
        ORDER BY sequence ASC`,
      [orgId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'policy.decision.recorded',
      'policy.draft.created',
      'policy.validated',
      'policy.activated',
      'policy.bound',
      'policy.decision.recorded',
    ]);
    expect(audit.rows[3]).toMatchObject({ event_domain: 'policy', related_policy_id: policy.policyId });
  });

  it('returns active binding details for the policy library and agent effective policies', async () => {
    const { orgId, agentId } = await createOrgAndAgent(ownerApp);
    const policy = await createActivatedPolicy(ownerApp, orgId, agentId);

    const bindingResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.policyId}/bindings`,
      payload: {
        policy_version: policy.version,
        target_type: 'agent',
        target_id: agentId,
      },
    });
    expect(bindingResponse.statusCode, bindingResponse.body).toBe(201);

    const libraryResponse = await ownerApp.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/policies`,
    });
    expect(libraryResponse.statusCode, libraryResponse.body).toBe(200);
    expect(libraryResponse.json<PolicyLibraryResponse>().policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: policy.policyId,
          bindings_count: 1,
          bindings: [
            expect.objectContaining({
              target_type: 'agent',
              target_id: agentId,
            }),
          ],
        }),
      ]),
    );

    const agentPoliciesResponse = await ownerApp.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/agents/${agentId}/policies`,
    });
    expect(agentPoliciesResponse.statusCode, agentPoliciesResponse.body).toBe(200);
    const agentPolicies = agentPoliciesResponse.json<AgentPoliciesResponse>().policies;
    expect(agentPolicies).toHaveLength(1);
    expect(agentPolicies[0]?.id).toBe(policy.policyId);
    expect(agentPolicies[0]?.name).toBe('Block credential issue');
    expect(agentPolicies[0]?.binding.scope).toBe('direct');
    expect(agentPolicies[0]?.binding.target_type).toBe('agent');
    expect(agentPolicies[0]?.binding.target_id).toBe(agentId);
  });

  it('uses active policy bindings to block Section 1 credential issue actions', async () => {
    const { orgId, agentId } = await createOrgAndAgent(ownerApp);
    const policy = await createActivatedPolicy(ownerApp, orgId, agentId);

    const bindingResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.policyId}/bindings`,
      payload: {
        policy_version: policy.version,
        target_type: 'agent',
        target_id: agentId,
      },
    });
    expect(bindingResponse.statusCode).toBe(201);

    const denied = await operatorApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Blocked runtime' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      error: 'policy_denied',
      message: 'A policy denied this request.',
    });
  });

  it('rejects runtime policies that mix condition groups from another action surface', async () => {
    const { orgId, agentId } = await createOrgAndAgent(ownerApp);

    const draftResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts`,
      payload: {
        source: 'structured',
        name: 'Bad mixed runtime rule',
        category: 'operational',
        statements: [
          {
            id: 'stmt_bad_mixed_runtime',
            decision: 'deny',
            actions: ['runtime.http.request'],
            target: { types: ['agent'], ids: [agentId] },
            conditions: {
              resource: { categories: ['weather'] },
              payment: { minAmount: '1.00', assets: ['USDC'] },
              tool: { names: ['browser.search'] },
            },
            audit: 'detailed',
          },
        ],
      },
    });
    expect(draftResponse.statusCode, draftResponse.body).toBe(201);
    const draft = draftResponse.json<PolicyDraftResponse>().draft;

    const validationResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts/${draft.id}/validate`,
    });
    expect(validationResponse.statusCode, validationResponse.body).toBe(200);
    const validation = validationResponse.json<PolicyValidationResponse>().validation;
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('does not support payment conditions'))).toBe(true);
    expect(validation.errors.some((error) => error.includes('does not support tool conditions'))).toBe(true);
  });

  it('rejects policy bindings to target ids that do not exist in the workspace', async () => {
    const { orgId, agentId } = await createOrgAndAgent(ownerApp);
    const policy = await createActivatedPolicy(ownerApp, orgId, agentId);

    const bindingResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.policyId}/bindings`,
      payload: {
        policy_version: policy.version,
        target_type: 'agent',
        target_id: 'agt_missing',
      },
    });
    expect(bindingResponse.statusCode).toBe(404);
    expect(bindingResponse.json()).toMatchObject({
      error: 'not_found',
      message: 'Policy binding target was not found.',
    });
  });

  it('rejects credential bindings for policies that only evaluate against agent targets', async () => {
    const { orgId, agentId } = await createOrgAndAgent(ownerApp);
    const policy = await createActivatedPolicy(ownerApp, orgId, agentId);

    const libraryResponse = await ownerApp.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/policies`,
    });
    expect(libraryResponse.statusCode, libraryResponse.body).toBe(200);
    const libraryPolicy = libraryResponse.json<PolicyLibraryResponse>().policies.find((candidate) => candidate.id === policy.policyId);
    expect(libraryPolicy?.binding_target_types).toEqual(['org', 'team', 'agent']);

    const connectionResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime key' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);

    const orgBindingResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.policyId}/bindings`,
      payload: {
        policy_version: policy.version,
        target_type: 'org',
        target_id: orgId,
      },
    });
    expect(orgBindingResponse.statusCode, orgBindingResponse.body).toBe(201);

    const connectionBindingResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.policyId}/bindings`,
      payload: {
        policy_version: policy.version,
        target_type: 'connection',
        target_id: connectionResponse.json<ConnectionResponse>().connection.id,
      },
    });
    expect(connectionBindingResponse.statusCode).toBe(400);
    expect(connectionBindingResponse.json()).toMatchObject({
      error: 'invalid_policy_binding_target',
    });
  });
});
