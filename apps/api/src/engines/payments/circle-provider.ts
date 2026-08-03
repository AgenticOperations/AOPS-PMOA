import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { BatchEvmScheme } from '@circle-fin/x402-batching/client';
import type * as CircleWalletsSdkTypes from '@circle-fin/developer-controlled-wallets';
import type { Blockchain, ContractExecutionBlockchain, EvmBlockchain, TestnetBlockchain } from '@circle-fin/developer-controlled-wallets';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { Network, PaymentPayload, PaymentRequirements } from '@x402/core/types';
import {
  CircleAgentCliPaidRequestError,
  createCircleAgentCliExecutor,
  takeCircleAgentCliPaidRequestDebug,
  type CircleAgentCliExecutor,
  type CircleAgentCliPaidRequestDebug,
  type CircleAgentServicePayment,
} from './circle-agent-cli.js';
import type {
  NormalizedPaidHttpRequest,
  PaidHttpRequest,
  PaidHttpResponse,
  ValidatedPaidHttpDestination,
} from './x402-http.js';
import {
  executeBoundedHttpRequest,
  normalizePaidHttpRequest,
  PAID_HTTP_PAYMENT_TIMEOUT_MS,
  PaidHttpError,
} from './x402-http.js';

const require = createRequire(import.meta.url);
const CircleWalletsSdk = require('@circle-fin/developer-controlled-wallets') as typeof CircleWalletsSdkTypes;

export type ProviderMode = 'test' | 'live';
export type CirclePaymentChain = 'base' | 'arbitrum' | 'polygon' | 'optimism' | 'avalanche' | 'arc';

export type ChainCapability = {
  readonly chain: CirclePaymentChain;
  readonly circleBlockchain: string;
  readonly gatewayDomain: number;
  readonly gatewaySupported: boolean;
  readonly nanopaymentsSupported: boolean;
  readonly walletSupported: boolean;
  readonly networkLabel: string;
};

export type CircleProviderHealth = {
  readonly configured: boolean;
  readonly missing: readonly string[];
  readonly mode: ProviderMode;
  readonly provider: 'circle';
};

export type CreateWalletSetInput = {
  readonly label: string;
  readonly mode: ProviderMode;
  readonly orgId: string;
};

export type CreatedWalletSet = {
  readonly circleWalletSetId: string;
};

export type CreateWalletInput = {
  readonly chain: CirclePaymentChain;
  readonly circleBlockchain: string;
  readonly mode: ProviderMode;
  readonly orgId: string;
  readonly walletSetId: string;
  // When set, derive this wallet onto `chain` from an existing wallet
  // rather than creating an independent one -- Circle's "unified EVM
  // addressing": deriveWallet(existingWalletId, newBlockchain) yields the
  // SAME ADDRESS on the new chain. Verified against Circle's docs and the
  // installed SDK (v10.8.0 exposes deriveWallet); NOT the createWallets
  // refId/refIds mechanism Circle's docs also describe, which the
  // installed SDK's CreateWalletsInput type does not expose at all.
  // Optional so callers/providers that don't support multi-chain wallets
  // (the Agent Wallet CLI path) can ignore it without breaking.
  readonly deriveFromWalletId?: string | undefined;
};

export type CreatedWallet = {
  readonly address: string;
  readonly circleWalletId: string;
};

export type CircleBridgeTopUpInput = {
  readonly amount: string;
  readonly fromAddress: string;
  readonly fromChain: CirclePaymentChain;
  readonly idempotencyKey?: string | undefined;
  readonly mode: ProviderMode;
  readonly toAddress: string;
  readonly toChain: CirclePaymentChain;
};

export type CircleBridgeTopUpResult = {
  readonly amount: string;
  readonly errorReason?: string | undefined;
  readonly fromChain: CirclePaymentChain;
  readonly providerMode: ProviderMode;
  readonly success: boolean;
  readonly toChain: CirclePaymentChain;
  readonly transaction?: string | undefined;
};

export type CircleTreasuryProvider = {
  readonly bridgeWalletTopUp: (input: CircleBridgeTopUpInput) => Promise<CircleBridgeTopUpResult>;
  readonly health: (mode: ProviderMode) => CircleProviderHealth;
  readonly createWalletSet: (input: CreateWalletSetInput) => Promise<CreatedWalletSet>;
  readonly createWallet: (input: CreateWalletInput) => Promise<CreatedWallet>;
  readonly getGatewayBalance: (input: CircleGatewayBalanceInput) => Promise<CircleGatewayBalanceResult>;
  readonly getWalletBalances: (input: CircleWalletBalanceInput) => Promise<CircleWalletBalanceResult>;
  readonly initiateGatewayDeposit: (input: CircleGatewayDepositInput) => Promise<CircleGatewayDepositResult>;
  readonly requestTestnetFunds: (input: CircleTestnetFundingInput) => Promise<CircleTestnetFundingResult>;
  readonly settleExactX402: (input: CircleExactX402SettlementInput) => Promise<CircleExactX402SettlementResult>;
  readonly settleGatewayX402: (input: CircleGatewayX402SettlementInput) => Promise<CircleGatewayX402SettlementResult>;
};

export const SECTION_9_CHAINS: readonly CirclePaymentChain[] = [
  'base',
  'arbitrum',
  'polygon',
  'optimism',
  'avalanche',
];

