import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import type { PaidHttpExecutor, PaidHttpResponse } from '../../src/engines/payments/x402-http.js';
import { createX402ResultCryptoCodec } from '../../src/engines/payments/x402-result-crypto.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type OrgResponse = {
  readonly org: {
    readonly id: string;
  };
};

type AgentResponse = {
  readonly agent: {
    readonly id: string;
  };
};

type ConnectionCreateResponse = {
  readonly secret: string;
};

type AgentActivityFeedResponse = {
  readonly events: ReadonlyArray<{
    readonly action: string;
    readonly outcome: string;
    readonly summary: string;
  }>;
};

type ProviderHealthResponse = {
  readonly health: {
    readonly configured: boolean;
    readonly mode: 'test' | 'live';
    readonly missing: readonly string[];
  };
};

type PaymentModeResponse = {
  readonly mode: {
    readonly mode: 'test' | 'live';
  };
};

type CircleTreasuryResponse = {
  readonly walletSet: {
    readonly mode: 'test' | 'live';
    readonly circle_wallet_set_id: string;
    readonly status: 'active';
  };
  readonly wallets: ReadonlyArray<{
    readonly chain: string;
    readonly circle_wallet_id: string;
    readonly address: string;
    readonly status: 'active';
  }>;
};

type PaymentCapabilitiesResponse = {
  readonly capabilities: ReadonlyArray<{
    readonly chain: string;
    readonly exact_settlement_verified: boolean;
    readonly gateway_settlement_verified: boolean;
    readonly gateway_supported: boolean;
    readonly nanopayments_supported: boolean;
    readonly wallet_supported: boolean;
  }>;
};

type WalletsResponse = {
  readonly wallets: ReadonlyArray<{
    readonly chain: string;
    readonly mode: 'test' | 'live';
  }>;
};

type CircleBalancesResponse = {
  readonly balances: ReadonlyArray<{
    readonly chain: string;
    readonly gateway: {
      readonly available: string;
      readonly domain: number;
    } | null;
    readonly tokens: ReadonlyArray<{
      readonly amount: string;
      readonly is_native: boolean;
      readonly symbol: string | null;
    }>;
  }>;
};

type ProviderJobResponse = {
  readonly job: {
    readonly id: string;
    readonly amount_usdc: string | null;
    readonly chain: string | null;
    readonly error_code: string | null;
    readonly job_type: string;
    readonly metadata: Record<string, unknown>;
    readonly provider_ref: string | null;
    readonly status: string;
  };
};

type ProviderJobsResponse = {
  readonly jobs: ReadonlyArray<ProviderJobResponse['job']>;
};

type ProviderJobBatchResponse = {
  readonly failed: number;
  readonly jobs: ReadonlyArray<ProviderJobResponse['job']>;
};

type PolicyActivationResponse = {
  readonly policy: {
    readonly id: string;
    readonly version: number;
  };
};

type LiquidityPreparingResponse = {
  readonly chain: string;
  readonly error: 'liquidity_preparing';
  readonly jobId: string;
  readonly message: string;
  readonly rail: string;
  readonly retryAfterSeconds: number;
};

type TreasuryOverviewResponse = {
  readonly overview: {
    readonly mode: 'test' | 'live';
    readonly totals: {
      readonly gateway_usdc: string;
      readonly wallet_usdc: string;
      readonly treasury_usdc: string;
    };
    readonly liquidity: {
      readonly pending_jobs: number;
      readonly failed_jobs: number;
      readonly last_job: ProviderJobResponse['job'] | null;
    };
    readonly payments: {
      readonly agents_with_access: number;
      readonly total_spent_usdc: string;
      readonly last_payment: null | {
        readonly amount: string;
        readonly rail: string;
      };
    };
  };
};

type RebalanceRecommendationsResponse = {
  readonly recommendations: ReadonlyArray<{
    readonly amount_usdc: string;
    readonly chain: string;
    readonly current_wallet_usdc: string;
    readonly deficit_usdc: string;
    readonly reason_code: string;
    readonly recent_exact_spend_usdc: string;
    readonly recommended_min_usdc: string;
    readonly source_chain: string;
  }>;
};

type PaymentEventsResponse = {
  readonly events: ReadonlyArray<{
    readonly amount_usdc: string;
    readonly decision: string;
    readonly provider_mode: 'simulation' | 'test' | 'live';
    readonly rail: string;
    readonly resource_category: string | null;
    readonly result: Record<string, unknown>;
  }>;
};

type PaymentRouteObservationsResponse = {
  readonly observations: ReadonlyArray<{
    readonly amount_usdc: string | null;
    readonly outcome: 'accepted' | 'rejected';
    readonly reason_code: string;
    readonly requested_rail: string | null;
    readonly supported_rail: string | null;
  }>;
};

type PaymentReservationsResponse = {
  readonly reservations: ReadonlyArray<{
    readonly amount_usdc: string;
    readonly rail: string;
    readonly reason_code: string;
    readonly status: string;
  }>;
};

type PaymentRailReadinessResponse = {
  readonly rails: ReadonlyArray<{
    readonly rail: string;
    readonly status: 'ready' | 'unverified' | 'unsupported';
    readonly settlement_verified: boolean;
    readonly last_observed_at: string | null;
    readonly last_payment_at: string | null;
    readonly last_proof_at: string | null;
    readonly last_proof_status: string | null;
  }>;
};

type LegacyPaymentPayload = {
  readonly accepts: ReadonlyArray<{
    readonly amount: string;
    readonly asset: string;
    readonly extra?: Record<string, unknown>;
    readonly network: string;
    readonly payTo: string;
    readonly scheme: string;
  }>;
  readonly resource: {
    readonly category?: string;
    readonly method?: string;
    readonly mimeType?: string;
    readonly url: string;
  };
};

const paidHttpQuotes = new Map<string, unknown>();
const paidHttpOrigins: string[] = [];
let paidHttpId = 0;

function canonicalPaidHttpPayload(payment: LegacyPaymentPayload) {
  const url = new URL(payment.resource.url).href;
  paidHttpQuotes.set(url, {
    accepts: payment.accepts.map((accept) => ({
      ...accept,
      extra: accept.extra ?? {},
      maxTimeoutSeconds: 60,
    })),
    resource: {
      description: 'Section 9 paid resource',
      mimeType: 'application/json',
      ...payment.resource,
      url,
    },
    x402Version: 2,
  });
  paidHttpId += 1;
  return {
    idempotency_key: `section-9-${paidHttpId}`,
    request: { headers: [], method: 'GET' as const, url },
  };
}

const paidHttpExecutor: PaidHttpExecutor = (request) => Promise.resolve({
  body: paidHttpQuotes.get(request.url),
  bodyEncoding: 'json',
  contentType: 'application/json',
  headers: [['content-type', 'application/json']],
  sizeBytes: 512,
  status: 402,
  truncated: false,
});

function paidJsonResponse(body: unknown): PaidHttpResponse {
  return {
    body,
    bodyEncoding: 'json',
    contentType: 'application/json',
    headers: [['content-type', 'application/json']],
    sizeBytes: JSON.stringify(body).length,
    status: 200,
    truncated: false,
  };
}

let gatewaySettlement: Awaited<ReturnType<CircleTreasuryProvider['settleGatewayX402']>> = {
  network: 'eip155:84532',
  payment: { network: 'eip155:84532', status: 'settled', transaction: '0xtest' },
  providerMode: 'test',
  success: true,
  transaction: '0xtest',
};
let gatewaySettleCalls = 0;
let exactSettleCalls = 0;
let gatewayDepositCalls = 0;
let gatewayBalanceAddresses: string[] = [];
let bridgeTopUpCalls = 0;
let bridgeTopUpIdempotencyKeys: string[] = [];
let bridgeTopUpAmounts: string[] = [];
let walletUsdcByChain: Record<string, string> = {};
let gatewayUsdcByChain: Record<string, string> = {};
let gatewayDepositCreditsBalance = true;
let gatewayDepositNeverSettles = false;
let gatewayBalanceFailureChains = new Set<string>();
let bridgeTopUpCreditsBalance = true;
let bridgeTopUpNeverSettles = false;
let exactSettlement: Awaited<ReturnType<CircleTreasuryProvider['settleExactX402']>> = {
  network: 'eip155:84532',
  payment: {
    network: 'eip155:84532',
    payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    status: 'settled',
    transaction: '0xexact',
  },
  payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  providerMode: 'test',
  success: true,
  transaction: '0xexact',
};
let walletAddressNibble = 'a';

function addUsdc(left: string, right: string): string {
  return (Number(left) + Number(right)).toFixed(6).replace(/\.?0+$/, '');
}

