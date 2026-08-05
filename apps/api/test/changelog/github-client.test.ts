import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBranches, fetchOrgRepos } from '../../src/engines/changelog/github-client.js';
import type { ChangelogGithubConfig } from '../../src/engines/changelog/types.js';

const config: ChangelogGithubConfig = { token: 'test-token', org: 'demo-org', repos: ['demo-repo'] };

function jsonResponse(body: unknown, link: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: link === null ? {} : { link },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('changelog github-client', () => {
  it('follows the Link header across multiple pages rather than guessing from page length', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          [{ name: 'demo-repo', id: 1, owner: { login: 'demo-org' }, created_at: '2026-01-01T00:00:00Z' }],
          '<https://api.github.com/orgs/demo-org/repos?type=all&per_page=100&page=2>; rel="next"',
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ name: 'other-repo', id: 2, owner: { login: 'demo-org' }, created_at: '2026-01-02T00:00:00Z' }]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const repos = await fetchOrgRepos(config);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Only the configured repo survives the client-side name filter, even
    // though the org listing (unfiltered) spans two pages.
    expect(repos.map((repo) => repo.name)).toEqual(['demo-repo']);
  });

  it('throws on a mid-pagination HTTP failure instead of returning a silently partial list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          [{ name: 'main', commit: { sha: 'a', url: '' }, protected: true }],
          '<https://api.github.com/repos/demo-org/demo-repo/branches?per_page=100&page=2>; rel="next"',
        ),
      )
      .mockResolvedValueOnce(new Response('rate limited', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBranches(config, 'demo-repo')).rejects.toThrow(/GitHub API request failed \(403\)/);
  });

  it('sends the bearer token and API version headers on every request', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchBranches(config, 'demo-repo');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-token');
    expect(headers['x-github-api-version']).toBe('2022-11-28');
  });
});
