import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { buildGoogleAuthorizeUrl, fetchGoogleProfile } from '../auth/google.js';
import { createSession, resolveSession, revokeSession, upsertGoogleUser } from '../auth/store.js';
import type { GoogleOAuthConfig, SessionContext } from '../auth/types.js';
import type { RegisterPolicyRoutesDeps } from '../policy/routes.js';
import { assertPolicyAllows } from '../policy/store.js';
import { IdentityError } from './errors.js';
import { satisfiesRole } from './roles.js';
import {
  archiveTeam,
  attachWalletRef,
  authenticateConnection,
  createAgent,
  createConnection,
  createOrg,
  createOrgForUser,
  createTeam,
  detachWalletRef,
  getAgentDetail,
  listAgentActivityFeed,
  getMembershipRole,
  getOrg,
  getOrgBySlugForUser,
  listAgents,
  listConnections,
  listOrgsForUser,
  listOrgs,
  listTeams,
  listWalletRefs,
  revokeConnection,
  rotateConnection,
  setAgentStatus,
  testConnection,
  updateAgent,
  updateTeam,
  type AttachWalletRefInput,
  type CreateAgentInput,
  type CreateConnectionInput,
  type CreateOrgInput,
  type CreateTeamInput,
  type UpdateAgentInput,
  type UpdateTeamInput,
} from './store.js';
import type { OperatorContext, Role } from './types.js';

export type RegisterIdentityRoutesDeps = {
  readonly pool: pg.Pool;
  readonly googleOAuth?: GoogleOAuthConfig | undefined;
  readonly policy?: RegisterPolicyRoutesDeps | undefined;
  readonly sessionCookieName?: string | undefined;
  readonly resolveOperator?: ((request: FastifyRequest) => Promise<OperatorContext | null>) | undefined;
};

const roleSchema = z.enum(['owner', 'admin', 'operator', 'auditor', 'viewer', 'member']);
const connectionKindSchema = z.enum([
  'agent_credential',
  'mcp_local',
  'mcp_remote',
  'mcp_http',
  'api_key',
  'sdk',
  'cli',
  'proxy',
  'manual_observe',
]);

const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(140).optional(),
  domain: z.string().trim().min(1).max(240).optional(),
  primary_use_case: z.string().trim().min(1).max(120).optional(),
  owner: z
    .object({
      email: z.string().email(),
      name: z.string().trim().min(1).max(120),
    })
    .optional(),
});

const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

const updateTeamSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
});

const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(160),
  team_id: z.string().trim().min(1).optional(),
  parent_agent_id: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().max(1000).optional(),
  labels: z.array(z.string().trim().min(1).max(48)).max(24).optional(),
  default_environment: z.string().trim().min(1).max(80).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateAgentSchema = createAgentSchema.partial();

const createConnectionSchema = z.object({
  kind: connectionKindSchema,
  name: z.string().trim().min(1).max(120),
});

const attachWalletRefSchema = z.object({
  provider: z.string().trim().min(1).max(120),
  external_wallet_id: z.string().trim().min(1).max(240).nullable().optional(),
  address: z.string().trim().min(1).max(240).nullable().optional(),
  chain: z.string().trim().min(1).max(120).nullable().optional(),
  label: z.string().trim().max(120).optional(),
});

const authCheckSchema = z.object({
  token: z.string().min(1),
});

const googleExchangeSchema = z.object({
  code: z.string().trim().min(1),
  redirect_uri: z.string().url(),
});

const googleAuthorizeUrlQuerySchema = z.object({
  state: z.string().trim().min(16).max(256),
  redirect_uri: z.string().url(),
});

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function extractBearerToken(request: FastifyRequest, sessionCookieName = 'agentops_session'): string | null {
  const header = request.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1] !== undefined && match[1].length > 0) return match[1];
  }

  const cookie = request.headers.cookie;
  if (typeof cookie !== 'string') return null;
  const parts = cookie.split(';').map((part) => part.trim());
  for (const part of parts) {
    const [key, ...rest] = part.split('=');
    if (key === sessionCookieName) return decodeURIComponent(rest.join('='));
  }
  return null;
}

