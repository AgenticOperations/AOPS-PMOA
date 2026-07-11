import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { resolveSession } from '../auth/store.js';
import { IdentityError } from '../identity/errors.js';
import { getMembershipRole } from '../identity/store.js';
import type { OperatorContext, Role } from '../identity/types.js';
import { satisfiesRole } from '../identity/roles.js';
import {
  activatePolicyDraft,
  archivePolicy,
  bindPolicy,
  checkPolicyDecision,
  createPolicyVersion,
  createPolicyDraft,
  discardPolicyDraft,
  listAgentEffectivePolicies,
  listPolicyDecisions,
  listPolicyActions,
  listPolicyLibrary,
  listPolicySimulations,
  removePolicyBinding,
  simulatePolicyDraft,
  updatePolicyDraft,
  validatePolicyDraft,
} from './store.js';
import type { PolicyDecisionRequest } from './types.js';

export type RegisterPolicyRoutesDeps = {
  readonly pool: pg.Pool;
  readonly installErrorHandler?: boolean | undefined;
  readonly sessionCookieName?: string | undefined;
  readonly resolveOperator?: ((request: FastifyRequest) => Promise<OperatorContext | null>) | undefined;
};

const roleSchema = z.enum(['owner', 'admin', 'operator', 'auditor', 'viewer', 'member']);
const policyTargetTypeSchema = z.enum(['org', 'team', 'agent', 'connection']);

const policyStatementSchema = z.object({
  id: z.string().trim().min(1).max(120),
  decision: z.enum(['allow', 'deny', 'approval_required', 'observe']),
  actions: z.array(z.string().trim().min(1).max(160)).min(1).max(32),
  actor: z
    .object({
      roles: z.array(roleSchema).min(1).max(8).optional(),
    })
    .optional(),
  target: z
    .object({
      types: z.array(policyTargetTypeSchema).min(1).max(4).optional(),
      ids: z.array(z.string().trim().min(1).max(240)).max(100).optional(),
    })
    .optional(),
  conditions: z
    .object({
      resource: z
        .object({
          categories: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
          domains: z.array(z.string().trim().min(1).max(240)).max(100).optional(),
        })
        .optional(),
      payment: z
        .object({
          minAmount: z.string().trim().min(1).max(80).optional(),
          maxAmount: z.string().trim().min(1).max(80).optional(),
          assets: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
          networks: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
          recipients: z.array(z.string().trim().min(1).max(240)).max(100).optional(),
        })
        .optional(),
      tool: z
        .object({
          names: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
          riskLevels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
        })
        .optional(),
    })
    .optional(),
  audit: z.enum(['standard', 'detailed']),
});

const createDraftSchema = z.object({
  source: z.enum(['preset', 'blank', 'request', 'structured']),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  category: z.enum(['management', 'operational', 'capability']),
  statements: z.array(policyStatementSchema).min(1).max(64),
});

const updateDraftSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(1000).optional(),
  category: z.enum(['management', 'operational', 'capability']).optional(),
  statements: z.array(policyStatementSchema).min(1).max(64).optional(),
});

const activateDraftSchema = z.object({
  change_reason: z.string().trim().max(500).optional(),
});

const createPolicyVersionSchema = updateDraftSchema.extend({
  change_reason: z.string().trim().max(500).optional(),
});

const bindPolicySchema = z.object({
  policy_version: z.number().int().positive(),
  target_type: policyTargetTypeSchema,
  target_id: z.string().trim().min(1).max(240),
});

