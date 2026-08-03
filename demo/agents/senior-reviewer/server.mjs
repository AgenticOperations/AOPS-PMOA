// SeniorReviewer: a pure earner on Base Sepolia -- the cross-chain hop.
// Same shape as Writer/DataFetcher; only the chain, USDC address, and
// RPC env var differ. Never claim a Gateway/Arc balance can pay here --
// the Orchestrator must hold a pre-funded Base wallet to reach this
// agent at all (see demo/agents/orchestrator/server.mjs).
import Fastify from 'fastify';

const BASE_SEPOLIA_CHAIN_ID = process.env.BASE_SEPOLIA_CHAIN_ID ?? '84532';
const BASE_SEPOLIA_USDC_ADDRESS = process.env.BASE_SEPOLIA_USDC_ADDRESS ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const PRICE_MICROS = process.env.SENIOR_REVIEWER_PRICE_MICROS ?? '30000'; // 0.03 USDC

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

export function createSeniorReviewerAgent(options) {
  const walletAddress = options.walletAddress;
  const rpcUrl = options.rpcUrl;
  const app = Fastify({ logger: false });

  app.get('/review', async (request, reply) => {
    const paymentHeader = request.headers['x-payment'];
    const query = request.query ?? {};

    if (paymentHeader !== undefined) {
      const paid = await verifyPayment(paymentHeader, rpcUrl);
      if (paid) {
        return reply.code(200).send({
          data: {
            verdict: 'approved',
            notes: `Reviewed "${query.title ?? 'untitled'}" -- no blocking issues found.`,
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
        category: 'review',
        description: 'SeniorReviewer sign-off',
        mimeType: 'application/json',
      },
      accepts: [{
        scheme: 'exact',
        network: `eip155:${BASE_SEPOLIA_CHAIN_ID}`,
        asset: BASE_SEPOLIA_USDC_ADDRESS,
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
  const walletAddress = process.env.SENIOR_REVIEWER_WALLET_ADDRESS;
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL;
  const port = Number(process.env.SENIOR_REVIEWER_PORT ?? '4004');
  if (walletAddress === undefined) throw new Error('SENIOR_REVIEWER_WALLET_ADDRESS is required');
  if (rpcUrl === undefined) throw new Error('BASE_SEPOLIA_RPC_URL is required');

  const app = createSeniorReviewerAgent({ walletAddress, rpcUrl });
  const address = await app.listen({ host: '127.0.0.1', port });
  console.log(`SeniorReviewer listening at ${address}, payTo=${walletAddress}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
