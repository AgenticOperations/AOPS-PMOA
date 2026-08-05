'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { IconChartBar, IconClock, IconGitCommit, IconGitPullRequest, IconLoader2 } from '@tabler/icons-react';
import { fetchCommits, fetchPullRequests, fetchTimeline } from '@/lib/changelog-client';
import type { ChangelogFilters, ChangelogOrganizationDetails, CommitActivity, PullRequestActivity, TimelineActivity } from '@/lib/changelog-types';

/**
 * Adapted port of the original `ChangelogTester` API playground: a sidebar
 * of request filters plus a results pane, one tab per read endpoint. The
 * original also exposed a `sync` tab that force-triggered a GitHub sync --
 * dropped here since this page is public and unauthenticated, and the
 * backend already keeps data fresh via its own background poll loop.
 */

type PlaygroundTab = 'commits' | 'prs' | 'timeline' | 'stats';

type ApiPlaygroundProps = {
  readonly organization: ChangelogOrganizationDetails | null;
  readonly selectedRepo: string;
  readonly onRepoChange: (repo: string) => void;
};

type Statistics = {
  readonly totalCommits: number;
  readonly totalPullRequests: number;
  readonly commitsByAuthor: Record<string, number>;
  readonly pullRequestsByState: Record<string, number>;
};

function AuthorInitials({ name }: { readonly name: string }) {
  return (
    <div className="aops-keep-round w-8 h-8 bg-[rgba(255,255,255,0.06)] border border-[var(--aops-line-strong)] flex items-center justify-center overflow-hidden shrink-0">
      <span className="text-[10px] font-bold text-[var(--aops-faint)]">{name.substring(0, 2).toUpperCase()}</span>
    </div>
  );
}

