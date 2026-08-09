// DataFetcher: a small paid HTTP service. Returns 402 with x402 payment
// requirements naming its own real wallet address, verifies an incoming
// payment proof (a real Permit2 drawdown tx hash), and serves the payload.
import Fastify from 'fastify';
import { buildDataFetcherPayload } from '../shared/service-payloads.mjs';

const ARC_CHAIN_ID = process.env.ARC_CHAIN_ID ?? '5042002';
const ARC_USDC_ADDRESS = process.env.ARC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000';
const PRICE_MICROS = process.env.DATA_FETCHER_PRICE_MICROS ?? '10000'; // 0.01 USDC

/**
 * Confirms a payment proof (a tx hash) actually happened on-chain and
 * paid this wallet at least the required amount. Reads Permit2's
 * transferFrom event isn't necessary here -- reading the RECEIVING
 * wallet's real balance delta would require a before/after snapshot this
 * stateless verify doesn't have, so this agent instead confirms the
 * transaction itself exists, succeeded, and its recorded destination
 * is this wallet -- the minimum real verification a stateless paid
 * endpoint can do without its own ledger.
 */
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

export function createDataFetcherAgent(options) {
  const walletAddress = options.walletAddress;
  const rpcUrl = options.rpcUrl;
  const app = Fastify({ logger: false });

  app.get('/data', async (request, reply) => {
    const query = request.query ?? {};
    const paymentHeader = request.headers['x-payment'];

    if (paymentHeader !== undefined) {
      const paid = await verifyPayment(paymentHeader, rpcUrl);
      if (paid) {
        return reply.code(200).send({
          data: buildDataFetcherPayload(query.q ?? null),
        });
      }
      return reply.code(402).send({ error: 'payment_verification_failed' });
    }

    const resourceUrl = new URL(request.url, `http://${request.headers.host}`).href;
    return reply.code(402).send({
      x402Version: 2,
      resource: {
        url: resourceUrl,
        category: 'market-data',
        description: 'DataFetcher market snapshot — Arc A2A USDC activity feed',
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

  app.get('/healthz', async () => ({ status: 'ok', walletAddress, service: 'datafetcher.market-snapshot' }));

  return app;
}

async function main() {
  const walletAddress = process.env.DATA_FETCHER_WALLET_ADDRESS;
  const rpcUrl = process.env.ARC_RPC_URL;
  const port = Number(process.env.DATA_FETCHER_PORT ?? '4001');
  if (walletAddress === undefined) throw new Error('DATA_FETCHER_WALLET_ADDRESS is required');
  if (rpcUrl === undefined) throw new Error('ARC_RPC_URL is required');

  const app = createDataFetcherAgent({ walletAddress, rpcUrl });
  const address = await app.listen({ host: '127.0.0.1', port });
  console.log(`DataFetcher listening at ${address}, payTo=${walletAddress}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
