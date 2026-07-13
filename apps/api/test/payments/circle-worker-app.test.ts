import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { IdentityError } from '../../src/engines/identity/errors.js';
import type { CircleConnectionService } from '../../src/engines/payments/circle-connection-service.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { registerCircleWorkerRoutes } from '../../src/engines/payments/circle-worker-app.js';
import { createCircleWorkerTreasuryProvider } from '../../src/engines/payments/circle-worker-client.js';

const WORKER_TOKEN = 'worker-secret-32-bytes-minimum-value';

function buildWorker(providerOverrides: Partial<CircleTreasuryProvider> = {}) {
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
    providerFactory: () => provider,
    token: WORKER_TOKEN,
    withOrgLock,
  });
  return { app, lockCalls, provider, service };
}

function settlementInput(destination: unknown) {
  return {
    attemptId: 'attempt_1',
    destination,
    mode: 'test' as const,
    request: {
      headers: [] as const,
      method: 'GET' as const,
      url: 'https://merchant.example/weather',
    },
    requirements: {
      amount: '10000',
      asset: '0xasset',
      extra: {},
      maxTimeoutSeconds: 300,
      network: 'eip155:84532',
      payTo: '0xpayto',
      scheme: 'exact' as const,
    },
    walletAddress: '0xwallet',
    walletId: 'wallet_1',
  };
}

describe('Circle worker internal API', () => {
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
        asset: '0xasset',
        extra: {},
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
      walletAddress: '0xwallet',
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
    ['settleExactX402', 'https://merchant.example/weather'],
    ['settleGatewayX402', 'http://merchant.example/weather'],
  ] as const)('rehydrates the pinned resolver across a real %s worker roundtrip', async (method, url) => {
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
    const { app } = buildWorker(overrides);

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
        addresses: ['203.0.113.10', '2001:db8::10'],
        hostname: 'merchant.example',
        resolveHostname: () => Promise.resolve(['203.0.113.10']),
        url,
      });
      input.request.url = url;

      const result = await client[method](
        input as Parameters<CircleTreasuryProvider['settleExactX402']>[0],
      );

      expect(result).toEqual(settlementResult);
      expect(exactAddresses).toEqual(['203.0.113.10', '2001:db8::10']);
      expect(rejectedOtherHostname).toBe(true);
      expect(settle).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });
});
