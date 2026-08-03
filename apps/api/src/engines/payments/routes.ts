import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { resolveSession } from '../auth/store.js';
import { IdentityError } from '../identity/errors.js';
import { getMembershipRole } from '../identity/store.js';
import { satisfiesRole } from '../identity/roles.js';
import type { OperatorContext, Role } from '../identity/types.js';
import { authenticateRuntimeConnection } from '../runtime/store.js';
import {
  bridgeExactWalletTopUp,
  cancelLiquidityJob,
  createPaymentSource,
  createTreasury,
  ensureCircleTreasury,
  getAgentPayments,
  getOrgPaymentMode,
  getPaymentsConsoleSnapshot,
  getTreasuryOverview,
  initiateCircleGatewayDeposit,
  listAgentPaymentAccounts,
  listCircleBalances,
  listPaymentSources,
  listPaymentEvents,
  listCircleChainCapabilities,
  listCircleProviderJobs,
  listUnknownAttempts,
  reconcileCircleProviderJobs,
  resolveUnknownAttempt,
  listLiquidityJobs,
  listPaymentRailReadiness,
  listPaymentReservations,
  listPaymentRouteObservations,
  listRebalanceRecommendations,
  listCircleWallets,
  listTreasuries,
  PaymentApprovalRequiredError,
  PaymentLiquidityPreparingError,
  payRuntimeX402,
  type PayRuntimeX402Options,
  requestCircleTestnetFunds,
  retryLiquidityJob,
  setOrgPaymentMode,
  setAgentPaymentAccess,
  verifyPaymentRails,
  verifyPaymentRail,
} from './store.js';
import { revokeAgent } from './agent-revocation.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import type { CircleConnectionController } from './circle-worker-client.js';
import {
  PaidHttpError,
  type PaidHttpExecutionOptions,
  type PaidHttpExecutor,
  type PaidHttpUrlPolicy,
} from './x402-http.js';
import {
  createX402ResultCryptoCodec,
  type X402ResultCryptoCodec,
} from './x402-result-crypto.js';

export type RegisterPaymentRoutesDeps = {
  readonly pool: pg.Pool;
  readonly installErrorHandler?: boolean | undefined;
  readonly sessionCookieName?: string | undefined;
  readonly resolveOperator?: ((request: FastifyRequest) => Promise<OperatorContext | null>) | undefined;
  readonly circleProvider?: CircleTreasuryProvider | undefined;
  readonly circleProviderFactory?: ((orgId: string) => CircleTreasuryProvider) | undefined;
  readonly circleConnectionService?: CircleConnectionController | undefined;
  readonly paidHttpExecution?: PaidHttpExecutionOptions | undefined;
  readonly paidHttpExecutor?: PaidHttpExecutor | undefined;
  readonly paidHttpUrlPolicy?: PaidHttpUrlPolicy | undefined;
  readonly orchestrationHooks?: PayRuntimeX402Options['orchestrationHooks'];
  readonly resultCrypto?: X402ResultCryptoCodec | undefined;
  readonly redis?: Redis | undefined;
};

const modeSchema = z.enum(['test', 'live']);
const chainSchema = z.enum(['base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc']);
const paymentRails = [
  'gateway_base',
  'gateway_arbitrum',
  'gateway_polygon',
  'gateway_optimism',
  'gateway_avalanche',
  'gateway_arc',
  'exact_base',
  'exact_arbitrum',
  'exact_polygon',
  'exact_optimism',
  'exact_avalanche',
  'exact_arc',
] as const;
const railSchema = z.enum(paymentRails);
const sourceTypeSchema = z.enum(['gateway', 'direct_exact', 'dedicated_wallet']);
const providerSchema = z.enum(['circle_gateway', 'circle_wallets']);
const accountTypeSchema = z.enum(['eoa', 'sca', 'virtual', 'unknown']);
const moneySchema = z.string().trim().regex(/^\d+(?:\.\d{1,6})?$/);

