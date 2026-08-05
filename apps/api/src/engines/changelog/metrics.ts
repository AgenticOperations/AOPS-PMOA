import type { ChangelogActivityRecord, ChangelogContributionDay, ChangelogContributor, ChangelogGraphBranchHead, ChangelogGraphCommit } from './types.js';

export const GRAPH_COMMIT_LIMIT = 500;

function utcDateKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * 0-4 color-intensity bucket for the contribution calendar, mirrored on the
 * frontend contract so the UI never has to fall back to inferring intensity
 * from a raw count that saturates arbitrarily.
 */
function contributionLevel(count: number): number {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 7) return 3;
  return 4;
}

export function computeContributionData(commits: ReadonlyArray<{ readonly occurredAt: string }>): ChangelogContributionDay[] {
  const counts = new Map<string, number>();
  for (const commit of commits) {
    const key = utcDateKey(commit.occurredAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => ({ date, count, level: contributionLevel(count) }));
}

export function computeGraphData(
  commits: readonly ChangelogActivityRecord[],
  branches: readonly ChangelogActivityRecord[],
): { readonly commits: ChangelogGraphCommit[]; readonly branchHeads: ChangelogGraphBranchHead[] } {
  const graphCommits = commits.map((activity) => {
    const raw = activity.raw as {
      readonly commit?: { readonly author?: { readonly name?: string; readonly date?: string; readonly email?: string }; readonly message?: string };
      readonly parents?: ReadonlyArray<{ readonly sha?: string }>;
      readonly html_url?: string;
    } | null;
    return {
      sha: activity.platformId,
      commit: {
        author: {
          name: raw?.commit?.author?.name ?? activity.author,
          date: raw?.commit?.author?.date ?? activity.occurredAt,
          email: raw?.commit?.author?.email,
        },
        message: raw?.commit?.message ?? '',
      },
      parents: (raw?.parents ?? []).flatMap((parent) => (typeof parent.sha === 'string' ? [{ sha: parent.sha }] : [])),
      html_url: raw?.html_url ?? '',
    };
  });

  const branchHeads = branches.flatMap((branch) => {
    if (branch.branchName === null) return [];
    const raw = branch.raw as { readonly commit?: { readonly sha?: string } } | null;
    const sha = raw?.commit?.sha;
    if (typeof sha !== 'string') return [];
    return [{ name: branch.branchName, commit: { sha } }];
  });

  return { commits: graphCommits, branchHeads };
}

export function computeContributors(commits: readonly ChangelogActivityRecord[]): ChangelogContributor[] {
  const byKey = new Map<string, ChangelogContributor>();

  for (const activity of commits) {
    const raw = activity.raw as {
      readonly author?: { readonly login?: string; readonly avatar_url?: string; readonly html_url?: string } | null;
      readonly commit?: { readonly author?: { readonly name?: string; readonly email?: string } };
    } | null;
    const githubUser = raw?.author;
    const gitAuthorName = raw?.commit?.author?.name ?? activity.author;

    if (githubUser?.login !== undefined && githubUser.login.length > 0) {
      if (!byKey.has(githubUser.login)) {
        byKey.set(githubUser.login, {
          name: gitAuthorName,
          avatarUrl: githubUser.avatar_url ?? '',
          profileUrl: githubUser.html_url ?? '',
        });
      }
      continue;
    }

    const key = raw?.commit?.author?.email ?? gitAuthorName;
    if (!byKey.has(key)) {
      byKey.set(key, { name: gitAuthorName, avatarUrl: '', profileUrl: '' });
    }
  }

  return [...byKey.values()];
}
