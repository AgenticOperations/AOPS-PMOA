import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { withPostgresCircleOrgLock } from '../../src/engines/payments/circle-org-lock.js';

describe('Postgres Circle organization lock', () => {
  it('does not hold a pool connection while waiting for another org operation', async () => {
    const firstClient = {
      query: vi.fn(() => Promise.resolve({ rows: [{ acquired: false }] })),
      release: vi.fn(),
    };
    const secondClient = {
      query: vi.fn((sql: string) => Promise.resolve(
        sql.includes('pg_try_advisory_lock')
          ? { rows: [{ acquired: true }] }
          : { rows: [{ unlocked: true }] },
      )),
      release: vi.fn(),
    };
    const connect = vi.fn()
      .mockResolvedValueOnce(firstClient)
      .mockResolvedValueOnce(secondClient);
    const pool = { connect } as unknown as pg.Pool;
    const operation = vi.fn(() => Promise.resolve('complete'));

    const result = await withPostgresCircleOrgLock(pool, 'org_1', operation, {
      retryDelayMs: 0,
      timeoutMs: 100,
    });

    expect(result).toBe('complete');
    expect(connect).toHaveBeenCalledTimes(2);
    expect(firstClient.release).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledOnce();
    expect(secondClient.query).toHaveBeenLastCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      ['circle:test:org_1'],
    );
    expect(secondClient.release).toHaveBeenCalledOnce();
  });
});
