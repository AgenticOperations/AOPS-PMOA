import Link from 'next/link';
import { LandingNavigation } from '@/components/landing/LandingNavigation';
import { ChangelogView } from '@/components/changelog/ChangelogView';
import { getChangelogMetrics, getChangelogOrganization } from '@/lib/server/changelog-client';
import type { ChangelogMetrics, ChangelogOrganizationDetails } from '@/lib/changelog-types';

export const metadata = {
  title: 'Changelog — agentOps PMOA',
  description: 'Live engineering activity: commits, pull requests, and contributors synced straight from GitHub.',
};

async function loadInitialData(): Promise<{
  readonly organization: ChangelogOrganizationDetails | null;
  readonly repo: string;
  readonly metrics: ChangelogMetrics | null;
}> {
  try {
    const organization = await getChangelogOrganization();
    const repo = organization.repositories[0]?.name ?? '';
    const metrics = repo.length > 0 ? await getChangelogMetrics(repo) : null;
    return { organization, repo, metrics };
  } catch {
    return { organization: null, repo: '', metrics: null };
  }
}

export default async function ChangelogPage() {
  const { organization, repo, metrics } = await loadInitialData();

  return (
    // Shares the landing page's dark surface (`aops-landing`) rather than
    // isolating it, per design direction: this page should read as part of
    // the same near-black, hairline-bordered chassis as the marketing site.
    <div className="aops-landing aops-changelog">
      <LandingNavigation />
      <main className="aops-page-surface aops-changelog-surface">
        <ChangelogView initialMetrics={metrics} initialOrganization={organization} initialRepo={repo} />
        <div className="aops-changelog-footer">
          <Link href="/">← Back to agentOps PMOA</Link>
        </div>
      </main>
    </div>
  );
}
