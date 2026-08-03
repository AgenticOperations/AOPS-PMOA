import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createPaymentSource } from '../../src/engines/payments/store.js';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import type { PaidHttpExecutor } from '../../src/engines/payments/x402-http.js';
import { createX402ResultCryptoCodec } from '../../src/engines/payments/x402-result-crypto.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type OrgResponse = { readonly org: { readonly id: string } };
type AgentResponse = { readonly agent: { readonly id: string } };
type ConnectionCreateResponse = { readonly secret: string };

const paidHttpQuotes = new Map<string, unknown>();
let paidHttpId = 0;

function canonicalPaidHttpPayload(amount: string) {
  const url = `https://seller.example.test/arc-balance-${paidHttpId}`;
  paidHttpQuotes.set(url, {
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:5042002',
        asset: 'USDC',
        amount,
        payTo: '0x1111111111111111111111111111111111111111',
        maxTimeoutSeconds: 60,
        extra: { name: 'GatewayWalletBatched' },
      },
    ],
    resource: { category: 'market-data', url, description: 'Arc balance test resource', mimeType: 'application/json' },
    x402Version: 2,
  });
  paidHttpId += 1;
  return {
    idempotency_key: `arc-balance-${paidHttpId}`,
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

async function seedArcSource(store: PostgresTestStore, orgId: string) {
  // simulation provider is only accepted on gateway rails (createPaymentSource
  // requires circle_wallets for direct_exact) -- follows the same pattern
  // section-6-8-payment-control.test.ts uses for gateway_base.
  return createPaymentSource(
    store.pool,
    { actorId: 'usr_arc_balance_owner', role: 'owner' },
    orgId,
    {
      chain: 'arc',
      label: 'Arc Gateway source',
      provider: 'simulation',
      rail: 'gateway_arc',
      simulated_balance_usdc: '1000.00',
      source_type: 'gateway',
    },
  );
}

async function createOrgAgentAndConnection(app: FastifyInstance, pool: PostgresTestStore['pool']) {
  const org = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: { name: 'Arc Balance Org', owner: { email: 'arc-balance@example.test', name: 'Owner' } },
  });
  expect(org.statusCode, org.body).toBe(201);
  const orgId = org.json<OrgResponse>().org.id;

  // Fail-closed (E1): a fresh org denies everything until a policy matches.
  await pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);

  const agent = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload: { name: 'Arc balance agent' },
  });
  expect(agent.statusCode, agent.body).toBe(201);
  const agentId = agent.json<AgentResponse>().agent.id;

  const connection = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
    payload: { kind: 'agent_credential', name: 'Runtime credential' },
  });
  expect(connection.statusCode, connection.body).toBe(201);
  const secret = connection.json<ConnectionCreateResponse>().secret;

  // recordProvisionedWallet needs a circle_wallet_sets row to hang the
  // wallet off of -- no route creates one automatically, so seed it
  // directly, matching agent-wallets.test.ts's setupAgentFixture pattern.
  await pool.query(
    `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
     VALUES ($1, $2, 'test', $3, 'Arc balance wallet set', 'usr_arc_balance_owner')`,
    [`ws_${agentId}`, orgId, `circle_ws_${agentId}`],
  );

  return { agentId, orgId, secret };
}

function stubNativeBalance(weiByAddress: Record<string, bigint>): void {
  vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
    const body = JSON.parse((init?.body as string) ?? '{}') as { readonly params?: readonly [string, string] };
    const address = body.params?.[0] ?? '';
    const wei = weiByAddress[address] ?? 0n;
    return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: `0x${wei.toString(16)}` })));
  });
}

