'use client';

import { useCallback, useRef, useState } from 'react';
import { IconLoader2, IconTerminal2 } from '@tabler/icons-react';
import { fetchMetrics, fetchOrganization } from '@/lib/changelog-client';
import type { ChangelogMetrics, ChangelogOrganizationDetails } from '@/lib/changelog-types';
import { ActivityTimeline } from './ActivityTimeline';
import { ApiPlayground } from './ApiPlayground';
import { CommitGraph } from './CommitGraph';
import { ContributionCalendar } from './ContributionCalendar';
import { Contributors } from './Contributors';

type ChangelogViewProps = {
  readonly initialOrganization: ChangelogOrganizationDetails | null;
  readonly initialRepo: string;
  readonly initialMetrics: ChangelogMetrics | null;
};

export function ChangelogView({ initialOrganization, initialRepo, initialMetrics }: ChangelogViewProps) {
  const [organization, setOrganization] = useState(initialOrganization);
  const [selectedRepo, setSelectedRepo] = useState(initialRepo);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [showPlayground, setShowPlayground] = useState(false);
  const playgroundRef = useRef<HTMLDivElement>(null);

  const availableRepos = organization?.repositories.map((repo) => repo.name) ?? [];
  const selectedBranches = organization?.repositories.find((repo) => repo.name === selectedRepo)?.branches ?? [];

  const handleRepoChange = useCallback(async (repo: string) => {
    setSelectedRepo(repo);
    if (repo.length === 0) return;
    setLoadingMetrics(true);
    setMetricsError(null);
    try {
      const [nextMetrics, nextOrganization] = await Promise.all([fetchMetrics(repo), fetchOrganization()]);
      setMetrics(nextMetrics);
      setOrganization(nextOrganization);
    } catch (error) {
      setMetricsError(error instanceof Error ? error.message : 'Failed to load repository metrics.');
    } finally {
      setLoadingMetrics(false);
    }
  }, []);

  const openPlayground = () => {
    setShowPlayground(true);
    window.setTimeout(() => playgroundRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  };

  if (organization === null) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold text-[var(--aops-ink)] mb-3">Changelog is warming up</h1>
        <p className="text-sm text-[var(--aops-muted)]">
          GitHub sync hasn&apos;t produced any data yet. Check back shortly, or configure{' '}
          <code className="text-[var(--aops-blue-light)]">GITHUB_TOKEN</code>,{' '}
          <code className="text-[var(--aops-blue-light)]">GITHUB_ORG</code>, and{' '}
          <code className="text-[var(--aops-blue-light)]">GITHUB_REPOS</code> on the API service.
        </p>
      </div>
    );
  }

  return (
    <div className="aops-wrap py-10">
      <header className="flex flex-wrap items-start justify-between gap-6 mb-10 pb-10 border-b border-[var(--aops-line-strong)]">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--aops-faint)] mb-3">Engineering changelog</p>
          <h1 className="text-3xl font-medium text-[var(--aops-ink)] tracking-[-0.01em]">{organization.organization}</h1>
          <div className="flex items-center gap-6 text-sm text-[var(--aops-muted)] mt-4">
            <span>
              <b className="text-[var(--aops-ink)] font-medium">{organization.totalRepositories}</b> repos
            </span>
            <span>
              <b className="text-[var(--aops-ink)] font-medium">{organization.summary.totalCommits}</b> commits
            </span>
            <span>
              <b className="text-[var(--aops-ink)] font-medium">{organization.summary.totalPullRequests}</b> pull requests
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-2 px-4 py-2.5 border border-[rgba(255,255,255,0.18)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--aops-muted)] hover:border-[var(--aops-blue)] hover:text-[var(--aops-ink)] transition-colors"
            onClick={openPlayground}
            type="button"
          >
            <IconTerminal2 size={14} />
            API playground
          </button>
          <select
            className="px-3 py-2.5 bg-transparent border border-[rgba(255,255,255,0.18)] text-sm font-medium text-[var(--aops-ink)] focus:outline-none focus:border-[var(--aops-blue)]"
            onChange={(event) => void handleRepoChange(event.target.value)}
            value={selectedRepo}
          >
            <option value="">Select repository</option>
            {availableRepos.map((repo) => (
              <option key={repo} value={repo}>
                {repo}
              </option>
            ))}
          </select>
        </div>
      </header>

      {metricsError !== null && (
        <div className="border border-[rgba(255,90,90,0.3)] bg-[rgba(255,90,90,0.06)] p-4 mb-6">
          <p className="text-sm text-[#ff8a8a]">{metricsError}</p>
        </div>
      )}

      {loadingMetrics && (
        <div className="flex items-center justify-center py-24">
          <IconLoader2 className="animate-spin text-[var(--aops-blue-light)]" size={28} />
        </div>
      )}

      {!loadingMetrics && selectedRepo.length > 0 && metrics !== null && (
        <div className="space-y-16">
          {metrics.graphData.commits.length > 0 && (
            <section>
              <SectionHeading title="Commit graph" />
              <CommitGraph branches={selectedBranches} commits={metrics.graphData.commits} contributors={metrics.contributors} />
            </section>
          )}

          {metrics.contributionData.length > 0 && (
            <section>
              <SectionHeading title="Contribution activity" />
              <ContributionCalendar data={metrics.contributionData} />
            </section>
          )}

          {metrics.contributors.length > 0 && (
            <section>
              <SectionHeading title="Contributors" />
              <Contributors contributors={metrics.contributors} />
            </section>
          )}

          <section>
            <SectionHeading title="Recent activity" />
            <ActivityTimeline repo={selectedRepo} />
          </section>

          <section className="border-t border-[var(--aops-line-strong)] pt-10" ref={playgroundRef}>
            <button className="w-full flex items-center justify-between text-left group" onClick={() => setShowPlayground((current) => !current)} type="button">
              <div>
                <h2 className="text-xl font-medium text-[var(--aops-ink)] mb-2 group-hover:text-white transition-colors">
                  Want to see the raw data?
                </h2>
                <p className="text-sm text-[var(--aops-muted)]">Query commits, pull requests, and timeline activity straight from the API.</p>
              </div>
              <span className={`text-[var(--aops-faint)] transition-transform ${showPlayground ? 'rotate-180' : ''}`}>▾</span>
            </button>

            {showPlayground && (
              <div className="mt-8">
                <ApiPlayground onRepoChange={(repo) => void handleRepoChange(repo)} organization={organization} selectedRepo={selectedRepo} />
              </div>
            )}
          </section>
        </div>
      )}

      {!loadingMetrics && (selectedRepo.length === 0 || metrics === null) && (
        <p className="text-sm text-[var(--aops-muted)] text-center py-16">
          {selectedRepo.length === 0 ? 'Select a repository to view its changelog.' : 'No synced data for this repository yet.'}
        </p>
      )}
    </div>
  );
}

function SectionHeading({ title }: { readonly title: string }) {
  return (
    <div className="flex items-center gap-4 mb-6">
      <h2 className="text-lg font-medium text-[var(--aops-ink)]">{title}</h2>
      <span className="h-px flex-1 bg-[var(--aops-line-strong)]" />
    </div>
  );
}
