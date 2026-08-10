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
    readonly description: string;
    readonly status: string;
    readonly revision_policy_id?: string | null;
    readonly revision_base_version?: number | null;
    readonly revision_mode?: string | null;
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
    readonly status?: string;
    readonly removed_by?: string | null;
    readonly removed_at?: string | null;
    readonly removed_reason?: string | null;
  };
};

type PolicyLibraryResponse = {
  readonly drafts: Array<{
    readonly id: string;
    readonly name: string;
    readonly status: string;
  }>;
  readonly policies: Array<{
    readonly id: string;
    readonly version: number;
    readonly status: string;
    readonly binding_target_types: string[];
    readonly bindings_count: number;
    readonly bindings: Array<{
      readonly id: string;
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

type PolicyDecisionListResponse = {
  readonly decisions: Array<{
    readonly id: string;
    readonly actor_type: string;
    readonly action_id: string;
    readonly target_type: string;
    readonly target_id: string | null;
    readonly decision: string;
    readonly reason_code: string;
    readonly explanation: string;
    readonly matched: unknown[];
    readonly created_at: string;
  }>;
};

type PolicyActionCatalogResponse = {
  readonly actions: Array<{
    readonly action_id: string;
    readonly description: string;
    readonly label: string;
    readonly condition_groups: string[];
    readonly binding_target_types: string[];
  }>;
};

type PolicySimulationResponse = {
  readonly simulation: {
    readonly id: string;
    readonly draft_id: string;
    readonly request: Record<string, unknown>;
    readonly result: {
      readonly decision: string;
      readonly reasonCode: string;
      readonly matched: Array<{ readonly statementId: string }>;
    };
  };
};

async function createOrgAndAgent(
  app: FastifyInstance,
): Promise<{ orgId: string; agentId: string }> {
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

  // Operator setup (create agent / issue credential) is role-gated only.
  // Runtime fail-closed still applies to agent HTTP/payment/tool checks.
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
    const decisionId = decisionResponse.json<DecisionResponse>().decision.id;

    const listResponse = await ownerApp.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/policy-decisions`,
    });
    expect(listResponse.statusCode, listResponse.body).toBe(200);
    expect(listResponse.json<PolicyDecisionListResponse>().decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: decisionId,
          actor_type: 'user',
          action_id: 'management.connection.issue',
          target_type: 'agent',
          target_id: agentId,
          decision: 'deny',
          reason_code: 'policy_denied',
          explanation: 'A policy denied this request.',
        }),
      ]),
    );

    const audit = await store.pool.query<{ action: string; event_domain: string; related_policy_id: string | null }>(
      `SELECT action, event_domain, related_policy_id
         FROM audit_events
        WHERE org_id = $1 AND action LIKE 'policy.%'
        ORDER BY sequence ASC`,
      [orgId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'policy.draft.created',
      'policy.validated',
      'policy.activated',
      'policy.bound',
      'policy.decision.recorded',
    ]);
    expect(audit.rows[2]).toMatchObject({ event_domain: 'policy', related_policy_id: policy.policyId });
  });

  it('serves canonical policy action metadata from the backend catalog', async () => {
    const { orgId } = await createOrgAndAgent(ownerApp);

    const response = await ownerApp.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/policy-actions`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<PolicyActionCatalogResponse>().actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_id: 'runtime.http.request',
          label: 'External HTTP request',
          condition_groups: ['resource'],
          binding_target_types: ['org', 'team', 'agent'],
        }),
        expect.objectContaining({
          action_id: 'payment.x402.authorize',
          description: 'Control whether an agent may execute a supported x402 USDC payment through agentOps.',
          condition_groups: ['resource', 'payment'],
          binding_target_types: ['org', 'team', 'agent'],
        }),
        expect.objectContaining({
          action_id: 'management.connection.rotate',
          condition_groups: [],
          binding_target_types: ['connection'],
        }),
      ]),
    );
  });

  it('dry-runs draft policy simulations without recording enforcement decisions', async () => {
    const { orgId, agentId } = await createOrgAndAgent(ownerApp);
    const draftResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts`,
      payload: {
        source: 'structured',
        name: 'Draft weather block',
        category: 'operational',
        statements: [
          {
            id: 'stmt_draft_weather',
            decision: 'deny',
            actions: ['runtime.http.request'],
            target: { types: ['agent'], ids: [agentId] },
            conditions: { resource: { categories: ['weather'] } },
            audit: 'detailed',
          },
        ],
      },
    });
    expect(draftResponse.statusCode, draftResponse.body).toBe(201);
    const draft = draftResponse.json<PolicyDraftResponse>().draft;

    const before = await store.pool.query<{ count: string }>('SELECT count(*) FROM policy_decisions WHERE org_id = $1', [
      orgId,
    ]);

    const simulationResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts/${draft.id}/simulations`,
      payload: {
        actor: { type: 'agent', id: agentId },
        action: 'runtime.http.request',
        target: { type: 'agent', id: agentId },
        context: { resource: { category: 'weather', domain: 'api.weather.test' } },
      },
    });

    expect(simulationResponse.statusCode, simulationResponse.body).toBe(201);
    const simulation = simulationResponse.json<PolicySimulationResponse>().simulation;
    expect(simulation).toMatchObject({
      draft_id: draft.id,
      result: {
        decision: 'deny',
        reasonCode: 'policy_denied',
        matched: [expect.objectContaining({ statementId: 'stmt_draft_weather' })],
      },
    });

    const after = await store.pool.query<{ count: string }>('SELECT count(*) FROM policy_decisions WHERE org_id = $1', [
      orgId,
    ]);
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);

    const stored = await store.pool.query<{ result: unknown }>(
      'SELECT result FROM policy_simulations WHERE org_id = $1 AND draft_id = $2',
      [orgId, draft.id],
    );
    expect(stored.rowCount).toBe(1);

    const audit = await store.pool.query<{
      action: string;
      canonical_body: Record<string, unknown>;
      outcome: string;
      resource_id: string;
      resource_type: string;
    }>(
      `SELECT action, canonical_body, outcome, resource_id, resource_type
         FROM audit_events
        WHERE org_id = $1 AND action = 'policy.simulation.created'`,
      [orgId],
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({
        action: 'policy.simulation.created',
        outcome: 'success',
        resource_id: simulation.id,
        resource_type: 'policy_simulation',
      }),
    ]);
    expect(audit.rows[0]?.canonical_body).toMatchObject({
      payload: {
        action: 'runtime.http.request',
        decision: 'deny',
        draft_id: draft.id,
        target_id: agentId,
        target_type: 'agent',
      },
    });
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

    const onboarding = await store.pool.query<{ status: string }>(
      `SELECT status FROM org_onboarding_states WHERE org_id = $1 AND flow_key = 'policy_setup'`,
      [orgId],
    );
    expect(onboarding.rows[0]?.status).toBe('completed');

    await store.pool.query(
      `DELETE FROM org_onboarding_states WHERE org_id = $1 AND flow_key = 'policy_setup'`,
      [orgId],
    );
    const reconciled = await ownerApp.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/onboarding-states`,
    });
    expect(reconciled.statusCode, reconciled.body).toBe(200);
    expect(reconciled.json<{ readonly states: Array<{ readonly flow_key: string; readonly status: string }> }>().states)
      .toEqual(expect.arrayContaining([expect.objectContaining({ flow_key: 'policy_setup', status: 'completed' })]));

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

  it('lets operators create an agent and credential on a fail-closed org', async () => {
    const orgResponse = await ownerApp.inject({
      method: 'POST',
      url: '/v1/orgs',
      payload: {
        name: 'Fail Closed Setup Org',
        owner: { email: 'setup-owner@example.test', name: 'Setup Owner' },
      },
    });
    expect(orgResponse.statusCode, orgResponse.body).toBe(201);
    const orgId = orgResponse.json<OrgResponse>().org.id;

    const effect = await store.pool.query<{ default_policy_effect: string }>(
      'SELECT default_policy_effect FROM orgs WHERE id = $1',
      [orgId],
    );
    expect(effect.rows[0]?.default_policy_effect).toBe('deny');

    const agentResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'First agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'First credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
  });

  it('does not block operator credential issue via management policy bindings', async () => {
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

    // Management deny policies remain evaluable via the decision API, but
    // console setup (issue credential) stays role-gated so operators can
    // stand up an agent before binding runtime policy.
    const issued = await operatorApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(issued.statusCode, issued.body).toBe(201);
    const issuedBody = issued.json<{
      connection: { name: string };
      secret: string;
    }>();
    expect(issuedBody.connection.name).toBe('Runtime credential');
    expect(typeof issuedBody.secret).toBe('string');
    expect(issuedBody.secret.length).toBeGreaterThan(0);
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

  it('edits and discards mutable policy drafts without activating them', async () => {
    const { orgId, agentId } = await createOrgAndAgent(ownerApp);

    const draftResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts`,
      payload: {
        source: 'structured',
        name: 'Temporary weather policy',
        description: 'Old description',
        category: 'operational',
        statements: [
          {
            id: 'stmt_weather',
            decision: 'deny',
            actions: ['runtime.http.request'],
            target: { types: ['agent'], ids: [agentId] },
            conditions: { resource: { categories: ['weather'] } },
            audit: 'detailed',
          },
        ],
      },
    });
    expect(draftResponse.statusCode, draftResponse.body).toBe(201);
    const draft = draftResponse.json<PolicyDraftResponse>().draft;

    const editResponse = await ownerApp.inject({
      method: 'PATCH',
      url: `/v1/orgs/${orgId}/policy-drafts/${draft.id}`,
      payload: {
        name: 'Temporary market policy',
        description: 'Edited description',
        statements: [
          {
            id: 'stmt_market',
            decision: 'approval_required',
            actions: ['payment.x402.authorize'],
            target: { types: ['agent'], ids: [agentId] },
            conditions: {
              resource: { categories: ['market-data'] },
              payment: { minAmount: '1.00', assets: ['USDC'] },
            },
            audit: 'detailed',
          },
        ],
      },
    });
    expect(editResponse.statusCode, editResponse.body).toBe(200);
    expect(editResponse.json<PolicyDraftResponse>().draft).toMatchObject({
      id: draft.id,
      name: 'Temporary market policy',
      description: 'Edited description',
      status: 'draft',
    });

    const discardResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts/${draft.id}/discard`,
    });
    expect(discardResponse.statusCode, discardResponse.body).toBe(200);
    expect(discardResponse.json<PolicyDraftResponse>().draft).toMatchObject({
      id: draft.id,
      status: 'discarded',
    });

    const validateDiscarded = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts/${draft.id}/validate`,
    });
    expect(validateDiscarded.statusCode).toBe(400);
    expect(validateDiscarded.json()).toMatchObject({ error: 'policy_draft_locked' });

    const libraryResponse = await ownerApp.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/policies`,
    });
    expect(libraryResponse.statusCode, libraryResponse.body).toBe(200);
    expect(libraryResponse.json<PolicyLibraryResponse>().drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: draft.id, name: 'Temporary market policy', status: 'discarded' }),
      ]),
    );
  });

  it('removes bindings and archives policies so they no longer affect decisions', async () => {
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
    const binding = bindingResponse.json<PolicyBindingResponse>().binding;

    const deniedBeforeRemove = await operatorApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-decisions/check`,
      payload: {
        actor: { type: 'user', id: 'usr_operator', role: 'operator' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: agentId },
        context: {},
      },
    });
    expect(deniedBeforeRemove.statusCode, deniedBeforeRemove.body).toBe(200);
    expect(deniedBeforeRemove.json<DecisionResponse>().decision.decision).toBe('deny');

    const removeResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.policyId}/bindings/${binding.id}/remove`,
    });
    expect(removeResponse.statusCode, removeResponse.body).toBe(200);
    expect(removeResponse.json<PolicyBindingResponse>().binding).toMatchObject({
      id: binding.id,
      target_type: 'agent',
      target_id: agentId,
      status: 'removed',
      removed_by: 'usr_owner',
      removed_reason: 'manual_remove',
    });
    expect(removeResponse.json<PolicyBindingResponse>().binding.removed_at).toEqual(expect.any(String));

    const allowedAfterRemove = await operatorApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-decisions/check`,
      payload: {
        actor: { type: 'user', id: 'usr_operator', role: 'operator' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: agentId },
        context: {},
      },
    });
    expect(allowedAfterRemove.statusCode, allowedAfterRemove.body).toBe(200);
    expect(allowedAfterRemove.json<DecisionResponse>().decision).toMatchObject({
      decision: 'deny',
      reasonCode: 'no_matching_policy_denied',
    });

    const archiveResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.policyId}/archive`,
      payload: { change_reason: 'No longer needed' },
    });
    expect(archiveResponse.statusCode, archiveResponse.body).toBe(200);
    expect(archiveResponse.json()).toMatchObject({ policy: { id: policy.policyId, status: 'archived' } });

    const archived = await store.pool.query<{
      archived_by: string | null;
      archived_at: Date | null;
    }>('SELECT archived_by, archived_at FROM policy_versions WHERE org_id = $1 AND policy_id = $2 AND version = $3', [
      orgId,
      policy.policyId,
      policy.version,
    ]);
    expect(archived.rows[0]).toMatchObject({ archived_by: 'usr_owner' });
    expect(archived.rows[0]?.archived_at).toBeInstanceOf(Date);

    const archiveAgain = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.policyId}/archive`,
      payload: { change_reason: 'Already archived' },
    });
    expect(archiveAgain.statusCode).toBe(404);
  });

  it('activates revision drafts atomically and migrates existing bindings to the new version', async () => {
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
    const oldBinding = bindingResponse.json<PolicyBindingResponse>().binding;

    const revisionDraftResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.policyId}/revision-drafts`,
      payload: {
        name: 'Observe credential issue',
        description: 'Downgrade credential issue controls to observation.',
        statements: [
          {
            id: 'stmt_observe_issue',
            decision: 'observe',
            actions: ['management.connection.issue'],
            actor: { roles: ['operator'] },
            target: { types: ['agent'], ids: [agentId] },
            audit: 'detailed',
          },
        ],
      },
    });
    expect(revisionDraftResponse.statusCode, revisionDraftResponse.body).toBe(201);
    expect(revisionDraftResponse.json<PolicyDraftResponse>().draft).toMatchObject({
      name: 'Observe credential issue',
      status: 'draft',
      revision_policy_id: policy.policyId,
      revision_base_version: 1,
      revision_mode: 'revision',
    });
    const revisionDraft = revisionDraftResponse.json<PolicyDraftResponse>().draft;

    const activationResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts/${revisionDraft.id}/activate-revision`,
      payload: { change_reason: 'QA versioning update' },
    });
    expect(activationResponse.statusCode, activationResponse.body).toBe(200);
    expect(activationResponse.json<PolicyActivationResponse>().policy).toMatchObject({
      id: policy.policyId,
      version: 2,
      name: 'Observe credential issue',
    });

    const libraryResponse = await ownerApp.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/policies`,
    });
    expect(libraryResponse.statusCode, libraryResponse.body).toBe(200);
    const matchingPolicies = libraryResponse
      .json<PolicyLibraryResponse>()
      .policies.filter((candidate) => candidate.id === policy.policyId);
    expect(matchingPolicies).toHaveLength(1);
    expect(matchingPolicies[0]).toMatchObject({
      version: 2,
      status: 'active',
      bindings_count: 1,
      bindings: [expect.objectContaining({ target_type: 'agent', target_id: agentId, policy_version: 2 })],
    });

    const versions = await store.pool.query<{ version: number; status: string }>(
      `SELECT version, status
         FROM policy_versions
        WHERE org_id = $1 AND policy_id = $2
        ORDER BY version ASC`,
      [orgId, policy.policyId],
    );
    expect(versions.rows).toEqual([
      { version: 1, status: 'superseded' },
      { version: 2, status: 'active' },
    ]);

    const bindings = await store.pool.query<{
      id: string;
      policy_version: number;
      status: string;
      removed_by: string | null;
      removed_reason: string | null;
    }>(
      `SELECT id, policy_version, status, removed_by, removed_reason
         FROM policy_bindings
        WHERE org_id = $1 AND policy_id = $2
        ORDER BY created_at ASC`,
      [orgId, policy.policyId],
    );
    expect(bindings.rows).toEqual([
      {
        id: oldBinding.id,
        policy_version: 1,
        status: 'removed',
        removed_by: 'usr_owner',
        removed_reason: 'policy_revision_migrated',
      },
      expect.objectContaining({
        policy_version: 2,
        status: 'active',
        removed_by: null,
        removed_reason: null,
      }),
    ]);

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
      decision: 'observe',
      reasonCode: 'policy_observed',
    });
  });

  it('restores archived policies only through a validated restore revision draft', async () => {
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

    const archiveResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.policyId}/archive`,
      payload: { change_reason: 'Pause controls' },
    });
    expect(archiveResponse.statusCode, archiveResponse.body).toBe(200);

    const deniedWhileArchived = await operatorApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-decisions/check`,
      payload: {
        actor: { type: 'user', id: 'usr_operator', role: 'operator' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: agentId },
        context: {},
      },
    });
    expect(deniedWhileArchived.statusCode, deniedWhileArchived.body).toBe(200);
    expect(deniedWhileArchived.json<DecisionResponse>().decision).toMatchObject({
      decision: 'deny',
      reasonCode: 'no_matching_policy_denied',
    });

    const restoreDraftResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policies/${policy.policyId}/restore-drafts`,
      payload: {
        restore_bindings: [
          {
            target_type: 'agent',
            target_id: agentId,
          },
        ],
      },
    });
    expect(restoreDraftResponse.statusCode, restoreDraftResponse.body).toBe(201);
    expect(restoreDraftResponse.json<PolicyDraftResponse>().draft).toMatchObject({
      revision_policy_id: policy.policyId,
      revision_base_version: 1,
      revision_mode: 'restore',
      status: 'draft',
    });
    const restoreDraft = restoreDraftResponse.json<PolicyDraftResponse>().draft;

    const activationResponse = await ownerApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-drafts/${restoreDraft.id}/activate-revision`,
      payload: { change_reason: 'Restore credential controls' },
    });
    expect(activationResponse.statusCode, activationResponse.body).toBe(200);
    expect(activationResponse.json<PolicyActivationResponse>().policy).toMatchObject({
      id: policy.policyId,
      version: 2,
      status: 'active',
    });

    const deniedAfterRestore = await operatorApp.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/policy-decisions/check`,
      payload: {
        actor: { type: 'user', id: 'usr_operator', role: 'operator' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: agentId },
        context: {},
      },
    });
    expect(deniedAfterRestore.statusCode, deniedAfterRestore.body).toBe(200);
    expect(deniedAfterRestore.json<DecisionResponse>().decision).toMatchObject({
      decision: 'deny',
      reasonCode: 'policy_denied',
    });
  });
});
