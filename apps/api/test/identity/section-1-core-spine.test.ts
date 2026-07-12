import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type CreateOrgResponse = {
  readonly org: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly default_team_id: string;
  };
};

type TeamListResponse = {
  readonly teams: Array<{
    readonly id: string;
    readonly name: string;
    readonly is_default: boolean;
    readonly archived_at: string | null;
  }>;
};

type MemberListResponse = {
  readonly members: Array<{
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly role: string;
    readonly status: string;
  }>;
};

type MemberResponse = {
  readonly member: {
    readonly id: string;
    readonly email: string;
    readonly role: string;
    readonly status: string;
  };
};

type OnboardingStatesResponse = {
  readonly states: Array<{
    readonly flow_key: string;
    readonly status: string;
    readonly payload: Record<string, unknown>;
  }>;
};

type AgentResponse = {
  readonly agent: {
    readonly id: string;
    readonly org_id: string;
    readonly team_id: string;
    readonly parent_agent_id: string | null;
    readonly name: string;
    readonly status: string;
    readonly labels: string[];
    readonly connection_health?: string;
    readonly wallet_refs_count?: number;
  };
};

type AgentListResponse = {
  readonly agents: Array<{
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly labels: string[];
    readonly team: { readonly id: string; readonly name: string };
    readonly connection_health: string;
    readonly wallet_refs_count: number;
    readonly policy_coverage: number;
    readonly last_activity_at: string | null;
  }>;
  readonly pagination?: {
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
};

async function createOrg(app: FastifyInstance, name: string): Promise<CreateOrgResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: {
      name,
      owner: {
        email: `${name.toLowerCase().replaceAll(' ', '.')}@example.test`,
        name: `${name} Owner`,
      },
    },
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<CreateOrgResponse>();
}

async function createAgent(
  app: FastifyInstance,
  orgId: string,
  payload: Record<string, unknown>,
): Promise<AgentResponse> {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload,
  });

  expect(response.statusCode).toBe(201);
  return response.json<AgentResponse>();
}

