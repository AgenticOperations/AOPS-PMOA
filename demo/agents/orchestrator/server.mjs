// Orchestrator: hires the specialists and assembles the final report.
// Holds wallets on BOTH Arc and Base -- pre-funded per chain (Option A
// from the plan). Never claim a Gateway/Arc balance can pay a Base
// seller; the Orchestrator reaches SeniorReviewer only because it holds
// its own, separately funded Base wallet.
//
// Like Analyst, the Orchestrator is a payer: it calls the real agentOps
// runtime API's intra-fleet payment route over plain HTTP with its own
// connection bearer token for every hire, never reaching into the
// payments engine's internals.
import Fastify from 'fastify';

async function payAgent(options) {
  const response = await fetch(`${options.apiBaseUrl}/v1/runtime/payments/intra-fleet`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.connectionToken}`,
    },
    body: JSON.stringify({
      payee_agent_id: options.payeeAgentId,
      chain: options.chain,
      url: options.url,
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`intra_fleet_payment_failed:${options.chain}:${response.status}:${errorBody}`);
  }
  const body = await response.json();
  return body.payment;
}

/**
 * Runs the full fleet scenario: hires DataFetcher (Arc), Analyst (Arc,
 * which itself pays DataFetcher mid-task -- the second hop), Writer
 * (Arc), and SeniorReviewer (Base -- the cross-chain hop), then
 * assembles a final report referencing every real payment made.
 */
export async function runFleetScenario(options) {
  const dataFetcherPayment = await payAgent({
    apiBaseUrl: options.apiBaseUrl,
    connectionToken: options.connectionToken,
    payeeAgentId: options.dataFetcherAgentId,
    chain: 'arc',
    url: options.dataFetcherUrl,
  });

  const analystPayment = await payAgent({
    apiBaseUrl: options.apiBaseUrl,
    connectionToken: options.connectionToken,
    payeeAgentId: options.analystAgentId,
    chain: 'arc',
    url: options.analystUrl,
  });

  const writerPayment = await payAgent({
    apiBaseUrl: options.apiBaseUrl,
    connectionToken: options.connectionToken,
    payeeAgentId: options.writerAgentId,
    chain: 'arc',
    url: options.writerUrl,
  });

  // The cross-chain hop: settled on Base while the rest of the fleet
  // runs on Arc. Funded from the Orchestrator's OWN Base wallet, never
  // from its Arc balance.
  const seniorReviewerPayment = await payAgent({
    apiBaseUrl: options.apiBaseUrl,
    connectionToken: options.connectionToken,
    payeeAgentId: options.seniorReviewerAgentId,
    chain: 'base',
    url: options.seniorReviewerUrl,
  });

  return {
    completed: true,
    report: {
      data: dataFetcherPayment.body?.data,
      analysis: analystPayment.body?.data,
      writeup: writerPayment.body?.data,
      review: seniorReviewerPayment.body?.data,
    },
    payments: {
      dataFetcher: { chain: 'arc', txHash: dataFetcherPayment.txHash },
      analyst: { chain: 'arc', txHash: analystPayment.txHash },
      writer: { chain: 'arc', txHash: writerPayment.txHash },
      seniorReviewer: { chain: 'base', txHash: seniorReviewerPayment.txHash },
    },
  };
}

export function createOrchestratorAgent(options) {
  const app = Fastify({ logger: false });

  app.post('/run', async (_request, reply) => {
    try {
      const result = await runFleetScenario(options);
      return reply.code(200).send(result);
    } catch (error) {
      return reply.code(502).send({ completed: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  return app;
}

async function main() {
  const port = Number(process.env.ORCHESTRATOR_PORT ?? '4000');
  const options = {
    apiBaseUrl: process.env.AGENTOPS_API_BASE_URL,
    connectionToken: process.env.ORCHESTRATOR_CONNECTION_TOKEN,
    dataFetcherAgentId: process.env.DATA_FETCHER_AGENT_ID,
    dataFetcherUrl: process.env.DATA_FETCHER_URL,
    analystAgentId: process.env.ANALYST_AGENT_ID,
    analystUrl: process.env.ANALYST_URL,
    writerAgentId: process.env.WRITER_AGENT_ID,
    writerUrl: process.env.WRITER_URL,
    seniorReviewerAgentId: process.env.SENIOR_REVIEWER_AGENT_ID,
    seniorReviewerUrl: process.env.SENIOR_REVIEWER_URL,
  };
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) throw new Error(`orchestrator_env_missing:${key}`);
  }

  const app = createOrchestratorAgent(options);
  const address = await app.listen({ host: '127.0.0.1', port });
  console.log(`Orchestrator listening at ${address}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
