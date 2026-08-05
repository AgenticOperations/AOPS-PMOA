import type {
  ChangelogFilters,
  ChangelogMetrics,
  ChangelogOrganizationDetails,
  CommitActivity,
  PullRequestActivity,
  TimelineActivity,
} from './changelog-types';

/**
 * Browser-side fetch wrapper for the changelog Next.js API proxy routes
 * under `/api/changelog/*` (see `lib/server/changelog-client.ts` for the
 * server-only client those routes call into). Used for client-side repo
 * switching and the API playground, where requests must originate from the
 * browser rather than a Server Component render.
 */

class ChangelogClientError extends Error {}

function queryString(filters: ChangelogFilters | undefined): string {
  if (filters === undefined) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

async function proxyFetch<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly message?: string };
    throw new ChangelogClientError(body.message ?? `Request to ${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchOrganization(repo?: string): Promise<ChangelogOrganizationDetails> {
  const { data } = await proxyFetch<{ readonly data: ChangelogOrganizationDetails }>(
    `/api/changelog/organization${repo === undefined ? '' : `?repo=${encodeURIComponent(repo)}`}`,
  );
  return data;
}

export async function fetchMetrics(repoName: string): Promise<ChangelogMetrics | null> {
  const response = await fetch(`/api/changelog/metrics/${encodeURIComponent(repoName)}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly message?: string };
    throw new ChangelogClientError(body.message ?? `Failed to load metrics for ${repoName}`);
  }
  const { data } = (await response.json()) as { readonly data: ChangelogMetrics };
  return data;
}

export async function fetchCommits(filters?: ChangelogFilters): Promise<{ readonly count: number; readonly data: readonly CommitActivity[] }> {
  return proxyFetch(`/api/changelog/commits${queryString(filters)}`);
}

export async function fetchPullRequests(
  filters?: ChangelogFilters,
): Promise<{ readonly count: number; readonly data: readonly PullRequestActivity[] }> {
  return proxyFetch(`/api/changelog/pull-requests${queryString(filters)}`);
}

export async function fetchTimeline(filters?: ChangelogFilters): Promise<{ readonly count: number; readonly data: readonly TimelineActivity[] }> {
  return proxyFetch(`/api/changelog/timeline${queryString(filters)}`);
}
