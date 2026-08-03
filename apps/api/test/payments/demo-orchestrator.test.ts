import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { createX402ResultCryptoCodec } from '../../src/engines/payments/x402-result-crypto.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type OrchestratorModule = {
  readonly createOrchestratorAgent: (options: Record<string, string>) => FastifyInstance;
};
type DataFetcherModule = {
  readonly createDataFetcherAgent: (options: { readonly walletAddress: string; readonly rpcUrl: string }) => FastifyInstance;
};
type WriterModule = {
  readonly createWriterAgent: (options: { readonly walletAddress: string; readonly rpcUrl: string }) => FastifyInstance;
};
type SeniorReviewerModule = {
  readonly createSeniorReviewerAgent: (options: { readonly walletAddress: string; readonly rpcUrl: string }) => FastifyInstance;
};

const ARC_RPC = 'https://rpc.testnet.arc.network';
const BASE_RPC = 'https://sepolia.base.org';

function fakeProvider(): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: () => Promise.resolve({ circleWalletSetId: 'wallet_set_orchestrator_test' }),
    executePermit2Transaction: vi.fn(() => Promise.resolve({ txHash: '0x5e5e9f39faff88f05a9a0a1f1f9c14a56475b2b8b9d6f60faaebf9fdf359e0d6' })),
    getGatewayBalance: vi.fn(),
    getWalletBalances: vi.fn(),
    health: () => ({ configured: true, missing: [], mode: 'test', provider: 'circle' }),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation: vi.fn(() => Promise.resolve({ signature: '0xsig' })),
    transferWallet: vi.fn(),
  };
}

