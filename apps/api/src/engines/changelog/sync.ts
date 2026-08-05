import type pg from 'pg';
import { fetchBranches, fetchCommits, fetchOrgRepos, fetchPullRequests } from './github-client.js';
import { computeContributionData, computeContributors, computeGraphData, GRAPH_COMMIT_LIMIT } from './metrics.js';
import {
  deleteStaleBranches,
  getLatestCommitTimestamp,
  listAllCommitsForContribution,
  listBranchActivities,
  listBranchNames,
  listRecentCommitsForMetrics,
  upsertActivity,
  upsertMetrics,
} from './store.js';
import type { ChangelogGithubConfig, ChangelogMetrics, ChangelogSyncResult } from './types.js';

// Distinct from the schema-migration advisory lock in @agentops-pmoa/db
// (7054387463183534) -- this one serializes changelog syncs across
// processes so two concurrent `POST /v1/changelog/sync` callers, or an
// overlapping manual + scheduled run, cannot execute two full GitHub
// crawls at once against the same rows.
const SYNC_ADVISORY_LOCK_ID = '7054387463183699';

export function isChangelogConfigured(config: ChangelogGithubConfig): boolean {
  return config.token.length > 0 && config.org.length > 0 && config.repos.length > 0;
}

async function syncRepositories(pool: pg.Pool, config: ChangelogGithubConfig): Promise<void> {
  const repos = await fetchOrgRepos(config);
  for (const repo of repos) {
    await upsertActivity(pool, {
      kind: 'repository',
      platformId: String(repo.id),
      repoName: repo.name,
      author: repo.owner.login,
      occurredAt: new Date(repo.created_at),
      raw: repo,
    });
  }
}

async function syncBranches(pool: pg.Pool, config: ChangelogGithubConfig, repoName: string): Promise<void> {
  const branches = await fetchBranches(config, repoName);
  for (const branch of branches) {
    await upsertActivity(pool, {
      kind: 'branch',
      platformId: `${repoName}:${branch.name}`,
      repoName,
      branchName: branch.name,
      author: 'branch',
      occurredAt: new Date(),
      raw: branch,
    });
  }
  // Only reached after a successful fetch above -- a failed fetch throws, so
  // this reconciliation step (which deletes rows absent from `branches`)
  // never runs against a partial result and can't erase live branches.
  await deleteStaleBranches(pool, repoName, branches.map((branch) => branch.name));
}

async function syncCommits(pool: pg.Pool, config: ChangelogGithubConfig, repoName: string): Promise<void> {
  const branchNames = await listBranchNames(pool, repoName);
  for (const branchName of branchNames) {
    const since = await getLatestCommitTimestamp(pool, repoName, branchName);
    const commits = await fetchCommits(config, repoName, branchName, since ?? undefined);
    for (const commit of commits) {
      await upsertActivity(pool, {
        kind: 'commit',
        platformId: commit.sha,
        repoName,
        branchName,
        author: commit.author?.login ?? commit.commit.author.name,
        occurredAt: new Date(commit.commit.author.date),
        raw: commit,
      });
    }
  }
}

async function syncPullRequests(pool: pg.Pool, config: ChangelogGithubConfig, repoName: string): Promise<void> {
  const pullRequests = await fetchPullRequests(config, repoName);
  for (const pr of pullRequests) {
    await upsertActivity(pool, {
      kind: 'pull_request',
      platformId: String(pr.id),
      repoName,
      branchName: pr.head.ref,
      author: pr.user.login,
      occurredAt: new Date(pr.created_at),
      raw: pr,
    });
  }
}

/** Recomputes the `changelog_metrics` projection for one repo from already-synced activity rows -- no GitHub calls. */
export async function refreshMetrics(pool: pg.Pool, repoName: string): Promise<ChangelogMetrics> {
  const [graphCommits, allCommitTimestamps, branchRows] = await Promise.all([
    listRecentCommitsForMetrics(pool, repoName, GRAPH_COMMIT_LIMIT),
    listAllCommitsForContribution(pool, repoName),
    listBranchActivities(pool, repoName),
  ]);

  const contributionData = computeContributionData(allCommitTimestamps);
  const contributors = computeContributors(graphCommits);
  const graphData = computeGraphData(graphCommits, branchRows);

  return upsertMetrics(pool, repoName, { contributionData, graphData, contributors });
}

async function syncRepositoryData(pool: pg.Pool, config: ChangelogGithubConfig, repoName: string): Promise<void> {
  await syncBranches(pool, config, repoName);
  await syncCommits(pool, config, repoName);
  await syncPullRequests(pool, config, repoName);
}

/** Pulls every configured repo from GitHub and refreshes their metrics projections. Per-repo failures are isolated so one bad repo cannot abort the rest. */
export async function fullSync(pool: pg.Pool, config: ChangelogGithubConfig): Promise<ChangelogSyncResult> {
  const startedAt = new Date();
  await syncRepositories(pool, config);

  const failed: string[] = [];
  let synced = 0;
  for (const repoName of config.repos) {
    try {
      await syncRepositoryData(pool, config, repoName);
      await refreshMetrics(pool, repoName);
      synced += 1;
    } catch {
      failed.push(repoName);
    }
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    repositoriesSynced: synced,
    repositoriesFailed: failed,
  };
}

export type TriggerSyncOutcome =
  | { readonly status: 'started'; readonly result: ChangelogSyncResult }
  | { readonly status: 'already_running' };

/**
 * Runs `fullSync` guarded by a Postgres advisory lock so overlapping callers
 * (two manual triggers, or a manual trigger racing the scheduled poll)
 * cannot run two full GitHub crawls against the same rows at once. The
 * upstream design this replaces had no such guard.
 */
export async function triggerSync(pool: pg.Pool, config: ChangelogGithubConfig): Promise<TriggerSyncOutcome> {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS locked', [
      SYNC_ADVISORY_LOCK_ID,
    ]);
    if (lock.rows[0]?.locked !== true) return { status: 'already_running' };

    try {
      const result = await fullSync(pool, config);
      return { status: 'started', result };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [SYNC_ADVISORY_LOCK_ID]);
    }
  } finally {
    client.release();
  }
}

export type ChangelogSyncLogger = {
  readonly onError: (error: unknown) => void;
};

/**
 * Background poll loop, mirroring the `startCircleLiquidityWorker` pattern
 * already used for the Circle liquidity provider: a self-rescheduling,
 * unref'd `setTimeout` chain rather than a cron dependency, so it never
 * blocks server startup (the upstream design awaited a full sync inside
 * `onModuleInit`, stalling boot against an empty database).
 */
export function startChangelogSync(
  pool: pg.Pool,
  config: ChangelogGithubConfig,
  pollMs: number,
  logger: ChangelogSyncLogger,
): () => void {
  if (!isChangelogConfigured(config)) {
    return () => {};
  }

  let stopped = false;
  let timeout: NodeJS.Timeout | undefined;

  const schedule = (): void => {
    if (stopped) return;
    timeout = setTimeout(() => void tick(), pollMs);
    timeout.unref();
  };
  const tick = async (): Promise<void> => {
    try {
      await triggerSync(pool, config);
    } catch (error) {
      logger.onError(error);
    } finally {
      schedule();
    }
  };

  void tick();
  return () => {
    stopped = true;
    if (timeout !== undefined) clearTimeout(timeout);
  };
}
