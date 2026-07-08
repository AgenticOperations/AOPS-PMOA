import { z } from 'zod';

export const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

export function readStringEnv(name: string, fallback?: string): string {
  const value = process.env[name] !== undefined ? process.env[name] : fallback;

  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

export function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric env var: ${name}`);
  }

  return value;
}
