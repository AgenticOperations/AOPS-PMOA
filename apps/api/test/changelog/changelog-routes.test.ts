import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

type OrganizationResponse = {
  readonly data: {
    readonly organization: string;
    readonly configuredRepositories: readonly string[];
    readonly syncedRepositories: readonly string[];
    readonly missingRepositories: readonly string[];
    readonly totalSynced: number;
    readonly repositories: ReadonlyArray<{
      readonly name: string;
      readonly statistics: { readonly totalCommits: number; readonly totalPullRequests: number };
      readonly branches: ReadonlyArray<{ readonly name: string; readonly lastCommitSha: string | null }>;
    }>;
    readonly summary: { readonly totalCommits: number; readonly totalPullRequests: number };
  };
};

type CommitsResponse = {
  readonly count: number;
  readonly data: ReadonlyArray<{ readonly author: string; readonly repoName: string; readonly branchName: string | null }>;
};

type PullRequestsResponse = {
  readonly count: number;
  readonly data: ReadonlyArray<{ readonly platformId: string }>;
};

type TimelineResponse = {
  readonly count: number;
  readonly data: ReadonlyArray<{ readonly kind: string }>;
};

async function insertActivity(
  pool: PostgresTestStore['pool'],
  input: {
    readonly id: string;
    readonly kind: 'repository' | 'branch' | 'commit' | 'pull_request';
    readonly platformId: string;
    readonly repoName: string;
    readonly branchName?: string | null;
    readonly author: string;
    readonly occurredAt: string;
    readonly raw: unknown;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO changelog_activities (id, kind, platform_id, repo_name, branch_name, author, occurred_at, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [input.id, input.kind, input.platformId, input.repoName, input.branchName ?? null, input.author, input.occurredAt, JSON.stringify(input.raw)],
  );
}

describe('changelog engine', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    store = await startPostgres();
    app = buildApp({
      changelog: {
        pool: store.pool,
        github: { token: '', org: 'demo-org', repos: ['demo-repo'] },
        syncToken: 'super-secret-token-value',
      },
    });
    await app.ready();

    await insertActivity(store.pool, {
      id: 'chact_repo_demo',
      kind: 'repository',
      platformId: '1001',
      repoName: 'demo-repo',
      author: 'demo-org',
      occurredAt: '2026-01-01T00:00:00.000Z',
      raw: { id: 1001, name: 'demo-repo', owner: { login: 'demo-org' }, html_url: 'https://github.com/demo-org/demo-repo', default_branch: 'main', private: false },
    });
    await insertActivity(store.pool, {
      id: 'chact_branch_main',
      kind: 'branch',
      platformId: 'demo-repo:main',
      repoName: 'demo-repo',
      branchName: 'main',
      author: 'branch',
      occurredAt: '2026-01-02T00:00:00.000Z',
      raw: { name: 'main', commit: { sha: 'sha-main-head' }, protected: true },
    });
    await insertActivity(store.pool, {
      id: 'chact_commit_1',
      kind: 'commit',
      platformId: 'sha-1',
      repoName: 'demo-repo',
      branchName: 'main',
      author: 'Ada',
      occurredAt: '2026-01-03T00:00:00.000Z',
      raw: { sha: 'sha-1', commit: { message: 'feat: add thing', author: { name: 'Ada', date: '2026-01-03T00:00:00.000Z' } }, parents: [] },
    });
    await insertActivity(store.pool, {
      id: 'chact_commit_2',
      kind: 'commit',
      platformId: 'sha-2',
      repoName: 'demo-repo',
      branchName: 'main',
      author: 'A_a',
      occurredAt: '2026-01-04T00:00:00.000Z',
      raw: { sha: 'sha-2', commit: { message: 'fix: literal underscore author', author: { name: 'A_a', date: '2026-01-04T00:00:00.000Z' } }, parents: ['sha-1'] },
    });
    await insertActivity(store.pool, {
      id: 'chact_pr_1',
      kind: 'pull_request',
      platformId: '5001',
      repoName: 'demo-repo',
      branchName: 'feature/x',
      author: 'Ada',
      occurredAt: '2026-01-05T00:00:00.000Z',
      raw: { id: 5001, number: 7, title: 'Add thing', state: 'open', head: { ref: 'feature/x' }, user: { login: 'Ada' } },
    });
    await insertActivity(store.pool, {
      id: 'chact_pr_2',
      kind: 'pull_request',
      platformId: '5002',
      repoName: 'demo-repo',
      branchName: 'feature/y',
      author: 'Ada',
      occurredAt: '2026-01-06T00:00:00.000Z',
      raw: { id: 5002, number: 8, title: 'Closed thing', state: 'closed', head: { ref: 'feature/y' }, user: { login: 'Ada' } },
    });
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await store.stop();
  });

  it('reports synced vs. missing configured repositories in the organization view', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/changelog/organization' });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<OrganizationResponse>();

    expect(body.data.organization).toBe('demo-org');
    expect(body.data.configuredRepositories).toEqual(['demo-repo']);
    expect(body.data.syncedRepositories).toEqual(['demo-repo']);
    expect(body.data.missingRepositories).toEqual([]);
    expect(body.data.summary).toEqual({ totalCommits: 2, totalPullRequests: 2 });

    const repo = body.data.repositories[0];
    expect(repo?.name).toBe('demo-repo');
    expect(repo?.statistics).toEqual({ totalBranches: 1, totalCommits: 2, totalPullRequests: 2 });
    expect(repo?.branches).toEqual([
      expect.objectContaining({ name: 'main', lastCommitSha: 'sha-main-head' }),
    ]);
  });

  it('lists commits newest-first and scopes by branch', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/changelog/commits?repo=demo-repo&branch=main' });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<CommitsResponse>();
    expect(body.count).toBe(2);
    expect(body.data.map((commit) => commit.author)).toEqual(['A_a', 'Ada']);
  });

  it('escapes ILIKE metacharacters in the author filter instead of matching them as wildcards', async () => {
    // "A_a" contains a literal underscore. Before escaping, an unescaped
    // '%A_a%' pattern would also match "Ada" (the underscore matching the
    // 'd'). After escaping, only the literal-underscore author matches.
    const response = await app.inject({ method: 'GET', url: '/v1/changelog/commits?author=A_a' });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<CommitsResponse>();
    expect(body.data.map((commit) => commit.author)).toEqual(['A_a']);
  });

  it('filters pull requests by state using the generated pr_state column', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/changelog/pull-requests?repo=demo-repo&state=open' });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<PullRequestsResponse>();
    expect(body.data.map((pr) => pr.platformId)).toEqual(['5001']);
  });

  it('merges commits and pull requests into one newest-first timeline', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/changelog/timeline?repo=demo-repo&limit=3' });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<TimelineResponse>();
    expect(body.data.map((item) => item.kind)).toEqual(['pull_request', 'pull_request', 'commit']);
  });

  it('returns 404 for metrics of a repo that has never been synced', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/changelog/metrics/never-synced' });
    expect(response.statusCode).toBe(404);
  });

  it('reports configured=false when no GitHub credentials are set', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/changelog/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ configured: false, organization: 'demo-org', configuredRepositories: ['demo-repo'] });
  });

  it('rejects sync requests without a matching bearer token', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/changelog/sync' });
    expect(response.statusCode).toBe(401);
  });

  it('reports 503 when GitHub credentials are missing even with a valid sync token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/changelog/sync',
      headers: { authorization: 'Bearer super-secret-token-value' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'not_configured' });
  });

  it('validates and bounds the commits limit query parameter', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/changelog/commits?limit=5000' });
    expect(response.statusCode).toBe(400);
  });
});
