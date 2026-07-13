import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /healthz', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the PMOA scaffold health payload', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: 'agentops-pmoa-api',
      version: '0.0.0',
      section: 'section_9',
    });
    await app.close();
  });

  it('reports readiness only when all configured dependencies are ready', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    const readyApp = buildApp({ readiness: () => Promise.resolve(true) });
    const unavailableApp = buildApp({ readiness: () => Promise.resolve(false) });

    const readyResponse = await readyApp.inject({ method: 'GET', url: '/readyz' });
    const unavailableResponse = await unavailableApp.inject({ method: 'GET', url: '/readyz' });

    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.json()).toEqual({
      ok: true,
      service: 'agentops-pmoa-api',
      status: 'ready',
    });
    expect(unavailableResponse.statusCode).toBe(503);
    expect(unavailableResponse.json()).toEqual({
      ok: false,
      service: 'agentops-pmoa-api',
      status: 'not_ready',
    });
    await Promise.all([readyApp.close(), unavailableApp.close()]);
  });

  it('fails readiness closed without leaking dependency errors', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    const app = buildApp({ readiness: () => Promise.reject(new Error('postgres password leaked')) });

    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('postgres password leaked');
    await app.close();
  });

  it('does not mount QA x402 merchant fixtures by default', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    const app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/v1/testnet/x402/weather' });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('mounts QA x402 merchant fixtures only when explicitly enabled', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    const app = buildApp({ enableTestnetX402Fixtures: true });

    const response = await app.inject({ method: 'GET', url: '/v1/testnet/x402/weather' });

    expect(response.statusCode).toBe(402);
    await app.close();
  });
});