const CAPABILITIES: Record<ProviderMode, readonly ChainCapability[]> = {
  test: [
    {
      chain: 'base',
      circleBlockchain: 'BASE-SEPOLIA',
      gatewayDomain: 6,
      gatewaySupported: true,
      nanopaymentsSupported: true,
      walletSupported: true,
      networkLabel: 'Base Sepolia',
    },
    {
      chain: 'arbitrum',
      circleBlockchain: 'ARB-SEPOLIA',
      gatewayDomain: 3,
      gatewaySupported: true,
      nanopaymentsSupported: true,
      walletSupported: true,
      networkLabel: 'Arbitrum Sepolia',
    },
    {
      chain: 'polygon',
      circleBlockchain: 'MATIC-AMOY',
      gatewayDomain: 7,
      gatewaySupported: true,
      nanopaymentsSupported: true,
      walletSupported: true,
      networkLabel: 'Polygon Amoy',
    },
    {
      chain: 'optimism',
      circleBlockchain: 'OP-SEPOLIA',
      gatewayDomain: 2,
      gatewaySupported: true,
      nanopaymentsSupported: true,
      walletSupported: true,
      networkLabel: 'OP Sepolia',
    },
    {
      chain: 'avalanche',
      circleBlockchain: 'AVAX-FUJI',
      gatewayDomain: 1,
      gatewaySupported: true,
      nanopaymentsSupported: true,
      walletSupported: true,
      networkLabel: 'Avalanche Fuji',
    },
  ],
  live: [
    {
      chain: 'base',
      circleBlockchain: 'BASE',
      gatewayDomain: 6,
      gatewaySupported: true,
      nanopaymentsSupported: true,
      walletSupported: true,
      networkLabel: 'Base',
    },
    {
      chain: 'arbitrum',
      circleBlockchain: 'ARB',
      gatewayDomain: 3,
      gatewaySupported: true,
      nanopaymentsSupported: true,
      walletSupported: true,
      networkLabel: 'Arbitrum',
    },
    {
      chain: 'polygon',
      circleBlockchain: 'MATIC',
      gatewayDomain: 7,
      gatewaySupported: true,
      nanopaymentsSupported: true,
      walletSupported: true,
      networkLabel: 'Polygon PoS',
    },
    {
      chain: 'optimism',
      circleBlockchain: 'OP',
      gatewayDomain: 2,
      gatewaySupported: true,
      nanopaymentsSupported: true,
      walletSupported: true,
      networkLabel: 'Optimism',
    },
    {
      chain: 'avalanche',
      circleBlockchain: 'AVAX',
      gatewayDomain: 1,
      gatewaySupported: true,
      nanopaymentsSupported: true,
      walletSupported: true,
      networkLabel: 'Avalanche',
    },
  ],
};

export type CircleGatewayX402Requirements = {
  readonly scheme: 'exact';
  readonly network: string;
  readonly asset: string;
  readonly amount: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly extra: Record<string, unknown>;
};

type CircleX402WalletIdentity = {
  readonly walletId: string;
  readonly walletAddress: string;
};

export type CircleCanonicalX402SettlementInput = CircleX402WalletIdentity & {
  readonly attemptId: string;
  readonly destination: ValidatedPaidHttpDestination;
  readonly mode: ProviderMode;
  readonly payerAddress?: string | undefined;
  readonly request: PaidHttpRequest;
  readonly resource?: NonNullable<PaymentPayload['resource']> | undefined;
  readonly requirements: CircleGatewayX402Requirements;
};

export type CircleLegacyX402SettlementInput = CircleX402WalletIdentity & {
  readonly mode: ProviderMode;
  readonly requirements: CircleGatewayX402Requirements;
  readonly resource: {
    readonly url: string;
    readonly description: string;
    readonly mimeType: string;
    readonly method?: string | undefined;
  };
};

export type CircleGatewayX402SettlementInput =
  | CircleCanonicalX402SettlementInput
  | CircleLegacyX402SettlementInput;

export type CircleProviderPayment = {
  readonly status: 'settled' | 'failed' | 'unknown';
  readonly transaction?: string | undefined;
  readonly payer?: string | undefined;
  readonly network: string;
  readonly receipt?: unknown;
  readonly errorCode?: string | undefined;
};

export type CircleGatewayX402SettlementResult = {
  /** Required on real provider results; optional only for pre-Task-4 legacy test doubles. */
  readonly payment?: CircleProviderPayment | undefined;
  readonly response?: PaidHttpResponse | undefined;
  /** @deprecated Use payment.errorCode. */
  readonly errorReason?: string | undefined;
  /** @deprecated Use response. */
  readonly fulfillment?: {
    readonly body?: unknown;
    readonly errorReason?: string | undefined;
    readonly httpStatus?: number | undefined;
    readonly status: 'delivered' | 'failed' | 'not_requested';
  } | undefined;
  readonly network: string;
  readonly payer?: string | undefined;
  readonly providerMode: ProviderMode;
  readonly success: boolean;
  readonly transaction?: string | undefined;
  /** @deprecated Use response.status. */
  readonly httpStatus?: number | undefined;
};

export type CircleExactX402SettlementInput = CircleGatewayX402SettlementInput;

export type CircleExactX402SettlementResult = CircleGatewayX402SettlementResult;

export type CircleWalletBalanceInput = {
  readonly mode: ProviderMode;
  readonly walletId: string;
};

export type CircleTokenBalance = {
  readonly amount: string;
  readonly blockchain: string | null;
  readonly isNative: boolean;
  readonly symbol: string | null;
  readonly tokenAddress: string | null;
};

export type CircleWalletBalanceResult = {
  readonly balances: readonly CircleTokenBalance[];
  readonly providerMode: ProviderMode;
};

export type CircleGatewayBalanceInput = {
  readonly address: string;
  readonly chain: CirclePaymentChain;
  readonly mode: ProviderMode;
};

export type CircleGatewayBalanceResult = {
  readonly available: string;
  readonly domain: number;
  readonly providerMode: ProviderMode;
  readonly total: string;
  readonly withdrawable: string;
  readonly withdrawing: string;
};

export type CircleGatewayDepositInput = {
  readonly address: string;
  readonly amountMicros: bigint;
  readonly chain: CirclePaymentChain;
  readonly mode: ProviderMode;
  readonly walletId: string;
};

export type CircleGatewayDepositResult = {
  readonly amount: string;
  readonly amountMicros: string;
  readonly approvalTransactionId: string;
  readonly depositTransactionId: string;
  readonly gatewayDepositorAddress: string;
  readonly gatewayWalletAddress: string;
  readonly providerMode: ProviderMode;
  readonly usdcAddress: string;
};

export type CircleTestnetFundingInput = {
  readonly address: string;
  readonly chain: CirclePaymentChain;
  readonly mode: ProviderMode;
};

export type CircleTestnetFundingResult = {
  readonly address: string;
  readonly chain: CirclePaymentChain;
  readonly providerMode: ProviderMode;
  readonly response: unknown;
};

type SignTypedDataPayload = {
  readonly domain: Record<string, unknown>;
  readonly message: Record<string, unknown>;
  readonly primaryType: string;
  readonly types: Record<string, unknown>;
};

type ChainContractConfig = {
  readonly domain: number;
  readonly gatewayWallet: string;
  readonly usdc: string;
};

const TESTNET_GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
const MAINNET_GATEWAY_WALLET = '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE';

const TESTNET_X402_CHAINS = {
  'eip155:421614': 'arbitrum',
  'eip155:43113': 'avalanche',
  'eip155:84532': 'base',
  'eip155:11155420': 'optimism',
  'eip155:80002': 'polygon',
  'eip155:5042002': 'arc',
} as const satisfies Record<string, CirclePaymentChain>;

