export type ChangelogActivityKind = 'repository' | 'branch' | 'commit' | 'pull_request';

export type RawGithubCommit = {
  readonly sha: string;
  readonly commit: {
    readonly message: string;
    readonly author: { readonly name: string; readonly email: string; readonly date: string };
  };
  readonly author: { readonly login: string; readonly avatar_url: string; readonly html_url: string } | null;
  readonly parents: ReadonlyArray<{ readonly sha: string }>;
  readonly html_url: string;
};

export type RawGithubPullRequest = {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly html_url: string;
  readonly created_at: string;
  readonly merged_at: string | null;
  readonly user: { readonly login: string; readonly avatar_url: string };
  readonly head: { readonly ref: string; readonly sha?: string };
  readonly base: { readonly ref: string };
};

export type ChangelogActivity = {
  readonly id: string;
  readonly kind: ChangelogActivityKind;
  readonly platformId: string;
  readonly repoName: string;
  readonly branchName: string | null;
  readonly author: string;
  readonly occurredAt: string;
  readonly raw: unknown;
};

export type CommitActivity = ChangelogActivity & { readonly kind: 'commit'; readonly raw: RawGithubCommit };
export type PullRequestActivity = ChangelogActivity & { readonly kind: 'pull_request'; readonly raw: RawGithubPullRequest };
export type TimelineActivity = CommitActivity | PullRequestActivity;

export type ChangelogFilters = {
  readonly repo?: string | undefined;
  readonly branch?: string | undefined;
  readonly author?: string | undefined;
  readonly state?: 'open' | 'closed' | 'all' | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
  readonly limit?: number | undefined;
};

export type ChangelogBranchInfo = {
  readonly name: string;
  readonly lastCommitSha: string | null;
  readonly protected: boolean;
  readonly updatedAt: string;
};

export type ChangelogRepositoryInfo = {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly createdAt: string;
  readonly url: string | null;
  readonly description: string | null;
  readonly defaultBranch: string | null;
  readonly isPrivate: boolean;
  readonly statistics: { readonly totalBranches: number; readonly totalCommits: number; readonly totalPullRequests: number };
  readonly branches: readonly ChangelogBranchInfo[];
};

export type ChangelogOrganizationDetails = {
  readonly organization: string;
  readonly configuredRepositories: readonly string[];
  readonly syncedRepositories: readonly string[];
  readonly missingRepositories: readonly string[];
  readonly totalConfigured: number;
  readonly totalSynced: number;
  readonly totalBranches: number;
  readonly totalRepositories: number;
  readonly repositories: readonly ChangelogRepositoryInfo[];
  readonly summary: { readonly totalCommits: number; readonly totalPullRequests: number };
};

export type ChangelogContributionDay = { readonly date: string; readonly count: number; readonly level: number };
export type ChangelogContributor = { readonly name: string; readonly avatarUrl: string; readonly profileUrl: string };

export type ChangelogGraphCommit = {
  readonly sha: string;
  readonly commit: { readonly author: { readonly name: string; readonly date: string; readonly email?: string }; readonly message: string };
  readonly parents: ReadonlyArray<{ readonly sha: string }>;
  readonly html_url: string;
};

export type ChangelogGraphBranchHead = { readonly name: string; readonly commit: { readonly sha: string } };

export type ChangelogMetrics = {
  readonly repoName: string;
  readonly contributionData: readonly ChangelogContributionDay[];
  readonly graphData: { readonly commits: readonly ChangelogGraphCommit[]; readonly branchHeads: readonly ChangelogGraphBranchHead[] };
  readonly contributors: readonly ChangelogContributor[];
  readonly updatedAt: string;
};

export type ChangelogStatusInfo = {
  readonly configured: boolean;
  readonly organization: string | null;
  readonly configuredRepositories: readonly string[];
};
