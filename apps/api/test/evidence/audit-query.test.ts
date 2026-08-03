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

  async function seedAuditChain(orgId: string, count: number): Promise<void> {
    await store.pool.query(
      'INSERT INTO orgs (id, display_name) VALUES ($1, $2)', [orgId, orgId],
    );
    for (let i = 0; i < count; i += 1) {
      await withTransaction(store.pool, (client) =>
        recordAuditEvent(client, {
          orgId,
          eventType: 'agent.created',
          actor: { type: 'system' },
          action: 'agent.create',
          outcome: 'success',
          payload: { i },
        }),
      );
    }
  }

  it('verifies a chain longer than the 500-event page cap', async () => {
    await seedAuditChain('org_query_chain_long', 1200);

    const result = await verifyAuditChain(store.pool, 'org_query_chain_long', {});
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(1200); // today this caps at 500
  }, 60_000);

  it('detects a truncated tail when the head is not also rewritten', async () => {
    await seedAuditChain('org_query_chain_tail', 100);

    // Deletes the last 10 events but leaves audit_event_heads untouched --
    // the realistic case whenever the head has ANY separate protection
    // from the events table (e.g. a distinct write role/credential). A
    // fully coordinated attacker who also rewrites the head to match the
    // truncated state produces a chain that is genuinely self-consistent
    // with no internal signal left to catch it -- that residual gap is
    // real and requires an external checkpoint (a separately-secured copy
    // of the head, written somewhere the same compromise can't reach),
    // which is out of scope here. This test covers what the tail check
    // actually catches: a truncation that does NOT also rewrite the head.
    await store.pool.query(
      'DELETE FROM audit_events WHERE org_id = $1 AND sequence > 90', ['org_query_chain_tail'],
    );

    const result = await verifyAuditChain(store.pool, 'org_query_chain_tail', {});
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('event_count_mismatch');
  }, 30_000);

  it('detects a tampered event beyond the old 500-event page cap', async () => {
    await seedAuditChain('org_query_chain_deep_tamper', 800);

    const target = await store.pool.query<{ id: string }>(
      'SELECT id FROM audit_events WHERE org_id = $1 AND sequence = 600', ['org_query_chain_deep_tamper'],
    );
    await store.pool.query(
      "UPDATE audit_events SET canonical_body = jsonb_set(canonical_body, '{payload,i}', '99999'::jsonb) WHERE id = $1",
      [target.rows[0]?.id],
    );

    const result = await verifyAuditChain(store.pool, 'org_query_chain_deep_tamper', {});
    expect(result.valid).toBe(false);
  }, 60_000);
});