const treasurySchema = z.object({
  treasury_type: z.literal('gateway'),
  chain: chainSchema,
  label: z.string().trim().min(1).max(120),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const paymentSourceSchema = z.object({
  source_type: sourceTypeSchema,
  provider: providerSchema,
  rail: railSchema,
  chain: chainSchema,
  label: z.string().trim().min(1).max(120),
  treasury_id: z.string().trim().min(1).nullable().optional(),
  account_type: accountTypeSchema.optional(),
  address: z.string().trim().min(1).max(240).nullable().optional(),
  external_wallet_id: z.string().trim().min(1).max(240).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const paymentAccessSchema = z.object({
  status: z.enum(['active', 'disabled']),
  allowed_rails: z.array(railSchema).max(paymentRails.length).default([]),
  budget_usdc: moneySchema,
  dedicated_wallet_required: z.boolean(),
  per_request_cap_usdc: moneySchema,
  approval_threshold_usdc: moneySchema.nullable().optional(),
});

const providerModeSchema = z.object({
  mode: modeSchema,
});

const circleTreasurySchema = z.object({
  label: z.string().trim().min(1).max(120).default('Org treasury'),
});

const circleConnectionInitSchema = z.object({
  email: z.string().trim().email().max(320),
});

const circleConnectionCompleteSchema = z.object({
  challenge_id: z.string().trim().min(1).max(120),
  otp: z.string().trim().regex(/^(?:[A-Za-z0-9]+-)?\d{6}$/),
});

const gatewayDepositSchema = z.object({
  amount_usdc: moneySchema,
  chain: chainSchema,
});

const testnetFaucetSchema = z.object({
  chains: z.array(chainSchema).min(1).max(5),
});

const railVerificationBatchSchema = z.object({
  only_unverified: z.boolean().default(true),
  rails: z.array(railSchema).min(1).max(10).optional(),
});

const bridgeTopUpSchema = z.object({
  amount_usdc: moneySchema,
  from_chain: chainSchema,
  to_chain: chainSchema,
});

const paidHttpBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('json'), value: z.unknown() }).strict(),
  z.object({ kind: z.literal('text'), value: z.string() }).strict(),
  z.object({ kind: z.literal('base64'), value: z.string() }).strict(),
]);

const paidHttpRequestSchema = z.object({
  url: z.string().trim().min(1).max(4096),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  headers: z.array(z.tuple([z.string(), z.string()])).max(100),
  body: paidHttpBodySchema.optional(),
}).strict();

const runtimeX402Schema = z.object({
  idempotency_key: z.string().trim().min(1).max(160),
  request: paidHttpRequestSchema,
}).strict();

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

const resolveUnknownAttemptSchema = z.object({
  outcome: z.enum(['failed', 'settled']),
});

const revokeAgentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

function extractBearerToken(request: FastifyRequest, sessionCookieName = 'agentops_session'): string | null {
  const header = request.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1] !== undefined && match[1].length > 0) return match[1];
  }

  const cookie = request.headers.cookie;
  if (typeof cookie !== 'string') return null;
  for (const part of cookie.split(';').map((item) => item.trim())) {
    const [key, ...rest] = part.split('=');
    if (key === sessionCookieName) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function requiredRuntimeBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (typeof header !== 'string') throw new IdentityError('invalid_connection', 401, 'Connection credential is required.');
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match?.[1] === undefined || match[1].length === 0) {
    throw new IdentityError('invalid_connection', 401, 'Connection credential is required.');
  }
  return match[1];
}

async function requireOrgOperator(
  request: FastifyRequest,
  deps: RegisterPaymentRoutesDeps,
  orgId: string,
  role: Role,
): Promise<OperatorContext> {
  const token = extractBearerToken(request, deps.sessionCookieName);
  if (token !== null) {
    const session = await resolveSession(deps.pool, token);
    if (session !== null) {
      const membershipRole = await getMembershipRole(deps.pool, orgId, session.user.id);
      if (membershipRole === null) throw new IdentityError('not_found', 404, 'Workspace was not found.');
      if (!satisfiesRole(membershipRole, role)) {
        throw new IdentityError('forbidden', 403, 'Operator role is not allowed for this action.');
      }
      return {
        actorId: session.user.id,
        userId: session.user.id,
        orgId,
        role: membershipRole,
      };
    }
  }

  const operator = deps.resolveOperator === undefined ? null : await deps.resolveOperator(request);
  if (operator === null) throw new IdentityError('unauthorized', 401, 'Operator context is required.');
  if (!satisfiesRole(operator.role, role)) {
    throw new IdentityError('forbidden', 403, 'Operator role is not allowed for this action.');
  }
  return { ...operator, orgId };
}

