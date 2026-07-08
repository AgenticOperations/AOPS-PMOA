import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type GoogleUser = {
  readonly sub: string;
  readonly email: string;
  readonly email_verified: boolean;
  readonly name: string;
  readonly picture?: string;
};

type AuthExchangeResponse = {
  readonly session_token: string;
  readonly expires_at: string;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
  };
};

type OrgResponse = {
  readonly org: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly default_team_id: string;
  };
};

type OrgListResponse = {
  readonly orgs: OrgResponse['org'][];
};

function authHeader(token: string): { readonly authorization: string } {
  return { authorization: `Bearer ${token}` };
}

function mockGoogleUser(user: GoogleUser): void {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/token')) {
      return Promise.resolve(Response.json({
        access_token: `access_${user.sub}`,
        expires_in: 3600,
        token_type: 'Bearer',
      }));
    }
    if (url.includes('/userinfo')) {
      return Promise.resolve(Response.json(user));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

describe('Section 1 human auth and tenant scope', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URL', 'http://localhost:3005/api/auth/google/callback');
    vi.stubGlobal('fetch', vi.fn());
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        googleOAuth: {
          clientId: 'google-client-id',
          clientSecret: 'google-client-secret',
          redirectUrl: 'http://localhost:3005/api/auth/google/callback',
        },
        sessionCookieName: 'agentops_session',
      },
    });
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await store.stop();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('requires a human session before listing or creating organizations', async () => {
    const list = await app.inject({ method: 'GET', url: '/v1/orgs' });
    expect(list.statusCode).toBe(401);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/orgs',
      payload: { name: 'No Session Ops' },
    });
    expect(create.statusCode).toBe(401);
  });

  it('builds the Google authorization URL from backend-owned OAuth config', async () => {
    const response = await app.inject({
      method: 'GET',
      url:
        '/v1/auth/google/authorize-url?state=oauth-state-12345&redirect_uri=http%3A%2F%2Flocalhost%3A3005%2Fapi%2Fauth%2Fgoogle%2Fcallback',
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ readonly url: string }>();
    const url = new URL(body.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3005/api/auth/google/callback');
    expect(url.searchParams.get('state')).toBe('oauth-state-12345');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });

  it('exchanges Google auth for a session, creates an owned org, and scopes slug lookup by membership', async () => {
    mockGoogleUser({
      sub: 'google-owner-1',
      email: 'owner@example.test',
      email_verified: true,
      name: 'Owner User',
    });

    const exchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/google/exchange',
      payload: {
        code: 'owner-code',
        redirect_uri: 'http://localhost:3005/api/auth/google/callback',
      },
    });

    expect(exchange.statusCode, exchange.body).toBe(200);
    const ownerSession = exchange.json<AuthExchangeResponse>();
    expect(ownerSession.session_token).toMatch(/^sess_/);
    expect(ownerSession.user).toMatchObject({
      email: 'owner@example.test',
      name: 'Owner User',
    });

    const emptyList = await app.inject({
      method: 'GET',
      url: '/v1/orgs',
      headers: authHeader(ownerSession.session_token),
    });
    expect(emptyList.statusCode).toBe(200);
    expect(emptyList.json<OrgListResponse>().orgs).toEqual([]);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/orgs',
      headers: authHeader(ownerSession.session_token),
      payload: {
        name: 'Acme Agent Ops',
        domain: 'acme.example',
        primary_use_case: 'agent_finops',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const org = created.json<OrgResponse>().org;
    expect(org.id).toMatch(/^org_/);
    expect(org.slug).toBe('acme-agent-ops');

    const scopedBySlug = await app.inject({
      method: 'GET',
      url: `/v1/orgs/by-slug/${org.slug}`,
      headers: authHeader(ownerSession.session_token),
    });
    expect(scopedBySlug.statusCode).toBe(200);
    expect(scopedBySlug.json<OrgResponse>().org.id).toBe(org.id);

    const ownedOrgs = await app.inject({
      method: 'GET',
      url: '/v1/orgs',
      headers: authHeader(ownerSession.session_token),
    });
    expect(ownedOrgs.statusCode).toBe(200);
    expect(ownedOrgs.json<OrgListResponse>().orgs).toEqual([
      expect.objectContaining({ id: org.id, slug: org.slug }),
    ]);

    mockGoogleUser({
      sub: 'google-outsider-1',
      email: 'outsider@example.test',
      email_verified: true,
      name: 'Outside User',
    });
    const outsiderExchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/google/exchange',
      payload: {
        code: 'outsider-code',
        redirect_uri: 'http://localhost:3005/api/auth/google/callback',
      },
    });
    const outsiderSession = outsiderExchange.json<AuthExchangeResponse>();

    const blockedBySlug = await app.inject({
      method: 'GET',
      url: `/v1/orgs/by-slug/${org.slug}`,
      headers: authHeader(outsiderSession.session_token),
    });
    expect(blockedBySlug.statusCode).toBe(404);
  });

  it('revokes server-side sessions on logout', async () => {
    mockGoogleUser({
      sub: 'google-logout-1',
      email: 'logout@example.test',
      email_verified: true,
      name: 'Logout User',
    });
    const exchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/google/exchange',
      payload: {
        code: 'logout-code',
        redirect_uri: 'http://localhost:3005/api/auth/google/callback',
      },
    });
    const session = exchange.json<AuthExchangeResponse>();

    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: authHeader(session.session_token),
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/v1/orgs',
      headers: authHeader(session.session_token),
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});
