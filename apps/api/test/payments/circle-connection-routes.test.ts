import Fastify from 'fastify';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { registerPaymentRoutes } from '../../src/engines/payments/routes.js';

function buildConnectionApp(role: 'owner' | 'admin' = 'owner') {
  const service = {
    disconnect: vi.fn(() => Promise.resolve({
      email: '',
      expiresAt: null,
      status: 'disconnected' as const,
    })),
    withConnectedExecutor: vi.fn(),
    complete: vi.fn(() => Promise.resolve({
      email: 'owner@example.com',
      expiresAt: '2026-07-18T12:00:00.000Z',
      status: 'connected' as const,
    })),
    initialize: vi.fn(() => Promise.resolve({
      challengeId: 'cch_123',
      email: 'owner@example.com',
      status: 'otp_pending' as const,
    })),
    status: vi.fn(() => Promise.resolve({
      challengeId: 'cch_123',
      email: 'owner@example.com',
      expiresAt: null,
      status: 'otp_pending' as const,
    })),
  };
  const app = Fastify();
  registerPaymentRoutes(app, {
    circleConnectionService: service,
    installErrorHandler: true,
    pool: {} as pg.Pool,
    resolveOperator: () => Promise.resolve({
      actorId: 'usr_1',
      orgId: 'org_1',
      role,
      userId: 'usr_1',
    }),
  });
  return { app, service };
}

describe('Circle connection routes', () => {
  it('fails closed when no org-scoped Circle connection or worker is configured', async () => {
    const app = Fastify();
    const pool = {
      query: vi.fn(() => Promise.resolve({
        rows: [{
          created_at: new Date('2026-07-11T00:00:00.000Z'),
          mode: 'test',
          org_id: 'org_1',
          updated_at: new Date('2026-07-11T00:00:00.000Z'),
          updated_by: 'usr_1',
        }],
      })),
    } as unknown as pg.Pool;
    registerPaymentRoutes(app, {
      installErrorHandler: true,
      pool,
      resolveOperator: () => Promise.resolve({
        actorId: 'usr_1',
        orgId: 'org_1',
        role: 'owner',
        userId: 'usr_1',
      }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/orgs/org_1/payments/provider-health',
    });

    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toMatchObject({ error: 'circle_connection_not_configured' });
    await app.close();
  });

  it('starts a testnet Circle email challenge for the current org admin', async () => {
    const { app, service } = buildConnectionApp();
    const response = await app.inject({
      method: 'POST',
      payload: { email: 'owner@example.com' },
      url: '/v1/orgs/org_1/payments/circle/connection/init',
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toMatchObject({ challengeId: 'cch_123', status: 'otp_pending' });
    expect(service.initialize).toHaveBeenCalledWith({ email: 'owner@example.com', orgId: 'org_1', userId: 'usr_1' });
    await app.close();
  });

  it('completes the testnet OTP challenge without returning the OTP', async () => {
    const { app, service } = buildConnectionApp();
    const response = await app.inject({
      method: 'POST',
      payload: { challenge_id: 'cch_123', otp: 'ABC-123456' },
      url: '/v1/orgs/org_1/payments/circle/connection/complete',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ email: 'owner@example.com', status: 'connected' });
    expect(response.body).not.toContain('ABC-123456');
    expect(service.complete).toHaveBeenCalledWith({
      challengeId: 'cch_123',
      orgId: 'org_1',
      otp: 'ABC-123456',
      userId: 'usr_1',
    });
    await app.close();
  });

  it('returns redacted Circle connection status', async () => {
    const { app, service } = buildConnectionApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/orgs/org_1/payments/circle/connection',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      connection: { challengeId: 'cch_123', email: 'owner@example.com', expiresAt: null, status: 'otp_pending' },
    });
    expect(service.status).toHaveBeenCalledWith({ orgId: 'org_1', userId: 'usr_1' });
    await app.close();
  });

  it('allows only the workspace owner to disconnect the Circle session', async () => {
    const owner = buildConnectionApp();
    const disconnected = await owner.app.inject({
      method: 'DELETE',
      url: '/v1/orgs/org_1/payments/circle/connection',
    });
    expect(disconnected.statusCode, disconnected.body).toBe(200);
    expect(disconnected.json()).toEqual({ email: '', expiresAt: null, status: 'disconnected' });
    expect(owner.service.disconnect).toHaveBeenCalledWith({ orgId: 'org_1', userId: 'usr_1' });
    await owner.app.close();

    const admin = buildConnectionApp('admin');
    const forbidden = await admin.app.inject({
      method: 'DELETE',
      url: '/v1/orgs/org_1/payments/circle/connection',
    });
    expect(forbidden.statusCode, forbidden.body).toBe(403);
    expect(admin.service.disconnect).not.toHaveBeenCalled();
    await admin.app.close();
  });
});