async function optionalSession(
  request: FastifyRequest,
  deps: RegisterIdentityRoutesDeps,
): Promise<SessionContext | null> {
  const token = extractBearerToken(request, deps.sessionCookieName);
  if (token === null) return null;
  return resolveSession(deps.pool, token);
}

async function requireSession(
  request: FastifyRequest,
  deps: RegisterIdentityRoutesDeps,
): Promise<SessionContext> {
  const session = await optionalSession(request, deps);
  if (session === null) throw new IdentityError('unauthorized', 401, 'Human session is required.');
  return session;
}

async function requireOperator(
  request: FastifyRequest,
  deps: RegisterIdentityRoutesDeps,
  role: Role,
): Promise<OperatorContext> {
  const operator = deps.resolveOperator === undefined ? null : await deps.resolveOperator(request);
  if (operator === null) throw new IdentityError('unauthorized', 401, 'Operator context is required.');
  if (!roleSchema.safeParse(operator.role).success || !satisfiesRole(operator.role, role)) {
    throw new IdentityError('forbidden', 403, 'Operator role is not allowed for this action.');
  }
  return operator;
}

async function requireOrgOperator(
  request: FastifyRequest,
  deps: RegisterIdentityRoutesDeps,
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

  return requireOperator(request, deps, role);
}

function sendIdentityError(reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } }, error: IdentityError) {
  const body: Record<string, unknown> = {
    error: error.code,
    message: error.message,
  };
  if ('approvalId' in error && typeof error.approvalId === 'string') body.approvalId = error.approvalId;
  if ('decisionId' in error && typeof error.decisionId === 'string') body.decisionId = error.decisionId;
  if ('jobId' in error && typeof error.jobId === 'string') body.jobId = error.jobId;
  if ('rail' in error && typeof error.rail === 'string') body.rail = error.rail;
  if ('chain' in error && typeof error.chain === 'string') body.chain = error.chain;
  if ('retryAfterSeconds' in error && typeof error.retryAfterSeconds === 'number') {
    body.retryAfterSeconds = error.retryAfterSeconds;
  }
  return reply.code(error.statusCode).send(body);
}

function parseBody<T>(schema: z.ZodType<T>, request: FastifyRequest): T {
  return schema.parse(request.body);
}

async function requirePolicyAllow(
  deps: RegisterIdentityRoutesDeps,
  operator: OperatorContext,
  orgId: string,
  request: Parameters<typeof assertPolicyAllows>[3],
): Promise<void> {
  if (deps.policy === undefined) return;
  await assertPolicyAllows(deps.policy.pool, operator, orgId, request);
}

