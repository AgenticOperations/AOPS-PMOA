// demo/run.mjs -- starts all five real agent servers in-process against
// the state resetDemo() produced, then triggers the Orchestrator's real
// scenario: hub->spoke fan-out (DataFetcher, Writer), the second-hop
// payment (Analyst -> DataFetcher, proven independently in
// apps/api/test/payments/demo-analyst.test.ts), and the cross-chain hop
// (Orchestrator -> Base SeniorReviewer). No human in the loop after this
// starts.
//
// Prerequisites: same as demo/reset.mjs -- dev:api + dev:circle-worker
// running with CIRCLE_TREASURY_PROVIDER=developer_controlled, real
// Circle credentials, ARC_RPC_URL / BASE_SEPOLIA_RPC_URL set.
import { resetDemo } from './reset.mjs';
import { createDataFetcherAgent } from './agents/data-fetcher/server.mjs';
import { createWriterAgent } from './agents/writer/server.mjs';
import { createSeniorReviewerAgent } from './agents/senior-reviewer/server.mjs';
import { createAnalystAgent } from './agents/analyst/server.mjs';
import { createOrchestratorAgent } from './agents/orchestrator/server.mjs';

const AGENTOPS_API_BASE_URL = (process.env.AGENTOPS_API_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const ARC_RPC_URL = process.env.ARC_RPC_URL;
if (ARC_RPC_URL === undefined) throw new Error('ARC_RPC_URL is required');
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org';

function log(message) {
  console.log(`[demo/run] ${message}`);
}

/**
 * Runs the full fleet scenario once, end to end, against a freshly reset
 * demo state: starts all five real agent HTTP servers in-process, wires
 * them together with the real addresses/tokens resetDemo() produced,
 * triggers the Orchestrator, and shuts every server down afterward
 * regardless of outcome.
 */
export async function runFullScenario() {
  const state = await resetDemo();
  log(`reset complete: org ${state.orgId}`);

  const servers = [];
  try {
    const dataFetcher = createDataFetcherAgent({ walletAddress: state.wallets.DataFetcher.arc, rpcUrl: ARC_RPC_URL });
    const dataFetcherAddress = await dataFetcher.listen({ host: '127.0.0.1', port: 0 });
    servers.push(dataFetcher);
    const dataFetcherUrl = `${dataFetcherAddress}/data?q=fleet-run`;
    log(`DataFetcher up at ${dataFetcherAddress}`);

    const writer = createWriterAgent({ walletAddress: state.wallets.Writer.arc, rpcUrl: ARC_RPC_URL });
    const writerAddress = await writer.listen({ host: '127.0.0.1', port: 0 });
    servers.push(writer);
    const writerUrl = `${writerAddress}/report?topic=fleet-run`;
    log(`Writer up at ${writerAddress}`);

    const seniorReviewer = createSeniorReviewerAgent({ walletAddress: state.wallets.SeniorReviewer.base, rpcUrl: BASE_SEPOLIA_RPC_URL });
    const seniorReviewerAddress = await seniorReviewer.listen({ host: '127.0.0.1', port: 0 });
    servers.push(seniorReviewer);
    const seniorReviewerUrl = `${seniorReviewerAddress}/review?title=fleet-run`;
    log(`SeniorReviewer up at ${seniorReviewerAddress} (Base Sepolia)`);

    const analyst = createAnalystAgent({
      walletAddress: state.wallets.Analyst.arc,
      rpcUrl: ARC_RPC_URL,
      apiBaseUrl: AGENTOPS_API_BASE_URL,
      connectionToken: state.connectionTokens.Analyst,
      dataFetcherAgentId: state.agentIds.DataFetcher,
      dataFetcherUrl,
    });
    const analystAddress = await analyst.listen({ host: '127.0.0.1', port: 0 });
    servers.push(analyst);
    const analystUrl = `${analystAddress}/analysis?q=fleet-run`;
    log(`Analyst up at ${analystAddress} (pays DataFetcher mid-task)`);

    const orchestrator = createOrchestratorAgent({
      apiBaseUrl: AGENTOPS_API_BASE_URL,
      connectionToken: state.connectionTokens.Orchestrator,
      dataFetcherAgentId: state.agentIds.DataFetcher,
      dataFetcherUrl,
      analystAgentId: state.agentIds.Analyst,
      analystUrl,
      writerAgentId: state.agentIds.Writer,
      writerUrl,
      seniorReviewerAgentId: state.agentIds.SeniorReviewer,
      seniorReviewerUrl,
    });
    const orchestratorAddress = await orchestrator.listen({ host: '127.0.0.1', port: 0 });
    servers.push(orchestrator);
    log(`Orchestrator up at ${orchestratorAddress}`);

    log('triggering full scenario: hub->spoke, second-hop, cross-chain...');
    const response = await fetch(`${orchestratorAddress}/run`, { method: 'POST' });
    const result = await response.json();
    if (response.status !== 200 || result.completed !== true) {
      throw new Error(`scenario_failed:${response.status}:${JSON.stringify(result)}`);
    }

    log(`DataFetcher payment: ${result.payments.dataFetcher.chain} tx ${result.payments.dataFetcher.txHash}`);
    log(`Analyst payment (covers its own second-hop to DataFetcher): ${result.payments.analyst.chain} tx ${result.payments.analyst.txHash}`);
    log(`Writer payment: ${result.payments.writer.chain} tx ${result.payments.writer.txHash}`);
    log(`SeniorReviewer payment (cross-chain, Base): ${result.payments.seniorReviewer.chain} tx ${result.payments.seniorReviewer.txHash}`);
    log('scenario complete');

    return { completed: true, orgId: state.orgId, result };
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFullScenario()
    .then((outcome) => {
      console.log(JSON.stringify(outcome, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
