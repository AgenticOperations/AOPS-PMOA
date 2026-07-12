import type pg from 'pg';

type CircleOrgLockOptions = {
  readonly retryDelayMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
};

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withPostgresCircleOrgLock<T>(
  pool: pg.Pool,
  orgId: string,
  operation: () => Promise<T>,
  options: CircleOrgLockOptions = {},
): Promise<T> {
  const lockKey = `circle:test:${orgId}`;
  const retryDelayMs = options.retryDelayMs ?? 50;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const deadline = Date.now() + timeoutMs;
  let client: pg.PoolClient | null = null;

  while (client === null) {
    const candidate = await pool.connect();
    try {
      const result = await candidate.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
        [lockKey],
      );
      if (result.rows[0]?.acquired === true) {
        client = candidate;
        break;
      }
    } catch (error) {
      candidate.release();
      throw error;
    }
    candidate.release();
    if (Date.now() >= deadline) throw new Error('circle_org_lock_timeout');
    await sleep(retryDelayMs);
  }

  try {
    return await operation();
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
    } finally {
      client.release();
    }
  }
}
