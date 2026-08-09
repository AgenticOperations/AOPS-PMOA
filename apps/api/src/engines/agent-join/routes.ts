import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { IdentityError } from '../identity/errors.js';
import {
  createAgentJoinInvite,
  listAgentJoinInvites,
  openRegisterAgent,
  readOpenJoinConfig,
  redeemAgentJoinInvite,
  revokeAgentJoinInvite,
  type OpenJoinConfig,
} from './store.js';
import type { OperatorContext, Role } from '../identity/types.js';
import { getMembershipRole } from '../identity/store.js';
import { satisfiesRole } from '../identity/roles.js';
import { resolveSession } from '../auth/store.js';

export type RegisterAgentJoinRoutesDeps = {
  readonly pool: pg.Pool;
  readonly sessionCookieName?: string | undefined;
  readonly openJoin?: OpenJoinConfig | undefined;
  readonly resolveOperator?: ((request: FastifyRequest) => Promise<OperatorContext | null>) | undefined;
  readonly installErrorHandler?: boolean | undefined;
};

const roleSchema = z.enum(['owner', 'admin', 'operator', 'auditor', 'viewer', 'member']);

const createInviteSchema = z.object({
  label: z.string().trim().max(120).optional(),
  max_uses: z.number().int().min(1).max(10000).optional(),
  expires_in_hours: z.number().int().min(1).max(24 * 90).optional(),
});

const redeemSchema = z.object({
  token: z.string().trim().min(16).max(200),
  agent_name: z.string().trim().min(1).max(120).optional(),
});

const openRegisterSchema = z.object({
  agent_name: z.string().trim().min(1).max(120).optional(),
});

function parseBody<T>(schema: z.ZodType<T>, request: FastifyRequest): T {
  return schema.parse(request.body ?? {});
}

function clientFingerprint(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const ip =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim() ?? ''
      : Array.isArray(forwarded)
        ? forwarded[0] ?? ''
        : request.ip;
  const ua = typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '';
  return `${ip}|${ua}`.slice(0, 128);
}

async function optionalSession(request: FastifyRequest, deps: RegisterAgentJoinRoutesDeps) {
  const cookieName = deps.sessionCookieName ?? 'agentops_session';
  const header = request.headers.authorization;
  let token: string | null = null;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    token = match?.[1] ?? null;
  }
  if (token === null) {
    const cookie = request.headers.cookie;
    if (typeof cookie === 'string') {
      for (const part of cookie.split(';').map((item) => item.trim())) {
        const [key, ...rest] = part.split('=');
        if (key === cookieName) {
          token = decodeURIComponent(rest.join('='));
          break;
        }
      }
    }
  }
  if (token === null || token.length === 0) return null;
  return resolveSession(deps.pool, token);
}

async function requireOrgOperator(
  request: FastifyRequest,
  deps: RegisterAgentJoinRoutesDeps,
  orgId: string,
  role: Role,
): Promise<OperatorContext> {
  const session = await optionalSession(request, deps);
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

  const operator = deps.resolveOperator === undefined ? null : await deps.resolveOperator(request);
  if (operator === null) throw new IdentityError('unauthorized', 401, 'Operator context is required.');
  if (!roleSchema.safeParse(operator.role).success || !satisfiesRole(operator.role, role)) {
    throw new IdentityError('forbidden', 403, 'Operator role is not allowed for this action.');
  }
  return { ...operator, orgId };
}

export function registerAgentJoinRoutes(app: FastifyInstance, deps: RegisterAgentJoinRoutesDeps): void {
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

  app.post('/v1/orgs/:orgId/agent-join/invites', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    const body = parseBody(createInviteSchema, request);
    const created = await createAgentJoinInvite(deps.pool, operator, params.orgId, body);
    return reply.code(201).send(created);
  });

  app.get('/v1/orgs/:orgId/agent-join/invites', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { invites: await listAgentJoinInvites(deps.pool, params.orgId) };
  });

  app.post('/v1/orgs/:orgId/agent-join/invites/:inviteId/revoke', async (request) => {
    const params = request.params as { readonly orgId: string; readonly inviteId: string };
    await requireOrgOperator(request, deps, params.orgId, 'operator');
    return { invite: await revokeAgentJoinInvite(deps.pool, params.orgId, params.inviteId) };
  });

  /** Public — redeem a human-issued invite token into MCP URL + credential (payment off). */
  app.post('/v1/agent-join/invite/redeem', async (request, reply) => {
    const body = parseBody(redeemSchema, request);
    const joined = await redeemAgentJoinInvite(deps.pool, body);
    return reply.code(201).send({ join: joined });
  });

  /** Public — open cold register when AGENT_OPEN_JOIN_* env is enabled (hard caps). */
  app.post('/v1/agent-join/open', async (request, reply) => {
    const body = parseBody(openRegisterSchema, request);
    const joined = await openRegisterAgent(
      deps.pool,
      {
        agent_name: body.agent_name,
        client_fingerprint: clientFingerprint(request),
      },
      deps.openJoin ?? readOpenJoinConfig(),
    );
    return reply.code(201).send({ join: joined });
  });

  app.get('/v1/agent-join/open/status', async () => {
    const config = deps.openJoin ?? readOpenJoinConfig();
    return {
      open_join: {
        enabled: config.enabled && config.orgId.length > 0,
        org_configured: config.orgId.length > 0,
        max_per_hour: config.maxPerFingerprintPerHour,
        max_per_day: config.maxPerOrgPerDay,
      },
    };
  });
}
