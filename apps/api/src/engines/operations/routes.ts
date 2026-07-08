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
  checkOperation,
  checkRuntimeOperation,
  createRateLimit,
  importTools,
  listAgentAllowedActions,
  listBlockedOperations,
  listTools,
  recordOperation,
  recordRuntimeOperation,
} from './store.js';

export type RegisterOperationRoutesDeps = {
  readonly pool: pg.Pool;
  readonly installErrorHandler?: boolean | undefined;
  readonly sessionCookieName?: string | undefined;
  readonly resolveOperator?: ((request: FastifyRequest) => Promise<OperatorContext | null>) | undefined;
};

const operationalActionSchema = z.enum(['runtime.http.request', 'tool.call']);
const toolRiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

const importToolsSchema = z.object({
  tools: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        display_name: z.string().trim().min(1).max(160).optional(),
        category: z.string().trim().min(1).max(80).optional(),
        risk_level: toolRiskLevelSchema.optional(),
        description: z.string().trim().max(1000).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(100),
});

const operationCheckSchema = z.object({
  agent_id: z.string().trim().min(1),
  connection_id: z.string().trim().min(1).nullable().optional(),
  action: operationalActionSchema,
  resource: z.record(z.string(), z.unknown()).optional(),
  tool: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const runtimeOperationCheckSchema = operationCheckSchema.omit({ agent_id: true, connection_id: true });

const operationRecordSchema = operationCheckSchema.extend({
  summary: z.string().trim().min(1).max(500),
  outcome: z.enum(['success', 'denied', 'pending', 'error']).optional(),
});

const runtimeOperationRecordSchema = operationRecordSchema.omit({ agent_id: true, connection_id: true });

const rateLimitSchema = z.object({
  target_type: z.enum(['org', 'team', 'agent', 'connection']),
  target_id: z.string().trim().min(1).max(240),
  action: operationalActionSchema,
  bucket: z.string().trim().min(1).max(240).optional(),
  limit: z.number().int().positive().max(100_000),
  window_seconds: z.number().int().positive().max(86_400),
});

const blockedQuerySchema = z.object({
  agent_id: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
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

function requiredBearerToken(request: FastifyRequest): string {
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
  deps: RegisterOperationRoutesDeps,
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

export function registerOperationRoutes(app: FastifyInstance, deps: RegisterOperationRoutesDeps): void {
  if (deps.installErrorHandler === true) {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof IdentityError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'validation_error',
          message: 'Request body is invalid.',
          issues: error.issues,
        });
      }
      throw error;
    });
  }

  app.get('/v1/orgs/:orgId/tools', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { tools: await listTools(deps.pool, params.orgId) };
  });

  app.post('/v1/orgs/:orgId/tools/import', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    const body = parseBody(importToolsSchema, request);
    const tools = await importTools(deps.pool, operator, params.orgId, body.tools);
    return reply.code(201).send({ tools });
  });

  app.post('/v1/orgs/:orgId/operations/check', async (request) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { operation: await checkOperation(deps.pool, operator, params.orgId, parseBody(operationCheckSchema, request)) };
  });

  app.post('/v1/orgs/:orgId/operations/record', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'operator');
    return recordOperation(deps.pool, params.orgId, parseBody(operationRecordSchema, request));
  });

  app.get('/v1/orgs/:orgId/operations/blocked', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    const query = blockedQuerySchema.parse(request.query ?? {});
    return { blocked: await listBlockedOperations(deps.pool, params.orgId, { agentId: query.agent_id, limit: query.limit }) };
  });

  app.post('/v1/orgs/:orgId/operations/rate-limits', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const rateLimit = await createRateLimit(deps.pool, operator, params.orgId, parseBody(rateLimitSchema, request));
    return reply.code(201).send({ rate_limit: rateLimit });
  });

  app.get('/v1/orgs/:orgId/agents/:agentId/allowed-actions', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { actions: await listAgentAllowedActions(deps.pool, params.orgId, params.agentId) };
  });

  app.post('/v1/runtime/operations/check', async (request) => {
    const auth = await authenticateRuntimeConnection(deps.pool, requiredBearerToken(request));
    return { operation: await checkRuntimeOperation(deps.pool, auth, parseBody(runtimeOperationCheckSchema, request)) };
  });

  app.post('/v1/runtime/operations/record', async (request) => {
    const auth = await authenticateRuntimeConnection(deps.pool, requiredBearerToken(request));
    return recordRuntimeOperation(deps.pool, auth, parseBody(runtimeOperationRecordSchema, request));
  });
}
