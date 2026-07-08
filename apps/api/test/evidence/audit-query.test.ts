import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordAuditEvent } from '../../src/engines/evidence/audit-writer.js';
import {
  getAuditEvent,
  listAuditEvents,
  verifyAuditChain,
  verifyAuditEvent,
} from '../../src/engines/evidence/audit-query.js';
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

describe('audit query and verification services', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    await store.stop();
  });

  it('lists and fetches events only inside the requested org fence', async () => {
    await store.pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_query_a', 'Query A'), ('org_query_b', 'Query B')",
    );

    const eventA = await withTransaction(store.pool, (client) =>
      recordAuditEvent(client, {
        orgId: 'org_query_a',
        eventType: 'agent.created',
        actor: { type: 'user', id: 'usr_a' },
        action: 'agent.create',
        outcome: 'success',
        payload: { agentId: 'agt_a' },
      }),
    );
    const eventB = await withTransaction(store.pool, (client) =>
      recordAuditEvent(client, {
        orgId: 'org_query_b',
        eventType: 'agent.created',
        actor: { type: 'user', id: 'usr_b' },
        action: 'agent.create',
        outcome: 'success',
        payload: { agentId: 'agt_b' },
      }),
    );

    const listA = await listAuditEvents(store.pool, 'org_query_a', { limit: 20 });

    expect(listA.events.map((event) => event.id)).toEqual([eventA.id]);
    expect(await getAuditEvent(store.pool, 'org_query_a', eventA.id)).toMatchObject({
      id: eventA.id,
      orgId: 'org_query_a',
    });
    expect(await getAuditEvent(store.pool, 'org_query_a', eventB.id)).toBeNull();
  });

  it('verifies one event hash and detects canonical body tampering', async () => {
    await store.pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_query_verify', 'Query Verify')",
    );
    const event = await withTransaction(store.pool, (client) =>
      recordAuditEvent(client, {
        orgId: 'org_query_verify',
        eventType: 'policy.created',
        actor: { type: 'user', id: 'usr_1' },
        action: 'policy.create',
        outcome: 'success',
        payload: { policyId: 'pol_original' },
      }),
    );

    await expect(verifyAuditEvent(store.pool, 'org_query_verify', event.id)).resolves.toMatchObject({
      valid: true,
      eventId: event.id,
    });

    await store.pool.query(
      "UPDATE audit_events SET canonical_body = jsonb_set(canonical_body, '{payload,policyId}', '\"pol_tampered\"'::jsonb) WHERE id = $1",
      [event.id],
    );

    await expect(verifyAuditEvent(store.pool, 'org_query_verify', event.id)).resolves.toMatchObject({
      valid: false,
      eventId: event.id,
      reason: 'canonical_body_hash_mismatch',
    });
  });

  it('verifies an org hash-chain window and detects broken links', async () => {
    await store.pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_query_chain', 'Query Chain')",
    );
    const first = await withTransaction(store.pool, (client) =>
      recordAuditEvent(client, {
        orgId: 'org_query_chain',
        eventType: 'agent.created',
        actor: { type: 'system' },
        action: 'agent.create',
        outcome: 'success',
        payload: { agentId: 'agt_1' },
      }),
    );
    const second = await withTransaction(store.pool, (client) =>
      recordAuditEvent(client, {
        orgId: 'org_query_chain',
        eventType: 'agent.paused',
        actor: { type: 'system' },
        action: 'agent.pause',
        outcome: 'success',
        payload: { agentId: 'agt_1' },
      }),
    );
    expect(second.previousHash).toBe(first.eventHash);

    await expect(verifyAuditChain(store.pool, 'org_query_chain', { limit: 20 })).resolves.toMatchObject({
      valid: true,
      checked: 2,
    });

    await store.pool.query('UPDATE audit_events SET previous_hash = $1 WHERE id = $2', [
      'd'.repeat(64),
      second.id,
    ]);

    await expect(verifyAuditChain(store.pool, 'org_query_chain', { limit: 20 })).resolves.toMatchObject({
      valid: false,
      checked: 2,
      failedEventId: second.id,
      reason: 'previous_hash_mismatch',
    });
  });
});
