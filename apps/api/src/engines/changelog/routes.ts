import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { getCommits, getMetrics, getOrganizationDetails, getPullRequests, getTimeline } from './store.js';
import { isChangelogConfigured, triggerSync } from './sync.js';
import type { ChangelogGithubConfig } from './types.js';

export type RegisterChangelogRoutesDeps = {
  readonly pool: pg.Pool;
  readonly github: ChangelogGithubConfig;
  /** Optional bearer token required on `POST /v1/changelog/sync`. Unset means the route is open (fine for local/dev). */
  readonly syncToken?: string | undefined;
  readonly installErrorHandler?: boolean | undefined;
};

const isoDateOrDateTime = z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional();

const commitQuerySchema = z.object({
  repo: z.string().trim().min(1).optional(),
  branch: z.string().trim().min(1).optional(),
  author: z.string().trim().min(1).max(200).optional(),
  since: isoDateOrDateTime,
  until: isoDateOrDateTime,
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

const pullRequestQuerySchema = z.object({
  repo: z.string().trim().min(1).optional(),
  state: z.enum(['open', 'closed', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

const timelineQuerySchema = z.object({
  repo: z.string().trim().min(1).optional(),
  since: isoDateOrDateTime,
  until: isoDateOrDateTime,
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

const organizationQuerySchema = z.object({
  repo: z.string().trim().min(1).optional(),
});

function toDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

function requireSyncAuthorized(request: FastifyRequest, syncToken: string | undefined): boolean {
  if (syncToken === undefined || syncToken.length === 0) return true;
  const header = request.headers.authorization;
  if (typeof header !== 'string') return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] === syncToken;
}

export function registerChangelogRoutes(app: FastifyInstance, deps: RegisterChangelogRoutesDeps): void {
  if (deps.installErrorHandler === true) {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'validation_error',
          message: 'Request query is invalid.',
          issues: error.issues,
        });
      }
      throw error;
    });
  }

  // Deliberately public -- this mirrors the org's own GitHub activity as a
  // build-transparency page, not customer data, so there is no org scope to
  // authorize against (unlike every other `/v1/orgs/:orgId/...` engine).
  app.get('/v1/changelog/organization', async (request) => {
    const query = organizationQuerySchema.parse(request.query ?? {});
    const organization = await getOrganizationDetails(deps.pool, deps.github, query.repo);
    return { data: organization };
  });

  app.get('/v1/changelog/commits', async (request) => {
    const query = commitQuerySchema.parse(request.query ?? {});
    const commits = await getCommits(deps.pool, {
      repo: query.repo,
      branch: query.branch,
      author: query.author,
      since: toDate(query.since),
      until: toDate(query.until),
      limit: query.limit,
    });
    return { count: commits.length, data: commits };
  });

  app.get('/v1/changelog/pull-requests', async (request) => {
    const query = pullRequestQuerySchema.parse(request.query ?? {});
    const pullRequests = await getPullRequests(deps.pool, {
      repo: query.repo,
      state: query.state === 'all' ? undefined : query.state,
      limit: query.limit,
    });
    return { count: pullRequests.length, data: pullRequests };
  });

  app.get('/v1/changelog/timeline', async (request) => {
    const query = timelineQuerySchema.parse(request.query ?? {});
    const timeline = await getTimeline(deps.pool, {
      repo: query.repo,
      since: toDate(query.since),
      until: toDate(query.until),
      limit: query.limit,
    });
    return { count: timeline.length, data: timeline };
  });

  app.get('/v1/changelog/metrics/:repoName', async (request, reply) => {
    const params = request.params as { readonly repoName: string };
    const metrics = await getMetrics(deps.pool, params.repoName);
    if (metrics === null) {
      return reply.code(404).send({ error: 'not_found', message: `No metrics for repository "${params.repoName}".` });
    }
    return { data: metrics };
  });

  app.get('/v1/changelog/status', () => ({
    configured: isChangelogConfigured(deps.github),
    organization: deps.github.org.length > 0 ? deps.github.org : null,
    configuredRepositories: deps.github.repos,
  }));

  app.post('/v1/changelog/sync', async (request, reply) => {
    if (!requireSyncAuthorized(request, deps.syncToken)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'A valid sync token is required.' });
    }
    if (!isChangelogConfigured(deps.github)) {
      return reply.code(503).send({
        error: 'not_configured',
        message: 'GITHUB_TOKEN, GITHUB_ORG, and GITHUB_REPOS must be set to sync the changelog.',
      });
    }

    const outcome = await triggerSync(deps.pool, deps.github);
    if (outcome.status === 'already_running') {
      return reply.code(409).send({ error: 'sync_in_progress', message: 'A changelog sync is already running.' });
    }
    return { success: true, ...outcome.result };
  });
}
