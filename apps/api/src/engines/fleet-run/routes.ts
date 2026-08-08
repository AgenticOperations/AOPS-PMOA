import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { resolveSession } from '../auth/store.js';
import { IdentityError } from '../identity/errors.js';
import { getMembershipRole } from '../identity/store.js';
import { satisfiesRole } from '../identity/roles.js';
import type { Role } from '../identity/types.js';
import type { CircleTreasuryProvider } from '../payments/circle-provider.js';
import { createFleetRun, getFleetRun, listFleetRuns } from './store.js';
import { resolveFleetAgents } from './resolve-agents.js';
import { executeFleetRun } from './executor.js';
import { buildCanonicalChecklist, CANONICAL_FLEET_GOAL } from './types.js';

export type RegisterFleetRunRoutesDeps = {
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
  deps: RegisterFleetRunRoutesDeps,
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

function providerForOrg(deps: RegisterFleetRunRoutesDeps, orgId: string): CircleTreasuryProvider {
  if (deps.circleProviderFactory !== undefined) return deps.circleProviderFactory(orgId);
  if (deps.circleProvider !== undefined) return deps.circleProvider;
  throw new IdentityError(
    'circle_provider_unavailable',
    503,
    'Circle worker / treasury provider is not configured for Fleet Run payments.',
  );
}

const createSchema = z.object({
  goal: z.string().trim().min(8).max(4000).optional(),
});

export function registerFleetRunRoutes(app: FastifyInstance, deps: RegisterFleetRunRoutesDeps): void {
  app.get('/v1/orgs/:orgId/fleet-runs/canonical-goal', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId);
    return { goal: CANONICAL_FLEET_GOAL, checklist: buildCanonicalChecklist() };
  });

  app.get('/v1/orgs/:orgId/fleet-runs', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId);
    return { runs: await listFleetRuns(deps.pool, params.orgId) };
  });

  app.get('/v1/orgs/:orgId/fleet-runs/:runId', async (request) => {
    const params = request.params as { readonly orgId: string; readonly runId: string };
    await requireOrgOperator(request, deps, params.orgId);
    try {
      return { run: await getFleetRun(deps.pool, params.orgId, params.runId) };
    } catch {
      throw new IdentityError('fleet_run_not_found', 404, 'Fleet Run was not found.');
    }
  });

  app.post('/v1/orgs/:orgId/fleet-runs', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId);
    const body = createSchema.parse(request.body ?? {});
    const goal = body.goal?.trim() || CANONICAL_FLEET_GOAL;
    const agents = await resolveFleetAgents(deps.pool, params.orgId);
    const checklist = buildCanonicalChecklist();
    const run = await createFleetRun(deps.pool, {
      orgId: params.orgId,
      goal,
      createdBy: operator.actorId,
      orchestratorAgentId: agents.orchestrator!.agentId,
      checklist,
      agents,
    });
    return reply.code(201).send({ run });
  });

  app.post('/v1/orgs/:orgId/fleet-runs/:runId/execute', async (request) => {
    const params = request.params as { readonly orgId: string; readonly runId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId);
    const run = await executeFleetRun(deps.pool, providerForOrg(deps, params.orgId), {
      orgId: params.orgId,
      runId: params.runId,
      actorId: operator.actorId,
    });
    return { run };
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
