// Analyst: sells analysis, but pays DataFetcher mid-task to get the raw
// data it analyzes. This is the critical second-hop payment -- it proves
// the fleet is a real economy (agents paying agents while doing real
// work), not just a hub fanning payments out to leaf agents.
//
// Unlike DataFetcher/Writer/SeniorReviewer (pure earners with no
// payments-engine dependency), the Analyst is itself a payer: it calls
// the real agentOps runtime API's intra-fleet payment route with its
// own connection bearer token, exactly as a real agent integration
// would -- it never reaches into the payments engine's internals.
import Fastify from 'fastify';

const ARC_CHAIN_ID = process.env.ARC_CHAIN_ID ?? '5042002';
const ARC_USDC_ADDRESS = process.env.ARC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000';
const PRICE_MICROS = process.env.ANALYST_PRICE_MICROS ?? '50000'; // 0.05 USDC

async function verifyPayment(txHash, rpcUrl) {
  if (typeof txHash !== 'string' || !txHash.startsWith('0x') || txHash.length !== 66) return false;
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }),
  });
  const body = await response.json();
  if (body.error !== undefined || body.result === null || body.result === undefined) return false;
  return body.result.status === '0x1';
}

/**
 * Buys the underlying data from DataFetcher via the real agentOps
 * runtime intra-fleet payment route, using the Analyst's own connection
 * bearer token -- the same route a real agent integration would call.
 */
async function buyDataFromDataFetcher(options) {
  const response = await fetch(`${options.apiBaseUrl}/v1/runtime/payments/intra-fleet`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.connectionToken}`,
    },
    body: JSON.stringify({
      payee_agent_id: options.dataFetcherAgentId,
      chain: 'arc',
      url: options.dataFetcherUrl,
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`intra_fleet_payment_failed:${response.status}:${errorBody}`);
  }
  const body = await response.json();
  return body.payment;
}

export function createAnalystAgent(options) {
  const walletAddress = options.walletAddress;
  const rpcUrl = options.rpcUrl;
  const app = Fastify({ logger: false });

  app.get('/analysis', async (request, reply) => {
    const query = request.query ?? {};
    const paymentHeader = request.headers['x-payment'];

    if (paymentHeader !== undefined) {
      const paid = await verifyPayment(paymentHeader, rpcUrl);
      if (!paid) return reply.code(402).send({ error: 'payment_verification_failed' });

      // The second-hop payment: buy the raw data before analyzing it.
      const dataPayment = await buyDataFromDataFetcher({
        apiBaseUrl: options.apiBaseUrl,
        connectionToken: options.connectionToken,
        dataFetcherAgentId: options.dataFetcherAgentId,
        dataFetcherUrl: options.dataFetcherUrl,
      });
      const dataResult = dataPayment.body?.data;

      return reply.code(200).send({
        data: {
          query: query.q ?? null,
          analysis: `Analysis of "${dataResult?.value ?? 'unknown'}": within expected range.`,
          sourcedFrom: { agent: 'DataFetcher', txHash: dataPayment.txHash },
          servedAt: new Date(0).toISOString(),
        },
      });
    }

    const resourceUrl = new URL(request.url, `http://${request.headers.host}`).href;
    return reply.code(402).send({
      x402Version: 2,
      resource: {
        url: resourceUrl,
        category: 'analysis',
        description: 'Analyst market analysis (sources DataFetcher data mid-task)',
        mimeType: 'application/json',
      },
      accepts: [{
        scheme: 'exact',
        network: `eip155:${ARC_CHAIN_ID}`,
        asset: ARC_USDC_ADDRESS,
        amount: PRICE_MICROS,
        payTo: walletAddress,
        maxTimeoutSeconds: 60,
        extra: { name: 'USDC', version: '2' },
      }],
    });
  });

  app.get('/healthz', async () => ({ status: 'ok', walletAddress }));

  return app;
}

async function main() {
  const walletAddress = process.env.ANALYST_WALLET_ADDRESS;
  const rpcUrl = process.env.ARC_RPC_URL;
  const port = Number(process.env.ANALYST_PORT ?? '4002');
  const apiBaseUrl = process.env.AGENTOPS_API_BASE_URL;
  const connectionToken = process.env.ANALYST_CONNECTION_TOKEN;
  const dataFetcherAgentId = process.env.DATA_FETCHER_AGENT_ID;
  const dataFetcherUrl = process.env.DATA_FETCHER_URL;
  if (walletAddress === undefined) throw new Error('ANALYST_WALLET_ADDRESS is required');
  if (rpcUrl === undefined) throw new Error('ARC_RPC_URL is required');
  if (apiBaseUrl === undefined) throw new Error('AGENTOPS_API_BASE_URL is required');
  if (connectionToken === undefined) throw new Error('ANALYST_CONNECTION_TOKEN is required');
  if (dataFetcherAgentId === undefined) throw new Error('DATA_FETCHER_AGENT_ID is required');
  if (dataFetcherUrl === undefined) throw new Error('DATA_FETCHER_URL is required');

  const app = createAnalystAgent({
    walletAddress, rpcUrl, apiBaseUrl, connectionToken, dataFetcherAgentId, dataFetcherUrl,
  });
  const address = await app.listen({ host: '127.0.0.1', port });
  console.log(`Analyst listening at ${address}, payTo=${walletAddress}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
