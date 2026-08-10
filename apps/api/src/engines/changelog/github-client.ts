import type { ChangelogGithubConfig, GithubBranch, GithubCommit, GithubPullRequest, GithubRepo } from './types.js';

const GITHUB_API_BASE = 'https://api.github.com';
const PER_PAGE = 100;

function headers(config: ChangelogGithubConfig): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${config.token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'agentops-pmoa-changelog',
  };
}

function nextPageUrl(linkHeader: string | null): string | null {
  if (linkHeader === null) return null;
  // Link: <https://api.github.com/...&page=2>; rel="next", <...>; rel="last"
  for (const part of linkHeader.split(',')) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/**
 * Paginate a GitHub REST endpoint via the Link header (the documented,
 * authoritative way to know whether more pages exist) rather than guessing
 * from page length. Unlike a "stop on empty page" strategy, this throws on a
 * mid-pagination HTTP failure instead of silently returning a partial list
 * disguised as a complete one -- callers must decide how to handle that.
 */
async function paginate<T>(url: string, config: ChangelogGithubConfig): Promise<T[]> {
  const results: T[] = [];
  let next: string | null = url;

  while (next !== null) {
    const response = await fetch(next, { headers: headers(config) });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`GitHub API request failed (${response.status}) for ${next}: ${body.slice(0, 300)}`);
    }
    const page = (await response.json()) as T[];
    results.push(...page);
    next = nextPageUrl(response.headers.get('link'));
  }

  return results;
}

export async function fetchOrgRepos(config: ChangelogGithubConfig): Promise<GithubRepo[]> {
  const url = `${GITHUB_API_BASE}/orgs/${encodeURIComponent(config.org)}/repos?type=all&per_page=${PER_PAGE}`;
  const repos = await paginate<GithubRepo>(url, config);
  const wanted = new Set(config.repos);
  return repos.filter((repo) => wanted.has(repo.name));
}

export async function fetchBranches(config: ChangelogGithubConfig, repoName: string): Promise<GithubBranch[]> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(config.org)}/${encodeURIComponent(repoName)}/branches?per_page=${PER_PAGE}`;
  return paginate<GithubBranch>(url, config);
}

export async function fetchCommits(
  config: ChangelogGithubConfig,
  repoName: string,
  branchName: string,
  since?: Date  ,
): Promise<GithubCommit[]> {
  const params = new URLSearchParams({ sha: branchName, per_page: String(PER_PAGE) });
  if (since !== undefined) params.set('since', since.toISOString());
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(config.org)}/${encodeURIComponent(repoName)}/commits?${params.toString()}`;
  return paginate<GithubCommit>(url, config);
}

export async function fetchPullRequests(config: ChangelogGithubConfig, repoName: string): Promise<GithubPullRequest[]> {
  const params = new URLSearchParams({ state: 'all', sort: 'created', direction: 'desc', per_page: String(PER_PAGE) });
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(config.org)}/${encodeURIComponent(repoName)}/pulls?${params.toString()}`;
  return paginate<GithubPullRequest>(url, config);
}
