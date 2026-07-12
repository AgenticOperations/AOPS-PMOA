import { formatDistanceToNowStrict } from 'date-fns';
import { IconArrowLeft, IconArrowRight } from '@tabler/icons-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { AgentCreateDrawer } from '@/components/agents/AgentCreateDrawer';
import { AgentRegistryFilters } from '@/components/agents/AgentRegistryFilters';
import { formatConnectionHealth, formatStatus } from '@/components/agents/format';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import { createAgentAction } from '../../../actions/identity-spine';
import { getOrgBySlug, listAgentsPage, listTeams } from '@/lib/server/identity-spine-client';
import type { AgentStatus } from '@/lib/identity-spine-types';

export const dynamic = 'force-dynamic';

type AgentsPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
  readonly searchParams?: Promise<Record<string, string | readonly string[] | undefined>>;
};

type AgentFilters = {
  readonly search: string;
  readonly status: AgentStatus | '';
  readonly team: string;
  readonly pageSize: number;
};

const agentStatuses: readonly AgentStatus[] = ['active', 'paused', 'deactivated', 'retired', 'suspended'];
const supportedPageSizes = [25, 50, 100] as const;

function singleParam(value: string | readonly string[] | undefined): string {
  if (typeof value === 'string') return value;
  return value?.[0] ?? '';
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePageSize(value: string): number {
  const parsed = positiveInteger(value, 25);
  return supportedPageSizes.includes(parsed as (typeof supportedPageSizes)[number]) ? parsed : 25;
}

function normalizeStatus(value: string): AgentStatus | '' {
  return agentStatuses.includes(value as AgentStatus) ? (value as AgentStatus) : '';
}

function formatLastActivity(value: string | null): string {
  if (value === null) return 'No activity';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

function pageHref(orgSlug: string, page: number, filters: AgentFilters): string {
  const query = new URLSearchParams();
  if (filters.search.length > 0) query.set('search', filters.search);
  if (filters.team.length > 0) query.set('team', filters.team);
  if (filters.status.length > 0) query.set('status', filters.status);
  if (filters.pageSize !== 25) query.set('page_size', String(filters.pageSize));
  if (page > 1) query.set('page', String(page));
  const suffix = query.toString();
  return `/app/${orgSlug}/agents${suffix.length > 0 ? `?${suffix}` : ''}`;
}

function visiblePageNumbers(currentPage: number, totalPages: number): number[] {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  return [...pages].filter((page) => page >= 1 && page <= totalPages).sort((left, right) => left - right);
}

export default async function AgentsPage({ params, searchParams }: AgentsPageProps) {
  const { orgSlug } = await params;
  const query = (await searchParams) ?? {};
  const filters: AgentFilters = {
    search: singleParam(query.search).trim(),
    status: normalizeStatus(singleParam(query.status)),
    team: singleParam(query.team).trim(),
    pageSize: normalizePageSize(singleParam(query.page_size)),
  };
  const requestedPage = positiveInteger(singleParam(query.page), 1);

  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [agentPage, teams] = await Promise.all([
    listAgentsPage(org.id, {
      limit: filters.pageSize,
      offset: (requestedPage - 1) * filters.pageSize,
      ...(filters.search.length > 0 ? { search: filters.search } : {}),
      ...(filters.team.length > 0 ? { teamId: filters.team } : {}),
      ...(filters.status !== '' ? { status: filters.status } : {}),
    }),
    listTeams(org.id),
  ]);
  const totalPages = Math.max(1, Math.ceil(agentPage.pagination.total / filters.pageSize));
  if (requestedPage > totalPages && agentPage.pagination.total > 0) {
    redirect(pageHref(org.slug, totalPages, filters));
  }

  const currentPage = Math.min(requestedPage, totalPages);
  const pageStart = agentPage.pagination.total === 0 ? 0 : agentPage.pagination.offset + 1;
  const pageEnd = agentPage.pagination.offset + agentPage.agents.length;
  const hasFilters = filters.search.length > 0 || filters.team.length > 0 || filters.status.length > 0;
  const activeTeams = teams.filter((team) => team.archived_at === null);

  return (
    <ConsoleShell active="agents" org={org}>
      <main className="registry-page" id="main-content">
        <header className="registry-page-header">
          <div>
            <p className="registry-eyebrow">Identity / registry</p>
            <h1>Agents</h1>
            <p className="registry-page-copy">
              Authorize identities, inspect control coverage and open one agent&apos;s complete operating history.
            </p>
          </div>
          <AgentCreateDrawer action={createAgentAction.bind(null, org.id, org.slug)} />
        </header>

        <AgentRegistryFilters applied={filters} orgSlug={org.slug} pageSizes={supportedPageSizes} statuses={agentStatuses} teams={activeTeams} />

        {agentPage.agents.length === 0 ? (
          <section className="registry-empty-state">
            <span className="registry-empty-mark" aria-hidden="true">AO</span>
            <h2>{hasFilters ? 'No agents match these filters' : 'No agents registered'}</h2>
            <p>
              {hasFilters
                ? 'Change or clear the current filters to return to the complete registry.'
                : 'Add the first agent identity, then open it to create a runtime credential.'}
            </p>
            {hasFilters ? <Link className="button-secondary" href={`/app/${org.slug}/agents`}>Clear filters</Link> : null}
          </section>
        ) : (
          <>
            <TableShell className="registry-table-shell" maxHeight={640}>
              <Table aria-label="Registered agents" className="registry-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Credential</TableHead>
                    <TableHead>Policy coverage</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead><span className="sr-only">Open agent</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentPage.agents.map((agent) => {
                    const href = `/app/${org.slug}/agents/${agent.id}`;
                    return (
                      <TableRow key={agent.id}>
                        <TableCell data-label="Agent">
                          <div className="registry-agent-cell">
                            <span className="registry-agent-mark" aria-hidden="true">{agent.name.slice(0, 2).toUpperCase()}</span>
                            <div>
                              <Link href={href}>{agent.name}</Link>
                              <code>{agent.id}</code>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell data-label="Team">{agent.team.name}</TableCell>
                        <TableCell data-label="Status"><StatusBadge label={formatStatus(agent.status)} status={agent.status} /></TableCell>
                        <TableCell data-label="Credential"><StatusBadge label={formatConnectionHealth(agent.connection_health)} status={agent.connection_health} /></TableCell>
                        <TableCell data-label="Policy coverage">{agent.policy_coverage === 0 ? 'No policies' : `${agent.policy_coverage} active`}</TableCell>
                        <TableCell className="registry-time-cell" data-label="Last activity">{formatLastActivity(agent.last_activity_at)}</TableCell>
                        <TableCell className="registry-open-cell">
                          <Link aria-label={`Open ${agent.name}`} href={href}><IconArrowRight aria-hidden="true" size={15} stroke={1.8} /></Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableShell>

            <nav className="registry-pager" aria-label="Agent pagination">
              <span>Showing {pageStart}–{pageEnd} of {agentPage.pagination.total}</span>
              <div className="registry-page-controls">
                {currentPage === 1 ? (
                  <span aria-disabled="true" className="registry-page-button is-disabled"><IconArrowLeft aria-hidden="true" size={13} /></span>
                ) : (
                  <Link aria-label="Previous page" className="registry-page-button" href={pageHref(org.slug, currentPage - 1, filters)}><IconArrowLeft aria-hidden="true" size={13} /></Link>
                )}
                {visiblePageNumbers(currentPage, totalPages).map((page, index, pages) => (
                  <span className="registry-page-number-group" key={page}>
                    {index > 0 && page - pages[index - 1]! > 1 ? <span aria-hidden="true" className="registry-page-ellipsis">...</span> : null}
                    <Link
                      aria-current={page === currentPage ? 'page' : undefined}
                      aria-label={`Page ${page}`}
                      className={page === currentPage ? 'registry-page-button is-current' : 'registry-page-button'}
                      href={pageHref(org.slug, page, filters)}
                    >
                      {page}
                    </Link>
                  </span>
                ))}
                {currentPage === totalPages ? (
                  <span aria-disabled="true" className="registry-page-button is-disabled"><IconArrowRight aria-hidden="true" size={13} /></span>
                ) : (
                  <Link aria-label="Next page" className="registry-page-button" href={pageHref(org.slug, currentPage + 1, filters)}><IconArrowRight aria-hidden="true" size={13} /></Link>
                )}
              </div>
              <span>{filters.pageSize} per page</span>
            </nav>
          </>
        )}
      </main>
    </ConsoleShell>
  );
}
