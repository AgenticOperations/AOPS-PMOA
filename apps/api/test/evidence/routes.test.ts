import Fastify from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordAuditEvent } from '../../src/engines/evidence/audit-writer.js';
import { registerEvidenceRoutes } from '../../src/engines/evidence/routes.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe('evidence routes', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    await store.stop();
  });

  it('lists events using injected org scope and ignores x-org-id headers', async () => {
    await store.pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_route_a', 'Route A'), ('org_route_b', 'Route B')",
    );
    const eventA = await withTransaction(store.pool, (client) =>
      recordAuditEvent(client, {
        orgId: 'org_route_a',
        eventType: 'agent.created',
        actor: { type: 'user', id: 'usr_a' },
        action: 'agent.create',
        outcome: 'success',
        payload: { agentId: 'agt_a' },
      }),
    );
    await withTransaction(store.pool, (client) =>
      recordAuditEvent(client, {
        orgId: 'org_route_b',
        eventType: 'agent.created',
        actor: { type: 'user', id: 'usr_b' },
        action: 'agent.create',
        outcome: 'success',
        payload: { agentId: 'agt_b' },
      }),
    );

    const app = Fastify({ logger: false });
    registerEvidenceRoutes(app, {
      pool: store.pool,
      resolveOrgScope: () => Promise.resolve({ orgId: 'org_route_a' }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/evidence/events?limit=10',
      headers: { 'x-org-id': 'org_route_b' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      events: [{ id: eventA.id, orgId: 'org_route_a' }],
    });
  });

  it('returns 401 when injected org scope is unavailable', async () => {
    const app = Fastify({ logger: false });
    registerEvidenceRoutes(app, {
      pool: store.pool,
      resolveOrgScope: () => Promise.resolve(null),
    });

    const response = await app.inject({ method: 'GET', url: '/v1/evidence/events' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'unauthorized',
      message: 'Evidence scope is required.',
    });
  });

  it('fetches and verifies event details through the injected org fence', async () => {
    await store.pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_route_detail', 'Route Detail')",
    );
    const event = await withTransaction(store.pool, (client) =>
      recordAuditEvent(client, {
        orgId: 'org_route_detail',
        eventType: 'policy.created',
        actor: { type: 'system' },
        action: 'policy.create',
        outcome: 'success',
        payload: { policyId: 'pol_1' },
      }),
    );

    const app = Fastify({ logger: false });
    registerEvidenceRoutes(app, {
      pool: store.pool,
      resolveOrgScope: () => Promise.resolve({ orgId: 'org_route_detail' }),
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/evidence/events/${event.id}`,
    });
    const verify = await app.inject({
      method: 'GET',
      url: `/v1/evidence/events/${event.id}/verify`,
    });
    const chain = await app.inject({
      method: 'GET',
      url: '/v1/evidence/chain/verify',
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ event: { id: event.id, orgId: 'org_route_detail' } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({ valid: true, eventId: event.id });
    expect(chain.statusCode).toBe(200);
    expect(chain.json()).toMatchObject({ valid: true, checked: 1 });
  });
});