function parseBody<T>(schema: z.ZodType<T>, request: FastifyRequest): T {
  return schema.parse(request.body ?? {});
}

function unavailableCircleProvider(): CircleTreasuryProvider {
  const unavailable = <T>(): Promise<T> => Promise.reject(new IdentityError(
    'circle_connection_not_configured',
    503,
    'Circle Agent Wallet worker is not configured.',
  ));
  return {
    bridgeWalletTopUp: unavailable,
    createWallet: unavailable,
    createWalletSet: unavailable,
    getGatewayBalance: unavailable,
    getWalletBalances: unavailable,
    health: () => ({ configured: false, missing: ['circle_agent_wallet_worker'], mode: 'test', provider: 'circle' }),
    initiateGatewayDeposit: unavailable,
    requestTestnetFunds: unavailable,
    settleExactX402: unavailable,
    settleGatewayX402: unavailable,
    transferWallet: unavailable,
  };
}

function runtimeX402ResultCrypto(deps: RegisterPaymentRoutesDeps): X402ResultCryptoCodec | undefined {
  if (deps.resultCrypto !== undefined) return deps.resultCrypto;
  const key = process.env.X402_RESULT_ENCRYPTION_KEY;
  if (key === undefined || key.length === 0) return undefined;
  try {
    return createX402ResultCryptoCodec(key);
  } catch {
    return undefined;
  }
}

function paidHttpPublicError(error: unknown): IdentityError | null {
  if (error instanceof PaidHttpError) {
    switch (error.code) {
      case 'not_payment_required':
        return new IdentityError(
          'x402_payment_not_required',
          422,
          'The upstream resource did not require an x402 payment.',
        );
      case 'payment_required_missing':
      case 'payment_required_invalid':
      case 'payment_required_empty_accepts':
        return new IdentityError(
          'x402_payment_required_invalid',
          422,
          'The upstream resource returned an invalid x402 payment requirement.',
        );
      case 'redirect_not_supported':
        return new IdentityError(
          'x402_redirect_not_supported',
          400,
          'Paid HTTP discovery redirects are not supported.',
        );
      case 'request_timeout':
        return new IdentityError(
          'x402_request_timeout',
          504,
          'Paid HTTP discovery timed out.',
        );
      case 'response_too_large':
        return new IdentityError(
          'x402_response_too_large',
          413,
          'Paid HTTP discovery response exceeded the maximum size.',
        );
      case 'unsupported_content_encoding':
        return new IdentityError(
          'x402_unsupported_content_encoding',
          422,
          'The upstream resource used an unsupported content encoding.',
        );
      case 'invalid_json':
        return new IdentityError(
          'x402_invalid_response',
          422,
          'The upstream resource returned an invalid response.',
        );
      case 'invalid_destination':
        return new IdentityError(
          'x402_invalid_destination',
          400,
          'Paid HTTP destination is not allowed.',
        );
      case 'request_failed':
        return new IdentityError(
          'x402_request_failed',
          502,
          'Paid HTTP discovery failed.',
        );
    }
  }
  if (
    error instanceof TypeError &&
    (
      error.message === 'Invalid paid HTTP URL' ||
      error.message.startsWith('Paid HTTP URL') ||
      error.message.startsWith('Paid HTTP hostname') ||
      error.message.startsWith('Pinned paid HTTP destination')
    )
  ) {
    return new IdentityError(
      'x402_invalid_destination',
      400,
      'Paid HTTP destination is not allowed.',
    );
  }
  return null;
}

