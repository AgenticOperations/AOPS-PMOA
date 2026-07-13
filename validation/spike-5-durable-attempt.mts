import assert from 'node:assert/strict';
import pg from 'pg';
import { GenericContainer, Wait } from 'testcontainers';

const container = await new GenericContainer('postgres:16-alpine')
  .withEnvironment({ POSTGRES_USER: 'agentops', POSTGRES_PASSWORD: 'agentops', POSTGRES_DB: 'spike' })
  .withExposedPorts(5432)
  .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
  .start();
const pool = new pg.Pool({
  connectionString: `postgres://agentops:agentops@${container.getHost()}:${container.getMappedPort(5432)}/spike`,
});

try {
  await pool.query(`CREATE TABLE attempts (
    id text PRIMARY KEY, idempotency_key text UNIQUE NOT NULL,
    status text NOT NULL CHECK (status IN ('reserved','submitting','settled','failed','unknown')),
    response jsonb
  )`);
  await pool.query('BEGIN');
  await pool.query("INSERT INTO attempts VALUES ('a1', 'key-1', 'reserved', NULL)");
  await pool.query('COMMIT');
  assert.equal((await pool.query("SELECT status FROM attempts WHERE id='a1'")).rows[0].status, 'reserved');
  await assert.rejects(pool.query("INSERT INTO attempts VALUES ('a2','key-1','reserved',NULL)"), { code: '23505' });
  await pool.query("UPDATE attempts SET status='submitting' WHERE id='a1'");
  await pool.query("UPDATE attempts SET status='settled', response='{\"status\":200}' WHERE id='a1'");
  const final = (await pool.query("SELECT status, response FROM attempts WHERE id='a1'")).rows[0];
  assert.deepEqual(final, { status: 'settled', response: { status: 200 } });
  console.log(JSON.stringify({ result: 'PASS', durableAfterCommit: true, duplicateRejected: true, final }));
} finally {
  await pool.end();
  await container.stop();
}
