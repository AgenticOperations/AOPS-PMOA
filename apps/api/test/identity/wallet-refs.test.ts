import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type OrgResponse = {
  readonly org: {
    readonly id: string;
  };
};

type AgentResponse = {
  readonly agent: {
    readonly id: string;
  };
};

type WalletRefResponse = {
  readonly wallet_ref: {
    readonly id: string;
    readonly agent_id: string;
    readonly provider: string;
    readonly external_wallet_id: string | null;
    readonly address: string | null;
    readonly chain: string | null;
    readonly label: string;
    readonly status: string;
  };
};

type WalletRefListResponse = {
  readonly wallet_refs: WalletRefResponse['wallet_ref'][];
};

async function createOrgAndAgent(
  app: FastifyInstance,
  label: string,
): Promise<{ orgId: string; agentId: string }> {
  const orgResponse = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: {
      name: `${label} Org`,
      owner: { email: `${label}@example.test`, name: `${label} Owner` },
    },
  });
  expect(orgResponse.statusCode, orgResponse.body).toBe(201);
  const orgId = orgResponse.json<OrgResponse>().org.id;

  const agentResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload: { name: `${label} Agent` },
  });
  expect(agentResponse.statusCode).toBe(201);

  return { orgId, agentId: agentResponse.json<AgentResponse>().agent.id };
}

describe('Section 1 wallet references', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({
          actorId: 'usr_wallet_operator',
          role: 'owner',
        }),
      },
    });
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await store.stop();
    vi.unstubAllEnvs();
  });

  it('attaches, lists, and detaches wallet references without moving funds', async () => {
    const { orgId, agentId } = await createOrgAndAgent(app, 'Wallet');

    const attach = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/wallet-refs`,
      payload: {
        provider: 'circle_developer_controlled',
        external_wallet_id: 'wallet_123',
        address: '0x1111111111111111111111111111111111111111',
        chain: 'arc-testnet',
        label: 'Managed wallet',
      },
    });

    expect(attach.statusCode).toBe(201);
    const walletRef = attach.json<WalletRefResponse>().wallet_ref;
    expect(walletRef).toMatchObject({
      agent_id: agentId,
      provider: 'circle_developer_controlled',
      external_wallet_id: 'wallet_123',
      address: '0x1111111111111111111111111111111111111111',
      chain: 'arc-testnet',
      label: 'Managed wallet',
      status: 'attached',
    });

    const duplicate = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/wallet-refs`,
      payload: {
        provider: 'circle_developer_controlled',
        external_wallet_id: 'wallet_123',
        address: '0x1111111111111111111111111111111111111111',
        chain: 'arc-testnet',
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const list = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/agents/${agentId}/wallet-refs`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<WalletRefListResponse>().wallet_refs).toHaveLength(1);

    const detach = await app.inject({
      method: 'DELETE',
      url: `/v1/orgs/${orgId}/agents/${agentId}/wallet-refs/${walletRef.id}`,
    });
    expect(detach.statusCode).toBe(200);
    expect(detach.json<WalletRefResponse>().wallet_ref.status).toBe('detached');

    const afterDetach = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/agents/${agentId}/wallet-refs`,
    });
    expect(afterDetach.json<WalletRefListResponse>().wallet_refs).toEqual([]);

    const audit = await store.pool.query<{ action: string }>(
      `SELECT action
         FROM audit_events
        WHERE org_id = $1 AND resource_type = 'wallet_ref' AND resource_id = $2
        ORDER BY sequence ASC`,
      [orgId, walletRef.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'wallet_ref.attached',
      'wallet_ref.detached',
    ]);
  });

  it('rejects cross-org agent wallet references without leaking the target', async () => {
    const first = await createOrgAndAgent(app, 'WalletA');
    const second = await createOrgAndAgent(app, 'WalletB');

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${first.orgId}/agents/${second.agentId}/wallet-refs`,
      payload: {
        provider: 'external',
        address: '0x2222222222222222222222222222222222222222',
        chain: 'base',
      },
    });

    expect(response.statusCode).toBe(404);
  });
});
