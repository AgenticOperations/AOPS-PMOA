import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';
import { authenticateConnection } from '../../src/engines/identity/store.js';

type OrgResponse = {
  readonly org: { readonly id: string };
};

type InviteCreateResponse = {
  readonly token: string;
  readonly invite: {
    readonly id: string;
    readonly max_uses: number;
    readonly use_count: number;
  };
};

type JoinResponse = {
  readonly join: {
    readonly agent_id: string;
    readonly org_id: string;
    readonly connection_id: string;
    readonly mcp_url: string;
    readonly credential: string;
    readonly payment_access: 'disabled';
    readonly join_mode: 'invite' | 'open';
  };
};

describe('Agent join phases 1–3', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;
  let orgId: string;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () =>
          Promise.resolve({
            actorId: 'usr_join_operator',
            role: 'owner',
          }),
      },
      agentJoin: {
        pool: store.pool,
        resolveOperator: () =>
          Promise.resolve({
            actorId: 'usr_join_operator',
            role: 'owner',
          }),
        openJoin: {
          enabled: true,
          orgId: 'pending',
          maxPerFingerprintPerHour: 5,
          maxPerOrgPerDay: 50,
        },
      },
      runtime: {
        pool: store.pool,
      },
    });

    const orgResponse = await app.inject({
      method: 'POST',
      url: '/v1/orgs',
      payload: {
        name: 'Join Org',
        owner: { email: 'owner.join@example.test', name: 'Join Owner' },
      },
    });
    expect(orgResponse.statusCode, orgResponse.body).toBe(201);
    orgId = orgResponse.json<OrgResponse>().org.id;

    // Rebuild openJoin with real org id after org exists.
    await app.close();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () =>
          Promise.resolve({
            actorId: 'usr_join_operator',
            role: 'owner',
          }),
      },
      agentJoin: {
        pool: store.pool,
        resolveOperator: () =>
          Promise.resolve({
            actorId: 'usr_join_operator',
            role: 'owner',
          }),
        openJoin: {
          enabled: true,
          orgId,
          maxPerFingerprintPerHour: 3,
          maxPerOrgPerDay: 10,
        },
      },
      runtime: {
        pool: store.pool,
      },
    });
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await store.stop();
    vi.unstubAllEnvs();
  });

  it('Phase 1: operator creates invite and agent redeems into MCP credential (payment off)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agent-join/invites`,
      payload: { label: 'sandbox', max_uses: 1, expires_in_hours: 24 },
    });
    expect(create.statusCode, create.body).toBe(201);
    const created = create.json<InviteCreateResponse>();
    expect(created.token.startsWith('ajoin_')).toBe(true);
    expect(created.invite.use_count).toBe(0);

    const redeem = await app.inject({
      method: 'POST',
      url: '/v1/agent-join/invite/redeem',
      payload: { token: created.token, agent_name: 'sandbox-bot' },
    });
    expect(redeem.statusCode, redeem.body).toBe(201);
    const joined = redeem.json<JoinResponse>().join;
    expect(joined.org_id).toBe(orgId);
    expect(joined.payment_access).toBe('disabled');
    expect(joined.join_mode).toBe('invite');
    expect(joined.credential.length).toBeGreaterThan(20);
    expect(joined.mcp_url.length).toBeGreaterThan(0);

    const auth = await authenticateConnection(store.pool, joined.credential);
    expect(auth?.agent_id).toBe(joined.agent_id);

    const exhausted = await app.inject({
      method: 'POST',
      url: '/v1/agent-join/invite/redeem',
      payload: { token: created.token },
    });
    expect(exhausted.statusCode).toBe(410);
    expect(exhausted.json<{ error: string }>().error).toBe('join_invite_exhausted');
  });

  it('Phase 2: runtime publish sets public_endpoint_url metadata', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agent-join/invites`,
      payload: { label: 'publish', max_uses: 1 },
    });
    const token = create.json<InviteCreateResponse>().token;
    const redeem = await app.inject({
      method: 'POST',
      url: '/v1/agent-join/invite/redeem',
      payload: { token, agent_name: 'publisher' },
    });
    const joined = redeem.json<JoinResponse>().join;

    const publish = await app.inject({
      method: 'POST',
      url: '/v1/runtime/publish',
      headers: { authorization: `Bearer ${joined.credential}` },
      payload: { public_endpoint_url: 'https://agents.example.test/mcp/publisher' },
    });
    expect(publish.statusCode, publish.body).toBe(200);
    expect(publish.json<{ publish: { public_endpoint_url: string } }>().publish.public_endpoint_url).toBe(
      'https://agents.example.test/mcp/publisher',
    );

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/agents/${joined.agent_id}`,
    });
    expect(detail.statusCode).toBe(200);
    const metadata = detail.json<{ agent: { metadata: Record<string, unknown> } }>().agent.metadata;
    expect(metadata.public_endpoint_url).toBe('https://agents.example.test/mcp/publisher');
    expect(metadata.setup_mode).toBe('publish');
  });

  it('Phase 2: identity register fails closed without agent wallet', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agent-join/invites`,
      payload: { max_uses: 1 },
    });
    const token = create.json<InviteCreateResponse>().token;
    const redeem = await app.inject({
      method: 'POST',
      url: '/v1/agent-join/invite/redeem',
      payload: { token, agent_name: 'no-wallet' },
    });
    const joined = redeem.json<JoinResponse>().join;

    const register = await app.inject({
      method: 'POST',
      url: '/v1/runtime/identity/register',
      headers: { authorization: `Bearer ${joined.credential}` },
      payload: { endpoint_url: 'https://agents.example.test/mcp/no-wallet', chain: 'arc' },
    });
    // Without circle provider factory → 503; with provider but no wallet → 409.
    expect([409, 503]).toContain(register.statusCode);
  });

  it('Phase 3: open register issues credential when enabled; status reports enabled', async () => {
    const status = await app.inject({ method: 'GET', url: '/v1/agent-join/open/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json<{ open_join: { enabled: boolean } }>().open_join.enabled).toBe(true);

    const open = await app.inject({
      method: 'POST',
      url: '/v1/agent-join/open',
      payload: { agent_name: 'cold-start' },
      headers: { 'user-agent': 'agent-join-test/1.0' },
    });
    expect(open.statusCode, open.body).toBe(201);
    const joined = open.json<JoinResponse>().join;
    expect(joined.join_mode).toBe('open');
    expect(joined.payment_access).toBe('disabled');
    expect(joined.org_id).toBe(orgId);

    const auth = await authenticateConnection(store.pool, joined.credential);
    expect(auth?.agent_id).toBe(joined.agent_id);
  });

  it('Phase 3: open register is denied when disabled', async () => {
    await app.close();
    app = buildApp({
      agentJoin: {
        pool: store.pool,
        openJoin: {
          enabled: false,
          orgId,
          maxPerFingerprintPerHour: 3,
          maxPerOrgPerDay: 10,
        },
      },
    });

    const denied = await app.inject({
      method: 'POST',
      url: '/v1/agent-join/open',
      payload: { agent_name: 'should-fail' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<{ error: string }>().error).toBe('open_join_disabled');
  });
});
