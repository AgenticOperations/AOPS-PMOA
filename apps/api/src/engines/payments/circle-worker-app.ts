import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { IdentityError } from '../identity/errors.js';
import type { CircleConnectionService } from './circle-connection-service.js';
import {
  assertCircleTestnetX402Authority,
  type CircleTreasuryProvider,
} from './circle-provider.js';
import {
  deriveTestnetPaidHttpAllowOrigins,
  PaidHttpError,
  revalidatePaidHttpDestination,
} from './x402-http.js';

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
  'transferWallet',
  'transferNativeGas',
  'signPermit2Delegation',
  'executePermit2Transaction',
]);
const providerRequestSchema = z.object({
  input: z.record(z.string(), z.unknown()),
  operation: operationSchema,
  orgId: z.string().trim().min(1).max(120),
});

export type CircleWorkerRouteDeps = {
  readonly connectionService: CircleConnectionService;
  readonly paidHttpAllowOrigins?: readonly string[] | undefined;
  readonly providerFactory: (orgId: string) => CircleTreasuryProvider;
  readonly readiness?: (() => Promise<boolean>) | undefined;
  readonly token: string;
  readonly withOrgLock?: (<T>(orgId: string, operation: () => Promise<T>) => Promise<T>) | undefined;
};

export function deriveCircleWorkerPaidHttpAllowOrigins(
  environment: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  return deriveTestnetPaidHttpAllowOrigins(
    environment.ENABLE_TESTNET_X402_FIXTURES === 'true',
    environment.PUBLIC_API_BASE_URL ?? '',
  );
}

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

async function rehydrateSettlementInput(
  rawInput: Record<string, unknown>,
  paidHttpAllowOrigins: readonly string[],
): Promise<Parameters<CircleTreasuryProvider['settleExactX402']>[0]> {
  if (!Object.hasOwn(rawInput, 'destination')) {
    return rawInput as Parameters<CircleTreasuryProvider['settleExactX402']>[0];
  }
  const destination = await revalidatePaidHttpDestination(rawInput.destination, {
    allowHttpOrigins: paidHttpAllowOrigins,
  });
  const request = rawInput.request;
  if (
    request === null ||
    typeof request !== 'object' ||
    Array.isArray(request)
  ) {
    throw new PaidHttpError(
      'invalid_destination',
      'Paid HTTP request URL does not match its validated destination',
    );
  }
  const requestUrl = (request as Record<string, unknown>).url;
  let canonicalRequestUrl: string;
  try {
    if (typeof requestUrl !== 'string') throw new TypeError('Invalid request URL');
    canonicalRequestUrl = new URL(requestUrl).href;
  } catch {
    throw new PaidHttpError(
      'invalid_destination',
      'Paid HTTP request URL does not match its validated destination',
    );
  }
  if (canonicalRequestUrl !== destination.url) {
    throw new PaidHttpError(
      'invalid_destination',
      'Paid HTTP request URL does not match its validated destination',
    );
  }
  return {
    ...rawInput,
    destination,
  } as Parameters<CircleTreasuryProvider['settleExactX402']>[0];
}

async function executeProviderOperation(
  provider: CircleTreasuryProvider,
  operation: z.infer<typeof operationSchema>,
  rawInput: Record<string, unknown>,
  paidHttpAllowOrigins: readonly string[],
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
      {
        const input = await rehydrateSettlementInput(rawInput, paidHttpAllowOrigins);
        assertCircleTestnetX402Authority('settleExactX402', input);
        return provider.settleExactX402(input);
      }
    case 'settleGatewayX402':
      {
        const input = await rehydrateSettlementInput(rawInput, paidHttpAllowOrigins);
        assertCircleTestnetX402Authority('settleGatewayX402', input);
        return provider.settleGatewayX402(input);
      }
    case 'transferWallet':
      return provider.transferWallet({
        ...rawInput,
        amountMicros: BigInt(String(rawInput.amountMicros)),
      } as Parameters<CircleTreasuryProvider['transferWallet']>[0]);
    case 'transferNativeGas':
      return provider.transferNativeGas({
        ...rawInput,
        amountWei: BigInt(String(rawInput.amountWei)),
      } as Parameters<CircleTreasuryProvider['transferNativeGas']>[0]);
    case 'signPermit2Delegation':
      return provider.signPermit2Delegation(rawInput as Parameters<CircleTreasuryProvider['signPermit2Delegation']>[0]);
    case 'executePermit2Transaction':
      return provider.executePermit2Transaction(rawInput as Parameters<CircleTreasuryProvider['executePermit2Transaction']>[0]);
  }
}

export function registerCircleWorkerRoutes(app: FastifyInstance, deps: CircleWorkerRouteDeps): void {
  const withOrgLock = deps.withOrgLock ?? (<T>(_orgId: string, operation: () => Promise<T>) => operation());
  const paidHttpAllowOrigins = deps.paidHttpAllowOrigins ?? [];
  app.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET' && (request.url === '/healthz' || request.url === '/readyz')) return;
    if (!tokenMatches(bearerToken(request), deps.token)) {
      return reply.code(401).send({ error: 'circle_worker_unauthorized' });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'circle_worker_validation_error', message: error.message });
    }
    if (error instanceof PaidHttpError && error.code === 'invalid_destination') {
      return reply.code(400).send({ error: 'circle_worker_validation_error', message: error.message });
    }
    if (error instanceof IdentityError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    const underlying = error instanceof Error ? error.message : String(error);
    reply.log.error({ err: error }, 'circle worker operation failed');
    const code = underlying.startsWith('circle_') ? underlying.split(':')[0]! : 'circle_worker_operation_failed';
    const status = code === 'circle_worker_testnet_only' ||
      code === 'circle_worker_x402_authority_invalid'
      ? 400
      : 409;
    return reply.code(status).send({
      error: code,
      message: underlying.length > 0 ? underlying : code,
    });
  });

  app.get('/healthz', () => ({ ok: true, service: 'circle-worker' }));

  app.get('/readyz', async (_request, reply) => {
    let ready = false;
    try {
      ready = deps.readiness !== undefined && await deps.readiness();
    } catch {
      ready = false;
    }
    return reply.code(ready ? 200 : 503).send({
      ok: ready,
      service: 'circle-worker',
      status: ready ? 'ready' : 'not_ready',
    });
  });

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
      executeProviderOperation(
        deps.providerFactory(input.orgId),
        input.operation,
        input.input,
        paidHttpAllowOrigins,
      )
    ));
  });
}
