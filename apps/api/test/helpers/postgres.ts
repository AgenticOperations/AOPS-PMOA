import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { runMigrations } from '@agentops-pmoa/db';

const POSTGRES_PORT = 5432;
const POSTGRES_USER = 'agentops';
const POSTGRES_PASSWORD = 'agentops';
const POSTGRES_DB = 'agentops_pmoa_test';

export type PostgresTestStore = {
  readonly pool: pg.Pool;
  readonly stop: () => Promise<void>;
};

export async function startPostgres(): Promise<PostgresTestStore> {
  if (process.env.TEST_DATABASE_URL !== undefined && process.env.TEST_DATABASE_URL.length > 0) {
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrations(pool);
    return {
      pool,
      stop: async () => {
        await pool.end();
      },
    };
  }

  const container: StartedTestContainer = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER,
      POSTGRES_PASSWORD,
      POSTGRES_DB,
    })
    .withExposedPorts(POSTGRES_PORT)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(60_000)
    .start();

  const pool = new pg.Pool({
    connectionString: `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${container.getHost()}:${container.getMappedPort(
      POSTGRES_PORT,
    )}/${POSTGRES_DB}`,
  });

  await runMigrations(pool);

  return {
    pool,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
