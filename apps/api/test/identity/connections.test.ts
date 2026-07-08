import { createHash } from 'node:crypto';
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

type ConnectionCreateResponse = {
  readonly connection: {
    readonly id: string;
    readonly agent_id: string;
    readonly kind: string;
    readonly name: string;
    readonly status: string;
    readonly secret_last4: string | null;
  };
  readonly secret: string;
};

type ConnectionListResponse = {
  readonly connections: Array<ConnectionCreateResponse['connection'] & { readonly secret?: never }>;
};

type AgentDetailResponse = {
  readonly activity: Array<{
    readonly id: string;
    readonly action: string;
    readonly eventType: string;
    readonly outcome: string;
    readonly eventDomain: string;
    readonly eventCategory: string;
    readonly severity: string;
    readonly summary: string;
    readonly subject: string | null;
    readonly description: string | null;
  }>;
};

async function createOrgAndAgent(app: FastifyInstance): Promise<{ orgId: string; agentId: string }> {
  const orgResponse = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: {
      name: 'Connection Org',
      owner: { email: 'owner.connection@example.test', name: 'Connection Owner' },
    },
  });
  expect(orgResponse.statusCode, orgResponse.body).toBe(201);
  const orgId = orgResponse.json<OrgResponse>().org.id;

  const agentResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload: { name: 'Connected agent' },
  });
  expect(agentResponse.statusCode).toBe(201);

  return {
    orgId,
    agentId: agentResponse.json<AgentResponse>().agent.id,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('Section 1 connection credentials', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({
          actorId: 'usr_connection_operator',
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

  it('creates a connection with one-time secret reveal and hash-only storage', async () => {
    const { orgId, agentId } = await createOrgAndAgent(app);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: {
        kind: 'agent_credential',
        name: 'Local Claude',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<ConnectionCreateResponse>();
    expect(body.secret).toMatch(/^conn_test_/);
    expect(body.connection).toMatchObject({
      agent_id: agentId,
      kind: 'agent_credential',
      name: 'Local Claude',
      status: 'active',
      secret_last4: body.secret.slice(-4),
    });

    const stored = await store.pool.query<{
      secret_hash: string;
      secret_last4: string | null;
    }>(
      `SELECT cc.secret_hash, c.secret_last4
         FROM connection_credentials cc
         JOIN connections c ON c.id = cc.connection_id
        WHERE c.id = $1`,
      [body.connection.id],
    );
    expect(stored.rows[0]).toEqual({
      secret_hash: sha256(body.secret),
      secret_last4: body.secret.slice(-4),
    });
    expect(stored.rows[0]?.secret_hash).not.toContain(body.secret);

    const list = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<ConnectionListResponse>().connections[0]).not.toHaveProperty('secret');
  });

  it('tests, rotates, revokes, and authenticates connection credentials', async () => {
    const { orgId, agentId } = await createOrgAndAgent(app);

    const created = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Worker runtime' },
    });
    const first = created.json<ConnectionCreateResponse>();

    const auth = await app.inject({
      method: 'POST',
      url: '/v1/connections/auth/check',
      payload: { token: first.secret },
    });
    expect(auth.statusCode).toBe(200);
    expect(auth.json()).toEqual({
      ok: true,
      org_id: orgId,
      agent_id: agentId,
      connection_id: first.connection.id,
    });

    const tested = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/connections/${first.connection.id}/test`,
    });
    expect(tested.statusCode).toBe(200);
    const testedBody = tested.json<{ readonly connection: { readonly id: string; readonly status: string } }>();
    expect(testedBody.connection.id).toBe(first.connection.id);
    expect(testedBody.connection.status).toBe('active');

    const rotated = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/connections/${first.connection.id}/rotate`,
    });
    expect(rotated.statusCode).toBe(200);
    const second = rotated.json<ConnectionCreateResponse>();
    expect(second.secret).toMatch(/^conn_test_/);
    expect(second.secret).not.toBe(first.secret);

    const oldAuth = await app.inject({
      method: 'POST',
      url: '/v1/connections/auth/check',
      payload: { token: first.secret },
    });
    expect(oldAuth.statusCode).toBe(401);

    const revoke = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/connections/${first.connection.id}/revoke`,
    });
    expect(revoke.statusCode).toBe(200);
    const revokeBody = revoke.json<{ readonly connection: { readonly id: string; readonly status: string } }>();
    expect(revokeBody.connection.id).toBe(first.connection.id);
    expect(revokeBody.connection.status).toBe('revoked');

    const revokedAuth = await app.inject({
      method: 'POST',
      url: '/v1/connections/auth/check',
      payload: { token: second.secret },
    });
    expect(revokedAuth.statusCode).toBe(401);

    const events = await store.pool.query<{
      action: string;
      event_domain: string;
      event_category: string;
      severity: string;
      tags: string[];
      related_agent_id: string | null;
      related_connection_id: string | null;
      payload: Record<string, unknown>;
    }>(
      `SELECT
         action,
         event_domain,
         event_category,
         severity,
         tags,
         related_agent_id,
         related_connection_id,
         payload
       FROM audit_events
       WHERE org_id = $1 AND action LIKE 'connection.%'
       ORDER BY sequence ASC`,
      [orgId],
    );

    expect(events.rows.map((event) => event.action)).toEqual([
      'connection.created',
      'connection.rotated',
      'connection.revoked',
    ]);
    for (const event of events.rows) {
      expect(event).toMatchObject({
        event_domain: 'credential',
        event_category: 'configuration',
        severity: 'info',
        related_agent_id: agentId,
        related_connection_id: first.connection.id,
      });
      expect(event.tags).toEqual(expect.arrayContaining(['section_1', 'agent', 'credential']));
    }
    expect(events.rows[0]?.payload).toMatchObject({
      display_name: 'Worker runtime',
      last4: first.secret.slice(-4),
    });
    expect(events.rows[1]?.payload).toMatchObject({
      display_name: 'Worker runtime',
      previous_last4: first.secret.slice(-4),
      new_last4: second.secret.slice(-4),
    });
    expect(events.rows[2]?.payload).toMatchObject({
      display_name: 'Worker runtime',
      last4: second.secret.slice(-4),
    });

    await store.pool.query(
      `UPDATE audit_events
          SET payload = '{}'::jsonb
        WHERE org_id = $1 AND action = 'connection.created' AND resource_id = $2`,
      [orgId, first.connection.id],
    );

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/agents/${agentId}`,
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json<AgentDetailResponse>();
    expect(detailBody.activity.map((event) => event.action)).toEqual([
      'connection.revoked',
      'connection.rotated',
      'connection.created',
      'agent.registered',
    ]);
    expect(detailBody.activity[0]).toMatchObject({
      eventType: 'connection.revoked',
      eventDomain: 'credential',
      eventCategory: 'configuration',
      severity: 'info',
      summary: 'Credential revoked',
      subject: 'Worker runtime',
      description: `Credential ending ${second.secret.slice(-4)}`,
    });
    expect(detailBody.activity[1]).toMatchObject({
      summary: 'Credential rotated',
      subject: 'Worker runtime',
      description: `Credential changed from ${first.secret.slice(-4)} to ${second.secret.slice(-4)}`,
    });
    expect(detailBody.activity[2]).toMatchObject({
      summary: 'Credential created',
      subject: 'Worker runtime',
      description: 'Credential created for this agent',
    });
    expect(JSON.stringify(detailBody.activity)).not.toContain(first.connection.id);
  });
});
