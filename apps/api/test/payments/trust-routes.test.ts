import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import type { EscrowState } from '../../src/engines/payments/escrow.js';
import { createX402ResultCryptoCodec } from '../../src/engines/payments/x402-result-crypto.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

const ESCROW_ADDRESS = '0x31C050d9D20504c4E11b2A894051d8181B14e0F5';
const ARC_USDC = '0x3600000000000000000000000000000000000000';

const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xtx' }));
const signPermit2Delegation = vi.fn(() => Promise.resolve({ signature: '0xsig' }));

function fakeProvider(): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: vi.fn(),
    executePermit2Transaction,
    getGatewayBalance: vi.fn(),
    getWalletBalances: vi.fn(),
    health: () => ({ configured: true, missing: [], mode: 'test', provider: 'circle' }),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation,
    transferWallet: vi.fn(),
  };
}

function hexAddress(prefix: string, suffix: string): string {
  const seed = [...suffix].map((c) => c.charCodeAt(0).toString(16)).join('');
  return `0x${`${prefix}${seed}`.padEnd(40, '0').slice(0, 40)}`;
}

/** Stubs Arc's RPC for solvency (eth_getBalance) and the Permit2 nonce (eth_call), which a treasury delegation reads together. */
function stubArcRpc(balanceWei: bigint): () => void {
  vi.stubEnv('ARC_RPC_URL', 'https://rpc.testnet.arc.network');
  const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
    const { method } = JSON.parse(String((init as { body?: unknown }).body)) as { method: string };
    const result = method === 'eth_getBalance'
      ? `0x${balanceWei.toString(16)}`
      : `0x${'0'.repeat(192)}`;
    return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result })));
  });
  return () => {
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  };
}

