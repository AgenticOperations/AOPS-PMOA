import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { IdentityError } from '../../src/engines/identity/errors.js';
import type { CircleConnectionService } from '../../src/engines/payments/circle-connection-service.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import * as CircleWorkerApp from '../../src/engines/payments/circle-worker-app.js';
import { registerCircleWorkerRoutes } from '../../src/engines/payments/circle-worker-app.js';
import { createCircleWorkerTreasuryProvider } from '../../src/engines/payments/circle-worker-client.js';

const WORKER_TOKEN = 'worker-secret-32-bytes-minimum-value';

function buildWorker(
  providerOverrides: Partial<CircleTreasuryProvider> = {},
  paidHttpAllowOrigins: readonly string[] = [],
) {
  const lockCalls = vi.fn();
  const withOrgLock = async <T>(orgId: string, operation: () => Promise<T>): Promise<T> => {
    lockCalls(orgId, operation);
    return operation();
  };
  const service = {
    complete: vi.fn(),
    disconnect: vi.fn(() => Promise.resolve({ email: '', expiresAt: null, status: 'disconnected' as const })),
    initialize: vi.fn(() => Promise.resolve({ challengeId: 'cch_1', email: 'owner@example.com', status: 'otp_pending' as const })),
    status: vi.fn(),
    withConnectedExecutor: vi.fn(),
  } as unknown as CircleConnectionService;
  const provider = {
    initiateGatewayDeposit: vi.fn(() => Promise.resolve({
      amount: '0.5',
      amountMicros: '500000',
      approvalTransactionId: '0xapprove',
      depositTransactionId: '0xdeposit',
      gatewayDepositorAddress: '0xdepositor',
      gatewayWalletAddress: '0xgateway',
      providerMode: 'test',
      usdcAddress: '0xusdc',
    })),
    ...providerOverrides,
  } as unknown as CircleTreasuryProvider;
  const app = Fastify();
  registerCircleWorkerRoutes(app, {
    connectionService: service,
    paidHttpAllowOrigins,
    providerFactory: () => provider,
    token: WORKER_TOKEN,
    withOrgLock,
  });
  return { app, lockCalls, provider, service };
}

function settlementInput(
  destination: unknown,
  rail: 'exact' | 'gateway' = 'exact',
  requirementOverrides: {
    readonly asset?: string;
    readonly extra?: Record<string, unknown>;
    readonly network?: string;
    readonly scheme?: string;
  } = {},
) {
  const requestUrl = destination !== null && typeof destination === 'object' &&
    'url' in destination && typeof destination.url === 'string'
    ? destination.url
    : 'https://merchant.example/weather';
  return {
    attemptId: 'attempt_1',
    destination,
    mode: 'test' as const,
    request: {
      headers: [] as const,
      method: 'GET' as const,
      url: requestUrl,
    },
    requirements: {
      amount: '10000',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      extra: rail === 'gateway'
        ? {
            name: 'GatewayWalletBatched',
            version: '1',
            verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
          }
        : {},
      maxTimeoutSeconds: 300,
      network: 'eip155:84532',
      payTo: '0xpayto',
      scheme: 'exact' as const,
      ...requirementOverrides,
    },
    walletAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
    walletId: 'wallet_1',
  };
}

