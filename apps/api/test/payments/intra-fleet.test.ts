import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import { payIntraFleet } from '../../src/engines/payments/intra-fleet.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

function fakeProvider(overrides: Partial<CircleTreasuryProvider> = {}): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: vi.fn(),
    executePermit2Transaction: vi.fn(() => Promise.resolve({ txHash: '0xdrawdowntx' })),
    getGatewayBalance: vi.fn(),
    getWalletBalances: vi.fn(),
    health: vi.fn(),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation: vi.fn(() => Promise.resolve({ signature: '0xsig' })),
    transferWallet: vi.fn(),
    ...overrides,
  };
}

describe('payIntraFleet', () => {
  let store: PostgresTestStore;
  let merchant: FastifyInstance;
  let merchantUrl: string;
  let paidCalls = 0;
  const realFetch = global.fetch;

  beforeAll(async () => {
    vi.stubEnv('ARC_RPC_URL', 'https://rpc.testnet.arc.network');
    // Only the Permit2 nonce read (a POST to ARC_RPC_URL) is stubbed;
    // everything to the local merchant fixture passes through untouched --
    // this test genuinely exercises the real HTTP discovery/payment
    // round trip against a real server, only the on-chain RPC read is
    // faked (the provider itself is already fully faked).
    vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
      if (typeof url === 'string' && url.includes('rpc.testnet.arc.network')) {
        return Promise.resolve(new Response(JSON.stringify({
          jsonrpc: '2.0', id: 1,
          result: `0x${'0'.repeat(64)}${'0'.repeat(64)}${'0'.repeat(64)}`,
        })));
      }
      return realFetch(url, init);
    });
    store = await startPostgres();

    merchant = Fastify({ logger: false });
    merchant.get('/data', async (request, reply) => {
      if (request.headers['x-payment'] !== undefined) {
        paidCalls += 1;
        return reply.code(200).send({ delivered: true });
      }
      const resourceUrl = new URL(request.url, merchantUrl).href;
      return reply.code(402).send({
        x402Version: 2,
        resource: { url: resourceUrl, category: 'market-data', description: 'Test data', mimeType: 'application/json' },
        accepts: [{
          scheme: 'exact',
          network: 'eip155:5042002',
          asset: '0x3600000000000000000000000000000000000000',
          amount: '10000',
          payTo: '0xaaaa111111111111111111111111111111111111',
          maxTimeoutSeconds: 60,
          extra: { name: 'USDC', version: '2' },
        }],
      });
    });
    const address = await merchant.listen({ host: '127.0.0.1', port: 0 });
    merchantUrl = `${address}/data`;
  }, 90_000);

  afterAll(async () => {
    if (merchant !== undefined) await merchant.close();
    if (store !== undefined) await store.stop();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function setupFleet(suffix: string) {
    const orgId = `org_intrafleet_${suffix}`;
    const teamId = `team_intrafleet_${suffix}`;
    const payerAgentId = `agt_intrafleet_payer_${suffix}`;
    const payeeAgentId = `agt_intrafleet_payee_${suffix}`;
    const walletSetId = `ws_intrafleet_${suffix}`;

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Intra Fleet Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      payerAgentId, orgId, teamId, 'Payer',
    ]);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      payeeAgentId, orgId, teamId, 'Payee',
    ]);
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Intra fleet wallet set', 'usr_1')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    const payerAddressHex = suffix.split('').map((c) => c.charCodeAt(0).toString(16)).join('');
    const payerAddress = `0x${payerAddressHex.padEnd(40, '0').slice(0, 40)}`;
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: payerAgentId, mode: 'test', chain: 'arc',
      circleWalletId: `w_payer_${suffix}`, address: payerAddress,
      refId: `ref_payer_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: payeeAgentId, mode: 'test', chain: 'arc',
      circleWalletId: `w_payee_${suffix}`, address: '0xaaaa111111111111111111111111111111111111',
      refId: `ref_payee_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
    });

    return { orgId, payerAgentId, payeeAgentId, pool: store.pool };
  }

  it('pays a fleet agent via a real drawdown and receives the paid resource', async () => {
    const { orgId, payerAgentId, payeeAgentId, pool } = await setupFleet('happy');
    const provider = fakeProvider();

    const result = await payIntraFleet(pool, provider, {
      orgId,
      payerAgentId,
      payeeAgentId,
      mode: 'test',
      chain: 'arc',
      url: merchantUrl,
      approvedBy: 'usr_operator',
    });

    expect(result.status).toBe(200);
    expect(result.txHash).toBe('0xdrawdowntx');
    expect(paidCalls).toBeGreaterThan(0);
  });

  it('reuses an existing active delegation with enough headroom instead of signing a new one', async () => {
    const { orgId, payerAgentId, payeeAgentId, pool } = await setupFleet('reuse');
    const signPermit2Delegation = vi.fn(() => Promise.resolve({ signature: '0xsig' }));
    const provider = fakeProvider({ signPermit2Delegation });

    await payIntraFleet(pool, provider, {
      orgId, payerAgentId, payeeAgentId, mode: 'test', chain: 'arc', url: merchantUrl, approvedBy: 'usr_operator',
    });
    await payIntraFleet(pool, provider, {
      orgId, payerAgentId, payeeAgentId, mode: 'test', chain: 'arc', url: merchantUrl, approvedBy: 'usr_operator',
    });

    // Only one delegation should have been signed across two payments.
    expect(signPermit2Delegation).toHaveBeenCalledTimes(1);
    const delegations = await pool.query(
      'SELECT count(*) FROM agent_delegations WHERE org_id = $1', [orgId],
    );
    expect(Number((delegations.rows[0] as { count: string }).count)).toBe(1);
  });

  it('auto-allowlists the payee address for the payTo guard', async () => {
    const { orgId, payerAgentId, payeeAgentId, pool } = await setupFleet('allowlist');
    await payIntraFleet(pool, fakeProvider(), {
      orgId, payerAgentId, payeeAgentId, mode: 'test', chain: 'arc', url: merchantUrl, approvedBy: 'usr_operator',
    });

    const listed = await pool.query(
      "SELECT 1 FROM payment_destination_allowlist WHERE org_id = $1 AND source = 'agent_wallet'", [orgId],
    );
    expect(listed.rowCount).toBe(1);
  });
});