export function registerIdentityRoutes(app: FastifyInstance, deps: RegisterIdentityRoutesDeps): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof IdentityError) return sendIdentityError(reply, error);
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Request body is invalid.',
        issues: error.issues,
      });
    }
    throw error;
  });

  app.post('/v1/auth/google/exchange', async (request) => {
    if (deps.googleOAuth === undefined) {
      throw new IdentityError('auth_not_configured', 501, 'Google sign-in is not configured.');
    }
    const input = parseBody<{ readonly code: string; readonly redirect_uri: string }>(googleExchangeSchema, request);
    const profile = await fetchGoogleProfile(deps.googleOAuth, input.code, input.redirect_uri);
    const client = await deps.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await upsertGoogleUser(client, profile);
      const session = await createSession(client, user.id);
      await client.query('COMMIT');
      return {
        session_token: session.token,
        expires_at: session.expiresAt.toISOString(),
        user,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/v1/auth/google/authorize-url', (request) => {
    if (deps.googleOAuth === undefined) {
      throw new IdentityError('auth_not_configured', 501, 'Google sign-in is not configured.');
    }
    const query = googleAuthorizeUrlQuerySchema.parse(request.query);
    return {
      url: buildGoogleAuthorizeUrl(deps.googleOAuth, {
        redirectUri: query.redirect_uri,
        state: query.state,
      }),
    };
  });

  app.get('/v1/auth/me', async (request) => {
    const session = await requireSession(request, deps);
    return {
      user: session.user,
      orgs: await listOrgsForUser(deps.pool, session.user.id),
    };
  });

  app.post('/v1/auth/logout', async (request) => {
    const token = extractBearerToken(request, deps.sessionCookieName);
    if (token !== null) await revokeSession(deps.pool, token);
    return { ok: true };
  });

  app.get('/v1/orgs', async (request) => {
    const session = await optionalSession(request, deps);
    if (session !== null) return { orgs: await listOrgsForUser(deps.pool, session.user.id) };
    if (deps.resolveOperator !== undefined) return { orgs: await listOrgs(deps.pool) };
    throw new IdentityError('unauthorized', 401, 'Human session is required.');
  });

  app.post('/v1/orgs', async (request, reply) => {
    const session = await optionalSession(request, deps);
    const input = parseBody<CreateOrgInput>(createOrgSchema, request);
    if (session !== null) {
      const org = await createOrgForUser(
        deps.pool,
        {
          actorId: session.user.id,
          userId: session.user.id,
          role: 'owner',
        },
        input,
      );
      return reply.code(201).send({ org });
    }

    const operator = await requireOperator(request, deps, 'owner');
    const org = await createOrg(deps.pool, operator, input);
    return reply.code(201).send({ org });
  });

  app.get('/v1/orgs/by-slug/:slug', async (request) => {
    const session = await requireSession(request, deps);
    const params = request.params as { readonly slug: string };
    return { org: await getOrgBySlugForUser(deps.pool, params.slug, session.user.id) };
  });

  app.get('/v1/orgs/:orgId', async (request) => {
    await requireOrgOperator(request, deps, (request.params as { readonly orgId: string }).orgId, 'viewer');
    const params = request.params as { readonly orgId: string };
    return { org: await getOrg(deps.pool, params.orgId) };
  });

  app.get('/v1/orgs/:orgId/teams', async (request) => {
    await requireOrgOperator(request, deps, (request.params as { readonly orgId: string }).orgId, 'viewer');
    const params = request.params as { readonly orgId: string };
    return { teams: await listTeams(deps.pool, params.orgId) };
  });

  app.post('/v1/orgs/:orgId/teams', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const team = await createTeam(
      deps.pool,
      operator,
      params.orgId,
      parseBody<CreateTeamInput>(createTeamSchema, request),
    );
    return reply.code(201).send({ team });
  });

  app.patch('/v1/orgs/:orgId/teams/:teamId', async (request) => {
    const params = request.params as { readonly orgId: string; readonly teamId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const team = await updateTeam(
      deps.pool,
      operator,
      params.orgId,
      params.teamId,
      parseBody<UpdateTeamInput>(updateTeamSchema, request),
    );
    return { team };
  });

  app.post('/v1/orgs/:orgId/teams/:teamId/archive', async (request) => {
    const params = request.params as { readonly orgId: string; readonly teamId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    return { team: await archiveTeam(deps.pool, operator, params.orgId, params.teamId) };
  });

  app.get('/v1/orgs/:orgId/agents', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { agents: await listAgents(deps.pool, params.orgId) };
  });

  app.post('/v1/orgs/:orgId/agents', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    await requirePolicyAllow(deps, operator, params.orgId, {
      action: 'management.agent.create',
      target: { type: 'org', id: params.orgId },
      context: {},
    });
    const agent = await createAgent(
      deps.pool,
      operator,
      params.orgId,
      parseBody<CreateAgentInput>(createAgentSchema, request),
    );
    return reply.code(201).send({ agent });
  });

  app.get('/v1/orgs/:orgId/agents/:agentId', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return getAgentDetail(deps.pool, params.orgId, params.agentId);
  });

  app.get('/v1/orgs/:orgId/agents/:agentId/activity', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    const query = activityQuerySchema.parse(request.query ?? {});
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return listAgentActivityFeed(deps.pool, params.orgId, params.agentId, query.limit);
  });

  app.patch('/v1/orgs/:orgId/agents/:agentId', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    const agent = await updateAgent(
      deps.pool,
      operator,
      params.orgId,
      params.agentId,
      parseBody<UpdateAgentInput>(updateAgentSchema, request),
    );
    return { agent };
  });

  app.post('/v1/orgs/:orgId/agents/:agentId/pause', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    await requirePolicyAllow(deps, operator, params.orgId, {
      action: 'management.agent.pause',
      target: { type: 'agent', id: params.agentId },
      context: {},
    });
    return { agent: await setAgentStatus(deps.pool, operator, params.orgId, params.agentId, 'paused') };
  });

  app.post('/v1/orgs/:orgId/agents/:agentId/activate', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    await requirePolicyAllow(deps, operator, params.orgId, {
      action: 'management.agent.activate',
      target: { type: 'agent', id: params.agentId },
      context: {},
    });
    return { agent: await setAgentStatus(deps.pool, operator, params.orgId, params.agentId, 'active') };
  });

  app.post('/v1/orgs/:orgId/agents/:agentId/deactivate', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    await requirePolicyAllow(deps, operator, params.orgId, {
      action: 'management.agent.deactivate',
      target: { type: 'agent', id: params.agentId },
      context: {},
    });
    return { agent: await setAgentStatus(deps.pool, operator, params.orgId, params.agentId, 'deactivated') };
  });

  app.get('/v1/orgs/:orgId/agents/:agentId/connections', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { connections: await listConnections(deps.pool, params.orgId, params.agentId) };
  });

  app.post('/v1/orgs/:orgId/agents/:agentId/connections', async (request, reply) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    await requirePolicyAllow(deps, operator, params.orgId, {
      action: 'management.connection.issue',
      target: { type: 'agent', id: params.agentId },
      context: {},
    });
    const result = await createConnection(
      deps.pool,
      operator,
      params.orgId,
      params.agentId,
      parseBody<CreateConnectionInput>(createConnectionSchema, request),
    );
    return reply.code(201).send(result);
  });

  app.post('/v1/orgs/:orgId/connections/:connectionId/test', async (request) => {
    const params = request.params as { readonly orgId: string; readonly connectionId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    return { connection: await testConnection(deps.pool, operator, params.orgId, params.connectionId) };
  });

  app.post('/v1/orgs/:orgId/connections/:connectionId/rotate', async (request) => {
    const params = request.params as { readonly orgId: string; readonly connectionId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    await requirePolicyAllow(deps, operator, params.orgId, {
      action: 'management.connection.rotate',
      target: { type: 'connection', id: params.connectionId },
      context: {},
    });
    return rotateConnection(deps.pool, operator, params.orgId, params.connectionId);
  });

  app.post('/v1/orgs/:orgId/connections/:connectionId/revoke', async (request) => {
    const params = request.params as { readonly orgId: string; readonly connectionId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    await requirePolicyAllow(deps, operator, params.orgId, {
      action: 'management.connection.revoke',
      target: { type: 'connection', id: params.connectionId },
      context: {},
    });
    return { connection: await revokeConnection(deps.pool, operator, params.orgId, params.connectionId) };
  });

  app.post('/v1/connections/auth/check', async (request, reply) => {
    const input = parseBody<{ readonly token: string }>(authCheckSchema, request);
    const auth = await authenticateConnection(deps.pool, input.token);
    if (auth === null) {
      return reply.code(401).send({
        ok: false,
        error: 'invalid_connection',
      });
    }

    return {
      ok: true,
      org_id: auth.org_id,
      agent_id: auth.agent_id,
      connection_id: auth.connection_id,
    };
  });

  app.get('/v1/orgs/:orgId/agents/:agentId/wallet-refs', async (request) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return { wallet_refs: await listWalletRefs(deps.pool, params.orgId, params.agentId) };
  });

  app.post('/v1/orgs/:orgId/agents/:agentId/wallet-refs', async (request, reply) => {
    const params = request.params as { readonly orgId: string; readonly agentId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    const walletRef = await attachWalletRef(
      deps.pool,
      operator,
      params.orgId,
      params.agentId,
      parseBody<AttachWalletRefInput>(attachWalletRefSchema, request),
    );
    return reply.code(201).send({ wallet_ref: walletRef });
  });

  app.delete('/v1/orgs/:orgId/agents/:agentId/wallet-refs/:walletRefId', async (request) => {
    const params = request.params as {
      readonly orgId: string;
      readonly agentId: string;
      readonly walletRefId: string;
    };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'operator');
    return {
      wallet_ref: await detachWalletRef(
        deps.pool,
        operator,
        params.orgId,
        params.agentId,
        params.walletRefId,
      ),
    };
  });
}
