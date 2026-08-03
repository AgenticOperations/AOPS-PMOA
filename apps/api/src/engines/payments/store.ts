import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { PaymentPayload } from '@x402/core/types';
import { enqueueAgentWalletProvisioning, findAgentWallet, nativeBalanceMicros, readSpendableMicros } from './agent-wallets.js';
import { readCachedBalances, writeCachedBalances } from './balances-cache.js';
import { gatewayDepositSatisfied, resolveGatewayDepositorAddress } from './circle-liquidity-worker.js';
import { sha256Hex } from '../evidence/canonical-json.js';
import { recordAuditEvent } from '../evidence/audit-writer.js';
import { approvalContextHash, consumeApproval, createApprovalRequest, getApproval, recordActivity } from '../approvals/store.js';
import { badRequest, conflict, IdentityError, notFound } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import { completeProductOnboardingFlow } from '../identity/onboarding-progress.js';
import type { ConnectionAuthResult } from '../identity/store.js';
import type { OperatorContext } from '../identity/types.js';
import { checkPolicyDecision } from '../policy/store.js';
import type { PolicyDecisionRequest } from '../policy/types.js';
import type {
  AgentPaymentAccountRecord,
  CircleChainBalanceRecord,
  CircleChainCapabilityRecord,
  CircleChainWalletRecord,
  CircleProviderJobRecord,
  CircleWalletSetRecord,
  CreatePaymentSourceInput,
  CreateTreasuryInput,
  OrgPaymentModeRecord,
  PaymentChain,
  PaymentEventRecord,
  PaymentMode,
  PaymentRail,
  PaymentRailReadinessRecord,
  PaymentReservationRecord,
  PaymentRouteObservationRecord,
  PaymentSourceRecord,
  RebalanceRecommendationRecord,
  RuntimeX402Accept,
  RuntimePaidHttpX402Input,
  RuntimeX402PaymentInput,
  RuntimeX402PaymentRecord,
  RuntimeX402PaymentResult,
  SetAgentPaymentAccessInput,
  TreasuryOverviewRecord,
  TreasuryRecord,
} from './types.js';
import {
  capabilitiesForMode,
  circleRailForChain,
  createCircleTreasuryProvider,
  takeCircleProviderPaidRequestDebug,
  type CircleGatewayX402SettlementResult,
  type CircleGatewayX402Requirements,
  type CircleTokenBalance,
  type CircleTreasuryProvider,
} from './circle-provider.js';
import {
  assertPaidHttpUrlAllowed,
  canonicalPaidHttpRequestHash,
  executeBoundedHttpRequest,
  normalizePaidHttpRequest,
  paymentRequiredFromResponse,
  type PaidHttpExecutionOptions,
  type PaidHttpExecutor,
  type PaidHttpResponse,
  type PaidHttpUrlPolicy,
  type ValidatedPaidHttpDestination,
} from './x402-http.js';
import {
  createPostgresX402AttemptStore,
  type X402AttemptRecord,
} from './x402-attempt-store.js';
import type { X402ResultCryptoCodec } from './x402-result-crypto.js';

type Db = pg.Pool | pg.PoolClient;

const CIRCLE_GATEWAY_MIN_DEPOSIT_MICROS = 500_000n;
const EXACT_WALLET_REBALANCE_MIN_MICROS = 50_000n;
const EXACT_WALLET_REBALANCE_FEE_BUFFER_MICROS = 10_000n;
const RAIL_VERIFY_EXACT_AMOUNT_MICROS = 10_000n;
const RAIL_VERIFY_GATEWAY_AMOUNT_MICROS = 1_000n;
const TESTNET_X402_PROOF_PAY_TO = '0x000000000000000000000000000000000000dEaD';
const DEFAULT_CIRCLE_PROVIDER_JOB_TIMEOUT_MS = 240_000;
const PAYMENT_RAILS: readonly PaymentRail[] = [
  'gateway_base',
  'gateway_arbitrum',
  'gateway_polygon',
  'gateway_optimism',
  'gateway_avalanche',
  'exact_base',
  'exact_arbitrum',
  'exact_polygon',
  'exact_optimism',
  'exact_avalanche',
];

function circleProviderJobTimeoutMs(): number {
  const configured = Number(process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS ?? process.env.CIRCLE_CLI_TIMEOUT_MS ?? '');
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return DEFAULT_CIRCLE_PROVIDER_JOB_TIMEOUT_MS;
}

async function withCircleProviderTimeout<T>(
  operation: Promise<T>,
  timeoutCode: string,
  timeoutMs = circleProviderJobTimeoutMs(),
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${timeoutCode}:${timeoutMs}`)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function circleProviderErrorCode(fallback: string, message: string | null | undefined): string {
  if (message === undefined || message === null || message.trim().length === 0) return fallback;
  if (message.includes('provider_timeout') || message.includes('circle_cli_process_timeout')) return 'circle_provider_job_timeout';
  if (message.startsWith('Command failed: circle ')) return 'circle_cli_command_failed';
  if (message.includes('fetch failed')) return 'circle_provider_fetch_failed';
  return fallback;
}

function circleProviderStatusForResult(
  success: boolean,
  errorReason: string | null | undefined,
): CircleProviderJobRecord['status'] {
  if (success) return 'complete';
  const code = circleProviderErrorCode('circle_provider_failed', errorReason);
  return code === 'circle_provider_job_timeout' ? 'submitted' : 'failed';
}
const LIQUIDITY_PREP_RETRY_AFTER_SECONDS = 30;

type TreasuryRow = {
  readonly id: string;
  readonly org_id: string;
  readonly treasury_type: 'gateway';
  readonly provider: 'circle_gateway' | 'simulation';
  readonly chain: PaymentChain;
  readonly label: string;
  readonly status: 'active' | 'disabled';
  readonly metadata: unknown;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type PaymentSourceRow = {
  readonly id: string;
  readonly org_id: string;
  readonly treasury_id: string | null;
  readonly source_type: PaymentSourceRecord['source_type'];
  readonly provider: PaymentSourceRecord['provider'];
  readonly rail: PaymentRail;
  readonly chain: PaymentChain;
  readonly label: string;
  readonly status: 'active' | 'disabled';
  readonly account_type: PaymentSourceRecord['account_type'];
  readonly address: string | null;
  readonly external_wallet_id: string | null;
  readonly simulated_balance_usdc: string;
  readonly metadata: unknown;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type AgentPaymentAccountRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly status: 'active' | 'disabled';
  readonly payment_access: boolean;
  readonly budget_usdc: string;
  readonly spent_usdc: string;
  readonly reserved_usdc: string;
  readonly per_request_cap_usdc: string;
  readonly approval_threshold_usdc: string | null;
  readonly dedicated_wallet_required: boolean;
  readonly allowed_rails: PaymentRail[];
  readonly created_at: Date;
  readonly updated_at: Date;
};

type PaymentEventRow = {
  readonly id: string;
  readonly org_id: string;
  readonly decision: 'submitted' | 'settled' | 'failed' | 'simulated';
  readonly provider_mode: 'simulation' | 'test' | 'live';
  readonly rail: PaymentRail;
  readonly chain: PaymentChain;
  readonly amount_usdc: string;
  readonly asset: string;
  readonly agent_id: string;
  readonly connection_id: string | null;
  readonly source_id: string | null;
  readonly reservation_id: string | null;
  readonly recipient: string;
  readonly network: string;
  readonly resource_url: string | null;
  readonly resource_category: string | null;
  readonly quote: unknown;
  readonly result: unknown;
  readonly activity_id: string | null;
  readonly created_at: Date;
};

type PaymentRouteObservationRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly connection_id: string | null;
  readonly requested_network: string | null;
  readonly requested_asset: string | null;
  readonly requested_rail: string | null;
  readonly supported_rail: PaymentRail | null;
  readonly amount_usdc: string | null;
  readonly outcome: 'accepted' | 'rejected';
  readonly reason_code: string;
  readonly resource_url: string | null;
  readonly resource_category: string | null;
  readonly observed_at: Date;
};

type PaymentReservationRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly connection_id: string | null;
  readonly source_id: string;
  readonly amount_usdc: string;
  readonly asset: string;
  readonly rail: PaymentRail;
  readonly status: 'reserved' | 'settled' | 'released' | 'failed';
  readonly reason_code: string;
  readonly quote_hash: string;
  readonly quote: unknown;
  readonly expires_at: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type OrgPaymentModeRow = {
  readonly mode: PaymentMode;
  readonly org_id: string;
  readonly updated_at: Date;
  readonly updated_by: string;
};

type CircleChainCapabilityRow = {
  readonly chain: PaymentChain;
  readonly circle_blockchain: string;
  readonly exact_settlement_verified: boolean;
  readonly gateway_domain: number;
  readonly gateway_settlement_verified: boolean;
  readonly gateway_supported: boolean;
  readonly id: string;
  readonly metadata: unknown;
  readonly mode: PaymentMode;
  readonly nanopayments_supported: boolean;
  readonly status: 'active' | 'disabled';
  readonly wallet_account_type: 'eoa' | 'sca';
  readonly wallet_supported: boolean;
};

type CircleWalletSetRow = {
  readonly account_type: 'eoa' | 'sca';
  readonly circle_wallet_set_id: string;
  readonly created_at: Date;
  readonly id: string;
  readonly label: string;
  readonly metadata: unknown;
  readonly mode: PaymentMode;
  readonly org_id: string;
  readonly provider: 'circle_wallets';
  readonly status: 'active' | 'disabled';
  readonly updated_at: Date;
};

type CircleChainWalletRow = {
  readonly account_type: 'eoa' | 'sca';
  readonly address: string;
  readonly chain: PaymentChain;
  readonly circle_blockchain: string;
  readonly circle_wallet_id: string;
  readonly created_at: Date;
  readonly id: string;
  readonly metadata: unknown;
  readonly mode: PaymentMode;
  readonly org_id: string;
  readonly status: 'active' | 'disabled';
  readonly updated_at: Date;
  readonly wallet_set_id: string;
};

type CircleProviderJobRow = {
  readonly amount_usdc: string | null;
  readonly chain: PaymentChain | null;
  readonly created_at: Date;
  readonly error_code: string | null;
  readonly id: string;
  readonly job_type: CircleProviderJobRecord['job_type'];
  readonly metadata: unknown;
  readonly mode: PaymentMode;
  readonly org_id: string;
  readonly provider_ref: string | null;
  readonly status: CircleProviderJobRecord['status'];
  readonly updated_at: Date;
};

type RuntimeQuote = {
  readonly accept: RuntimeX402Accept;
  readonly amount: string;
  readonly amountMicros: bigint;
  readonly asset: 'USDC';
  readonly chain: PaymentChain;
  readonly network: PaymentChain;
  readonly rail: PaymentRail;
  readonly recipient: string;
  readonly settlementKind: 'direct_exact' | 'gateway';
  readonly x402Amount: string;
  readonly x402Network: string;
  readonly x402Requirements: CircleGatewayX402Requirements;
};

export class PaymentApprovalRequiredError extends IdentityError {
  constructor(
    readonly decisionId: string,
    readonly approvalId: string,
    message: string,
  ) {
    super('policy_requires_approval', 409, message);
  }
}

export class PaymentLiquidityPreparingError extends IdentityError {
  constructor(
    readonly jobId: string,
    readonly rail: PaymentRail,
    readonly chain: PaymentChain,
    readonly retryAfterSeconds: number,
    message: string,
  ) {
    super('liquidity_preparing', 409, message);
  }
}

type RuntimePaymentFulfillment = NonNullable<RuntimeX402PaymentRecord['fulfillment']>;

function objectFromJson(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function parseUsdcMicros(value: string | number): bigint {
  const raw = typeof value === 'number' ? value.toString() : value.trim();
  const match = /^(\d+)(?:\.(\d{1,6})?)?$/.exec(raw);
  if (match === null) throw badRequest('invalid_usdc_amount', 'USDC amount must be a positive decimal with up to 6 places.');
  const whole = BigInt(match[1] ?? '0') * 1_000_000n;
  const decimals = (match[2] ?? '').padEnd(6, '0');
  return whole + BigInt(decimals.length === 0 ? '0' : decimals);
}

function assertPositiveUsdc(value: string | number, field: string): string {
  const micros = parseUsdcMicros(value);
  if (micros <= 0n) throw badRequest('invalid_usdc_amount', `${field} must be greater than 0 USDC.`);
  return formatUsdc(micros);
}

function assertNonNegativeUsdc(value: string | number, field: string): string {
  const micros = parseUsdcMicros(value);
  if (micros < 0n) throw badRequest('invalid_usdc_amount', `${field} cannot be negative.`);
  return formatUsdc(micros);
}

function formatUsdc(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const decimal = (micros % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  const normalized = decimal.length === 0 ? '00' : decimal.padEnd(2, '0');
  return `${whole.toString()}.${normalized}`;
}

function formatDbUsdc(value: string): string {
  return formatUsdc(parseUsdcMicros(value));
}

function treasuryFromRow(row: TreasuryRow): TreasuryRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    treasury_type: row.treasury_type,
    provider: row.provider,
    chain: row.chain,
    label: row.label,
    status: row.status,
    metadata: objectFromJson(row.metadata),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function sourceFromRow(row: PaymentSourceRow): PaymentSourceRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    treasury_id: row.treasury_id,
    source_type: row.source_type,
    provider: row.provider,
    rail: row.rail,
    chain: row.chain,
    label: row.label,
    status: row.status,
    account_type: row.account_type,
    address: row.address,
    external_wallet_id: row.external_wallet_id,
    simulated_balance_usdc: formatDbUsdc(row.simulated_balance_usdc),
    metadata: objectFromJson(row.metadata),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function accountFromRow(row: AgentPaymentAccountRow): AgentPaymentAccountRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    status: row.status,
    payment_access: row.payment_access,
    budget_usdc: formatDbUsdc(row.budget_usdc),
    spent_usdc: formatDbUsdc(row.spent_usdc),
    reserved_usdc: formatDbUsdc(row.reserved_usdc),
    per_request_cap_usdc: formatDbUsdc(row.per_request_cap_usdc),
    approval_threshold_usdc: row.approval_threshold_usdc === null ? null : formatDbUsdc(row.approval_threshold_usdc),
    dedicated_wallet_required: row.dedicated_wallet_required,
    allowed_rails: row.allowed_rails,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function modeFromRow(row: OrgPaymentModeRow): OrgPaymentModeRecord {
  return {
    mode: row.mode,
    org_id: row.org_id,
    updated_at: row.updated_at.toISOString(),
    updated_by: row.updated_by,
  };
}

function capabilityFromRow(row: CircleChainCapabilityRow): CircleChainCapabilityRecord {
  const metadata = objectFromJson(row.metadata);
  return {
    chain: row.chain,
    circle_blockchain: row.circle_blockchain,
    exact_settlement_verified: row.exact_settlement_verified,
    gateway_domain: row.gateway_domain,
    gateway_settlement_verified: row.gateway_settlement_verified,
    gateway_supported: row.gateway_supported,
    id: row.id,
    mode: row.mode,
    nanopayments_supported: row.nanopayments_supported,
    network_label: stringValue(metadata.network),
    status: row.status,
    wallet_account_type: row.wallet_account_type,
    wallet_supported: row.wallet_supported,
  };
}

function walletSetFromRow(row: CircleWalletSetRow): CircleWalletSetRecord {
  return {
    account_type: row.account_type,
    circle_wallet_set_id: row.circle_wallet_set_id,
    created_at: row.created_at.toISOString(),
    id: row.id,
    label: row.label,
    metadata: objectFromJson(row.metadata),
    mode: row.mode,
    org_id: row.org_id,
    provider: row.provider,
    status: row.status,
    updated_at: row.updated_at.toISOString(),
  };
}

function chainWalletFromRow(row: CircleChainWalletRow): CircleChainWalletRecord {
  return {
    account_type: row.account_type,
    address: row.address,
    chain: row.chain,
    circle_blockchain: row.circle_blockchain,
    circle_wallet_id: row.circle_wallet_id,
    created_at: row.created_at.toISOString(),
    id: row.id,
    metadata: objectFromJson(row.metadata),
    mode: row.mode,
    org_id: row.org_id,
    status: row.status,
    updated_at: row.updated_at.toISOString(),
    wallet_set_id: row.wallet_set_id,
  };
}

function providerJobFromRow(row: CircleProviderJobRow): CircleProviderJobRecord {
  return {
    amount_usdc: row.amount_usdc === null ? null : formatDbUsdc(row.amount_usdc),
    chain: row.chain,
    created_at: row.created_at.toISOString(),
    error_code: row.error_code === null ? null : circleProviderErrorCode(row.error_code, row.error_code),
    id: row.id,
    job_type: row.job_type,
    metadata: objectFromJson(row.metadata),
    mode: row.mode,
    org_id: row.org_id,
    provider_ref: row.provider_ref,
    status: row.status,
    updated_at: row.updated_at.toISOString(),
  };
}

function tokenBalanceRecord(balance: CircleTokenBalance) {
  return {
    amount: balance.amount,
    blockchain: balance.blockchain,
    is_native: balance.isNative,
    symbol: balance.symbol,
    token_address: balance.tokenAddress,
  };
}

async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function assertOrgAgent(db: Db, orgId: string, agentId: string): Promise<void> {
  const result = await db.query('SELECT 1 FROM agents WHERE org_id = $1 AND id = $2', [orgId, agentId]);
  if (result.rowCount === 0) throw notFound('Agent was not found.');
}

async function activeGatewayTreasuryId(db: Db, orgId: string, chain: PaymentChain): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM org_treasuries
      WHERE org_id = $1
        AND chain = $2
        AND treasury_type = 'gateway'
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, chain],
  );
  return result.rows[0]?.id ?? null;
}

async function recordRouteObservation(
  db: Db,
  input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly connectionId: string;
    readonly requestedNetwork: string | null;
    readonly requestedAsset: string | null;
    readonly requestedRail: string | null;
    readonly supportedRail: string | null;
    readonly amount: string | null;
    readonly outcome: 'accepted' | 'rejected';
    readonly reasonCode: string;
    readonly resourceUrl: string | null;
    readonly resourceCategory: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO payment_route_observations (
       id, org_id, agent_id, connection_id,
       requested_network, requested_asset, requested_rail, supported_rail,
       amount_usdc, outcome, reason_code, resource_url, resource_category
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10, $11, $12, $13)`,
    [
      prefixedId('payobs'),
      input.orgId,
      input.agentId,
      input.connectionId,
      input.requestedNetwork,
      input.requestedAsset,
      input.requestedRail,
      input.supportedRail,
      input.amount,
      input.outcome,
      input.reasonCode,
      input.resourceUrl,
      input.resourceCategory,
    ],
  );
}

function normalizeRail(input: string): PaymentRail {
  if (
    input === 'gateway_base' ||
    input === 'gateway_arbitrum' ||
    input === 'gateway_polygon' ||
    input === 'gateway_optimism' ||
    input === 'gateway_avalanche' ||
    input === 'gateway_arc' ||
    input === 'exact_base' ||
    input === 'exact_arbitrum' ||
    input === 'exact_polygon' ||
    input === 'exact_optimism' ||
    input === 'exact_avalanche' ||
    input === 'exact_arc'
  ) {
    return input;
  }
  throw badRequest('unsupported_payment_rail', 'Payment rail is not supported.');
}

function normalizeChain(input: string): PaymentChain {
  if (
    input === 'base' ||
    input === 'arbitrum' ||
    input === 'polygon' ||
    input === 'optimism' ||
    input === 'avalanche' ||
    input === 'arc'
  ) {
    return input;
  }
  throw badRequest('unsupported_payment_chain', 'Section 9 supports Base, Arbitrum, Polygon, Optimism, Avalanche, and Arc.');
}

function railKind(rail: PaymentRail): 'direct_exact' | 'gateway' {
  return rail.startsWith('gateway_') ? 'gateway' : 'direct_exact';
}

function x402Resource(input: RuntimeX402PaymentInput): {
  readonly url: string | null;
  readonly category: string | null;
  readonly domain: string | null;
} {
  const resource = input.resource ?? {};
  const url = stringValue(resource.url);
  return {
    url,
    category: stringValue(resource.category),
    domain: domainFromUrl(url) ?? stringValue(resource.domain),
  };
}

function x402ProviderResource(
  input: RuntimeX402PaymentInput,
): NonNullable<PaymentPayload['resource']> {
  const resource = input.resource ?? {};
  const url = stringValue(resource.url);
  if (url === null) {
    throw conflict(
      'payment_attempt_state_conflict',
      'The x402 payment quote is missing its resource URL.',
    );
  }
  const description = stringValue(resource.description);
  const mimeType = stringValue(resource.mimeType);
  const serviceName = stringValue(resource.serviceName);
  const iconUrl = stringValue(resource.iconUrl);
  const tags = Array.isArray(resource.tags) && resource.tags.every((tag) => typeof tag === 'string')
    ? resource.tags
    : undefined;
  return {
    url,
    ...(description === null ? {} : { description }),
    ...(mimeType === null ? {} : { mimeType }),
    ...(serviceName === null ? {} : { serviceName }),
    ...(tags === undefined ? {} : { tags }),
    ...(iconUrl === null ? {} : { iconUrl }),
  };
}

