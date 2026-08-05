import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChangelogPage from '../../src/app/changelog/page.js';
import { getChangelogMetrics, getChangelogOrganization } from '@/lib/server/changelog-client.js';
import type { ChangelogMetrics, ChangelogOrganizationDetails } from '@/lib/changelog-types';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/server/changelog-client.js', () => ({
  getChangelogOrganization: vi.fn(),
  getChangelogMetrics: vi.fn(),
}));

vi.mock('@/lib/changelog-client.js', () => ({
  fetchOrganization: vi.fn(),
  fetchMetrics: vi.fn(),
  fetchCommits: vi.fn(),
  fetchPullRequests: vi.fn(),
  fetchTimeline: vi.fn().mockResolvedValue({ count: 0, data: [] }),
}));

const organization: ChangelogOrganizationDetails = {
  organization: 'agentops-labs',
  configuredRepositories: ['aops-pmoa'],
  syncedRepositories: ['aops-pmoa'],
  missingRepositories: [],
  totalConfigured: 1,
  totalSynced: 1,
  totalBranches: 1,
  totalRepositories: 1,
  repositories: [
    {
      id: '1001',
      name: 'aops-pmoa',
      owner: 'agentops-labs',
      createdAt: '2026-01-01T00:00:00.000Z',
      url: 'https://github.com/agentops-labs/aops-pmoa',
      description: 'PMOA control plane',
      defaultBranch: 'main',
      isPrivate: false,
      statistics: { totalBranches: 1, totalCommits: 2, totalPullRequests: 1 },
      branches: [{ name: 'main', lastCommitSha: 'sha-2', protected: true, updatedAt: '2026-01-02T00:00:00.000Z' }],
    },
  ],
  summary: { totalCommits: 2, totalPullRequests: 1 },
};

const metrics: ChangelogMetrics = {
  repoName: 'aops-pmoa',
  contributionData: [{ date: '2026-01-01', count: 2, level: 1 }],
  graphData: {
    commits: [
      {
        sha: 'sha-1',
        commit: { author: { name: 'Ada', date: '2026-01-01T00:00:00.000Z' }, message: 'feat: bootstrap' },
        parents: [],
        html_url: 'https://github.com/agentops-labs/aops-pmoa/commit/sha-1',
      },
      {
        sha: 'sha-2',
        commit: { author: { name: 'Ada', date: '2026-01-02T00:00:00.000Z' }, message: 'feat: changelog' },
        parents: [{ sha: 'sha-1' }],
        html_url: 'https://github.com/agentops-labs/aops-pmoa/commit/sha-2',
      },
    ],
    branchHeads: [{ name: 'main', commit: { sha: 'sha-2' } }],
  },
  contributors: [{ name: 'Ada', avatarUrl: '', profileUrl: 'https://github.com/ada' }],
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('changelog page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders organization stats, the commit graph, and contributors when data is synced', async () => {
    vi.mocked(getChangelogOrganization).mockResolvedValueOnce(organization);
    vi.mocked(getChangelogMetrics).mockResolvedValueOnce(metrics);

    render(await ChangelogPage());

    expect(screen.getByRole('heading', { level: 1, name: 'agentops-labs' })).toBeInTheDocument();
    expect(screen.getByText('feat: bootstrap')).toBeInTheDocument();
    expect(screen.getByText('feat: changelog')).toBeInTheDocument();
    expect(screen.getByText('Contribution activity')).toBeInTheDocument();
    expect(screen.getAllByText('Ada').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /View profile/ })).toHaveAttribute('href', 'https://github.com/ada');
    expect(screen.getByRole('link', { name: '← Back to agentOps PMOA' })).toHaveAttribute('href', '/');
  });

  it('renders a warming-up empty state when the changelog API has no data yet', async () => {
    vi.mocked(getChangelogOrganization).mockRejectedValueOnce(new Error('not configured'));

    render(await ChangelogPage());

    expect(screen.getByText('Changelog is warming up')).toBeInTheDocument();
    expect(getChangelogMetrics).not.toHaveBeenCalled();
  });
});