const CHAIN_CONTRACTS: Record<ProviderMode, Record<CirclePaymentChain, ChainContractConfig>> = {
  test: {
    arbitrum: { domain: 3, gatewayWallet: TESTNET_GATEWAY_WALLET, usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' },
    avalanche: { domain: 1, gatewayWallet: TESTNET_GATEWAY_WALLET, usdc: '0x5425890298aed601595a70AB815c96711a31Bc65' },
    base: { domain: 6, gatewayWallet: TESTNET_GATEWAY_WALLET, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
    optimism: { domain: 2, gatewayWallet: TESTNET_GATEWAY_WALLET, usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7' },
    polygon: { domain: 7, gatewayWallet: TESTNET_GATEWAY_WALLET, usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582' },
    // Verified live (spike S1, docs/spike-results.md): same GatewayWalletBatched
    // contract as the other chains; domain 26 per Arc's CCTP v2 registration;
    // USDC is Arc's native gas asset, exposed at this precompile-shaped address.
    arc: { domain: 26, gatewayWallet: TESTNET_GATEWAY_WALLET, usdc: '0x3600000000000000000000000000000000000000' },
  },
  live: {
    arbitrum: { domain: 3, gatewayWallet: MAINNET_GATEWAY_WALLET, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
    avalanche: { domain: 1, gatewayWallet: MAINNET_GATEWAY_WALLET, usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' },
    base: { domain: 6, gatewayWallet: MAINNET_GATEWAY_WALLET, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    optimism: { domain: 2, gatewayWallet: MAINNET_GATEWAY_WALLET, usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
    polygon: { domain: 7, gatewayWallet: MAINNET_GATEWAY_WALLET, usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
    // Unreachable placeholder. Constraint I.1: Arc mainnet does not exist.
    // contractConfig() throws before this entry is ever read.
    arc: { domain: -1, gatewayWallet: '0x0000000000000000000000000000000000000000', usdc: '0x0000000000000000000000000000000000000000' },
  },
};

export function assertCircleTestnetX402Authority(
  operation: 'settleExactX402' | 'settleGatewayX402',
  input: unknown,
): void {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('circle_worker_x402_authority_invalid');
  }
  const settlement = input as Record<string, unknown>;
  const requirements = settlement.requirements;
  if (
    settlement.mode !== 'test' ||
    requirements === null ||
    typeof requirements !== 'object' ||
    Array.isArray(requirements)
  ) {
    throw new Error('circle_worker_x402_authority_invalid');
  }
  const authority = requirements as Record<string, unknown>;
  const chain = typeof authority.network === 'string'
    ? TESTNET_X402_CHAINS[authority.network as keyof typeof TESTNET_X402_CHAINS]
    : undefined;
  if (
    chain === undefined ||
    typeof authority.asset !== 'string' ||
    authority.asset.toLowerCase() !== CHAIN_CONTRACTS.test[chain].usdc.toLowerCase() ||
    authority.scheme !== 'exact'
  ) {
    throw new Error('circle_worker_x402_authority_invalid');
  }
  if (operation === 'settleGatewayX402') {
    const extra = authority.extra;
    if (
      extra === null ||
      typeof extra !== 'object' ||
      Array.isArray(extra)
    ) {
      throw new Error('circle_worker_x402_authority_invalid');
    }
    const gatewayDomain = extra as Record<string, unknown>;
    const verifyingContract = gatewayDomain.verifyingContract;
    if (
      typeof verifyingContract !== 'string' ||
      !/^0x[0-9a-fA-F]{40}$/.test(verifyingContract) ||
      verifyingContract.toLowerCase() !== TESTNET_GATEWAY_WALLET.toLowerCase() ||
      gatewayDomain.name !== 'GatewayWalletBatched' ||
      gatewayDomain.version !== '1'
    ) {
      throw new Error('circle_worker_x402_authority_invalid');
    }
  }
}

const TESTNET_FAUCET_BLOCKCHAINS: Record<CirclePaymentChain, TestnetBlockchain> = {
  arbitrum: 'ARB-SEPOLIA',
  avalanche: 'AVAX-FUJI',
  base: 'BASE-SEPOLIA',
  optimism: 'OP-SEPOLIA',
  polygon: 'MATIC-AMOY',
  arc: 'ARC-TESTNET',
};

const CONTRACT_EXECUTION_BLOCKCHAINS: Record<ProviderMode, Record<CirclePaymentChain, ContractExecutionBlockchain>> = {
  test: {
    arbitrum: 'ARB-SEPOLIA',
    avalanche: 'AVAX-FUJI',
    base: 'BASE-SEPOLIA',
    optimism: 'OP-SEPOLIA',
    polygon: 'MATIC-AMOY',
    arc: 'ARC-TESTNET',
  },
  live: {
    arbitrum: 'ARB',
    avalanche: 'AVAX',
    base: 'BASE',
    optimism: 'OP',
    polygon: 'MATIC',
    // Constraint I.1: Arc mainnet does not exist. This SDK enum member
    // exists ('ARC') but nothing in this codebase may ever select it in
    // live mode -- see contractConfig()'s explicit guard above.
    arc: 'ARC',
  },
};

function domainTypes(domain: Record<string, unknown>): readonly { readonly name: string; readonly type: string }[] {
  const fields: { readonly name: string; readonly type: string }[] = [];
  if (domain.name !== undefined) fields.push({ name: 'name', type: 'string' });
  if (domain.version !== undefined) fields.push({ name: 'version', type: 'string' });
  if (domain.chainId !== undefined) fields.push({ name: 'chainId', type: 'uint256' });
  if (domain.verifyingContract !== undefined) fields.push({ name: 'verifyingContract', type: 'address' });
  if (domain.salt !== undefined) fields.push({ name: 'salt', type: 'bytes32' });
  return fields;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

export function normalizeTypedDataForCircle(payload: SignTypedDataPayload): SignTypedDataPayload {
  return {
    domain: jsonSafe(payload.domain) as Record<string, unknown>,
    message: jsonSafe(payload.message) as Record<string, unknown>,
    primaryType: payload.primaryType,
    types: {
      EIP712Domain: domainTypes(payload.domain),
      ...jsonSafe(payload.types) as Record<string, unknown>,
    },
  };
}

type CircleProviderEnv = {
  readonly apiBaseUrl?: string | undefined;
  readonly apiKey: string;
  readonly entitySecret: string;
};

function readEnv(mode: ProviderMode): CircleProviderEnv {
  const prefix = mode === 'test' ? 'CIRCLE_TEST_' : 'CIRCLE_LIVE_';
  const apiKey = process.env[`${prefix}API_KEY`] ?? process.env.CIRCLE_API_KEY ?? '';
  const entitySecret = process.env[`${prefix}ENTITY_SECRET`] ?? process.env.CIRCLE_ENTITY_SECRET ?? '';
  return {
    apiBaseUrl: process.env.CIRCLE_API_BASE,
    apiKey,
    entitySecret,
  };
}

function gatewayApiUrl(mode: ProviderMode): string {
  const override = process.env.CIRCLE_GATEWAY_API_BASE;
  if (override !== undefined && override.trim().length > 0) return override.trim().replace(/\/+$/, '');
  return mode === 'test' ? 'https://gateway-api-testnet.circle.com/v1' : 'https://gateway-api.circle.com/v1';
}

function contractConfig(mode: ProviderMode, chain: CirclePaymentChain): ChainContractConfig {
  // Constraint I.1: Arc mainnet does not exist. CHAIN_CONTRACTS.live.arc
  // below is an unreachable placeholder required only because this is an
  // exhaustive Record<ProviderMode, Record<CirclePaymentChain, ...>> --
  // fail loudly here rather than silently handing out a fake address.
  if (chain === 'arc' && mode === 'live') {
    throw new Error('arc_mainnet_not_supported');
  }
  return CHAIN_CONTRACTS[mode][chain];
}

function formatMicros(micros: bigint): string {
  const sign = micros < 0n ? '-' : '';
  const absolute = micros < 0n ? -micros : micros;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${whole.toString()}${fraction.length === 0 ? '' : `.${fraction}`}`;
}

function parseGatewayAmount(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  return '0';
}

async function fetchGatewayBalanceFromApi({
  address,
  chain,
  mode,
}: CircleGatewayBalanceInput): Promise<CircleGatewayBalanceResult> {
  const config = contractConfig(mode, chain);
  const response = await fetch(`${gatewayApiUrl(mode)}/balances`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sources: [{ depositor: address, domain: config.domain }],
      token: 'USDC',
    }),
  });
  const body = await response.json() as { readonly balances?: readonly Record<string, unknown>[]; readonly message?: string };
  if (!response.ok) throw new Error(body.message ?? `gateway_balance_failed_${response.status}`);
  const balance = body.balances?.[0];
  if (balance === undefined) throw new Error('gateway_balance_missing');
  return {
    available: parseGatewayAmount(balance.balance),
    domain: config.domain,
    providerMode: mode,
    total: parseGatewayAmount(balance.balance),
    withdrawable: parseGatewayAmount(balance.withdrawable),
    withdrawing: parseGatewayAmount(balance.withdrawing),
  };
}

function tokenBalanceFromUnknown(value: unknown): CircleTokenBalance {
  const record = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  const token = record.token !== null && typeof record.token === 'object' ? record.token as Record<string, unknown> : {};
  return {
    amount: parseGatewayAmount(record.amount),
    blockchain: typeof token.blockchain === 'string' ? token.blockchain : null,
    isNative: token.isNative === true,
    symbol: typeof token.symbol === 'string' ? token.symbol : null,
    tokenAddress: typeof token.tokenAddress === 'string' ? token.tokenAddress : null,
  };
}

function circleFee(): { readonly type: 'level'; readonly config: { readonly feeLevel: 'HIGH' } } {
  return { type: 'level', config: { feeLevel: 'HIGH' } };
}

type CircleTransactionClient = {
  readonly getTransaction: (input: { readonly id: string }) => Promise<{
    readonly data?: {
      readonly transaction?: {
        readonly state?: string | undefined;
      } | undefined;
    } | undefined;
  }>;
};

const CIRCLE_SUCCESS_TRANSACTION_STATES = new Set(['COMPLETE', 'CONFIRMED']);
const CIRCLE_FAILED_TRANSACTION_STATES = new Set(['FAILED', 'DENIED', 'CANCELLED']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCircleTransaction(
  client: CircleTransactionClient,
  transactionId: string,
  label: string,
  options: { readonly intervalMs?: number; readonly maxAttempts?: number } = {},
): Promise<string> {
  const intervalMs = options.intervalMs ?? 3_000;
  const maxAttempts = options.maxAttempts ?? 30;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await client.getTransaction({ id: transactionId });
    const state = response.data?.transaction?.state;
    if (state !== undefined && CIRCLE_SUCCESS_TRANSACTION_STATES.has(state)) return state;
    if (state !== undefined && CIRCLE_FAILED_TRANSACTION_STATES.has(state)) {
      throw new Error(`${label}_transaction_${state.toLowerCase()}`);
    }
    if (attempt < maxAttempts - 1) await sleep(intervalMs);
  }

  throw new Error(`${label}_transaction_timeout`);
}

function paidHttpResponseHeader(response: PaidHttpResponse): string | undefined {
  for (const [name, value] of response.headers) {
    const normalized = name.toLowerCase();
    if (normalized === 'payment-response' || normalized === 'x-payment-response') return value;
  }
  return undefined;
}

const CIRCLE_PROVIDER_PAID_REQUEST_DEBUG = new WeakMap<object, CircleAgentCliPaidRequestDebug>();

export function takeCircleProviderPaidRequestDebug(
  result: CircleGatewayX402SettlementResult,
): CircleAgentCliPaidRequestDebug | undefined {
  const debug = CIRCLE_PROVIDER_PAID_REQUEST_DEBUG.get(result);
  CIRCLE_PROVIDER_PAID_REQUEST_DEBUG.delete(result);
  return debug;
}

function isCanonicalSettlementInput(
  input: CircleGatewayX402SettlementInput,
): input is CircleCanonicalX402SettlementInput {
  return 'request' in input && 'destination' in input && 'attemptId' in input;
}

function cliPaidHttpResponse(value: unknown): PaidHttpResponse | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    return {
      status: 200,
      headers: [],
      contentType: 'text/plain; charset=utf-8',
      bodyEncoding: 'text',
      body: value,
      sizeBytes: Buffer.byteLength(value),
      truncated: false,
    };
  }
  const encoded = JSON.stringify(value);
  return {
    status: 200,
    headers: [],
    contentType: 'application/json',
    bodyEncoding: 'json',
    body: value,
    sizeBytes: Buffer.byteLength(encoded),
    truncated: false,
  };
}

function canonicalSettlementResult(input: {
  readonly mode: ProviderMode;
  readonly payment: CircleProviderPayment;
  readonly response?: PaidHttpResponse | undefined;
}): CircleGatewayX402SettlementResult {
  return {
    payment: input.payment,
    ...(input.response === undefined ? {} : { response: input.response }),
    errorReason: input.payment.errorCode,
    fulfillment: input.response === undefined
      ? { status: 'not_requested' }
      : {
          body: input.response.body,
          httpStatus: input.response.status,
          status: 'delivered',
        },
    network: input.payment.network,
    payer: input.payment.payer,
    providerMode: input.mode,
    success: input.payment.status === 'settled',
    transaction: input.payment.transaction,
  };
}

function agentWalletSettlementResult(input: {
  readonly mode: ProviderMode;
  readonly network: string;
  readonly payer: string;
  readonly payment: CircleAgentServicePayment;
}): CircleGatewayX402SettlementResult {
  return canonicalSettlementResult({
    mode: input.mode,
    payment: {
      status: 'settled',
      transaction: input.payment.transaction ?? undefined,
      payer: input.payer,
      network: input.network,
      ...(input.payment.payment === null
        ? {}
        : { receipt: input.payment.payment.receipt }),
    },
    response: cliPaidHttpResponse(input.payment.response),
  });
}

function agentWalletErrorResult(input: {
  readonly error: unknown;
  readonly mode: ProviderMode;
  readonly network: string;
}): CircleGatewayX402SettlementResult {
  const typedError = input.error instanceof CircleAgentCliPaidRequestError
    ? input.error
    : undefined;
  return canonicalSettlementResult({
    mode: input.mode,
    payment: {
      status: typedError?.classification === 'ambiguous_post_submit'
        ? 'unknown'
        : 'failed',
      network: input.network,
      errorCode: typedError?.code ?? (
        input.error instanceof Error
          ? input.error.message
          : 'circle_agent_wallet_payment_failed'
      ),
    },
  });
}

type X402HttpExecutor = typeof executeBoundedHttpRequest;

type DeveloperControlledProviderOptions = {
  readonly executeHttpRequest?: X402HttpExecutor | undefined;
};

function settlementErrorCode(error: unknown, fallback: string): string {
  if (error instanceof PaidHttpError) return error.code;
  return error instanceof Error ? error.message : fallback;
}

function developerResponseResult(input: {
  readonly mode: ProviderMode;
  readonly network: string;
  readonly expectedPayer: string;
  readonly response: PaidHttpResponse;
}): CircleGatewayX402SettlementResult {
  const encodedReceipt = paidHttpResponseHeader(input.response);
  if (encodedReceipt === undefined || encodedReceipt.length === 0) {
    return canonicalSettlementResult({
      mode: input.mode,
      payment: {
        status: 'unknown',
        network: input.network,
        errorCode: 'payment_response_missing',
      },
      response: input.response,
    });
  }

  let receipt: unknown;
  try {
    receipt = decodePaymentResponseHeader(encodedReceipt);
  } catch {
    return canonicalSettlementResult({
      mode: input.mode,
      payment: {
        status: 'unknown',
        network: input.network,
        errorCode: 'payment_response_malformed',
      },
      response: input.response,
    });
  }
  if (receipt === null || typeof receipt !== 'object') {
    return canonicalSettlementResult({
      mode: input.mode,
      payment: {
        status: 'unknown',
        network: input.network,
        receipt,
        errorCode: 'payment_response_malformed',
      },
      response: input.response,
    });
  }
  const decoded = receipt as Record<string, unknown>;
  if (
    typeof decoded.success !== 'boolean' ||
    typeof decoded.network !== 'string' ||
    (decoded.transaction !== undefined && typeof decoded.transaction !== 'string') ||
    (decoded.payer !== undefined && typeof decoded.payer !== 'string') ||
    (decoded.errorReason !== undefined && typeof decoded.errorReason !== 'string')
  ) {
    return canonicalSettlementResult({
      mode: input.mode,
      payment: {
        status: 'unknown',
        network: typeof decoded.network === 'string' ? decoded.network : input.network,
        receipt,
        errorCode: 'payment_response_malformed',
      },
      response: input.response,
    });
  }
  if (
    decoded.success &&
    (decoded.network.length === 0 ||
      typeof decoded.transaction !== 'string' ||
      decoded.transaction.trim().length === 0 ||
      typeof decoded.payer !== 'string' ||
      decoded.payer.trim().length === 0)
  ) {
    return canonicalSettlementResult({
      mode: input.mode,
      payment: {
        status: 'unknown',
        network: decoded.network,
        receipt,
        payer: decoded.payer,
        transaction: typeof decoded.transaction === 'string' ? decoded.transaction : undefined,
        errorCode: 'payment_response_malformed',
      },
      response: input.response,
    });
  }
  if (decoded.network !== input.network) {
    return canonicalSettlementResult({
      mode: input.mode,
      payment: {
        status: 'unknown',
        network: decoded.network,
        receipt,
        transaction: typeof decoded.transaction === 'string' ? decoded.transaction : undefined,
        payer: decoded.payer,
        errorCode: 'payment_response_network_mismatch',
      },
      response: input.response,
    });
  }
  if (
    decoded.success &&
    decoded.payer !== undefined &&
    decoded.payer.toLowerCase() !== input.expectedPayer.toLowerCase()
  ) {
    return canonicalSettlementResult({
      mode: input.mode,
      payment: {
        status: 'unknown',
        network: decoded.network,
        receipt,
        transaction: decoded.transaction,
        payer: decoded.payer,
        errorCode: 'payment_response_payer_mismatch',
      },
      response: input.response,
    });
  }
  return canonicalSettlementResult({
    mode: input.mode,
    payment: {
      status: decoded.success ? 'settled' : 'failed',
      network: decoded.network,
      receipt,
      transaction: typeof decoded.transaction === 'string' ? decoded.transaction : undefined,
      payer: decoded.payer,
      ...(decoded.success
        ? {}
        : { errorCode: decoded.errorReason ?? 'payment_settlement_failed' }),
    },
    response: input.response,
  });
}

async function executeSignedX402(input: {
  readonly executor: X402HttpExecutor;
  readonly settlement: CircleCanonicalX402SettlementInput;
  readonly createPayload: (
    signer: {
      readonly address: `0x${string}`;
      readonly signTypedData: (payload: SignTypedDataPayload) => Promise<`0x${string}`>;
    },
    requirements: PaymentRequirements,
  ) => Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>>;
  readonly signTypedData: (payload: SignTypedDataPayload) => Promise<`0x${string}`>;
}): Promise<CircleGatewayX402SettlementResult> {
  const { mode, request, requirements, walletAddress } = input.settlement;
  let paidRequest: NormalizedPaidHttpRequest;
  try {
    const normalized = normalizePaidHttpRequest(request);
    const signer = {
      address: (input.settlement.payerAddress ?? walletAddress) as `0x${string}`,
      signTypedData: input.signTypedData,
    };
    const normalizedRequirements = {
      ...requirements,
      network: requirements.network as Network,
    } as PaymentRequirements;
    const created = await input.createPayload(signer, normalizedRequirements);
    const paymentPayload: PaymentPayload = {
      ...created,
      accepted: normalizedRequirements,
      resource: input.settlement.resource ?? { url: normalized.url },
    };
    const proof = encodePaymentSignatureHeader(paymentPayload);
    paidRequest = {
      ...normalized,
      headers: [...normalized.headers, ['PAYMENT-SIGNATURE', proof]],
    };
  } catch (error) {
    return canonicalSettlementResult({
      mode,
      payment: {
        status: 'failed',
        network: requirements.network,
        errorCode: settlementErrorCode(error, 'payment_payload_creation_failed'),
      },
    });
  }

  let response: PaidHttpResponse;
  try {
    response = await input.executor(
      paidRequest,
      input.settlement.destination,
      { timeoutMs: PAID_HTTP_PAYMENT_TIMEOUT_MS },
    );
  } catch (error) {
    return canonicalSettlementResult({
      mode,
      payment: {
        status: 'unknown',
        network: requirements.network,
        errorCode: settlementErrorCode(error, 'paid_http_request_failed_after_proof'),
      },
    });
  }
  const result = developerResponseResult({
    mode,
    network: requirements.network,
    expectedPayer: input.settlement.payerAddress ?? walletAddress,
    response,
  });
  return { ...result, httpStatus: response.status };
}

function missingConfig(mode: ProviderMode): readonly string[] {
  const env = readEnv(mode);
  const missing: string[] = [];
  if (env.apiKey.length === 0) missing.push(mode === 'test' ? 'CIRCLE_TEST_API_KEY' : 'CIRCLE_LIVE_API_KEY');
  if (env.entitySecret.length === 0) {
    missing.push(mode === 'test' ? 'CIRCLE_TEST_ENTITY_SECRET' : 'CIRCLE_LIVE_ENTITY_SECRET');
  }
  return missing;
}

type CircleClientParams = Parameters<typeof CircleWalletsSdkTypes.initiateDeveloperControlledWalletsClient>[0];

function clientParams(env: CircleProviderEnv): CircleClientParams {
  return {
    apiKey: env.apiKey,
    entitySecret: env.entitySecret,
    ...(env.apiBaseUrl === undefined || env.apiBaseUrl.length === 0 ? {} : { baseUrl: env.apiBaseUrl }),
  };
}

export function capabilitiesForMode(mode: ProviderMode): readonly ChainCapability[] {
  return CAPABILITIES[mode];
}

export function circleRailForChain(chain: CirclePaymentChain): string {
  return `gateway_${chain}`;
}

export function createDeveloperControlledCircleTreasuryProvider(
  options: DeveloperControlledProviderOptions = {},
): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: ({ amount, fromChain, mode, toChain }) => Promise.resolve({
      amount,
      errorReason: 'developer_controlled_bridge_topup_not_supported',
      fromChain,
      providerMode: mode,
      success: false,
      toChain,
    }),
    health: (mode) => {
      const missing = missingConfig(mode);
      return {
        configured: missing.length === 0,
        missing,
        mode,
        provider: 'circle',
      };
    },
    createWalletSet: async ({ label, mode }) => {
      const env = readEnv(mode);
      const client = CircleWalletsSdk.initiateDeveloperControlledWalletsClient(clientParams(env));
      const response = await client.createWalletSet({
        idempotencyKey: crypto.randomUUID(),
        name: label,
      });
      const walletSetId = response.data?.walletSet?.id;
      if (walletSetId === undefined || walletSetId.length === 0) {
        throw new Error('circle_wallet_set_missing_id');
      }
      return { circleWalletSetId: walletSetId };
    },
    createWallet: async ({ circleBlockchain, deriveFromWalletId, mode, walletSetId }) => {
      const env = readEnv(mode);
      const client = CircleWalletsSdk.initiateDeveloperControlledWalletsClient(clientParams(env));

      if (deriveFromWalletId !== undefined) {
        // Same address on a new chain, derived from an existing wallet --
        // this is what makes an agent's Arc and Base wallets share one
        // address (K-13). deriveWallet only accepts EvmBlockchain, which
        // includes 'ARC-TESTNET' and 'BASE-SEPOLIA'.
        const response = await client.deriveWallet({
          id: deriveFromWalletId,
          blockchain: circleBlockchain as EvmBlockchain,
        });
        const wallet = response.data?.wallet;
        if (wallet === undefined || wallet.id.length === 0 || wallet.address.length === 0) {
          throw new Error('circle_wallet_derive_missing_id_or_address');
        }
        return {
          address: wallet.address,
          circleWalletId: wallet.id,
        };
      }

      const response = await client.createWallets({
        accountType: 'EOA',
        blockchains: [circleBlockchain as Blockchain],
        count: 1,
        idempotencyKey: crypto.randomUUID(),
        walletSetId,
      });
      const wallet = response.data?.wallets?.[0];
      if (wallet === undefined || wallet.id.length === 0 || wallet.address.length === 0) {
        throw new Error('circle_wallet_missing_id_or_address');
      }
      return {
        address: wallet.address,
        circleWalletId: wallet.id,
      };
    },
    getGatewayBalance: fetchGatewayBalanceFromApi,
    getWalletBalances: async ({ mode, walletId }) => {
      const env = readEnv(mode);
      const client = CircleWalletsSdk.initiateDeveloperControlledWalletsClient(clientParams(env));
      const response = await client.getWalletTokenBalance({ id: walletId });
      const rawBalances = response.data?.tokenBalances;
      return {
        balances: Array.isArray(rawBalances) ? rawBalances.map(tokenBalanceFromUnknown) : [],
        providerMode: mode,
      };
    },
    initiateGatewayDeposit: async ({ address, amountMicros, chain, mode }) => {
      const env = readEnv(mode);
      const client = CircleWalletsSdk.initiateDeveloperControlledWalletsClient(clientParams(env));
      const config = contractConfig(mode, chain);
      const amount = formatMicros(amountMicros);
      const amountAtomic = amountMicros.toString();
      const approval = await client.createContractExecutionTransaction({
        abiFunctionSignature: 'approve(address,uint256)',
        abiParameters: [config.gatewayWallet, amountAtomic],
        blockchain: CONTRACT_EXECUTION_BLOCKCHAINS[mode][chain],
        contractAddress: config.usdc,
        fee: circleFee(),
        idempotencyKey: crypto.randomUUID(),
        refId: `agentops-gateway-approve-${chain}-${crypto.randomUUID()}`,
        walletAddress: address,
      });
      const approvalId = approval.data?.id;
      if (approvalId === undefined || approvalId.length === 0) throw new Error('circle_gateway_approval_transaction_missing');
      await waitForCircleTransaction(client, approvalId, 'circle_gateway_approval');

      const deposit = await client.createContractExecutionTransaction({
        abiFunctionSignature: 'deposit(address,uint256)',
        abiParameters: [config.usdc, amountAtomic],
        blockchain: CONTRACT_EXECUTION_BLOCKCHAINS[mode][chain],
        contractAddress: config.gatewayWallet,
        fee: circleFee(),
        idempotencyKey: crypto.randomUUID(),
        refId: `agentops-gateway-deposit-${chain}-${crypto.randomUUID()}`,
        walletAddress: address,
      });
      const depositId = deposit.data?.id;
      if (depositId === undefined || depositId.length === 0) throw new Error('circle_gateway_deposit_transaction_missing');
      await waitForCircleTransaction(client, depositId, 'circle_gateway_deposit');

      return {
        amount,
        amountMicros: amountAtomic,
        approvalTransactionId: approvalId,
        depositTransactionId: depositId,
        gatewayDepositorAddress: address,
        gatewayWalletAddress: config.gatewayWallet,
        providerMode: mode,
        usdcAddress: config.usdc,
      };
    },
    requestTestnetFunds: async ({ address, chain, mode }) => {
      if (mode !== 'test') throw new Error('circle_testnet_faucet_unavailable_in_live_mode');
      const env = readEnv(mode);
      const client = CircleWalletsSdk.initiateDeveloperControlledWalletsClient(clientParams(env));
      const response = await client.requestTestnetTokens({
        address,
        blockchain: TESTNET_FAUCET_BLOCKCHAINS[chain],
        native: true,
        usdc: true,
      });
      return {
        address,
        chain,
        providerMode: mode,
        response: response.data ?? response,
      };
    },
    settleExactX402: async (input) => {
      if (!isCanonicalSettlementInput(input)) {
        return canonicalSettlementResult({
          mode: input.mode,
          payment: {
            status: 'failed',
            network: input.requirements.network,
            errorCode: 'canonical_paid_http_input_required',
          },
        });
      }
      const { mode } = input;
      const env = readEnv(mode);
      const client = CircleWalletsSdk.initiateDeveloperControlledWalletsClient(clientParams(env));
      return executeSignedX402({
        executor: options.executeHttpRequest ?? executeBoundedHttpRequest,
        settlement: input,
        createPayload: (signer, requirements) =>
          new ExactEvmScheme(signer).createPaymentPayload(2, requirements),
        signTypedData: async (payload) => {
          const response = await client.signTypedData({
            walletId: input.walletId,
            data: JSON.stringify(normalizeTypedDataForCircle(payload)),
            memo: 'agentOps exact x402 payment authorization',
          });
          const signature = response.data?.signature;
          if (signature === undefined || signature.length === 0) throw new Error('circle_signature_missing');
          return signature as `0x${string}`;
        },
      });
    },
    settleGatewayX402: async (input) => {
      if (!isCanonicalSettlementInput(input)) {
        return canonicalSettlementResult({
          mode: input.mode,
          payment: {
            status: 'failed',
            network: input.requirements.network,
            errorCode: 'canonical_paid_http_input_required',
          },
        });
      }
      const { mode } = input;
      const env = readEnv(mode);
      const client = CircleWalletsSdk.initiateDeveloperControlledWalletsClient(clientParams(env));
      return executeSignedX402({
        executor: options.executeHttpRequest ?? executeBoundedHttpRequest,
        settlement: input,
        createPayload: async (signer, requirements) => {
          const created = await new BatchEvmScheme(signer).createPaymentPayload(2, requirements);
          return {
            ...created,
            payload: created.payload as unknown as Record<string, unknown>,
          };
        },
        signTypedData: async (payload) => {
          const response = await client.signTypedData({
            walletId: input.walletId,
            data: JSON.stringify(normalizeTypedDataForCircle(payload)),
            memo: 'agentOps Gateway x402 payment authorization',
          });
          const signature = response.data?.signature;
          if (signature === undefined || signature.length === 0) throw new Error('circle_signature_missing');
          return signature as `0x${string}`;
        },
      });
    },
  };
}

function agentWalletSetId(mode: ProviderMode, email: string | null): string {
  return `circle_agent_wallet:${mode}:${email ?? 'unknown'}`;
}

function agentWalletId(input: {
  readonly address: string;
  readonly chain: CirclePaymentChain;
  readonly mode: ProviderMode;
}): string {
  return `circle_agent_wallet:${input.mode}:${input.chain}:${input.address.toLowerCase()}`;
}

function parseAgentWalletId(walletId: string): {
  readonly address: string;
  readonly chain: CirclePaymentChain;
  readonly mode: ProviderMode;
} {
  const parts = walletId.split(':');
  const mode = parts[1];
  const chain = parts[2];
  const address = parts[3];
  if ((mode !== 'test' && mode !== 'live') || !isCirclePaymentChain(chain) || address === undefined || address.length === 0) {
    throw new Error('invalid_circle_agent_wallet_id');
  }
  return { address, chain, mode };
}

function isCirclePaymentChain(value: string | undefined): value is CirclePaymentChain {
  return value === 'base' || value === 'arbitrum' || value === 'polygon' || value === 'optimism' || value === 'avalanche';
}

function chainFromGatewayNetwork(network: string): CirclePaymentChain {
  const normalized = network.trim().toLowerCase();
  if (normalized === 'eip155:84532' || normalized === 'eip155:8453' || normalized.includes('base')) return 'base';
  if (normalized === 'eip155:421614' || normalized === 'eip155:42161' || normalized.includes('arb')) return 'arbitrum';
  if (normalized === 'eip155:80002' || normalized === 'eip155:137' || normalized.includes('matic') || normalized.includes('polygon')) {
    return 'polygon';
  }
  if (normalized === 'eip155:11155420' || normalized === 'eip155:10' || normalized.includes('op')) return 'optimism';
  if (normalized === 'eip155:43113' || normalized === 'eip155:43114' || normalized.includes('avax')) return 'avalanche';
  throw new Error('unsupported_circle_agent_wallet_payment_network');
}

function healthFromSession(mode: ProviderMode, executor: CircleAgentCliExecutor): CircleProviderHealth {
  void executor;
  return {
    configured: true,
    missing: [],
    mode,
    provider: 'circle',
  };
}

export function createCircleAgentWalletTreasuryProvider(options: {
  readonly executor?: CircleAgentCliExecutor | undefined;
  readonly executeHttpRequest?: X402HttpExecutor | undefined;
} = {}): CircleTreasuryProvider {
  const executor = options.executor ?? createCircleAgentCliExecutor();
  const executeHttpRequest = options.executeHttpRequest ?? executeBoundedHttpRequest;
  return {
    bridgeWalletTopUp: async ({ amount, fromAddress, fromChain, idempotencyKey, mode, toAddress, toChain }) => {
      try {
        const bridge = await executor.bridgeUsdc({
          amount,
          fromAddress,
          fromChain,
          idempotencyKey: idempotencyKey ?? randomUUID(),
          mode,
          toAddress,
          toChain,
        });
        return {
          amount,
          fromChain,
          providerMode: mode,
          success: bridge.transaction !== null,
          toChain,
          ...(bridge.transaction === null
            ? { errorReason: 'circle_agent_wallet_bridge_missing_transaction' }
            : { transaction: bridge.transaction }),
        };
      } catch (error) {
        return {
          amount,
          errorReason: error instanceof Error ? error.message : 'circle_agent_wallet_bridge_failed',
          fromChain,
          providerMode: mode,
          success: false,
          toChain,
        };
      }
    },
    health: (mode) => healthFromSession(mode, executor),
    createWalletSet: async ({ mode }) => {
      const status = await executor.status();
      const session = mode === 'test' ? status.test : status.live;
      if (session.tokenStatus !== 'VALID') {
        throw new Error(`circle_agent_wallet_${mode}_session_not_valid`);
      }
      return {
        circleWalletSetId: agentWalletSetId(mode, session.email),
      };
    },
    createWallet: async ({ chain, mode }) => {
      const wallet = await executor.listWallet({ chain, mode });
      return {
        address: wallet.address,
        circleWalletId: agentWalletId({ address: wallet.address, chain, mode }),
      };
    },
    getGatewayBalance: fetchGatewayBalanceFromApi,
    getWalletBalances: async ({ mode, walletId }) => {
      const parsed = parseAgentWalletId(walletId);
      const balances = await executor.walletBalance({
        address: parsed.address,
        chain: parsed.chain,
        mode,
      });
      return {
        balances,
        providerMode: mode,
      };
    },
    initiateGatewayDeposit: async ({ address, amountMicros, chain, mode }) => {
      const amount = formatMicros(amountMicros);
      const config = contractConfig(mode, chain);
      const amountAtomic = amountMicros.toString();
      const deposit = await executor.gatewayDepositDirect({
        address,
        amount,
        mode,
        sourceChain: chain,
      });
      const depositTransactionId = deposit.depositTransactionHash ?? deposit.transferTxHash;
      if (depositTransactionId === null) throw new Error('circle_gateway_deposit_transaction_missing');
      const approvalTransactionId = deposit.approvalTransactionHash ?? deposit.transferTxHash ?? depositTransactionId;

      return {
        amount,
        amountMicros: amountAtomic,
        approvalTransactionId,
        depositTransactionId,
        gatewayDepositorAddress: deposit.backingEOA ?? address,
        gatewayWalletAddress: deposit.gatewayWalletAddress ?? config.gatewayWallet,
        providerMode: mode,
        usdcAddress: config.usdc,
      };
    },
    requestTestnetFunds: async ({ address, chain, mode }) => {
      const response = await executor.fundTestnetUsdc({ address, chain, mode });
      return {
        address,
        chain,
        providerMode: mode,
        response,
      };
    },
    settleExactX402: async (input) => {
      const { mode, requirements, walletAddress } = input;
      const chain = chainFromGatewayNetwork(requirements.network);
      if (isCanonicalSettlementInput(input)) {
        return executeSignedX402({
          executor: executeHttpRequest,
          settlement: input,
          createPayload: (signer, normalizedRequirements) =>
            new ExactEvmScheme(signer).createPaymentPayload(2, normalizedRequirements),
          signTypedData: async (payload) => {
            if (executor.signTypedData === undefined) {
              throw new Error('circle_cli_typed_data_signing_unavailable');
            }
            const signed = await executor.signTypedData({
              address: walletAddress,
              attemptId: input.attemptId,
              chain,
              data: JSON.stringify(normalizeTypedDataForCircle(payload)),
              mode,
            });
            return signed.signature as `0x${string}`;
          },
        });
      }
      try {
        const payment = await executor.payService({
          address: walletAddress,
          chain,
          maxAmount: formatMicros(BigInt(requirements.amount)),
          mode,
          rail: 'exact',
          url: input.resource.url,
        });
        return agentWalletSettlementResult({
          mode,
          network: requirements.network,
          payer: walletAddress,
          payment,
        });
      } catch (error) {
        const result = agentWalletErrorResult({ error, mode, network: requirements.network });
        if (error instanceof CircleAgentCliPaidRequestError) {
          const debug = takeCircleAgentCliPaidRequestDebug(error);
          if (debug !== undefined) CIRCLE_PROVIDER_PAID_REQUEST_DEBUG.set(result, debug);
        }
        return result;
      }
    },
    settleGatewayX402: async (input) => {
      const { mode, requirements, walletAddress } = input;
      const chain = chainFromGatewayNetwork(requirements.network);
      if (isCanonicalSettlementInput(input)) {
        return executeSignedX402({
          executor: executeHttpRequest,
          settlement: input,
          createPayload: async (signer, normalizedRequirements) => {
            const created = await new BatchEvmScheme(signer).createPaymentPayload(2, normalizedRequirements);
            return {
              ...created,
              payload: created.payload as unknown as Record<string, unknown>,
            };
          },
          signTypedData: async (payload) => {
            if (executor.signTypedData === undefined) {
              throw new Error('circle_cli_typed_data_signing_unavailable');
            }
            const signed = await executor.signTypedData({
              address: walletAddress,
              attemptId: input.attemptId,
              chain,
              data: JSON.stringify(normalizeTypedDataForCircle(payload)),
              mode,
            });
            return signed.signature as `0x${string}`;
          },
        });
      }
      try {
        const payment = await executor.payService({
          address: walletAddress,
          chain,
          maxAmount: formatMicros(BigInt(requirements.amount)),
          mode,
          rail: 'gateway',
          url: input.resource.url,
        });
        return agentWalletSettlementResult({
          mode,
          network: requirements.network,
          payer: walletAddress,
          payment,
        });
      } catch (error) {
        const result = agentWalletErrorResult({ error, mode, network: requirements.network });
        if (error instanceof CircleAgentCliPaidRequestError) {
          const debug = takeCircleAgentCliPaidRequestDebug(error);
          if (debug !== undefined) CIRCLE_PROVIDER_PAID_REQUEST_DEBUG.set(result, debug);
        }
        return result;
      }
    },
  };
}

export function createCircleTreasuryProvider(): CircleTreasuryProvider {
  return process.env.CIRCLE_TREASURY_PROVIDER === 'developer_controlled'
    ? createDeveloperControlledCircleTreasuryProvider()
    : createCircleAgentWalletTreasuryProvider();
}
