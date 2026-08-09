import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { resolveSession } from '../auth/store.js';
import { IdentityError } from '../identity/errors.js';
import { getMembershipRole } from '../identity/store.js';
import { satisfiesRole } from '../identity/roles.js';
import type { Role } from '../identity/types.js';
import type { CircleTreasuryProvider } from '../payments/circle-provider.js';
import { handleAgentChatTurn } from './handler.js';
import { toPlainText } from './gemini.js';

export type RegisterAgentChatRoutesDeps = {
  readonly pool: pg.Pool;
  readonly sessionCookieName?: string | undefined;
  readonly circleProviderFactory?: ((orgId: string) => CircleTreasuryProvider) | undefined;
  readonly circleProvider?: CircleTreasuryProvider | undefined;
  readonly installErrorHandler?: boolean | undefined;
};

type OperatorContext = {
  readonly actorId: string;
  readonly userId: string;
  readonly orgId: string;
  readonly role: Role;
};

function extractBearerToken(request: FastifyRequest, sessionCookieName: string | undefined): string | null {
  const header = request.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1];
  }
  if (sessionCookieName !== undefined) {
    const raw = request.headers.cookie;
    if (typeof raw === 'string') {
      const parts = raw.split(';');
      for (const part of parts) {
        const [key, ...rest] = part.trim().split('=');
        if (key === sessionCookieName) return decodeURIComponent(rest.join('='));
      }
    }
  }
  return null;
}

async function requireOrgOperator(
  request: FastifyRequest,
  deps: RegisterAgentChatRoutesDeps,
  orgId: string,
): Promise<OperatorContext> {
  const token = extractBearerToken(request, deps.sessionCookieName);
  if (token === null) throw new IdentityError('unauthorized', 401, 'Operator context is required.');
  const session = await resolveSession(deps.pool, token);
  if (session === null) throw new IdentityError('unauthorized', 401, 'Operator context is required.');
  const membershipRole = await getMembershipRole(deps.pool, orgId, session.user.id);
  if (membershipRole === null) throw new IdentityError('not_found', 404, 'Workspace was not found.');
  if (!satisfiesRole(membershipRole, 'operator')) {
    throw new IdentityError('forbidden', 403, 'Operator role is not allowed for this action.');
  }
  return {
    actorId: session.user.id,
    userId: session.user.id,
    orgId,
    role: membershipRole,
  };
}

function providerForOrg(deps: RegisterAgentChatRoutesDeps, orgId: string): CircleTreasuryProvider {
  if (deps.circleProviderFactory !== undefined) return deps.circleProviderFactory(orgId);
  if (deps.circleProvider !== undefined) return deps.circleProvider;
  throw new IdentityError(
    'circle_provider_unavailable',
    503,
    'Circle worker / treasury provider is not configured for agent chat.',
  );
}

const proposedAgentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  role: z.string().trim().max(80).optional(),
});

const pendingSchema = z
  .object({
    kind: z.enum(['create_agents', 'run_fleet', 'after_create']),
    agents: z.array(proposedAgentSchema).min(1).max(20),
    goal: z.string().trim().max(4000).optional(),
    createdNames: z.array(z.string()).optional(),
  })
  .nullable()
  .optional();

const turnSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  orgSlug: z.string().trim().min(1).max(80),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(8000),
      }),
    )
    .max(24)
    .optional(),
  pending: pendingSchema,
  confirmId: z.string().trim().max(64).nullable().optional(),
});

export function registerAgentChatRoutes(app: FastifyInstance, deps: RegisterAgentChatRoutesDeps): void {
  app.post('/v1/orgs/:orgId/agent-chat/turn', async (request) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId);
    const body = turnSchema.parse(request.body ?? {});
    const turn = await handleAgentChatTurn(deps.pool, providerForOrg(deps, params.orgId), operator, params.orgId, {
      message: body.message,
      orgSlug: body.orgSlug,
      history: body.history,
      pending: body.pending ?? null,
      confirmId: body.confirmId ?? null,
    });
    return { turn: { ...turn, reply: toPlainText(turn.reply) } };
  });

  if (deps.installErrorHandler === true) {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof IdentityError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'invalid_body', message: error.message });
      }
      reply.log.error(error);
      return reply.code(500).send({ error: 'internal_error', message: 'Unexpected error.' });
    });
  }
}