const decisionCheckSchema = z.object({
  actor: z.object({
    type: z.enum(['user', 'agent', 'connection', 'system']),
    id: z.string().trim().min(1).optional(),
    role: roleSchema.optional(),
  }),
  action: z.string().trim().min(1).max(160),
  target: z.object({
    type: policyTargetTypeSchema,
    id: z.string().trim().min(1).max(240).optional(),
  }),
  context: z.record(z.string(), z.unknown()).default({}),
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
  deps: RegisterPolicyRoutesDeps,
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

export function registerPolicyRoutes(app: FastifyInstance, deps: RegisterPolicyRoutesDeps): void {
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

  app.get('/v1/orgs/:orgId/policies', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return listPolicyLibrary(deps.pool, params.orgId);
  });

  app.get('/v1/orgs/:orgId/policy-actions', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return listPolicyActions(deps.pool);
  });

  app.get('/v1/orgs/:orgId/policy-simulations', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return listPolicySimulations(deps.pool, params.orgId);
  });

  app.get('/v1/orgs/:orgId/policy-decisions', async (request) => {
    const params = request.params as { readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return listPolicyDecisions(deps.pool, params.orgId);
  });

  app.get('/v1/orgs/:orgId/agents/:agentId/policies', async (request) => {
    const params = request.params as { readonly agentId: string; readonly orgId: string };
    await requireOrgOperator(request, deps, params.orgId, 'viewer');
    return listAgentEffectivePolicies(deps.pool, params.orgId, params.agentId);
  });

  app.post('/v1/orgs/:orgId/policy-drafts', async (request, reply) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const draft = await createPolicyDraft(deps.pool, operator, params.orgId, parseBody(createDraftSchema, request));
    return reply.code(201).send({ draft });
  });

  app.patch('/v1/orgs/:orgId/policy-drafts/:draftId', async (request) => {
    const params = request.params as { readonly orgId: string; readonly draftId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const draft = await updatePolicyDraft(
      deps.pool,
      operator,
      params.orgId,
      params.draftId,
      parseBody(updateDraftSchema, request),
    );
    return { draft };
  });

  app.post('/v1/orgs/:orgId/policy-drafts/:draftId/discard', async (request) => {
    const params = request.params as { readonly orgId: string; readonly draftId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    return { draft: await discardPolicyDraft(deps.pool, operator, params.orgId, params.draftId) };
  });

  app.post('/v1/orgs/:orgId/policy-drafts/:draftId/validate', async (request) => {
    const params = request.params as { readonly orgId: string; readonly draftId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    return validatePolicyDraft(deps.pool, operator, params.orgId, params.draftId);
  });

  app.post('/v1/orgs/:orgId/policy-drafts/:draftId/simulations', async (request, reply) => {
    const params = request.params as { readonly orgId: string; readonly draftId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const simulation = await simulatePolicyDraft(
      deps.pool,
      operator,
      params.orgId,
      params.draftId,
      parseBody<PolicyDecisionRequest>(decisionCheckSchema, request),
    );
    return reply.code(201).send({ simulation });
  });

  app.post('/v1/orgs/:orgId/policy-drafts/:draftId/activate', async (request) => {
    const params = request.params as { readonly orgId: string; readonly draftId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const policy = await activatePolicyDraft(
      deps.pool,
      operator,
      params.orgId,
      params.draftId,
      parseBody(activateDraftSchema, request),
    );
    return { policy };
  });

  app.post('/v1/orgs/:orgId/policies/:policyId/bindings', async (request, reply) => {
    const params = request.params as { readonly orgId: string; readonly policyId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const binding = await bindPolicy(
      deps.pool,
      operator,
      params.orgId,
      params.policyId,
      parseBody(bindPolicySchema, request),
    );
    return reply.code(201).send({ binding });
  });

  app.post('/v1/orgs/:orgId/policies/:policyId/bindings/:bindingId/remove', async (request) => {
    const params = request.params as { readonly orgId: string; readonly policyId: string; readonly bindingId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    return {
      binding: await removePolicyBinding(deps.pool, operator, params.orgId, params.policyId, params.bindingId),
    };
  });

  app.post('/v1/orgs/:orgId/policies/:policyId/archive', async (request) => {
    const params = request.params as { readonly orgId: string; readonly policyId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    return {
      policy: await archivePolicy(
        deps.pool,
        operator,
        params.orgId,
        params.policyId,
        parseBody(activateDraftSchema, request),
      ),
    };
  });

  app.post('/v1/orgs/:orgId/policies/:policyId/versions', async (request, reply) => {
    const params = request.params as { readonly orgId: string; readonly policyId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'admin');
    const policy = await createPolicyVersion(
      deps.pool,
      operator,
      params.orgId,
      params.policyId,
      parseBody(createPolicyVersionSchema, request),
    );
    return reply.code(201).send({ policy });
  });

  app.post('/v1/orgs/:orgId/policy-decisions/check', async (request) => {
    const params = request.params as { readonly orgId: string };
    const operator = await requireOrgOperator(request, deps, params.orgId, 'viewer');
    const decisionRequest = parseBody<PolicyDecisionRequest>(decisionCheckSchema, request);
    const decision = await checkPolicyDecision(deps.pool, operator, params.orgId, decisionRequest);
    return { decision };
  });
}
