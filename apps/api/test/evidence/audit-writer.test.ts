import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordAuditEvent, IdempotencyConflictError } from '../../src/engines/evidence/audit-writer.js';
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

describe('recordAuditEvent', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    await store.stop();
  });

  it('allocates per-org sequences and links event hashes', async () => {
    await store.pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_writer_seq', 'Writer Seq')",
    );

    const first = await withTransaction(store.pool, (client) =>
      recordAuditEvent(client, {
        orgId: 'org_writer_seq',
        eventType: 'policy.created',
        actor: { type: 'user', id: 'usr_1' },
        action: 'policy.create',
        outcome: 'success',
        payload: { policyId: 'pol_1' },
      }),
    );
    const second = await withTransaction(store.pool, (client) =>
      recordAuditEvent(client, {
        orgId: 'org_writer_seq',
        eventType: 'policy.activated',
        actor: { type: 'user', id: 'usr_1' },
        action: 'policy.activate',
        outcome: 'success',
        payload: { policyId: 'pol_1' },
      }),
    );

    expect(first.sequence).toBe(1);
    expect(first.previousHash).toBeNull();
    expect(second.sequence).toBe(2);
    expect(second.previousHash).toBe(first.eventHash);

    const head = await store.pool.query<{ last_sequence: string; last_event_hash: string }>(
      "SELECT last_sequence, last_event_hash FROM audit_event_heads WHERE org_id = 'org_writer_seq'",
    );
    expect(head.rows[0]).toEqual({
      last_sequence: '2',
      last_event_hash: second.eventHash,
    });
  });

  it('returns the existing event for same idempotency key and same canonical body', async () => {
    await store.pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_writer_idem_same', 'Writer Idem Same')",
    );

    const input = {
      orgId: 'org_writer_idem_same',
      idempotencyKey: 'idem_same',
      eventType: 'agent.paused',
      actor: { type: 'system' as const },
      action: 'agent.pause',
      outcome: 'success' as const,
      resource: { type: 'agent', id: 'agt_1' },
      payload: { reason: 'limit_exhausted' },
    };

    const first = await withTransaction(store.pool, (client) => recordAuditEvent(client, input));
    const second = await withTransaction(store.pool, (client) => recordAuditEvent(client, input));

    expect(second).toEqual(first);

    const count = await store.pool.query<{ count: string }>(
      "SELECT count(*) FROM audit_events WHERE org_id = 'org_writer_idem_same'",
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('rejects same idempotency key with a different canonical body', async () => {
    await store.pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_writer_idem_conflict', 'Writer Idem Conflict')",
    );

    await withTransaction(store.pool, (client) =>
      recordAuditEvent(client, {
        orgId: 'org_writer_idem_conflict',
        idempotencyKey: 'idem_conflict',
        eventType: 'policy.created',
        actor: { type: 'user', id: 'usr_1' },
        action: 'policy.create',
        outcome: 'success',
        payload: { policyId: 'pol_1' },
      }),
    );

    await expect(
      withTransaction(store.pool, (client) =>
        recordAuditEvent(client, {
          orgId: 'org_writer_idem_conflict',
          idempotencyKey: 'idem_conflict',
          eventType: 'policy.created',
          actor: { type: 'user', id: 'usr_1' },
          action: 'policy.create',
          outcome: 'success',
          payload: { policyId: 'pol_2' },
        }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('rolls back the caller domain mutation when audit writing fails', async () => {
    await store.pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_writer_rollback', 'Writer Rollback')",
    );

    await expect(
      withTransaction(store.pool, async (client) => {
        await client.query(
          "INSERT INTO orgs (id, display_name) VALUES ('org_writer_domain_tmp', 'Temp')",
        );
        await recordAuditEvent(client, {
          orgId: 'org_writer_missing',
          eventType: 'org.created',
          actor: { type: 'system' },
          action: 'org.create',
          outcome: 'success',
          payload: { orgId: 'org_writer_domain_tmp' },
        });
      }),
    ).rejects.toThrow();

    const domain = await store.pool.query(
      "SELECT 1 FROM orgs WHERE id = 'org_writer_domain_tmp'",
    );
    expect(domain.rowCount).toBe(0);
  });
});
