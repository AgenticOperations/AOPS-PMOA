import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import {
  getAuditEvent,
  listAuditEvents,
  type ListAuditEventsParams,
  verifyAuditChain,
  verifyAuditEvent,
} from './audit-query.js';

export type EvidenceOrgScope = {
  readonly orgId: string;
};

export type RegisterEvidenceRoutesDeps = {
  readonly pool: pg.Pool;
  readonly resolveOrgScope: (request: FastifyRequest) => Promise<EvidenceOrgScope | null>;
};

function parseLimit(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readListParams(query: { readonly limit?: string; readonly beforeSequence?: string }): ListAuditEventsParams {
  const params: { limit?: number; beforeSequence?: number } = {};
  const limit = parseLimit(query.limit);
  const beforeSequence = parseLimit(query.beforeSequence);
  if (limit !== undefined) params.limit = limit;
  if (beforeSequence !== undefined) params.beforeSequence = beforeSequence;
  return params;
}

async function requireScope(
  request: FastifyRequest,
  deps: RegisterEvidenceRoutesDeps,
): Promise<EvidenceOrgScope | null> {
  return deps.resolveOrgScope(request);
}

export function registerEvidenceRoutes(
  app: FastifyInstance,
  deps: RegisterEvidenceRoutesDeps,
): void {
  app.get('/v1/evidence/events', async (request, reply) => {
    const scope = await requireScope(request, deps);
    if (scope === null) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Evidence scope is required.',
      });
    }

    const query = request.query as { readonly limit?: string; readonly beforeSequence?: string };
    return listAuditEvents(deps.pool, scope.orgId, readListParams(query));
  });

  app.get('/v1/evidence/events/:eventId', async (request, reply) => {
    const scope = await requireScope(request, deps);
    if (scope === null) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Evidence scope is required.',
      });
    }

    const params = request.params as { readonly eventId: string };
    const event = await getAuditEvent(deps.pool, scope.orgId, params.eventId);
    if (event === null) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'Audit event was not found.',
      });
    }

    return { event };
  });

  app.get('/v1/evidence/events/:eventId/verify', async (request, reply) => {
    const scope = await requireScope(request, deps);
    if (scope === null) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Evidence scope is required.',
      });
    }

    const params = request.params as { readonly eventId: string };
    return verifyAuditEvent(deps.pool, scope.orgId, params.eventId);
  });

  app.get('/v1/evidence/chain/verify', async (request, reply) => {
    const scope = await requireScope(request, deps);
    if (scope === null) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Evidence scope is required.',
      });
    }

    const query = request.query as { readonly limit?: string };
    return verifyAuditChain(deps.pool, scope.orgId, readListParams(query));
  });
}