function fakeCircleProvider(): CircleTreasuryProvider {
  return {
    health: () => ({
      configured: true,
      mode: 'test',
      missing: [],
      provider: 'circle',
    }),
    createWalletSet: ({ orgId, mode }) => Promise.resolve({
      circleWalletSetId: `circle_ws_${mode}_${orgId.slice(-6)}`,
    }),
    createWallet: ({ chain, mode }) => Promise.resolve({
      address: `0x${walletAddressNibble.repeat(40)}`,
      circleWalletId: `circle_wallet_${mode}_${chain}`,
    }),
    getGatewayBalance: ({ address, chain, mode }) => {
      gatewayBalanceAddresses.push(address);
      if (gatewayBalanceFailureChains.has(chain)) return Promise.reject(new Error(`gateway_balance_${chain}_rate_limited`));
      return Promise.resolve({
        available: gatewayUsdcByChain[chain] ?? '0',
        domain: chain === 'base' ? 6 : 3,
        providerMode: mode,
        total: gatewayUsdcByChain[chain] ?? '0',
        withdrawable: gatewayUsdcByChain[chain] ?? '0',
        withdrawing: '0',
      });
    },
    getWalletBalances: ({ mode, walletId }) => Promise.resolve({
      balances: [
        {
          amount: walletUsdcByChain[walletId.split('_').at(-1) ?? ''] ?? '0',
          blockchain: walletId.split('_').at(-1)?.toUpperCase() ?? null,
          isNative: false,
          symbol: 'USDC',
          tokenAddress: '0xusdc',
        },
        {
          amount: '0.01',
          blockchain: walletId.split('_').at(-1)?.toUpperCase() ?? null,
          isNative: true,
          symbol: 'ETH',
          tokenAddress: null,
        },
      ],
      providerMode: mode,
    }),
    initiateGatewayDeposit: ({ amountMicros, chain, mode }) => {
      gatewayDepositCalls += 1;
      if (gatewayDepositNeverSettles) return new Promise(() => undefined);
      const amount = (Number(amountMicros) / 1_000_000).toFixed(2);
      if (gatewayDepositCreditsBalance) gatewayUsdcByChain[chain] = addUsdc(gatewayUsdcByChain[chain] ?? '0', amount);
      return Promise.resolve({
        amount,
        amountMicros: amountMicros.toString(),
        approvalTransactionId: `circle_tx_approve_${mode}_${chain}`,
        depositTransactionId: `circle_tx_deposit_${mode}_${chain}`,
        gatewayDepositorAddress: '0x7d3f0acb46b1de6f4427d5464ead7b2b108102a0',
        gatewayWalletAddress: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
        providerMode: mode,
        usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      });
    },
    requestTestnetFunds: ({ address, chain, mode }) => Promise.resolve({
      address,
      chain,
      providerMode: mode,
      response: { id: `faucet_${chain}` },
    }),
    bridgeWalletTopUp: ({ amount, fromChain, idempotencyKey, mode, toChain }) => {
      bridgeTopUpCalls += 1;
      bridgeTopUpIdempotencyKeys.push(idempotencyKey ?? '');
      bridgeTopUpAmounts.push(amount);
      if (bridgeTopUpNeverSettles) return new Promise(() => undefined);
      if (bridgeTopUpCreditsBalance) walletUsdcByChain[toChain] = addUsdc(walletUsdcByChain[toChain] ?? '0', amount);
      return Promise.resolve({
        amount,
        fromChain,
        providerMode: mode,
        success: true,
        toChain,
        transaction: `circle_bridge_${mode}_${fromChain}_${toChain}`,
      });
    },
    settleExactX402: () => {
      exactSettleCalls += 1;
      return Promise.resolve(exactSettlement);
    },
    settleGatewayX402: () => {
      gatewaySettleCalls += 1;
      return Promise.resolve(gatewaySettlement);
    },
  };
}

async function createOrg(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: {
      name: 'Circle Treasury Org',
      owner: { email: 'circle@example.test', name: 'Circle Owner' },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<OrgResponse>().org.id;
}

async function createActivatedPaymentDenyPolicy(app: FastifyInstance, orgId: string, agentId: string) {
  const draftResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/policy-drafts`,
    payload: {
      name: 'Block weather payments',
      description: 'Deny x402 payments for weather resources before liquidity preparation starts.',
      category: 'capability',
      source: 'structured',
      statements: [
        {
          id: 'stmt_block_weather_payments',
          actions: ['payment.x402.authorize'],
          audit: 'standard',
          conditions: {
            resource: { categories: ['weather'] },
          },
          decision: 'deny',
          target: { types: ['agent'] },
        },
      ],
    },
  });
  expect(draftResponse.statusCode, draftResponse.body).toBe(201);
  const draftId = draftResponse.json<{ readonly draft: { readonly id: string } }>().draft.id;

  const validateResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/policy-drafts/${draftId}/validate`,
  });
  expect(validateResponse.statusCode, validateResponse.body).toBe(200);

  const activateResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/policy-drafts/${draftId}/activate`,
  });
  expect(activateResponse.statusCode, activateResponse.body).toBe(200);
  const policy = activateResponse.json<PolicyActivationResponse>().policy;

  const bindResponse = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/policies/${policy.id}/bindings`,
    payload: {
      policy_version: policy.version,
      target_id: agentId,
      target_type: 'agent',
    },
  });
  expect(bindResponse.statusCode, bindResponse.body).toBe(201);

  return policy;
}

async function markGatewayRailVerified(store: PostgresTestStore, chain: string): Promise<void> {
  await store.pool.query(
    `UPDATE circle_chain_capabilities
        SET gateway_settlement_verified = true,
            metadata = metadata || jsonb_build_object('test_override', 'gateway rail verified for liquidity-prep regression')
      WHERE mode = 'test'
        AND chain = $1`,
    [chain],
  );
}

