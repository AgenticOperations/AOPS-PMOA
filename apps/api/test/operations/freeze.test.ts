import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createPaymentSource } from '../../src/engines/payments/store.js';
import type { PaidHttpExecutor } from '../../src/engines/payments/x402-http.js';
import { createX402ResultCryptoCodec } from '../../src/engines/payments/x402-result-crypto.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type OrgResponse = {
  readonly org: { readonly id: string };
};

type AgentResponse = {
  readonly agent: { readonly id: string };
};

type ConnectionCreateResponse = {
  readonly secret: string;
};

const paidHttpQuotes = new Map<string, unknown>();
let paidHttpId = 0;

function canonicalPaidHttpPayload(resourceUrl: string) {
  const url = new URL(resourceUrl).href;
  paidHttpQuotes.set(url, {
    accepts: [
      {
        scheme: 'exact',
        network: 'base',
        asset: 'USDC',
        amount: '0.01',
        payTo: '0x0000000000000000000000000000000000000001',
        extra: { name: 'GatewayWalletBatched' },
        maxTimeoutSeconds: 60,
      },
    ],
    resource: {
      category: 'market-data',
      url,
      description: 'Freeze test resource',
      mimeType: 'application/json',
    },
    x402Version: 2,
  });
  paidHttpId += 1;
  return {
    idempotency_key: `freeze-test-${paidHttpId}`,
    request: { headers: [], method: 'GET' as const, url },
  };
}

const paidHttpExecutor: PaidHttpExecutor = (request) => Promise.resolve({
  body: paidHttpQuotes.get(request.url),
  bodyEncoding: 'json',
  contentType: 'application/json',
  headers: [['content-type', 'application/json']],
  sizeBytes: 512,
  status: 402,
  truncated: false,
});