function domainFromUrl(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function gatewayMarker(accept: RuntimeX402Accept): boolean {
  const extra = accept.extra ?? {};
  return (
    stringValue(extra.name) === 'GatewayWalletBatched' ||
    stringValue(extra.paymentMethod) === 'circle_gateway' ||
    extra.gateway === true
  );
}

const TEST_GATEWAY_NETWORKS: Record<PaymentChain, string> = {
  arbitrum: 'eip155:421614',
  avalanche: 'eip155:43113',
  base: 'eip155:84532',
  optimism: 'eip155:11155420',
  polygon: 'eip155:80002',
  // Verified live against both Arc's RPC (eth_chainId) and Circle's own
  // x402 facilitator /v1/x402/supported (spike S1, docs/spike-results.md).
  arc: 'eip155:5042002',
};

const LIVE_GATEWAY_NETWORKS: Record<PaymentChain, string> = {
  arbitrum: 'eip155:42161',
  avalanche: 'eip155:43114',
  base: 'eip155:8453',
  optimism: 'eip155:10',
  polygon: 'eip155:137',
  // Unreachable placeholder. Constraint I.1: Arc mainnet does not exist.
  // gatewayNetworkForMode() throws before this entry is ever read.
  arc: 'eip155:0',
};

const TEST_GATEWAY_USDC: Record<PaymentChain, string> = {
  arbitrum: '0x75faf114eafb1bdbe2f0316DF893fd58CE46AA4d',
  avalanche: '0x5425890298aed601595a70AB815c96711a31Bc65',
  base: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  optimism: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
  polygon: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
  // Precompile-shaped address: on Arc, USDC IS the native gas asset.
  // Confirmed via spike S1/S6.
  arc: '0x3600000000000000000000000000000000000000',
};

const LIVE_GATEWAY_USDC: Record<PaymentChain, string> = {
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  avalanche: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  polygon: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  // Unreachable placeholder -- see LIVE_GATEWAY_NETWORKS.arc.
  arc: '0x0000000000000000000000000000000000000000',
};

function networkToChain(network: string): PaymentChain | null {
  const normalized = network.trim().toLowerCase();
  if (normalized === 'base' || normalized === 'base-sepolia' || normalized === 'eip155:84532' || normalized === 'eip155:8453') {
    return 'base';
  }
  if (
    normalized === 'arbitrum' ||
    normalized === 'arbitrum-sepolia' ||
    normalized === 'arb-sepolia' ||
    normalized === 'eip155:421614' ||
    normalized === 'eip155:42161'
  ) {
    return 'arbitrum';
  }
  if (
    normalized === 'polygon' ||
    normalized === 'polygon-amoy' ||
    normalized === 'matic-amoy' ||
    normalized === 'eip155:80002' ||
    normalized === 'eip155:137'
  ) {
    return 'polygon';
  }
  if (
    normalized === 'optimism' ||
    normalized === 'op-sepolia' ||
    normalized === 'eip155:11155420' ||
    normalized === 'eip155:10'
  ) {
    return 'optimism';
  }
  if (
    normalized === 'avalanche' ||
    normalized === 'avalanche-fuji' ||
    normalized === 'avax-fuji' ||
    normalized === 'eip155:43113' ||
    normalized === 'eip155:43114'
  ) {
    return 'avalanche';
  }
  // Constraint I.1: Arc mainnet does not exist, so there is no live
  // CAIP-2 id to recognize here -- only the testnet one.
  if (normalized === 'arc' || normalized === 'arc-testnet' || normalized === 'eip155:5042002') {
    return 'arc';
  }
  return null;
}

function assertNotLiveArc(chain: PaymentChain, mode: PaymentMode): void {
  // Constraint I.1: Arc mainnet does not exist. Fail loudly rather than
  // resolve the LIVE_GATEWAY_* placeholder values.
  if (chain === 'arc' && mode === 'live') {
    throw badRequest('arc_mainnet_not_supported', 'Arc mainnet is not supported.');
  }
}

function gatewayNetworkForMode(chain: PaymentChain, mode: PaymentMode): string {
  assertNotLiveArc(chain, mode);
  return mode === 'test' ? TEST_GATEWAY_NETWORKS[chain] : LIVE_GATEWAY_NETWORKS[chain];
}

function gatewayUsdcForMode(chain: PaymentChain, mode: PaymentMode): string {
  assertNotLiveArc(chain, mode);
  return mode === 'test' ? TEST_GATEWAY_USDC[chain] : LIVE_GATEWAY_USDC[chain];
}

function networkMatchesMode(network: string, chain: PaymentChain, mode: PaymentMode): boolean {
  const normalized = network.trim().toLowerCase();
  const expected = gatewayNetworkForMode(chain, mode).toLowerCase();
  if (normalized.startsWith('eip155:')) return normalized === expected;
  if (normalized === chain) return true;
  if (mode === 'live') return false;
  const testAliases: Record<PaymentChain, readonly string[]> = {
    arbitrum: ['arbitrum-sepolia', 'arb-sepolia'],
    avalanche: ['avalanche-fuji', 'avax-fuji'],
    base: ['base-sepolia'],
    optimism: ['op-sepolia'],
    polygon: ['polygon-amoy', 'matic-amoy'],
    arc: ['arc-testnet'],
  };
  return testAliases[chain].includes(normalized);
}

function canonicalUsdcAsset(asset: string | null, chain: PaymentChain, mode: PaymentMode): string | null {
  const expected = gatewayUsdcForMode(chain, mode);
  if (asset === null || asset.toLowerCase() === 'usdc') return expected;
  return asset.toLowerCase() === expected.toLowerCase() ? expected : null;
}

function gatewayRailForChain(chain: PaymentChain): PaymentRail {
  return normalizeRail(`gateway_${chain}`);
}

function exactRailForChain(chain: PaymentChain): PaymentRail {
  return normalizeRail(`exact_${chain}`);
}

function chainFromRail(rail: PaymentRail): PaymentChain {
  return normalizeChain(rail.replace(/^gateway_/, '').replace(/^exact_/, ''));
}

function publicApiBaseUrl(): string {
  return process.env.PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ?? 'http://localhost:8080';
}

function testnetX402ResourcePath(chain: PaymentChain, kind: 'direct_exact' | 'gateway'): string {
  if (chain === 'base') return `/v1/testnet/x402/${kind === 'gateway' ? 'gateway-weather' : 'weather'}`;
  return `/v1/testnet/x402/${chain}/${kind === 'gateway' ? 'gateway-weather' : 'weather'}`;
}

function testnetX402ResourceUrl(chain: PaymentChain, kind: 'direct_exact' | 'gateway'): string {
  return `${publicApiBaseUrl()}${testnetX402ResourcePath(chain, kind)}`;
}

function x402AtomicNetwork(network: string): boolean {
  const normalized = network.trim().toLowerCase();
  return normalized.startsWith('eip155:') || normalized.includes('-sepolia') || normalized.includes('-amoy') || normalized.includes('-fuji');
}

function atomicAmountToMicros(value: string | number, field: string): bigint {
  const raw = typeof value === 'number' ? value.toString() : value.trim();
  if (!/^\d+$/.test(raw)) throw badRequest('invalid_x402_amount', `${field} must be an integer atomic USDC amount.`);
  const micros = BigInt(raw);
  if (micros <= 0n) throw badRequest('invalid_x402_amount', `${field} must be greater than zero.`);
  return micros;
}

export function x402UsdcMicrosFromAccept(accept: RuntimeX402Accept): bigint {
  if (accept.maxAmountRequired !== undefined) return atomicAmountToMicros(accept.maxAmountRequired, 'maxAmountRequired');
  const amount = accept.amount;
  if (amount === undefined) throw badRequest('payment_amount_required', 'x402 accept entry must include amount.');
  const raw = typeof amount === 'number' ? amount.toString() : amount.trim();
  if (!raw.includes('.') && x402AtomicNetwork(accept.network)) return atomicAmountToMicros(raw, 'amount');
  const micros = parseUsdcMicros(raw);
  if (micros <= 0n) throw badRequest('invalid_usdc_amount', 'Payment amount must be greater than zero.');
  return micros;
}

function normalizedPaymentNetwork(accept: RuntimeX402Accept, chain: PaymentChain, mode: PaymentMode): string {
  const normalized = accept.network.trim().toLowerCase();
  return normalized.startsWith('eip155:') ? accept.network : gatewayNetworkForMode(chain, mode);
}

function exactExtra(accept: RuntimeX402Accept): Record<string, unknown> {
  return {
    name: 'USDC',
    version: '2',
    ...(accept.extra ?? {}),
  };
}

function quoteFromAccept(accept: RuntimeX402Accept, mode: PaymentMode): RuntimeQuote | null {
  if (accept.scheme !== 'exact') return null;
  const chain = networkToChain(accept.network);
  if (chain === null) return null;
  // Constraint I.1: Arc mainnet does not exist. Treat a live-mode Arc offer
  // as "no match" here -- quoteFromAccept must stay total (never throw) so
  // one unsupported offer among several accepts doesn't abort quote
  // selection for the others. assertNotLiveArc()'s throw still guards the
  // internal wallet/treasury provisioning paths that call
  // gatewayNetworkForMode/gatewayUsdcForMode directly.
  if (chain === 'arc' && mode === 'live') return null;
  if (!networkMatchesMode(accept.network, chain, mode)) return null;
  const assetAddress = canonicalUsdcAsset(stringValue(accept.asset), chain, mode);
  if (assetAddress === null) return null;
  const amountMicros = x402UsdcMicrosFromAccept(accept);
  const recipient = stringValue(accept.payTo);
  if (recipient === null) return null;
  const settlementKind = gatewayMarker(accept) ? 'gateway' : 'direct_exact';
  const x402Network = settlementKind === 'gateway' ? gatewayNetworkForMode(chain, mode) : normalizedPaymentNetwork(accept, chain, mode);
  const rail = settlementKind === 'gateway' ? gatewayRailForChain(chain) : exactRailForChain(chain);
  return {
    accept,
    amount: formatUsdc(amountMicros),
    amountMicros,
    asset: 'USDC',
    chain,
    network: chain,
    rail,
    recipient,
    settlementKind,
    x402Amount: amountMicros.toString(),
    x402Network,
    x402Requirements: {
      amount: amountMicros.toString(),
      asset: assetAddress,
      extra:
        settlementKind === 'gateway'
          ? {
              ...accept.extra,
              name: 'GatewayWalletBatched',
              verifyingContract:
                stringValue(accept.extra?.verifyingContract) ??
                (mode === 'test'
                  ? '0x0077777d7EBA4688BDeF3E311b846F25870A19B9'
                  : '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE'),
              version: '1',
            }
          : exactExtra(accept),
      maxTimeoutSeconds: Number(accept.extra?.maxTimeoutSeconds ?? 604800),
      network: x402Network,
      payTo: recipient,
      scheme: 'exact',
    },
  };
}

function supportedRuntimeQuotes(input: RuntimeX402PaymentInput, mode: PaymentMode): RuntimeQuote[] {
  const quotes: RuntimeQuote[] = [];
  for (const accept of input.accepts) {
    const quote = quoteFromAccept(accept, mode);
    if (quote !== null) quotes.push(quote);
  }
  return quotes;
}

function selectRuntimeQuote(input: RuntimeX402PaymentInput, mode: PaymentMode, allowedRails: readonly PaymentRail[]): RuntimeQuote | null {
  return supportedRuntimeQuotes(input, mode).find((quote) => allowedRails.includes(quote.rail)) ?? null;
}

export function selectRuntimeQuoteForTest(
  input: RuntimeX402PaymentInput,
  mode: PaymentMode,
  allowedRails: readonly PaymentRail[],
): RuntimeQuote | null {
  return selectRuntimeQuote(input, mode, allowedRails);
}

function x402PolicyContext(input: {
  readonly paymentInput: RuntimeX402PaymentInput;
  readonly quote: RuntimeQuote;
  readonly resource: ReturnType<typeof x402Resource>;
}): Record<string, unknown> {
  return {
    payment: {
      amount: input.quote.amount,
      asset: input.quote.asset,
      network: input.quote.network,
      rail: input.quote.rail,
      recipient: input.quote.recipient,
    },
    request: requestContextForPolicy(input.paymentInput.context),
    resource: {
      category: input.resource.category,
      domain: input.resource.domain,
      url: input.resource.url,
    },
  };
}

function requestContextForPolicy(context: Record<string, unknown> | undefined): Record<string, unknown> {
  const request = { ...(context ?? {}) };
  delete request.approval_id;
  delete request.approvalId;
  delete request.decision_id;
  delete request.decisionId;
  return request;
}

function approvalProofFromContext(context: Record<string, unknown> | undefined): {
  readonly approvalId: string | null;
  readonly decisionId: string | null;
} {
  const approvalId = stringValue(context?.approval_id) ?? stringValue(context?.approvalId);
  const decisionId = stringValue(context?.decision_id) ?? stringValue(context?.decisionId);
  return { approvalId, decisionId };
}

async function enforceX402Policy(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  input: RuntimeX402PaymentInput,
  quote: RuntimeQuote,
  resource: ReturnType<typeof x402Resource>,
  accountApprovalThresholdMicros: bigint | null,
): Promise<{ readonly approvalId: string | null; readonly decisionId: string }> {
  const target: PolicyDecisionRequest['target'] = { type: 'agent', id: auth.agent_id };
  const thresholdRequiresApproval = accountApprovalThresholdMicros !== null && quote.amountMicros >= accountApprovalThresholdMicros;
  const context = {
    ...x402PolicyContext({ paymentInput: input, quote, resource }),
    ...(thresholdRequiresApproval
      ? {
          control: {
            approval_threshold_usdc: formatUsdc(accountApprovalThresholdMicros),
            source: 'agent_payment_account',
          },
        }
      : {}),
  };
  const decision = await checkPolicyDecision(
    pool,
    { actorId: auth.connection_id, role: 'member', orgId: auth.org_id },
    auth.org_id,
    {
      actor: { type: 'connection', id: auth.connection_id },
      action: 'payment.x402.authorize',
      target,
      context,
    },
  );

  if (decision.decision === 'deny') {
    throw new IdentityError(decision.reasonCode, 403, decision.explanation);
  }

  const requiresApproval = decision.decision === 'approval_required' || thresholdRequiresApproval;
  if (!requiresApproval) return { approvalId: null, decisionId: decision.id };

  const proof = approvalProofFromContext(input.context);
  if (proof.approvalId !== null && proof.decisionId !== null) {
    const approval = await getApproval(pool, auth.org_id, proof.approvalId);
    const expectedHash = approvalContextHash({
      action: 'payment.x402.authorize',
      target,
      context,
    });
    if (approval.context_hash !== expectedHash) {
      throw badRequest('approval_context_mismatch', 'Approval does not match this x402 payment request.');
    }
    const consumed = await consumeApproval(pool, auth, proof.approvalId, proof.decisionId);
    return { approvalId: consumed.id, decisionId: decision.id };
  }

  const approval = await createApprovalRequest(pool, {
    orgId: auth.org_id,
    agentId: auth.agent_id,
    connectionId: auth.connection_id,
    decisionId: decision.id,
    action: 'payment.x402.authorize',
    target,
    context,
  });
  throw new PaymentApprovalRequiredError(
    decision.id,
    approval.id,
    thresholdRequiresApproval && decision.decision !== 'approval_required'
      ? `Payment amount is at or above the agent approval threshold of ${formatUsdc(accountApprovalThresholdMicros)} USDC.`
      : decision.explanation,
  );
}

function paymentEventRecordFromRow(row: PaymentEventRow): PaymentEventRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    connection_id: row.connection_id,
    source_id: row.source_id,
    reservation_id: row.reservation_id,
    decision: row.decision,
    provider_mode: row.provider_mode,
    rail: row.rail,
    chain: row.chain,
    amount_usdc: formatDbUsdc(row.amount_usdc),
    asset: row.asset,
    recipient: row.recipient,
    network: row.network,
    resource_url: row.resource_url,
    resource_category: row.resource_category,
    quote: objectFromJson(row.quote),
    result: objectFromJson(row.result),
    activity_id: row.activity_id,
    created_at: row.created_at.toISOString(),
  };
}

function paymentRouteObservationFromRow(row: PaymentRouteObservationRow): PaymentRouteObservationRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    connection_id: row.connection_id,
    requested_network: row.requested_network,
    requested_asset: row.requested_asset,
    requested_rail: row.requested_rail,
    supported_rail: row.supported_rail,
    amount_usdc: row.amount_usdc === null ? null : formatDbUsdc(row.amount_usdc),
    outcome: row.outcome,
    reason_code: row.reason_code,
    resource_url: row.resource_url,
    resource_category: row.resource_category,
    observed_at: row.observed_at.toISOString(),
  };
}

function paymentReservationFromRow(row: PaymentReservationRow): PaymentReservationRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    connection_id: row.connection_id,
    source_id: row.source_id,
    amount_usdc: formatDbUsdc(row.amount_usdc),
    asset: row.asset,
    rail: row.rail,
    status: row.status,
    reason_code: row.reason_code,
    quote_hash: row.quote_hash,
    quote: objectFromJson(row.quote),
    expires_at: row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

async function fulfillPaidResource(input: {
  readonly amount: string;
  readonly asset: string;
  readonly mimeType: string;
  readonly method: string | undefined;
  readonly network: string;
  readonly payer: string | undefined;
  readonly rail: PaymentRail;
  readonly recipient: string;
  readonly transaction: string | undefined;
  readonly url: string | null;
}): Promise<RuntimePaymentFulfillment> {
  if (input.url === null || input.transaction === undefined || input.payer === undefined) {
    return { status: 'not_requested' };
  }

  try {
    const response = await fetch(input.url, {
      headers: {
        accept: input.mimeType,
        'x-agentops-payment-amount': input.amount,
        'x-agentops-payment-asset': input.asset,
        'x-agentops-payment-network': input.network,
        'x-agentops-payment-payer': input.payer,
        'x-agentops-payment-rail': input.rail,
        'x-agentops-payment-recipient': input.recipient,
        'x-agentops-payment-tx': input.transaction,
      },
      method: input.method ?? 'GET',
    });
    const text = await response.text();
    let body: unknown = text.slice(0, 4096);
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      // Keep the bounded text body for non-JSON paid resources.
    }
    if (!response.ok) {
      return {
        body,
        errorReason: `paid_resource_http_${response.status}`,
        httpStatus: response.status,
        status: 'failed',
      };
    }
    return {
      body,
      httpStatus: response.status,
      status: 'delivered',
    };
  } catch (error) {
    return {
      errorReason: error instanceof Error ? error.message : 'paid_resource_fetch_failed',
      status: 'failed',
    };
  }
}

