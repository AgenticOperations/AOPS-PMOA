import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { createX402ResultCryptoCodec } from '../../src/engines/payments/x402-result-crypto.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type AnalystModule = {
  readonly createAnalystAgent: (options: {
    readonly walletAddress: string;
    readonly rpcUrl: string;
    readonly apiBaseUrl: string;
    readonly connectionToken: string;
    readonly dataFetcherAgentId: string;
    readonly dataFetcherUrl: string;
  }) => FastifyInstance;
};
type DataFetcherModule = {
  readonly createDataFetcherAgent: (options: { readonly walletAddress: string; readonly rpcUrl: string }) => FastifyInstance;
};

function fakeProvider(): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: () => Promise.resolve({ circleWalletSetId: 'wallet_set_analyst_test' }),
    executePermit2Transaction: vi.fn(() => Promise.resolve({ txHash: '0x3c3c7e17f8ff66df38d78fde5f9af7f342f0f7f6e6d4e48f9eaf7dad0f36e8b4' })),
    getGatewayBalance: vi.fn(),
    getWalletBalances: vi.fn(),
    health: () => ({ configured: true, missing: [], mode: 'test', provider: 'circle' }),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation: vi.fn(() => Promise.resolve({ signature: '0xsig' })),
    transferWallet: vi.fn(),
    transferNativeGas: vi.fn(),
  };
}

describe('Analyst demo agent, the second-hop payment', () => {
  let store: PostgresTestStore;
  let api: FastifyInstance;
  let apiBaseUrl: string;
  let dataFetcher: FastifyInstance;
  let dataFetcherUrl: string;
  let dataFetcherWalletAddress: string;
  let analyst: FastifyInstance;
  let analystUrl: string;
  let analystWalletAddress: string;
  const realFetch = global.fetch;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    vi.stubEnv('ARC_RPC_URL', 'https://rpc.testnet.arc.network');
    store = await startPostgres();

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

    // DataFetcher: the agent Analyst buys data from mid-task.
    dataFetcherWalletAddress = '0xdada00000000000000000000000000000000da7d';
    // @ts-expect-error -- no declaration file for a plain .mjs outside this project.
    const dataFetcherModule = await import('../../../../demo/agents/data-fetcher/server.mjs') as DataFetcherModule;
    dataFetcher = dataFetcherModule.createDataFetcherAgent({
      walletAddress: dataFetcherWalletAddress, rpcUrl: 'https://rpc.testnet.arc.network',
    });
    const dataFetcherAddress = await dataFetcher.listen({ host: '127.0.0.1', port: 0 });
    dataFetcherUrl = `${dataFetcherAddress}/data?q=market-signal`;

    // The real agentOps API, listening on a real port -- the Analyst
    // process calls it over plain HTTP, exactly like a real integration.
    api = buildApp({
      identity: { pool: store.pool, resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }) },
      payments: {
        circleProvider: fakeProvider(),
        pool: store.pool,
        resultCrypto: createX402ResultCryptoCodec(randomBytes(32).toString('base64')),
        resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }),
      },
      policy: { pool: store.pool, resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }) },
      approvals: { pool: store.pool, resolveOperator: () => Promise.resolve({ actorId: 'usr_owner', role: 'owner' }) },
      runtime: { pool: store.pool },
    });
    apiBaseUrl = await api.listen({ host: '127.0.0.1', port: 0 });

    // Bootstrap org/agents/connection through the real HTTP API, exactly
    // as demo/reset.mjs (Task 7) will for the full scenario.
    const org = await realFetch(`${apiBaseUrl}/v1/orgs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Demo Analyst Org', owner: { email: 'analyst-demo@example.test', name: 'Owner' } }),
    });
    expect(org.status, await org.clone().text()).toBe(201);
    const orgId = (await org.json() as { org: { id: string } }).org.id;
    await store.pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);

    const analystAgent = await realFetch(`${apiBaseUrl}/v1/orgs/${orgId}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Analyst' }),
    });
    expect(analystAgent.status, await analystAgent.clone().text()).toBe(201);
    const analystAgentId = (await analystAgent.json() as { agent: { id: string } }).agent.id;

    const dataFetcherAgent = await realFetch(`${apiBaseUrl}/v1/orgs/${orgId}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'DataFetcher' }),
    });
    expect(dataFetcherAgent.status).toBe(201);
    const dataFetcherAgentId = (await dataFetcherAgent.json() as { agent: { id: string } }).agent.id;

    const connection = await realFetch(`${apiBaseUrl}/v1/orgs/${orgId}/agents/${analystAgentId}/connections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'agent_credential', name: 'Runtime' }),
    });
    expect(connection.status).toBe(201);
    const analystConnectionToken = (await connection.json() as { secret: string }).secret;

    const walletSetId = 'ws_demo_analyst';
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Demo wallet set', 'usr_owner')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    analystWalletAddress = '0xdada00000000000000000000000000000000da7e';
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: analystAgentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_demo_analyst', address: analystWalletAddress,
      refId: 'ref_demo_analyst', walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: dataFetcherAgentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_demo_analyst_data_fetcher', address: dataFetcherWalletAddress,
      refId: 'ref_demo_analyst_data_fetcher', walletSetId, circleBlockchain: 'ARC-TESTNET',
    });

    // @ts-expect-error -- no declaration file for a plain .mjs outside this project.
    const analystModule = await import('../../../../demo/agents/analyst/server.mjs') as AnalystModule;
    analyst = analystModule.createAnalystAgent({
      walletAddress: analystWalletAddress,
      rpcUrl: 'https://rpc.testnet.arc.network',
      apiBaseUrl,
      connectionToken: analystConnectionToken,
      dataFetcherAgentId,
      dataFetcherUrl,
    });
    const analystAddress = await analyst.listen({ host: '127.0.0.1', port: 0 });
    analystUrl = `${analystAddress}/analysis?q=quarterly-outlook`;
  }, 90_000);

  afterAll(async () => {
    if (analyst !== undefined) await analyst.close();
    if (dataFetcher !== undefined) await dataFetcher.close();
    if (api !== undefined) await api.close();
    if (store !== undefined) await store.stop();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns 402 naming its own wallet before any payment', async () => {
    const unpaid = await realFetch(analystUrl);
    expect(unpaid.status).toBe(402);
    const requirements = await unpaid.json() as { accepts: { payTo: string }[] };
    expect(requirements.accepts[0]?.payTo).toBe(analystWalletAddress);
  });

  it('pays DataFetcher mid-task (the second-hop payment) before answering its own paid request', async () => {
    const paid = await realFetch(analystUrl, {
      headers: { 'x-payment': '0x4d4d8f28f9ff77e049e89afe6f0af8f453f1f8f7f7e5e59faebf8ebe1f47f9c5' },
    });
    expect(paid.status).toBe(200);
    const body = await paid.json() as { data: { analysis: string; sourcedFrom: { agent: string; txHash: string } } };
    expect(body.data.analysis).toContain('real-data-payload');
    expect(body.data.sourcedFrom.agent).toBe('DataFetcher');
    expect(typeof body.data.sourcedFrom.txHash).toBe('string');
  });
});