describe('trust graduation routes', () => {
  let api: FastifyInstance;
  let store: PostgresTestStore;
  let sessionActorId = 'usr_admin';
  const sessionRole: 'viewer' | 'admin' | 'owner' = 'owner';

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    api = buildApp({
      identity: { pool: store.pool, resolveOperator: () => Promise.resolve({ actorId: sessionActorId, role: sessionRole }) },
      payments: {
        circleProvider: fakeProvider(),
        pool: store.pool,
        resultCrypto: createX402ResultCryptoCodec(randomBytes(32).toString('base64')),
        resolveOperator: () => Promise.resolve({ actorId: sessionActorId, role: sessionRole }),
      },
      policy: { pool: store.pool, resolveOperator: () => Promise.resolve({ actorId: sessionActorId, role: sessionRole }) },
      approvals: { pool: store.pool, resolveOperator: () => Promise.resolve({ actorId: sessionActorId, role: sessionRole }) },
      runtime: { pool: store.pool },
    });
  }, 90_000);

  afterAll(async () => {
    if (api !== undefined) await api.close();
    if (store !== undefined) await store.stop();
    vi.unstubAllEnvs();
  });

  async function setupOrgWithTreasury(label: string): Promise<{ readonly orgId: string; readonly clientAgentId: string; readonly treasuryAddress: string }> {
    const org = await api.inject({
      method: 'POST',
      url: '/v1/orgs',
      payload: { name: `${label} Org`, owner: { email: `${label}@example.test`, name: 'Owner' } },
    });
    expect(org.statusCode, org.body).toBe(201);
    const orgId = org.json<{ org: { id: string } }>().org.id;
    await store.pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);

    const agent = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: `${label} client agent` },
    });
    expect(agent.statusCode, agent.body).toBe(201);
    const clientAgentId = agent.json<{ agent: { id: string } }>().agent.id;

    const walletSetId = `ws_trustroute_${label}`;
    const treasuryAddress = hexAddress('7ea5', label);
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Trust route wallet set', 'usr_owner')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await store.pool.query(
      `INSERT INTO circle_chain_wallets
         (id, org_id, wallet_set_id, mode, chain, circle_blockchain,
          circle_wallet_id, address, account_type, metadata)
       VALUES ($1, $2, $3, 'test', 'arc', 'ARC-TESTNET', $4, $5, 'eoa', '{}'::jsonb)`,
      [`cwallet_trustroute_${label}`, orgId, walletSetId, `circlewallet_trustroute_${label}`, treasuryAddress],
    );

    return { orgId, clientAgentId, treasuryAddress };
  }

  async function seedEscrowJob(input: {
    readonly orgId: string;
    readonly clientAgentId: string;
    readonly providerAddress: string;
    readonly state: EscrowState;
    readonly budgetUsdc: string;
  }): Promise<void> {
    await store.pool.query(
      `INSERT INTO escrow_jobs (
         id, org_id, client_agent_id, provider_address, evaluator_address, mode, chain,
         escrow_address, token_address, budget_usdc, state, escrow_mode, expires_at, created_by
       ) VALUES ($1, $2, $3, $4, $4, 'test', 'arc', $5, $6, $7::numeric, $8, 2, $9, 'usr_1')`,
      [
        `esjob_${randomUUID()}`, input.orgId, input.clientAgentId, input.providerAddress,
        ESCROW_ADDRESS, ARC_USDC, input.budgetUsdc, input.state,
        new Date(Date.now() + 86_400_000),
      ],
    );
  }

  it('GET returns evidence for an external address', async () => {
    const { orgId, clientAgentId } = await setupOrgWithTreasury('getev');
    const provider = hexAddress('9e57', 'getev');
    await seedEscrowJob({ orgId, clientAgentId, providerAddress: provider, state: 'completed', budgetUsdc: '5.00' });

    const response = await api.inject({ method: 'GET', url: `/v1/orgs/${orgId}/payments/trust/arc/${provider}` });
    expect(response.statusCode, response.body).toBe(200);
    const { evidence } = response.json<{
      evidence: { completedCount: number; settledUsdc: string; trusted: boolean; jobs: readonly unknown[] };
    }>();
    expect(evidence.completedCount).toBe(1);
    expect(evidence.settledUsdc).toBe('5.000000');
    expect(evidence.trusted).toBe(false);
    expect(evidence.jobs).toHaveLength(1);
  });

  it('POST trust requires an authenticated user and records them as approver', async () => {
    // approvedBy must come from the SESSION, never the request body -- a
    // client-supplied approver would make the audit trail forgeable.
    const { orgId, clientAgentId } = await setupOrgWithTreasury('promote');
    const provider = hexAddress('9e57', 'promote');
    await seedEscrowJob({ orgId, clientAgentId, providerAddress: provider, state: 'completed', budgetUsdc: '5.00' });
    const unstub = stubArcRpc(100n * 10n ** 18n);
    sessionActorId = 'usr_reviewer_42';

    const response = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/trust/arc/${provider}`,
      payload: {
        label: 'Marketplace agent A',
        ceiling_usdc: '10.00',
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        // A forged approver in the body must be ignored entirely.
        approved_by: 'someone_else',
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const { trust } = response.json<{ trust: { allowlistId: string; delegationId: string } }>();
    expect(trust.allowlistId).toBeDefined();
    expect(trust.delegationId).toBeDefined();

    const row = await store.pool.query<{ approved_by: string }>(
      'SELECT approved_by FROM payment_destination_allowlist WHERE id = $1', [trust.allowlistId],
    );
    expect(row.rows[0]?.approved_by).toBe('usr_reviewer_42');
    expect(row.rows[0]?.approved_by).not.toBe('someone_else');

    sessionActorId = 'usr_admin';
    unstub();
  });

  it('POST trust maps trust_requires_escrow_history to 409, not 500', async () => {
    const { orgId } = await setupOrgWithTreasury('nohist');
    const provider = hexAddress('9e57', 'nohist');

    const response = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/trust/arc/${provider}`,
      payload: {
        label: 'Nobody',
        ceiling_usdc: '10.00',
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<{ error: string }>().error).toBe('trust_requires_escrow_history');
  });

  it('POST revoke returns 409 when the agent is not currently trusted', async () => {
    const { orgId } = await setupOrgWithTreasury('notrusted');
    const provider = hexAddress('9e57', 'notrusted');

    const response = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/trust/arc/${provider}/revoke`,
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<{ error: string }>().error).toBe('agent_not_trusted');
  });

  it('promotes then revokes an external agent end to end through the routes', async () => {
    const { orgId, clientAgentId } = await setupOrgWithTreasury('e2e');
    const provider = hexAddress('9e57', 'e2e');
    await seedEscrowJob({ orgId, clientAgentId, providerAddress: provider, state: 'completed', budgetUsdc: '5.00' });
    const unstub = stubArcRpc(100n * 10n ** 18n);

    const promoted = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/trust/arc/${provider}`,
      payload: {
        label: 'Marketplace agent A',
        ceiling_usdc: '10.00',
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
    });
    expect(promoted.statusCode, promoted.body).toBe(201);

    const evidenceAfterPromote = await api.inject({ method: 'GET', url: `/v1/orgs/${orgId}/payments/trust/arc/${provider}` });
    expect(evidenceAfterPromote.json<{ evidence: { trusted: boolean } }>().evidence.trusted).toBe(true);

    executePermit2Transaction.mockClear();
    const revoked = await api.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/trust/arc/${provider}/revoke`,
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect(revoked.json<{ revoked: boolean }>().revoked).toBe(true);
    // The on-chain permit must actually be revoked, not just the local row.
    expect(executePermit2Transaction).toHaveBeenCalled();

    const evidenceAfterRevoke = await api.inject({ method: 'GET', url: `/v1/orgs/${orgId}/payments/trust/arc/${provider}` });
    const finalEvidence = evidenceAfterRevoke.json<{ evidence: { trusted: boolean; completedCount: number } }>().evidence;
    expect(finalEvidence.trusted).toBe(false);
    // History survives revocation -- it is evidence, not a grant.
    expect(finalEvidence.completedCount).toBe(1);

    unstub();
  });

  it('rejects a malformed address rather than passing it to an RPC', async () => {
    const { orgId } = await setupOrgWithTreasury('badaddr');
    const response = await api.inject({ method: 'GET', url: `/v1/orgs/${orgId}/payments/trust/arc/not-an-address` });
    expect(response.statusCode).toBe(400);
  });
});