async function createFundedAgent(app: FastifyInstance, store: PostgresTestStore) {
  const orgResponse = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: {
      name: 'Freeze Test Org',
      owner: { email: 'freeze-owner@example.test', name: 'Freeze Owner' },
    },
  });
  expect(orgResponse.statusCode, orgResponse.body).toBe(201);
  const orgId = orgResponse.json<OrgResponse>().org.id;

  // Fail-closed (E1): a fresh org denies everything until a policy
  // matches. Agent/connection provisioning is orthogonal to what this
  // suite tests.
  await store.pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);

  const agentResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload: { name: 'Freeze test agent' },
  });
  expect(agentResponse.statusCode, agentResponse.body).toBe(201);
  const agentId = agentResponse.json<AgentResponse>().agent.id;

  const connectionResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
    payload: { kind: 'agent_credential', name: 'Runtime credential' },
  });
  expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
  const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

  const treasury = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/payments/treasury`,
    payload: { chain: 'base', label: 'Base treasury', treasury_type: 'gateway' },
  });
  expect(treasury.statusCode, treasury.body).toBe(201);

  await createPaymentSource(
    store.pool,
    { actorId: 'usr_freeze_owner', role: 'owner' },
    orgId,
    {
      chain: 'base',
      label: 'Base Gateway source',
      provider: 'simulation',
      rail: 'gateway_base',
      simulated_balance_usdc: '100.00',
      source_type: 'gateway',
    },
  );

  const access = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
    payload: {
      allowed_rails: ['gateway_base'],
      budget_usdc: '10.00',
      dedicated_wallet_required: false,
      per_request_cap_usdc: '5.00',
      status: 'active',
    },
  });
  expect(access.statusCode, access.body).toBe(200);

  return { agentId, orgId, secret };
}

describe('emergency freeze', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_freeze_owner', role: 'owner' }),
      },
      policy: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_freeze_owner', role: 'owner' }),
      },
      payments: {
        paidHttpExecutor,
        paidHttpUrlPolicy: { resolveHostname: () => Promise.resolve(['93.184.216.34']) },
        pool: store.pool,
        resultCrypto: createX402ResultCryptoCodec(randomBytes(32).toString('base64')),
        resolveOperator: () => Promise.resolve({ actorId: 'usr_freeze_owner', role: 'owner' }),
      },
      approvals: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_freeze_owner', role: 'owner' }),
      },
      runtime: {
        pool: store.pool,
      },
    });
  }, 90_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (store !== undefined) await store.stop();
    vi.unstubAllEnvs();
  });

  it('rejects payment for a frozen org before any other check', async () => {
    const { agentId, orgId, secret } = await createFundedAgent(app, store);
    await store.pool.query('UPDATE orgs SET frozen = true, frozen_reason = $2 WHERE id = $1', [
      orgId,
      'incident',
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload('https://seller.example.test/freeze-org-data'),
    });

    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({ error: 'org_frozen' });

    // Nothing may be reserved when frozen.
    const reservations = await store.pool.query('SELECT 1 FROM payment_reservations WHERE org_id = $1', [
      orgId,
    ]);
    expect(reservations.rowCount).toBe(0);
    const account = await store.pool.query<{ reserved_usdc: string }>(
      'SELECT reserved_usdc FROM agent_payment_accounts WHERE org_id = $1 AND agent_id = $2',
      [orgId, agentId],
    );
    expect(Number(account.rows[0]?.reserved_usdc)).toBe(0);
  });

  // A suspended agent is ALREADY blocked upstream of activePaymentAccount:
  // authenticateConnection (identity/store.ts) requires `a.status = 'active'`
  // in its JOIN, so a suspended agent's connection resolves to null and the
  // request never reaches the payment engine at all. That is a *different*,
  // earlier choke point than org-level freeze -- org freeze has no
  // equivalent existing check, which is the actual gap Task 3 closes.
  it('already blocks a suspended agent at the connection-auth layer, but not its siblings', async () => {
    const { agentId, orgId, secret } = await createFundedAgent(app, store);

    const siblingAgentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Sibling agent' },
    });
    expect(siblingAgentResponse.statusCode, siblingAgentResponse.body).toBe(201);
    const siblingAgentId = siblingAgentResponse.json<AgentResponse>().agent.id;
    const siblingConnection = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${siblingAgentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Sibling credential' },
    });
    expect(siblingConnection.statusCode, siblingConnection.body).toBe(201);
    const siblingSecret = siblingConnection.json<ConnectionCreateResponse>().secret;
    const siblingAccess = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${siblingAgentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_base'],
        budget_usdc: '10.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '5.00',
        status: 'active',
      },
    });
    expect(siblingAccess.statusCode, siblingAccess.body).toBe(200);

    await store.pool.query("UPDATE agents SET status = 'suspended' WHERE id = $1", [agentId]);

    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload('https://seller.example.test/freeze-agent-data'),
    });
    expect(blocked.statusCode, blocked.body).toBe(401);
    expect(blocked.json()).toMatchObject({ error: 'invalid_connection' });

    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${siblingSecret}` },
      payload: canonicalPaidHttpPayload('https://seller.example.test/sibling-data'),
    });
    expect(allowed.statusCode, allowed.body).not.toBe(401);
    expect(allowed.statusCode, allowed.body).not.toBe(403);
  });

  it('rejects non-payment runtime actions for a frozen org', async () => {
    const { orgId, secret } = await createFundedAgent(app, store);
    await store.pool.query('UPDATE orgs SET frozen = true WHERE id = $1', [orgId]);

    const onboard = await app.inject({
      method: 'POST',
      url: '/v1/runtime/onboard',
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(onboard.statusCode, onboard.body).toBe(403);
    expect(onboard.json()).toMatchObject({ error: 'org_frozen' });

    const check = await app.inject({
      method: 'POST',
      url: '/v1/runtime/check',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        action: 'runtime.http.request',
        resource: { category: 'open-data', url: 'https://docs.example.test/status' },
      },
    });
    expect(check.statusCode, check.body).toBe(403);
    expect(check.json()).toMatchObject({ error: 'org_frozen' });
  });

  it('allows runtime actions once unfrozen', async () => {
    const { orgId, secret } = await createFundedAgent(app, store);
    await store.pool.query('UPDATE orgs SET frozen = true WHERE id = $1', [orgId]);
    await store.pool.query('UPDATE orgs SET frozen = false WHERE id = $1', [orgId]);

    const onboard = await app.inject({
      method: 'POST',
      url: '/v1/runtime/onboard',
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(onboard.statusCode, onboard.body).toBe(200);
  });
});
