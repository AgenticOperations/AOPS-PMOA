import pg from 'pg';
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { readApiEnv } from '../../src/config/env.js';
import { recordAuditEvent } from '../../src/engines/evidence/audit-writer.js';
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

describe('Section 11A app wiring', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await store.stop();
  });

  it('reads DATABASE_URL as the one-switch database target', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://local-user:local-pass@localhost:5432/local-db');

    expect(readApiEnv().databaseUrl).toBe(
      'postgres://local-user:local-pass@localhost:5432/local-db',
    );
  });

  it('does not expose evidence routes until a pool and org resolver are injected', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    const app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/v1/evidence/events' });

    expect(response.statusCode).toBe(404);
  });

  it('mounts evidence routes when production dependencies are injected', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    await store.pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_app_wiring', 'App Wiring')",
    );
    const event = await withTransaction(store.pool, (client) =>
      recordAuditEvent(client, {
        orgId: 'org_app_wiring',
        eventType: 'app.wired',
        actor: { type: 'system' },
        action: 'app.wire',
        outcome: 'success',
        payload: { ready: true },
      }),
    );

    const app = buildApp({
      evidence: {
        pool: store.pool,
        resolveOrgScope: () => Promise.resolve({ orgId: 'org_app_wiring' }),
      },
    });

    const response = await app.inject({ method: 'GET', url: '/v1/evidence/events' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      events: [{ id: event.id, orgId: 'org_app_wiring' }],
    });
  });
});
