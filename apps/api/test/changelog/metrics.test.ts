import { describe, expect, it } from 'vitest';
import { computeContributionData, computeContributors, computeGraphData, GRAPH_COMMIT_LIMIT } from '../../src/engines/changelog/metrics.js';
import type { ChangelogActivityRecord } from '../../src/engines/changelog/types.js';

function commitActivity(input: {
  readonly sha: string;
  readonly occurredAt: string;
  readonly author?: string;
  readonly authorLogin?: string;
  readonly parents?: readonly string[];
  readonly branchName?: string;
}): ChangelogActivityRecord {
  return {
    id: `chact_${input.sha}`,
    kind: 'commit',
    platformId: input.sha,
    repoName: 'demo-repo',
    branchName: input.branchName ?? 'main',
    author: input.author ?? 'Ada Lovelace',
    occurredAt: input.occurredAt,
    raw: {
      sha: input.sha,
      commit: {
        message: `commit ${input.sha}`,
        author: { name: input.author ?? 'Ada Lovelace', email: 'ada@example.test', date: input.occurredAt },
      },
      author:
        input.authorLogin === undefined
          ? null
          : { login: input.authorLogin, avatar_url: `https://avatars.test/${input.authorLogin}`, html_url: `https://github.com/${input.authorLogin}` },
      parents: (input.parents ?? []).map((sha) => ({ sha })),
      html_url: `https://github.com/demo/demo-repo/commit/${input.sha}`,
    },
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
  };
}

describe('changelog metrics projection', () => {
  it('buckets commits per UTC day and assigns 0-4 intensity levels', () => {
    const commits = [
      { occurredAt: '2026-01-01T10:00:00.000Z' },
      { occurredAt: '2026-01-01T23:59:00.000Z' },
      { occurredAt: '2026-01-02T00:00:01.000Z' },
      { occurredAt: '2026-01-03T05:00:00.000Z' },
      { occurredAt: '2026-01-03T06:00:00.000Z' },
      { occurredAt: '2026-01-03T07:00:00.000Z' },
      { occurredAt: '2026-01-03T08:00:00.000Z' },
      { occurredAt: '2026-01-03T09:00:00.000Z' },
    ];

    const result = computeContributionData(commits);

    expect(result).toEqual([
      { date: '2026-01-01', count: 2, level: 1 },
      { date: '2026-01-02', count: 1, level: 1 },
      { date: '2026-01-03', count: 5, level: 3 },
    ]);
  });

  it('reshapes activity rows into graph commits and branch heads', () => {
    const commits = [
      commitActivity({ sha: 'sha2', occurredAt: '2026-01-02T00:00:00.000Z', parents: ['sha1'] }),
      commitActivity({ sha: 'sha1', occurredAt: '2026-01-01T00:00:00.000Z', parents: [] }),
    ];
    const branch: ChangelogActivityRecord = {
      id: 'chact_branch',
      kind: 'branch',
      platformId: 'demo-repo:main',
      repoName: 'demo-repo',
      branchName: 'main',
      author: 'branch',
      occurredAt: '2026-01-02T00:00:00.000Z',
      raw: { name: 'main', commit: { sha: 'sha2' }, protected: true },
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    const graph = computeGraphData(commits, [branch]);

    expect(graph.commits).toHaveLength(2);
    expect(graph.commits[0]).toMatchObject({ sha: 'sha2', parents: [{ sha: 'sha1' }] });
    expect(graph.branchHeads).toEqual([{ name: 'main', commit: { sha: 'sha2' } }]);
  });

  it('dedupes contributors by GitHub login, falling back to git author identity', () => {
    const commits = [
      commitActivity({ sha: 'a', occurredAt: '2026-01-01T00:00:00.000Z', author: 'Ada Lovelace', authorLogin: 'ada' }),
      commitActivity({ sha: 'b', occurredAt: '2026-01-02T00:00:00.000Z', author: 'Ada Lovelace', authorLogin: 'ada' }),
      commitActivity({ sha: 'c', occurredAt: '2026-01-03T00:00:00.000Z', author: 'Grace Hopper' }),
    ];

    const contributors = computeContributors(commits);

    expect(contributors).toEqual([
      { name: 'Ada Lovelace', avatarUrl: 'https://avatars.test/ada', profileUrl: 'https://github.com/ada' },
      { name: 'Grace Hopper', avatarUrl: '', profileUrl: '' },
    ]);
  });

  it('bounds the graph commit window', () => {
    expect(GRAPH_COMMIT_LIMIT).toBeGreaterThan(0);
    expect(GRAPH_COMMIT_LIMIT).toBeLessThan(10_000);
  });
});
