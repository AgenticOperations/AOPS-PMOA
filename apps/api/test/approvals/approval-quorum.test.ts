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
    payload: { name: 'Quorum Org', owner: { email: 'quorum@example.test', name: 'Alice' } },
  });
  expect(orgResponse.statusCode, orgResponse.body).toBe(201);
  const orgId = orgResponse.json<OrgResponse>().org.id;

  const agentResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload: { name: 'Quorum agent' },
  });
  expect(agentResponse.statusCode, agentResponse.body).toBe(201);
  const agentId = agentResponse.json<AgentResponse>().agent.id;

  const connectionResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
    payload: { kind: 'agent_credential', name: 'Quorum credential' },
  });
  expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
  const connectionId = connectionResponse.json<ConnectionResponse>().connection.id;

  return { agentId, connectionId, orgId };
}

let seedCounter = 0;

// requiredApprovals stands in for K-9's "amount vs. threshold" policy,
// which decides this outside the engine (see approvals/store.ts's comment
// on createApprovalRequest's requiredApprovals input) -- here it is just
// supplied directly, matching how a real caller would after computing it.
async function seedPendingApproval(
  store: PostgresTestStore,
  input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly connectionId: string;
    readonly requestedBy: string;
    readonly requiredApprovals: number;
  },
) {
  seedCounter += 1;
  const decisionId = `pdec_quorum_${seedCounter}`;
  const approvalId = `apv_quorum_${seedCounter}`;
  await store.pool.query(
    `INSERT INTO policy_decisions (
       id, org_id, actor_type, actor_id, actor_role, action_id, target_type, target_id,
       context, decision, enforceability, reason_code, explanation, matched
     )
     VALUES (
       $1, $2, 'agent', $3, NULL, 'payment.x402.authorize', 'agent', $3,
       $4::jsonb, 'approval_required', 'enforceable', 'matched_policy', 'Approval required.', '[]'::jsonb
     )`,
    [decisionId, input.orgId, input.agentId, JSON.stringify({ payment: { amount: '500.00', asset: 'USDC' } })],
  );
  await store.pool.query(
    `INSERT INTO approval_requests (
       id, org_id, agent_id, connection_id, decision_id, status, action_id, target_type, target_id,
       context, context_hash, requested_by, expires_at, required_approvals
     )
     VALUES (
       $1, $2, $3, $4, $5, 'pending', 'payment.x402.authorize', 'agent', $3,
       $6::jsonb, $7, $8, now() + interval '15 minutes', $9
     )`,
    [
      approvalId, input.orgId, input.agentId, input.connectionId, decisionId,
      JSON.stringify({ payment: { amount: '500.00', asset: 'USDC' } }), `hash_quorum_${seedCounter}`,
      input.requestedBy, input.requiredApprovals,
    ],
  );
  return approvalId;
}

describe('approval quorum', () => {
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

  async function approveAs(orgId: string, approvalId: string, actor: string) {
    return app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/approvals/${approvalId}/approve`,
      headers: { 'x-test-actor': actor },
      payload: { note: `Approved by ${actor}` },
    });
  }

  it('requires two approvers above the configured threshold', async () => {
    const { orgId, agentId, connectionId } = await createOrgAgentAndConnection(app);
    const approvalId = await seedPendingApproval(store, {
      orgId, agentId, connectionId, requestedBy: 'usr_alice', requiredApprovals: 2,
    });

    const first = await approveAs(orgId, approvalId, 'usr_bob');
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<{ approval: { status: string; votes_count: number; required_approvals: number } }>().approval)
      .toMatchObject({ status: 'pending', votes_count: 1, required_approvals: 2 }); // not yet approved

    const second = await approveAs(orgId, approvalId, 'usr_carol');
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json<{ approval: { status: string; votes_count: number } }>().approval)
      .toMatchObject({ status: 'approved', votes_count: 2 });
  });

  it('still forbids the same operator approving twice toward quorum', async () => {
    const { orgId, agentId, connectionId } = await createOrgAgentAndConnection(app);
    const approvalId = await seedPendingApproval(store, {
      orgId, agentId, connectionId, requestedBy: 'usr_alice', requiredApprovals: 2,
    });

    const first = await approveAs(orgId, approvalId, 'usr_bob');
    expect(first.statusCode, first.body).toBe(200);

    const again = await approveAs(orgId, approvalId, 'usr_bob');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'already_voted' });
  });

  it('requires only one approver below the threshold', async () => {
    const { orgId, agentId, connectionId } = await createOrgAgentAndConnection(app);
    const approvalId = await seedPendingApproval(store, {
      orgId, agentId, connectionId, requestedBy: 'usr_alice', requiredApprovals: 1,
    });

    const response = await approveAs(orgId, approvalId, 'usr_bob');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ approval: { status: string } }>().approval.status).toBe('approved');
  });

  it('still forbids the requester from voting toward quorum', async () => {
    const { orgId, agentId, connectionId } = await createOrgAgentAndConnection(app);
    const approvalId = await seedPendingApproval(store, {
      orgId, agentId, connectionId, requestedBy: 'usr_alice', requiredApprovals: 2,
    });

    const response = await approveAs(orgId, approvalId, 'usr_alice');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'self_approval_forbidden' });
  });

  it('requires three distinct approvers when quorum is 3', async () => {
    const { orgId, agentId, connectionId } = await createOrgAgentAndConnection(app);
    const approvalId = await seedPendingApproval(store, {
      orgId, agentId, connectionId, requestedBy: 'usr_alice', requiredApprovals: 3,
    });

    expect((await approveAs(orgId, approvalId, 'usr_bob')).json<{ approval: { status: string } }>().approval.status).toBe('pending');
    expect((await approveAs(orgId, approvalId, 'usr_carol')).json<{ approval: { status: string } }>().approval.status).toBe('pending');
    expect((await approveAs(orgId, approvalId, 'usr_dave')).json<{ approval: { status: string } }>().approval.status).toBe('approved');
  });
});
