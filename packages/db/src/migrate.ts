import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export type RunMigrationsOptions = {
  readonly migrationsDir?: string;
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_ADVISORY_LOCK_ID = '7054387463183534';

function defaultMigrationsDir(): string {
  const sourceDir = path.join(currentDir, '..', '..', 'src', 'migrations');
  if (existsSync(sourceDir)) return sourceDir;

  const compiledDir = path.join(currentDir, 'migrations');
  if (existsSync(compiledDir)) return compiledDir;

  return compiledDir;
}

export async function runMigrations(
  pool: pg.Pool,
  options: RunMigrationsOptions = {},
): Promise<string[]> {
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_ADVISORY_LOCK_ID]);
    lockAcquired = true;
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));

    const appliedResult = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((row) => row.id));
    const ran: string[] = [];

    for (const file of files) {
      const id = file.replace(/\.sql$/, '');
      if (applied.has(id)) continue;

      const sql = await readFile(path.join(migrationsDir, file), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
        await client.query('COMMIT');
        ran.push(id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${id} failed: ${(error as Error).message}`, { cause: error });
      }
    }

    return ran;
  } finally {
    try {
      if (lockAcquired) {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_ADVISORY_LOCK_ID]);
      }
    } finally {
      client.release();
    }
  }
}
