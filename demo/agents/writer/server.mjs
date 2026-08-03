// Writer: a pure earner. Sells a written report, never pays anyone else.
// Same shape as DataFetcher (demo/agents/data-fetcher/server.mjs) --
// the value here is a second, independent real earning agent, not a
// different verification strategy.
import Fastify from 'fastify';

const ARC_CHAIN_ID = process.env.ARC_CHAIN_ID ?? '5042002';
const ARC_USDC_ADDRESS = process.env.ARC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000';
const PRICE_MICROS = process.env.WRITER_PRICE_MICROS ?? '20000'; // 0.02 USDC

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

export function createWriterAgent(options) {
  const walletAddress = options.walletAddress;
  const rpcUrl = options.rpcUrl;
  const app = Fastify({ logger: false });

  app.get('/report', async (request, reply) => {
    const paymentHeader = request.headers['x-payment'];
    const query = request.query ?? {};

    if (paymentHeader !== undefined) {
      const paid = await verifyPayment(paymentHeader, rpcUrl);
      if (paid) {
        return reply.code(200).send({
          data: {
            title: `Report: ${query.topic ?? 'untitled'}`,
            body: `Findings on "${query.topic ?? 'untitled'}", based on the supplied input.`,
            servedAt: new Date(0).toISOString(),
          },
        });
      }
      return reply.code(402).send({ error: 'payment_verification_failed' });
    }

    const resourceUrl = new URL(request.url, `http://${request.headers.host}`).href;
    return reply.code(402).send({
      x402Version: 2,
      resource: {
        url: resourceUrl,
        category: 'written-report',
        description: 'Writer report generation',
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
  const walletAddress = process.env.WRITER_WALLET_ADDRESS;
  const rpcUrl = process.env.ARC_RPC_URL;
  const port = Number(process.env.WRITER_PORT ?? '4003');
  if (walletAddress === undefined) throw new Error('WRITER_WALLET_ADDRESS is required');
  if (rpcUrl === undefined) throw new Error('ARC_RPC_URL is required');

  const app = createWriterAgent({ walletAddress, rpcUrl });
  const address = await app.listen({ host: '127.0.0.1', port });
  console.log(`Writer listening at ${address}, payTo=${walletAddress}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
