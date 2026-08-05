export type ChangelogActivityKind = 'repository' | 'branch' | 'commit' | 'pull_request';

export type ChangelogGithubConfig = {
  readonly token: string;
  readonly org: string;
  readonly repos: readonly string[];
};

// ==================== Raw GitHub payload shapes ====================
// Deliberately loose (only the fields this engine reads are named) --
// `raw` on the row preserves the full GitHub response untouched so nothing
// is lost even though these types only describe a subset.

export type GithubRepo = {
  readonly id: number;
  readonly name: string;
  readonly owner: { readonly login: string };
  readonly created_at: string;
  readonly html_url: string;
  readonly description: string | null;
  readonly default_branch: string;
  readonly private: boolean;
};

export type GithubBranch = {
  readonly name: string;
  readonly commit: { readonly sha: string; readonly url: string };
  readonly protected: boolean;
};

export type GithubCommit = {
  readonly sha: string;
  readonly commit: {
    readonly message: string;
    readonly author: { readonly name: string; readonly email: string; readonly date: string };
  };
  readonly author: { readonly login: string; readonly avatar_url: string; readonly html_url: string } | null;
  readonly parents: ReadonlyArray<{ readonly sha: string }>;
  readonly html_url: string;
};

export type GithubPullRequest = {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly html_url: string;
  readonly created_at: string;
  readonly merged_at: string | null;
  readonly user: { readonly login: string; readonly avatar_url: string };
  readonly head: { readonly ref: string; readonly sha: string };
  readonly base: { readonly ref: string };
};

// ==================== Persisted activity ====================

export type ChangelogActivityRecord = {
  readonly id: string;
  readonly kind: ChangelogActivityKind;
  readonly platformId: string;
  readonly repoName: string;
  readonly branchName: string | null;
  readonly author: string;
  readonly occurredAt: string;
  readonly raw: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type UpsertActivityInput = {
  readonly kind: ChangelogActivityKind;
  readonly platformId: string;
  readonly repoName: string;
  readonly branchName?: string | undefined;
  readonly author: string;
  readonly occurredAt: Date;
  readonly raw: unknown;
};

// ==================== Query filters ====================

export type CommitListFilters = {
  readonly repo?: string | undefined;
  readonly branch?: string | undefined;
  readonly author?: string | undefined;
  readonly since?: Date | undefined;
  readonly until?: Date | undefined;
  readonly limit: number;
};

export type PullRequestListFilters = {
  readonly repo?: string | undefined;
  readonly state?: 'open' | 'closed' | undefined;
  readonly limit: number;
};

export type TimelineFilters = {
  readonly repo?: string | undefined;
  readonly since?: Date | undefined;
  readonly until?: Date | undefined;
  readonly limit: number;
};

// ==================== Organization / metrics response shapes ====================

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
  readonly statistics: {
    readonly totalBranches: number;
    readonly totalCommits: number;
    readonly totalPullRequests: number;
  };
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
  readonly summary: {
    readonly totalCommits: number;
    readonly totalPullRequests: number;
  };
};

export type ChangelogContributionDay = {
  readonly date: string;
  readonly count: number;
  readonly level: number;
};

export type ChangelogContributor = {
  readonly name: string;
  readonly avatarUrl: string;
  readonly profileUrl: string;
};

export type ChangelogGraphCommit = {
  readonly sha: string;
  readonly commit: {
    readonly author: { readonly name: string; readonly date: string; readonly email?: string | undefined };
    readonly message: string;
  };
  readonly parents: ReadonlyArray<{ readonly sha: string }>;
  readonly html_url: string;
};

export type ChangelogGraphBranchHead = {
  readonly name: string;
  readonly commit: { readonly sha: string };
};

export type ChangelogMetrics = {
  readonly repoName: string;
  readonly contributionData: readonly ChangelogContributionDay[];
  readonly graphData: {
    readonly commits: readonly ChangelogGraphCommit[];
    readonly branchHeads: readonly ChangelogGraphBranchHead[];
  };
  readonly contributors: readonly ChangelogContributor[];
  readonly updatedAt: string;
};

export type ChangelogSyncResult = {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly repositoriesSynced: number;
  readonly repositoriesFailed: readonly string[];
};
