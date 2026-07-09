import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BatchFacilitatorClient } from '@circle-fin/x402-batching/server';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import type { PaymentRequirements } from '@x402/core/types';
import { createPublicClient, getAddress, http, parseEventLogs } from 'viem';
import { arbitrumSepolia, baseSepolia } from 'viem/chains';

const TESTNET_GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
const TESTNET_X402_PAY_TO = '0x000000000000000000000000000000000000dEaD';
const TESTNET_X402_AMOUNT = '10000';
const TESTNET_GATEWAY_X402_AMOUNT = '1000';
const TRANSFER_EVENT_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
    name: 'Transfer',
    type: 'event',
  },
] as const;

type GatewayPaymentPayload = Parameters<BatchFacilitatorClient['verify']>[0];
type GatewayPaymentRequirements = Parameters<BatchFacilitatorClient['verify']>[1];
type TestnetVerifierChain = 'base' | 'arbitrum';

type ChainConfig = {
  readonly chain: typeof baseSepolia | typeof arbitrumSepolia;
  readonly exactDescription: string;
  readonly exactForecast: string;
  readonly fallbackRpcUrl: string;
  readonly gatewayDescription: string;
  readonly gatewayForecast: string;
  readonly network: 'eip155:84532' | 'eip155:421614';
  readonly rpcEnv: 'BASE_SEPOLIA_RPC_URL' | 'ARBITRUM_SEPOLIA_RPC_URL';
  readonly usdc: string;
};