describe('Section 1 core product spine', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({
          actorId: 'usr_test_operator',
          role: 'owner',
        }),
      },
    });
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await store?.stop();
    vi.unstubAllEnvs();
  });

  it('creates an org with one default team and canonical audit events', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orgs',
      payload: {
        name: 'Acme Research',
        domain: 'research.example',
        primary_use_case: 'agent-payments',
        owner: {
          email: 'acme.research@example.test',
          name: 'Acme Research Owner',
        },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const { org } = response.json<CreateOrgResponse>();

    expect(org.id).toMatch(/^org_/);
    expect(org.slug).toBe('acme-research');
    expect(org.default_team_id).toMatch(/^team_/);

    const storedOrg = await store.pool.query<{ settings: Record<string, unknown> }>('SELECT settings FROM orgs WHERE id = $1', [
      org.id,
    ]);
    expect(storedOrg.rows[0]?.settings).toMatchObject({
      domain: 'research.example',
      primary_use_case: 'agent-payments',
    });

    const teams = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${org.id}/teams`,
    });

    expect(teams.statusCode).toBe(200);
    expect(teams.json<TeamListResponse>().teams).toEqual([
      expect.objectContaining({
        id: org.default_team_id,
        name: 'Default',
        is_default: true,
        archived_at: null,
      }),
    ]);

    const audit = await store.pool.query<{ action: string; resource_type: string; resource_id: string }>(
      'SELECT action, resource_type, resource_id FROM audit_events WHERE org_id = $1 ORDER BY sequence ASC',
      [org.id],
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({ action: 'org.created', resource_type: 'org', resource_id: org.id }),
      expect.objectContaining({
        action: 'team.created',
        resource_type: 'team',
        resource_id: org.default_team_id,
      }),
      expect.objectContaining({ action: 'onboarding.completed', resource_type: 'org', resource_id: org.id }),
    ]);
  });

  it('manages workspace members with role safety', async () => {
    const { org } = await createOrg(app, 'Member Org');

    const created = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${org.id}/members`,
      payload: {
        email: 'operator@example.test',
        name: 'Operator User',
        role: 'operator',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const member = created.json<MemberResponse>().member;
    expect(member).toMatchObject({
      email: 'operator@example.test',
      role: 'operator',
      status: 'active',
    });

    const list = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${org.id}/members`,
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json<MemberListResponse>().members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'owner', status: 'active' }),
        expect.objectContaining({ email: 'operator@example.test', role: 'operator', status: 'active' }),
      ]),
    );

    const updated = await app.inject({
      method: 'PATCH',
      url: `/v1/orgs/${org.id}/members/${member.id}`,
      payload: { role: 'admin' },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json<MemberResponse>().member.role).toBe('admin');

    const removed = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${org.id}/members/${member.id}/remove`,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json<MemberResponse>().member.status).toBe('removed');

    const owner = list.json<MemberListResponse>().members.find((candidate) => candidate.role === 'owner');
    expect(owner).toBeDefined();
    const removeLastOwner = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${org.id}/members/${owner?.id}/remove`,
    });
    expect(removeLastOwner.statusCode).toBe(409);
    expect(removeLastOwner.json()).toMatchObject({ error: 'last_owner_required' });
  });

  it('updates post-create onboarding flow state for an organization', async () => {
    const { org } = await createOrg(app, 'Onboarding State Org');

    const update = await app.inject({
      method: 'PUT',
      url: `/v1/orgs/${org.id}/onboarding-states/section_2_controls`,
      payload: {
        status: 'in_progress',
        payload: {
          current_step: 'policy_draft',
          selected_action: 'runtime.http.request',
        },
      },
    });
    expect(update.statusCode, update.body).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${org.id}/onboarding-states`,
    });
    expect(list.statusCode, list.body).toBe(200);
    const states = list.json<OnboardingStatesResponse>().states;
    expect(states.some((state) => state.flow_key === 'section_1_foundation' && state.status === 'completed')).toBe(true);
    expect(
      states.some(
        (state) =>
          state.flow_key === 'section_2_controls' &&
          state.status === 'in_progress' &&
          state.payload.current_step === 'policy_draft',
      ),
    ).toBe(true);
  });

  it('registers generic agents without type authority and exposes the roster read model', async () => {
    const { org } = await createOrg(app, 'Data Ops');
    const agent = await createAgent(app, org.id, {
      name: 'Research agent',
      labels: ['research', 'safe-browser'],
      description: 'Reads sources and drafts summaries',
      default_environment: 'dev',
      metadata: { owner: 'data' },
    });

    expect(agent.agent).toMatchObject({
      org_id: org.id,
      team_id: org.default_team_id,
      parent_agent_id: null,
      name: 'Research agent',
      status: 'active',
      labels: ['research', 'safe-browser'],
    });

    const list = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${org.id}/agents`,
    });

    expect(list.statusCode).toBe(200);
    const [rosterAgent] = list.json<AgentListResponse>().agents;
    expect(rosterAgent).toBeDefined();
    expect(rosterAgent).toMatchObject({
      id: agent.agent.id,
      name: 'Research agent',
      status: 'active',
      labels: ['research', 'safe-browser'],
      team: { id: org.default_team_id, name: 'Default' },
      connection_health: 'not_connected',
      wallet_refs_count: 0,
      policy_coverage: 0,
    });
    expect(rosterAgent?.last_activity_at).toEqual(expect.any(String));
  });

  it('paginates and filters the agent registry without changing the legacy full-list response', async () => {
    const { org } = await createOrg(app, 'Paginated Agents');
    const customTeamResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${org.id}/teams`,
      payload: { name: 'Research', description: 'Research agents' },
    });
    expect(customTeamResponse.statusCode, customTeamResponse.body).toBe(201);
    const customTeam = customTeamResponse.json<{ readonly team: { readonly id: string } }>().team;

    await createAgent(app, org.id, { name: 'Atlas Research', team_id: customTeam.id });
    await createAgent(app, org.id, { name: 'Atlas Operations' });
    const paused = await createAgent(app, org.id, { name: 'Beacon Research', team_id: customTeam.id });
    const pauseResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${org.id}/agents/${paused.agent.id}/pause`,
    });
    expect(pauseResponse.statusCode, pauseResponse.body).toBe(200);

    const filtered = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${org.id}/agents?search=atlas&team_id=${customTeam.id}&status=active&limit=1&offset=0`,
    });
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.json<AgentListResponse>()).toMatchObject({
      agents: [expect.objectContaining({ name: 'Atlas Research', status: 'active' })],
      pagination: { limit: 1, offset: 0, total: 1 },
    });

    const firstPage = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${org.id}/agents?limit=2&offset=0`,
    });
    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${org.id}/agents?limit=2&offset=2`,
    });
    expect(firstPage.json<AgentListResponse>().pagination).toEqual({ limit: 2, offset: 0, total: 3 });
    expect(secondPage.json<AgentListResponse>().pagination).toEqual({ limit: 2, offset: 2, total: 3 });
    expect([
      ...firstPage.json<AgentListResponse>().agents,
      ...secondPage.json<AgentListResponse>().agents,
    ].map((agent) => agent.id)).toHaveLength(3);
    expect(new Set([
      ...firstPage.json<AgentListResponse>().agents,
      ...secondPage.json<AgentListResponse>().agents,
    ].map((agent) => agent.id))).toHaveLength(3);

    const legacy = await app.inject({ method: 'GET', url: `/v1/orgs/${org.id}/agents` });
    expect(legacy.statusCode, legacy.body).toBe(200);
    expect(legacy.json<AgentListResponse>().agents).toHaveLength(3);
    expect(legacy.json<AgentListResponse>().pagination).toBeUndefined();
  });

  it('blocks cross-org team and parent assignment and rejects parent cycles', async () => {
    const first = await createOrg(app, 'First Org');
    const second = await createOrg(app, 'Second Org');
    const parent = await createAgent(app, first.org.id, { name: 'Parent' });
    const child = await createAgent(app, first.org.id, {
      name: 'Child',
      parent_agent_id: parent.agent.id,
    });

    const crossTeam = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${first.org.id}/agents`,
      payload: {
        name: 'Cross team',
        team_id: second.org.default_team_id,
      },
    });
    expect(crossTeam.statusCode).toBe(404);

    const crossParent = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${first.org.id}/agents`,
      payload: {
        name: 'Cross parent',
        parent_agent_id: (
          await createAgent(app, second.org.id, { name: 'Outside parent' })
        ).agent.id,
      },
    });
    expect(crossParent.statusCode).toBe(404);

    const cycle = await app.inject({
      method: 'PATCH',
      url: `/v1/orgs/${first.org.id}/agents/${parent.agent.id}`,
      payload: {
        parent_agent_id: child.agent.id,
      },
    });
    expect(cycle.statusCode).toBe(409);
  });

  it('supports pause, activate, and deactivate lifecycle transitions with audit events', async () => {
    const { org } = await createOrg(app, 'Lifecycle Org');
    const agent = await createAgent(app, org.id, { name: 'Lifecycle agent' });

    const pause = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${org.id}/agents/${agent.agent.id}/pause`,
    });
    expect(pause.statusCode).toBe(200);
    expect(pause.json<AgentResponse>().agent.status).toBe('paused');

    const activate = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${org.id}/agents/${agent.agent.id}/activate`,
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json<AgentResponse>().agent.status).toBe('active');

    const deactivate = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${org.id}/agents/${agent.agent.id}/deactivate`,
    });
    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json<AgentResponse>().agent.status).toBe('deactivated');

    const audit = await store.pool.query<{ action: string }>(
      `SELECT action
         FROM audit_events
        WHERE org_id = $1 AND resource_type = 'agent' AND resource_id = $2
        ORDER BY sequence ASC`,
      [org.id, agent.agent.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'agent.registered',
      'agent.paused',
      'agent.activated',
      'agent.deactivated',
    ]);
  });
});
