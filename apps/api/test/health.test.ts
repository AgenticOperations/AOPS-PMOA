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
      section: 'section_5',
    });
  });
});
