import type pg from 'pg';
import { prefixedId } from '../identity/ids.js';
import type {
  ChangelogActivityKind,
  ChangelogActivityRecord,
  ChangelogGithubConfig,
  ChangelogMetrics,
  ChangelogOrganizationDetails,
  CommitListFilters,
  PullRequestListFilters,
  TimelineFilters,
  UpsertActivityInput,
} from './types.js';

type ActivityRow = {
  readonly id: string;
  readonly kind: ChangelogActivityKind;
  readonly platform_id: string;
  readonly repo_name: string;
  readonly branch_name: string | null;
  readonly author: string;
  readonly occurred_at: Date;
  readonly raw: unknown;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type MetricsRow = {
  readonly repo_name: string;
  readonly contribution_data: unknown;
  readonly graph_data: unknown;
  readonly contributors: unknown;
  readonly updated_at: Date;
};

function activityFromRow(row: ActivityRow): ChangelogActivityRecord {
  return {
    id: row.id,
    kind: row.kind,
    platformId: row.platform_id,
    repoName: row.repo_name,
    branchName: row.branch_name,
    author: row.author,
    occurredAt: row.occurred_at.toISOString(),
    raw: row.raw,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function metricsFromRow(row: MetricsRow): ChangelogMetrics {
  return {
    repoName: row.repo_name,
    contributionData: Array.isArray(row.contribution_data) ? (row.contribution_data as ChangelogMetrics['contributionData']) : [],
    graphData:
      row.graph_data !== null && typeof row.graph_data === 'object'
        ? (row.graph_data as ChangelogMetrics['graphData'])
        : { commits: [], branchHeads: [] },
    contributors: Array.isArray(row.contributors) ? (row.contributors as ChangelogMetrics['contributors']) : [],
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Escapes ILIKE metacharacters (`%`, `_`, `\`) in user-supplied input before
 * it is embedded in a pattern. The upstream design this engine replaces
 * built an unescaped, unanchored RegExp straight from query input --
 * `.*` matched everything, and pathological patterns were possible.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function upsertActivity(pool: pg.Pool, input: UpsertActivityInput): Promise<void> {
  await pool.query(
    `INSERT INTO changelog_activities (id, kind, platform_id, repo_name, branch_name, author, occurred_at, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (kind, platform_id)
     DO UPDATE
        SET repo_name = EXCLUDED.repo_name,
            branch_name = EXCLUDED.branch_name,
            author = EXCLUDED.author,
            occurred_at = EXCLUDED.occurred_at,
            raw = EXCLUDED.raw,
            updated_at = now()`,
    [
      prefixedId('chact'),
      input.kind,
      input.platformId,
      input.repoName,
      input.branchName ?? null,
      input.author,
      input.occurredAt.toISOString(),
      JSON.stringify(input.raw),
    ],
  );
}

/**
 * Deletes branch rows for `repoName` that are not in `liveBranchNames`.
 * Callers must only invoke this after a *successful* branch fetch -- the
 * github-client throws rather than returning a partial list on error, so a
 * failed fetch never reaches here and can never masquerade as "repo has no
 * other branches" the way a swallowed pagination error previously could.
 */
export async function deleteStaleBranches(
  pool: pg.Pool,
  repoName: string,
  liveBranchNames: readonly string[],
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM changelog_activities
      WHERE kind = 'branch'
        AND repo_name = $1
        AND branch_name <> ALL($2::text[])`,
    [repoName, [...liveBranchNames]],
  );
  return result.rowCount ?? 0;
}

export async function getLatestCommitTimestamp(
  pool: pg.Pool,
  repoName: string,
  branchName: string,
): Promise<Date | null> {
  const result = await pool.query<{ occurred_at: Date }>(
    `SELECT occurred_at
       FROM changelog_activities
      WHERE kind = 'commit' AND repo_name = $1 AND branch_name = $2
      ORDER BY occurred_at DESC
      LIMIT 1`,
    [repoName, branchName],
  );
  return result.rows[0]?.occurred_at ?? null;
}

export async function listBranchNames(pool: pg.Pool, repoName: string): Promise<string[]> {
  const result = await pool.query<{ branch_name: string }>(
    `SELECT branch_name FROM changelog_activities WHERE kind = 'branch' AND repo_name = $1 AND branch_name IS NOT NULL`,
    [repoName],
  );
  return result.rows.map((row) => row.branch_name);
}

export async function listBranchActivities(pool: pg.Pool, repoName: string): Promise<ChangelogActivityRecord[]> {
  const result = await pool.query<ActivityRow>(
    `SELECT * FROM changelog_activities WHERE kind = 'branch' AND repo_name = $1`,
    [repoName],
  );
  return result.rows.map(activityFromRow);
}

export async function getCommits(pool: pg.Pool, filters: CommitListFilters): Promise<ChangelogActivityRecord[]> {
  const result = await pool.query<ActivityRow>(
    `SELECT *
       FROM changelog_activities
      WHERE kind = 'commit'
        AND ($1::text IS NULL OR repo_name = $1)
        AND ($2::text IS NULL OR branch_name = $2)
        AND ($3::text IS NULL OR author ILIKE '%' || $3 || '%')
        AND ($4::timestamptz IS NULL OR occurred_at >= $4)
        AND ($5::timestamptz IS NULL OR occurred_at <= $5)
      ORDER BY occurred_at DESC
      LIMIT $6`,
    [
      filters.repo ?? null,
      filters.branch ?? null,
      filters.author === undefined ? null : escapeLikePattern(filters.author),
      filters.since?.toISOString() ?? null,
      filters.until?.toISOString() ?? null,
      filters.limit,
    ],
  );
  return result.rows.map(activityFromRow);
}

export async function getPullRequests(
  pool: pg.Pool,
  filters: PullRequestListFilters,
): Promise<ChangelogActivityRecord[]> {
  const result = await pool.query<ActivityRow>(
    `SELECT *
       FROM changelog_activities
      WHERE kind = 'pull_request'
        AND ($1::text IS NULL OR repo_name = $1)
        AND ($2::text IS NULL OR pr_state = $2)
      ORDER BY occurred_at DESC
      LIMIT $3`,
    [filters.repo ?? null, filters.state ?? null, filters.limit],
  );
  return result.rows.map(activityFromRow);
}

export async function getTimeline(pool: pg.Pool, filters: TimelineFilters): Promise<ChangelogActivityRecord[]> {
  const result = await pool.query<ActivityRow>(
    `SELECT *
       FROM changelog_activities
      WHERE kind IN ('commit', 'pull_request')
        AND ($1::text IS NULL OR repo_name = $1)
        AND ($2::timestamptz IS NULL OR occurred_at >= $2)
        AND ($3::timestamptz IS NULL OR occurred_at <= $3)
      ORDER BY occurred_at DESC
      LIMIT $4`,
    [filters.repo ?? null, filters.since?.toISOString() ?? null, filters.until?.toISOString() ?? null, filters.limit],
  );
  return result.rows.map(activityFromRow);
}

export async function getOrganizationDetails(
  pool: pg.Pool,
  config: ChangelogGithubConfig,
  repoFilter?: string  ,
): Promise<ChangelogOrganizationDetails> {
  const repoRows = await pool.query<ActivityRow>(
    `SELECT * FROM changelog_activities WHERE kind = 'repository' AND ($1::text IS NULL OR repo_name = $1)`,
    [repoFilter ?? null],
  );
  const branchRows = await pool.query<ActivityRow>(
    `SELECT * FROM changelog_activities WHERE kind = 'branch' AND ($1::text IS NULL OR repo_name = $1)`,
    [repoFilter ?? null],
  );
  const commitCounts = await pool.query<{ repo_name: string; count: string }>(
    `SELECT repo_name, count(*) AS count
       FROM changelog_activities
      WHERE kind = 'commit' AND ($1::text IS NULL OR repo_name = $1)
      GROUP BY repo_name`,
    [repoFilter ?? null],
  );
  const prCounts = await pool.query<{ repo_name: string; count: string }>(
    `SELECT repo_name, count(*) AS count
       FROM changelog_activities
      WHERE kind = 'pull_request' AND ($1::text IS NULL OR repo_name = $1)
      GROUP BY repo_name`,
    [repoFilter ?? null],
  );

  const commitCountByRepo = new Map(commitCounts.rows.map((row) => [row.repo_name, Number(row.count)]));
  const prCountByRepo = new Map(prCounts.rows.map((row) => [row.repo_name, Number(row.count)]));

  const repositories = repoRows.rows.map((repo) => {
    const raw = repo.raw as Record<string, unknown> | null;
    const repoBranches = branchRows.rows.filter((branch) => branch.repo_name === repo.repo_name);
    return {
      id: repo.platform_id,
      name: repo.repo_name,
      owner: repo.author,
      createdAt: repo.occurred_at.toISOString(),
      url: typeof raw?.html_url === 'string' ? raw.html_url : null,
      description: typeof raw?.description === 'string' ? raw.description : null,
      defaultBranch: typeof raw?.default_branch === 'string' ? raw.default_branch : null,
      isPrivate: raw?.private === true,
      statistics: {
        totalBranches: repoBranches.length,
        totalCommits: commitCountByRepo.get(repo.repo_name) ?? 0,
        totalPullRequests: prCountByRepo.get(repo.repo_name) ?? 0,
      },
      branches: repoBranches.map((branch) => {
        const branchRaw = branch.raw as Record<string, unknown> | null;
        const commitInfo = branchRaw?.commit as Record<string, unknown> | undefined;
        return {
          name: branch.branch_name ?? 'unknown',
          lastCommitSha: typeof commitInfo?.sha === 'string' ? commitInfo.sha : null,
          protected: branchRaw?.protected === true,
          updatedAt: branch.updated_at.toISOString(),
        };
      }),
    };
  });

  const syncedRepositories = repositories.map((repo) => repo.name);
  const missingRepositories = config.repos.filter((repo) => !syncedRepositories.includes(repo));

  return {
    organization: config.org,
    configuredRepositories: config.repos,
    syncedRepositories,
    missingRepositories,
    totalConfigured: config.repos.length,
    totalSynced: repositories.length,
    totalBranches: branchRows.rows.length,
    totalRepositories: repositories.length,
    repositories,
    summary: {
      totalCommits: [...commitCountByRepo.values()].reduce((sum, count) => sum + count, 0),
      totalPullRequests: [...prCountByRepo.values()].reduce((sum, count) => sum + count, 0),
    },
  };
}

export async function upsertMetrics(
  pool: pg.Pool,
  repoName: string,
  metrics: {
    readonly contributionData: unknown;
    readonly graphData: unknown;
    readonly contributors: unknown;
  },
): Promise<ChangelogMetrics> {
  const result = await pool.query<MetricsRow>(
    `INSERT INTO changelog_metrics (repo_name, contribution_data, graph_data, contributors)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb)
     ON CONFLICT (repo_name)
     DO UPDATE
        SET contribution_data = EXCLUDED.contribution_data,
            graph_data = EXCLUDED.graph_data,
            contributors = EXCLUDED.contributors,
            updated_at = now()
     RETURNING *`,
    [repoName, JSON.stringify(metrics.contributionData), JSON.stringify(metrics.graphData), JSON.stringify(metrics.contributors)],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('changelog_metrics_upsert_failed');
  return metricsFromRow(row);
}

export async function getMetrics(pool: pg.Pool, repoName: string): Promise<ChangelogMetrics | null> {
  const result = await pool.query<MetricsRow>('SELECT * FROM changelog_metrics WHERE repo_name = $1', [repoName]);
  const row = result.rows[0];
  return row === undefined ? null : metricsFromRow(row);
}

/**
 * Recent commits for a repo, newest first, bounded. Feeds the commit-graph
 * projection -- capped rather than unbounded so `changelog_metrics` cannot
 * grow without limit as a repo's history grows (the upstream design this
 * replaces loaded every commit ever synced into one document per refresh).
 */
export async function listRecentCommitsForMetrics(
  pool: pg.Pool,
  repoName: string,
  limit: number,
): Promise<ChangelogActivityRecord[]> {
  const result = await pool.query<ActivityRow>(
    `SELECT * FROM changelog_activities
      WHERE kind = 'commit' AND repo_name = $1
      ORDER BY occurred_at DESC
      LIMIT $2`,
    [repoName, limit],
  );
  return result.rows.map(activityFromRow);
}

export async function listAllCommitsForContribution(
  pool: pg.Pool,
  repoName: string,
): Promise<Array<{ readonly occurredAt: string }>> {
  const result = await pool.query<{ occurred_at: Date }>(
    `SELECT occurred_at FROM changelog_activities WHERE kind = 'commit' AND repo_name = $1`,
    [repoName],
  );
  return result.rows.map((row) => ({ occurredAt: row.occurred_at.toISOString() }));
}