describe('Circle worker internal API', () => {
  it.each([
    ['fixture disabled', {
      ENABLE_TESTNET_X402_FIXTURES: 'false',
      PUBLIC_API_BASE_URL: 'http://qa.example:4010',
    }, []],
    ['fixture flag missing', {
      PUBLIC_API_BASE_URL: 'http://qa.example:4010',
    }, []],
    ['public URL missing', {
      ENABLE_TESTNET_X402_FIXTURES: 'true',
    }, []],
    ['public URL is not an exact origin', {
      ENABLE_TESTNET_X402_FIXTURES: 'true',
      PUBLIC_API_BASE_URL: 'http://qa.example:4010/api',
    }, []],
    ['exact QA origin enabled', {
      ENABLE_TESTNET_X402_FIXTURES: 'true',
      PUBLIC_API_BASE_URL: 'http://qa.example:4010',
    }, ['http://qa.example:4010']],
  ])('derives a fail-closed worker allowlist when %s', (_label, environment, expected) => {
    const deriveAllowOrigins = Reflect.get(
      CircleWorkerApp,
      'deriveCircleWorkerPaidHttpAllowOrigins',
    ) as ((environment: Readonly<Record<string, string | undefined>>) => readonly string[]) | undefined;

    expect(deriveAllowOrigins).toBeTypeOf('function');
    expect(deriveAllowOrigins?.(environment)).toEqual(expected);
  });

  it('exposes a non-sensitive health check without the worker token', async () => {
    const { app } = buildWorker();
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: 'circle-worker' });
    await app.close();
  });

  it('rejects requests without the private worker token', async () => {
    const { app, service } = buildWorker();
    const response = await app.inject({
      method: 'POST',
      payload: { email: 'owner@example.com', orgId: 'org_1', userId: 'usr_1' },
      url: '/internal/circle/connections/init',
    });

    expect(response.statusCode).toBe(401);
    expect(service.initialize).not.toHaveBeenCalled();
    await app.close();
  });

  it('runs connection initialization inside the worker', async () => {
    const { app, service } = buildWorker();
    const response = await app.inject({
      headers: { authorization: `Bearer ${WORKER_TOKEN}` },
      method: 'POST',
      payload: { email: 'owner@example.com', orgId: 'org_1', userId: 'usr_1' },
      url: '/internal/circle/connections/init',
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(service.initialize).toHaveBeenCalledWith({ email: 'owner@example.com', orgId: 'org_1', userId: 'usr_1' });
    await app.close();
  });

  it('preserves structured organization connection conflicts', async () => {
    const { app, service } = buildWorker();
    vi.mocked(service.initialize).mockRejectedValueOnce(new IdentityError(
      'circle_email_already_connected',
      409,
      'This Circle email is already connected to another workspace.',
    ));
    const response = await app.inject({
      headers: { authorization: `Bearer ${WORKER_TOKEN}` },
      method: 'POST',
      payload: { email: 'owner@example.com', orgId: 'org_2', userId: 'usr_2' },
      url: '/internal/circle/connections/init',
    });

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({
      error: 'circle_email_already_connected',
      message: 'This Circle email is already connected to another workspace.',
    });
    await app.close();
  });

  it('disconnects an org profile inside the same organization lock', async () => {
    const { app, lockCalls, service } = buildWorker();
    const response = await app.inject({
      headers: { authorization: `Bearer ${WORKER_TOKEN}` },
      method: 'POST',
      payload: { orgId: 'org_1', userId: 'usr_1' },
      url: '/internal/circle/connections/disconnect',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(service.disconnect).toHaveBeenCalledWith({ orgId: 'org_1', userId: 'usr_1' });
    expect(lockCalls).toHaveBeenCalledWith('org_1', expect.any(Function));
    await app.close();
  });

  it('converts serialized amounts and executes only allowlisted provider operations', async () => {
    const { app, lockCalls, provider } = buildWorker();
    const response = await app.inject({
      headers: { authorization: `Bearer ${WORKER_TOKEN}` },
      method: 'POST',
      payload: {
        input: { address: '0xwallet', amountMicros: '500000', chain: 'base', mode: 'test', walletId: 'wallet_1' },
        operation: 'initiateGatewayDeposit',
        orgId: 'org_1',
      },
      url: '/internal/circle/provider/execute',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(provider.initiateGatewayDeposit).toHaveBeenCalledWith(expect.objectContaining({ amountMicros: 500000n }));
    expect(lockCalls).toHaveBeenCalledWith('org_1', expect.any(Function));
    await app.close();
  });

  it('leaves legacy settlement inputs unchanged', async () => {
    const settleGatewayX402 = vi.fn(() => Promise.resolve({
      network: 'eip155:84532',
      providerMode: 'test' as const,
      success: true,
    }));
    const { app } = buildWorker({ settleGatewayX402 });
    const input = {
      mode: 'test',
      requirements: {
        amount: '10000',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        extra: {
          name: 'GatewayWalletBatched',
          version: '1',
          verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
        },
        maxTimeoutSeconds: 300,
        network: 'eip155:84532',
        payTo: '0xpayto',
        scheme: 'exact',
      },
      resource: {
        description: 'Legacy merchant resource',
        mimeType: 'application/json',
        url: 'https://merchant.example/weather',
      },
      walletAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      walletId: 'wallet_1',
    };

    const response = await app.inject({
      headers: { authorization: `Bearer ${WORKER_TOKEN}` },
      method: 'POST',
      payload: { input, operation: 'settleGatewayX402', orgId: 'org_1' },
      url: '/internal/circle/provider/execute',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(settleGatewayX402).toHaveBeenCalledWith(input);
    await app.close();
  });

  it.each([
    ['mismatched URL hostname', {
      addresses: ['203.0.113.10'],
      hostname: 'other.example',
      url: 'https://merchant.example/weather',
    }],
    ['empty address list', {
      addresses: [],
      hostname: 'merchant.example',
      url: 'https://merchant.example/weather',
    }],
    ['oversized address list', {
      addresses: Array.from({ length: 17 }, () => '203.0.113.10'),
      hostname: 'merchant.example',
      url: 'https://merchant.example/weather',
    }],
    ['non-IP address', {
      addresses: ['not-an-ip'],
      hostname: 'merchant.example',
      url: 'https://merchant.example/weather',
    }],
    ['extra resolver input', {
      addresses: ['203.0.113.10'],
      hostname: 'merchant.example',
      resolveHostname: 'caller-controlled',
      url: 'https://merchant.example/weather',
    }],
  ])('rejects %s before invoking the settlement provider', async (_label, destination) => {
    const settleExactX402 = vi.fn();
    const { app } = buildWorker({ settleExactX402 });

    const response = await app.inject({
      headers: { authorization: `Bearer ${WORKER_TOKEN}` },
      method: 'POST',
      payload: {
        input: settlementInput(destination),
        operation: 'settleExactX402',
        orgId: 'org_1',
      },
      url: '/internal/circle/provider/execute',
    });

    expect(response.statusCode).toBe(400);
    expect(settleExactX402).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ['HTTPS loopback', 'https://merchant.example/weather', '127.0.0.1'],
    ['HTTPS private address', 'https://merchant.example/weather', '10.0.0.1'],
    ['HTTPS metadata address', 'https://merchant.example/weather', '169.254.169.254'],
    ['arbitrary HTTP origin', 'http://merchant.example/weather', '8.8.8.8'],
  ])('rejects %s before provider signing', async (_label, url, address) => {
    const signTypedData = vi.fn();
    const settleExactX402 = vi.fn(async () => {
      await signTypedData();
      return { network: 'eip155:84532', providerMode: 'test' as const, success: true };
    });
    const { app } = buildWorker({ settleExactX402 });
    const response = await app.inject({
      headers: { authorization: `Bearer ${WORKER_TOKEN}` },
      method: 'POST',
      payload: {
        input: settlementInput({
          addresses: [address],
          hostname: 'merchant.example',
          url,
        }),
        operation: 'settleExactX402',
        orgId: 'org_1',
      },
      url: '/internal/circle/provider/execute',
    });

    expect(response.statusCode).toBe(400);
    expect(settleExactX402).not.toHaveBeenCalled();
    expect(signTypedData).not.toHaveBeenCalled();
    await app.close();
  });

  it('allows loopback only for the exact configured QA HTTP origin', async () => {
    const settleExactX402 = vi.fn(() => Promise.resolve({
      network: 'eip155:84532',
      providerMode: 'test' as const,
      success: true,
    }));
    const { app } = buildWorker({ settleExactX402 }, ['http://qa.example:4010']);
    const response = await app.inject({
      headers: { authorization: `Bearer ${WORKER_TOKEN}` },
      method: 'POST',
      payload: {
        input: settlementInput({
          addresses: ['127.0.0.1'],
          hostname: 'qa.example',
          url: 'http://qa.example:4010/x402',
        }),
        operation: 'settleExactX402',
        orgId: 'org_1',
      },
      url: '/internal/circle/provider/execute',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(settleExactX402).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rejects a request URL that differs from its validated destination before signing', async () => {
    const signTypedData = vi.fn();
    const settleExactX402 = vi.fn(async () => {
      await signTypedData();
      return { network: 'eip155:84532', providerMode: 'test' as const, success: true };
    });
    const { app } = buildWorker({ settleExactX402 });
    const input = settlementInput({
      addresses: ['8.8.8.8'],
      hostname: 'merchant.example',
      url: 'https://merchant.example/weather',
    });
    input.request.url = 'https://attacker.example/paid';

    const response = await app.inject({
      headers: { authorization: `Bearer ${WORKER_TOKEN}` },
      method: 'POST',
      payload: { input, operation: 'settleExactX402', orgId: 'org_1' },
      url: '/internal/circle/provider/execute',
    });

    expect(response.statusCode).toBe(400);
    expect(settleExactX402).not.toHaveBeenCalled();
    expect(signTypedData).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ['eip155:84532', '0x036cbd53842c5426634e7929541ec2318f3dcf7e'],
    ['eip155:421614', '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'],
    ['eip155:80002', '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582'],
    ['eip155:11155420', '0x5fd84259d66Cd46123540766Be93DFE6D43130D7'],
    ['eip155:43113', '0x5425890298aed601595a70AB815c96711a31Bc65'],
  ])('accepts exact testnet authority %s with its matching USDC', async (network, asset) => {
    const settleExactX402 = vi.fn(() => Promise.resolve({
      network,
      providerMode: 'test' as const,
      success: true,
    }));
    const { app } = buildWorker({ settleExactX402 });
    const response = await app.inject({
      headers: { authorization: `Bearer ${WORKER_TOKEN}` },
      method: 'POST',
      payload: {
        input: settlementInput({
          addresses: ['8.8.8.8'],
          hostname: 'merchant.example',
          url: 'https://merchant.example/weather',
        }, 'exact', { asset, network }),
        operation: 'settleExactX402',
        orgId: 'org_1',
      },
      url: '/internal/circle/provider/execute',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(settleExactX402).toHaveBeenCalledOnce();
    await app.close();
  });

  it.each([
    ['mainnet network', 'settleExactX402', 'exact', {
      network: 'eip155:8453',
    }],
    ['mismatched testnet asset', 'settleExactX402', 'exact', {
      asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    }],
    ['mainnet asset', 'settleExactX402', 'exact', {
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    }],
    ['non-exact scheme', 'settleExactX402', 'exact', {
      scheme: 'upto',
    }],
    ['mainnet Gateway contract', 'settleGatewayX402', 'gateway', {
      extra: {
        name: 'GatewayWalletBatched',
        version: '1',
        verifyingContract: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
      },
    }],
    ['wrong Gateway contract', 'settleGatewayX402', 'gateway', {
      extra: {
        name: 'GatewayWalletBatched',
        version: '1',
        verifyingContract: '0x0000000000000000000000000000000000000001',
      },
    }],
    ['wrong Gateway name', 'settleGatewayX402', 'gateway', {
      extra: {
        name: 'USDC',
        version: '1',
        verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
      },
    }],
    ['wrong Gateway version', 'settleGatewayX402', 'gateway', {
      extra: {
        name: 'GatewayWalletBatched',
        version: '2',
        verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
      },
    }],
  ] as const)('rejects %s authority before provider signing', async (
    _label,
    operation,
    rail,
    requirementOverrides,
  ) => {
    const signTypedData = vi.fn();
    const settle = vi.fn(async () => {
      await signTypedData();
      return { network: 'eip155:84532', providerMode: 'test' as const, success: true };
    });
    const overrides = operation === 'settleExactX402'
      ? { settleExactX402: settle }
      : { settleGatewayX402: settle };
    const { app } = buildWorker(overrides);
    const response = await app.inject({
      headers: { authorization: `Bearer ${WORKER_TOKEN}` },
      method: 'POST',
      payload: {
        input: settlementInput({
          addresses: ['8.8.8.8'],
          hostname: 'merchant.example',
          url: 'https://merchant.example/weather',
        }, rail, requirementOverrides),
        operation,
        orgId: 'org_1',
      },
      url: '/internal/circle/provider/execute',
    });

    expect(response.statusCode).toBe(400);
    expect(settle).not.toHaveBeenCalled();
    expect(signTypedData).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ['settleExactX402', 'https://merchant.example/weather', []],
    ['settleGatewayX402', 'http://merchant.example/weather', ['http://merchant.example']],
  ] as const)('rehydrates the pinned resolver across a real %s worker roundtrip', async (method, url, allowedOrigins) => {
    let exactAddresses: readonly (string | { readonly address: string })[] = [];
    let rejectedOtherHostname = false;
    const settlementResult = {
      network: 'eip155:84532',
      providerMode: 'test' as const,
      success: true,
    };
    const settle = vi.fn(async (input: Parameters<CircleTreasuryProvider['settleExactX402']>[0]) => {
      if (!('destination' in input)) throw new Error('canonical input required');
      exactAddresses = await input.destination.resolveHostname(input.destination.hostname);
      try {
        await input.destination.resolveHostname('attacker.example');
      } catch {
        rejectedOtherHostname = true;
      }
      return settlementResult;
    });
    const overrides = method === 'settleExactX402'
      ? { settleExactX402: settle }
      : { settleGatewayX402: settle };
    const { app } = buildWorker(overrides, allowedOrigins);

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const payload = typeof init?.body === 'string' ? { payload: init.body } : {};
      const response = await app.inject({
        headers: init?.headers as Record<string, string>,
        method: (init?.method ?? 'GET') as 'GET' | 'POST',
        ...payload,
        url: new URL(url).pathname,
      });
      return new Response(response.body, {
        headers: { 'content-type': response.headers['content-type'] ?? 'application/json' },
        status: response.statusCode,
      });
    }));
    try {
      const client = createCircleWorkerTreasuryProvider({
        baseUrl: 'http://circle-worker.internal',
        orgId: 'org_1',
        token: WORKER_TOKEN,
      });
      const input = settlementInput({
        addresses: ['8.8.8.8', '1.1.1.1'],
        hostname: 'merchant.example',
        resolveHostname: () => Promise.resolve(['203.0.113.10']),
        url,
      }, method === 'settleGatewayX402' ? 'gateway' : 'exact');
      input.request.url = url;

      const result = await client[method](
        input as Parameters<CircleTreasuryProvider['settleExactX402']>[0],
      );

      expect(result).toEqual(settlementResult);
      expect(exactAddresses).toEqual(['8.8.8.8', '1.1.1.1']);
      expect(rejectedOtherHostname).toBe(true);
      expect(settle).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });
});
