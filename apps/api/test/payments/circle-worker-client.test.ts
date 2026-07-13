import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCircleWorkerConnectionClient,
  createCircleWorkerTreasuryProvider,
} from '../../src/engines/payments/circle-worker-client.js';

describe('Circle worker client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends connection initialization only to the authenticated internal worker', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      seenUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seenInit = init;
      return Promise.resolve(new Response(JSON.stringify({
      challengeId: 'cch_1',
      email: 'owner@example.com',
      status: 'otp_pending',
      }), { status: 202, headers: { 'content-type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createCircleWorkerConnectionClient({ baseUrl: 'http://circle-worker:8090', token: 'worker-secret' });

    await client.initialize({ email: 'owner@example.com', orgId: 'org_1', userId: 'usr_1' });

    expect(seenUrl).toBe('http://circle-worker:8090/internal/circle/connections/init');
    expect(seenInit?.method).toBe('POST');
    expect(seenInit?.headers).toMatchObject({ authorization: 'Bearer worker-secret' });
  });

  it('serializes bigint provider inputs and scopes them to one organization', async () => {
    let seenInit: RequestInit | undefined;
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      seenInit = init;
      return Promise.resolve(new Response(JSON.stringify({
      amount: '0.5',
      amountMicros: '500000',
      approvalTransactionId: '0xapprove',
      depositTransactionId: '0xdeposit',
      gatewayWalletAddress: '0xgateway',
      providerMode: 'test',
      usdcAddress: '0xusdc',
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createCircleWorkerTreasuryProvider({
      baseUrl: 'http://circle-worker:8090',
      orgId: 'org_1',
      token: 'worker-secret',
    });

    await provider.initiateGatewayDeposit({
      address: '0xwallet',
      amountMicros: 500000n,
      chain: 'base',
      mode: 'test',
      walletId: 'wallet_1',
    });

    const requestBody = typeof seenInit?.body === 'string' ? seenInit.body : '';
    expect(JSON.parse(requestBody) as unknown).toMatchObject({
      input: { amountMicros: '500000', mode: 'test' },
      operation: 'initiateGatewayDeposit',
      orgId: 'org_1',
    });
  });

  it('serializes only the authenticated paid HTTP destination snapshot', async () => {
    let seenInit: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      seenInit = init;
      return Promise.resolve(new Response(JSON.stringify({
        network: 'eip155:84532',
        providerMode: 'test',
        success: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }));
    const provider = createCircleWorkerTreasuryProvider({
      baseUrl: 'http://circle-worker:8090',
      orgId: 'org_1',
      token: 'worker-secret',
    });
    const destination = {
      addresses: ['203.0.113.10'],
      hostname: 'merchant.example',
      resolverMetadata: 'must-not-cross-worker-boundary',
      resolveHostname: () => Promise.resolve(['203.0.113.10']),
      url: 'https://merchant.example/weather',
    };

    await provider.settleExactX402({
      attemptId: 'attempt_1',
      destination,
      mode: 'test',
      request: {
        headers: [],
        method: 'GET',
        url: destination.url,
      },
      requirements: {
        amount: '10000',
        asset: '0xasset',
        extra: {},
        maxTimeoutSeconds: 300,
        network: 'eip155:84532',
        payTo: '0xpayto',
        scheme: 'exact',
      },
      walletAddress: '0xwallet',
      walletId: 'wallet_1',
    });

    const requestBody = typeof seenInit?.body === 'string' ? seenInit.body : '';
    const body = JSON.parse(requestBody) as { input: { destination: unknown } };
    expect(body.input.destination).toEqual({
      addresses: ['203.0.113.10'],
      hostname: 'merchant.example',
      url: 'https://merchant.example/weather',
    });
  });

  it('fails closed when live mode is requested', async () => {
    const provider = createCircleWorkerTreasuryProvider({ baseUrl: 'http://circle-worker:8090', orgId: 'org_1', token: 'secret' });

    await expect(provider.createWalletSet({ label: 'Live', mode: 'live', orgId: 'org_1' }))
      .rejects.toThrow('circle_worker_testnet_only');
  });

  it('converts an unavailable worker transport into a controlled service error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))));
    const client = createCircleWorkerConnectionClient({
      baseUrl: 'http://circle-worker:8090',
      token: 'worker-secret',
    });

    await expect(client.status({ orgId: 'org_1' })).rejects.toMatchObject({
      code: 'circle_worker_unavailable',
      statusCode: 503,
    });
  });
});
