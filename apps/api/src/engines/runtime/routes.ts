import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { consumeApproval, getApproval, recordActivity } from '../approvals/store.js';
import { IdentityError } from '../identity/errors.js';
import { authenticateRuntimeConnection, checkRuntimePolicy, onboardRuntime } from './store.js';

export type RegisterRuntimeRoutesDeps = {
  readonly pool: pg.Pool;
  readonly installErrorHandler?: boolean | undefined;
};

const runtimeCheckSchema = z.object({
  intent: z.string().trim().min(1).max(2000).optional(),
  action: z.string().trim().min(1).max(160).optional(),
  resource: z.record(z.string(), z.unknown()).optional(),
  payment: z.record(z.string(), z.unknown()).optional(),
  tool: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const consumeApprovalSchema = z.object({
  decision_id: z.string().trim().min(1),
});

const activitySchema = z.object({
  summary: z.string().trim().min(1).max(500),
  payload: z.record(z.string(), z.unknown()).optional(),
});

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (typeof header !== 'string') throw new IdentityError('invalid_connection', 401, 'Connection credential is required.');
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match?.[1] === undefined || match[1].length === 0) {
    throw new IdentityError('invalid_connection', 401, 'Connection credential is required.');
  }
  return match[1];
}

function parseBody<T>(schema: z.ZodType<T>, request: FastifyRequest): T {
  return schema.parse(request.body ?? {});
}

export function registerRuntimeRoutes(app: FastifyInstance, deps: RegisterRuntimeRoutesDeps): void {
  if (deps.installErrorHandler === true) {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof IdentityError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'validation_error', message: 'Request body is invalid.', issues: error.issues });
      }
      throw error;
    });
  }

  app.post('/v1/runtime/onboard', async (request) => {
    const auth = await authenticateRuntimeConnection(deps.pool, bearerToken(request));
    return onboardRuntime(deps.pool, auth);
  });

  app.post('/v1/runtime/check', async (request) => {
    const auth = await authenticateRuntimeConnection(deps.pool, bearerToken(request));
    return { decision: await checkRuntimePolicy(deps.pool, auth, parseBody(runtimeCheckSchema, request)) };
  });

  app.post('/v1/runtime/activity', async (request) => {
    const auth = await authenticateRuntimeConnection(deps.pool, bearerToken(request));
    const body = parseBody(activitySchema, request);
    return {
      activity: await recordActivity(deps.pool, {
        orgId: auth.org_id,
        agentId: auth.agent_id,
        connectionId: auth.connection_id,
        category: 'integration',
        action: 'mcp.activity_recorded',
        outcome: 'success',
        summary: body.summary,
        payload: body.payload ?? {},
      }),
    };
  });

  app.get('/v1/runtime/approvals/:approvalId', async (request) => {
    const params = request.params as { readonly approvalId: string };
    const auth = await authenticateRuntimeConnection(deps.pool, bearerToken(request));
    const approval = await getApproval(deps.pool, auth.org_id, params.approvalId);
    if (approval.agent_id !== auth.agent_id || approval.connection_id !== auth.connection_id) {
      throw new IdentityError('forbidden', 403, 'Approval does not belong to this agent connection.');
    }
    return { approval };
  });

  app.post('/v1/runtime/approvals/:approvalId/consume', async (request) => {
    const params = request.params as { readonly approvalId: string };
    const auth = await authenticateRuntimeConnection(deps.pool, bearerToken(request));
    const body = parseBody(consumeApprovalSchema, request);
    return { approval: await consumeApproval(deps.pool, auth, params.approvalId, body.decision_id) };
  });
}
