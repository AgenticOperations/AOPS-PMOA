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

type ConnectionResponse = {
  readonly connection: {
    readonly id: string;
  };
};

type ApprovalResponse = {
  readonly approval: {
    readonly id: string;
    readonly status: string;
  };
};

type ApprovalListResponse = {
  readonly approvals: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
  }>;
};

async function createOrgAgentAndConnection(app: FastifyInstance) {
  const orgResponse = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: {
      name: 'Approval Expiry Org',
      owner: { email: 'approval-expiry@example.test', name: 'Approval Owner' },
    },
  });
  expect(orgResponse.statusCode, orgResponse.body).toBe(201);
  const orgId = orgResponse.json<OrgResponse>().org.id;

  const agentResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload: { name: 'Approval expiry agent' },
  });
  expect(agentResponse.statusCode, agentResponse.body).toBe(201);
  const agentId = agentResponse.json<AgentResponse>().agent.id;

  const connectionResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
    payload: { kind: 'agent_credential', name: 'Approval expiry credential' },
  });
  expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
  const connectionId = connectionResponse.json<ConnectionResponse>().connection.id;

  return { agentId, connectionId, orgId };
}

describe('approval expiry', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_approval_owner', role: 'owner' }),
      },
      approvals: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_approval_owner', role: 'owner' }),
      },
    });
  }, 90_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (store !== undefined) await store.stop();
    vi.unstubAllEnvs();
  });

  it('surfaces expired pending requests as expired and blocks decisions on them', async () => {
    const { agentId, connectionId, orgId } = await createOrgAgentAndConnection(app);
    const decisionId = 'pdec_expired_approval';
    const approvalId = 'apv_expired_approval';

    await store.pool.query(
      `INSERT INTO policy_decisions (
         id, org_id, actor_type, actor_id, actor_role, action_id, target_type, target_id,
         context, decision, enforceability, reason_code, explanation, matched
       )
       VALUES (
         $1, $2, 'agent', $3, NULL, 'payment.x402.authorize', 'agent', $3,
         $4::jsonb, 'approval_required', 'enforceable', 'matched_policy', 'Approval required.', '[]'::jsonb
       )`,
      [decisionId, orgId, agentId, JSON.stringify({ payment: { amount: '2.00', asset: 'USDC' } })],
    );

    await store.pool.query(
      `INSERT INTO approval_requests (
         id, org_id, agent_id, connection_id, decision_id, status, action_id, target_type, target_id,
         context, context_hash, requested_by, expires_at
       )
       VALUES (
         $1, $2, $3, $4, $5, 'pending', 'payment.x402.authorize', 'agent', $3,
         $6::jsonb, $7, $4, now() - interval '1 minute'
       )`,
      [
        approvalId,
        orgId,
        agentId,
        connectionId,
        decisionId,
        JSON.stringify({ payment: { amount: '2.00', asset: 'USDC' } }),
        'expired-context-hash',
      ],
    );

    const listResponse = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/approvals`,
    });
    expect(listResponse.statusCode, listResponse.body).toBe(200);
    expect(listResponse.json<ApprovalListResponse>().approvals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: approvalId,
          status: 'expired',
        }),
      ]),
    );

    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/approvals/${approvalId}`,
    });
    expect(getResponse.statusCode, getResponse.body).toBe(200);
    expect(getResponse.json<ApprovalResponse>().approval).toMatchObject({
      id: approvalId,
      status: 'expired',
    });

    const approveResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/approvals/${approvalId}/approve`,
      payload: { note: 'Late approve' },
    });
    expect(approveResponse.statusCode, approveResponse.body).toBe(409);
    expect(approveResponse.json()).toMatchObject({ error: 'approval_not_pending' });

    const denyResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/approvals/${approvalId}/deny`,
      payload: { note: 'Late deny' },
    });
    expect(denyResponse.statusCode, denyResponse.body).toBe(409);
    expect(denyResponse.json()).toMatchObject({ error: 'approval_not_pending' });
  });
});
