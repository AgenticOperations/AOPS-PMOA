import 'server-only';
import { readWebEnv } from '../env';
import type {
  ChangelogFilters,
  ChangelogMetrics,
  ChangelogOrganizationDetails,
  ChangelogStatusInfo,
  CommitActivity,
  PullRequestActivity,
  TimelineActivity,
} from '../changelog-types';

type ApiErrorBody = {
  readonly error?: string;
  readonly message?: string;
};

export class ChangelogApiError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? body.error ?? `Changelog API request failed with ${status}`);
    this.name = 'ChangelogApiError';
    this.code = body.error ?? null;
    this.status = status;
  }
}

function apiBaseUrl(): string {
  return readWebEnv().AGENTOPS_API_BASE_URL.replace(/\/$/, '');
}

/**
 * The changelog is public build-transparency data with no org scope, so
 * unlike `payments-client.ts` / `identity-spine-client.ts` this never
 * attaches a session cookie -- there is no session to attach.
 */
async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, { cache: 'no-store' });

  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = {};
    }
    throw new ChangelogApiError(response.status, body);
  }

  return (await response.json()) as T;
}

function queryString(filters: ChangelogFilters | undefined): string {
  if (filters === undefined) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'state' && value === 'all') continue;
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

export async function getChangelogStatus(): Promise<ChangelogStatusInfo> {
  return apiFetch<ChangelogStatusInfo>('/v1/changelog/status');
}

export async function getChangelogOrganization(repo?: string): Promise<ChangelogOrganizationDetails> {
  const { data } = await apiFetch<{ readonly data: ChangelogOrganizationDetails }>(
    `/v1/changelog/organization${repo === undefined ? '' : `?repo=${encodeURIComponent(repo)}`}`,
  );
  return data;
}

export async function getChangelogMetrics(repoName: string): Promise<ChangelogMetrics | null> {
  try {
    const { data } = await apiFetch<{ readonly data: ChangelogMetrics }>(
      `/v1/changelog/metrics/${encodeURIComponent(repoName)}`,
    );
    return data;
  } catch (error) {
    if (error instanceof ChangelogApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getChangelogCommits(filters?: ChangelogFilters): Promise<{ readonly count: number; readonly data: readonly CommitActivity[] }> {
  return apiFetch(`/v1/changelog/commits${queryString(filters)}`);
}

export async function getChangelogPullRequests(
  filters?: ChangelogFilters,
): Promise<{ readonly count: number; readonly data: readonly PullRequestActivity[] }> {
  return apiFetch(`/v1/changelog/pull-requests${queryString(filters)}`);
}

export async function getChangelogTimeline(
  filters?: ChangelogFilters,
): Promise<{ readonly count: number; readonly data: readonly TimelineActivity[] }> {
  return apiFetch(`/v1/changelog/timeline${queryString(filters)}`);
}
