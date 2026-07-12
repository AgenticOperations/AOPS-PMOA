import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { IdentityError } from '../../src/engines/identity/errors.js';
import type { CircleConnectionService } from '../../src/engines/payments/circle-connection-service.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { registerCircleWorkerRoutes } from '../../src/engines/payments/circle-worker-app.js';

const WORKER_TOKEN = 'worker-secret-32-bytes-minimum-value';

function buildWorker() {
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
});