describe('agent wallet balance ceiling', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    vi.stubEnv('ARC_RPC_URL', 'https://rpc.testnet.arc.network');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_arc_balance_owner', role: 'owner' }),
      },
      payments: {
        paidHttpExecutor,
        paidHttpUrlPolicy: { resolveHostname: () => Promise.resolve(['93.184.216.34']) },
        pool: store.pool,
        resultCrypto: createX402ResultCryptoCodec(randomBytes(32).toString('base64')),
        resolveOperator: () => Promise.resolve({ actorId: 'usr_arc_balance_owner', role: 'owner' }),
      },
      policy: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_arc_balance_owner', role: 'owner' }),
      },
      approvals: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_arc_balance_owner', role: 'owner' }),
      },
      runtime: { pool: store.pool },
    });
  }, 90_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (store !== undefined) await store.stop();
    vi.unstubAllEnvs();
  });

  it('rejects a payment above the wallet spendable balance even though counters allow it', async () => {
    const { orgId, agentId, secret } = await createOrgAgentAndConnection(app, store.pool);
    await seedArcSource(store, orgId);
    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arc'],
        budget_usdc: '10.00',       // counters say $10 is fine
        dedicated_wallet_required: false,
        status: 'active',
        per_request_cap_usdc: '5.00',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const walletSet = await store.pool.query<{ id: string }>(
      "SELECT id FROM circle_wallet_sets WHERE org_id = $1 AND mode = 'test'", [orgId],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_balance_test', address: '0xaaaa000000000000000000000000000000000a',
      refId: 'ref_balance_test', walletSetId: walletSet.rows[0]!.id, circleBlockchain: 'ARC-TESTNET',
    });

    // The chain says the wallet holds exactly $2.00 -- less than the $5
    // request, even though the counters (budget $10, nothing spent) would
    // allow it.
    stubNativeBalance({ '0xaaaa000000000000000000000000000000000a': 2_000_000_000_000_000_000n });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload('5000000'),
    });

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ error: 'insufficient_agent_wallet_balance' });
  });

  it('still enforces the counter pre-filter when the wallet is rich', async () => {
    const { orgId, agentId, secret } = await createOrgAgentAndConnection(app, store.pool);
    await seedArcSource(store, orgId);
    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arc'],
        budget_usdc: '1.00',
        dedicated_wallet_required: false,
        status: 'active',
        per_request_cap_usdc: '5.00',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const walletSet = await store.pool.query<{ id: string }>(
      "SELECT id FROM circle_wallet_sets WHERE org_id = $1 AND mode = 'test'", [orgId],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_rich_test', address: '0xbbbb000000000000000000000000000000000b',
      refId: 'ref_rich_test', walletSetId: walletSet.rows[0]!.id, circleBlockchain: 'ARC-TESTNET',
    });

    // Wallet holds $100 on-chain, but the counter budget is only $1.
    stubNativeBalance({ '0xbbbb000000000000000000000000000000000b': 100_000_000_000_000_000_000n });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload('5000000'),
    });

    // The counter pre-filter must still fire, with its own distinct code
    // -- not the balance-ceiling one.
    expect(response.json()).toMatchObject({ error: 'budget_exceeded' });
  });

  it('allows a payment within the wallet spendable balance', async () => {
    const { orgId, agentId, secret } = await createOrgAgentAndConnection(app, store.pool);
    await seedArcSource(store, orgId);
    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arc'],
        budget_usdc: '10.00',
        dedicated_wallet_required: false,
        status: 'active',
        per_request_cap_usdc: '5.00',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const walletSet = await store.pool.query<{ id: string }>(
      "SELECT id FROM circle_wallet_sets WHERE org_id = $1 AND mode = 'test'", [orgId],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_ok_test', address: '0xcccc000000000000000000000000000000000c',
      refId: 'ref_ok_test', walletSetId: walletSet.rows[0]!.id, circleBlockchain: 'ARC-TESTNET',
    });

    stubNativeBalance({ '0xcccc000000000000000000000000000000000c': 10_000_000_000_000_000_000n }); // $10

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload('5000000'),
    });

    expect(response.statusCode, response.body).not.toBe(409);
    expect(response.json()).not.toMatchObject({ error: 'insufficient_agent_wallet_balance' });
  });

  it('does not block agents with no per-agent wallet -- the shared org wallet still works', async () => {
    const { orgId, agentId, secret } = await createOrgAgentAndConnection(app, store.pool);
    await seedArcSource(store, orgId);
    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arc'],
        budget_usdc: '10.00',
        dedicated_wallet_required: false,
        status: 'active',
        per_request_cap_usdc: '5.00',
      },
    });
    expect(access.statusCode, access.body).toBe(200);
    // Deliberately no agent_chain_wallets row for this agent.

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload('5000000'),
    });

    expect(response.statusCode, response.body).not.toBe(409);
    expect(response.json()).not.toMatchObject({ error: 'insufficient_agent_wallet_balance' });
  });
});