const CHAIN_CONFIGS: Record<TestnetVerifierChain, ChainConfig> = {
  arbitrum: {
    chain: arbitrumSepolia,
    exactDescription: 'Exact Arbitrum Sepolia weather verifier',
    exactForecast: 'Arbitrum Sepolia test weather feed delivered after verified USDC payment.',
    fallbackRpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    gatewayDescription: 'Gateway-backed Arbitrum Sepolia weather verifier',
    gatewayForecast: 'Gateway-backed Arbitrum Sepolia test weather feed delivered after x402 payment settlement.',
    network: 'eip155:421614',
    rpcEnv: 'ARBITRUM_SEPOLIA_RPC_URL',
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  },
  base: {
    chain: baseSepolia,
    exactDescription: 'Exact Base Sepolia weather verifier',
    exactForecast: 'Base Sepolia test weather feed delivered after verified USDC payment.',
    fallbackRpcUrl: 'https://sepolia.base.org',
    gatewayDescription: 'Gateway-backed Base Sepolia weather verifier',
    gatewayForecast: 'Gateway-backed Base Sepolia test weather feed delivered after x402 payment settlement.',
    network: 'eip155:84532',
    rpcEnv: 'BASE_SEPOLIA_RPC_URL',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
};

function publicBaseUrl(): string {
  return process.env.PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ?? 'http://localhost:8080';
}

function gatewayFacilitatorUrl(): string {
  const override = process.env.CIRCLE_GATEWAY_API_BASE;
  if (override !== undefined && override.trim().length > 0) return override.trim().replace(/\/+$/, '');
  return 'https://gateway-api-testnet.circle.com';
}

function publicClient(config: ChainConfig) {
  return createPublicClient({
    chain: config.chain,
    transport: http(process.env[config.rpcEnv] ?? config.fallbackRpcUrl),
  });
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function paymentSignatureHeader(headers: Record<string, string | string[] | undefined>): string | null {
  return (
    headerValue(headers['payment-signature']) ??
    headerValue(headers['x-payment']) ??
    headerValue(headers.payment)
  );
}

function chainPath(chain: TestnetVerifierChain, kind: 'exact' | 'gateway'): string {
  if (chain === 'base') return `/v1/testnet/x402/${kind === 'exact' ? 'weather' : 'gateway-weather'}`;
  return `/v1/testnet/x402/${chain}/${kind === 'exact' ? 'weather' : 'gateway-weather'}`;
}

function quotePayload(chain: TestnetVerifierChain) {
  const config = CHAIN_CONFIGS[chain];
  const url = `${publicBaseUrl()}${chainPath(chain, 'exact')}`;
  return {
    x402Version: 2,
    resource: {
      category: 'weather',
      description: config.exactDescription,
      domain: 'localhost',
      method: 'GET',
      mimeType: 'application/json',
      url,
    },
    accepts: [
      {
        scheme: 'exact',
        network: config.network,
        asset: config.usdc,
        payTo: TESTNET_X402_PAY_TO,
        amount: TESTNET_X402_AMOUNT,
        extra: {
          name: 'USDC',
          version: '2',
          maxTimeoutSeconds: 300,
        },
      },
    ],
  };
}

function gatewayQuotePayload(chain: TestnetVerifierChain) {
  const config = CHAIN_CONFIGS[chain];
  const url = `${publicBaseUrl()}${chainPath(chain, 'gateway')}`;
  return {
    x402Version: 2,
    resource: {
      category: 'weather',
      description: config.gatewayDescription,
      domain: 'localhost',
      method: 'GET',
      mimeType: 'application/json',
      url,
    },
    accepts: [
      {
        scheme: 'exact',
        network: config.network,
        asset: config.usdc,
        payTo: TESTNET_X402_PAY_TO,
        amount: TESTNET_GATEWAY_X402_AMOUNT,
        maxTimeoutSeconds: 604800,
        extra: {
          name: 'GatewayWalletBatched',
          version: '1',
          verifyingContract: TESTNET_GATEWAY_WALLET,
        },
      },
    ],
  };
}

async function verifyTransfer(input: {
  readonly amount: string;
  readonly asset: string;
  readonly chain: TestnetVerifierChain;
  readonly payer: string;
  readonly recipient: string;
  readonly txHash: `0x${string}`;
}): Promise<{
  readonly blockNumber: string;
  readonly from: string;
  readonly logIndex: number;
  readonly to: string;
  readonly transactionHash: string;
  readonly value: string;
}> {
  const receipt = await publicClient(CHAIN_CONFIGS[input.chain]).getTransactionReceipt({ hash: input.txHash });
  const logs = parseEventLogs({
    abi: TRANSFER_EVENT_ABI,
    eventName: 'Transfer',
    logs: receipt.logs,
  });

  const expectedAsset = getAddress(input.asset);
  const expectedFrom = getAddress(input.payer);
  const expectedTo = getAddress(input.recipient);
  const expectedValue = BigInt(input.amount);

  const match = logs.find((log) =>
    getAddress(log.address) === expectedAsset &&
    getAddress(log.args.from) === expectedFrom &&
    getAddress(log.args.to) === expectedTo &&
    log.args.value === expectedValue,
  );

  if (match === undefined) {
    throw new Error('matching_usdc_transfer_not_found');
  }

  return {
    blockNumber: receipt.blockNumber.toString(),
    from: getAddress(match.args.from),
    logIndex: match.logIndex,
    to: getAddress(match.args.to),
    transactionHash: receipt.transactionHash,
    value: match.args.value.toString(),
  };
}

function chainFromParam(value: string | undefined): TestnetVerifierChain | null {
  if (value === undefined) return 'base';
  return value === 'base' || value === 'arbitrum' ? value : null;
}

async function gatewayHandler(
  chain: TestnetVerifierChain,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const quote = gatewayQuotePayload(chain);
  const config = CHAIN_CONFIGS[chain];
  const paymentHeader = paymentSignatureHeader(request.headers);
  if (paymentHeader === null) {
    reply.header('PAYMENT-REQUIRED', encodePaymentRequiredHeader(quote));
    return reply.code(402).send({
      ...quote,
      error: 'payment_required',
      message: `Submit the returned Gateway ${config.network} payment quote through agentOps or Circle services pay.`,
    });
  }

  const requirements = quote.accepts[0] as PaymentRequirements;
  const gatewayRequirements = requirements as unknown as GatewayPaymentRequirements;
  try {
    const paymentPayload = decodePaymentSignatureHeader(paymentHeader) as unknown as GatewayPaymentPayload;
    const facilitator = new BatchFacilitatorClient({ url: gatewayFacilitatorUrl() });
    const verify = await facilitator.verify(paymentPayload, gatewayRequirements);
    if (!verify.isValid) {
      return reply.code(402).send({
        error: 'payment_invalid',
        message: verify.invalidReason ?? 'Gateway payment signature was rejected.',
        payer: verify.payer,
      });
    }

    const settlement = await facilitator.settle(paymentPayload, gatewayRequirements);
    reply.header('PAYMENT-RESPONSE', encodePaymentResponseHeader(settlement as Parameters<typeof encodePaymentResponseHeader>[0]));
    if (!settlement.success) {
      return reply.code(402).send({
        error: 'payment_settlement_failed',
        message: settlement.errorReason ?? 'Gateway payment settlement failed.',
        payer: settlement.payer,
        transaction: settlement.transaction,
      });
    }

    return {
      ok: true,
      resource: 'gateway-weather',
      delivered: {
        forecast: config.gatewayForecast,
        units: 'testnet',
      },
      proof: {
        amount: TESTNET_GATEWAY_X402_AMOUNT,
        asset: config.usdc,
        gatewayWallet: TESTNET_GATEWAY_WALLET,
        payer: settlement.payer,
        transaction: settlement.transaction,
      },
    };
  } catch (error) {
    return reply.code(402).send({
      error: 'payment_settlement_error',
      message: error instanceof Error ? error.message : 'Gateway payment settlement failed.',
    });
  }
}

async function exactHandler(
  chain: TestnetVerifierChain,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const config = CHAIN_CONFIGS[chain];
  const txHash = headerValue(request.headers['x-agentops-payment-tx']);
  if (txHash === null) {
    return reply.code(402).send({
      ...quotePayload(chain),
      error: 'payment_required',
      message: `Submit the returned exact ${config.network} payment quote through agentOps.`,
    });
  }

  const amount = headerValue(request.headers['x-agentops-payment-amount']) ?? '';
  const asset = headerValue(request.headers['x-agentops-payment-asset']) ?? '';
  const payer = headerValue(request.headers['x-agentops-payment-payer']) ?? '';
  const recipient = headerValue(request.headers['x-agentops-payment-recipient']) ?? '';
  try {
    if (
      amount !== TESTNET_X402_AMOUNT ||
      getAddress(asset) !== getAddress(config.usdc) ||
      getAddress(recipient) !== getAddress(TESTNET_X402_PAY_TO) ||
      getAddress(payer).length === 0
    ) {
      return reply.code(400).send({
        error: 'payment_proof_mismatch',
        message: 'Payment proof does not match this testnet x402 resource quote.',
      });
    }
  } catch {
    return reply.code(400).send({
      error: 'payment_proof_mismatch',
      message: 'Payment proof does not match this testnet x402 resource quote.',
    });
  }

  const proof = await verifyTransfer({
    amount,
    asset,
    chain,
    payer,
    recipient,
    txHash: txHash as `0x${string}`,
  });

  return {
    ok: true,
    resource: 'weather',
    delivered: {
      forecast: config.exactForecast,
      units: 'testnet',
    },
    proof,
  };
}

export function registerTestnetX402VerifierRoutes(app: FastifyInstance): void {
  app.get('/v1/testnet/x402/gateway-weather', async (request, reply) => gatewayHandler('base', request, reply));
  app.get('/v1/testnet/x402/weather', async (request, reply) => exactHandler('base', request, reply));

  app.get('/v1/testnet/x402/:chain/gateway-weather', async (request, reply) => {
    const params = request.params as { readonly chain?: string };
    const chain = chainFromParam(params.chain);
    if (chain === null) return reply.code(404).send({ error: 'unsupported_testnet_x402_chain' });
    return gatewayHandler(chain, request, reply);
  });

  app.get('/v1/testnet/x402/:chain/weather', async (request, reply) => {
    const params = request.params as { readonly chain?: string };
    const chain = chainFromParam(params.chain);
    if (chain === null) return reply.code(404).send({ error: 'unsupported_testnet_x402_chain' });
    return exactHandler(chain, request, reply);
  });
}
