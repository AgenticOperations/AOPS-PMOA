import { describe, expect, it, vi } from 'vitest';
import {
  createHttpReadinessCheck,
  createReadinessProbe,
} from '../src/readiness.js';

describe('dependency readiness', () => {
  it('is ready only after every dependency check succeeds', async () => {
    const database = vi.fn(() => Promise.resolve());
    const redis = vi.fn(() => Promise.resolve());
    const worker = vi.fn(() => Promise.resolve());
    const readiness = createReadinessProbe([database, redis, worker]);

    await expect(readiness()).resolves.toBe(true);
    expect(database).toHaveBeenCalledOnce();
    expect(redis).toHaveBeenCalledOnce();
    expect(worker).toHaveBeenCalledOnce();
  });

  it('is not ready when any dependency check rejects', async () => {
    const readiness = createReadinessProbe([
      () => Promise.resolve(),
      () => Promise.reject(new Error('redis unavailable')),
    ]);

    await expect(readiness()).resolves.toBe(false);
  });

  it('requires an OK response from a bounded HTTP dependency check', async () => {
    let signal: AbortSignal | undefined;
    const request = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return Promise.resolve(new Response(null, { status: 503 }));
    });
    const check = createHttpReadinessCheck({
      request,
      timeoutMs: 50,
      url: 'http://circle-worker:8090/readyz',
    });

    await expect(check()).rejects.toThrow('dependency_not_ready');
    expect(signal).toBeDefined();
  });
});
