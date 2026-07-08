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
  }>;
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
    await app.close();
    await store.stop();
    vi.unstubAllEnvs();
  });

  it('creates an org with one default team and canonical audit events', async () => {
    const { org } = await createOrg(app, 'Acme Research');

    expect(org.id).toMatch(/^org_/);
    expect(org.slug).toBe('acme-research');
    expect(org.default_team_id).toMatch(/^team_/);

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
    ]);
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
    expect(list.json<AgentListResponse>().agents).toEqual([
      expect.objectContaining({
        id: agent.agent.id,
        name: 'Research agent',
        status: 'active',
        labels: ['research', 'safe-browser'],
        team: { id: org.default_team_id, name: 'Default' },
        connection_health: 'not_connected',
        wallet_refs_count: 0,
      }),
    ]);
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
