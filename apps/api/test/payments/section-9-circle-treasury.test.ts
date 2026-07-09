import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
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

let gatewaySettlement: Awaited<ReturnType<CircleTreasuryProvider['settleGatewayX402']>> = {
  network: 'eip155:84532',
  providerMode: 'test',
  success: true,
  transaction: '0xtest',
};
let gatewaySettleCalls = 0;
let gatewayDepositCalls = 0;
let bridgeTopUpCalls = 0;
let bridgeTopUpIdempotencyKeys: string[] = [];
let walletUsdcByChain: Record<string, string> = {};
let gatewayUsdcByChain: Record<string, string> = {};
let gatewayDepositCreditsBalance = true;
let gatewayDepositNeverSettles = false;
let gatewayBalanceFailureChains = new Set<string>();
let bridgeTopUpNeverSettles = false;
let exactSettlement: Awaited<ReturnType<CircleTreasuryProvider['settleExactX402']>> = {
  network: 'eip155:84532',
  payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  providerMode: 'test',
  success: true,
  transaction: '0xexact',
};
let walletAddressNibble = 'a';

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
    getGatewayBalance: ({ chain, mode }) => {
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
      if (gatewayDepositCreditsBalance) gatewayUsdcByChain[chain] = amount;
      return Promise.resolve({
        amount,
        amountMicros: amountMicros.toString(),
        approvalTransactionId: `circle_tx_approve_${mode}_${chain}`,
        depositTransactionId: `circle_tx_deposit_${mode}_${chain}`,
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
      if (bridgeTopUpNeverSettles) return new Promise(() => undefined);
      return Promise.resolve({
        amount,
        fromChain,
        providerMode: mode,
        success: true,
        toChain,
        transaction: `circle_bridge_${mode}_${fromChain}_${toChain}`,
      });
    },
    settleExactX402: () => Promise.resolve(exactSettlement),
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

describe('Section 9 Circle treasury foundation', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;
  let appBaseUrl: string;

  beforeAll(async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    store = await startPostgres();
    app = buildApp({
      identity: {
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_circle_owner', role: 'owner' }),
      },
      payments: {
        circleProvider: fakeCircleProvider(),
        pool: store.pool,
        resolveOperator: () => Promise.resolve({ actorId: 'usr_circle_owner', role: 'owner' }),
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
  }, 90_000);

  beforeEach(() => {
    walletAddressNibble = 'a';
    gatewaySettleCalls = 0;
    gatewayDepositCalls = 0;
    bridgeTopUpCalls = 0;
    bridgeTopUpIdempotencyKeys = [];
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
      payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      providerMode: 'test',
      success: true,
      transaction: '0xexact',
    };
    gatewaySettlement = {
      network: 'eip155:84532',
      providerMode: 'test',
      success: true,
      transaction: '0xtest',
    };
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

  it('publishes deterministic Arbitrum Sepolia exact and Gateway x402 quotes for cross-chain QA', async () => {
    const exactQuote = await app.inject({
      method: 'GET',
      url: '/v1/testnet/x402/arbitrum/weather',
    });

    expect(exactQuote.statusCode, exactQuote.body).toBe(402);
    expect(exactQuote.json()).toMatchObject({
      error: 'payment_required',
      accepts: [
        {
          amount: '10000',
          asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
          network: 'eip155:421614',
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
      url: '/v1/testnet/x402/arbitrum/gateway-weather',
    });

    expect(gatewayQuote.statusCode, gatewayQuote.body).toBe(402);
    expect(gatewayQuote.json()).toMatchObject({
      error: 'payment_required',
      accepts: [
        {
          amount: '1000',
          asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
          network: 'eip155:421614',
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
      status: 'submitted',
    });
    expect(deposit.json<ProviderJobResponse>().job.metadata).toMatchObject({
      amount_micros: '1250000',
      approval_transaction_id: 'circle_tx_approve_test_base',
      deposit_transaction_id: 'circle_tx_deposit_test_base',
    });
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
      payload: {
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
      },
    });
    expect(payment.statusCode, payment.body).toBe(409);
    expect(payment.json()).toMatchObject({ error: 'insufficient_balance' });

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
      payload: {
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
      },
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
      payload: {
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
      },
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

  it('does not duplicate a bridge when retry sees the destination wallet already funded', async () => {
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
      payload: {
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
      },
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
      payload: {
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
      },
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
      payload: {
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
      },
    });

    expect(payment.statusCode, payment.body).toBe(409);
    const prep = payment.json<LiquidityPreparingResponse>();

    walletUsdcByChain.arbitrum = '0.50';
    gatewayDepositCreditsBalance = false;
    const retry = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/payments/liquidity-jobs/${prep.jobId}/retry`,
    });
    expect(retry.statusCode, retry.body).toBe(409);
    const retriedGatewayJob = retry.json<ProviderJobResponse>().job;
    expect(retriedGatewayJob).toMatchObject({
      amount_usdc: '0.50',
      chain: 'arbitrum',
      error_code: 'gateway_deposit_balance_unverified',
      job_type: 'liquidity.prepare',
      status: 'failed',
    });
    expect(retriedGatewayJob.metadata).toMatchObject({
      bridge_status: 'already_sufficient_destination_balance',
      bridge_transaction_id: null,
      deposit_transaction_id: 'circle_tx_deposit_test_arbitrum',
      observed_gateway_usdc: '0.00',
    });
    expect(bridgeTopUpCalls).toBe(0);
    expect(gatewayDepositCalls).toBe(1);
  });

  it('queues Gateway liquidity preparation when Circle Gateway balance lookup is transiently unavailable', async () => {
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
      payload: {
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
      },
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
      payload: {
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
      },
    });

    expect(payment.statusCode, payment.body).toBe(200);
    expect(payment.json()).toMatchObject({
      payment: {
        amount: '0.01',
        fulfillment: {
          httpStatus: 200,
          status: 'delivered',
        },
        providerMode: 'test',
        rail: 'exact_base',
      },
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
          action: 'payment.x402.submitted',
          outcome: 'success',
          summary: 'x402 resource delivered on exact_base',
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
      payload: {
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
      },
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

  it('recommends and records bridge top-ups for exact-wallet chain liquidity based on request history', async () => {
    walletUsdcByChain.arbitrum = '0.01';
    exactSettlement = {
      network: 'eip155:421614',
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
      payload: {
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
      },
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
      payload: {
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
      },
    });
    expect(preparing.statusCode, preparing.body).toBe(409);
    expect(preparing.json<LiquidityPreparingResponse>().error).toBe('liquidity_preparing');

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/runtime/payments/x402',
      headers: { authorization: `Bearer ${secret}` },
      payload: {
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
      },
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
  });
});
