import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type OrgResponse = {
  readonly org: { readonly id: string };
};

type AgentResponse = {
  readonly agent: { readonly id: string };
};

type ConnectionCreateResponse = {
  readonly secret: string;
};

type AgentActivityFeedResponse = {
  readonly live: {
    readonly status: 'active' | 'idle' | 'offline';
    readonly last_seen_at: string | null;
  };
  readonly events: Array<{
    readonly id: string;
    readonly action: string;
    readonly category: string;
    readonly outcome: string;
    readonly summary: string;
    readonly source: string;
  }>;
};

async function createRuntimeCredential(app: FastifyInstance, pool: PostgresTestStore['pool']) {
  const orgResponse = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: {
      name: 'MCP Runtime Org',
      owner: { email: 'mcp@example.test', name: 'MCP Owner' },
    },
  });
  expect(orgResponse.statusCode, orgResponse.body).toBe(201);
  const orgId = orgResponse.json<OrgResponse>().org.id;

  // Fail-closed (E1): a fresh org denies everything until a policy matches.
  // Agent/connection provisioning is orthogonal to what this suite tests.
  await pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);

  const agentResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload: { name: 'MCP agent' },
  });
  expect(agentResponse.statusCode, agentResponse.body).toBe(201);
  const agentId = agentResponse.json<AgentResponse>().agent.id;

  const connectionResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
    payload: { kind: 'agent_credential', name: 'MCP credential' },
  });
  expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);

  return { agentId, orgId, secret: connectionResponse.json<ConnectionCreateResponse>().secret };
}

describe('runtime activity endpoint for the standalone MCP service', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_mcp_owner', role: 'owner' }),
      },
      policy: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_mcp_owner', role: 'owner' }),
      },
      approvals: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_mcp_owner', role: 'owner' }),
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

  it('records MCP-originated activity through runtime credential auth', async () => {
    const { agentId, secret } = await createRuntimeCredential(app, store.pool);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime/activity',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        summary: 'Agent completed browser research checkpoint',
        payload: { source: 'mcp', checkpoint: 'browser_research' },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      activity: {
        agent_id: agentId,
        action: 'mcp.activity_recorded',
        category: 'integration',
        outcome: 'success',
        summary: 'Agent completed browser research checkpoint',
      },
    });
  });

  it('exposes a live per-agent activity feed with runtime and MCP events', async () => {
    const { agentId, orgId, secret } = await createRuntimeCredential(app, store.pool);

    const onboard = await app.inject({
      method: 'POST',
      url: '/v1/runtime/onboard',
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(onboard.statusCode, onboard.body).toBe(200);

    const check = await app.inject({
      method: 'POST',
      url: '/v1/runtime/check',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        action: 'runtime.http.request',
        resource: { category: 'open-data', url: 'https://docs.example.test/status' },
      },
    });
    expect(check.statusCode, check.body).toBe(200);

    const activity = await app.inject({
      method: 'POST',
      url: '/v1/runtime/activity',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        summary: 'Agent completed live research checkpoint',
        payload: { checkpoint: 'live_feed' },
      },
    });
    expect(activity.statusCode, activity.body).toBe(200);

    const feed = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/agents/${agentId}/activity`,
    });

    expect(feed.statusCode, feed.body).toBe(200);
    const body = feed.json<AgentActivityFeedResponse>();
    expect(body.live.status).toBe('active');
    expect(body.live.last_seen_at).toEqual(expect.any(String));
    expect(body.events.map((event) => event.action)).toEqual(
      expect.arrayContaining(['runtime.onboarded', 'runtime.check', 'mcp.activity_recorded']),
    );
    expect(body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'mcp.activity_recorded',
          category: 'integration',
          outcome: 'success',
          source: 'activity',
          summary: 'Agent completed live research checkpoint',
        }),
      ]),
    );
  });
});
