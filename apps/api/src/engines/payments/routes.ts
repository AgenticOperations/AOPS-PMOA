import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
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
  listCircleBalances,
  listPaymentSources,
  listPaymentEvents,
  listCircleChainCapabilities,
  listCircleProviderJobs,
  reconcileCircleProviderJobs,
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
  requestCircleTestnetFunds,
  retryLiquidityJob,
  setOrgPaymentMode,
  setAgentPaymentAccess,
  verifyPaymentRails,
  verifyPaymentRail,
} from './store.js';
import { createCircleTreasuryProvider, type CircleTreasuryProvider } from './circle-provider.js';

export type RegisterPaymentRoutesDeps = {
  readonly pool: pg.Pool;
  readonly installErrorHandler?: boolean | undefined;
  readonly sessionCookieName?: string | undefined;
  readonly resolveOperator?: ((request: FastifyRequest) => Promise<OperatorContext | null>) | undefined;
  readonly circleProvider?: CircleTreasuryProvider | undefined;
};

const modeSchema = z.enum(['test', 'live']);
const chainSchema = z.enum(['base', 'arbitrum', 'polygon', 'optimism', 'avalanche']);
const railSchema = z.enum([
  'gateway_base',
  'gateway_arbitrum',
  'gateway_polygon',
  'gateway_optimism',
  'gateway_avalanche',
  'exact_base',
  'exact_arbitrum',
  'exact_polygon',
  'exact_optimism',
  'exact_avalanche',
]);
const sourceTypeSchema = z.enum(['gateway', 'direct_exact', 'dedicated_wallet']);
const providerSchema = z.enum(['circle_gateway', 'circle_wallets', 'manual', 'simulation']);
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
  simulated_balance_usdc: moneySchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const paymentAccessSchema = z.object({
  status: z.enum(['active', 'disabled']),
  allowed_rails: z.array(railSchema).max(8).default([]),
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

const runtimeAcceptSchema = z.object({
  scheme: z.string().trim().min(1).max(80),
  network: z.string().trim().min(1).max(80),
  asset: z.string().trim().min(1).max(80).optional(),
  amount: z.union([z.string().trim().min(1).max(80), z.number()]).optional(),
  maxAmountRequired: z.union([z.string().trim().min(1).max(80), z.number()]).optional(),
  payTo: z.string().trim().min(1).max(240).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

const runtimeX402Schema = z.object({
  resource: z.record(z.string(), z.unknown()).optional(),
  accepts: z.array(runtimeAcceptSchema).min(1).max(20),
  context: z.record(z.string(), z.unknown()).optional(),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(100),
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

export function registerPaymentRoutes(app: FastifyInstance, deps: RegisterPaymentRoutesDeps): void {
  const circleProvider = deps.circleProvider ?? createCircleTreasuryProvider();

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

  app.get('/v1/orgs/:orgId/payments/treasury/overview', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { overview: await getTreasuryOverview(deps.pool, params.orgId, circleProvider) };
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
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    const mode = (await getOrgPaymentMode(deps.pool, params.orgId)).mode;
    return { health: circleProvider.health(mode) };
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
      circleProvider,
    );
    return reply.code(202).send({
      failed: jobs.filter((job) => job.status === 'failed' || job.status === 'blocked').length,
      jobs,
    });
  });

  app.post('/v1/orgs/:orgId/payments/rail-readiness/:rail/verify', async (request, reply) => {
    const params = request.params as { readonly orgId: string; readonly rail: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const job = await verifyPaymentRail(deps.pool, operator, params.orgId, params.rail, circleProvider);
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
      circleProvider,
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
    return { balances: await listCircleBalances(deps.pool, params.orgId, circleProvider) };
  });

  app.get('/v1/orgs/:orgId/payments/console-snapshot', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return getPaymentsConsoleSnapshot(deps.pool, params.orgId, circleProvider);
  });

  app.get('/v1/orgs/:orgId/payments/circle/jobs', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { jobs: await listCircleProviderJobs(deps.pool, params.orgId) };
  });

  app.post('/v1/orgs/:orgId/payments/circle/jobs/reconcile', async (request) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    return { jobs: await reconcileCircleProviderJobs(deps.pool, operator, params.orgId, circleProvider) };
  });

  app.get('/v1/orgs/:orgId/payments/liquidity-jobs', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { jobs: await listLiquidityJobs(deps.pool, params.orgId, 20, circleProvider) };
  });

  app.post('/v1/orgs/:orgId/payments/liquidity-jobs/:jobId/retry', async (request, reply) => {
    const params = request.params as { readonly orgId: string; readonly jobId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const job = await retryLiquidityJob(deps.pool, operator, params.orgId, params.jobId, circleProvider);
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
    return { recommendations: await listRebalanceRecommendations(deps.pool, params.orgId, circleProvider) };
  });

  app.post('/v1/orgs/:orgId/payments/rebalance/bridge-topup', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const job = await bridgeExactWalletTopUp(
      deps.pool,
      operator,
      params.orgId,
      parseBody(bridgeTopUpSchema, request),
      circleProvider,
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
      circleProvider,
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
      circleProvider,
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

  app.get('/v1/orgs/:orgId/agents/:agentId/payments', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return getAgentPayments(deps.pool, params.orgId, params.agentId);
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

  app.post('/v1/runtime/payments/x402', async (request) => {
    const auth = await authenticateRuntimeConnection(deps.pool, requiredRuntimeBearerToken(request));
    return { payment: await payRuntimeX402(deps.pool, auth, parseBody(runtimeX402Schema, request), circleProvider) };
  });
}
