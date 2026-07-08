import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revokeConnection, rotateConnection, testConnection } from '../../src/lib/server/identity-spine-client.js';

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => ({ value: 'sess_test' })),
  })),
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

describe('identity spine API client', () => {
  beforeEach(() => {
    process.env.AGENTOPS_API_BASE_URL = 'http://api.test';
    vi.restoreAllMocks();
  });

  it('does not send json content-type for empty connection action bodies', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      if (String(_url).endsWith('/rotate')) {
        return jsonResponse({ connection: { id: 'conn_1' }, secret: 'conn_secret' });
      }
      return jsonResponse({ connection: { id: 'conn_1' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await testConnection('org_acme', 'conn_1');
    await rotateConnection('org_acme', 'conn_1');
    await revokeConnection('org_acme', 'conn_1');

    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toEqual({ authorization: 'Bearer sess_test' });
    }
  });
});
