import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { IdentityError } from '../identity/errors.js';
import type { CircleConnectionService } from './circle-connection-service.js';
import type { CircleTreasuryProvider } from './circle-provider.js';

const connectionInitSchema = z.object({
  email: z.string().trim().email().max(320),
  orgId: z.string().trim().min(1).max(120),
  userId: z.string().trim().min(1).max(120),
});
const connectionCompleteSchema = z.object({
  challengeId: z.string().trim().min(1).max(120),
  orgId: z.string().trim().min(1).max(120),
  otp: z.string().trim().regex(/^(?:[A-Za-z0-9]+-)?\d{6}$/),
  userId: z.string().trim().min(1).max(120),
});
const connectionStatusSchema = z.object({
  orgId: z.string().trim().min(1).max(120),
  userId: z.string().trim().min(1).max(120).optional(),
});
const connectionDisconnectSchema = z.object({
  orgId: z.string().trim().min(1).max(120),
  userId: z.string().trim().min(1).max(120),
});
const operationSchema = z.enum([
  'bridgeWalletTopUp',
  'createWallet',
  'createWalletSet',
  'getGatewayBalance',
  'getWalletBalances',
  'initiateGatewayDeposit',
  'requestTestnetFunds',
  'settleExactX402',
  'settleGatewayX402',
]);
const providerRequestSchema = z.object({
  input: z.record(z.string(), z.unknown()),
  operation: operationSchema,
  orgId: z.string().trim().min(1).max(120),
});

export type CircleWorkerRouteDeps = {
  readonly connectionService: CircleConnectionService;
  readonly providerFactory: (orgId: string) => CircleTreasuryProvider;
  readonly token: string;
  readonly withOrgLock?: (<T>(orgId: string, operation: () => Promise<T>) => Promise<T>) | undefined;
};

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  return /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? null;
}

function tokenMatches(actual: string | null, expected: string): boolean {
  if (actual === null || expected.length < 32) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function assertTestInput(input: Record<string, unknown>): void {
  if (input.mode !== 'test') throw new Error('circle_worker_testnet_only');
}

async function executeProviderOperation(
  provider: CircleTreasuryProvider,
  operation: z.infer<typeof operationSchema>,
  rawInput: Record<string, unknown>,
): Promise<unknown> {
  assertTestInput(rawInput);
  switch (operation) {
    case 'bridgeWalletTopUp':
      return provider.bridgeWalletTopUp(rawInput as Parameters<CircleTreasuryProvider['bridgeWalletTopUp']>[0]);
    case 'createWallet':
      return provider.createWallet(rawInput as Parameters<CircleTreasuryProvider['createWallet']>[0]);
    case 'createWalletSet':
      return provider.createWalletSet(rawInput as Parameters<CircleTreasuryProvider['createWalletSet']>[0]);
    case 'getGatewayBalance':
      return provider.getGatewayBalance(rawInput as Parameters<CircleTreasuryProvider['getGatewayBalance']>[0]);
    case 'getWalletBalances':
      return provider.getWalletBalances(rawInput as Parameters<CircleTreasuryProvider['getWalletBalances']>[0]);
    case 'initiateGatewayDeposit':
      return provider.initiateGatewayDeposit({
        ...rawInput,
        amountMicros: BigInt(String(rawInput.amountMicros)),
      } as Parameters<CircleTreasuryProvider['initiateGatewayDeposit']>[0]);
    case 'requestTestnetFunds':
      return provider.requestTestnetFunds(rawInput as Parameters<CircleTreasuryProvider['requestTestnetFunds']>[0]);
    case 'settleExactX402':
      return provider.settleExactX402(rawInput as Parameters<CircleTreasuryProvider['settleExactX402']>[0]);
    case 'settleGatewayX402':
      return provider.settleGatewayX402(rawInput as Parameters<CircleTreasuryProvider['settleGatewayX402']>[0]);
  }
}

export function registerCircleWorkerRoutes(app: FastifyInstance, deps: CircleWorkerRouteDeps): void {
  const withOrgLock = deps.withOrgLock ?? (<T>(_orgId: string, operation: () => Promise<T>) => operation());
  app.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET' && request.url === '/healthz') return;
    if (!tokenMatches(bearerToken(request), deps.token)) {
      return reply.code(401).send({ error: 'circle_worker_unauthorized' });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'circle_worker_validation_error' });
    }
    if (error instanceof IdentityError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    const message = error instanceof Error ? error.message : '';
    const code = message.startsWith('circle_') ? message : 'circle_worker_operation_failed';
    const status = code === 'circle_worker_testnet_only' ? 400 : 409;
    return reply.code(status).send({ error: code, message: code });
  });

  app.get('/healthz', () => ({ ok: true, service: 'circle-worker' }));

  app.post('/internal/circle/connections/init', async (request, reply) => {
    const input = connectionInitSchema.parse(request.body ?? {});
    const result = await withOrgLock(input.orgId, () => deps.connectionService.initialize(input));
    return reply.code(202).send(result);
  });

  app.post('/internal/circle/connections/complete', async (request) => {
    const input = connectionCompleteSchema.parse(request.body ?? {});
    return withOrgLock(input.orgId, () => deps.connectionService.complete(input));
  });

  app.post('/internal/circle/connections/disconnect', async (request) => {
    const input = connectionDisconnectSchema.parse(request.body ?? {});
    return withOrgLock(input.orgId, () => deps.connectionService.disconnect(input));
  });

  app.post('/internal/circle/connections/status', async (request) => {
    const input = connectionStatusSchema.parse(request.body ?? {});
    return withOrgLock(input.orgId, () => deps.connectionService.status(input));
  });

  app.post('/internal/circle/provider/execute', async (request) => {
    const input = providerRequestSchema.parse(request.body ?? {});
    return withOrgLock(input.orgId, () => (
      executeProviderOperation(deps.providerFactory(input.orgId), input.operation, input.input)
    ));
  });
}
