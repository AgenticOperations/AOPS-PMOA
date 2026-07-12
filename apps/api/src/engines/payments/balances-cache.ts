import type { Redis } from 'ioredis';
import type { CircleChainBalanceRecord, PaymentMode } from './types.js';

const TTL_SECONDS = 25;

function cacheKey(orgId: string, mode: PaymentMode): string {
  return `payments:balances:${orgId}:${mode}`;
}

export async function readCachedBalances(
  redis: Redis | undefined,
  orgId: string,
  mode: PaymentMode,
): Promise<readonly CircleChainBalanceRecord[] | null> {
  if (redis === undefined) return null;
  try {
    const cached = await redis.get(cacheKey(orgId, mode));
    return cached === null ? null : (JSON.parse(cached) as CircleChainBalanceRecord[]);
  } catch {
    return null;
  }
}

export async function writeCachedBalances(
  redis: Redis | undefined,
  orgId: string,
  mode: PaymentMode,
  balances: readonly CircleChainBalanceRecord[],
): Promise<void> {
  if (redis === undefined) return;
  try {
    await redis.set(cacheKey(orgId, mode), JSON.stringify(balances), 'EX', TTL_SECONDS);
  } catch {
    // Cache write failures must never break the payments read path.
  }
}

export async function invalidateCachedBalances(
  redis: Redis | undefined,
  orgId: string,
  mode: PaymentMode,
): Promise<void> {
  if (redis === undefined) return;
  try {
    await redis.del(cacheKey(orgId, mode));
  } catch {
    // Best-effort invalidation only; the TTL bounds staleness regardless.
  }
}