describe('Section 9 Circle treasury foundation', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;
  let appBaseUrl: string;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      enableTestnetX402Fixtures: true,
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_circle_owner', role: 'owner' }),
      },
      payments: {
        circleProvider: fakeCircleProvider(),
        paidHttpExecutor,
        paidHttpUrlPolicy: {
          allowHttpOrigins: paidHttpOrigins,
          resolveHostname: () => Promise.resolve(['93.184.216.34']),
        },
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_circle_owner', role: 'owner' }),
        resultCrypto: createX402ResultCryptoCodec(randomBytes(32).toString('base64')),
      },
      policy: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_circle_owner', role: 'owner' }),
      },
    });
    app.get('/paid-resource-test', (request) => ({
      ok: true,
      proof: {
        amount: request.headers['x-agentops-payment-amount'],
        asset: request.headers['x-agentops-payment-asset'],
        payer: request.headers['x-agentops-payment-payer'],
        recipient: request.headers['x-agentops-payment-recipient'],
        tx: request.headers['x-agentops-payment-tx'],
      },
    }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('test_server_address_unavailable');
    appBaseUrl = `http://127.0.0.1:${address.port}`;
    paidHttpOrigins.push(new URL(appBaseUrl).origin);
  }, 90_000);

  beforeEach(async () => {
    walletAddressNibble = 'a';
    gatewaySettleCalls = 0;
    exactSettleCalls = 0;
    gatewayDepositCalls = 0;
    gatewayBalanceAddresses = [];
    bridgeTopUpCalls = 0;
    bridgeTopUpIdempotencyKeys = [];
    bridgeTopUpAmounts = [];
    bridgeTopUpCreditsBalance = true;
    bridgeTopUpNeverSettles = false;
    gatewayDepositNeverSettles = false;
    gatewayBalanceFailureChains = new Set();
    gatewayDepositCreditsBalance = true;
    walletUsdcByChain = {
      arbitrum: '0',
      avalanche: '0',
      base: '8.50',
      optimism: '0',
      polygon: '0',
    };
    gatewayUsdcByChain = {
      arbitrum: '0',
      avalanche: '0',
      base: '4.25',
      optimism: '0',
      polygon: '0',
    };
    exactSettlement = {
      network: 'eip155:84532',
      payment: {
        network: 'eip155:84532',
        payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: 'settled',
        transaction: '0xexact',
      },
      payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      providerMode: 'test',
      success: true,
      transaction: '0xexact',
    };
    gatewaySettlement = {
      network: 'eip155:84532',
      payment: { network: 'eip155:84532', status: 'settled', transaction: '0xtest' },
      providerMode: 'test',
      success: true,
      transaction: '0xtest',
    };
    await store.pool.query(
      `UPDATE circle_chain_capabilities
          SET gateway_settlement_verified = (chain = 'base'),
              exact_settlement_verified = true
        WHERE mode = 'test'`,
    );
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (store !== undefined) await store.stop();
    vi.unstubAllEnvs();
  });

  it('keeps Circle credentials server-side and reports provider health without org API-key input', async () => {
    const orgId = await createOrg(app);

    const health = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/provider-health`,
    });

    expect(health.statusCode, health.body).toBe(200);
    expect(health.json<ProviderHealthResponse>().health).toMatchObject({
      configured: true,
      mode: 'test',
      missing: [],
    });
  });

  it('marks non-Base Gateway x402 settlement as unverified while exact rails stay enabled', async () => {
    const orgId = await createOrg(app);

    const capabilities = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/capabilities`,
    });
    expect(capabilities.statusCode, capabilities.body).toBe(200);
    expect(capabilities.json<PaymentCapabilitiesResponse>().capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chain: 'base',
          exact_settlement_verified: true,
          gateway_settlement_verified: true,
        }),
        expect.objectContaining({
          chain: 'arbitrum',
          exact_settlement_verified: true,
          gateway_settlement_verified: false,
        }),
      ]),
    );
  });

  it('verifies a non-Base Gateway rail only after a successful provider proof job', async () => {
    const orgId = await createOrg(app);
    const setup = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Verification treasury' },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    gatewaySettlement = {
      network: 'eip155:421614',
      payer: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      providerMode: 'test',
      success: true,
      transaction: '0xgatewayarbitrumproof',
    };

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/rail-readiness/gateway_arbitrum/verify`,
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(gatewaySettleCalls).toBe(1);
    expect(response.json<ProviderJobResponse>().job).toMatchObject({
      chain: 'arbitrum',
      job_type: 'rail.verify',
      provider_ref: '0xgatewayarbitrumproof',
      status: 'complete',
    });
    expect(response.json<ProviderJobResponse>().job.metadata).toMatchObject({
      rail: 'gateway_arbitrum',
      settlement_success: true,
      settlement_transaction: '0xgatewayarbitrumproof',
      verification_method: 'circle_gateway_x402_settlement',
    });

    const readiness = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/rail-readiness`,
    });
    expect(readiness.statusCode, readiness.body).toBe(200);
    expect(readiness.json<PaymentRailReadinessResponse>().rails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rail: 'gateway_arbitrum',
          settlement_verified: true,
          status: 'ready',
        }),
      ]),
    );
  });

  it('prepares Gateway liquidity before proving an empty non-Base Gateway rail', async () => {
    const orgId = await createOrg(app);
    const setup = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Verification treasury' },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    gatewaySettlement = {
      network: 'eip155:80002',
      payer: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      providerMode: 'test',
      success: true,
      transaction: '0xgatewaypolygonproof',
    };

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/rail-readiness/gateway_polygon/verify`,
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(bridgeTopUpCalls).toBe(1);
    expect(gatewayDepositCalls).toBe(1);
    expect(gatewaySettleCalls).toBe(1);
    expect(response.json<ProviderJobResponse>().job).toMatchObject({
      chain: 'polygon',
      job_type: 'rail.verify',
      provider_ref: '0xgatewaypolygonproof',
      status: 'complete',
    });
    expect(response.json<ProviderJobResponse>().job.metadata).toMatchObject({
      liquidity_preparation_status: 'complete',
      rail: 'gateway_polygon',
      settlement_success: true,
    });
  });

  it('prepares exact-wallet liquidity before proving an empty non-Base exact rail', async () => {
    const orgId = await createOrg(app);
    const setup = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Verification treasury' },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    exactSettlement = {
      network: 'eip155:80002',
      payer: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      providerMode: 'test',
      success: true,
    };

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/rail-readiness/exact_polygon/verify`,
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(bridgeTopUpCalls).toBe(1);
    expect(gatewayDepositCalls).toBe(0);
    expect(exactSettleCalls).toBe(1);
    expect(response.json<ProviderJobResponse>().job).toMatchObject({
      chain: 'polygon',
      job_type: 'rail.verify',
      provider_ref: null,
      status: 'complete',
    });
    expect(response.json<ProviderJobResponse>().job.metadata).toMatchObject({
      liquidity_preparation_status: 'complete',
      observed_wallet_usdc: '0.05',
      rail: 'exact_polygon',
      settlement_success: true,
      settlement_transaction: null,
    });
  });

  it('keeps an exact proof submitted while the exact wallet top-up waits for balance visibility', async () => {
    const orgId = await createOrg(app);
    const setup = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Verification treasury' },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    bridgeTopUpCreditsBalance = false;

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/rail-readiness/exact_avalanche/verify`,
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(bridgeTopUpCalls).toBe(1);
    expect(exactSettleCalls).toBe(0);
    expect(response.json<ProviderJobResponse>().job).toMatchObject({
      chain: 'avalanche',
      error_code: null,
      job_type: 'rail.verify',
      status: 'submitted',
    });
    expect(response.json<ProviderJobResponse>().job.metadata).toMatchObject({
      liquidity_preparation_status: 'submitted',
      observed_wallet_usdc: '0.00',
      rail: 'exact_avalanche',
    });
  });

  it('keeps a Gateway proof submitted while the Gateway deposit waits for confirmations', async () => {
    const orgId = await createOrg(app);
    const setup = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Verification treasury' },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    gatewayDepositCreditsBalance = false;

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/rail-readiness/gateway_optimism/verify`,
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(gatewayDepositCalls).toBe(1);
    expect(gatewaySettleCalls).toBe(0);
    expect(response.json<ProviderJobResponse>().job).toMatchObject({
      chain: 'optimism',
      error_code: null,
      job_type: 'rail.verify',
      status: 'submitted',
    });
    expect(response.json<ProviderJobResponse>().job.metadata).toMatchObject({
      liquidity_preparation_status: 'submitted',
      observed_gateway_usdc: '0.00',
      rail: 'gateway_optimism',
    });

    const readiness = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/rail-readiness`,
    });
    expect(readiness.statusCode, readiness.body).toBe(200);
    expect(readiness.json<PaymentRailReadinessResponse>().rails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          last_proof_status: 'submitted',
          rail: 'gateway_optimism',
          settlement_verified: false,
          status: 'unverified',
        }),
      ]),
    );
    const optimismReadiness = readiness
      .json<PaymentRailReadinessResponse>()
      .rails.find((rail) => rail.rail === 'gateway_optimism');
    expect(optimismReadiness?.last_proof_at).not.toBeNull();
  });

  it('reconciles open liquidity jobs when current balances prove the destination bucket is funded', async () => {
    const orgId = await createOrg(app);
    const setup = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Reconciliation treasury' },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    gatewayUsdcByChain.optimism = '1.00';

    await store.pool.query(
      `INSERT INTO circle_provider_jobs (
         id, org_id, mode, job_type, chain, status, amount_usdc, metadata, created_by
       )
       VALUES (
         'cjob_reconcile_liquidity', $1, 'test', 'liquidity.prepare', 'optimism', 'submitted', 0.50::numeric,
         $2::jsonb, 'usr_circle_owner'
       )`,
      [
        orgId,
        JSON.stringify({
          destination_chain: 'optimism',
          rail: 'gateway_optimism',
          source_chain: 'base',
          strategy: 'wallet_rebalance_then_gateway_deposit',
        }),
      ],
    );

    const response = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs`,
    });

    expect(response.statusCode, response.body).toBe(200);
    const reconciledJob = response
      .json<ProviderJobsResponse>()
      .jobs.find((job) => job.id === 'cjob_reconcile_liquidity');
    expect(reconciledJob).toBeDefined();
    expect(reconciledJob).toMatchObject({
      id: 'cjob_reconcile_liquidity',
      status: 'complete',
      error_code: null,
    });
    expect(reconciledJob?.metadata).toMatchObject({
      observed_gateway_usdc: '1.00',
      prep_status: 'complete',
      reconciled_by: 'balance_snapshot',
    });
  });

  it('keeps a Gateway rail unverified when the provider proof fails', async () => {
    const orgId = await createOrg(app);
    const setup = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Verification treasury' },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    gatewaySettlement = {
      errorReason: 'gateway_settlement_failed',
      network: 'eip155:80002',
      providerMode: 'test',
      success: false,
    };

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/rail-readiness/gateway_polygon/verify`,
    });

    expect(response.statusCode, response.body).toBe(409);
    expect(gatewaySettleCalls).toBe(1);
    expect(response.json<ProviderJobResponse>().job).toMatchObject({
      chain: 'polygon',
      error_code: 'rail_verify_failed',
      job_type: 'rail.verify',
      status: 'failed',
    });
    expect(response.json<ProviderJobResponse>().job.metadata).toMatchObject({
      error_message: 'gateway_settlement_failed',
      rail: 'gateway_polygon',
    });

    const readiness = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/rail-readiness`,
    });
    expect(readiness.statusCode, readiness.body).toBe(200);
    expect(readiness.json<PaymentRailReadinessResponse>().rails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rail: 'gateway_polygon',
          settlement_verified: false,
          status: 'unverified',
        }),
      ]),
    );
  });

  it('runs proof jobs for every supported unverified rail in one batch', async () => {
    const orgId = await createOrg(app);
    const setup = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Verification treasury' },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    gatewaySettlement = {
      network: 'eip155:421614',
      payer: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      providerMode: 'test',
      success: true,
      transaction: '0xgatewayproof',
    };

    const response = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/rail-readiness/verify`,
      payload: { only_unverified: true },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(response.json<ProviderJobBatchResponse>()).toMatchObject({ failed: 0 });
    const jobs = response.json<ProviderJobBatchResponse>().jobs;
    expect(jobs).toHaveLength(4);
    expect(jobs.map((job) => job.metadata.rail).sort()).toEqual([
      'gateway_arbitrum',
      'gateway_avalanche',
      'gateway_optimism',
      'gateway_polygon',
    ]);
    expect(jobs.every((job) => job.job_type === 'rail.verify' && job.status === 'complete')).toBe(true);
    expect(gatewaySettleCalls).toBe(4);

    const readiness = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/rail-readiness`,
    });
    expect(readiness.statusCode, readiness.body).toBe(200);
    expect(readiness.json<PaymentRailReadinessResponse>().rails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rail: 'gateway_arbitrum', status: 'ready' }),
        expect.objectContaining({ rail: 'gateway_polygon', status: 'ready' }),
        expect.objectContaining({ rail: 'gateway_optimism', status: 'ready' }),
        expect.objectContaining({ rail: 'gateway_avalanche', status: 'ready' }),
      ]),
    );
  });

  it('publishes a deterministic Base Sepolia testnet x402 quote for verifier QA', async () => {
    const quote = await app.inject({
      method: 'GET',
      url: '/v1/testnet/x402/weather',
    });

    expect(quote.statusCode, quote.body).toBe(402);
    expect(quote.json()).toMatchObject({
      error: 'payment_required',
      accepts: [
        {
          amount: '10000',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          network: 'eip155:84532',
          payTo: '0x000000000000000000000000000000000000dEaD',
          scheme: 'exact',
        },
      ],
      resource: {
        category: 'weather',
        method: 'GET',
        mimeType: 'application/json',
      },
    });
  });

  it('publishes a deterministic Base Sepolia Gateway x402 quote for verifier QA', async () => {
    const quote = await app.inject({
      method: 'GET',
      url: '/v1/testnet/x402/gateway-weather',
    });

    expect(quote.statusCode, quote.body).toBe(402);
    expect(quote.json()).toMatchObject({
      error: 'payment_required',
      accepts: [
        {
          amount: '1000',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          network: 'eip155:84532',
          payTo: '0x000000000000000000000000000000000000dEaD',
          scheme: 'exact',
          extra: {
            name: 'GatewayWalletBatched',
            verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
            version: '1',
          },
        },
      ],
      resource: {
        category: 'weather',
        method: 'GET',
        mimeType: 'application/json',
      },
    });
  });

  it('publishes deterministic exact and Gateway x402 quotes for all five testnet chains', async () => {
    const chainQuotes = [
      {
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        chain: 'base',
        exactUrl: '/v1/testnet/x402/weather',
        gatewayUrl: '/v1/testnet/x402/gateway-weather',
        network: 'eip155:84532',
      },
      {
        asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        chain: 'arbitrum',
        exactUrl: '/v1/testnet/x402/arbitrum/weather',
        gatewayUrl: '/v1/testnet/x402/arbitrum/gateway-weather',
        network: 'eip155:421614',
      },
      {
        asset: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
        chain: 'polygon',
        exactUrl: '/v1/testnet/x402/polygon/weather',
        gatewayUrl: '/v1/testnet/x402/polygon/gateway-weather',
        network: 'eip155:80002',
      },
      {
        asset: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
        chain: 'optimism',
        exactUrl: '/v1/testnet/x402/optimism/weather',
        gatewayUrl: '/v1/testnet/x402/optimism/gateway-weather',
        network: 'eip155:11155420',
      },
      {
        asset: '0x5425890298aed601595a70AB815c96711a31Bc65',
        chain: 'avalanche',
        exactUrl: '/v1/testnet/x402/avalanche/weather',
        gatewayUrl: '/v1/testnet/x402/avalanche/gateway-weather',
        network: 'eip155:43113',
      },
    ] as const;

    for (const quote of chainQuotes) {
      const exactQuote = await app.inject({
        method: 'GET',
        url: quote.exactUrl,
      });

      expect(exactQuote.statusCode, `${quote.chain} exact: ${exactQuote.body}`).toBe(402);
      expect(exactQuote.json()).toMatchObject({
        error: 'payment_required',
        accepts: [
          {
            amount: '10000',
            asset: quote.asset,
            network: quote.network,
            payTo: '0x000000000000000000000000000000000000dEaD',
            scheme: 'exact',
          },
        ],
        resource: {
          category: 'weather',
          method: 'GET',
        },
      });

      const gatewayQuote = await app.inject({
        method: 'GET',
        url: quote.gatewayUrl,
      });

      expect(gatewayQuote.statusCode, `${quote.chain} gateway: ${gatewayQuote.body}`).toBe(402);
      expect(gatewayQuote.json()).toMatchObject({
        error: 'payment_required',
        accepts: [
          {
            amount: '1000',
            asset: quote.asset,
            network: quote.network,
            payTo: '0x000000000000000000000000000000000000dEaD',
            scheme: 'exact',
            extra: {
              name: 'GatewayWalletBatched',
              verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
              version: '1',
            },
          },
        ],
        resource: {
          category: 'weather',
          method: 'GET',
        },
      });
    }
  });

  it('deploys one org-maintained Circle wallet set and top-five EVM chain wallets in test mode', async () => {
    const orgId = await createOrg(app);

    const mode = await app.inject({
      method: 'PUT',
      url: `/v1/orgs/${orgId}/payments/provider-mode`,
      payload: { mode: 'test' },
    });
    expect(mode.statusCode, mode.body).toBe(200);
    expect(mode.json<PaymentModeResponse>().mode).toMatchObject({ mode: 'test' });

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const body = treasury.json<CircleTreasuryResponse>();
    expect(body.walletSet.circle_wallet_set_id).toMatch(/^circle_ws_test_/);
    expect(body.walletSet).toMatchObject({
      mode: 'test',
      status: 'active',
    });
    expect(body.wallets.map((wallet) => wallet.chain)).toEqual([
      'base',
      'arbitrum',
      'polygon',
      'optimism',
      'avalanche',
    ]);
    expect(body.wallets.every((wallet) => wallet.address.startsWith('0x'))).toBe(true);

    const wallets = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/circle/wallets`,
    });
    expect(wallets.statusCode, wallets.body).toBe(200);
    expect(wallets.json<WalletsResponse>().wallets).toHaveLength(5);

    const sources = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/sources`,
    });
    expect(sources.statusCode, sources.body).toBe(200);
    const sourceRails = sources.json<{ readonly sources: ReadonlyArray<{ readonly rail: string }> }>()
      .sources.map((source) => source.rail)
      .sort();
    expect(sourceRails).toEqual([
      'exact_arbitrum',
      'exact_avalanche',
      'exact_base',
      'exact_optimism',
      'exact_polygon',
      'gateway_arbitrum',
      'gateway_avalanche',
      'gateway_base',
      'gateway_optimism',
      'gateway_polygon',
    ]);

    const reconciled = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(reconciled.statusCode, reconciled.body).toBe(201);
    const sourcesAfterReconcile = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/sources`,
    });
    expect(sourcesAfterReconcile.json<{ readonly sources: readonly unknown[] }>().sources).toHaveLength(10);
  });

  it('rejects attempts to enable live payment mode while the product is testnet only', async () => {
    const orgId = await createOrg(app);

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/orgs/${orgId}/payments/provider-mode`,
      payload: { mode: 'live' },
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'payment_mode_testnet_only',
    });
  });

  it('returns live Circle wallet and Gateway balances for deployed chain wallets', async () => {
    const orgId = await createOrg(app);

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const balances = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/circle/balances`,
    });
    expect(balances.statusCode, balances.body).toBe(200);
    const body = balances.json<CircleBalancesResponse>();
    expect(body.balances).toHaveLength(5);
    const baseBalance = body.balances.find((balance) => balance.chain === 'base');
    expect(baseBalance?.gateway).toMatchObject({
      available: '4.25',
      domain: 6,
    });
    const usdc = baseBalance?.tokens.find((token) => token.symbol === 'USDC' && !token.is_native);
    expect(usdc?.amount).toBe('8.50');
  });

  it('refreshes existing Circle Agent Wallet addresses and payment sources on sync', async () => {
    const orgId = await createOrg(app);

    const first = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json<CircleTreasuryResponse>().wallets[0]?.address).toBe(`0x${'a'.repeat(40)}`);

    walletAddressNibble = 'b';
    const refreshed = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(refreshed.statusCode, refreshed.body).toBe(201);
    const refreshedBody = refreshed.json<CircleTreasuryResponse>();
    expect(refreshedBody.wallets[0]?.address).toBe(`0x${'b'.repeat(40)}`);

    const sources = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/sources`,
    });
    expect(sources.statusCode, sources.body).toBe(200);
    expect(sources.body).toContain(`0x${'b'.repeat(40)}`);
    expect(sources.body).not.toContain(`0x${'a'.repeat(40)}`);
  });

  it('submits a Circle Gateway deposit job using the active org chain wallet', async () => {
    const orgId = await createOrg(app);

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const deposit = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/gateway-deposits`,
      payload: {
        amount_usdc: '1.25',
        chain: 'base',
      },
    });
    expect(deposit.statusCode, deposit.body).toBe(202);
    expect(deposit.json<ProviderJobResponse>().job).toMatchObject({
      amount_usdc: '1.25',
      chain: 'base',
      job_type: 'gateway.deposit',
      provider_ref: 'circle_tx_deposit_test_base',
      status: 'complete',
    });
    expect(deposit.json<ProviderJobResponse>().job.metadata).toMatchObject({
      amount_micros: '1250000',
      approval_transaction_id: 'circle_tx_approve_test_base',
      deposit_transaction_id: 'circle_tx_deposit_test_base',
      gateway_depositor_address: '0x7d3f0acb46b1de6f4427d5464ead7b2b108102a0',
    });

    gatewayBalanceAddresses = [];
    const balances = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/circle/balances`,
    });
    expect(balances.statusCode, balances.body).toBe(200);
    expect(gatewayBalanceAddresses).toContain('0x7d3f0acb46b1de6f4427d5464ead7b2b108102a0');
  });

  it('rejects Gateway deposit requests below Circle minimum', async () => {
    const orgId = await createOrg(app);

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const deposit = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/gateway-deposits`,
      payload: {
        amount_usdc: '0.01',
        chain: 'base',
      },
    });

    expect(deposit.statusCode, deposit.body).toBe(400);
    expect(deposit.json<{ error: string; message: string }>()).toMatchObject({
      error: 'gateway_deposit_minimum',
      message: 'Gateway deposits must be at least 0.5 USDC.',
    });
  });

  it('requests Circle testnet funds for selected deployed chain wallets', async () => {
    const orgId = await createOrg(app);

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const faucet = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/testnet-faucet`,
      payload: {
        chains: ['base', 'polygon'],
      },
    });

    expect(faucet.statusCode, faucet.body).toBe(202);
    const jobs = faucet.json<ProviderJobsResponse>().jobs;
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.chain)).toEqual(['base', 'polygon']);
    expect(jobs.every((job) => job.job_type === 'wallet.faucet' && job.status === 'complete')).toBe(true);
    expect(jobs[0]?.metadata).toMatchObject({
      provider_response: { id: 'faucet_base' },
    });

    const jobList = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/circle/jobs`,
    });
    expect(jobList.statusCode, jobList.body).toBe(200);
    expect(jobList.json<ProviderJobsResponse>().jobs.map((job) => job.job_type)).toContain('wallet.faucet');
  });

  it('keeps failed live x402 settlement attempts visible in the agent activity feed', async () => {
    gatewaySettlement = {
      errorReason: 'insufficient_balance',
      network: 'eip155:84532',
      payment: {
        errorCode: 'insufficient_balance',
        network: 'eip155:84532',
        status: 'failed',
      },
      providerMode: 'test',
      success: false,
    };
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Settlement QA Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_base'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '1000',
            asset: 'USDC',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:84532',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
        resource: { category: 'market-data', url: 'https://seller.example.test/gateway' },
      }),
    });
    expect(payment.statusCode, payment.body).toBe(200);
    expect(payment.json()).toMatchObject({
      payment: { errorCode: 'insufficient_balance', status: 'failed' },
    });

    const activity = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/agents/${agentId}/activity`,
    });
    expect(activity.statusCode, activity.body).toBe(200);
    expect(activity.json<AgentActivityFeedResponse>().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'payment.x402.failed',
          outcome: 'error',
          summary: 'x402 payment failed on gateway_base',
        }),
      ]),
    );
  });

  it('does not prepare liquidity when policy denies the x402 payment request', async () => {
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Policy Denied Liquidity Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arbitrum'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    await createActivatedPaymentDenyPolicy(app, orgId, agentId);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '1000',
            asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:421614',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
        resource: { category: 'weather', url: 'https://seller.example.test/blocked-arbitrum-gateway' },
      }),
    });

    expect(payment.statusCode, payment.body).toBe(403);
    expect(payment.json()).toMatchObject({ error: 'policy_denied' });
    expect(gatewaySettleCalls).toBe(0);
    expect(gatewayDepositCalls).toBe(0);
    expect(bridgeTopUpCalls).toBe(0);

    const jobs = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs`,
    });
    expect(jobs.statusCode, jobs.body).toBe(200);
    expect(jobs.json<ProviderJobsResponse>().jobs).toHaveLength(0);
  });

  it('prepares Gateway liquidity before settlement when the target chain Gateway bucket is empty', async () => {
    await markGatewayRailVerified(store, 'arbitrum');
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Gateway Chain Balance Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arbitrum'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '1000',
            asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:421614',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
        resource: { category: 'weather', url: 'https://seller.example.test/arbitrum-gateway' },
      }),
    });

    expect(payment.statusCode, payment.body).toBe(409);
    const prep = payment.json<LiquidityPreparingResponse>();
    expect(prep).toMatchObject({
      chain: 'arbitrum',
      error: 'liquidity_preparing',
      rail: 'gateway_arbitrum',
      retryAfterSeconds: 30,
    });
    expect(prep.jobId).toMatch(/^cjob_/);
    expect(gatewaySettleCalls).toBe(0);

    const jobs = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs`,
    });
    expect(jobs.statusCode, jobs.body).toBe(200);
    const gatewayJob = jobs.json<ProviderJobsResponse>().jobs.find((job) => job.id === prep.jobId);
    expect(gatewayJob).toMatchObject({
      amount_usdc: '0.50',
      chain: 'arbitrum',
      job_type: 'liquidity.prepare',
      status: 'queued',
    });
    expect(gatewayJob?.metadata).toMatchObject({
      agent_id: agentId,
      destination_bucket: 'gateway:arbitrum',
      rail: 'gateway_arbitrum',
      reason_code: 'gateway_bucket_below_request',
      source_bucket: 'wallet:base',
      source_chain: 'base',
      strategy: 'wallet_rebalance_then_gateway_deposit',
    });

    const retry = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs/${prep.jobId}/retry`,
    });
    expect(retry.statusCode, retry.body).toBe(202);
    const retriedGatewayJob = retry.json<ProviderJobResponse>().job;
    expect(retriedGatewayJob).toMatchObject({
      amount_usdc: '0.50',
      chain: 'arbitrum',
      job_type: 'liquidity.prepare',
      provider_ref: 'circle_tx_deposit_test_arbitrum',
      status: 'complete',
    });
    expect(retriedGatewayJob.metadata).toMatchObject({
      bridge_idempotency_key: prep.jobId.replace(/^cjob_/, ''),
      bridge_transaction_id: 'circle_bridge_test_base_arbitrum',
      deposit_transaction_id: 'circle_tx_deposit_test_arbitrum',
      strategy: 'wallet_rebalance_then_gateway_deposit',
    });
    expect(bridgeTopUpCalls).toBe(1);
    expect(bridgeTopUpIdempotencyKeys).toEqual([prep.jobId.replace(/^cjob_/, '')]);
    expect(gatewayDepositCalls).toBe(1);

  });

  it('blocks non-Base Gateway x402 settlement after liquidity is ready until the rail is verified', async () => {
    gatewayUsdcByChain.arbitrum = '0.50';
    gatewayBalanceFailureChains.add('arbitrum');
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Unverified Gateway Settlement Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arbitrum'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '1000',
            asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:421614',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
        resource: { category: 'weather', url: 'https://seller.example.test/arbitrum-gateway-ready-unverified' },
      }),
    });

    expect(payment.statusCode, payment.body).toBe(409);
    expect(payment.json()).toMatchObject({
      error: 'payment_rail_unverified',
    });
    expect(gatewaySettleCalls).toBe(0);
    expect(gatewayDepositCalls).toBe(0);
    expect(bridgeTopUpCalls).toBe(0);
  });

  it('does not duplicate a bridge when retry sees the destination wallet already funded', async () => {
    await markGatewayRailVerified(store, 'arbitrum');
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Gateway Partial Bridge Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arbitrum'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '1000',
            asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:421614',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
        resource: { category: 'weather', url: 'https://seller.example.test/arbitrum-gateway-partial-bridge' },
      }),
    });

    expect(payment.statusCode, payment.body).toBe(409);
    const prep = payment.json<LiquidityPreparingResponse>();

    walletUsdcByChain.arbitrum = '0.50';
    const retry = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs/${prep.jobId}/retry`,
    });
    expect(retry.statusCode, retry.body).toBe(202);
    const retriedGatewayJob = retry.json<ProviderJobResponse>().job;
    expect(retriedGatewayJob).toMatchObject({
      amount_usdc: '0.50',
      chain: 'arbitrum',
      job_type: 'liquidity.prepare',
      provider_ref: 'circle_tx_deposit_test_arbitrum',
      status: 'complete',
    });
    expect(retriedGatewayJob.metadata).toMatchObject({
      bridge_status: 'already_sufficient_destination_balance',
      bridge_transaction_id: null,
      deposit_transaction_id: 'circle_tx_deposit_test_arbitrum',
      strategy: 'wallet_rebalance_then_gateway_deposit',
    });
    expect(bridgeTopUpCalls).toBe(0);
    expect(gatewayDepositCalls).toBe(1);
  });

  it('does not rebalance or deposit when retry sees the target Gateway bucket already funded', async () => {
    await markGatewayRailVerified(store, 'arbitrum');
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Gateway Already Funded Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arbitrum'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '1000',
            asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:421614',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
        resource: { category: 'weather', url: 'https://seller.example.test/arbitrum-gateway-already-funded' },
      }),
    });

    expect(payment.statusCode, payment.body).toBe(409);
    const prep = payment.json<LiquidityPreparingResponse>();

    gatewayUsdcByChain.arbitrum = '0.50';
    const retry = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs/${prep.jobId}/retry`,
    });
    expect(retry.statusCode, retry.body).toBe(202);
    const retriedGatewayJob = retry.json<ProviderJobResponse>().job;
    expect(retriedGatewayJob).toMatchObject({
      amount_usdc: '0.50',
      chain: 'arbitrum',
      job_type: 'liquidity.prepare',
      provider_ref: null,
      status: 'complete',
    });
    expect(retriedGatewayJob.metadata).toMatchObject({
      bridge_status: 'already_sufficient_gateway_balance',
      bridge_transaction_id: null,
      deposit_transaction_id: null,
      observed_gateway_usdc: '0.50',
      strategy: 'wallet_rebalance_then_gateway_deposit',
    });
    expect(bridgeTopUpCalls).toBe(0);
    expect(gatewayDepositCalls).toBe(0);
  });

  it('does not mark Gateway liquidity complete until the target Gateway balance is visible', async () => {
    await markGatewayRailVerified(store, 'arbitrum');
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Gateway Balance Verification Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arbitrum'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '1000',
            asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:421614',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
        resource: { category: 'weather', url: 'https://seller.example.test/arbitrum-gateway-unverified' },
      }),
    });

    expect(payment.statusCode, payment.body).toBe(409);
    const prep = payment.json<LiquidityPreparingResponse>();

    walletUsdcByChain.arbitrum = '0.50';
    gatewayDepositCreditsBalance = false;
    const retry = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs/${prep.jobId}/retry`,
    });
    expect(retry.statusCode, retry.body).toBe(202);
    const retriedGatewayJob = retry.json<ProviderJobResponse>().job;
    expect(retriedGatewayJob).toMatchObject({
      amount_usdc: '0.50',
      chain: 'arbitrum',
      error_code: null,
      job_type: 'liquidity.prepare',
      status: 'submitted',
    });
    expect(retriedGatewayJob.metadata).toMatchObject({
      bridge_status: 'already_sufficient_destination_balance',
      bridge_transaction_id: null,
      deposit_transaction_id: 'circle_tx_deposit_test_arbitrum',
      observed_gateway_usdc: '0.00',
      prep_status: 'awaiting_gateway_balance',
    });
    expect(bridgeTopUpCalls).toBe(0);
    expect(gatewayDepositCalls).toBe(1);

    walletUsdcByChain.arbitrum = '0';
    gatewayBalanceFailureChains.add('arbitrum');
    const transientRetry = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs/${prep.jobId}/retry`,
    });
    expect(transientRetry.statusCode, transientRetry.body).toBe(202);
    expect(transientRetry.json<ProviderJobResponse>().job).toMatchObject({
      error_code: null,
      provider_ref: 'circle_tx_deposit_test_arbitrum',
      status: 'submitted',
    });
    expect(bridgeTopUpCalls).toBe(0);
    expect(gatewayDepositCalls).toBe(1);
  });

  it('queues Gateway liquidity preparation when Circle Gateway balance lookup is transiently unavailable', async () => {
    await markGatewayRailVerified(store, 'arbitrum');
    gatewayBalanceFailureChains = new Set(['arbitrum']);
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Gateway Balance Retry Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arbitrum'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '1000',
            asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:421614',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
        resource: { category: 'weather', url: 'https://seller.example.test/arbitrum-gateway-transient-balance' },
      }),
    });

    expect(payment.statusCode, payment.body).toBe(409);
    const prep = payment.json<LiquidityPreparingResponse>();
    expect(prep).toMatchObject({
      chain: 'arbitrum',
      error: 'liquidity_preparing',
      rail: 'gateway_arbitrum',
      retryAfterSeconds: 30,
    });
    expect(gatewaySettleCalls).toBe(0);

    const jobs = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs`,
    });
    expect(jobs.statusCode, jobs.body).toBe(200);
    const gatewayJob = jobs.json<ProviderJobsResponse>().jobs.find((job) => job.id === prep.jobId);
    expect(gatewayJob).toMatchObject({
      amount_usdc: '0.50',
      chain: 'arbitrum',
      job_type: 'liquidity.prepare',
      status: 'queued',
    });
    expect(gatewayJob?.metadata).toMatchObject({
      destination_bucket: 'gateway:arbitrum',
      reason_code: 'gateway_balance_unavailable',
      source_bucket: 'wallet:base',
      source_chain: 'base',
      strategy: 'wallet_rebalance_then_gateway_deposit',
    });
  });

  it('records paid-resource fulfillment after a real-provider exact x402 settlement succeeds', async () => {
    exactSettlement = {
      ...exactSettlement,
      response: paidJsonResponse({
        ok: true,
        proof: {
          payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          tx: '0xexact',
        },
      }),
    };
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Exact Fulfillment Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['exact_base'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '10000',
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            extra: { name: 'USDC', version: '2' },
            network: 'eip155:84532',
            payTo: '0x000000000000000000000000000000000000dEaD',
            scheme: 'exact',
          },
        ],
        resource: {
          category: 'weather',
          mimeType: 'application/json',
          method: 'GET',
          url: `${appBaseUrl}/paid-resource-test`,
        },
      }),
    });

    expect(payment.statusCode, payment.body).toBe(200);
    expect(payment.json()).toMatchObject({
      payment: {
        amount: '0.01',
        providerMode: 'test',
        rail: 'exact_base',
        responseAvailable: true,
      },
      response: { status: 200 },
    });
    expect(payment.body).toContain('0xexact');
    expect(payment.body).toContain('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    const activity = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/agents/${agentId}/activity`,
    });
    expect(activity.statusCode, activity.body).toBe(200);
    expect(activity.json<AgentActivityFeedResponse>().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'payment.x402.settled',
          outcome: 'success',
          summary: 'x402 payment settled on exact_base',
        }),
      ]),
    );
  });

  it('records the paid resource returned by a Gateway x402 provider', async () => {
    gatewaySettlement = {
      network: 'eip155:84532',
      payment: { network: 'eip155:84532', status: 'settled' },
      providerMode: 'test',
      response: paidJsonResponse({
        paid: true,
        resource: 'Gateway paid resource',
      }),
      success: true,
    };
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Gateway Fulfillment Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const gatewayDeposit = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/gateway-deposits`,
      payload: { amount_usdc: '0.50', chain: 'base' },
    });
    expect(gatewayDeposit.statusCode, gatewayDeposit.body).toBe(202);
    gatewayBalanceAddresses = [];

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_base'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '1000',
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            extra: {
              name: 'GatewayWalletBatched',
              version: '1',
              verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
            },
            network: 'eip155:84532',
            payTo: '0x000000000000000000000000000000000000dEaD',
            scheme: 'exact',
          },
        ],
        resource: {
          category: 'market-data',
          mimeType: 'application/json',
          method: 'GET',
          url: 'https://seller.example.test/gateway',
        },
      }),
    });

    expect(payment.statusCode, payment.body).toBe(200);
    expect(gatewayBalanceAddresses).toContain('0x7d3f0acb46b1de6f4427d5464ead7b2b108102a0');
    expect(payment.json()).toMatchObject({
      payment: {
        amount: '0.001',
        providerMode: 'test',
        rail: 'gateway_base',
        responseAvailable: true,
      },
      response: {
        body: { paid: true, resource: 'Gateway paid resource' },
        status: 200,
      },
    });

    const activity = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/agents/${agentId}/activity`,
    });
    expect(activity.statusCode, activity.body).toBe(200);
    expect(activity.json<AgentActivityFeedResponse>().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'payment.x402.settled',
          outcome: 'success',
          summary: 'x402 payment settled on gateway_base',
        }),
      ]),
    );
  });

  it('prepares exact-wallet liquidity before settlement when the target chain wallet is empty', async () => {
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Exact Liquidity Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['exact_arbitrum'],
        budget_usdc: '5.00',
        dedicated_wallet_required: true,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '10000',
            asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            extra: { name: 'USDC', version: '2' },
            network: 'eip155:421614',
            payTo: '0x000000000000000000000000000000000000dEaD',
            scheme: 'exact',
          },
        ],
        resource: {
          category: 'weather',
          mimeType: 'application/json',
          method: 'GET',
          url: `${appBaseUrl}/paid-resource-test`,
        },
      }),
    });

    expect(payment.statusCode, payment.body).toBe(409);
    const prep = payment.json<LiquidityPreparingResponse>();
    expect(prep).toMatchObject({
      chain: 'arbitrum',
      error: 'liquidity_preparing',
      rail: 'exact_arbitrum',
      retryAfterSeconds: 30,
    });
    expect(gatewaySettleCalls).toBe(0);

    const jobs = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs`,
    });
    expect(jobs.statusCode, jobs.body).toBe(200);
    const exactJob = jobs.json<ProviderJobsResponse>().jobs.find((job) => job.id === prep.jobId);
    expect(exactJob).toMatchObject({
      amount_usdc: '0.05',
      chain: 'arbitrum',
      job_type: 'liquidity.prepare',
      status: 'queued',
    });
    expect(exactJob?.metadata).toMatchObject({
      destination_bucket: 'wallet:arbitrum',
      rail: 'exact_arbitrum',
      reason_code: 'exact_wallet_below_request',
      source_bucket: 'wallet:base',
      source_chain: 'base',
      strategy: 'wallet_rebalance',
    });

    const retry = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs/${prep.jobId}/retry`,
    });
    expect(retry.statusCode, retry.body).toBe(202);
    const retriedExactJob = retry.json<ProviderJobResponse>().job;
    expect(retriedExactJob).toMatchObject({
      amount_usdc: '0.05',
      chain: 'arbitrum',
      job_type: 'liquidity.prepare',
      provider_ref: 'circle_bridge_test_base_arbitrum',
      status: 'complete',
    });
    expect(retriedExactJob.metadata).toMatchObject({
      bridge_transaction_id: 'circle_bridge_test_base_arbitrum',
      deposit_transaction_id: null,
      strategy: 'wallet_rebalance',
    });
    expect(bridgeTopUpCalls).toBe(1);
  });

  it('moves only an exact-wallet deficit and reuses the open preparation job for the same quote', async () => {
    walletUsdcByChain.arbitrum = '20.00';
    walletUsdcByChain.base = '30.00';
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Partially Funded Exact Agent' },
    });
    const agentId = agentResponse.json<AgentResponse>().agent.id;
    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;
    await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Deficit-aware treasury' },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['exact_arbitrum'],
        budget_usdc: '50.00',
        dedicated_wallet_required: true,
        per_request_cap_usdc: '25.00',
        status: 'active',
      },
    });
    const payload = canonicalPaidHttpPayload({
      accepts: [
        {
          amount: '20100000',
          asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
          extra: { name: 'USDC', version: '2' },
          network: 'eip155:421614',
          payTo: '0x000000000000000000000000000000000000dEaD',
          scheme: 'exact',
        },
      ],
      resource: {
        category: 'market-data',
        mimeType: 'application/json',
        method: 'GET',
        url: `${appBaseUrl}/paid-resource-test`,
      },
    });

    const first = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });

    expect(first.statusCode, first.body).toBe(409);
    expect(second.statusCode, second.body).toBe(409);
    const firstPrep = first.json<LiquidityPreparingResponse>();
    const secondPrep = second.json<LiquidityPreparingResponse>();
    expect(secondPrep.jobId).toBe(firstPrep.jobId);

    const jobs = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs`,
    });
    const matchingJobs = jobs
      .json<ProviderJobsResponse>()
      .jobs.filter((job) => job.metadata.payment_quote_hash === jobs.json<ProviderJobsResponse>().jobs[0]?.metadata.payment_quote_hash);
    expect(matchingJobs).toHaveLength(1);
    expect(matchingJobs[0]).toMatchObject({
      amount_usdc: '0.10',
      chain: 'arbitrum',
      status: 'queued',
      metadata: {
        destination_before_usdc: '20.00',
        destination_target_usdc: '20.10',
        strategy: 'wallet_rebalance',
      },
    });

    const retry = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs/${firstPrep.jobId}/retry`,
    });
    expect(retry.statusCode, retry.body).toBe(202);
    expect(bridgeTopUpAmounts).toEqual(['0.10']);
    expect(walletUsdcByChain.arbitrum).toBe('20.1');
  });

  it('bridges only the destination-wallet deficit before a minimum Gateway deposit', async () => {
    await markGatewayRailVerified(store, 'arbitrum');
    gatewayUsdcByChain.arbitrum = '0.20';
    walletUsdcByChain.arbitrum = '0.20';
    const orgId = await createOrg(app);
    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Partially Funded Gateway Agent' },
    });
    const agentId = agentResponse.json<AgentResponse>().agent.id;
    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;
    await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Gateway deficit treasury' },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arbitrum'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '600000',
            asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:421614',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
        resource: { category: 'market-data', url: 'https://seller.example.test/partial-gateway' },
      }),
    });
    expect(payment.statusCode, payment.body).toBe(409);
    const prep = payment.json<LiquidityPreparingResponse>();
    const jobs = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs`,
    });
    const job = jobs.json<ProviderJobsResponse>().jobs.find((candidate) => candidate.id === prep.jobId);
    expect(job).toMatchObject({
      amount_usdc: '0.50',
      metadata: {
        destination_before_usdc: '0.20',
        destination_target_usdc: '0.60',
        destination_wallet_before_usdc: '0.20',
        strategy: 'wallet_rebalance_then_gateway_deposit',
      },
    });

    const retry = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs/${prep.jobId}/retry`,
    });
    expect(retry.statusCode, retry.body).toBe(202);
    expect(bridgeTopUpAmounts).toEqual(['0.30']);
    expect(gatewayUsdcByChain.arbitrum).toBe('0.7');
  });

  it('recommends and records bridge top-ups for exact-wallet chain liquidity based on request history', async () => {
    walletUsdcByChain.arbitrum = '0.01';
    exactSettlement = {
      network: 'eip155:421614',
      payment: {
        network: 'eip155:421614',
        payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: 'settled',
        transaction: '0xarbitrumexact',
      },
      payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      providerMode: 'test',
      success: true,
      transaction: '0xarbitrumexact',
    };
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Arbitrum Exact Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['exact_arbitrum'],
        budget_usdc: '5.00',
        dedicated_wallet_required: true,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '10000',
            asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            extra: { name: 'USDC', version: '2' },
            network: 'eip155:421614',
            payTo: '0x000000000000000000000000000000000000dEaD',
            scheme: 'exact',
          },
        ],
        resource: {
          category: 'weather',
          mimeType: 'application/json',
          method: 'GET',
          url: `${appBaseUrl}/paid-resource-test`,
        },
      }),
    });
    expect(payment.statusCode, payment.body).toBe(200);
    expect(payment.json()).toMatchObject({
      payment: {
        amount: '0.01',
        rail: 'exact_arbitrum',
      },
    });

    const recommendations = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/rebalance/recommendations`,
    });
    expect(recommendations.statusCode, recommendations.body).toBe(200);
    expect(recommendations.json<RebalanceRecommendationsResponse>().recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount_usdc: '0.04',
          chain: 'arbitrum',
          current_wallet_usdc: '0.01',
          deficit_usdc: '0.04',
          reason_code: 'exact_wallet_below_recent_demand_floor',
          recent_exact_spend_usdc: '0.01',
          recommended_min_usdc: '0.05',
          source_chain: 'base',
        }),
      ]),
    );

    const topUp = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/rebalance/bridge-topup`,
      payload: {
        amount_usdc: '0.04',
        from_chain: 'base',
        to_chain: 'arbitrum',
      },
    });
    expect(topUp.statusCode, topUp.body).toBe(202);
    expect(topUp.json<ProviderJobResponse>().job).toMatchObject({
      amount_usdc: '0.04',
      chain: 'arbitrum',
      job_type: 'wallet.rebalance',
      provider_ref: 'circle_bridge_test_base_arbitrum',
      status: 'complete',
    });
    expect(topUp.json<ProviderJobResponse>().job.metadata).toMatchObject({
      from_chain: 'base',
      to_chain: 'arbitrum',
      transfer_transaction_id: 'circle_bridge_test_base_arbitrum',
    });
  });

  it('fails exact-wallet top-up jobs closed when the Circle provider never returns', async () => {
    const previousTimeout = process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS;
    process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS = '5';
    bridgeTopUpNeverSettles = true;
    try {
      const orgId = await createOrg(app);

      const treasury = await app.inject({
        method: 'POST',
        url: `/v1/orgs/${orgId}/payments/circle/treasury`,
        payload: { label: 'Timeout treasury' },
      });
      expect(treasury.statusCode, treasury.body).toBe(201);

      const topUp = await app.inject({
        method: 'POST',
        url: `/v1/orgs/${orgId}/payments/rebalance/bridge-topup`,
        payload: {
          amount_usdc: '0.04',
          from_chain: 'base',
          to_chain: 'arbitrum',
        },
      });

      expect(topUp.statusCode, topUp.body).toBe(202);
      expect(topUp.json<ProviderJobResponse>().job).toMatchObject({
        chain: 'arbitrum',
        job_type: 'wallet.rebalance',
        status: 'submitted',
      });
      expect(topUp.json<ProviderJobResponse>().job.error_code).toBe('circle_provider_job_timeout');
      expect(topUp.json<ProviderJobResponse>().job.metadata).toMatchObject({
        from_chain: 'base',
        to_chain: 'arbitrum',
      });
      expect(bridgeTopUpCalls).toBe(1);
    } finally {
      bridgeTopUpNeverSettles = false;
      if (previousTimeout === undefined) {
        delete process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS;
      } else {
        process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  it('reconciles submitted exact-wallet top-up jobs from live destination wallet balance', async () => {
    const previousTimeout = process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS;
    process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS = '5';
    bridgeTopUpNeverSettles = true;
    try {
      const orgId = await createOrg(app);

      const treasury = await app.inject({
        method: 'POST',
        url: `/v1/orgs/${orgId}/payments/circle/treasury`,
        payload: { label: 'Reconcile treasury' },
      });
      expect(treasury.statusCode, treasury.body).toBe(201);

      const topUp = await app.inject({
        method: 'POST',
        url: `/v1/orgs/${orgId}/payments/rebalance/bridge-topup`,
        payload: {
          amount_usdc: '0.04',
          from_chain: 'base',
          to_chain: 'arbitrum',
        },
      });
      expect(topUp.statusCode, topUp.body).toBe(202);
      const jobId = topUp.json<ProviderJobResponse>().job.id;
      expect(topUp.json<ProviderJobResponse>().job.status).toBe('submitted');

      await store.pool.query(
        `UPDATE circle_provider_jobs
            SET status = 'failed',
                error_code = 'Command failed: circle bridge transfer ARB-SEPOLIA 0xf8ea --amount 0.04 --address 0x'
          WHERE id = $1`,
        [jobId],
      );
      walletUsdcByChain.arbitrum = '0.04';

      const reconcile = await app.inject({
        method: 'POST',
        url: `/v1/orgs/${orgId}/payments/circle/jobs/reconcile`,
      });

      expect(reconcile.statusCode, reconcile.body).toBe(200);
      const jobs = reconcile.json<{ readonly jobs: ProviderJobResponse['job'][] }>().jobs;
      expect(jobs).toEqual([
        expect.objectContaining({
          id: jobId,
          job_type: 'wallet.rebalance',
          status: 'complete',
        }),
      ]);
      expect(jobs[0]?.metadata).toMatchObject({
        reconcile_method: 'destination_wallet_balance',
        reconcile_observed_wallet_usdc: '0.04',
      });
    } finally {
      bridgeTopUpNeverSettles = false;
      if (previousTimeout === undefined) {
        delete process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS;
      } else {
        process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  it('reconciles submitted Gateway deposit jobs from live Gateway bucket balance', async () => {
    const previousTimeout = process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS;
    process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS = '5';
    gatewayDepositNeverSettles = true;
    try {
      const orgId = await createOrg(app);

      const treasury = await app.inject({
        method: 'POST',
        url: `/v1/orgs/${orgId}/payments/circle/treasury`,
        payload: { label: 'Gateway reconcile treasury' },
      });
      expect(treasury.statusCode, treasury.body).toBe(201);
      gatewayUsdcByChain.base = '0';

      const deposit = await app.inject({
        method: 'POST',
        url: `/v1/orgs/${orgId}/payments/circle/gateway-deposits`,
        payload: {
          amount_usdc: '0.50',
          chain: 'base',
        },
      });
      expect(deposit.statusCode, deposit.body).toBe(202);
      const jobId = deposit.json<ProviderJobResponse>().job.id;
      expect(deposit.json<ProviderJobResponse>().job.status).toBe('submitted');

      gatewayUsdcByChain.base = '0.50';

      const reconcile = await app.inject({
        method: 'POST',
        url: `/v1/orgs/${orgId}/payments/circle/jobs/reconcile`,
      });

      expect(reconcile.statusCode, reconcile.body).toBe(200);
      const jobs = reconcile.json<{ readonly jobs: ProviderJobResponse['job'][] }>().jobs;
      expect(jobs).toEqual([
        expect.objectContaining({
          id: jobId,
          job_type: 'gateway.deposit',
          status: 'complete',
        }),
      ]);
      expect(jobs[0]?.metadata).toMatchObject({
        reconcile_method: 'gateway_balance',
        reconcile_observed_gateway_usdc: '0.50',
      });
    } finally {
      gatewayDepositNeverSettles = false;
      if (previousTimeout === undefined) {
        delete process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS;
      } else {
        process.env.CIRCLE_PROVIDER_JOB_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  it('summarizes treasury liquidity, pending prep jobs, payment access, and last payment for the console', async () => {
    await markGatewayRailVerified(store, 'arbitrum');
    const orgId = await createOrg(app);

    const agentResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents`,
      payload: { name: 'Treasury Overview Agent' },
    });
    expect(agentResponse.statusCode, agentResponse.body).toBe(201);
    const agentId = agentResponse.json<AgentResponse>().agent.id;

    const connectionResponse = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
      payload: { kind: 'agent_credential', name: 'Runtime credential' },
    });
    expect(connectionResponse.statusCode, connectionResponse.body).toBe(201);
    const secret = connectionResponse.json<ConnectionCreateResponse>().secret;

    const treasury = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/circle/treasury`,
      payload: { label: 'Testnet org treasury' },
    });
    expect(treasury.statusCode, treasury.body).toBe(201);

    const access = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/agents/${agentId}/payment-access`,
      payload: {
        allowed_rails: ['gateway_arbitrum', 'exact_base'],
        budget_usdc: '5.00',
        dedicated_wallet_required: false,
        per_request_cap_usdc: '2.00',
        status: 'active',
      },
    });
    expect(access.statusCode, access.body).toBe(200);

    const preparing = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '1000',
            asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:421614',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
        resource: { category: 'weather', url: 'https://seller.example.test/arbitrum-gateway' },
      }),
    });
    expect(preparing.statusCode, preparing.body).toBe(409);
    expect(preparing.json<LiquidityPreparingResponse>().error).toBe('liquidity_preparing');

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: canonicalPaidHttpPayload({
        accepts: [
          {
            amount: '10000',
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            extra: { name: 'USDC', version: '2' },
            network: 'eip155:84532',
            payTo: '0x000000000000000000000000000000000000dEaD',
            scheme: 'exact',
          },
        ],
        resource: {
          category: 'weather',
          mimeType: 'application/json',
          method: 'GET',
          url: `${appBaseUrl}/paid-resource-test`,
        },
      }),
    });
    expect(payment.statusCode, payment.body).toBe(200);

    const overview = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/treasury/overview`,
    });
    expect(overview.statusCode, overview.body).toBe(200);
    expect(overview.json<TreasuryOverviewResponse>().overview).toMatchObject({
      liquidity: {
        failed_jobs: 0,
        pending_jobs: 1,
      },
      mode: 'test',
      payments: {
        agents_with_access: 1,
        last_payment: {
          amount: '0.01',
          rail: 'exact_base',
        },
        total_spent_usdc: '0.01',
      },
      totals: {
        gateway_usdc: '4.25',
        treasury_usdc: '12.75',
        wallet_usdc: '8.50',
      },
    });

    const events = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/events?limit=10`,
    });
    expect(events.statusCode, events.body).toBe(200);
    expect(events.json<PaymentEventsResponse>().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount_usdc: '0.01',
          decision: 'settled',
          provider_mode: 'test',
          rail: 'exact_base',
          resource_category: 'weather',
        }),
      ]),
    );

    const observations = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/route-observations?limit=10`,
    });
    expect(observations.statusCode, observations.body).toBe(200);
    expect(observations.json<PaymentRouteObservationsResponse>().observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount_usdc: '0.01',
          outcome: 'accepted',
          reason_code: 'settled',
          supported_rail: 'exact_base',
        }),
        expect.objectContaining({
          amount_usdc: '0.001',
          outcome: 'rejected',
          reason_code: 'liquidity_preparing',
          supported_rail: 'gateway_arbitrum',
        }),
      ]),
    );

    const reservations = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/reservations?limit=10`,
    });
    expect(reservations.statusCode, reservations.body).toBe(200);
    const paymentReservations = reservations.json<PaymentReservationsResponse>().reservations;
    expect(paymentReservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount_usdc: '0.01',
          rail: 'exact_base',
          status: 'settled',
        }),
      ]),
    );
    expect(paymentReservations.find((reservation) => reservation.rail === 'exact_base')?.reason_code)
      .toMatch(/^x402_attempt:/);

    const readiness = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/payments/rail-readiness`,
    });
    expect(readiness.statusCode, readiness.body).toBe(200);
    expect(readiness.json<PaymentRailReadinessResponse>().rails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rail: 'exact_base',
          settlement_verified: true,
          status: 'ready',
        }),
        expect.objectContaining({
          rail: 'gateway_polygon',
          settlement_verified: false,
          status: 'unverified',
        }),
      ]),
    );
    const exactBaseReadiness = readiness
      .json<PaymentRailReadinessResponse>()
      .rails.find((rail) => rail.rail === 'exact_base');
    expect(exactBaseReadiness?.last_payment_at).not.toBeNull();
  });
});
