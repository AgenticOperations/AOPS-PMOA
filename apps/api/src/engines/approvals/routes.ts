import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { resolveSession } from '../auth/store.js';
import { IdentityError } from '../identity/errors.js';
import { getMembershipRole } from '../identity/store.js';
import { satisfiesRole } from '../identity/roles.js';
import type { OperatorContext, Role } from '../identity/types.js';
import { approveApproval, denyApproval, getApproval, listApprovals } from './store.js';

export type RegisterApprovalRoutesDeps = {
  readonly pool: pg.Pool;
  readonly installErrorHandler?: boolean | undefined;
  readonly sessionCookieName?: string | undefined;
  readonly resolveOperator?: ((request: FastifyRequest) => Promise<OperatorContext | null>) | undefined;
};

const approvalActionSchema = z.object({
  note: z.string().trim().max(1000).optional(),
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

async function requireOrgOperator(
  request: FastifyRequest,
  deps: RegisterApprovalRoutesDeps,
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

export function registerApprovalRoutes(app: FastifyInstance, deps: RegisterApprovalRoutesDeps): void {
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

  app.get('/v1/orgs/:orgId/approvals', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { approvals: await listApprovals(deps.pool, params.orgId) };
  });

  app.get('/v1/orgs/:orgId/approvals/:approvalId', async (request) => {
    const params = request.params as { readonly orgId: string; readonly approvalId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { approval: await getApproval(deps.pool, params.orgId, params.approvalId) };
  });

  app.post('/v1/orgs/:orgId/approvals/:approvalId/approve', async (request) => {
    const params = request.params as { readonly orgId: string; readonly approvalId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    const body = parseBody(approvalActionSchema, request);
    return {
      approval: await approveApproval(deps.pool, operator, params.orgId, params.approvalId, body.note ?? ''),
    };
  });

  app.post('/v1/orgs/:orgId/approvals/:approvalId/deny', async (request) => {
    const params = request.params as { readonly orgId: string; readonly approvalId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    const body = parseBody(approvalActionSchema, request);
    return {
      approval: await denyApproval(deps.pool, operator, params.orgId, params.approvalId, body.note ?? ''),
    };
  });
}
