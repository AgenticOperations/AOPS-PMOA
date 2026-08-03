import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import { payIntraFleet } from '../../src/engines/payments/intra-fleet.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type DataFetcherModule = {
  readonly createDataFetcherAgent: (options: { readonly walletAddress: string; readonly rpcUrl: string }) => FastifyInstance;
};

function fakeProvider(overrides: Partial<CircleTreasuryProvider> = {}): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: vi.fn(),
    executePermit2Transaction: vi.fn(() => Promise.resolve({ txHash: '0xd7d76f14a4a9be7add85e0a44f43126ac0c22e2c2f3d0b2a9c66fefa30b9b012' })),
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

describe('DataFetcher demo agent, end to end', () => {
  let store: PostgresTestStore;
  let agent: FastifyInstance;
  let agentUrl: string;
  let walletAddress: string;
  const realFetch = global.fetch;

  beforeAll(async () => {
    vi.stubEnv('ARC_RPC_URL', 'https://rpc.testnet.arc.network');
    store = await startPostgres();

    walletAddress = '0xdada00000000000000000000000000000000da7a';
    // demo/ is deliberately outside apps/api's TS project (plain .mjs,
    // no build step) -- it's a consumer of the API, not part of it.
    // @ts-expect-error -- no declaration file for a plain .mjs outside this project.
    const dataFetcherModule = await import('../../../../demo/agents/data-fetcher/server.mjs') as DataFetcherModule;
    const { createDataFetcherAgent } = dataFetcherModule;
    agent = createDataFetcherAgent({ walletAddress, rpcUrl: 'https://rpc.testnet.arc.network' });
    const address = await agent.listen({ host: '127.0.0.1', port: 0 });
    agentUrl = `${address}/data?q=test`;

    // Stub only calls to the Arc RPC (both the Permit2 nonce read AND this
    // demo agent's own tx-receipt verification hit the same URL) --
    // everything to the real local agent server passes through untouched.
    vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
      if (typeof url === 'string' && url.includes('rpc.testnet.arc.network')) {
        const requestBody = JSON.parse((init?.body as string) ?? '{}') as { method?: string };
        if (requestBody.method === 'eth_getTransactionReceipt') {
          return Promise.resolve(new Response(JSON.stringify({
            jsonrpc: '2.0', id: 1, result: { status: '0x1' },
          })));
        }
        return Promise.resolve(new Response(JSON.stringify({
          jsonrpc: '2.0', id: 1,
          result: `0x${'0'.repeat(64)}${'0'.repeat(64)}${'0'.repeat(64)}`,
        })));
      }
      return realFetch(url, init);
    });
  }, 90_000);

  afterAll(async () => {
    if (agent !== undefined) await agent.close();
    if (store !== undefined) await store.stop();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns 402 with payment requirements naming its own wallet', async () => {
    const unpaid = await realFetch(agentUrl);
    expect(unpaid.status).toBe(402);
    const requirements = await unpaid.json() as { accepts: { payTo: string; network: string }[] };
    expect(requirements.accepts[0]?.payTo).toBe(walletAddress);
    expect(requirements.accepts[0]?.network).toBe('eip155:5042002');
  });

  it('pays the agent via a real payIntraFleet drawdown and receives the served data', async () => {
    const orgId = 'org_demo_data_fetcher';
    const teamId = 'team_demo_data_fetcher';
    const payerAgentId = 'agt_demo_payer';
    const payeeAgentId = 'agt_demo_data_fetcher';
    const walletSetId = 'ws_demo_data_fetcher';

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Demo DataFetcher Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [payerAgentId, orgId, teamId, 'Payer']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [payeeAgentId, orgId, teamId, 'DataFetcher']);
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Demo wallet set', 'usr_1')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: payerAgentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_demo_payer', address: '0xdada00000000000000000000000000000000fea1',
      refId: 'ref_demo_payer', walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: payeeAgentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_demo_data_fetcher', address: walletAddress,
      refId: 'ref_demo_data_fetcher', walletSetId, circleBlockchain: 'ARC-TESTNET',
    });

    const result = await payIntraFleet(store.pool, fakeProvider(), {
      orgId,
      payerAgentId,
      payeeAgentId,
      mode: 'test',
      chain: 'arc',
      url: agentUrl,
      approvedBy: 'usr_operator',
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ data: { query: 'test', value: 'real-data-payload' } });
  });
});