describe('Orchestrator demo agent: full fleet scenario, hub -> spoke, second-hop, cross-chain', () => {
  let store: PostgresTestStore;
  let api: FastifyInstance;
  let apiBaseUrl: string;
  let dataFetcher: FastifyInstance;
  let dataFetcherUrl: string;
  let writer: FastifyInstance;
  let writerUrl: string;
  let seniorReviewer: FastifyInstance;
  let seniorReviewerUrl: string;
  let orchestrator: FastifyInstance;
  let orchestratorUrl: string;
  const realFetch = global.fetch;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    vi.stubEnv('ARC_RPC_URL', ARC_RPC);
    vi.stubEnv('BASE_SEPOLIA_RPC_URL', BASE_RPC);
    store = await startPostgres();

    vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
      const isArcRpc = typeof url === 'string' && url.includes('rpc.testnet.arc.network');
      const isBaseRpc = typeof url === 'string' && url.includes('sepolia.base.org');
      if (isArcRpc || isBaseRpc) {
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

    // Real agentOps API on a real port.
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

    async function createOrg(name: string) {
      const org = await realFetch(`${apiBaseUrl}/v1/orgs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, owner: { email: `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}@example.test`, name: 'Owner' } }),
      });
      expect(org.status, await org.clone().text()).toBe(201);
      const orgId = (await org.json() as { org: { id: string } }).org.id;
      await store.pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);
      return orgId;
    }

    async function createAgent(orgId: string, name: string) {
      const agent = await realFetch(`${apiBaseUrl}/v1/orgs/${orgId}/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      expect(agent.status, await agent.clone().text()).toBe(201);
      return (await agent.json() as { agent: { id: string } }).agent.id;
    }

    async function createConnection(orgId: string, agentId: string) {
      const connection = await realFetch(`${apiBaseUrl}/v1/orgs/${orgId}/agents/${agentId}/connections`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'agent_credential', name: 'Runtime' }),
      });
      expect(connection.status, await connection.clone().text()).toBe(201);
      return (await connection.json() as { secret: string }).secret;
    }

    const orgId = await createOrg('Demo Orchestrator Org');
    const orchestratorAgentId = await createAgent(orgId, 'Orchestrator');
    const dataFetcherAgentId = await createAgent(orgId, 'DataFetcher');
    const writerAgentId = await createAgent(orgId, 'Writer');
    const seniorReviewerAgentId = await createAgent(orgId, 'SeniorReviewer');
    const orchestratorConnectionToken = await createConnection(orgId, orchestratorAgentId);

    const walletSetId = 'ws_demo_orchestrator';
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Demo wallet set', 'usr_owner')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );

    // Orchestrator gets wallets on BOTH Arc and Base -- pre-funded per
    // chain (Option A), never a shared Gateway balance across chains.
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: orchestratorAgentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_orchestrator_arc', address: '0xdada00000000000000000000000000000000fe01',
      refId: 'ref_orchestrator_arc', walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: orchestratorAgentId, mode: 'test', chain: 'base',
      circleWalletId: 'w_orchestrator_base', address: '0xdada00000000000000000000000000000000fe02',
      refId: 'ref_orchestrator_base', walletSetId, circleBlockchain: 'BASE-SEPOLIA',
    });

    const dataFetcherWalletAddress = '0xdada00000000000000000000000000000000fe03';
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: dataFetcherAgentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_orchestrator_data_fetcher', address: dataFetcherWalletAddress,
      refId: 'ref_orchestrator_data_fetcher', walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    const writerWalletAddress = '0xdada00000000000000000000000000000000fe04';
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: writerAgentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_orchestrator_writer', address: writerWalletAddress,
      refId: 'ref_orchestrator_writer', walletSetId, circleBlockchain: 'ARC-TESTNET',
    });
    const seniorReviewerWalletAddress = '0xdada00000000000000000000000000000000fe05';
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: seniorReviewerAgentId, mode: 'test', chain: 'base',
      circleWalletId: 'w_orchestrator_senior_reviewer', address: seniorReviewerWalletAddress,
      refId: 'ref_orchestrator_senior_reviewer', walletSetId, circleBlockchain: 'BASE-SEPOLIA',
    });

    // Real specialist agent servers.
    // @ts-expect-error -- no declaration file for a plain .mjs outside this project.
    const dataFetcherModule = await import('../../../../demo/agents/data-fetcher/server.mjs') as DataFetcherModule;
    dataFetcher = dataFetcherModule.createDataFetcherAgent({ walletAddress: dataFetcherWalletAddress, rpcUrl: ARC_RPC });
    dataFetcherUrl = `${await dataFetcher.listen({ host: '127.0.0.1', port: 0 })}/data?q=orchestrator-run`;

    // @ts-expect-error -- no declaration file for a plain .mjs outside this project.
    const writerModule = await import('../../../../demo/agents/writer/server.mjs') as WriterModule;
    writer = writerModule.createWriterAgent({ walletAddress: writerWalletAddress, rpcUrl: ARC_RPC });
    writerUrl = `${await writer.listen({ host: '127.0.0.1', port: 0 })}/report?topic=fleet-run`;

    // @ts-expect-error -- no declaration file for a plain .mjs outside this project.
    const seniorReviewerModule = await import('../../../../demo/agents/senior-reviewer/server.mjs') as SeniorReviewerModule;
    seniorReviewer = seniorReviewerModule.createSeniorReviewerAgent({ walletAddress: seniorReviewerWalletAddress, rpcUrl: BASE_RPC });
    seniorReviewerUrl = `${await seniorReviewer.listen({ host: '127.0.0.1', port: 0 })}/review?title=fleet-run`;

    // Orchestrator hires DataFetcher/Writer/SeniorReviewer directly, and
    // reuses DataFetcher as a stand-in "Analyst" leg here too -- this
    // test's purpose is proving the Orchestrator's own multi-payee,
    // multi-chain fan-out (hub->spoke and cross-chain); the Analyst's
    // OWN second-hop payment is already proven in demo-analyst.test.ts.
    // @ts-expect-error -- no declaration file for a plain .mjs outside this project.
    const orchestratorModule = await import('../../../../demo/agents/orchestrator/server.mjs') as OrchestratorModule;
    orchestrator = orchestratorModule.createOrchestratorAgent({
      apiBaseUrl,
      connectionToken: orchestratorConnectionToken,
      dataFetcherAgentId,
      dataFetcherUrl,
      analystAgentId: dataFetcherAgentId,
      analystUrl: dataFetcherUrl,
      writerAgentId,
      writerUrl,
      seniorReviewerAgentId,
      seniorReviewerUrl,
    });
    orchestratorUrl = `${await orchestrator.listen({ host: '127.0.0.1', port: 0 })}/run`;
  }, 90_000);

  afterAll(async () => {
    if (orchestrator !== undefined) await orchestrator.close();
    if (seniorReviewer !== undefined) await seniorReviewer.close();
    if (writer !== undefined) await writer.close();
    if (dataFetcher !== undefined) await dataFetcher.close();
    if (api !== undefined) await api.close();
    if (store !== undefined) await store.stop();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('runs the full scenario: pays every specialist, including the Base cross-chain hop, with no human', async () => {
    const response = await realFetch(orchestratorUrl, { method: 'POST' });
    expect(response.status, await response.clone().text()).toBe(200);
    const result = await response.json() as {
      completed: boolean;
      payments: Record<string, { chain: string; txHash: string }>;
    };

    expect(result.completed).toBe(true);
    expect(result.payments.dataFetcher?.chain).toBe('arc');
    expect(result.payments.writer?.chain).toBe('arc');
    expect(result.payments.seniorReviewer?.chain).toBe('base');
    expect(typeof result.payments.seniorReviewer?.txHash).toBe('string');
  });
});
