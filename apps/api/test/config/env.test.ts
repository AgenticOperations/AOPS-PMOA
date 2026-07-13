import { describe, expect, it } from 'vitest';
import { readApiEnv } from '../../src/config/env.js';

const BASE64_32_BYTES = Buffer.alloc(32, 7).toString('base64');

function productionApiEnv(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://agentops:secret@postgres:5432/agentops',
    REDIS_URL: 'redis://redis:6379',
    APP_BASE_URL: 'https://console.example.com',
    PUBLIC_API_BASE_URL: 'https://api.example.com',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    GOOGLE_OAUTH_REDIRECT_URL: 'https://console.example.com/api/auth/google/callback',
    CIRCLE_WORKER_TOKEN: 'worker-token-at-least-32-characters',
    CIRCLE_WORKER_URL: 'http://circle-worker:8090',
    CIRCLE_WORKER_TIMEOUT_MS: '2500',
    ENABLE_TESTNET_X402_FIXTURES: 'false',
    X402_RESULT_ENCRYPTION_KEY: BASE64_32_BYTES,
  };
}

describe('API deployment environment', () => {
  it('preserves safe local defaults outside production', () => {
    const env = readApiEnv({}, 'api');

    expect(env.databaseUrl).toContain('@localhost:5432/');
    expect(env.enableTestnetX402Fixtures).toBe(false);
    expect(env.circleWorkerTimeoutMs).toBe(10_000);
  });

  it.each([
    'DATABASE_URL',
    'REDIS_URL',
    'APP_BASE_URL',
    'PUBLIC_API_BASE_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_OAUTH_REDIRECT_URL',
    'CIRCLE_WORKER_TOKEN',
    'CIRCLE_WORKER_URL',
    'X402_RESULT_ENCRYPTION_KEY',
  ])('fails closed when production API value %s is missing', (key) => {
    const environment = productionApiEnv();
    delete environment[key];

    expect(() => readApiEnv(environment, 'api')).toThrow(key);
  });

  it.each([
    ['DATABASE_URL', 'postgres://agentops:secret@localhost:5432/agentops'],
    ['REDIS_URL', 'redis://127.0.0.1:6379'],
    ['APP_BASE_URL', 'https://localhost:3005'],
    ['PUBLIC_API_BASE_URL', 'https://127.0.0.1:8080'],
    ['GOOGLE_OAUTH_REDIRECT_URL', 'https://localhost:3005/api/auth/google/callback'],
    ['CIRCLE_WORKER_URL', 'http://127.0.0.1:8090'],
  ])('rejects a production loopback authority in %s', (key, value) => {
    const environment = productionApiEnv();
    environment[key] = value;

    expect(() => readApiEnv(environment, 'api')).toThrow(key);
  });

  it('accepts an explicit non-loopback production API contract', () => {
    const env = readApiEnv(productionApiEnv(), 'api');

    expect(env.appBaseUrl).toBe('https://console.example.com');
    expect(env.publicApiBaseUrl).toBe('https://api.example.com');
    expect(env.circleWorkerTimeoutMs).toBe(2500);
    expect(env.x402ResultEncryptionKey).toBe(BASE64_32_BYTES);
  });

  it('requires only worker-owned secrets and database authority for the production worker', () => {
    const env = readApiEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://agentops:secret@postgres:5432/agentops',
      CIRCLE_PROFILE_MASTER_KEY: BASE64_32_BYTES,
      CIRCLE_WORKER_TOKEN: 'worker-token-at-least-32-characters',
      ENABLE_TESTNET_X402_FIXTURES: 'false',
    }, 'worker');

    expect(env.circleProfileMasterKey).toBe(BASE64_32_BYTES);
    expect(env.enableTestnetX402Fixtures).toBe(false);
  });

  it('rejects a malformed production worker profile key', () => {
    expect(() => readApiEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://agentops:secret@postgres:5432/agentops',
      CIRCLE_PROFILE_MASTER_KEY: 'not-a-32-byte-key',
      CIRCLE_WORKER_TOKEN: 'worker-token-at-least-32-characters',
    }, 'worker')).toThrow('CIRCLE_PROFILE_MASTER_KEY');
  });

  it('requires an explicit public API origin when QA fixtures are enabled', () => {
    expect(() => readApiEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://agentops:secret@postgres:5432/agentops',
      CIRCLE_PROFILE_MASTER_KEY: BASE64_32_BYTES,
      CIRCLE_WORKER_TOKEN: 'worker-token-at-least-32-characters',
      ENABLE_TESTNET_X402_FIXTURES: 'true',
    }, 'worker')).toThrow('PUBLIC_API_BASE_URL');
  });
});