export function registerPaymentRoutes(app: FastifyInstance, deps: RegisterPaymentRoutesDeps): void {
  const circleConnectionService = deps.circleConnectionService ?? null;

  const requireCircleConnectionService = (): CircleConnectionController => {
    if (circleConnectionService === null) {
      throw new IdentityError(
        'circle_connection_not_configured',
        503,
        'Circle Agent Wallet onboarding is not configured.',
      );
    }
    return circleConnectionService;
  };
  const providerForOrg = deps.circleProviderFactory ?? (deps.circleProvider === undefined
    ? (): CircleTreasuryProvider => unavailableCircleProvider()
    : () => deps.circleProvider as CircleTreasuryProvider);

  if (deps.installErrorHandler === true) {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof PaymentApprovalRequiredError) {
        return reply.code(error.statusCode).send({
          approvalId: error.approvalId,
          decisionId: error.decisionId,
          error: error.code,
          message: error.message,
        });
      }
      if (error instanceof PaymentLiquidityPreparingError) {
        return reply.code(error.statusCode).send({
          chain: error.chain,
          error: error.code,
          jobId: error.jobId,
          message: error.message,
          rail: error.rail,
          retryAfterSeconds: error.retryAfterSeconds,
        });
      }
      if (error instanceof IdentityError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'validation_error', message: 'Request body is invalid.', issues: error.issues });
      }
      throw error;
    });
  }

  app.get('/v1/orgs/:orgId/payments/treasury', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { treasuries: await listTreasuries(deps.pool, params.orgId) };
  });

  app.get('/v1/orgs/:orgId/payments/circle/connection', async (request) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return {
      connection: await requireCircleConnectionService().status({
        orgId: params.orgId,
        userId: operator.userId ?? operator.actorId,
      }),
    };
  });

  app.post('/v1/orgs/:orgId/payments/circle/connection/init', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'owner');
    const input = parseBody(circleConnectionInitSchema, request);
    const result = await requireCircleConnectionService().initialize({
      email: input.email,
      orgId: params.orgId,
      userId: operator.userId ?? operator.actorId,
    });
    return reply.code(202).send(result);
  });

  app.post('/v1/orgs/:orgId/payments/circle/connection/complete', async (request) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'owner');
    const input = parseBody(circleConnectionCompleteSchema, request);
    return requireCircleConnectionService().complete({
      challengeId: input.challenge_id,
      orgId: params.orgId,
      otp: input.otp,
      userId: operator.userId ?? operator.actorId,
    });
  });

  app.delete('/v1/orgs/:orgId/payments/circle/connection', async (request) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'owner');
    return requireCircleConnectionService().disconnect({
      orgId: params.orgId,
      userId: operator.userId ?? operator.actorId,
    });
  });

  app.get('/v1/orgs/:orgId/payments/treasury/overview', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { overview: await getTreasuryOverview(deps.pool, params.orgId, providerForOrg(params.orgId), deps.redis) };
  });

  app.post('/v1/orgs/:orgId/payments/treasury', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const treasury = await createTreasury(deps.pool, operator, params.orgId, parseBody(treasurySchema, request));
    return reply.code(201).send({ treasury });
  });

  app.get('/v1/orgs/:orgId/payments/provider-mode', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { mode: await getOrgPaymentMode(deps.pool, params.orgId) };
  });

  app.put('/v1/orgs/:orgId/payments/provider-mode', async (request) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const body = parseBody(providerModeSchema, request);
    return { mode: await setOrgPaymentMode(deps.pool, operator, params.orgId, body.mode) };
  });

  app.get('/v1/orgs/:orgId/payments/provider-health', async (request) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'viewer');
    const mode = (await getOrgPaymentMode(deps.pool, params.orgId)).mode;
    if (circleConnectionService !== null) {
      const connection = await circleConnectionService.status({
        orgId: params.orgId,
        userId: operator.userId ?? operator.actorId,
      });
      return {
        health: {
          configured: connection.status === 'connected',
          missing: connection.status === 'connected' ? [] : ['circle_agent_wallet_connection'],
          mode,
          provider: 'circle',
        },
      };
    }
    if (deps.circleProvider === undefined && deps.circleProviderFactory === undefined) {
      throw new IdentityError(
        'circle_connection_not_configured',
        503,
        'Circle Agent Wallet worker is not configured.',
      );
    }
    return { health: providerForOrg(params.orgId).health(mode) };
  });

  app.get('/v1/orgs/:orgId/payments/capabilities', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    const mode = (await getOrgPaymentMode(deps.pool, params.orgId)).mode;
    return { capabilities: await listCircleChainCapabilities(deps.pool, mode) };
  });

  app.get('/v1/orgs/:orgId/payments/rail-readiness', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { rails: await listPaymentRailReadiness(deps.pool, params.orgId) };
  });

  app.post('/v1/orgs/:orgId/payments/rail-readiness/verify', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const jobs = await verifyPaymentRails(
      deps.pool,
      operator,
      params.orgId,
      parseBody(railVerificationBatchSchema, request),
      providerForOrg(params.orgId),
    );
    return reply.code(202).send({
      failed: jobs.filter((job) => job.status === 'failed' || job.status === 'blocked').length,
      jobs,
    });
  });

  app.post('/v1/orgs/:orgId/payments/rail-readiness/:rail/verify', async (request, reply) => {
    const params = request.params as { readonly orgId: string; readonly rail: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const job = await verifyPaymentRail(deps.pool, operator, params.orgId, params.rail, providerForOrg(params.orgId));
    return reply.code(job.status === 'failed' || job.status === 'blocked' ? 409 : 202).send({ job });
  });

  app.post('/v1/orgs/:orgId/payments/circle/treasury', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const result = await ensureCircleTreasury(
      deps.pool,
      operator,
      params.orgId,
      parseBody(circleTreasurySchema, request),
      providerForOrg(params.orgId),
    );
    return reply.code(201).send(result);
  });

  app.get('/v1/orgs/:orgId/payments/circle/wallets', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { wallets: await listCircleWallets(deps.pool, params.orgId) };
  });

  app.get('/v1/orgs/:orgId/payments/circle/balances', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { balances: await listCircleBalances(deps.pool, params.orgId, providerForOrg(params.orgId), deps.redis) };
  });

  app.get('/v1/orgs/:orgId/payments/console-snapshot', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return getPaymentsConsoleSnapshot(deps.pool, params.orgId, providerForOrg(params.orgId), deps.redis);
  });

  app.get('/v1/orgs/:orgId/payments/circle/jobs', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { jobs: await listCircleProviderJobs(deps.pool, params.orgId) };
  });

  app.post('/v1/orgs/:orgId/payments/circle/jobs/reconcile', async (request) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    return { jobs: await reconcileCircleProviderJobs(deps.pool, operator, params.orgId, providerForOrg(params.orgId)) };
  });

  app.get('/v1/orgs/:orgId/payments/liquidity-jobs', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { jobs: await listLiquidityJobs(deps.pool, params.orgId, 20, providerForOrg(params.orgId)) };
  });

  app.post('/v1/orgs/:orgId/payments/liquidity-jobs/:jobId/retry', async (request, reply) => {
    const params = request.params as { readonly orgId: string; readonly jobId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const job = await retryLiquidityJob(deps.pool, operator, params.orgId, params.jobId, providerForOrg(params.orgId));
    return reply.code(job.status === 'failed' ? 409 : 202).send({ job });
  });

  app.post('/v1/orgs/:orgId/payments/liquidity-jobs/:jobId/cancel', async (request) => {
    const params = request.params as { readonly orgId: string; readonly jobId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    return { job: await cancelLiquidityJob(deps.pool, operator, params.orgId, params.jobId) };
  });

  app.get('/v1/orgs/:orgId/payments/rebalance/recommendations', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { recommendations: await listRebalanceRecommendations(deps.pool, params.orgId, providerForOrg(params.orgId), deps.redis) };
  });

  app.post('/v1/orgs/:orgId/payments/rebalance/bridge-topup', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const job = await bridgeExactWalletTopUp(
      deps.pool,
      operator,
      params.orgId,
      parseBody(bridgeTopUpSchema, request),
      providerForOrg(params.orgId),
    );
    return reply.code(job.status === 'failed' ? 409 : 202).send({ job });
  });

  app.post('/v1/orgs/:orgId/payments/circle/gateway-deposits', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const job = await initiateCircleGatewayDeposit(
      deps.pool,
      operator,
      params.orgId,
      parseBody(gatewayDepositSchema, request),
      providerForOrg(params.orgId),
    );
    return reply.code(job.status === 'failed' ? 409 : 202).send({ job });
  });

  app.post('/v1/orgs/:orgId/payments/circle/testnet-faucet', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const jobs = await requestCircleTestnetFunds(
      deps.pool,
      operator,
      params.orgId,
      parseBody(testnetFaucetSchema, request),
      providerForOrg(params.orgId),
    );
    return reply.code(202).send({ jobs });
  });

  app.get('/v1/orgs/:orgId/payments/sources', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { sources: await listPaymentSources(deps.pool, params.orgId) };
  });

  app.post('/v1/orgs/:orgId/payments/sources', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const source = await createPaymentSource(deps.pool, operator, params.orgId, parseBody(paymentSourceSchema, request));
    return reply.code(201).send({ source });
  });

  app.get('/v1/orgs/:orgId/payments/events', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    const query = historyQuerySchema.parse(request.query ?? {});
    return { events: await listPaymentEvents(deps.pool, params.orgId, query.limit) };
  });

  app.get('/v1/orgs/:orgId/payments/route-observations', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    const query = historyQuerySchema.parse(request.query ?? {});
    return { observations: await listPaymentRouteObservations(deps.pool, params.orgId, query.limit) };
  });

  app.get('/v1/orgs/:orgId/payments/reservations', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    const query = historyQuerySchema.parse(request.query ?? {});
    return { reservations: await listPaymentReservations(deps.pool, params.orgId, query.limit) };
  });

  app.get('/v1/orgs/:orgId/payments/unknown-attempts', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    const query = historyQuerySchema.parse(request.query ?? {});
    return { attempts: await listUnknownAttempts(deps.pool, params.orgId, query.limit) };
  });

  app.post('/v1/orgs/:orgId/payments/unknown-attempts/:reservationId/resolve', async (request) => {
    const params = request.params as { readonly orgId: string; readonly reservationId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const body = parseBody(resolveUnknownAttemptSchema, request);
    await resolveUnknownAttempt(deps.pool, operator, params.orgId, params.reservationId, body.outcome);
    return { resolved: true };
  });

  app.get('/v1/orgs/:orgId/agents/:agentId/payments', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return getAgentPayments(deps.pool, params.orgId, params.agentId);
  });

  app.get('/v1/orgs/:orgId/payments/agent-accounts', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return listAgentPaymentAccounts(deps.pool, params.orgId);
  });

  app.post('/v1/orgs/:orgId/agents/:agentId/payment-access', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    return {
      account: await setAgentPaymentAccess(
        deps.pool,
        operator,
        params.orgId,
        params.agentId,
        parseBody(paymentAccessSchema, request),
      ),
    };
  });

  app.post('/v1/orgs/:orgId/agents/:agentId/revoke', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    // 'admin' rather than 'operator' -- this halts an agent's runtime auth
    // and sweeps its wallets, a higher bar than day-to-day payment access
    // changes, matching the bar Phase 1's org-level freeze already sets.
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const body = parseBody(revokeAgentSchema, request);
    const mode = (await getOrgPaymentMode(deps.pool, params.orgId)).mode;
    await revokeAgent(deps.pool, operator, params.orgId, params.agentId, mode, body.reason);
    return { revoked: true };
  });

  app.post('/v1/runtime/payments/x402', async (request) => {
    const auth = await authenticateRuntimeConnection(deps.pool, requiredRuntimeBearerToken(request));
    const input = parseBody(runtimeX402Schema, request);
    try {
      return await payRuntimeX402(
        deps.pool,
        auth,
        {
          idempotency_key: input.idempotency_key,
          request: {
            url: input.request.url,
            method: input.request.method,
            headers: input.request.headers,
            ...(input.request.body === undefined ? {} : { body: input.request.body }),
          },
        },
        providerForOrg(auth.org_id),
        {
          ...(deps.orchestrationHooks === undefined ? {} : { orchestrationHooks: deps.orchestrationHooks }),
          ...(deps.paidHttpExecution === undefined ? {} : { paidHttpExecution: deps.paidHttpExecution }),
          ...(deps.paidHttpExecutor === undefined ? {} : { paidHttpExecutor: deps.paidHttpExecutor }),
          ...(deps.paidHttpUrlPolicy === undefined ? {} : { paidHttpUrlPolicy: deps.paidHttpUrlPolicy }),
          resultCrypto: runtimeX402ResultCrypto(deps),
        },
      );
    } catch (error) {
      const publicError = paidHttpPublicError(error);
      if (publicError !== null) throw publicError;
      throw error;
    }
  });
}
