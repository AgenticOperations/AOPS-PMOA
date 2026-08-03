import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type OrgResponse = { readonly org: { readonly id: string } };
type AgentResponse = { readonly agent: { readonly id: string } };
type ConnectionResponse = { readonly connection: { readonly id: string } };

async function createOrgAgentAndConnection(app: FastifyInstance) {
  const orgResponse = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: { name: 'Self Approval Org', owner: { email: 'self-approval@example.test', name: 'Alice' } },
  });
  expect(orgResponse.statusCode, orgResponse.body).toBe(201);
  const orgId = orgResponse.json<OrgResponse>().org.id;

  const agentResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload: { name: 'Self approval agent' },
  });
  expect(agentResponse.statusCode, agentResponse.body).toBe(201);
  const agentId = agentResponse.json<AgentResponse>().agent.id;

  const connectionResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
    payload: { kind: 'agent_credential', name: 'Self approval credential' },
  });
  expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
  const connectionId = connectionResponse.json<ConnectionResponse>().connection.id;

  return { agentId, connectionId, orgId };
}

async function seedPendingApproval(
  store: PostgresTestStore,
  input: { readonly orgId: string; readonly agentId: string; readonly connectionId: string; readonly requestedBy: string },
) {
  const decisionId = `pdec_${input.orgId}`;
  const approvalId = `apv_${input.orgId}`;
  await store.pool.query(
    `INSERT INTO policy_decisions (
       id, org_id, actor_type, actor_id, actor_role, action_id, target_type, target_id,
       context, decision, enforceability, reason_code, explanation, matched
     )
     VALUES (
       $1, $2, 'agent', $3, NULL, 'payment.x402.authorize', 'agent', $3,
       $4::jsonb, 'approval_required', 'enforceable', 'matched_policy', 'Approval required.', '[]'::jsonb
     )`,
    [decisionId, input.orgId, input.agentId, JSON.stringify({ payment: { amount: '2.00', asset: 'USDC' } })],
  );
  await store.pool.query(
    `INSERT INTO approval_requests (
       id, org_id, agent_id, connection_id, decision_id, status, action_id, target_type, target_id,
       context, context_hash, requested_by, expires_at
     )
     VALUES (
       $1, $2, $3, $4, $5, 'pending', 'payment.x402.authorize', 'agent', $3,
       $6::jsonb, $7, $8, now() + interval '15 minutes'
     )`,
    [
      approvalId, input.orgId, input.agentId, input.connectionId, decisionId,
      JSON.stringify({ payment: { amount: '2.00', asset: 'USDC' } }), `hash_${input.requestedBy}`, input.requestedBy,
    ],
  );
  return approvalId;
}

describe('separation of duties', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: (request) => Promise.resolve({
          actorId: (request.headers['x-test-actor'] as string | undefined) ?? 'usr_alice',
          role: 'owner',
        }),
      },
      approvals: {
        pool: store.pool,
        resolveOperator: (request) => Promise.resolve({
          actorId: (request.headers['x-test-actor'] as string | undefined) ?? 'usr_alice',
          role: 'owner',
        }),
      },
    });
  }, 90_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (store !== undefined) await store.stop();
    vi.unstubAllEnvs();
  });

  it('forbids the requester from approving their own request', async () => {
    const { orgId, agentId, connectionId } = await createOrgAgentAndConnection(app);
    const approvalId = await seedPendingApproval(store, { orgId, agentId, connectionId, requestedBy: 'usr_alice' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/approvals/${approvalId}/approve`,
      headers: { 'x-test-actor': 'usr_alice' },
      payload: { note: 'Approving my own request' },
    });
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({ error: 'self_approval_forbidden' });
  });

  it('forbids the requester from denying their own request', async () => {
    const { orgId, agentId, connectionId } = await createOrgAgentAndConnection(app);
    const approvalId = await seedPendingApproval(store, { orgId, agentId, connectionId, requestedBy: 'usr_alice' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/approvals/${approvalId}/deny`,
      headers: { 'x-test-actor': 'usr_alice' },
      payload: { note: 'Denying my own request' },
    });
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({ error: 'self_approval_forbidden' });
  });

  it('allows a different operator to approve', async () => {
    const { orgId, agentId, connectionId } = await createOrgAgentAndConnection(app);
    const approvalId = await seedPendingApproval(store, { orgId, agentId, connectionId, requestedBy: 'usr_alice' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/approvals/${approvalId}/approve`,
      headers: { 'x-test-actor': 'usr_bob' },
      payload: { note: 'Approved by Bob' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ approval: { status: string } }>().approval.status).toBe('approved');
  });

  it('allows a different operator to deny', async () => {
    const { orgId, agentId, connectionId } = await createOrgAgentAndConnection(app);
    const approvalId = await seedPendingApproval(store, { orgId, agentId, connectionId, requestedBy: 'usr_alice' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/approvals/${approvalId}/deny`,
      headers: { 'x-test-actor': 'usr_bob' },
      payload: { note: 'Denied by Bob' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ approval: { status: string } }>().approval.status).toBe('denied');
  });
});