export function ApiPlayground({ organization, selectedRepo, onRepoChange }: ApiPlaygroundProps) {
  const [activeTab, setActiveTab] = useState<PlaygroundTab>('commits');
  const [filters, setFilters] = useState<ChangelogFilters>({ limit: 50, state: 'all' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commits, setCommits] = useState<readonly CommitActivity[]>([]);
  const [pullRequests, setPullRequests] = useState<readonly PullRequestActivity[]>([]);
  const [timeline, setTimeline] = useState<readonly TimelineActivity[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [resultCount, setResultCount] = useState(0);

  const availableRepos = useMemo(() => organization?.repositories.map((repo) => repo.name) ?? [], [organization]);
  const availableBranches = useMemo(() => {
    const repoName = filters.repo ?? selectedRepo;
    if (repoName.length === 0) return [];
    return organization?.repositories.find((repo) => repo.name === repoName)?.branches.map((branch) => branch.name) ?? [];
  }, [filters.repo, organization, selectedRepo]);

  const clearFilters = () => setFilters({ limit: 50, state: 'all' });

  const runRequest = async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === 'commits') {
        const result = await fetchCommits(filters);
        setCommits(result.data);
        setResultCount(result.count);
      } else if (activeTab === 'prs') {
        const result = await fetchPullRequests(filters);
        setPullRequests(result.data);
        setResultCount(result.count);
      } else if (activeTab === 'timeline') {
        const result = await fetchTimeline(filters);
        setTimeline(result.data);
        setResultCount(result.count);
      } else {
        const [commitsResult, pullRequestsResult] = await Promise.all([
          fetchCommits({ ...filters, limit: filters.limit ?? 1000 }),
          fetchPullRequests({ ...filters, state: 'all', limit: filters.limit ?? 1000 }),
        ]);
        const commitsByAuthor: Record<string, number> = {};
        for (const commit of commitsResult.data) commitsByAuthor[commit.author] = (commitsByAuthor[commit.author] ?? 0) + 1;
        const pullRequestsByState: Record<string, number> = {};
        for (const pr of pullRequestsResult.data) pullRequestsByState[pr.raw.state] = (pullRequestsByState[pr.raw.state] ?? 0) + 1;
        setStatistics({
          totalCommits: commitsResult.count,
          totalPullRequests: pullRequestsResult.count,
          commitsByAuthor,
          pullRequestsByState,
        });
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The request failed.');
    } finally {
      setLoading(false);
    }
  };

  const tabLabel: Record<PlaygroundTab, string> = { commits: 'Commits', prs: 'PRs', timeline: 'Timeline', stats: 'Statistics' };

  return (
    <div className="border border-[var(--aops-line-strong)] overflow-hidden">
      <div className="grid grid-cols-12 gap-0 min-h-[640px]">
        <div className="col-span-12 md:col-span-3 bg-[var(--aops-panel)] border-r border-[var(--aops-line-strong)] p-6 flex flex-col">
          <div className="mb-6">
            <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--aops-faint)] mb-2">Request type</label>
            <div className="relative">
              <select
                className="w-full px-4 py-3 bg-transparent border border-[rgba(255,255,255,0.18)] text-sm font-medium text-[var(--aops-ink)] appearance-none cursor-pointer focus:outline-none focus:border-[var(--aops-blue)] pr-10"
                onChange={(event) => setActiveTab(event.target.value as PlaygroundTab)}
                value={activeTab}
              >
                <option value="commits">Commits</option>
                <option value="prs">Pull Requests</option>
                <option value="timeline">Timeline</option>
                <option value="stats">Statistics</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--aops-faint)]">
                {activeTab === 'commits' && <IconGitCommit size={16} />}
                {activeTab === 'prs' && <IconGitPullRequest size={16} />}
                {activeTab === 'timeline' && <IconClock size={16} />}
                {activeTab === 'stats' && <IconChartBar size={16} />}
              </div>
            </div>
          </div>

          {activeTab !== 'stats' && (
            <div className="flex-1 flex flex-col border-t border-[var(--aops-line-strong)] pt-6">
              <h3 className="text-[10px] font-medium uppercase tracking-widest text-[var(--aops-faint)] mb-4">Filters</h3>
              <div className="space-y-4 flex-1 overflow-y-auto pr-2">
                <div>
                  <label className="block text-xs text-[var(--aops-muted)] mb-1.5">Repository</label>
                  <select
                    className="w-full px-3 py-2 bg-transparent border border-[rgba(255,255,255,0.18)] text-sm text-[var(--aops-ink)] focus:outline-none focus:border-[var(--aops-blue)]"
                    onChange={(event) => {
                      const value = event.target.value.length > 0 ? event.target.value : undefined;
                      setFilters((current) => ({ ...current, repo: value }));
                      if (value !== undefined) onRepoChange(value);
                    }}
                    value={filters.repo ?? selectedRepo ?? ''}
                  >
                    <option value="">All repositories</option>
                    {availableRepos.map((repo) => (
                      <option key={repo} value={repo}>
                        {repo}
                      </option>
                    ))}
                  </select>
                </div>

                {activeTab === 'commits' && (
                  <div>
                    <label className="block text-xs text-[var(--aops-muted)] mb-1.5">Branch</label>
                    <select
                      className="w-full px-3 py-2 bg-transparent border border-[rgba(255,255,255,0.18)] text-sm text-[var(--aops-ink)] focus:outline-none focus:border-[var(--aops-blue)] disabled:opacity-50"
                      disabled={filters.repo === undefined && selectedRepo.length === 0}
                      onChange={(event) => setFilters((current) => ({ ...current, branch: event.target.value.length > 0 ? event.target.value : undefined }))}
                      value={filters.branch ?? ''}
                    >
                      <option value="">All branches</option>
                      {availableBranches.map((branch) => (
                        <option key={branch} value={branch}>
                          {branch}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {activeTab !== 'prs' && (
                  <div>
                    <label className="block text-xs text-[var(--aops-muted)] mb-1.5">Author</label>
                    <input
                      className="w-full px-3 py-2 bg-transparent border border-[rgba(255,255,255,0.18)] text-sm text-[var(--aops-ink)] placeholder-[var(--aops-faint)] focus:outline-none focus:border-[var(--aops-blue)]"
                      onChange={(event) => setFilters((current) => ({ ...current, author: event.target.value.length > 0 ? event.target.value : undefined }))}
                      placeholder="Filter by author"
                      type="text"
                      value={filters.author ?? ''}
                    />
                  </div>
                )}

                {activeTab === 'prs' && (
                  <div>
                    <label className="block text-xs text-[var(--aops-muted)] mb-1.5">State</label>
                    <select
                      className="w-full px-3 py-2 bg-transparent border border-[rgba(255,255,255,0.18)] text-sm text-[var(--aops-ink)] focus:outline-none focus:border-[var(--aops-blue)]"
                      onChange={(event) => setFilters((current) => ({ ...current, state: event.target.value as ChangelogFilters['state'] }))}
                      value={filters.state ?? 'all'}
                    >
                      <option value="all">All states</option>
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs text-[var(--aops-muted)] mb-1.5">Limit</label>
                  <input
                    className="w-full px-3 py-2 bg-transparent border border-[rgba(255,255,255,0.18)] text-sm text-[var(--aops-ink)] focus:outline-none focus:border-[var(--aops-blue)]"
                    max={1000}
                    min={1}
                    onChange={(event) => setFilters((current) => ({ ...current, limit: Number.parseInt(event.target.value, 10) || 50 }))}
                    type="number"
                    value={filters.limit ?? 50}
                  />
                </div>

                <button
                  className="w-full px-4 py-2 border border-[rgba(255,255,255,0.18)] text-xs font-medium text-[var(--aops-muted)] hover:border-[var(--aops-blue)] hover:text-[var(--aops-ink)] transition-colors"
                  onClick={clearFilters}
                  type="button"
                >
                  Clear filters
                </button>
              </div>
            </div>
          )}

          <div className="mt-auto pt-4 border-t border-[var(--aops-line-strong)]">
            <button
              className="w-full px-4 py-3 bg-[var(--aops-ink)] text-[#080808] text-sm font-medium hover:bg-[var(--aops-blue)] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              disabled={loading}
              onClick={runRequest}
              type="button"
            >
              {loading ? <IconLoader2 className="animate-spin" size={16} /> : `Fetch ${tabLabel[activeTab]}`}
            </button>
          </div>
        </div>

        <div className="col-span-12 md:col-span-9 bg-transparent p-6 overflow-hidden flex flex-col">
          <div className="mb-4 pb-4 border-b border-[var(--aops-line-strong)]">
            <h3 className="text-lg font-medium text-[var(--aops-ink)]">
              {activeTab === 'stats' ? 'Statistics' : `${tabLabel[activeTab]} (${resultCount})`}
            </h3>
            {error !== null && <p className="text-xs text-[#ff8a8a] mt-1">{error}</p>}
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center h-full">
                <IconLoader2 className="animate-spin text-[var(--aops-blue-light)]" size={28} />
              </div>
            )}

            {!loading && activeTab === 'commits' && commits.length === 0 && <EmptyState />}
            {!loading && activeTab === 'commits' && commits.length > 0 && (
              <div className="space-y-3">
                {commits.map((commit) => (
                  <div className="border border-[var(--aops-line-strong)] p-4 hover:border-[var(--aops-blue)] transition-colors flex items-start gap-4" key={commit.id}>
                    <AuthorInitials name={commit.author} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--aops-ink)] mb-1">{commit.raw.commit.message.split('\n')[0]}</p>
                      <div className="flex items-center gap-2 text-xs text-[var(--aops-muted)] flex-wrap font-medium">
                        <span className="text-[var(--aops-ink)] font-semibold uppercase tracking-tight">{commit.author}</span>
                        <span className="opacity-30">•</span>
                        <span className="bg-[rgba(255,255,255,0.06)] px-1.5 py-0.5 text-[10px]">{commit.repoName}</span>
                        <span className="opacity-30">•</span>
                        <span>{format(new Date(commit.occurredAt), 'MMM d, yyyy HH:mm')}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && activeTab === 'prs' && pullRequests.length === 0 && <EmptyState />}
            {!loading && activeTab === 'prs' && pullRequests.length > 0 && (
              <div className="space-y-3">
                {pullRequests.map((pr) => (
                  <div className="border border-[var(--aops-line-strong)] p-4 hover:border-[var(--aops-blue)] transition-colors flex items-center gap-4" key={pr.id}>
                    <AuthorInitials name={pr.author} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-1 gap-2">
                        <h4 className="text-sm font-medium text-[var(--aops-ink)]">{pr.raw.title}</h4>
                        <span
                          className={`aops-keep-round inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest shrink-0 ${
                            pr.raw.state === 'open' ? 'bg-[rgba(63,185,80,0.15)] text-[#3fb950]' : 'bg-[rgba(191,90,242,0.15)] text-[#d9a5ff]'
                          }`}
                        >
                          {pr.raw.state}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-medium text-[var(--aops-muted)] uppercase tracking-tighter">
                        <span className="text-[var(--aops-blue-light)] font-mono">#{pr.raw.number}</span>
                        <span className="opacity-30">•</span>
                        <span className="text-[var(--aops-ink)]">{pr.author}</span>
                        <span className="opacity-30">•</span>
                        <span>{pr.repoName}</span>
                        <span className="opacity-30">•</span>
                        <span>{format(new Date(pr.occurredAt), 'MMM d, HH:mm')}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && activeTab === 'timeline' && timeline.length === 0 && <EmptyState />}
            {!loading && activeTab === 'timeline' && timeline.length > 0 && (
              <div className="space-y-3">
                {timeline.map((item) => (
                  <div className="border border-[var(--aops-line-strong)] p-4 hover:border-[var(--aops-blue)] transition-colors flex items-start gap-4" key={item.id}>
                    <AuthorInitials name={item.author} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--aops-ink)] mb-1">
                        {item.kind === 'commit' ? item.raw.commit.message.split('\n')[0] : item.raw.title}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-[var(--aops-muted)] flex-wrap font-medium">
                        <span className={item.kind === 'commit' ? 'text-[var(--aops-blue-light)]' : 'text-[#d9a5ff]'}>
                          {item.kind === 'commit' ? <IconGitCommit size={14} /> : <IconGitPullRequest size={14} />}
                        </span>
                        <span className="text-[var(--aops-ink)] font-semibold uppercase tracking-tight">{item.author}</span>
                        <span className="opacity-30">•</span>
                        <span className="bg-[rgba(255,255,255,0.06)] px-1.5 py-0.5 text-[10px]">{item.repoName}</span>
                        <span className="opacity-30">•</span>
                        <span>{format(new Date(item.occurredAt), 'MMM d, yyyy HH:mm')}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && activeTab === 'stats' && statistics === null && <EmptyState />}
            {!loading && activeTab === 'stats' && statistics !== null && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-px bg-[var(--aops-line-strong)] border border-[var(--aops-line-strong)]">
                  <div className="bg-[var(--aops-panel)] p-5">
                    <p className="text-[10px] font-medium text-[var(--aops-faint)] uppercase tracking-widest mb-1">Total commits</p>
                    <p className="text-3xl font-medium text-[var(--aops-ink)]">{statistics.totalCommits}</p>
                  </div>
                  <div className="bg-[var(--aops-panel)] p-5">
                    <p className="text-[10px] font-medium text-[var(--aops-faint)] uppercase tracking-widest mb-1">Total pull requests</p>
                    <p className="text-3xl font-medium text-[var(--aops-ink)]">{statistics.totalPullRequests}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-[var(--aops-line-strong)] p-5">
                    <p className="text-[10px] font-medium text-[var(--aops-faint)] uppercase tracking-widest mb-3">Commits by author</p>
                    <div className="space-y-2">
                      {Object.entries(statistics.commitsByAuthor)
                        .sort(([, a], [, b]) => b - a)
                        .map(([author, count]) => (
                          <div className="flex items-center justify-between text-sm" key={author}>
                            <span className="text-[var(--aops-ink)] font-medium truncate">{author}</span>
                            <span className="text-[var(--aops-muted)] font-semibold tabular-nums">{count}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                  <div className="border border-[var(--aops-line-strong)] p-5">
                    <p className="text-[10px] font-medium text-[var(--aops-faint)] uppercase tracking-widest mb-3">Pull requests by state</p>
                    <div className="space-y-2">
                      {Object.entries(statistics.pullRequestsByState).map(([state, count]) => (
                        <div className="flex items-center justify-between text-sm" key={state}>
                          <span className="text-[var(--aops-ink)] font-medium capitalize">{state}</span>
                          <span className="text-[var(--aops-muted)] font-semibold tabular-nums">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-[var(--aops-muted)]">
      Run a request to see results here.
    </div>
  );
}