export async function createTreasury(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: CreateTreasuryInput,
): Promise<TreasuryRecord> {
  const id = prefixedId('trs');
  const chain = normalizeChain(input.chain);
  const result = await pool.query<TreasuryRow>(
    `INSERT INTO org_treasuries (id, org_id, treasury_type, provider, chain, label, metadata, created_by)
     VALUES ($1, $2, $3, 'circle_gateway', $4, $5, $6::jsonb, $7)
     RETURNING *`,
    [
      id,
      orgId,
      input.treasury_type,
      chain,
      input.label.trim(),
      JSON.stringify(input.metadata ?? {}),
      operator.actorId,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('treasury_insert_failed');

  await recordActivity(pool, {
    orgId,
    category: 'treasury',
    action: 'treasury.gateway.created',
    outcome: 'success',
    summary: 'Gateway treasury configured',
    payload: { chain, treasury_id: id },
  });

  return treasuryFromRow(row);
}

export async function createPaymentSource(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: CreatePaymentSourceInput,
): Promise<PaymentSourceRecord> {
  const chain = normalizeChain(input.chain);
  const rail = normalizeRail(input.rail);
  if (chainFromRail(rail) !== chain) {
    throw badRequest('invalid_payment_source', 'Payment source rail must match its chain.');
  }
  if (railKind(rail) === 'gateway' && input.source_type !== 'gateway') {
    throw badRequest('invalid_payment_source', 'Gateway rail requires a Gateway source.');
  }
  if (railKind(rail) === 'gateway' && input.provider !== 'circle_gateway' && input.provider !== 'simulation') {
    throw badRequest('invalid_payment_source', 'Gateway rail requires a Circle Gateway provider.');
  }
  if (railKind(rail) === 'direct_exact' && input.source_type !== 'direct_exact' && input.source_type !== 'dedicated_wallet') {
    throw badRequest('invalid_payment_source', 'Exact rail requires a direct exact or dedicated wallet source.');
  }
  if (railKind(rail) === 'direct_exact' && input.provider !== 'circle_wallets') {
    throw badRequest('invalid_payment_source', 'Exact rail requires a Circle Wallets provider.');
  }

  const treasuryId = input.treasury_id ?? (await activeGatewayTreasuryId(pool, orgId, chain));
  const id = prefixedId('paysrc');
  const balance = assertNonNegativeUsdc(input.simulated_balance_usdc ?? '0', 'simulated_balance_usdc');
  const result = await pool.query<PaymentSourceRow>(
    `INSERT INTO payment_sources (
       id, org_id, treasury_id, source_type, provider, rail, chain, label,
       account_type, address, external_wallet_id, simulated_balance_usdc, metadata, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::numeric, $13::jsonb, $14)
     RETURNING *`,
    [
      id,
      orgId,
      treasuryId,
      input.source_type,
      input.provider,
      rail,
      chain,
      input.label.trim(),
      input.account_type ?? (input.source_type === 'gateway' ? 'virtual' : 'unknown'),
      input.address ?? null,
      input.external_wallet_id ?? null,
      balance,
      JSON.stringify(input.metadata ?? {}),
      operator.actorId,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('payment_source_insert_failed');

  await recordActivity(pool, {
    orgId,
    category: 'treasury',
    action: 'payment_source.created',
    outcome: 'success',
    summary: 'Payment source configured',
    payload: { chain, rail, source_id: id, source_type: input.source_type },
  });

  return sourceFromRow(row);
}

export async function setAgentPaymentAccess(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  agentId: string,
  input: SetAgentPaymentAccessInput,
): Promise<AgentPaymentAccountRecord> {
  await assertOrgAgent(pool, orgId, agentId);
  const allowedRails = input.allowed_rails.map(normalizeRail);
  const budget = assertNonNegativeUsdc(input.budget_usdc, 'budget_usdc');
  const cap = assertNonNegativeUsdc(input.per_request_cap_usdc, 'per_request_cap_usdc');
  const threshold =
    input.approval_threshold_usdc === undefined || input.approval_threshold_usdc === null
      ? null
      : assertPositiveUsdc(input.approval_threshold_usdc, 'approval_threshold_usdc');
  const id = prefixedId('payacct');
  const paymentAccess = input.status === 'active';
  const result = await pool.query<AgentPaymentAccountRow>(
    `INSERT INTO agent_payment_accounts (
       id, org_id, agent_id, status, payment_access, budget_usdc, per_request_cap_usdc,
       approval_threshold_usdc, dedicated_wallet_required, allowed_rails, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9, $10::text[], $11)
     ON CONFLICT (org_id, agent_id)
     DO UPDATE SET
       status = EXCLUDED.status,
       payment_access = EXCLUDED.payment_access,
       budget_usdc = EXCLUDED.budget_usdc,
       per_request_cap_usdc = EXCLUDED.per_request_cap_usdc,
       approval_threshold_usdc = EXCLUDED.approval_threshold_usdc,
       dedicated_wallet_required = EXCLUDED.dedicated_wallet_required,
       allowed_rails = EXCLUDED.allowed_rails,
       updated_at = now()
     RETURNING *`,
    [
      id,
      orgId,
      agentId,
      input.status,
      paymentAccess,
      budget,
      cap,
      threshold,
      input.dedicated_wallet_required,
      allowedRails,
      operator.actorId,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('agent_payment_account_upsert_failed');

  await recordActivity(pool, {
    orgId,
    agentId,
    category: 'payment',
    action: paymentAccess ? 'agent.payment_access.enabled' : 'agent.payment_access.disabled',
    outcome: 'success',
    summary: paymentAccess ? 'Payment access enabled' : 'Payment access disabled',
    payload: {
      allowed_rails: allowedRails,
      budget_usdc: budget,
      dedicated_wallet_required: input.dedicated_wallet_required,
      per_request_cap_usdc: cap,
    },
  });

  if (paymentAccess) {
    await completeProductOnboardingFlow(pool, orgId, 'payment_access', {
      agent_id: agentId,
      source: 'agent_payment_access_enabled',
    });
  }

  // B1: dedicated_wallet_required existed as a stored-but-unenforced flag
  // (0009:57) before this. This is what gives it meaning -- enqueuing
  // provisioning is a slow external call, so it happens behind the worker
  // boundary (agent_wallet.create jobs), never inline in this request.
  // Chains come from allowed_rails rather than a fixed list, so an agent
  // scoped to Arc-only doesn't also get an unused Base wallet.
  if (input.dedicated_wallet_required) {
    const mode = (await getOrgPaymentMode(pool, orgId)).mode;
    const requestedChains = [...new Set(allowedRails.map(chainFromRail))];
    const existingWallets = await pool.query<{ chain: PaymentChain }>(
      `SELECT chain FROM agent_chain_wallets
        WHERE agent_id = $1 AND mode = $2 AND status IN ('provisioning', 'active')`,
      [agentId, mode],
    );
    // A previous call to this function may already have enqueued a job for
    // this (agent, chain) that the worker hasn't processed into a wallet
    // row yet -- must also check pending jobs, or every subsequent call
    // (e.g. an operator adjusting the budget) re-enqueues duplicates.
    const pendingJobs = await pool.query<{ chain: PaymentChain }>(
      `SELECT chain FROM circle_provider_jobs
        WHERE org_id = $1 AND mode = $2 AND job_type = 'agent_wallet.create'
          AND status IN ('queued', 'submitted')
          AND metadata->>'agent_id' = $3`,
      [orgId, mode, agentId],
    );
    const alreadyHandled = new Set([
      ...existingWallets.rows.map((r) => r.chain),
      ...pendingJobs.rows.map((r) => r.chain),
    ]);
    const chainsToProvision = requestedChains.filter((chain) => !alreadyHandled.has(chain));
    if (chainsToProvision.length > 0) {
      await enqueueAgentWalletProvisioning(pool, {
        orgId, agentId, mode, chains: chainsToProvision, createdBy: operator.actorId,
      });
    }
  }

  return accountFromRow(row);
}

export async function getAgentPayments(
  pool: pg.Pool,
  orgId: string,
  agentId: string,
): Promise<{
  readonly account: AgentPaymentAccountRecord | null;
  readonly sources: PaymentSourceRecord[];
}> {
  await assertOrgAgent(pool, orgId, agentId);
  const account = await pool.query<AgentPaymentAccountRow>(
    `SELECT *
       FROM agent_payment_accounts
      WHERE org_id = $1
        AND agent_id = $2`,
    [orgId, agentId],
  );
  const sources = await pool.query<PaymentSourceRow>(
    `SELECT *
       FROM payment_sources
      WHERE org_id = $1
        AND status = 'active'
      ORDER BY rail ASC, created_at DESC`,
    [orgId],
  );
  return {
    account: account.rows[0] === undefined ? null : accountFromRow(account.rows[0]),
    sources: sources.rows.map(sourceFromRow),
  };
}

export async function listAgentPaymentAccounts(
  pool: pg.Pool,
  orgId: string,
): Promise<{
  readonly accounts: readonly AgentPaymentAccountRecord[];
  readonly sources: readonly PaymentSourceRecord[];
}> {
  const [accountRows, sourceRows] = await Promise.all([
    pool.query<AgentPaymentAccountRow>(
      `SELECT *
         FROM agent_payment_accounts
        WHERE org_id = $1`,
      [orgId],
    ),
    pool.query<PaymentSourceRow>(
      `SELECT *
         FROM payment_sources
        WHERE org_id = $1
          AND status = 'active'
        ORDER BY rail ASC, created_at DESC`,
      [orgId],
    ),
  ]);
  return {
    accounts: accountRows.rows.map(accountFromRow),
    sources: sourceRows.rows.map(sourceFromRow),
  };
}

export async function listPaymentSources(pool: pg.Pool, orgId: string): Promise<PaymentSourceRecord[]> {
  const sources = await pool.query<PaymentSourceRow>(
    `SELECT *
       FROM payment_sources
      WHERE org_id = $1
      ORDER BY status ASC, rail ASC, created_at DESC`,
    [orgId],
  );
  return sources.rows.map(sourceFromRow);
}

export async function listPaymentEvents(pool: pg.Pool, orgId: string, limit = 100): Promise<PaymentEventRecord[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 250));
  const result = await pool.query<PaymentEventRow>(
    `SELECT *
       FROM payment_events
      WHERE org_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [orgId, boundedLimit],
  );
  return result.rows.map(paymentEventRecordFromRow);
}

export async function listPaymentRouteObservations(
  pool: pg.Pool,
  orgId: string,
  limit = 100,
): Promise<PaymentRouteObservationRecord[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 250));
  const result = await pool.query<PaymentRouteObservationRow>(
    `SELECT *
       FROM payment_route_observations
      WHERE org_id = $1
      ORDER BY observed_at DESC
      LIMIT $2`,
    [orgId, boundedLimit],
  );
  return result.rows.map(paymentRouteObservationFromRow);
}

export async function listPaymentReservations(
  pool: pg.Pool,
  orgId: string,
  limit = 100,
): Promise<PaymentReservationRecord[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 250));
  const result = await pool.query<PaymentReservationRow>(
    `SELECT *
       FROM payment_reservations
      WHERE org_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [orgId, boundedLimit],
  );
  return result.rows.map(paymentReservationFromRow);
}

export async function listPaymentRailReadiness(
  pool: pg.Pool,
  orgId: string,
): Promise<PaymentRailReadinessRecord[]> {
  const mode = (await getOrgPaymentMode(pool, orgId)).mode;
  const capabilities = await listCircleChainCapabilities(pool, mode);
  const capabilityByChain = new Map(capabilities.map((capability) => [capability.chain, capability]));

  const observations = await pool.query<{ readonly rail: PaymentRail; readonly observed_at: Date }>(
    `SELECT DISTINCT ON (supported_rail) supported_rail AS rail, observed_at
       FROM payment_route_observations
      WHERE org_id = $1
        AND supported_rail IS NOT NULL
      ORDER BY supported_rail, observed_at DESC`,
    [orgId],
  );
  const lastObservedByRail = new Map(observations.rows.map((row) => [row.rail, row.observed_at.toISOString()]));

  const payments = await pool.query<{ readonly rail: PaymentRail; readonly created_at: Date }>(
    `SELECT DISTINCT ON (rail) rail, created_at
       FROM payment_events
      WHERE org_id = $1
      ORDER BY rail, created_at DESC`,
    [orgId],
  );
  const lastPaymentByRail = new Map(payments.rows.map((row) => [row.rail, row.created_at.toISOString()]));

  const proofJobs = await pool.query<{
    readonly rail: PaymentRail;
    readonly status: CircleProviderJobRecord['status'];
    readonly updated_at: Date;
  }>(
    `SELECT DISTINCT ON (metadata ->> 'rail')
            metadata ->> 'rail' AS rail,
            status,
            updated_at
       FROM circle_provider_jobs
      WHERE org_id = $1
        AND mode = $2
        AND job_type = 'rail.verify'
        AND metadata ->> 'rail' IS NOT NULL
      ORDER BY metadata ->> 'rail', updated_at DESC`,
    [orgId, mode],
  );
  const lastProofByRail = new Map(proofJobs.rows.map((row) => [
    row.rail,
    {
      status: row.status,
      updated_at: row.updated_at.toISOString(),
    },
  ]));

  return PAYMENT_RAILS.map((rail) => {
    const chain = chainFromRail(rail);
    const capability = capabilityByChain.get(chain);
    const isGateway = rail.startsWith('gateway_');
    const supported = capability === undefined
      ? false
      : isGateway
        ? capability.gateway_supported && capability.nanopayments_supported
        : capability.wallet_supported;
    const settlementVerified = capability === undefined
      ? false
      : isGateway
        ? capability.gateway_settlement_verified
        : capability.exact_settlement_verified;
    const status: PaymentRailReadinessRecord['status'] = !supported ? 'unsupported' : settlementVerified ? 'ready' : 'unverified';
    const reason = !supported
      ? `${rail} is not supported by the configured Circle capability set.`
      : settlementVerified
        ? `${rail} has a verified settlement path for ${mode} mode.`
        : `${rail} liquidity can be prepared, but settlement still needs a successful testnet proof.`;

    return {
      rail,
      chain,
      rail_type: isGateway ? 'gateway' : 'exact',
      supported,
      settlement_verified: settlementVerified,
      status,
      reason,
      last_observed_at: lastObservedByRail.get(rail) ?? null,
      last_payment_at: lastPaymentByRail.get(rail) ?? null,
      last_proof_at: lastProofByRail.get(rail)?.updated_at ?? null,
      last_proof_status: lastProofByRail.get(rail)?.status ?? null,
    };
  });
}

async function createRailVerificationGatewayLiquidityJob(
  db: Db,
  input: {
    readonly amountMicros: bigint;
    readonly chain: PaymentChain;
    readonly mode: PaymentMode;
    readonly operator: OperatorContext;
    readonly orgId: string;
    readonly provider: CircleTreasuryProvider;
    readonly rail: PaymentRail;
    readonly resourceUrl: string;
  },
): Promise<CircleProviderJobRecord> {
  if (input.mode === 'live' && process.env.CIRCLE_LIVE_REBALANCE_ENABLED !== 'true') {
    throw conflict('unsupported_gasless_payment_route', 'Live liquidity preparation is disabled until explicitly enabled.');
  }

  const prepMicros = maxMicros(input.amountMicros, CIRCLE_GATEWAY_MIN_DEPOSIT_MICROS);
  const balances = await listCircleBalances(db, input.orgId, input.provider);
  const destinationBalance = balances.find((balance) => balance.chain === input.chain);
  const destinationWalletMicros = destinationBalance === undefined ? 0n : walletUsdcMicros(destinationBalance);
  const sourceChain =
    destinationWalletMicros >= prepMicros
      ? input.chain
      : sourceChainForRebalance(balances, input.chain, prepMicros);

  if (sourceChain === null) {
    throw conflict(
      'unsupported_gasless_payment_route',
      `No gasless treasury route has enough USDC to prepare ${input.chain} Gateway liquidity.`,
    );
  }

  const strategy =
    sourceChain === input.chain
      ? 'wallet_to_gateway'
      : 'wallet_rebalance_then_gateway_deposit';
  const jobId = prefixedId('cjob');
  const inserted = await db.query<CircleProviderJobRow>(
    `INSERT INTO circle_provider_jobs (
       id, org_id, mode, job_type, chain, status, amount_usdc, metadata, created_by
     )
     VALUES ($1, $2, $3, 'liquidity.prepare', $4, 'queued', $5::numeric, $6::jsonb, $7)
     RETURNING *`,
    [
      jobId,
      input.orgId,
      input.mode,
      input.chain,
      formatUsdc(prepMicros),
      JSON.stringify({
        destination_bucket: `gateway:${input.chain}`,
        destination_chain: input.chain,
        gasless_verified: true,
        payment_amount_usdc: formatUsdc(input.amountMicros),
        rail: input.rail,
        reason_code: 'rail_verify_gateway_bucket_below_request',
        resource_category: 'rail-verification',
        resource_url: input.resourceUrl,
        retry_after_seconds: LIQUIDITY_PREP_RETRY_AFTER_SECONDS,
        bridge_idempotency_key: jobUuid(jobId),
        source_bucket: `wallet:${sourceChain}`,
        source_chain: sourceChain,
        strategy,
        trigger: 'rail.verify',
      }),
      input.operator.actorId,
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('rail_verify_liquidity_job_insert_failed');

  await recordActivity(db, {
    orgId: input.orgId,
    category: 'treasury',
    action: 'liquidity.prepare.queued',
    outcome: 'pending',
    summary: `Preparing ${formatUsdc(prepMicros)} USDC for ${input.rail} proof`,
    payload: {
      amount_usdc: formatUsdc(prepMicros),
      chain: input.chain,
      destination_bucket: `gateway:${input.chain}`,
      job_id: jobId,
      rail: input.rail,
      source_bucket: `wallet:${sourceChain}`,
      strategy,
      trigger: 'rail.verify',
    },
  });

  return providerJobFromRow(row);
}

async function createRailVerificationExactLiquidityJob(
  db: Db,
  input: {
    readonly amountMicros: bigint;
    readonly chain: PaymentChain;
    readonly mode: PaymentMode;
    readonly operator: OperatorContext;
    readonly orgId: string;
    readonly provider: CircleTreasuryProvider;
    readonly rail: PaymentRail;
    readonly resourceUrl: string;
  },
): Promise<CircleProviderJobRecord> {
  if (input.mode === 'live' && process.env.CIRCLE_LIVE_REBALANCE_ENABLED !== 'true') {
    throw conflict('unsupported_gasless_payment_route', 'Live exact-wallet liquidity preparation is disabled until explicitly enabled.');
  }

  const health = input.provider.health(input.mode);
  if (!health.configured) {
    throw conflict(
      'circle_provider_not_configured',
      `Circle ${input.mode} provider is missing ${health.missing.join(', ')}.`,
    );
  }

  const prepMicros = maxMicros(input.amountMicros, EXACT_WALLET_REBALANCE_MIN_MICROS);
  const balances = await listCircleBalances(db, input.orgId, input.provider);
  const sourceChain = sourceChainForRebalance(balances, input.chain, prepMicros);
  if (sourceChain === null) {
    throw conflict(
      'unsupported_gasless_payment_route',
      `No gasless treasury route has enough USDC to prepare ${input.chain} exact-wallet liquidity.`,
    );
  }

  const jobId = prefixedId('cjob');
  const inserted = await db.query<CircleProviderJobRow>(
    `INSERT INTO circle_provider_jobs (
       id, org_id, mode, job_type, chain, status, amount_usdc, metadata, created_by
     )
     VALUES ($1, $2, $3, 'liquidity.prepare', $4, 'queued', $5::numeric, $6::jsonb, $7)
     RETURNING *`,
    [
      jobId,
      input.orgId,
      input.mode,
      input.chain,
      formatUsdc(prepMicros),
      JSON.stringify({
        destination_bucket: `wallet:${input.chain}`,
        destination_chain: input.chain,
        gasless_verified: true,
        payment_amount_usdc: formatUsdc(input.amountMicros),
        rail: input.rail,
        reason_code: 'rail_verify_exact_wallet_below_request',
        resource_category: 'rail-verification',
        resource_url: input.resourceUrl,
        retry_after_seconds: LIQUIDITY_PREP_RETRY_AFTER_SECONDS,
        bridge_idempotency_key: jobUuid(jobId),
        source_bucket: `wallet:${sourceChain}`,
        source_chain: sourceChain,
        strategy: 'wallet_rebalance',
        trigger: 'rail.verify',
      }),
      input.operator.actorId,
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('rail_verify_exact_liquidity_job_insert_failed');

  await recordActivity(db, {
    orgId: input.orgId,
    category: 'treasury',
    action: 'liquidity.prepare.queued',
    outcome: 'pending',
    summary: `Preparing ${formatUsdc(prepMicros)} USDC for ${input.rail} proof`,
    payload: {
      amount_usdc: formatUsdc(prepMicros),
      chain: input.chain,
      destination_bucket: `wallet:${input.chain}`,
      job_id: jobId,
      rail: input.rail,
      source_bucket: `wallet:${sourceChain}`,
      strategy: 'wallet_rebalance',
      trigger: 'rail.verify',
    },
  });

  return providerJobFromRow(row);
}

async function ensureGatewayRailVerificationLiquidity(
  pool: pg.Pool,
  input: {
    readonly amountMicros: bigint;
    readonly chain: PaymentChain;
    readonly mode: PaymentMode;
    readonly operator: OperatorContext;
    readonly orgId: string;
    readonly provider: CircleTreasuryProvider;
    readonly rail: PaymentRail;
    readonly resourceUrl: string;
    readonly source: PaymentSourceRecord;
  },
): Promise<Record<string, unknown>> {
  let observedGatewayUsdc: string | null = null;
  try {
    const gatewayBalance = await input.provider.getGatewayBalance({
      address: input.source.address as string,
      chain: input.chain,
      mode: input.mode,
    });
    const gatewayMicros = parseUsdcMicros(gatewayBalance.available);
    observedGatewayUsdc = formatUsdc(gatewayMicros);
    if (gatewayMicros >= input.amountMicros) {
      return {
        liquidity_preparation_status: 'already_sufficient_gateway_balance',
        observed_gateway_usdc: observedGatewayUsdc,
      };
    }
  } catch {
    observedGatewayUsdc = null;
  }

  const liquidityJob = await createRailVerificationGatewayLiquidityJob(pool, {
    amountMicros: input.amountMicros,
    chain: input.chain,
    mode: input.mode,
    operator: input.operator,
    orgId: input.orgId,
    provider: input.provider,
    rail: input.rail,
    resourceUrl: input.resourceUrl,
  });
  const prepared = await retryLiquidityJob(pool, input.operator, input.orgId, liquidityJob.id, input.provider);
  if (prepared.status === 'submitted') {
    return {
      liquidity_preparation_job_id: prepared.id,
      liquidity_preparation_provider_ref: prepared.provider_ref,
      liquidity_preparation_status: 'submitted',
      observed_gateway_usdc: stringValue(prepared.metadata.observed_gateway_usdc) ?? observedGatewayUsdc,
    };
  }
  if (prepared.status !== 'complete') {
    const metadata = objectFromJson(prepared.metadata);
    throw new Error(
      stringValue(metadata.error_message) ??
        prepared.error_code ??
        `Gateway liquidity preparation failed for ${input.rail}.`,
    );
  }

  return {
    liquidity_preparation_job_id: prepared.id,
    liquidity_preparation_provider_ref: prepared.provider_ref,
    liquidity_preparation_status: 'complete',
    observed_gateway_usdc: stringValue(prepared.metadata.observed_gateway_usdc) ?? observedGatewayUsdc,
  };
}

async function ensureExactRailVerificationLiquidity(
  pool: pg.Pool,
  input: {
    readonly amountMicros: bigint;
    readonly chain: PaymentChain;
    readonly mode: PaymentMode;
    readonly operator: OperatorContext;
    readonly orgId: string;
    readonly provider: CircleTreasuryProvider;
    readonly rail: PaymentRail;
    readonly resourceUrl: string;
  },
): Promise<Record<string, unknown>> {
  const balances = await listCircleBalances(pool, input.orgId, input.provider);
  const destinationBalance = balances.find((balance) => balance.chain === input.chain);
  const destinationWalletMicros = destinationBalance === undefined ? 0n : walletUsdcMicros(destinationBalance);
  if (destinationWalletMicros >= input.amountMicros) {
    return {
      liquidity_preparation_status: 'already_sufficient_wallet_balance',
      observed_wallet_usdc: formatUsdc(destinationWalletMicros),
    };
  }

  const liquidityJob = await createRailVerificationExactLiquidityJob(pool, {
    amountMicros: input.amountMicros,
    chain: input.chain,
    mode: input.mode,
    operator: input.operator,
    orgId: input.orgId,
    provider: input.provider,
    rail: input.rail,
    resourceUrl: input.resourceUrl,
  });
  const prepared = await retryLiquidityJob(pool, input.operator, input.orgId, liquidityJob.id, input.provider);
  if (prepared.status === 'submitted') {
    return {
      liquidity_preparation_job_id: prepared.id,
      liquidity_preparation_provider_ref: prepared.provider_ref,
      liquidity_preparation_status: 'submitted',
      observed_wallet_usdc: stringValue(prepared.metadata.observed_wallet_usdc),
    };
  }
  if (prepared.status !== 'complete') {
    const metadata = objectFromJson(prepared.metadata);
    throw new Error(
      stringValue(metadata.error_message) ??
        prepared.error_code ??
        `Exact wallet liquidity preparation failed for ${input.rail}.`,
    );
  }

  const refreshedBalances = await listCircleBalances(pool, input.orgId, input.provider);
  const refreshedDestinationBalance = refreshedBalances.find((balance) => balance.chain === input.chain);
  const refreshedDestinationWalletMicros =
    refreshedDestinationBalance === undefined ? 0n : walletUsdcMicros(refreshedDestinationBalance);
  if (refreshedDestinationWalletMicros < input.amountMicros) {
    return {
      liquidity_preparation_job_id: prepared.id,
      liquidity_preparation_provider_ref: prepared.provider_ref,
      liquidity_preparation_status: 'submitted',
      observed_wallet_usdc: formatUsdc(refreshedDestinationWalletMicros),
    };
  }

  return {
    liquidity_preparation_job_id: prepared.id,
    liquidity_preparation_provider_ref: prepared.provider_ref,
    liquidity_preparation_status: 'complete',
    observed_wallet_usdc: formatUsdc(refreshedDestinationWalletMicros),
  };
}

export async function verifyPaymentRail(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  railInput: string,
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
): Promise<CircleProviderJobRecord> {
  const rail = normalizeRail(railInput);
  const chain = chainFromRail(rail);
  const kind = railKind(rail);
  const mode = (await getOrgPaymentMode(pool, orgId)).mode;
  if (mode === 'live' && process.env.CIRCLE_LIVE_RAIL_VERIFICATION_ENABLED !== 'true') {
    throw conflict('live_rail_verification_disabled', 'Live rail verification is disabled until explicitly enabled.');
  }

  const health = provider.health(mode);
  if (!health.configured) {
    throw conflict(
      'circle_provider_not_configured',
      `Circle ${mode} provider is missing ${health.missing.join(', ')}.`,
    );
  }

  const capability = await getCircleChainCapability(pool, mode, chain);
  const availabilityFailure = railVerificationFailure(
    capability === null
      ? null
      : {
          ...capability,
          exact_settlement_verified: true,
          gateway_settlement_verified: true,
        },
    {
      amount: '0.00',
      amountMicros: 0n,
      asset: 'USDC',
      chain,
      rail,
      settlementKind: kind,
      accept: {
        scheme: 'exact',
        network: gatewayNetworkForMode(chain, mode),
      },
      network: chain,
      recipient: TESTNET_X402_PROOF_PAY_TO,
      x402Amount: '0',
      x402Network: gatewayNetworkForMode(chain, mode),
      x402Requirements: {
        amount: '0',
        asset: gatewayUsdcForMode(chain, mode),
        extra: {},
        maxTimeoutSeconds: 604800,
        network: gatewayNetworkForMode(chain, mode),
        payTo: TESTNET_X402_PROOF_PAY_TO,
        scheme: 'exact',
      },
    },
  );
  if (availabilityFailure !== null) throw conflict(availabilityFailure.code, availabilityFailure.message);

  const source = await activePaymentSource(pool, orgId, rail, chain);
  if (source.provider === 'simulation') {
    throw conflict('rail_verification_requires_real_source', 'Rail verification requires a real Circle payment source.');
  }
  if (source.address === null || source.external_wallet_id === null) {
    throw conflict('rail_verification_source_incomplete', 'Rail verification requires a payment source with a wallet address and Circle wallet id.');
  }

  const amountMicros = kind === 'gateway' ? RAIL_VERIFY_GATEWAY_AMOUNT_MICROS : RAIL_VERIFY_EXACT_AMOUNT_MICROS;
  const amount = formatUsdc(amountMicros);
  const resourceUrl = mode === 'test'
    ? testnetX402ResourceUrl(chain, kind)
    : `https://agentops.local/rail-verification/${rail}`;
  const requirements: CircleGatewayX402Requirements = {
    amount: amountMicros.toString(),
    asset: gatewayUsdcForMode(chain, mode),
    extra:
      kind === 'gateway'
        ? {
            name: 'GatewayWalletBatched',
            verifyingContract: mode === 'test'
              ? '0x0077777d7EBA4688BDeF3E311b846F25870A19B9'
              : '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
            version: '1',
          }
        : {
            name: 'USDC',
            version: '2',
          },
    maxTimeoutSeconds: 604800,
    network: gatewayNetworkForMode(chain, mode),
    payTo: TESTNET_X402_PROOF_PAY_TO,
    scheme: 'exact',
  };

  const jobId = prefixedId('cjob');
  const inserted = await pool.query<CircleProviderJobRow>(
    `INSERT INTO circle_provider_jobs (
       id, org_id, mode, job_type, chain, status, amount_usdc, metadata, created_by
     )
     VALUES ($1, $2, $3, 'rail.verify', $4, 'queued', $5::numeric, $6::jsonb, $7)
     RETURNING *`,
    [
      jobId,
      orgId,
      mode,
      chain,
      amount,
      JSON.stringify({
        amount_micros: amountMicros.toString(),
        rail,
        rail_type: kind === 'gateway' ? 'gateway' : 'exact',
        resource_url: resourceUrl,
        source_id: source.id,
        verification_method: kind === 'gateway' ? 'circle_gateway_x402_settlement' : 'circle_wallet_usdc_transfer_with_local_verifier',
        wallet_address: source.address,
        wallet_id: source.external_wallet_id,
      }),
      operator.actorId,
    ],
  );
  if (inserted.rows[0] === undefined) throw new Error('rail_verify_job_insert_failed');

  try {
    await pool.query(
      `UPDATE circle_provider_jobs
          SET status = 'submitted',
              metadata = metadata || jsonb_build_object('provider_operation_started_at', now()),
              updated_at = now()
        WHERE id = $1`,
      [jobId],
    );

    const liquidityMetadata = kind === 'gateway'
      ? await ensureGatewayRailVerificationLiquidity(pool, {
          amountMicros,
          chain,
          mode,
          operator,
          orgId,
          provider,
          rail,
          resourceUrl,
          source: sourceFromRow(source),
        })
      : await ensureExactRailVerificationLiquidity(pool, {
          amountMicros,
          chain,
          mode,
          operator,
          orgId,
          provider,
          rail,
          resourceUrl,
        });
    await pool.query(
      `UPDATE circle_provider_jobs
          SET metadata = metadata || $2::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [jobId, JSON.stringify(liquidityMetadata)],
    );
    if (stringValue(liquidityMetadata.liquidity_preparation_status) === 'submitted') {
      const submitted = await pool.query<CircleProviderJobRow>(
        `UPDATE circle_provider_jobs
            SET status = 'submitted',
                error_code = NULL,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [jobId],
      );
      const submittedRow = submitted.rows[0];
      if (submittedRow === undefined) throw new Error('rail_verify_job_submitted_update_missing');
      return providerJobFromRow(submittedRow);
    }

    const settlement = await withCircleProviderTimeout(
      kind === 'gateway'
        ? provider.settleGatewayX402({
            mode,
            requirements,
            resource: {
              description: `agentOps ${rail} verification`,
              mimeType: 'application/json',
              url: resourceUrl,
            },
            walletAddress: source.address,
            walletId: source.external_wallet_id,
          })
        : provider.settleExactX402({
            mode,
            requirements,
            resource: {
              description: `agentOps ${rail} verification`,
              method: 'GET',
              mimeType: 'application/json',
              url: resourceUrl,
            },
            walletAddress: source.address,
            walletId: source.external_wallet_id,
          }),
      'circle_rail_verify_provider_timeout',
    );

    let fulfillment: RuntimePaymentFulfillment = { status: 'not_requested' };
    if (settlement.success && kind === 'direct_exact' && mode === 'test') {
      fulfillment = await fulfillPaidResource({
        amount: amountMicros.toString(),
        asset: requirements.asset,
        method: 'GET',
        mimeType: 'application/json',
        network: requirements.network,
        payer: 'payer' in settlement ? settlement.payer : source.address,
        rail,
        recipient: requirements.payTo,
        transaction: settlement.transaction,
        url: resourceUrl,
      });
    }

    const success = settlement.success && (fulfillment.status === 'not_requested' || fulfillment.status === 'delivered');
    if (!success) {
      const message = settlement.success
        ? fulfillment.errorReason ?? 'rail_verify_fulfillment_failed'
        : settlement.errorReason ?? 'rail_verify_settlement_failed';
      const status = circleProviderStatusForResult(false, message);
      return withTransaction(pool, async (client) => {
        const failed = await client.query<CircleProviderJobRow>(
          `UPDATE circle_provider_jobs
              SET status = $2,
                  provider_ref = $3,
                  error_code = $4,
                  metadata = metadata || $5::jsonb,
                  updated_at = now()
            WHERE id = $1
            RETURNING *`,
          [
            jobId,
            status,
            settlement.transaction ?? null,
            circleProviderErrorCode('rail_verify_failed', message),
            JSON.stringify({
              error_message: message,
              fulfillment,
              provider_mode: settlement.providerMode,
              settlement_network: settlement.network,
              settlement_payer: 'payer' in settlement ? settlement.payer ?? null : null,
              settlement_success: settlement.success,
              settlement_transaction: settlement.transaction ?? null,
            }),
          ],
        );
        const failedRow = failed.rows[0];
        if (failedRow === undefined) throw new Error('rail_verify_job_failed_update_missing');

        await recordActivity(client, {
          orgId,
          category: 'treasury',
          action: 'rail.verify.failed',
          outcome: 'error',
          summary: `${rail} verification failed`,
          payload: {
            amount_usdc: amount,
            error_message: message,
            job_id: jobId,
            rail,
            transaction: settlement.transaction ?? null,
          },
        });

        await recordAuditEvent(client, {
          orgId,
          idempotencyKey: `rail.verify.failed:${jobId}`,
          eventType: 'rail.verify.failed',
          actor: { type: 'user', id: operator.actorId },
          action: 'rail.verify.failed',
          outcome: 'error',
          resource: { type: 'circle_provider_job', id: jobId },
          classification: {
            domain: 'payment',
            category: 'financial',
            severity: 'warning',
            tags: ['section_9', 'rail_verify', rail, chain],
          },
          relations: {},
          refs: {},
          source: { section: 'section_9', system: 'payments' },
          retentionClass: 'payment',
          payload: {
            amount_usdc: amount,
            error_message: message,
            fulfillment,
            rail,
            settlement_transaction: settlement.transaction ?? null,
          },
        });

        return providerJobFromRow(failedRow);
      });
    }

    return withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE circle_chain_capabilities
            SET exact_settlement_verified = CASE WHEN $3 = 'direct_exact' THEN true ELSE exact_settlement_verified END,
                gateway_settlement_verified = CASE WHEN $3 = 'gateway' THEN true ELSE gateway_settlement_verified END,
                metadata = metadata || $4::jsonb
          WHERE mode = $1
            AND chain = $2`,
        [
          mode,
          chain,
          kind,
          JSON.stringify({
            [`${kind === 'gateway' ? 'gateway' : 'exact'}_verification`]: `verified by rail proof job ${jobId}`,
            [`${kind === 'gateway' ? 'gateway' : 'exact'}_verification_at`]: new Date().toISOString(),
            [`${kind === 'gateway' ? 'gateway' : 'exact'}_verification_job_id`]: jobId,
            [`${kind === 'gateway' ? 'gateway' : 'exact'}_verification_rail`]: rail,
          }),
        ],
      );

      const completed = await client.query<CircleProviderJobRow>(
        `UPDATE circle_provider_jobs
            SET status = 'complete',
                provider_ref = $2,
                error_code = NULL,
                metadata = metadata || $3::jsonb,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          jobId,
          settlement.transaction ?? null,
          JSON.stringify({
            fulfillment,
            provider_mode: settlement.providerMode,
            settlement_network: settlement.network,
            settlement_payer: 'payer' in settlement ? settlement.payer ?? null : null,
            settlement_success: true,
            settlement_transaction: settlement.transaction ?? null,
            verified_at: new Date().toISOString(),
          }),
        ],
      );
      const row = completed.rows[0];
      if (row === undefined) throw new Error('rail_verify_job_complete_update_missing');

      await recordActivity(client, {
        orgId,
        category: 'treasury',
        action: 'rail.verify.complete',
        outcome: 'success',
        summary: `${rail} verified on ${chain}`,
        payload: {
          amount_usdc: amount,
          chain,
          fulfillment,
          job_id: jobId,
          rail,
          transaction: settlement.transaction ?? null,
        },
      });

      await recordAuditEvent(client, {
        orgId,
        idempotencyKey: `rail.verify.complete:${jobId}`,
        eventType: 'rail.verify.complete',
        actor: { type: 'user', id: operator.actorId },
        action: 'rail.verify.complete',
        outcome: 'success',
        resource: { type: 'circle_provider_job', id: jobId },
        classification: {
          domain: 'payment',
          category: 'financial',
          severity: 'info',
          tags: ['section_9', 'rail_verify', rail, chain],
        },
        relations: {},
        refs: {},
        source: { section: 'section_9', system: 'payments' },
        retentionClass: 'payment',
        payload: {
          amount_usdc: amount,
          fulfillment,
          rail,
          settlement_transaction: settlement.transaction ?? null,
        },
      });

      return providerJobFromRow(row);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'rail_verify_failed';
    const status = circleProviderStatusForResult(false, message);
    const failed = await pool.query<CircleProviderJobRow>(
      `UPDATE circle_provider_jobs
          SET status = $2,
              error_code = $3,
              metadata = metadata || $4::jsonb,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        jobId,
        status,
        circleProviderErrorCode('rail_verify_failed', message),
        JSON.stringify({ error_message: message }),
      ],
    );
    const row = failed.rows[0];
    if (row !== undefined) return providerJobFromRow(row);
    throw error;
  }
}

export async function verifyPaymentRails(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: {
    readonly only_unverified?: boolean | undefined;
    readonly rails?: readonly string[] | undefined;
  } = {},
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
): Promise<readonly CircleProviderJobRecord[]> {
  const requestedRails = input.rails === undefined ? null : new Set(input.rails.map(normalizeRail));
  const readiness = await listPaymentRailReadiness(pool, orgId);
  const selectedRails = readiness
    .filter((rail) => rail.supported)
    .filter((rail) => requestedRails === null || requestedRails.has(rail.rail))
    .filter((rail) => input.only_unverified === false || !rail.settlement_verified)
    .map((rail) => rail.rail);

  if (requestedRails !== null) {
    const selected = new Set(selectedRails);
    const missing = [...requestedRails].filter((rail) => !selected.has(rail));
    if (missing.length > 0 && input.only_unverified === false) {
      throw conflict('rail_verification_unavailable', `Cannot verify unsupported rails: ${missing.join(', ')}.`);
    }
  }

  const jobs: CircleProviderJobRecord[] = [];
  for (const rail of selectedRails) {
    jobs.push(await verifyPaymentRail(pool, operator, orgId, rail, provider));
  }
  return jobs;
}

export async function listTreasuries(pool: pg.Pool, orgId: string): Promise<TreasuryRecord[]> {
  const treasuries = await pool.query<TreasuryRow>(
    `SELECT *
       FROM org_treasuries
      WHERE org_id = $1
      ORDER BY status ASC, created_at DESC`,
    [orgId],
  );
  return treasuries.rows.map(treasuryFromRow);
}

export async function getOrgPaymentMode(db: Db, orgId: string): Promise<OrgPaymentModeRecord> {
  const result = await db.query<OrgPaymentModeRow>(
    `SELECT *
       FROM org_payment_modes
      WHERE org_id = $1`,
    [orgId],
  );
  const row = result.rows[0];
  if (row !== undefined) return modeFromRow(row);
  return {
    mode: 'test',
    org_id: orgId,
    updated_at: new Date(0).toISOString(),
    updated_by: 'system',
  };
}

export async function setOrgPaymentMode(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  mode: PaymentMode,
): Promise<OrgPaymentModeRecord> {
  if (mode !== 'test') {
    throw badRequest('payment_mode_testnet_only', 'Live payments are not available in the testnet product.');
  }
  const result = await pool.query<OrgPaymentModeRow>(
    `INSERT INTO org_payment_modes (org_id, mode, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id)
     DO UPDATE SET mode = EXCLUDED.mode,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = now()
     RETURNING *`,
    [orgId, mode, operator.actorId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('payment_mode_upsert_failed');

  await recordActivity(pool, {
    orgId,
    category: 'treasury',
    action: 'payment_mode.updated',
    outcome: 'success',
    summary: `Payment mode set to ${mode}`,
    payload: { mode },
  });

  return modeFromRow(row);
}

export async function listCircleChainCapabilities(
  pool: pg.Pool,
  mode: PaymentMode,
): Promise<CircleChainCapabilityRecord[]> {
  const result = await pool.query<CircleChainCapabilityRow>(
    `SELECT *
      FROM circle_chain_capabilities
      WHERE mode = $1
        AND status = 'active'
      ORDER BY CASE chain
        WHEN 'base' THEN 1
        WHEN 'arbitrum' THEN 2
        WHEN 'polygon' THEN 3
        WHEN 'optimism' THEN 4
        WHEN 'avalanche' THEN 5
        ELSE 99
      END ASC`,
    [mode],
  );
  if (result.rows.length > 0) return result.rows.map(capabilityFromRow);
  return capabilitiesForMode(mode).map((capability) => ({
    chain: capability.chain,
    circle_blockchain: capability.circleBlockchain,
    exact_settlement_verified: true,
    gateway_domain: capability.gatewayDomain,
    gateway_settlement_verified: capability.chain === 'base',
    gateway_supported: capability.gatewaySupported,
    id: `fallback_${mode}_${capability.chain}`,
    mode,
    nanopayments_supported: capability.nanopaymentsSupported,
    network_label: capability.networkLabel,
    status: 'active',
    wallet_account_type: 'sca',
    wallet_supported: capability.walletSupported,
  }));
}

async function getCircleChainCapability(
  db: Db,
  mode: PaymentMode,
  chain: PaymentChain,
): Promise<CircleChainCapabilityRecord | null> {
  const result = await db.query<CircleChainCapabilityRow>(
    `SELECT *
       FROM circle_chain_capabilities
      WHERE mode = $1
        AND chain = $2
        AND status = 'active'
      LIMIT 1`,
    [mode, chain],
  );
  const row = result.rows[0];
  if (row !== undefined) return capabilityFromRow(row);

  const fallback = capabilitiesForMode(mode).find((capability) => capability.chain === chain);
  if (fallback === undefined) return null;
  return {
    chain: fallback.chain,
    circle_blockchain: fallback.circleBlockchain,
    exact_settlement_verified: true,
    gateway_domain: fallback.gatewayDomain,
    gateway_settlement_verified: fallback.chain === 'base',
    gateway_supported: fallback.gatewaySupported,
    id: `fallback_${mode}_${fallback.chain}`,
    mode,
    nanopayments_supported: fallback.nanopaymentsSupported,
    network_label: fallback.networkLabel,
    status: 'active',
    wallet_account_type: 'sca',
    wallet_supported: fallback.walletSupported,
  };
}

async function activeWalletSet(db: Db, orgId: string, mode: PaymentMode): Promise<CircleWalletSetRow | null> {
  const result = await db.query<CircleWalletSetRow>(
    `SELECT *
       FROM circle_wallet_sets
      WHERE org_id = $1
        AND mode = $2
        AND status = 'active'
      LIMIT 1`,
    [orgId, mode],
  );
  return result.rows[0] ?? null;
}

async function listCircleWalletRows(db: Db, orgId: string, mode: PaymentMode): Promise<CircleChainWalletRow[]> {
  const result = await db.query<CircleChainWalletRow>(
    `SELECT *
       FROM circle_chain_wallets
      WHERE org_id = $1
        AND mode = $2
      ORDER BY chain ASC`,
    [orgId, mode],
  );
  return result.rows;
}

async function ensureTreasuryAndSourceForWallet(
  db: Db,
  input: {
    readonly chain: PaymentChain;
    readonly circleWalletId: string;
    readonly mode: PaymentMode;
    readonly operatorId: string;
    readonly orgId: string;
    readonly address: string;
    readonly walletSetId: string;
  },
): Promise<void> {
  const rail = normalizeRail(circleRailForChain(input.chain));
  const exactRail = exactRailForChain(input.chain);
  const treasuryId = prefixedId('trs');
  const treasury = await db.query<{ id: string }>(
    `INSERT INTO org_treasuries (id, org_id, treasury_type, provider, chain, label, metadata, created_by)
     VALUES ($1, $2, 'gateway', 'circle_gateway', $3, $4, $5::jsonb, $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      treasuryId,
      input.orgId,
      input.chain,
      `${input.chain} Gateway treasury`,
      JSON.stringify({ mode: input.mode, wallet_set_id: input.walletSetId }),
      input.operatorId,
    ],
  );
  const existingTreasuryId =
    treasury.rows[0]?.id ?? (await activeGatewayTreasuryId(db, input.orgId, input.chain)) ?? treasuryId;

  const existingSources = await db.query<{ rail: PaymentRail }>(
    `SELECT rail
       FROM payment_sources
      WHERE org_id = $1
        AND chain = $2
        AND rail = ANY($3::text[])
        AND status = 'active'`,
    [input.orgId, input.chain, [rail, exactRail]],
  );
  const existingRails = new Set(existingSources.rows.map((row) => row.rail));
  await db.query(
    `UPDATE payment_sources
        SET address = $4,
            external_wallet_id = $5,
            account_type = 'sca',
            metadata = metadata || $6::jsonb,
            updated_at = now()
      WHERE org_id = $1
        AND chain = $2
        AND rail = ANY($3::text[])
        AND status = 'active'`,
    [
      input.orgId,
      input.chain,
      [rail, exactRail],
      input.address,
      input.circleWalletId,
      JSON.stringify({ mode: input.mode, wallet_set_id: input.walletSetId, walletProvider: 'circle_agent_wallet' }),
    ],
  );

  if (!existingRails.has(rail)) {
    await db.query(
      `INSERT INTO payment_sources (
         id, org_id, treasury_id, source_type, provider, rail, chain, label,
         account_type, address, external_wallet_id, simulated_balance_usdc, metadata, created_by
       )
       VALUES ($1, $2, $3, 'gateway', 'circle_gateway', $4, $5, $6,
         'virtual', $7, $8, 0::numeric, $9::jsonb, $10)`,
      [
        prefixedId('paysrc'),
        input.orgId,
        existingTreasuryId,
        rail,
        input.chain,
        `${input.chain} Gateway source`,
        input.address,
        input.circleWalletId,
        JSON.stringify({ mode: input.mode, wallet_set_id: input.walletSetId }),
        input.operatorId,
      ],
    );
  }

  if (!existingRails.has(exactRail)) {
    await db.query(
      `INSERT INTO payment_sources (
         id, org_id, treasury_id, source_type, provider, rail, chain, label,
         account_type, address, external_wallet_id, simulated_balance_usdc, metadata, created_by
       )
       VALUES ($1, $2, $3, 'direct_exact', 'circle_wallets', $4, $5, $6,
         'sca', $7, $8, 0::numeric, $9::jsonb, $10)`,
      [
        prefixedId('paysrc'),
        input.orgId,
        existingTreasuryId,
        exactRail,
        input.chain,
        `${input.chain} Exact source`,
        input.address,
        input.circleWalletId,
        JSON.stringify({ mode: input.mode, wallet_set_id: input.walletSetId }),
        input.operatorId,
      ],
    );
  }
}

export async function listCircleWallets(
  pool: pg.Pool,
  orgId: string,
  mode?: PaymentMode,
): Promise<CircleChainWalletRecord[]> {
  const currentMode = mode ?? (await getOrgPaymentMode(pool, orgId)).mode;
  const rows = await listCircleWalletRows(pool, orgId, currentMode);
  return rows.map(chainWalletFromRow);
}

export async function listCircleBalances(
  pool: Db,
  orgId: string,
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
  redis?: Redis,
): Promise<CircleChainBalanceRecord[]> {
  const mode = (await getOrgPaymentMode(pool, orgId)).mode;
  const cached = await readCachedBalances(redis, orgId, mode);
  if (cached !== null) return [...cached];
  const rows = await listCircleWalletRows(pool, orgId, mode);
  const balances = await Promise.all(
    rows.map(async (wallet) => {
      const gatewayDepositorAddress = resolveGatewayDepositorAddress(wallet.address, wallet.metadata);
      const [walletBalances, gatewayBalance] = await Promise.all([
        provider.getWalletBalances({ mode, walletId: wallet.circle_wallet_id }).catch(() => ({
          balances: [],
          providerMode: mode,
        })),
        provider.getGatewayBalance({ address: gatewayDepositorAddress, chain: wallet.chain, mode }).catch(() => null),
      ]);
      return {
        address: wallet.address,
        chain: wallet.chain,
        circle_wallet_id: wallet.circle_wallet_id,
        gateway: gatewayBalance === null
          ? null
          : {
              available: gatewayBalance.available,
              domain: gatewayBalance.domain,
              total: gatewayBalance.total,
              withdrawable: gatewayBalance.withdrawable,
              withdrawing: gatewayBalance.withdrawing,
            },
        mode,
        tokens: walletBalances.balances.map(tokenBalanceRecord),
      };
    }),
  );
  await writeCachedBalances(redis, orgId, mode, balances);
  return balances;
}

export async function listCircleProviderJobs(
  pool: pg.Pool,
  orgId: string,
  limit = 12,
): Promise<CircleProviderJobRecord[]> {
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  await expireStaleCircleProviderJobs(pool, orgId);
  const result = await pool.query<CircleProviderJobRow>(
    `SELECT *
       FROM circle_provider_jobs
      WHERE org_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [orgId, boundedLimit],
  );
  return result.rows.map(providerJobFromRow);
}

export async function reconcileCircleProviderJobs(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
): Promise<CircleProviderJobRecord[]> {
  await expireStaleCircleProviderJobs(pool, orgId);
  const pending = await pool.query<CircleProviderJobRow>(
    `SELECT *
       FROM circle_provider_jobs
      WHERE org_id = $1
        AND job_type IN ('wallet.rebalance', 'gateway.deposit')
        AND (
          status = 'submitted'
          OR (
            status = 'failed'
            AND (
              error_code IN ('circle_cli_command_failed', 'circle_provider_job_timeout')
              OR error_code LIKE 'Command failed: circle bridge transfer%'
              OR error_code LIKE '%circle_cli_process_timeout%'
              OR error_code LIKE '%provider_timeout%'
            )
          )
        )
      ORDER BY created_at ASC
      LIMIT 25`,
    [orgId],
  );
  if (pending.rows.length === 0) return [];

  const balances = await listCircleBalances(pool, orgId, provider);
  const reconciled: CircleProviderJobRecord[] = [];
  for (const row of pending.rows) {
    const metadata = objectFromJson(row.metadata);
    if (row.amount_usdc === null || row.chain === null) continue;
    const amount = formatDbUsdc(row.amount_usdc);
    const amountMicros = parseUsdcMicros(amount);

    if (row.job_type === 'wallet.rebalance') {
      const destinationChain = normalizeChain(metadataString(metadata, 'to_chain') ?? row.chain);
      const balance = balances.find((item) => item.chain === destinationChain);
      const observedMicros = balance === undefined ? 0n : walletUsdcMicros(balance);
      const before = metadataString(metadata, 'destination_wallet_before_usdc');
      const beforeMicros = before === null ? 0n : parseUsdcMicros(before);
      const requiredMicros = before === null ? amountMicros : beforeMicros + amountMicros;
      if (observedMicros < requiredMicros) continue;

      reconciled.push(await completeProviderJobReconciled(pool, {
        amount,
        jobId: row.id,
        jobType: row.job_type,
        observedKey: 'reconcile_observed_wallet_usdc',
        observedValue: formatUsdc(observedMicros),
        operator,
        orgId,
        providerRef: metadataString(metadata, 'transfer_transaction_id'),
        reconcileMethod: 'destination_wallet_balance',
        summary: `${amount} USDC exact wallet top-up reconciled on ${destinationChain}`,
      }));
      continue;
    }

    if (row.job_type === 'gateway.deposit') {
      const balance = balances.find((item) => item.chain === row.chain);
      const observedMicros = balance?.gateway === null || balance?.gateway === undefined
        ? 0n
        : parseUsdcMicros(balance.gateway.available);
      const before = metadataString(metadata, 'gateway_before_usdc');
      const beforeMicros = before === null ? null : parseUsdcMicros(before);
      if (!gatewayDepositSatisfied({ amountMicros, beforeMicros, observedMicros })) continue;

      reconciled.push(await completeProviderJobReconciled(pool, {
        amount,
        jobId: row.id,
        jobType: row.job_type,
        observedKey: 'reconcile_observed_gateway_usdc',
        observedValue: formatUsdc(observedMicros),
        operator,
        orgId,
        providerRef: metadataString(metadata, 'deposit_transaction_id'),
        reconcileMethod: 'gateway_balance',
        summary: `${amount} USDC Gateway deposit reconciled on ${row.chain}`,
      }));
    }
  }

  return reconciled;
}

async function completeProviderJobReconciled(
  pool: pg.Pool,
  input: {
    readonly amount: string;
    readonly jobId: string;
    readonly jobType: CircleProviderJobRecord['job_type'];
    readonly observedKey: string;
    readonly observedValue: string;
    readonly operator: OperatorContext;
    readonly orgId: string;
    readonly providerRef: string | null;
    readonly reconcileMethod: string;
    readonly summary: string;
  },
): Promise<CircleProviderJobRecord> {
  return withTransaction(pool, async (client) => {
    const updated = await client.query<CircleProviderJobRow>(
      `UPDATE circle_provider_jobs
          SET status = 'complete',
              provider_ref = COALESCE(provider_ref, $2),
              error_code = NULL,
              metadata = metadata || $3::jsonb,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        input.jobId,
        input.providerRef,
        JSON.stringify({
          [input.observedKey]: input.observedValue,
          reconcile_method: input.reconcileMethod,
          reconciled_at: new Date().toISOString(),
          reconciled_by: input.operator.actorId,
        }),
      ],
    );
    const row = updated.rows[0];
    if (row === undefined) throw new Error('circle_provider_job_reconcile_update_missing');

    await recordActivity(client, {
      orgId: input.orgId,
      category: 'treasury',
      action: `${input.jobType}.reconciled`,
      outcome: 'success',
      summary: input.summary,
      payload: {
        amount_usdc: input.amount,
        job_id: input.jobId,
        observed_usdc: input.observedValue,
        reconcile_method: input.reconcileMethod,
      },
    });

    await recordAuditEvent(client, {
      orgId: input.orgId,
      idempotencyKey: `circle_provider_job.reconciled:${input.jobId}`,
      eventType: `${input.jobType}.reconciled`,
      actor: { type: input.operator.userId === undefined ? 'system' : 'user', id: input.operator.actorId },
      action: `${input.jobType}.reconciled`,
      outcome: 'success',
      resource: { type: 'circle_provider_job', id: input.jobId },
      classification: {
        domain: 'payment',
        category: 'financial',
        severity: 'info',
        tags: ['section_9', 'circle', 'reconcile'],
      },
      relations: {},
      refs: {},
      source: { section: 'section_9', system: 'payments' },
      retentionClass: 'payment',
      payload: {
        amount_usdc: input.amount,
        observed_usdc: input.observedValue,
        reconcile_method: input.reconcileMethod,
      },
    });

    return providerJobFromRow(row);
  });
}

async function expireStaleCircleProviderJobs(db: Db, orgId: string): Promise<void> {
  await db.query(
    `UPDATE circle_provider_jobs
        SET status = 'failed',
            error_code = 'circle_provider_job_timeout',
            metadata = metadata || jsonb_build_object(
              'error_message', 'circle_provider_job_timeout',
              'timeout_ms', $2::int
            ),
            updated_at = now()
      WHERE org_id = $1
        AND job_type IN ('gateway.deposit', 'wallet.rebalance')
        AND status = 'queued'
        AND updated_at < now() - ($2::text || ' milliseconds')::interval`,
    [orgId, circleProviderJobTimeoutMs()],
  );

  await db.query(
    `UPDATE circle_provider_jobs
        SET status = 'failed',
            error_code = 'circle_provider_job_timeout',
            metadata = metadata || jsonb_build_object(
              'error_message', 'circle_provider_job_timeout',
              'prep_status', 'failed',
              'timeout_ms', $2::int
            ),
            updated_at = now()
      WHERE org_id = $1
        AND job_type = 'liquidity.prepare'
        AND status = 'queued'
        AND updated_at < now() - ($2::text || ' milliseconds')::interval`,
    [orgId, circleProviderJobTimeoutMs()],
  );
}

async function reconcileSatisfiedLiquidityJobsForBalances(
  db: Db,
  orgId: string,
  balances: readonly CircleChainBalanceRecord[],
): Promise<void> {
  const openJobs = await db.query<CircleProviderJobRow>(
    `SELECT *
       FROM circle_provider_jobs
      WHERE org_id = $1
        AND job_type = 'liquidity.prepare'
        AND status IN ('queued', 'submitted')
      ORDER BY created_at ASC
      LIMIT 50`,
    [orgId],
  );

  for (const row of openJobs.rows) {
    if (row.amount_usdc === null || row.chain === null) continue;
    const metadata = objectFromJson(row.metadata);
    const strategy = metadataString(metadata, 'strategy');
    const destinationChain = normalizeChain(metadataString(metadata, 'destination_chain') ?? row.chain);
    const destinationBalance = balances.find((balance) => balance.chain === destinationChain);
    if (destinationBalance === undefined) continue;

    const amountMicros = parseUsdcMicros(formatDbUsdc(row.amount_usdc));
    const destinationTarget = metadataString(metadata, 'destination_target_usdc');
    const destinationTargetMicros = destinationTarget === null ? amountMicros : parseUsdcMicros(destinationTarget);
    const needsGatewayBalance = strategy === 'wallet_to_gateway' || strategy === 'wallet_rebalance_then_gateway_deposit';
    const observedMicros = needsGatewayBalance
      ? destinationBalance.gateway === null ? 0n : parseUsdcMicros(destinationBalance.gateway.available)
      : walletUsdcMicros(destinationBalance);
    if (observedMicros < destinationTargetMicros) continue;

    await db.query(
      `UPDATE circle_provider_jobs
          SET status = 'complete',
              error_code = NULL,
              metadata = metadata || $2::jsonb,
              updated_at = now()
        WHERE id = $1
          AND status IN ('queued', 'submitted')`,
      [
        row.id,
        JSON.stringify({
          prep_status: 'complete',
          reconciled_at: new Date().toISOString(),
          reconciled_by: 'balance_snapshot',
          [needsGatewayBalance ? 'observed_gateway_usdc' : 'observed_wallet_usdc']: formatUsdc(observedMicros),
        }),
      ],
    );
  }
}

function walletUsdcMicros(balance: CircleChainBalanceRecord): bigint {
  const usdc = balance.tokens.find((token) => token.symbol === 'USDC' && !token.is_native);
  if (usdc === undefined) return 0n;
  try {
    return parseUsdcMicros(usdc.amount);
  } catch {
    return 0n;
  }
}

function tokenListUsdcMicros(tokens: readonly CircleTokenBalance[]): bigint {
  const usdc = tokens.find((token) => token.symbol === 'USDC' && !token.isNative);
  if (usdc === undefined) return 0n;
  try {
    return parseUsdcMicros(usdc.amount);
  } catch {
    return 0n;
  }
}

async function providerWalletUsdcMicros(input: {
  readonly mode: PaymentMode;
  readonly provider: CircleTreasuryProvider;
  readonly walletId: string;
}): Promise<bigint | null> {
  try {
    const balances = await input.provider.getWalletBalances({ mode: input.mode, walletId: input.walletId });
    return tokenListUsdcMicros(balances.balances);
  } catch {
    return null;
  }
}

function sourceChainForRebalance(
  balances: readonly CircleChainBalanceRecord[],
  destinationChain: PaymentChain,
  amountMicros: bigint,
): PaymentChain | null {
  const required = amountMicros + EXACT_WALLET_REBALANCE_FEE_BUFFER_MICROS;
  const eligible = balances
    .filter((balance) => balance.chain !== destinationChain)
    .map((balance) => ({ balance, micros: walletUsdcMicros(balance) }))
    .filter((item) => item.micros >= required)
    .sort((left, right) => Number(right.micros - left.micros));
  return eligible[0]?.balance.chain ?? null;
}

function maxMicros(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function positiveDeficitMicros(target: bigint, current: bigint): bigint {
  return target > current ? target - current : 0n;
}

function gatewayUsdcMicros(balance: CircleChainBalanceRecord | undefined): bigint {
  if (balance?.gateway === null || balance?.gateway === undefined) return 0n;
  try {
    return parseUsdcMicros(balance.gateway.available);
  } catch {
    return 0n;
  }
}

function jobUuid(jobId: string): string {
  return jobId.startsWith('cjob_') ? jobId.slice('cjob_'.length) : jobId;
}

async function openLiquidityPreparationJob(
  db: Db,
  input: {
    readonly connectionId: string;
    readonly mode: PaymentMode;
    readonly orgId: string;
    readonly quoteHash: string;
  },
): Promise<CircleProviderJobRecord | null> {
  const existing = await db.query<CircleProviderJobRow>(
    `SELECT *
       FROM circle_provider_jobs
      WHERE org_id = $1
        AND mode = $2
        AND job_type = 'liquidity.prepare'
        AND status IN ('queued', 'submitted')
        AND metadata ->> 'connection_id' = $3
        AND metadata ->> 'payment_quote_hash' = $4
      ORDER BY created_at ASC
      LIMIT 1`,
    [input.orgId, input.mode, input.connectionId, input.quoteHash],
  );
  const row = existing.rows[0];
  return row === undefined ? null : providerJobFromRow(row);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

async function createGatewayLiquidityPreparationJob(
  db: Db,
  input: {
    readonly auth: ConnectionAuthResult;
    readonly mode: PaymentMode;
    readonly quote: RuntimeQuote;
    readonly resource: ReturnType<typeof x402Resource>;
    readonly paymentInput: RuntimeX402PaymentInput;
    readonly provider: CircleTreasuryProvider;
    readonly reasonCode?: 'gateway_balance_unavailable' | 'gateway_bucket_below_request' | undefined;
  },
): Promise<CircleProviderJobRecord> {
  if (input.mode === 'live' && process.env.CIRCLE_LIVE_REBALANCE_ENABLED !== 'true') {
    throw conflict('unsupported_gasless_payment_route', 'Live liquidity preparation is disabled until explicitly enabled.');
  }

  const health = input.provider.health(input.mode);
  if (!health.configured) {
    throw conflict(
      'circle_provider_not_configured',
      `Circle ${input.mode} provider is missing ${health.missing.join(', ')}.`,
    );
  }

  const quoteHash = sha256Hex({
    accept: input.quote.accept,
    agentId: input.auth.agent_id,
    connectionId: input.auth.connection_id,
    mode: input.mode,
    resource: input.paymentInput.resource ?? {},
    x402: {
      amount: input.quote.x402Amount,
      network: input.quote.x402Network,
      rail: input.quote.rail,
    },
  });
  const existing = await openLiquidityPreparationJob(db, {
    connectionId: input.auth.connection_id,
    mode: input.mode,
    orgId: input.auth.org_id,
    quoteHash,
  });
  if (existing !== null) return existing;

  const balances = await listCircleBalances(db, input.auth.org_id, input.provider);
  const destinationBalance = balances.find((balance) => balance.chain === input.quote.chain);
  const destinationGatewayMicros = gatewayUsdcMicros(destinationBalance);
  const destinationTargetMicros = maxMicros(input.quote.amountMicros, CIRCLE_GATEWAY_MIN_DEPOSIT_MICROS);
  const gatewayDeficitMicros = positiveDeficitMicros(destinationTargetMicros, destinationGatewayMicros);
  const prepMicros = maxMicros(gatewayDeficitMicros, CIRCLE_GATEWAY_MIN_DEPOSIT_MICROS);
  const destinationWalletMicros = destinationBalance === undefined ? 0n : walletUsdcMicros(destinationBalance);
  const bridgeDeficitMicros = positiveDeficitMicros(prepMicros, destinationWalletMicros);
  const sourceChain =
    bridgeDeficitMicros === 0n
      ? input.quote.chain
      : sourceChainForRebalance(balances, input.quote.chain, bridgeDeficitMicros);

  if (sourceChain === null) {
    throw conflict(
      'unsupported_gasless_payment_route',
      `No gasless treasury route has enough USDC to prepare ${input.quote.chain} Gateway liquidity.`,
    );
  }

  const strategy =
    sourceChain === input.quote.chain
      ? 'wallet_to_gateway'
      : 'wallet_rebalance_then_gateway_deposit';
  const jobId = prefixedId('cjob');
  let inserted: pg.QueryResult<CircleProviderJobRow>;
  try {
    inserted = await db.query<CircleProviderJobRow>(
    `INSERT INTO circle_provider_jobs (
       id, org_id, mode, job_type, chain, status, amount_usdc, metadata, created_by
     )
     VALUES ($1, $2, $3, 'liquidity.prepare', $4, 'queued', $5::numeric, $6::jsonb, $7)
     RETURNING *`,
    [
      jobId,
      input.auth.org_id,
      input.mode,
      input.quote.chain,
      formatUsdc(prepMicros),
      JSON.stringify({
        agent_id: input.auth.agent_id,
        connection_id: input.auth.connection_id,
        destination_before_usdc: formatUsdc(destinationGatewayMicros),
        destination_bucket: `gateway:${input.quote.chain}`,
        destination_chain: input.quote.chain,
        destination_target_usdc: formatUsdc(destinationTargetMicros),
        destination_wallet_before_usdc: formatUsdc(destinationWalletMicros),
        destination_wallet_target_usdc: formatUsdc(prepMicros),
        gasless_verified: true,
        payment_amount_usdc: input.quote.amount,
        payment_quote_hash: quoteHash,
        rail: input.quote.rail,
        reason_code: input.reasonCode ?? 'gateway_bucket_below_request',
        resource_category: input.resource.category,
        resource_url: input.resource.url,
        retry_after_seconds: LIQUIDITY_PREP_RETRY_AFTER_SECONDS,
        bridge_idempotency_key: jobUuid(jobId),
        source_bucket: `wallet:${sourceChain}`,
        source_chain: sourceChain,
        strategy,
      }),
      input.auth.connection_id,
    ],
  );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const concurrent = await openLiquidityPreparationJob(db, {
      connectionId: input.auth.connection_id,
      mode: input.mode,
      orgId: input.auth.org_id,
      quoteHash,
    });
    if (concurrent !== null) return concurrent;
    throw error;
  }
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('liquidity_prepare_job_insert_failed');

  await recordActivity(db, {
    orgId: input.auth.org_id,
    agentId: input.auth.agent_id,
    connectionId: input.auth.connection_id,
    category: 'treasury',
    action: 'liquidity.prepare.queued',
    outcome: 'pending',
    summary: `Preparing ${formatUsdc(prepMicros)} USDC for ${input.quote.rail}`,
    payload: {
      amount_usdc: formatUsdc(prepMicros),
      chain: input.quote.chain,
      destination_bucket: `gateway:${input.quote.chain}`,
      job_id: jobId,
      rail: input.quote.rail,
      source_bucket: `wallet:${sourceChain}`,
      strategy,
    },
  });

  return providerJobFromRow(row);
}

async function createExactLiquidityPreparationJob(
  db: Db,
  input: {
    readonly auth: ConnectionAuthResult;
    readonly mode: PaymentMode;
    readonly quote: RuntimeQuote;
    readonly resource: ReturnType<typeof x402Resource>;
    readonly paymentInput: RuntimeX402PaymentInput;
    readonly provider: CircleTreasuryProvider;
  },
): Promise<CircleProviderJobRecord> {
  if (input.mode === 'live' && process.env.CIRCLE_LIVE_REBALANCE_ENABLED !== 'true') {
    throw conflict('unsupported_gasless_payment_route', 'Live exact-wallet liquidity preparation is disabled until explicitly enabled.');
  }

  const health = input.provider.health(input.mode);
  if (!health.configured) {
    throw conflict(
      'circle_provider_not_configured',
      `Circle ${input.mode} provider is missing ${health.missing.join(', ')}.`,
    );
  }

  const quoteHash = sha256Hex({
    accept: input.quote.accept,
    agentId: input.auth.agent_id,
    connectionId: input.auth.connection_id,
    mode: input.mode,
    resource: input.paymentInput.resource ?? {},
    x402: {
      amount: input.quote.x402Amount,
      network: input.quote.x402Network,
      rail: input.quote.rail,
    },
  });
  const existing = await openLiquidityPreparationJob(db, {
    connectionId: input.auth.connection_id,
    mode: input.mode,
    orgId: input.auth.org_id,
    quoteHash,
  });
  if (existing !== null) return existing;

  const balances = await listCircleBalances(db, input.auth.org_id, input.provider);
  const destinationBalance = balances.find((balance) => balance.chain === input.quote.chain);
  const destinationBeforeMicros = destinationBalance === undefined ? 0n : walletUsdcMicros(destinationBalance);
  const destinationTargetMicros = maxMicros(input.quote.amountMicros, EXACT_WALLET_REBALANCE_MIN_MICROS);
  const prepMicros = positiveDeficitMicros(destinationTargetMicros, destinationBeforeMicros);
  const sourceChain = sourceChainForRebalance(balances, input.quote.chain, prepMicros);
  if (sourceChain === null) {
    throw conflict(
      'unsupported_gasless_payment_route',
      `No gasless treasury route has enough USDC to prepare ${input.quote.chain} exact-wallet liquidity.`,
    );
  }

  const jobId = prefixedId('cjob');
  let inserted: pg.QueryResult<CircleProviderJobRow>;
  try {
    inserted = await db.query<CircleProviderJobRow>(
    `INSERT INTO circle_provider_jobs (
       id, org_id, mode, job_type, chain, status, amount_usdc, metadata, created_by
     )
     VALUES ($1, $2, $3, 'liquidity.prepare', $4, 'queued', $5::numeric, $6::jsonb, $7)
     RETURNING *`,
    [
      jobId,
      input.auth.org_id,
      input.mode,
      input.quote.chain,
      formatUsdc(prepMicros),
      JSON.stringify({
        agent_id: input.auth.agent_id,
        connection_id: input.auth.connection_id,
        destination_before_usdc: formatUsdc(destinationBeforeMicros),
        destination_bucket: `wallet:${input.quote.chain}`,
        destination_chain: input.quote.chain,
        destination_target_usdc: formatUsdc(destinationTargetMicros),
        gasless_verified: true,
        payment_amount_usdc: input.quote.amount,
        payment_quote_hash: quoteHash,
        rail: input.quote.rail,
        reason_code: 'exact_wallet_below_request',
        resource_category: input.resource.category,
        resource_url: input.resource.url,
        retry_after_seconds: LIQUIDITY_PREP_RETRY_AFTER_SECONDS,
        bridge_idempotency_key: jobUuid(jobId),
        source_bucket: `wallet:${sourceChain}`,
        source_chain: sourceChain,
        strategy: 'wallet_rebalance',
      }),
      input.auth.connection_id,
    ],
  );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const concurrent = await openLiquidityPreparationJob(db, {
      connectionId: input.auth.connection_id,
      mode: input.mode,
      orgId: input.auth.org_id,
      quoteHash,
    });
    if (concurrent !== null) return concurrent;
    throw error;
  }
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('liquidity_prepare_job_insert_failed');

  await recordActivity(db, {
    orgId: input.auth.org_id,
    agentId: input.auth.agent_id,
    connectionId: input.auth.connection_id,
    category: 'treasury',
    action: 'liquidity.prepare.queued',
    outcome: 'pending',
    summary: `Preparing ${formatUsdc(prepMicros)} USDC for ${input.quote.rail}`,
    payload: {
      amount_usdc: formatUsdc(prepMicros),
      chain: input.quote.chain,
      destination_bucket: `wallet:${input.quote.chain}`,
      job_id: jobId,
      rail: input.quote.rail,
      source_bucket: `wallet:${sourceChain}`,
      strategy: 'wallet_rebalance',
    },
  });

  return providerJobFromRow(row);
}

type ExactSpendRow = {
  readonly chain: string;
  readonly recent_exact_spend_usdc: string;
};

export async function listRebalanceRecommendations(
  pool: pg.Pool,
  orgId: string,
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
  redis?: Redis,
): Promise<RebalanceRecommendationRecord[]> {
  const balances = await listCircleBalances(pool, orgId, provider, redis);
  return listRebalanceRecommendationsForBalances(pool, orgId, balances);
}

async function listRebalanceRecommendationsForBalances(
  pool: pg.Pool,
  orgId: string,
  balances: readonly CircleChainBalanceRecord[],
): Promise<RebalanceRecommendationRecord[]> {
  const spend = await pool.query<ExactSpendRow>(
    `SELECT replace(supported_rail, 'exact_', '') AS chain,
            COALESCE(sum(amount_usdc), 0)::text AS recent_exact_spend_usdc
       FROM payment_route_observations
      WHERE org_id = $1
        AND outcome = 'accepted'
        AND supported_rail LIKE 'exact_%'
        AND observed_at >= now() - interval '24 hours'
      GROUP BY replace(supported_rail, 'exact_', '')`,
    [orgId],
  );

  const recommendations: RebalanceRecommendationRecord[] = [];
  for (const row of spend.rows) {
    const chain = normalizeChain(row.chain);
    const recentSpendMicros = parseUsdcMicros(row.recent_exact_spend_usdc);
    if (recentSpendMicros <= 0n) continue;
    const recommendedMinMicros = recentSpendMicros * 5n > EXACT_WALLET_REBALANCE_MIN_MICROS
      ? recentSpendMicros * 5n
      : EXACT_WALLET_REBALANCE_MIN_MICROS;
    const balance = balances.find((item) => item.chain === chain);
    const currentWalletMicros = balance === undefined ? 0n : walletUsdcMicros(balance);
    if (currentWalletMicros >= recommendedMinMicros) continue;
    const deficitMicros = recommendedMinMicros - currentWalletMicros;
    const sourceChain = sourceChainForRebalance(balances, chain, deficitMicros);
    if (sourceChain === null) continue;
    recommendations.push({
      amount_usdc: formatUsdc(deficitMicros),
      chain,
      current_wallet_usdc: formatUsdc(currentWalletMicros),
      deficit_usdc: formatUsdc(deficitMicros),
      reason_code: 'exact_wallet_below_recent_demand_floor',
      recent_exact_spend_usdc: formatUsdc(recentSpendMicros),
      recommended_min_usdc: formatUsdc(recommendedMinMicros),
      source_chain: sourceChain,
    });
  }

  return recommendations.sort((left, right) => right.deficit_usdc.localeCompare(left.deficit_usdc));
}

async function activeCircleWallet(
  db: Db,
  orgId: string,
  mode: PaymentMode,
  chain: PaymentChain,
): Promise<CircleChainWalletRow> {
  const result = await db.query<CircleChainWalletRow>(
    `SELECT *
       FROM circle_chain_wallets
      WHERE org_id = $1
        AND mode = $2
        AND chain = $3
        AND status = 'active'
      LIMIT 1`,
    [orgId, mode, chain],
  );
  const row = result.rows[0];
  if (row === undefined) throw conflict('circle_wallet_missing', 'Create the Circle org treasury before depositing to Gateway.');
  return row;
}

export async function bridgeExactWalletTopUp(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: { readonly amount_usdc: string; readonly from_chain: PaymentChain; readonly to_chain: PaymentChain },
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
): Promise<CircleProviderJobRecord> {
  const fromChain = normalizeChain(input.from_chain);
  const toChain = normalizeChain(input.to_chain);
  if (fromChain === toChain) throw badRequest('rebalance_same_chain', 'Exact wallet top-up source and destination must be different chains.');
  const mode = (await getOrgPaymentMode(pool, orgId)).mode;
  if (mode === 'live' && process.env.CIRCLE_LIVE_REBALANCE_ENABLED !== 'true') {
    throw conflict('live_rebalance_disabled', 'Live exact-wallet rebalancing is disabled until explicitly enabled.');
  }
  const health = provider.health(mode);
  if (!health.configured) {
    throw conflict(
      'circle_provider_not_configured',
      `Circle ${mode} provider is missing ${health.missing.join(', ')}.`,
    );
  }
  const amount = assertPositiveUsdc(input.amount_usdc, 'amount_usdc');
  const amountMicros = parseUsdcMicros(amount);
  if (mode === 'live' && amountMicros > 10_000_000n) {
    throw badRequest('live_rebalance_amount_cap', 'Live exact-wallet rebalancing is capped at 10 USDC per request.');
  }

  const [fromWallet, toWallet, balances] = await Promise.all([
    activeCircleWallet(pool, orgId, mode, fromChain),
    activeCircleWallet(pool, orgId, mode, toChain),
    listCircleBalances(pool, orgId, provider),
  ]);
  const fromBalance = balances.find((balance) => balance.chain === fromChain);
  const toBalance = balances.find((balance) => balance.chain === toChain);
  const availableMicros = fromBalance === undefined ? 0n : walletUsdcMicros(fromBalance);
  const destinationBeforeMicros = toBalance === undefined ? 0n : walletUsdcMicros(toBalance);
  const requiredMicros = amountMicros + EXACT_WALLET_REBALANCE_FEE_BUFFER_MICROS;
  if (availableMicros < requiredMicros) {
    throw conflict(
      'rebalance_source_insufficient',
      `Source wallet needs at least ${formatUsdc(requiredMicros)} USDC including a conservative bridge fee buffer.`,
    );
  }

  const jobId = prefixedId('cjob');
  const inserted = await pool.query<CircleProviderJobRow>(
    `INSERT INTO circle_provider_jobs (
       id, org_id, mode, job_type, chain, status, amount_usdc, metadata, created_by
     )
     VALUES ($1, $2, $3, 'wallet.rebalance', $4, 'queued', $5::numeric, $6::jsonb, $7)
     RETURNING *`,
    [
      jobId,
      orgId,
      mode,
      toChain,
      amount,
      JSON.stringify({
        amount_micros: amountMicros.toString(),
        bridge_idempotency_key: jobUuid(jobId),
        destination_wallet_before_usdc: formatUsdc(destinationBeforeMicros),
        fee_buffer_micros: EXACT_WALLET_REBALANCE_FEE_BUFFER_MICROS.toString(),
        from_address: fromWallet.address,
        from_chain: fromChain,
        from_wallet_id: fromWallet.circle_wallet_id,
        to_address: toWallet.address,
        to_chain: toChain,
        to_wallet_id: toWallet.circle_wallet_id,
      }),
      operator.actorId,
    ],
  );
  if (inserted.rows[0] === undefined) throw new Error('circle_rebalance_job_insert_failed');

  try {
    await pool.query(
      `UPDATE circle_provider_jobs
          SET status = 'submitted',
              metadata = metadata || jsonb_build_object('provider_operation_started_at', now()),
              updated_at = now()
        WHERE id = $1`,
      [jobId],
    );
    const result = await withCircleProviderTimeout(
      provider.bridgeWalletTopUp({
        amount,
        fromAddress: fromWallet.address,
        fromChain,
        idempotencyKey: jobUuid(jobId),
        mode,
        toAddress: toWallet.address,
        toChain,
      }),
      'circle_rebalance_provider_timeout',
    );
    return withTransaction(pool, async (client) => {
      const status = circleProviderStatusForResult(result.success, result.errorReason);
      const isSubmitted = status === 'submitted';
      const updated = await client.query<CircleProviderJobRow>(
        `UPDATE circle_provider_jobs
            SET status = $2,
                provider_ref = $3,
                error_code = $4,
                metadata = metadata || $5::jsonb,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          jobId,
          status,
          result.transaction ?? null,
          result.success ? null : circleProviderErrorCode('circle_rebalance_failed', result.errorReason),
          JSON.stringify({
            error_message: result.success ? null : result.errorReason ?? 'circle_rebalance_failed',
            transfer_transaction_id: result.transaction ?? null,
          }),
        ],
      );
      const row = updated.rows[0];
      if (row === undefined) throw new Error('circle_rebalance_job_update_failed');

      await recordActivity(client, {
        orgId,
        category: 'treasury',
        action: result.success ? 'wallet.rebalance.complete' : isSubmitted ? 'wallet.rebalance.submitted' : 'wallet.rebalance.failed',
        outcome: result.success ? 'success' : isSubmitted ? 'pending' : 'error',
        summary: result.success
          ? `${amount} USDC bridged from ${fromChain} to ${toChain}`
          : isSubmitted
            ? `Exact wallet top-up from ${fromChain} to ${toChain} submitted and awaiting reconciliation`
          : `Exact wallet top-up from ${fromChain} to ${toChain} failed`,
        payload: {
          amount_usdc: amount,
          error_reason: result.errorReason ?? null,
          from_chain: fromChain,
          mode,
          to_chain: toChain,
          transfer_transaction_id: result.transaction ?? null,
        },
      });

      await recordAuditEvent(client, {
        orgId,
        idempotencyKey: `wallet.rebalance:${jobId}`,
        eventType: result.success ? 'wallet.rebalance.complete' : isSubmitted ? 'wallet.rebalance.submitted' : 'wallet.rebalance.failed',
        actor: { type: 'user', id: operator.actorId },
        action: result.success ? 'wallet.rebalance.complete' : isSubmitted ? 'wallet.rebalance.submitted' : 'wallet.rebalance.failed',
        outcome: result.success ? 'success' : isSubmitted ? 'pending' : 'error',
        resource: { type: 'circle_provider_job', id: jobId },
        classification: {
          domain: 'payment',
          category: 'financial',
          severity: result.success ? 'info' : 'warning',
          tags: ['section_9', 'wallet', 'rebalance', fromChain, toChain],
        },
        relations: {},
        refs: {},
        source: { section: 'section_9', system: 'payments' },
        retentionClass: 'payment',
        payload: {
          amount_usdc: amount,
          error_reason: result.errorReason ?? null,
          from_chain: fromChain,
          mode,
          to_chain: toChain,
          transfer_transaction_id: result.transaction ?? null,
        },
      });

      return providerJobFromRow(row);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'circle_rebalance_failed';
    const status = circleProviderStatusForResult(false, message);
    const failed = await pool.query<CircleProviderJobRow>(
      `UPDATE circle_provider_jobs
          SET status = $2,
              error_code = $3,
              metadata = metadata || $4::jsonb,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        jobId,
        status,
        circleProviderErrorCode('circle_rebalance_failed', message),
        JSON.stringify({ error_message: message }),
      ],
    );
    const row = failed.rows[0];
    if (row !== undefined) return providerJobFromRow(row);
    throw conflict('circle_rebalance_failed', message);
  }
}

export async function initiateCircleGatewayDeposit(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: { readonly amount_usdc: string; readonly chain: PaymentChain },
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
): Promise<CircleProviderJobRecord> {
  const mode = (await getOrgPaymentMode(pool, orgId)).mode;
  const health = provider.health(mode);
  if (!health.configured) {
    throw conflict(
      'circle_provider_not_configured',
      `Circle ${mode} provider is missing ${health.missing.join(', ')}.`,
    );
  }
  const amount = assertPositiveUsdc(input.amount_usdc, 'amount_usdc');
  const amountMicros = parseUsdcMicros(amount);
  if (amountMicros < CIRCLE_GATEWAY_MIN_DEPOSIT_MICROS) {
    throw badRequest('gateway_deposit_minimum', 'Gateway deposits must be at least 0.5 USDC.');
  }
  const wallet = await activeCircleWallet(pool, orgId, mode, input.chain);
  const gatewayDepositorAddress = resolveGatewayDepositorAddress(wallet.address, wallet.metadata);
  const gatewayBefore = await provider.getGatewayBalance({
    address: gatewayDepositorAddress,
    chain: input.chain,
    mode,
  }).catch(() => null);
  const jobId = prefixedId('cjob');
  const inserted = await pool.query<CircleProviderJobRow>(
    `INSERT INTO circle_provider_jobs (
       id, org_id, mode, job_type, chain, status, amount_usdc, metadata, created_by
     )
     VALUES ($1, $2, $3, 'gateway.deposit', $4, 'queued', $5::numeric, $6::jsonb, $7)
     RETURNING *`,
    [
      jobId,
      orgId,
      mode,
      input.chain,
      amount,
      JSON.stringify({
        address: wallet.address,
        circle_wallet_id: wallet.circle_wallet_id,
        gateway_before_usdc: gatewayBefore?.available ?? null,
        wallet_set_id: wallet.wallet_set_id,
      }),
      operator.actorId,
    ],
  );
  const queuedJob = inserted.rows[0];
  if (queuedJob === undefined) throw new Error('circle_gateway_deposit_job_insert_failed');

  try {
    await pool.query(
      `UPDATE circle_provider_jobs
          SET status = 'submitted',
              metadata = metadata || jsonb_build_object('provider_operation_started_at', now()),
              updated_at = now()
        WHERE id = $1`,
      [jobId],
    );
    const submitted = await withCircleProviderTimeout(
      provider.initiateGatewayDeposit({
        address: wallet.address,
        amountMicros,
        chain: input.chain,
        mode,
        walletId: wallet.circle_wallet_id,
      }),
      'circle_gateway_deposit_provider_timeout',
    );
    return withTransaction(pool, async (client) => {
      const updated = await client.query<CircleProviderJobRow>(
        `UPDATE circle_provider_jobs
            SET status = 'complete',
                provider_ref = $2,
                metadata = metadata || $3::jsonb,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          jobId,
          submitted.depositTransactionId,
          JSON.stringify({
            approval_transaction_id: submitted.approvalTransactionId,
            amount_micros: submitted.amountMicros,
            completed_by: operator.actorId,
            deposit_transaction_id: submitted.depositTransactionId,
            gateway_depositor_address: submitted.gatewayDepositorAddress,
            gateway_wallet_address: submitted.gatewayWalletAddress,
            provider_confirmed_at: new Date().toISOString(),
            reconcile_method: 'provider_confirmed',
            usdc_address: submitted.usdcAddress,
          }),
        ],
      );
      await client.query(
        `UPDATE circle_chain_wallets
            SET metadata = metadata || jsonb_build_object('gateway_depositor_address', $2::text),
                updated_at = now()
          WHERE id = $1`,
        [wallet.id, submitted.gatewayDepositorAddress],
      );
      const row = updated.rows[0];
      if (row === undefined) throw new Error('circle_gateway_deposit_job_update_failed');

      await recordActivity(client, {
        orgId,
        category: 'treasury',
        action: 'gateway.deposit.complete',
        outcome: 'success',
        summary: `${amount} USDC Gateway deposit completed on ${input.chain}`,
        payload: {
          amount_usdc: amount,
          chain: input.chain,
          mode,
          provider_ref: submitted.depositTransactionId,
          approval_transaction_id: submitted.approvalTransactionId,
          gateway_depositor_address: submitted.gatewayDepositorAddress,
        },
      });

      await recordAuditEvent(client, {
        orgId,
        idempotencyKey: `gateway.deposit.complete:${jobId}`,
        eventType: 'gateway.deposit.complete',
        actor: { type: 'user', id: operator.actorId },
        action: 'gateway.deposit.complete',
        outcome: 'success',
        resource: { type: 'circle_provider_job', id: jobId },
        classification: {
          domain: 'payment',
          category: 'financial',
          severity: 'info',
          tags: ['section_9', 'gateway', 'deposit', input.chain],
        },
        relations: {},
        refs: {},
        source: { section: 'section_9', system: 'payments' },
        retentionClass: 'payment',
        payload: {
          amount_usdc: amount,
          chain: input.chain,
          mode,
          provider_ref: submitted.depositTransactionId,
          approval_transaction_id: submitted.approvalTransactionId,
        },
      });

      return providerJobFromRow(row);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'circle_gateway_deposit_failed';
    const status = circleProviderStatusForResult(false, message);
    const failed = await pool.query<CircleProviderJobRow>(
      `UPDATE circle_provider_jobs
          SET status = $2,
              error_code = $3,
              metadata = metadata || $4::jsonb,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        jobId,
        status,
        circleProviderErrorCode('circle_gateway_deposit_failed', message),
        JSON.stringify({ error_message: message }),
      ],
    );
    const row = failed.rows[0];
    if (row !== undefined) return providerJobFromRow(row);
    throw conflict('circle_gateway_deposit_failed', message);
  }
}

export async function listLiquidityJobs(
  pool: pg.Pool,
  orgId: string,
  limit = 20,
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
): Promise<CircleProviderJobRecord[]> {
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  await expireStaleCircleProviderJobs(pool, orgId);
  const balances = await listCircleBalances(pool, orgId, provider);
  await reconcileSatisfiedLiquidityJobsForBalances(pool, orgId, balances);
  const result = await pool.query<CircleProviderJobRow>(
    `SELECT *
       FROM circle_provider_jobs
      WHERE org_id = $1
        AND job_type = 'liquidity.prepare'
      ORDER BY created_at DESC
      LIMIT $2`,
    [orgId, boundedLimit],
  );
  return result.rows.map(providerJobFromRow);
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  return stringValue(metadata[key]);
}

async function failLiquidityJob(
  db: Db,
  input: {
    readonly jobId: string;
    readonly errorCode: string;
    readonly message: string;
    readonly metadata?: Record<string, unknown> | undefined;
  },
): Promise<CircleProviderJobRecord> {
  const failed = await db.query<CircleProviderJobRow>(
    `UPDATE circle_provider_jobs
        SET status = 'failed',
            error_code = $2,
            metadata = metadata || $3::jsonb,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      input.jobId,
      input.errorCode.slice(0, 120),
      JSON.stringify({ ...(input.metadata ?? {}), error_message: input.message, prep_status: 'failed' }),
    ],
  );
  const row = failed.rows[0];
  if (row === undefined) throw new Error('liquidity_prepare_job_failed_update_missing');
  return providerJobFromRow(row);
}

async function submitLiquidityJobAwaitingGatewayBalance(
  db: Db,
  input: {
    readonly amount: string;
    readonly bridgeStatus: string | null;
    readonly bridgeTransactionId: string | null;
    readonly depositTransactionId: string | null;
    readonly destinationChain: PaymentChain;
    readonly jobId: string;
    readonly observedGatewayUsdc: string | null;
    readonly operator: OperatorContext;
    readonly orgId: string;
    readonly sourceChain: PaymentChain;
    readonly strategy: string;
  },
): Promise<CircleProviderJobRecord> {
  const submitted = await db.query<CircleProviderJobRow>(
    `UPDATE circle_provider_jobs
        SET status = 'submitted',
            provider_ref = $2,
            error_code = NULL,
            metadata = metadata || $3::jsonb,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      input.jobId,
      input.depositTransactionId ?? input.bridgeTransactionId,
      JSON.stringify({
        bridge_status: input.bridgeStatus,
        bridge_transaction_id: input.bridgeTransactionId,
        deposit_transaction_id: input.depositTransactionId,
        observed_gateway_usdc: input.observedGatewayUsdc,
        prep_status: 'awaiting_gateway_balance',
        retry_after_seconds: LIQUIDITY_PREP_RETRY_AFTER_SECONDS,
      }),
    ],
  );
  const row = submitted.rows[0];
  if (row === undefined) throw new Error('liquidity_prepare_job_submitted_update_missing');

  await recordActivity(db, {
    orgId: input.orgId,
    category: 'treasury',
    action: 'liquidity.prepare.submitted',
    outcome: 'pending',
    summary: `${input.amount} USDC Gateway liquidity is awaiting confirmations on ${input.destinationChain}`,
    payload: {
      amount_usdc: input.amount,
      bridge_status: input.bridgeStatus,
      bridge_transaction_id: input.bridgeTransactionId,
      deposit_transaction_id: input.depositTransactionId,
      destination_chain: input.destinationChain,
      job_id: input.jobId,
      observed_gateway_usdc: input.observedGatewayUsdc,
      source_chain: input.sourceChain,
      strategy: input.strategy,
      submitted_by: input.operator.actorId,
    },
  });

  return providerJobFromRow(row);
}

export async function retryLiquidityJob(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  jobId: string,
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
): Promise<CircleProviderJobRecord> {
  const existing = await pool.query<CircleProviderJobRow>(
    `SELECT *
       FROM circle_provider_jobs
      WHERE org_id = $1
        AND id = $2
        AND job_type = 'liquidity.prepare'
      LIMIT 1`,
    [orgId, jobId],
  );
  const row = existing.rows[0];
  if (row === undefined) throw notFound('Liquidity job was not found.');
  if (row.status === 'complete') return providerJobFromRow(row);
  if (row.status === 'blocked') throw conflict('liquidity_job_blocked', 'Liquidity job is blocked and cannot be retried.');

  const metadata = objectFromJson(row.metadata);
  const strategy = metadataString(metadata, 'strategy');
  const sourceChainRaw = metadataString(metadata, 'source_chain');
  const destinationChainRaw = metadataString(metadata, 'destination_chain') ?? row.chain;
  if (row.amount_usdc === null || row.chain === null || sourceChainRaw === null || destinationChainRaw === null) {
    return failLiquidityJob(pool, {
      errorCode: 'liquidity_job_metadata_invalid',
      jobId,
      message: 'Liquidity job is missing amount, chain, or route metadata.',
    });
  }
  if (
    strategy !== 'wallet_to_gateway' &&
    strategy !== 'wallet_rebalance_then_gateway_deposit' &&
    strategy !== 'wallet_rebalance'
  ) {
    return failLiquidityJob(pool, {
      errorCode: 'liquidity_strategy_invalid',
      jobId,
      message: 'Liquidity job strategy is not supported.',
    });
  }

  const sourceChain = normalizeChain(sourceChainRaw);
  const destinationChain = normalizeChain(destinationChainRaw);
  const mode = row.mode;
  if (mode === 'live' && process.env.CIRCLE_LIVE_REBALANCE_ENABLED !== 'true') {
    throw conflict('live_rebalance_disabled', 'Live liquidity preparation is disabled until explicitly enabled.');
  }

  const health = provider.health(mode);
  if (!health.configured) {
    throw conflict(
      'circle_provider_not_configured',
      `Circle ${mode} provider is missing ${health.missing.join(', ')}.`,
    );
  }

  const amount = formatDbUsdc(row.amount_usdc);
  const amountMicros = parseUsdcMicros(amount);
  const destinationTarget = metadataString(metadata, 'destination_target_usdc');
  const destinationTargetMicros = destinationTarget === null ? amountMicros : parseUsdcMicros(destinationTarget);
  let bridgeTransactionId: string | null = metadataString(metadata, 'bridge_transaction_id');
  let bridgeStatus: string | null = metadataString(metadata, 'bridge_status');
  let depositTransactionId: string | null = metadataString(metadata, 'deposit_transaction_id');
  let gatewayAlreadySufficient = false;
  let observedGatewayUsdc: string | null = null;
  try {
    const sourceWallet = await activeCircleWallet(pool, orgId, mode, sourceChain);
    const destinationWallet = await activeCircleWallet(pool, orgId, mode, destinationChain);
    const needsGatewayBalance = strategy === 'wallet_to_gateway' || strategy === 'wallet_rebalance_then_gateway_deposit';
    let gatewayDepositorAddress = resolveGatewayDepositorAddress(destinationWallet.address, {
      ...objectFromJson(destinationWallet.metadata),
      ...metadata,
    });

    if (needsGatewayBalance) {
      try {
        const gatewayBalance = await provider.getGatewayBalance({
          address: gatewayDepositorAddress,
          chain: destinationChain,
          mode,
        });
        const gatewayMicros = parseUsdcMicros(gatewayBalance.available);
        observedGatewayUsdc = formatUsdc(gatewayMicros);
        if (gatewayMicros >= destinationTargetMicros) {
          gatewayAlreadySufficient = true;
          bridgeStatus = bridgeStatus ?? 'already_sufficient_gateway_balance';
        }
      } catch {
        observedGatewayUsdc = null;
      }
    }

    if (
      !gatewayAlreadySufficient &&
      (strategy === 'wallet_rebalance_then_gateway_deposit' || strategy === 'wallet_rebalance') &&
      bridgeTransactionId === null &&
      depositTransactionId === null
    ) {
      const destinationWalletMicros = await providerWalletUsdcMicros({
        mode,
        provider,
        walletId: destinationWallet.circle_wallet_id,
      });
      const walletTargetMicros = strategy === 'wallet_rebalance' ? destinationTargetMicros : amountMicros;
      const bridgeAmountMicros = destinationWalletMicros === null
        ? amountMicros
        : positiveDeficitMicros(walletTargetMicros, destinationWalletMicros);
      if (bridgeAmountMicros === 0n) {
        bridgeStatus = 'already_sufficient_destination_balance';
      } else {
        if (bridgeAmountMicros > amountMicros) {
          return failLiquidityJob(pool, {
            errorCode: 'liquidity_destination_balance_regressed',
            jobId,
            message: 'Destination liquidity fell below the balance used to size this preparation job. Retry the payment to create a new deficit-aware job.',
            metadata: {
              destination_target_usdc: formatUsdc(walletTargetMicros),
              observed_destination_wallet_usdc: destinationWalletMicros === null ? null : formatUsdc(destinationWalletMicros),
            },
          });
        }
        const bridgeAmount = formatUsdc(bridgeAmountMicros);
        const bridge = await provider.bridgeWalletTopUp({
          amount: bridgeAmount,
          fromAddress: sourceWallet.address,
          fromChain: sourceChain,
          idempotencyKey: metadataString(metadata, 'bridge_idempotency_key') ?? jobUuid(jobId),
          mode,
          toAddress: destinationWallet.address,
          toChain: destinationChain,
        });
        if (!bridge.success) {
          return failLiquidityJob(pool, {
            errorCode: bridge.errorReason ?? 'circle_rebalance_failed',
            jobId,
            message: bridge.errorReason ?? 'Circle wallet rebalance failed.',
          });
        }
        bridgeStatus = 'submitted';
        bridgeTransactionId = bridge.transaction ?? null;
        await pool.query(
          `UPDATE circle_provider_jobs
              SET status = 'submitted',
                  provider_ref = COALESCE($2, provider_ref),
                  metadata = metadata || $3::jsonb,
                  updated_at = now()
            WHERE id = $1`,
          [
            jobId,
            bridgeTransactionId,
            JSON.stringify({
              bridge_amount_usdc: bridgeAmount,
              bridge_status: bridgeStatus,
              bridge_transaction_id: bridgeTransactionId,
              prep_status: 'bridge_submitted',
            }),
          ],
        );
      }
    }

    if (!gatewayAlreadySufficient && needsGatewayBalance) {
      if (depositTransactionId === null) {
        const deposit = await provider.initiateGatewayDeposit({
          address: destinationWallet.address,
          amountMicros,
          chain: destinationChain,
          mode,
          walletId: destinationWallet.circle_wallet_id,
        });
        depositTransactionId = deposit.depositTransactionId;
        gatewayDepositorAddress = deposit.gatewayDepositorAddress;
        await pool.query(
          `UPDATE circle_provider_jobs
              SET status = 'submitted',
                  provider_ref = $2,
                  metadata = metadata || $3::jsonb,
                  updated_at = now()
            WHERE id = $1`,
          [
            jobId,
            depositTransactionId,
            JSON.stringify({
              deposit_transaction_id: depositTransactionId,
              gateway_depositor_address: gatewayDepositorAddress,
              prep_status: 'gateway_deposit_submitted',
            }),
          ],
        );
        await pool.query(
          `UPDATE circle_chain_wallets
              SET metadata = metadata || jsonb_build_object('gateway_depositor_address', $2::text),
                  updated_at = now()
            WHERE id = $1`,
          [destinationWallet.id, gatewayDepositorAddress],
        );
      }

      let gatewayBalance: Awaited<ReturnType<CircleTreasuryProvider['getGatewayBalance']>>;
      try {
        gatewayBalance = await provider.getGatewayBalance({
          address: gatewayDepositorAddress,
          chain: destinationChain,
          mode,
        });
      } catch {
        return submitLiquidityJobAwaitingGatewayBalance(pool, {
          amount,
          bridgeStatus,
          bridgeTransactionId,
          depositTransactionId,
          destinationChain,
          jobId,
          observedGatewayUsdc: null,
          operator,
          orgId,
          sourceChain,
          strategy,
        });
      }
      const gatewayMicros = parseUsdcMicros(gatewayBalance.available);
      observedGatewayUsdc = formatUsdc(gatewayMicros);
      if (gatewayMicros < destinationTargetMicros) {
        return submitLiquidityJobAwaitingGatewayBalance(pool, {
          amount,
          bridgeStatus,
          bridgeTransactionId,
          depositTransactionId,
          destinationChain,
          jobId,
          observedGatewayUsdc,
          operator,
          orgId,
          sourceChain,
          strategy,
        });
      }
    }

    return withTransaction(pool, async (client) => {
      const updated = await client.query<CircleProviderJobRow>(
        `UPDATE circle_provider_jobs
            SET status = 'complete',
                provider_ref = $2,
                error_code = NULL,
                metadata = metadata || $3::jsonb,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          jobId,
          depositTransactionId ?? bridgeTransactionId,
          JSON.stringify({
            bridge_status: bridgeStatus,
            bridge_transaction_id: bridgeTransactionId,
            completed_by: operator.actorId,
            deposit_transaction_id: depositTransactionId,
            observed_gateway_usdc: observedGatewayUsdc,
            prep_status: 'complete',
          }),
        ],
      );
      const updatedRow = updated.rows[0];
      if (updatedRow === undefined) throw new Error('liquidity_prepare_job_update_failed');

      await recordActivity(client, {
        orgId,
        category: 'treasury',
        action: 'liquidity.prepare.complete',
        outcome: 'success',
        summary: `${amount} USDC liquidity prepared for ${metadataString(metadata, 'rail') ?? row.chain}`,
        payload: {
          amount_usdc: amount,
          bridge_status: bridgeStatus,
          bridge_transaction_id: bridgeTransactionId,
          destination_chain: destinationChain,
          deposit_transaction_id: depositTransactionId,
          job_id: jobId,
          source_chain: sourceChain,
          strategy,
        },
      });

      await recordAuditEvent(client, {
        orgId,
        idempotencyKey: `liquidity.prepare.complete:${jobId}`,
        eventType: 'liquidity.prepare.complete',
        actor: { type: operator.userId === undefined ? 'system' : 'user', id: operator.actorId },
        action: 'liquidity.prepare.complete',
        outcome: 'success',
        resource: { type: 'circle_provider_job', id: jobId },
        classification: {
          domain: 'payment',
          category: 'financial',
          severity: 'info',
          tags: ['section_9', 'liquidity', 'prepare', destinationChain],
        },
        relations: {
          ...(metadataString(metadata, 'agent_id') === null ? {} : { agent: metadataString(metadata, 'agent_id') as string }),
          ...(metadataString(metadata, 'connection_id') === null ? {} : { connection: metadataString(metadata, 'connection_id') as string }),
        },
        refs: {},
        source: { section: 'section_9', system: 'payments' },
        retentionClass: 'payment',
        payload: {
          amount_usdc: amount,
          bridge_status: bridgeStatus,
          bridge_transaction_id: bridgeTransactionId,
          destination_chain: destinationChain,
          deposit_transaction_id: depositTransactionId,
          source_chain: sourceChain,
          strategy,
        },
      });

      return providerJobFromRow(updatedRow);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'liquidity_prepare_failed';
    return failLiquidityJob(pool, {
      errorCode: message,
      jobId,
      metadata: {
        bridge_status: bridgeStatus,
        bridge_transaction_id: bridgeTransactionId,
        deposit_transaction_id: depositTransactionId,
      },
      message,
    });
  }
}

export async function cancelLiquidityJob(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  jobId: string,
): Promise<CircleProviderJobRecord> {
  const updated = await pool.query<CircleProviderJobRow>(
    `UPDATE circle_provider_jobs
        SET status = 'blocked',
            error_code = 'cancelled',
            metadata = metadata || $3::jsonb,
            updated_at = now()
      WHERE org_id = $1
        AND id = $2
        AND job_type = 'liquidity.prepare'
        AND status IN ('queued', 'failed')
      RETURNING *`,
    [orgId, jobId, JSON.stringify({ cancelled_by: operator.actorId, prep_status: 'cancelled' })],
  );
  const row = updated.rows[0];
  if (row === undefined) throw notFound('Cancelable liquidity job was not found.');
  return providerJobFromRow(row);
}

export async function getTreasuryOverview(
  pool: pg.Pool,
  orgId: string,
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
  redis?: Redis,
): Promise<TreasuryOverviewRecord> {
  const mode = (await getOrgPaymentMode(pool, orgId)).mode;
  const balances = await listCircleBalances(pool, orgId, provider, redis);
  return getTreasuryOverviewForBalances(pool, orgId, mode, balances);
}

async function getTreasuryOverviewForBalances(
  pool: pg.Pool,
  orgId: string,
  mode: PaymentMode,
  balances: readonly CircleChainBalanceRecord[],
): Promise<TreasuryOverviewRecord> {
  const walletMicros = balances.reduce((sum, balance) => sum + walletUsdcMicros(balance), 0n);
  const gatewayMicros = balances.reduce((sum, balance) => {
    if (balance.gateway === null) return sum;
    try {
      return sum + parseUsdcMicros(balance.gateway.available);
    } catch {
      return sum;
    }
  }, 0n);

  const jobs = await pool.query<CircleProviderJobRow>(
    `SELECT *
       FROM circle_provider_jobs
      WHERE org_id = $1
        AND job_type = 'liquidity.prepare'
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId],
  );
  const jobCounts = await pool.query<{
    readonly failed_jobs: string;
    readonly pending_jobs: string;
  }>(
    `SELECT
       count(*) FILTER (WHERE status IN ('queued', 'submitted'))::text AS pending_jobs,
       count(*) FILTER (WHERE status = 'failed')::text AS failed_jobs
     FROM circle_provider_jobs
     WHERE org_id = $1
       AND job_type = 'liquidity.prepare'`,
    [orgId],
  );
  const paymentSummary = await pool.query<{
    readonly agents_with_access: string;
    readonly total_spent_usdc: string;
  }>(
    `SELECT
       count(*) FILTER (WHERE status = 'active' AND payment_access)::text AS agents_with_access,
       COALESCE(sum(spent_usdc), 0)::text AS total_spent_usdc
     FROM agent_payment_accounts
     WHERE org_id = $1`,
    [orgId],
  );
  const lastPayment = await pool.query<{
    readonly amount_usdc: string;
    readonly created_at: Date;
    readonly rail: PaymentRail;
  }>(
    `SELECT amount_usdc::text, rail, created_at
       FROM payment_events
      WHERE org_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId],
  );

  const counts = jobCounts.rows[0];
  const payments = paymentSummary.rows[0];
  const last = lastPayment.rows[0];
  return {
    liquidity: {
      failed_jobs: Number(counts?.failed_jobs ?? '0'),
      last_job: jobs.rows[0] === undefined ? null : providerJobFromRow(jobs.rows[0]),
      pending_jobs: Number(counts?.pending_jobs ?? '0'),
    },
    mode,
    payments: {
      agents_with_access: Number(payments?.agents_with_access ?? '0'),
      last_payment: last === undefined
        ? null
        : {
            amount: formatDbUsdc(last.amount_usdc),
            created_at: last.created_at.toISOString(),
            rail: last.rail,
          },
      total_spent_usdc: formatDbUsdc(payments?.total_spent_usdc ?? '0'),
    },
    totals: {
      gateway_usdc: formatUsdc(gatewayMicros),
      treasury_usdc: formatUsdc(gatewayMicros + walletMicros),
      wallet_usdc: formatUsdc(walletMicros),
    },
  };
}

export async function getPaymentsConsoleSnapshot(
  pool: pg.Pool,
  orgId: string,
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
  redis?: Redis,
): Promise<{
  readonly balances: readonly CircleChainBalanceRecord[];
  readonly rebalanceRecommendations: readonly RebalanceRecommendationRecord[];
  readonly overview: TreasuryOverviewRecord;
}> {
  const mode = (await getOrgPaymentMode(pool, orgId)).mode;
  const balances = await listCircleBalances(pool, orgId, provider, redis);
  const [overview, rebalanceRecommendations] = await Promise.all([
    getTreasuryOverviewForBalances(pool, orgId, mode, balances),
    listRebalanceRecommendationsForBalances(pool, orgId, balances),
  ]);
  return { balances, overview, rebalanceRecommendations };
}

export async function requestCircleTestnetFunds(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: { readonly chains: readonly PaymentChain[] },
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
): Promise<readonly CircleProviderJobRecord[]> {
  const mode = (await getOrgPaymentMode(pool, orgId)).mode;
  if (mode !== 'test') throw conflict('circle_testnet_faucet_unavailable', 'Testnet funds can only be requested in test mode.');
  const health = provider.health(mode);
  if (!health.configured) {
    throw conflict(
      'circle_provider_not_configured',
      `Circle ${mode} provider is missing ${health.missing.join(', ')}.`,
    );
  }

  const chains = [...new Set(input.chains)];
  const jobs: CircleProviderJobRecord[] = [];
  for (const chain of chains) {
    const wallet = await activeCircleWallet(pool, orgId, mode, chain);
    const jobId = prefixedId('cjob');
    const inserted = await pool.query<CircleProviderJobRow>(
      `INSERT INTO circle_provider_jobs (
         id, org_id, mode, job_type, chain, status, metadata, created_by
       )
       VALUES ($1, $2, $3, 'wallet.faucet', $4, 'queued', $5::jsonb, $6)
       RETURNING *`,
      [
        jobId,
        orgId,
        mode,
        chain,
        JSON.stringify({
          address: wallet.address,
          circle_wallet_id: wallet.circle_wallet_id,
          wallet_set_id: wallet.wallet_set_id,
        }),
        operator.actorId,
      ],
    );
    if (inserted.rows[0] === undefined) throw new Error('circle_testnet_faucet_job_insert_failed');

    try {
      const result = await provider.requestTestnetFunds({
        address: wallet.address,
        chain,
        mode,
      });
      const updated = await pool.query<CircleProviderJobRow>(
        `UPDATE circle_provider_jobs
            SET status = 'complete',
                metadata = metadata || $2::jsonb,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          jobId,
          JSON.stringify({
            provider_response: result.response,
          }),
        ],
      );
      const row = updated.rows[0];
      if (row === undefined) throw new Error('circle_testnet_faucet_job_update_failed');
      jobs.push(providerJobFromRow(row));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'circle_testnet_faucet_failed';
      const failed = await pool.query<CircleProviderJobRow>(
        `UPDATE circle_provider_jobs
            SET status = 'failed',
                error_code = $2,
                metadata = metadata || $3::jsonb,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          jobId,
          message.slice(0, 120),
          JSON.stringify({ error_message: message }),
        ],
      );
      const row = failed.rows[0];
      if (row === undefined) throw new Error('circle_testnet_faucet_job_update_failed');
      jobs.push(providerJobFromRow(row));
    }
  }

  await recordActivity(pool, {
    orgId,
    category: 'treasury',
    action: 'circle.testnet_funds.requested',
    outcome: jobs.some((job) => job.status === 'complete') ? 'success' : 'error',
    summary: `Circle testnet funds requested for ${jobs.length} chain${jobs.length === 1 ? '' : 's'}`,
    payload: {
      chains,
      failed: jobs.filter((job) => job.status === 'failed').map((job) => ({ chain: job.chain, error_code: job.error_code })),
      mode,
      succeeded: jobs.filter((job) => job.status === 'complete').map((job) => job.chain),
    },
  });

  return jobs;
}

export async function ensureCircleTreasury(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: { readonly label: string },
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
): Promise<{
  readonly walletSet: CircleWalletSetRecord;
  readonly wallets: readonly CircleChainWalletRecord[];
}> {
  const mode = (await getOrgPaymentMode(pool, orgId)).mode;
  const health = provider.health(mode);
  if (!health.configured) {
    throw conflict(
      'circle_provider_not_configured',
      `Circle ${mode} provider is missing ${health.missing.join(', ')}.`,
    );
  }

  return withTransaction(pool, async (client) => {
    const existingWalletSet = await activeWalletSet(client, orgId, mode);
    if (existingWalletSet !== null) {
      await client.query(
        `UPDATE circle_wallet_sets
            SET account_type = 'sca',
                metadata = metadata || $3::jsonb,
                updated_at = now()
          WHERE id = $1
            AND org_id = $2`,
        [
          existingWalletSet.id,
          orgId,
          JSON.stringify({ account_owner: 'org', signer: 'circle_agent_wallet_cli' }),
        ],
      );
      const capabilities = await listCircleChainCapabilities(pool, mode);
      const refreshedWalletRows: CircleChainWalletRow[] = [];
      for (const capability of capabilities) {
        const createdWallet = await provider.createWallet({
          chain: capability.chain,
          circleBlockchain: capability.circle_blockchain,
          mode,
          orgId,
          walletSetId: existingWalletSet.circle_wallet_set_id,
        });
        const upsertedWallet = await client.query<CircleChainWalletRow>(
          `INSERT INTO circle_chain_wallets (
             id, org_id, wallet_set_id, mode, chain, circle_blockchain,
             circle_wallet_id, address, account_type, metadata
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sca', $9::jsonb)
           ON CONFLICT (org_id, mode, chain)
           DO UPDATE SET circle_blockchain = EXCLUDED.circle_blockchain,
                         circle_wallet_id = EXCLUDED.circle_wallet_id,
                         address = EXCLUDED.address,
                         account_type = 'sca',
                         metadata = circle_chain_wallets.metadata || EXCLUDED.metadata,
                         updated_at = now()
           RETURNING *`,
          [
            prefixedId('cwallet'),
            orgId,
            existingWalletSet.id,
            mode,
            capability.chain,
            capability.circle_blockchain,
            createdWallet.circleWalletId,
            createdWallet.address,
            JSON.stringify({
              gateway_domain: capability.gateway_domain,
              network_label: capability.network_label,
              walletProvider: 'circle_agent_wallet',
            }),
          ],
        );
        const wallet = upsertedWallet.rows[0];
        if (wallet === undefined) throw new Error('circle_wallet_refresh_failed');
        refreshedWalletRows.push(wallet);
        await ensureTreasuryAndSourceForWallet(client, {
          address: wallet.address,
          chain: wallet.chain,
          circleWalletId: wallet.circle_wallet_id,
          mode,
          operatorId: operator.actorId,
          orgId,
          walletSetId: existingWalletSet.circle_wallet_set_id,
        });
      }
      return {
        walletSet: walletSetFromRow({ ...existingWalletSet, account_type: 'sca' }),
        wallets: refreshedWalletRows.map(chainWalletFromRow),
      };
    }

    const createdWalletSet = await provider.createWalletSet({ label: input.label.trim(), mode, orgId });
    const walletSetId = prefixedId('cws');
    const insertedWalletSet = await client.query<CircleWalletSetRow>(
      `INSERT INTO circle_wallet_sets (
         id, org_id, mode, circle_wallet_set_id, label, account_type, metadata, created_by
       )
       VALUES ($1, $2, $3, $4, $5, 'sca', $6::jsonb, $7)
       RETURNING *`,
      [
        walletSetId,
        orgId,
        mode,
        createdWalletSet.circleWalletSetId,
        input.label.trim(),
        JSON.stringify({ account_owner: 'org', signer: 'circle_agent_wallet_cli' }),
        operator.actorId,
      ],
    );
    const walletSetRow = insertedWalletSet.rows[0];
    if (walletSetRow === undefined) throw new Error('circle_wallet_set_insert_failed');

    await client.query(
      `INSERT INTO circle_provider_jobs (
         id, org_id, mode, job_type, status, provider_ref, metadata, created_by
       )
       VALUES ($1, $2, $3, 'wallet_set.create', 'complete', $4, $5::jsonb, $6)`,
      [
        prefixedId('cjob'),
        orgId,
        mode,
        createdWalletSet.circleWalletSetId,
        JSON.stringify({ label: input.label.trim() }),
        operator.actorId,
      ],
    );

    const capabilities = await listCircleChainCapabilities(pool, mode);
    const walletRows: CircleChainWalletRow[] = [];
    for (const capability of capabilities) {
      const createdWallet = await provider.createWallet({
        chain: capability.chain,
        circleBlockchain: capability.circle_blockchain,
        mode,
        orgId,
        walletSetId: createdWalletSet.circleWalletSetId,
      });
      const walletId = prefixedId('cwallet');
      const insertedWallet = await client.query<CircleChainWalletRow>(
          `INSERT INTO circle_chain_wallets (
           id, org_id, wallet_set_id, mode, chain, circle_blockchain,
           circle_wallet_id, address, account_type, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sca', $9::jsonb)
         RETURNING *`,
        [
          walletId,
          orgId,
          walletSetId,
          mode,
          capability.chain,
          capability.circle_blockchain,
          createdWallet.circleWalletId,
          createdWallet.address,
          JSON.stringify({ gateway_domain: capability.gateway_domain, network_label: capability.network_label }),
        ],
      );
      const walletRow = insertedWallet.rows[0];
      if (walletRow === undefined) throw new Error('circle_wallet_insert_failed');
      walletRows.push(walletRow);

      await ensureTreasuryAndSourceForWallet(client, {
        address: createdWallet.address,
        chain: capability.chain,
        circleWalletId: createdWallet.circleWalletId,
        mode,
        operatorId: operator.actorId,
        orgId,
        walletSetId,
      });

      await client.query(
        `INSERT INTO circle_provider_jobs (
           id, org_id, mode, job_type, chain, status, provider_ref, metadata, created_by
         )
         VALUES ($1, $2, $3, 'wallet.create', $4, 'complete', $5, $6::jsonb, $7)`,
        [
          prefixedId('cjob'),
          orgId,
          mode,
          capability.chain,
          createdWallet.circleWalletId,
          JSON.stringify({ circle_blockchain: capability.circle_blockchain, address: createdWallet.address }),
          operator.actorId,
        ],
      );
    }

    await recordActivity(client, {
      orgId,
      category: 'treasury',
      action: 'circle.treasury.created',
      outcome: 'success',
      summary: 'Circle org treasury wallets created',
      payload: {
        mode,
        wallet_set_id: walletSetId,
        chains: walletRows.map((wallet) => wallet.chain),
      },
    });

    return {
      walletSet: walletSetFromRow(walletSetRow),
      wallets: walletRows.map(chainWalletFromRow),
    };
  });
}

async function activePaymentAccount(db: Db, auth: ConnectionAuthResult): Promise<AgentPaymentAccountRow> {
  const result = await db.query<AgentPaymentAccountRow & { readonly org_frozen: boolean; readonly agent_status: string }>(
    `SELECT apa.*, o.frozen AS org_frozen, a.status AS agent_status
       FROM agent_payment_accounts apa
       JOIN orgs o ON o.id = apa.org_id
       JOIN agents a ON a.id = apa.agent_id
      WHERE apa.org_id = $1
        AND apa.agent_id = $2
      FOR UPDATE OF apa`,
    [auth.org_id, auth.agent_id],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new IdentityError('payment_access_disabled', 403, 'Payment access is disabled for this agent.');
  }
  // Emergency stop runs before every other check in this function.
  if (row.org_frozen) {
    throw new IdentityError('org_frozen', 403, 'This workspace is frozen. No actions can proceed.');
  }
  if (row.agent_status === 'paused' || row.agent_status === 'suspended') {
    throw new IdentityError('agent_frozen', 403, 'This agent is frozen. No actions can proceed.');
  }
  if (row.status !== 'active' || !row.payment_access) {
    throw new IdentityError('payment_access_disabled', 403, 'Payment access is disabled for this agent.');
  }
  return row;
}

async function activePaymentSource(db: Db, orgId: string, rail: PaymentRail, chain: PaymentChain): Promise<PaymentSourceRow> {
  const result = await db.query<PaymentSourceRow>(
    `SELECT *
       FROM payment_sources
      WHERE org_id = $1
        AND rail = $2
        AND chain = $3
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [orgId, rail, chain],
  );
  const row = result.rows[0];
  if (row === undefined) throw conflict('payment_source_unavailable', 'No active payment source is available for this rail.');
  return row;
}

function railVerificationFailure(
  capability: CircleChainCapabilityRecord | null,
  quote: RuntimeQuote,
): { readonly code: string; readonly message: string } | null {
  if (capability === null) {
    return {
      code: 'payment_rail_unavailable',
      message: `No active Circle capability is configured for ${quote.chain}.`,
    };
  }

  if (quote.settlementKind === 'gateway') {
    if (!capability.gateway_supported || !capability.nanopayments_supported) {
      return {
        code: 'payment_rail_unavailable',
        message: `Gateway nanopayments are not supported for ${quote.chain}.`,
      };
    }
    if (!capability.gateway_settlement_verified) {
      return {
        code: 'payment_rail_unverified',
        message: `${quote.rail} liquidity can be prepared, but x402 settlement is not verified yet.`,
      };
    }
    return null;
  }

  if (!capability.wallet_supported) {
    return {
      code: 'payment_rail_unavailable',
      message: `Exact wallet payments are not supported for ${quote.chain}.`,
    };
  }
  if (!capability.exact_settlement_verified) {
    return {
      code: 'payment_rail_unverified',
      message: `${quote.rail} settlement is not verified yet.`,
    };
  }
  return null;
}

export type PayRuntimeX402Options = {
  readonly orchestrationHooks?: {
    readonly afterProviderEvidence?: (() => void | Promise<void>) | undefined;
    readonly afterReserved?: (() => void | Promise<void>) | undefined;
    readonly afterSubmitting?: (() => void | Promise<void>) | undefined;
    readonly canResumeReserved?: (() => boolean | Promise<boolean>) | undefined;
  } | undefined;
  readonly paidHttpExecution?: PaidHttpExecutionOptions | undefined;
  readonly paidHttpExecutor?: PaidHttpExecutor | undefined;
  readonly paidHttpUrlPolicy?: PaidHttpUrlPolicy | undefined;
  readonly resultCrypto?: X402ResultCryptoCodec | undefined;
};

type RuntimeX402SettlementResult = Omit<CircleGatewayX402SettlementResult, 'providerMode'> & {
  readonly providerMode: 'simulation' | PaymentMode;
};

type StoredRuntimeX402Result = {
  readonly providerEvidence?: RuntimeX402SettlementResult;
  readonly result: RuntimeX402PaymentResult;
  readonly privateDebug?: unknown;
};

type StoredRuntimeX402ProviderEvidence = {
  readonly settlement: RuntimeX402SettlementResult;
  readonly privateDebug?: unknown;
};

type PreparedPaidHttpPayment = {
  readonly approvalRequired?: PaymentApprovalRequiredError | undefined;
  readonly attempt: X402AttemptRecord;
  readonly destination: ValidatedPaidHttpDestination;
  readonly mode: PaymentMode;
  readonly paymentInput: RuntimeX402PaymentInput;
  readonly policyGate: { readonly approvalId: string | null; readonly decisionId: string };
  readonly quote: RuntimeQuote;
  readonly quoteHash: string;
  readonly quotePayload: Record<string, unknown>;
  readonly reservationId: string;
  readonly resource: ReturnType<typeof x402Resource>;
  readonly source: PaymentSourceRow;
};

type PreparedPaidHttpPaymentOutcome =
  | { readonly kind: 'existing'; readonly attempt: X402AttemptRecord }
  | { readonly kind: 'prepared'; readonly payment: PreparedPaidHttpPayment };

function paymentResultFromAttempt(attempt: X402AttemptRecord): RuntimeX402PaymentResult {
  const providerMode = attempt.payment_metadata.providerMode;
  const rail = attempt.rail;
  return {
    payment: {
      id: attempt.payment_metadata.eventId ?? null,
      attemptId: attempt.id,
      status: attempt.status,
      providerMode:
        providerMode === 'simulation' || providerMode === 'test' || providerMode === 'live'
          ? providerMode
          : null,
      rail,
      chain: rail === null ? null : chainFromRail(rail),
      amount: attempt.amount_usdc === null ? null : formatDbUsdc(attempt.amount_usdc),
      asset: attempt.asset,
      agentId: attempt.agent_id,
      connectionId: attempt.connection_id ?? '',
      sourceId: attempt.source_id,
      reservationId: attempt.payment_metadata.reservationId ?? null,
      recipient: attempt.recipient,
      network: attempt.network,
      ...(attempt.payment_metadata.transactionHash === undefined
        ? {}
        : { transaction: attempt.payment_metadata.transactionHash }),
      ...(attempt.payment_metadata.payer === undefined
        ? {}
        : { payer: attempt.payment_metadata.payer }),
      ...(attempt.error_code === null ? {} : { errorCode: attempt.error_code }),
      responseAvailable: false,
    },
  };
}

function safeResponseMetadata(response: PaidHttpResponse | undefined): {
  readonly contentLength?: number;
  readonly contentType?: string;
  readonly statusCode?: number;
} {
  if (response === undefined) return {};
  return {
    contentLength: response.sizeBytes,
    ...(response.contentType === undefined ? {} : { contentType: response.contentType }),
    statusCode: response.status,
  };
}

async function preparePaidHttpPayment(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  input: RuntimePaidHttpX402Input,
  requestHash: string,
  destination: ValidatedPaidHttpDestination,
  paymentInput: RuntimeX402PaymentInput,
  resultCrypto: X402ResultCryptoCodec,
): Promise<PreparedPaidHttpPaymentOutcome> {
  return withTransaction(pool, async (client) => {
    const account = await activePaymentAccount(client, auth);
    const attemptStore = createPostgresX402AttemptStore(client, { resultCrypto });
    const racedAttempt = await attemptStore.findAttempt(auth.connection_id, input.idempotency_key);
    if (racedAttempt !== null) {
      if (racedAttempt.request_hash !== requestHash) {
        throw conflict(
          'payment_idempotency_conflict',
          'This idempotency key is already bound to a different payment request.',
        );
      }
      return { attempt: racedAttempt, kind: 'existing' };
    }
    const mode = (await getOrgPaymentMode(client, auth.org_id)).mode;
    const supportedQuotes = supportedRuntimeQuotes(paymentInput, mode);
    const quote = supportedQuotes.find((candidate) => account.allowed_rails.includes(candidate.rail)) ?? null;
    const resource = x402Resource(paymentInput);
    if (supportedQuotes.length === 0) {
      throw conflict(
        'unsupported_payment_rail',
        'The x402 payment request is not compatible with this workspace\'s supported USDC rails.',
      );
    }
    if (quote === null) {
      throw new IdentityError(
        'payment_rail_not_allowed',
        403,
        'This agent is not allowed to use the requested payment rail.',
      );
    }

    // Source resolution and the quote hash must be known BEFORE policy
    // runs, because the approval context policy stores (and that a later
    // resume compares against) binds quote_hash/request_hash into it --
    // resumePreparedPaidHttpPayment's approval_context_mismatch check
    // requires them to already be present at approval-creation time.
    const source = await activePaymentSource(client, auth.org_id, quote.rail, quote.chain);
    if (
      (source.provider === 'circle_gateway' || source.provider === 'circle_wallets') &&
      (source.external_wallet_id === null || source.address === null)
    ) {
      throw conflict(
        'payment_source_not_live',
        'Circle payment source is missing its wallet address or Circle wallet id.',
      );
    }
    if (quote.settlementKind === 'gateway' && source.provider !== 'circle_gateway' && source.provider !== 'simulation') {
      throw conflict('payment_source_incompatible', 'Gateway x402 payments require a Gateway payment source.');
    }
    if (quote.settlementKind === 'direct_exact' && source.provider !== 'circle_wallets' && source.provider !== 'simulation') {
      throw conflict('payment_source_incompatible', 'Exact x402 payments require a Circle Wallets payment source.');
    }
    if (source.provider === 'simulation' && parseUsdcMicros(source.simulated_balance_usdc) < quote.amountMicros) {
      throw conflict('insufficient_payment_source_balance', 'Payment source does not have enough simulated balance.');
    }
    const providerMode = source.provider === 'simulation' ? 'simulation' : mode;
    const quotePayload = {
      accept: quote.accept,
      resource: paymentInput.resource ?? {},
      mode: providerMode,
      x402: { amount: quote.x402Amount, network: quote.x402Network },
    };
    const quoteHash = sha256Hex(quotePayload);
    const paymentInputWithBinding: RuntimeX402PaymentInput = {
      ...paymentInput,
      context: {
        ...(paymentInput.context ?? {}),
        quote_hash: quoteHash,
        request_hash: requestHash,
      },
    };

    // Policy is the authority and must run before any business-state check
    // (cap, budget, balance, reservation write) below -- otherwise a denied
    // caller can still mutate reserved_usdc, or learn budget state through
    // the error code before ever being told policy denied.
    const approvalThreshold = account.approval_threshold_usdc === null
      ? null
      : parseUsdcMicros(account.approval_threshold_usdc);
    let approvalRequired: PaymentApprovalRequiredError | undefined;
    let policyGate: PreparedPaidHttpPayment['policyGate'];
    try {
      policyGate = await enforceX402Policy(
        pool,
        auth,
        paymentInputWithBinding,
        quote,
        resource,
        approvalThreshold,
      );
    } catch (error) {
      if (!(error instanceof PaymentApprovalRequiredError)) throw error;
      approvalRequired = error;
      policyGate = { approvalId: error.approvalId, decisionId: error.decisionId };
    }
    if (approvalRequired === undefined && source.provider !== 'simulation') {
      const capability = await getCircleChainCapability(client, mode, quote.chain);
      const readinessFailure = railVerificationFailure(capability, quote);
      if (readinessFailure !== null) throw conflict(readinessFailure.code, readinessFailure.message);
    }

    const cap = parseUsdcMicros(account.per_request_cap_usdc);
    if (cap > 0n && quote.amountMicros > cap) {
      throw conflict('per_request_cap_exceeded', 'Payment amount exceeds the agent per-request cap.');
    }
    const budget = parseUsdcMicros(account.budget_usdc);
    const spent = parseUsdcMicros(account.spent_usdc);
    const reserved = parseUsdcMicros(account.reserved_usdc);
    if (spent + reserved + quote.amountMicros > budget) {
      throw conflict('budget_exceeded', 'Payment amount exceeds the agent budget.');
    }

    // Authoritative ceiling: the agent's own on-chain balance. The counters
    // above are a fast pre-filter and an intent record; this is the bound
    // that survives a total compromise of this system, because anyone can
    // verify it by RPC without trusting us. Deliberately permissive when no
    // per-agent wallet exists: orgs that haven't adopted per-agent wallets
    // keep working on the shared org wallet, so a missing wallet is not a
    // hard failure.
    //
    // gasReserveMicros is 0n here -- the gas_reserve_usdc column doesn't
    // exist until Phase 4's agent_allocations table. readSpendableMicros
    // already takes it as a parameter for that reason; wire in the real
    // value once that table lands rather than hardcoding a guess now.
    const agentWallet = await findAgentWallet(client, auth.agent_id, mode, quote.chain);
    if (agentWallet !== null) {
      const spendable = await readSpendableMicros(agentWallet, 0n, { nativeBalanceMicros });
      if (quote.amountMicros > spendable) {
        throw conflict(
          'insufficient_agent_wallet_balance',
          'Payment amount exceeds the agent wallet spendable balance.',
        );
      }
    }

    const attempt = await attemptStore.createAttempt({
      orgId: auth.org_id,
      agentId: auth.agent_id,
      connectionId: auth.connection_id,
      sourceId: source.id,
      idempotencyKey: input.idempotency_key,
      requestHash,
      quoteHash,
      amountUsdc: quote.amount,
      asset: quote.asset,
      rail: quote.rail,
      network: quote.x402Network,
      recipient: quote.recipient,
    });
    const reservationId = prefixedId('payres');
    await client.query(
      `INSERT INTO payment_reservations (
         id, org_id, agent_id, connection_id, source_id,
         amount_usdc, asset, rail, status, reason_code, quote_hash, quote, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, 'reserved', $9, $10, $11::jsonb, now() + interval '15 minutes')`,
      [
        reservationId,
        auth.org_id,
        auth.agent_id,
        auth.connection_id,
        source.id,
        quote.amount,
        quote.asset,
        quote.rail,
        `x402_attempt:${attempt.id}`,
        quoteHash,
        JSON.stringify(quotePayload),
      ],
    );
    await client.query(
      `UPDATE agent_payment_accounts
          SET reserved_usdc = reserved_usdc + $3::numeric,
              updated_at = now()
        WHERE org_id = $1 AND agent_id = $2`,
      [auth.org_id, auth.agent_id, quote.amount],
    );
    await client.query(
      `UPDATE runtime_payment_attempts
          SET payment_metadata = payment_metadata || $2::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [
        attempt.id,
        JSON.stringify({
          ...(policyGate.approvalId === null ? {} : { approvalId: policyGate.approvalId }),
          decisionId: policyGate.decisionId,
          providerMode,
          reservationId,
        }),
      ],
    );
    return {
      kind: 'prepared',
      payment: {
        ...(approvalRequired === undefined ? {} : { approvalRequired }),
        attempt,
        destination,
        mode,
        paymentInput: paymentInputWithBinding,
        policyGate,
        quote,
        quoteHash,
        quotePayload,
        reservationId,
        resource,
        source,
      },
    };
  });
}

async function resumePreparedPaidHttpPayment(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  input: RuntimePaidHttpX402Input,
  attempt: X402AttemptRecord,
  options: PayRuntimeX402Options,
  controlledResume = false,
  approvalAlreadyConsumed = false,
): Promise<PreparedPaidHttpPayment> {
  const reservationResult = await pool.query<PaymentReservationRow>(
    `SELECT *
       FROM payment_reservations
      WHERE org_id = $1
        AND connection_id = $2
        AND reason_code = $3
        AND status = 'reserved'
      LIMIT 1`,
    [auth.org_id, auth.connection_id, `x402_attempt:${attempt.id}`],
  );
  const reservation = reservationResult.rows[0];
  if (reservation === undefined || attempt.source_id === null) {
    throw conflict('payment_attempt_state_conflict', 'Reserved payment attempt is incomplete.');
  }
  const sourceResult = await pool.query<PaymentSourceRow>(
    `SELECT * FROM payment_sources WHERE id = $1 AND org_id = $2 AND status = 'active' LIMIT 1`,
    [attempt.source_id, auth.org_id],
  );
  const source = sourceResult.rows[0];
  if (source === undefined) throw conflict('payment_source_unavailable', 'Payment source is unavailable.');
  const quotePayload = objectFromJson(reservation.quote);
  const accept = objectFromJson(quotePayload.accept) as RuntimeX402Accept;
  const resourcePayload = objectFromJson(quotePayload.resource);
  const mode = (await getOrgPaymentMode(pool, auth.org_id)).mode;
  const quote = quoteFromAccept(accept, mode);
  if (quote === null || reservation.quote_hash !== attempt.quote_hash) {
    throw conflict('payment_attempt_state_conflict', 'Reserved payment quote is invalid.');
  }
  const paymentInput: RuntimeX402PaymentInput = {
    accepts: [accept],
    resource: resourcePayload,
    context: {
      idempotency_key: input.idempotency_key,
      quote_hash: attempt.quote_hash,
      request_hash: attempt.request_hash,
    },
  };
  const approvalId = attempt.payment_metadata.approvalId;
  const decisionId = attempt.payment_metadata.decisionId;
  if (approvalId !== undefined) {
    if (decisionId === undefined) {
      throw conflict('payment_attempt_state_conflict', 'Reserved payment approval binding is incomplete.');
    }
    const approval = await getApproval(pool, auth.org_id, approvalId);
    const requestContext = objectFromJson(approval.context.request);
    if (
      requestContext.request_hash !== attempt.request_hash ||
      requestContext.quote_hash !== attempt.quote_hash
    ) {
      throw badRequest('approval_context_mismatch', 'Approval does not match this x402 payment request.');
    }
    if (approval.status === 'pending') {
      throw new PaymentApprovalRequiredError(decisionId, approvalId, 'Payment approval is still pending.');
    }
    if (approvalAlreadyConsumed && approval.status === 'consumed') {
      // The provider phase had already started before recovery loaded its evidence.
    } else if (approval.status !== 'approved') {
      throw conflict('approval_not_approved', 'Approval must be approved before payment can resume.');
    }
  } else if (
    !controlledResume &&
    attempt.payment_metadata.resumeReason === undefined &&
    !(await options.orchestrationHooks?.canResumeReserved?.())
  ) {
    throw conflict(
      'payment_attempt_resume_required',
      'Reserved payment attempt requires an explicit controlled resume.',
    );
  }
  const destination = await assertPaidHttpUrlAllowed(input.request.url, options.paidHttpUrlPolicy);
  return {
    attempt,
    destination,
    mode,
    paymentInput,
    policyGate: { approvalId: approvalId ?? null, decisionId: decisionId ?? 'reserved_resume' },
    quote,
    quoteHash: reservation.quote_hash,
    quotePayload,
    reservationId: reservation.id,
    resource: x402Resource(paymentInput),
    source,
  };
}

async function finalizeSettledPaidHttpPayment(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  prepared: PreparedPaidHttpPayment,
  settlement: RuntimeX402SettlementResult,
  resultCrypto: X402ResultCryptoCodec,
  privateDebug: unknown,
): Promise<RuntimeX402PaymentResult> {
  const payment = settlement.payment;
  if (payment === undefined || payment.status !== 'settled') {
    throw conflict(
      payment?.errorCode ?? 'payment_settlement_unresolved',
      'The x402 payment did not reach confirmed settlement.',
    );
  }
  return withTransaction(pool, async (client) => {
    const { attempt, quote, reservationId, resource, source } = prepared;
    await client.query(
      `UPDATE payment_reservations
          SET status = 'settled', updated_at = now()
        WHERE id = $1 AND org_id = $2 AND status = 'reserved'`,
      [reservationId, auth.org_id],
    );
    await client.query(
      `UPDATE agent_payment_accounts
          SET reserved_usdc = reserved_usdc - $3::numeric,
              spent_usdc = spent_usdc + $3::numeric,
              updated_at = now()
        WHERE org_id = $1 AND agent_id = $2`,
      [auth.org_id, auth.agent_id, quote.amount],
    );
    if (source.provider === 'simulation') {
      await client.query(
        `UPDATE payment_sources
            SET simulated_balance_usdc = simulated_balance_usdc - $2::numeric,
                updated_at = now()
          WHERE id = $1`,
        [source.id, quote.amount],
      );
    }

    await recordRouteObservation(client, {
      orgId: auth.org_id,
      agentId: auth.agent_id,
      connectionId: auth.connection_id,
      requestedNetwork: quote.network,
      requestedAsset: quote.asset,
      requestedRail: quote.rail,
      supportedRail: quote.rail,
      amount: quote.amount,
      outcome: 'accepted',
      reasonCode: 'settled',
      resourceUrl: resource.url,
      resourceCategory: resource.category,
    });
    const activity = await recordActivity(client, {
      orgId: auth.org_id,
      agentId: auth.agent_id,
      connectionId: auth.connection_id,
      decisionId: prepared.policyGate.decisionId,
      approvalId: prepared.policyGate.approvalId ?? undefined,
      category: 'payment',
      action: 'payment.x402.settled',
      outcome: 'success',
      summary: `x402 payment settled on ${quote.rail}`,
      payload: {
        amount_usdc: quote.amount,
        asset: quote.asset,
        provider_mode: settlement.providerMode,
        rail: quote.rail,
        reservation_id: reservationId,
        response: safeResponseMetadata(settlement.response),
        source_id: source.id,
        transaction: payment.transaction ?? null,
      },
    });
    const eventId = prefixedId('payevt');
    await client.query(
      `INSERT INTO payment_events (
         id, org_id, agent_id, connection_id, source_id, reservation_id,
         decision, provider_mode, rail, chain, amount_usdc, asset,
         recipient, network, resource_url, resource_category, quote, result, activity_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'settled', $7, $8, $9, $10::numeric, $11,
               $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18)`,
      [
        eventId,
        auth.org_id,
        auth.agent_id,
        auth.connection_id,
        source.id,
        reservationId,
        settlement.providerMode,
        quote.rail,
        quote.chain,
        quote.amount,
        quote.asset,
        quote.recipient,
        quote.x402Network,
        resource.url,
        resource.category,
        JSON.stringify(prepared.quotePayload),
        JSON.stringify({
          payment: {
            network: payment.network,
            status: payment.status,
            transaction: payment.transaction ?? null,
          },
          response: safeResponseMetadata(settlement.response),
        }),
        activity.id,
      ],
    );
    const result: RuntimeX402PaymentResult = {
      payment: {
        id: eventId,
        attemptId: attempt.id,
        status: 'settled',
        providerMode: settlement.providerMode,
        rail: quote.rail,
        chain: quote.chain,
        amount: quote.amount,
        asset: quote.asset,
        agentId: auth.agent_id,
        connectionId: auth.connection_id,
        sourceId: source.id,
        reservationId,
        recipient: quote.recipient,
        network: payment.network,
        ...(payment.transaction === undefined ? {} : { transaction: payment.transaction }),
        ...(payment.payer === undefined ? {} : { payer: payment.payer }),
        responseAvailable: settlement.response !== undefined,
      },
      ...(settlement.response === undefined ? {} : { response: settlement.response }),
    };
    const encrypted = resultCrypto.encrypt<StoredRuntimeX402Result>(
      { attemptId: attempt.id, connectionId: auth.connection_id, orgId: auth.org_id },
      {
        providerEvidence: settlement,
        result,
        ...(privateDebug === undefined ? {} : { privateDebug }),
      },
    );
    const finalized = await client.query(
      `UPDATE runtime_payment_attempts
          SET status = 'settled',
              payment_metadata = $4::jsonb,
              response_metadata = $5::jsonb,
              encrypted_result = $6::jsonb,
              result_expires_at = now() + interval '15 minutes',
              error_code = NULL,
              finalized_at = now(),
              updated_at = now()
        WHERE id = $1 AND org_id = $2 AND connection_id = $3 AND status = 'submitting'`,
      [
        attempt.id,
        auth.org_id,
        auth.connection_id,
        JSON.stringify({
          eventId,
          ...(payment.payer === undefined ? {} : { payer: payment.payer }),
          providerMode: settlement.providerMode,
          reservationId,
          ...(payment.transaction === undefined ? {} : { transactionHash: payment.transaction }),
        }),
        JSON.stringify(safeResponseMetadata(settlement.response)),
        JSON.stringify(encrypted),
      ],
    );
    if (finalized.rowCount !== 1) throw conflict('payment_attempt_state_conflict', 'Payment attempt state changed.');
    await recordAuditEvent(client, {
      orgId: auth.org_id,
      idempotencyKey: `payment.x402.settled:${attempt.id}`,
      eventType: 'payment.x402.settled',
      actor: { type: 'connection', id: auth.connection_id },
      action: 'payment.x402.settled',
      outcome: 'success',
      resource: { type: 'payment_event', id: eventId },
      classification: {
        domain: 'payment',
        category: 'financial',
        severity: 'info',
        tags: ['section_9', 'x402', quote.chain],
      },
      relations: { agent: auth.agent_id, connection: auth.connection_id },
      refs: {
        decision: prepared.policyGate.decisionId,
        ...(prepared.policyGate.approvalId === null ? {} : { approval: prepared.policyGate.approvalId }),
      },
      source: { section: 'section_9', system: 'payments' },
      retentionClass: 'payment',
      payload: {
        amount_usdc: quote.amount,
        asset: quote.asset,
        provider_mode: settlement.providerMode,
        rail: quote.rail,
        response: safeResponseMetadata(settlement.response),
        transaction: payment.transaction ?? null,
      },
    });
    return result;
  });
}

async function finalizeTerminalPaidHttpPayment(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  prepared: PreparedPaidHttpPayment,
  settlement: RuntimeX402SettlementResult,
  resultCrypto: X402ResultCryptoCodec,
  privateDebug: unknown,
): Promise<RuntimeX402PaymentResult> {
  const providerPayment = settlement.payment;
  const status = providerPayment?.status === 'failed' ? 'failed' : 'unknown';
  const errorCode = providerPayment?.errorCode ?? (
    status === 'failed' ? 'payment_settlement_failed' : 'payment_settlement_unknown'
  );
  return withTransaction(pool, async (client) => {
    const { attempt, quote, reservationId, source } = prepared;
    if (status === 'failed') {
      await client.query(
        `UPDATE payment_reservations SET status = 'released', updated_at = now()
          WHERE id = $1 AND org_id = $2 AND status = 'reserved'`,
        [reservationId, auth.org_id],
      );
      await client.query(
        `UPDATE agent_payment_accounts
            SET reserved_usdc = reserved_usdc - $3::numeric, updated_at = now()
          WHERE org_id = $1 AND agent_id = $2`,
        [auth.org_id, auth.agent_id, quote.amount],
      );
    }
    const activity = await recordActivity(client, {
      orgId: auth.org_id,
      agentId: auth.agent_id,
      connectionId: auth.connection_id,
      decisionId: prepared.policyGate.decisionId,
      approvalId: prepared.policyGate.approvalId ?? undefined,
      category: 'payment',
      action: `payment.x402.${status}`,
      outcome: 'error',
      summary: `x402 payment ${status} on ${quote.rail}`,
      payload: {
        amount_usdc: quote.amount,
        asset: quote.asset,
        error_code: errorCode,
        provider_mode: settlement.providerMode,
        rail: quote.rail,
        response: safeResponseMetadata(settlement.response),
      },
    });
    const eventId = prefixedId('payevt');
    await client.query(
      `INSERT INTO payment_events (
         id, org_id, agent_id, connection_id, source_id, reservation_id,
         decision, provider_mode, rail, chain, amount_usdc, asset,
         recipient, network, resource_url, resource_category, quote, result, activity_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric, $12,
               $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19)`,
      [
        eventId,
        auth.org_id,
        auth.agent_id,
        auth.connection_id,
        source.id,
        reservationId,
        status === 'failed' ? 'failed' : 'submitted',
        settlement.providerMode,
        quote.rail,
        quote.chain,
        quote.amount,
        quote.asset,
        quote.recipient,
        quote.x402Network,
        prepared.resource.url,
        prepared.resource.category,
        JSON.stringify(prepared.quotePayload),
        JSON.stringify({ error_code: errorCode, status }),
        activity.id,
      ],
    );
    const result: RuntimeX402PaymentResult = {
      payment: {
        id: eventId,
        attemptId: attempt.id,
        status,
        providerMode: settlement.providerMode,
        rail: quote.rail,
        chain: quote.chain,
        amount: quote.amount,
        asset: quote.asset,
        agentId: auth.agent_id,
        connectionId: auth.connection_id,
        sourceId: source.id,
        reservationId,
        recipient: quote.recipient,
        network: providerPayment?.network ?? quote.x402Network,
        ...(providerPayment?.transaction === undefined ? {} : { transaction: providerPayment.transaction }),
        ...(providerPayment?.payer === undefined ? {} : { payer: providerPayment.payer }),
        errorCode,
        responseAvailable: settlement.response !== undefined,
      },
      ...(settlement.response === undefined ? {} : { response: settlement.response }),
    };
    const encrypted = resultCrypto.encrypt<StoredRuntimeX402Result>(
      { attemptId: attempt.id, connectionId: auth.connection_id, orgId: auth.org_id },
      {
        providerEvidence: settlement,
        result,
        ...(privateDebug === undefined ? {} : { privateDebug }),
      },
    );
    const updated = await client.query(
      `UPDATE runtime_payment_attempts
          SET status = $4,
              payment_metadata = payment_metadata || $5::jsonb,
              response_metadata = $6::jsonb,
              encrypted_result = $7::jsonb,
              result_expires_at = now() + interval '15 minutes',
              error_code = $8,
              finalized_at = now(),
              updated_at = now()
        WHERE id = $1 AND org_id = $2 AND connection_id = $3 AND status = 'submitting'`,
      [
        attempt.id,
        auth.org_id,
        auth.connection_id,
        status,
        JSON.stringify({
          eventId,
          providerMode: settlement.providerMode,
          reservationId,
          ...(providerPayment?.payer === undefined ? {} : { payer: providerPayment.payer }),
          ...(providerPayment?.transaction === undefined ? {} : { transactionHash: providerPayment.transaction }),
        }),
        JSON.stringify(safeResponseMetadata(settlement.response)),
        JSON.stringify(encrypted),
        errorCode,
      ],
    );
    if (updated.rowCount !== 1) throw conflict('payment_attempt_state_conflict', 'Payment attempt state changed.');
    await recordAuditEvent(client, {
      orgId: auth.org_id,
      idempotencyKey: `payment.x402.${status}:${attempt.id}`,
      eventType: `payment.x402.${status}`,
      actor: { type: 'connection', id: auth.connection_id },
      action: `payment.x402.${status}`,
      outcome: 'error',
      resource: { type: 'payment_event', id: eventId },
      classification: {
        domain: 'payment',
        category: 'financial',
        severity: 'warning',
        tags: ['section_9', 'x402', quote.chain],
      },
      relations: { agent: auth.agent_id, connection: auth.connection_id },
      refs: { decision: prepared.policyGate.decisionId },
      source: { section: 'section_9', system: 'payments' },
      retentionClass: 'payment',
      payload: {
        amount_usdc: quote.amount,
        asset: quote.asset,
        error_code: errorCode,
        provider_mode: settlement.providerMode,
        rail: quote.rail,
        response: safeResponseMetadata(settlement.response),
      },
    });
    return result;
  });
}

export type UnknownAttemptRecord = {
  readonly reservationId: string;
  readonly agentId: string;
  readonly amountUsdc: string;
  readonly rail: PaymentRail;
  readonly paymentEventId: string;
  readonly errorCode: string | null;
  readonly createdAt: string;
};

type UnknownAttemptRow = {
  readonly reservation_id: string;
  readonly agent_id: string;
  readonly amount_usdc: string;
  readonly rail: PaymentRail;
  readonly payment_event_id: string;
  readonly error_code: string | null;
  readonly created_at: Date;
};

function unknownAttemptFromRow(row: UnknownAttemptRow): UnknownAttemptRecord {
  return {
    reservationId: row.reservation_id,
    agentId: row.agent_id,
    amountUsdc: row.amount_usdc,
    rail: row.rail,
    paymentEventId: row.payment_event_id,
    errorCode: row.error_code,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Lists reservations still 'reserved' whose payment settled as 'unknown' --
 * the fund-leak state finalizeTerminalPaidHttpPayment produces when the
 * provider's outcome is ambiguous. Neither settled nor failed, these
 * strand reserved_usdc forever with no worker and no automatic path to
 * adjudicate: an operator must look at what actually happened (did the
 * merchant deliver? does the provider's own record show a transaction?)
 * and resolve it by hand.
 */
export async function listUnknownAttempts(
  pool: pg.Pool,
  orgId: string,
  limit = 100,
): Promise<UnknownAttemptRecord[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 250));
  const result = await pool.query<UnknownAttemptRow>(
    `SELECT r.id AS reservation_id, r.agent_id, r.amount_usdc, r.rail,
            e.id AS payment_event_id, e.result->>'error_code' AS error_code, r.created_at
       FROM payment_reservations r
       JOIN payment_events e ON e.reservation_id = r.id
      WHERE r.org_id = $1
        AND r.status = 'reserved'
        AND e.result->>'status' = 'unknown'
      ORDER BY r.created_at DESC
      LIMIT $2`,
    [orgId, boundedLimit],
  );
  return result.rows.map(unknownAttemptFromRow);
}

export type ResolveUnknownAttemptOutcome = 'failed' | 'settled';

/**
 * Resolves an unknown-status attempt by hand. 'failed' releases the
 * reservation and reserved_usdc, exactly like the normal failed path
 * finalizeTerminalPaidHttpPayment already takes -- the operator has
 * determined the payment did NOT go through. 'settled' marks the
 * reservation settled without touching reserved_usdc, matching the
 * settled path's bookkeeping -- the operator has determined it DID.
 *
 * Audit-evented deliberately: an operator moving money (or declaring it
 * moved) by hand outside the normal automated path is exactly what the
 * evidence trail exists for.
 */
export async function resolveUnknownAttempt(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  reservationId: string,
  outcome: ResolveUnknownAttemptOutcome,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const reservation = await client.query<PaymentReservationRow>(
      `SELECT * FROM payment_reservations
        WHERE id = $1 AND org_id = $2 AND status = 'reserved'
        FOR UPDATE`,
      [reservationId, orgId],
    );
    const row = reservation.rows[0];
    if (row === undefined) throw notFound('Unknown attempt reservation was not found.');

    const paymentEvent = await client.query<{ id: string }>(
      `SELECT e.id FROM payment_events e
        WHERE e.reservation_id = $1 AND e.org_id = $2 AND e.result->>'status' = 'unknown'
        LIMIT 1`,
      [reservationId, orgId],
    );
    if (paymentEvent.rows[0] === undefined) {
      throw badRequest('not_an_unknown_attempt', 'Reservation is not in an unknown-status attempt.');
    }

    const newStatus = outcome === 'failed' ? 'released' : 'settled';
    await client.query(
      `UPDATE payment_reservations SET status = $3, updated_at = now()
        WHERE id = $1 AND org_id = $2`,
      [reservationId, orgId, newStatus],
    );
    if (outcome === 'failed') {
      await client.query(
        `UPDATE agent_payment_accounts
            SET reserved_usdc = reserved_usdc - $3::numeric, updated_at = now()
          WHERE org_id = $1 AND agent_id = $2`,
        [orgId, row.agent_id, row.amount_usdc],
      );
    } else {
      await client.query(
        `UPDATE agent_payment_accounts
            SET reserved_usdc = reserved_usdc - $3::numeric,
                spent_usdc = spent_usdc + $3::numeric,
                updated_at = now()
          WHERE org_id = $1 AND agent_id = $2`,
        [orgId, row.agent_id, row.amount_usdc],
      );
    }

    await recordAuditEvent(client, {
      orgId,
      idempotencyKey: `payment.unknown.resolved:${reservationId}`,
      eventType: 'payment.unknown.resolved',
      actor: { type: 'user', id: operator.actorId },
      action: 'payment.unknown.resolve',
      outcome: 'success',
      resource: { type: 'payment_reservation', id: reservationId },
      classification: {
        domain: 'payment',
        category: 'financial',
        severity: 'warning',
        tags: ['section_9', 'unknown_attempt_resolution'],
      },
      relations: { agent: row.agent_id },
      refs: {},
      source: { section: 'section_9', system: 'payments' },
      retentionClass: 'payment',
      payload: {
        amount_usdc: row.amount_usdc,
        outcome,
        rail: row.rail,
      },
    });
  });
}

async function persistPaidHttpProviderEvidence(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  attemptId: string,
  settlement: RuntimeX402SettlementResult,
  privateDebug: unknown,
  resultCrypto: X402ResultCryptoCodec,
): Promise<void> {
  const evidence = resultCrypto.encrypt<StoredRuntimeX402ProviderEvidence>(
    { attemptId, connectionId: auth.connection_id, orgId: auth.org_id },
    { settlement, ...(privateDebug === undefined ? {} : { privateDebug }) },
  );
  const updated = await pool.query(
    `UPDATE runtime_payment_attempts
        SET encrypted_result = $4::jsonb,
            result_expires_at = now() + interval '15 minutes',
            response_metadata = $5::jsonb,
            payment_metadata = payment_metadata || $6::jsonb,
            updated_at = now()
      WHERE id = $1 AND org_id = $2 AND connection_id = $3 AND status = 'submitting'`,
    [
      attemptId,
      auth.org_id,
      auth.connection_id,
      JSON.stringify(evidence),
      JSON.stringify(safeResponseMetadata(settlement.response)),
      JSON.stringify({
        providerMode: settlement.providerMode,
        ...(settlement.payment?.payer === undefined ? {} : { payer: settlement.payment.payer }),
        ...(settlement.payment?.transaction === undefined
          ? {}
          : { transactionHash: settlement.payment.transaction }),
      }),
    ],
  );
  if (updated.rowCount !== 1) throw conflict('payment_attempt_state_conflict', 'Payment attempt state changed.');
}

async function recordPaidHttpPreflightRejection(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  prepared: PreparedPaidHttpPayment,
  reasonCode: string,
): Promise<void> {
  await recordRouteObservation(pool, {
    orgId: auth.org_id,
    agentId: auth.agent_id,
    connectionId: auth.connection_id,
    requestedNetwork: prepared.quote.network,
    requestedAsset: prepared.quote.asset,
    requestedRail: prepared.quote.rail,
    supportedRail: prepared.quote.rail,
    amount: prepared.quote.amount,
    outcome: 'rejected',
    reasonCode,
    resourceUrl: prepared.resource.url,
    resourceCategory: prepared.resource.category,
  });
}

async function assertPaidHttpPreSubmitReady(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  prepared: PreparedPaidHttpPayment,
  provider: CircleTreasuryProvider,
): Promise<string | undefined> {
  const { mode, paymentInput, quote, resource, source } = prepared;
  if (source.provider === 'simulation') return undefined;
  let gatewayPayerAddress: string | undefined;

  const capability = await getCircleChainCapability(pool, mode, quote.chain);
  const readinessFailure = railVerificationFailure(capability, quote);
  if (readinessFailure !== null) throw conflict(readinessFailure.code, readinessFailure.message);

  if (quote.settlementKind === 'direct_exact' && source.provider === 'circle_wallets') {
    let availableMicros: bigint;
    try {
      const balances = await listCircleBalances(pool, auth.org_id, provider);
      const chainBalance = balances.find((balance) => balance.chain === quote.chain);
      availableMicros = chainBalance === undefined ? 0n : walletUsdcMicros(chainBalance);
    } catch {
      await recordPaidHttpPreflightRejection(pool, auth, prepared, 'wallet_balance_check_failed');
      throw conflict(
        'wallet_balance_check_failed',
        'Exact wallet balance could not be verified before payment submission.',
      );
    }
    if (availableMicros < quote.amountMicros) {
      await recordPaidHttpPreflightRejection(pool, auth, prepared, 'exact_wallet_below_request');
      const job = await createExactLiquidityPreparationJob(pool, {
        auth,
        mode,
        paymentInput,
        provider,
        quote,
        resource,
      });
      await recordPaidHttpPreflightRejection(pool, auth, prepared, 'liquidity_preparing');
      throw new PaymentLiquidityPreparingError(
        job.id,
        quote.rail,
        quote.chain,
        LIQUIDITY_PREP_RETRY_AFTER_SECONDS,
        `Preparing ${job.amount_usdc} USDC for ${quote.rail}. Retry the x402 payment after the liquidity job is ready.`,
      );
    }
  }

  if (quote.settlementKind === 'gateway' && source.provider === 'circle_gateway') {
    let availableMicros: bigint;
    try {
      const chainWallet = await activeCircleWallet(pool, auth.org_id, mode, quote.chain);
      const gatewayDepositorAddress = resolveGatewayDepositorAddress(chainWallet.address, chainWallet.metadata);
      gatewayPayerAddress = gatewayDepositorAddress;
      const balance = await provider.getGatewayBalance({
        address: gatewayDepositorAddress,
        chain: quote.chain,
        mode,
      });
      availableMicros = parseUsdcMicros(balance.available);
    } catch {
      await recordPaidHttpPreflightRejection(pool, auth, prepared, 'gateway_balance_check_failed');
      const job = await createGatewayLiquidityPreparationJob(pool, {
        auth,
        mode,
        paymentInput,
        provider,
        quote,
        reasonCode: 'gateway_balance_unavailable',
        resource,
      });
      await recordPaidHttpPreflightRejection(pool, auth, prepared, 'liquidity_preparing');
      throw new PaymentLiquidityPreparingError(
        job.id,
        quote.rail,
        quote.chain,
        LIQUIDITY_PREP_RETRY_AFTER_SECONDS,
        `Preparing ${job.amount_usdc} USDC for ${quote.rail}. Retry the x402 payment after Gateway balance is verified.`,
      );
    }
    if (availableMicros < quote.amountMicros) {
      await recordPaidHttpPreflightRejection(pool, auth, prepared, 'insufficient_gateway_chain_balance');
      const job = await createGatewayLiquidityPreparationJob(pool, {
        auth,
        mode,
        paymentInput,
        provider,
        quote,
        reasonCode: 'gateway_bucket_below_request',
        resource,
      });
      await recordPaidHttpPreflightRejection(pool, auth, prepared, 'liquidity_preparing');
      throw new PaymentLiquidityPreparingError(
        job.id,
        quote.rail,
        quote.chain,
        LIQUIDITY_PREP_RETRY_AFTER_SECONDS,
        `Preparing ${job.amount_usdc} USDC for ${quote.rail}. Retry the x402 payment after the liquidity job is ready.`,
      );
    }
  }
  return gatewayPayerAddress;
}

async function markPaidHttpAttemptRetryable(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  attemptId: string,
  reason: string,
): Promise<void> {
  await pool.query(
    `UPDATE runtime_payment_attempts
        SET payment_metadata = payment_metadata || $4::jsonb,
            updated_at = now()
      WHERE id = $1 AND org_id = $2 AND connection_id = $3 AND status = 'reserved'`,
    [attemptId, auth.org_id, auth.connection_id, JSON.stringify({ resumeReason: reason })],
  );
}

export async function payRuntimeX402(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  input: RuntimePaidHttpX402Input,
  provider: CircleTreasuryProvider = createCircleTreasuryProvider(),
  options: PayRuntimeX402Options = {},
): Promise<RuntimeX402PaymentResult> {
  const resultCrypto = options.resultCrypto;
  if (resultCrypto === undefined) {
    throw new IdentityError(
      'x402_result_encryption_unavailable',
      503,
      'Durable x402 result encryption is not configured.',
    );
  }
  const requestHash = canonicalPaidHttpRequestHash(input.request);
  const attempts = createPostgresX402AttemptStore(pool, { resultCrypto });
  await attempts.cancelStrandedReservedAttempts({
    agentId: auth.agent_id,
    orgId: auth.org_id,
  });
  const existing = await attempts.findAttempt(auth.connection_id, input.idempotency_key);
  let prepared: PreparedPaidHttpPayment;
  let freshAttempt = false;
  if (existing !== null) {
    if (existing.org_id !== auth.org_id || existing.connection_id !== auth.connection_id) {
      throw new IdentityError('payment_attempt_scope_invalid', 404, 'Payment attempt was not found.');
    }
    if (existing.request_hash !== requestHash) {
      throw conflict(
        'payment_idempotency_conflict',
        'This idempotency key is already bound to a different payment request.',
      );
    }
    if (existing.encrypted_result !== null) {
      const retained = resultCrypto.decrypt<StoredRuntimeX402Result | StoredRuntimeX402ProviderEvidence>(
        { attemptId: existing.id, connectionId: auth.connection_id, orgId: auth.org_id },
        existing.encrypted_result,
      );
      if ('result' in retained) return retained.result;
      if (existing.status === 'submitting' && 'settlement' in retained) {
        prepared = await resumePreparedPaidHttpPayment(pool, auth, input, existing, options, true, true);
        return retained.settlement.payment?.status === 'settled'
          ? finalizeSettledPaidHttpPayment(
              pool,
              auth,
              prepared,
              retained.settlement,
              resultCrypto,
              retained.privateDebug,
            )
          : finalizeTerminalPaidHttpPayment(
              pool,
              auth,
              prepared,
              retained.settlement,
              resultCrypto,
              retained.privateDebug,
            );
      }
    }
    if (existing.status !== 'reserved') return paymentResultFromAttempt(existing);
    prepared = await resumePreparedPaidHttpPayment(pool, auth, input, existing, options);
  } else {
    freshAttempt = true;
    const normalizedRequest = normalizePaidHttpRequest(input.request);
    const destination = await assertPaidHttpUrlAllowed(input.request.url, options.paidHttpUrlPolicy);
    const discovery = await (options.paidHttpExecutor ?? executeBoundedHttpRequest)(
      normalizedRequest,
      destination,
      options.paidHttpExecution,
    );
    const required = paymentRequiredFromResponse(discovery);
    if (new URL(required.resource.url).href !== destination.url) {
      throw conflict(
        'payment_quote_resource_mismatch',
        'The discovered x402 quote does not match the requested resource.',
      );
    }
    const resourceMethod = stringValue((required.resource as unknown as Record<string, unknown>).method);
    if (resourceMethod !== null && resourceMethod.toUpperCase() !== input.request.method) {
      throw conflict(
        'payment_quote_resource_mismatch',
        'The discovered x402 quote does not match the requested method.',
      );
    }
    const paymentInput: RuntimeX402PaymentInput = {
      resource: required.resource as unknown as Record<string, unknown>,
      accepts: required.accepts,
      context: { idempotency_key: input.idempotency_key },
    };
    const preparation = await preparePaidHttpPayment(
      pool,
      auth,
      input,
      requestHash,
      destination,
      paymentInput,
      resultCrypto,
    );
    if (preparation.kind === 'existing') {
      const racedAttempt = preparation.attempt;
      if (racedAttempt.encrypted_result !== null) {
        const retained = resultCrypto.decrypt<StoredRuntimeX402Result | StoredRuntimeX402ProviderEvidence>(
          { attemptId: racedAttempt.id, connectionId: auth.connection_id, orgId: auth.org_id },
          racedAttempt.encrypted_result,
        );
        if ('result' in retained) return retained.result;
      }
      return paymentResultFromAttempt(racedAttempt);
    }
    prepared = preparation.payment;
  }
  if (freshAttempt) await options.orchestrationHooks?.afterReserved?.();
  if (prepared.approvalRequired !== undefined) throw prepared.approvalRequired;
  let payerAddress: string | undefined;
  try {
    payerAddress = await assertPaidHttpPreSubmitReady(pool, auth, prepared, provider);
  } catch (error) {
    await markPaidHttpAttemptRetryable(
      pool,
      auth,
      prepared.attempt.id,
      error instanceof IdentityError ? error.code : 'payment_preflight_failed',
    );
    throw error;
  }
  if (prepared.policyGate.approvalId !== null) {
    await consumeApproval(
      pool,
      auth,
      prepared.policyGate.approvalId,
      prepared.policyGate.decisionId,
    );
  }
  await attempts.markSubmitting(
    { connectionId: auth.connection_id, orgId: auth.org_id },
    prepared.attempt.id,
  );
  await options.orchestrationHooks?.afterSubmitting?.();

  let settlement: RuntimeX402SettlementResult;
  try {
    settlement = prepared.source.provider === 'simulation'
      ? {
          network: prepared.quote.x402Network,
          payment: { network: prepared.quote.x402Network, status: 'settled' as const },
          providerMode: 'simulation' as const,
          success: true,
        }
      : prepared.quote.settlementKind === 'gateway'
        ? await provider.settleGatewayX402({
            attemptId: prepared.attempt.id,
            destination: prepared.destination,
            mode: prepared.mode,
            ...(payerAddress === undefined ? {} : { payerAddress }),
            request: input.request,
            resource: x402ProviderResource(prepared.paymentInput),
            requirements: prepared.quote.x402Requirements,
            walletAddress: prepared.source.address as string,
            walletId: prepared.source.external_wallet_id as string,
          })
        : await provider.settleExactX402({
            attemptId: prepared.attempt.id,
            destination: prepared.destination,
            mode: prepared.mode,
            ...(payerAddress === undefined ? {} : { payerAddress }),
            request: input.request,
            resource: x402ProviderResource(prepared.paymentInput),
            requirements: prepared.quote.x402Requirements,
            walletAddress: prepared.source.address as string,
            walletId: prepared.source.external_wallet_id as string,
          });
  } catch (error) {
    const classification = (error as { readonly classification?: unknown }).classification;
    const errorCode = error instanceof Error ? error.message : 'payment_provider_failed';
    const status = classification === 'ambiguous_post_submit' ? 'unknown' as const : 'failed' as const;
    settlement = {
      errorReason: errorCode,
      network: prepared.quote.x402Network,
      payment: { errorCode, network: prepared.quote.x402Network, status },
      providerMode: prepared.mode,
      success: false,
    };
  }
  const privateDebug = settlement.providerMode === 'simulation'
    ? undefined
    : takeCircleProviderPaidRequestDebug(settlement as CircleGatewayX402SettlementResult);
  await persistPaidHttpProviderEvidence(
    pool,
    auth,
    prepared.attempt.id,
    settlement,
    privateDebug,
    resultCrypto,
  );
  await options.orchestrationHooks?.afterProviderEvidence?.();
  return settlement.payment?.status === 'settled'
    ? finalizeSettledPaidHttpPayment(pool, auth, prepared, settlement, resultCrypto, privateDebug)
    : finalizeTerminalPaidHttpPayment(pool, auth, prepared, settlement, resultCrypto, privateDebug);
}
