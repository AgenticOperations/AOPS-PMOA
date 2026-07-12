import Link from 'next/link';
import { redirect } from 'next/navigation';
import { IconArrowRight } from '@tabler/icons-react';
import { ConsoleShell } from '@/components/ConsoleShell';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';
import { listApprovals } from '@/lib/server/approval-client';
import { listAuditEvents } from '@/lib/server/audit-client';
import { getTreasuryOverview } from '@/lib/server/payments-client';
import type { AgentRosterItem } from '@/lib/identity-spine-types';
import type { TreasuryOverviewRecord } from '@/lib/payments-types';

export const dynamic = 'force-dynamic';

type OverviewPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
  readonly searchParams?: Promise<{ readonly agent_page?: string }>;
};

const AGENT_PAGE_SIZE = 4;

type AttentionItem = {
  readonly copy: string;
  readonly href: string;
  readonly title: string;
  readonly tone: 'danger' | 'warning';
};

export default async function OverviewPage({ params, searchParams }: OverviewPageProps) {
  const { orgSlug } = await params;
  const query = searchParams === undefined ? {} : await searchParams;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [agents, approvalList, auditList, treasuryOverview] = await Promise.all([
    listAgents(org.id),
    listApprovals(org.id),
    listAuditEvents(org.id, 8),
    getTreasuryOverview(org.id).catch(() => null),
  ]);
  const activeAgents = agents.filter((agent) => agent.status === 'active').length;
  const connectedAgents = agents.filter(
    (agent) => agent.status === 'active' && agent.connection_health === 'healthy',
  ).length;
  const pendingApprovals = approvalList.approvals.filter((approval) => approval.status === 'pending');
  const recentEvidence = auditList.events.slice(0, 4);
  const attentionItems = buildAttentionItems({ agents, pendingApprovals, treasuryOverview, orgSlug: org.slug });
  const totalAgentPages = Math.max(1, Math.ceil(agents.length / AGENT_PAGE_SIZE));
  const requestedAgentPage = Number.parseInt(query.agent_page ?? '1', 10);
  const agentPage = Number.isFinite(requestedAgentPage)
    ? Math.min(Math.max(1, requestedAgentPage), totalAgentPages)
    : 1;
  const roster = [...agents]
    .reverse()
    .slice((agentPage - 1) * AGENT_PAGE_SIZE, agentPage * AGENT_PAGE_SIZE);
  const oldestPendingApproval = [...pendingApprovals].sort(
    (left, right) => Date.parse(left.created_at) - Date.parse(right.created_at),
  )[0];

  return (
    <ConsoleShell active="overview" org={org}>
      <div className="canonical-overview-page">
        <header className="canonical-overview-header">
          <div>
            <p className="canonical-overview-eyebrow">Workspace / command view</p>
            <h1>Operational posture, without the noise.</h1>
            <p className="canonical-overview-copy">
              Identity, controls, runtime, approvals, and treasury for {org.name}. Every signal links to the workspace that owns it.
            </p>
          </div>
        </header>

        <section className="canonical-overview-status" aria-label="Workspace status">
          <div className="canonical-overview-metric canonical-overview-lead">
            <span>Workspace health</span>
            <strong>
              {attentionItems.length === 0
                ? 'No open exceptions'
                : `${attentionItems.length} ${attentionItems.length === 1 ? 'item needs' : 'items need'} review`}
            </strong>
            <p>
              {workspaceSummary(attentionItems, agents.length)}
            </p>
          </div>
          <div className="canonical-overview-metric">
            <span>Active agents</span>
            <strong>{activeAgents}</strong>
            <small>{activeAgents === 0 ? 'No active identities' : `${connectedAgents} with healthy credentials`}</small>
          </div>
          <div className="canonical-overview-metric">
            <span>Pending approvals</span>
            <strong>{pendingApprovals.length}</strong>
            <small>
              {oldestPendingApproval === undefined
                ? 'No requests waiting'
                : `Oldest request ${formatRelativeTime(oldestPendingApproval.created_at)}`}
            </small>
          </div>
          <div className="canonical-overview-metric">
            <span>Treasury available</span>
            <strong>{treasuryOverview === null ? 'Unavailable' : formatUsdc(treasuryOverview.totals.treasury_usdc)}</strong>
            <small>
              {treasuryOverview === null
                ? 'Treasury data could not be loaded'
                : `${treasuryOverview.payments.agents_with_access} agents have payment access`}
            </small>
          </div>
        </section>

        <div className="canonical-overview-columns">
          <section aria-labelledby="overview-attention-title">
            <div className="canonical-overview-section-head">
              <div>
                <h2 id="overview-attention-title">Needs your attention</h2>
                <p>Current exceptions across the console, ordered by urgency.</p>
              </div>
              <span className="canonical-overview-count">{attentionItems.length} open</span>
            </div>
            {attentionItems.length === 0 ? (
              <div className="canonical-overview-empty-line">
                <span className="canonical-overview-attention-dot is-clear" aria-hidden="true" />
                <div>
                  <strong>No operator action required</strong>
                  <span>There are no pending approvals, agent readiness gaps, or failed liquidity jobs.</span>
                </div>
              </div>
            ) : (
              <div className="canonical-overview-attention-list">
                {attentionItems.map((item) => (
                  <div className="canonical-overview-attention" key={`${item.title}:${item.href}`}>
                    <span className={`canonical-overview-attention-dot is-${item.tone}`} aria-hidden="true" />
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.copy}</span>
                    </div>
                    <Link href={item.href}>
                      Inspect <IconArrowRight aria-hidden="true" size={12} stroke={1.8} />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="overview-activity-title">
            <div className="canonical-overview-section-head">
              <div>
                <h2 id="overview-activity-title">Recent activity</h2>
                <p>Newest hash-backed events across the organization.</p>
              </div>
              <Link className="canonical-overview-text-action" href={`/app/${org.slug}/operations`}>
                Open evidence <IconArrowRight aria-hidden="true" size={12} stroke={1.8} />
              </Link>
            </div>
            {recentEvidence.length === 0 ? (
              <div className="canonical-overview-empty-line">
                <span className="canonical-overview-event-icon" aria-hidden="true">AU</span>
                <div><strong>No evidence recorded</strong><span>Configuration and runtime events will appear here.</span></div>
              </div>
            ) : (
              <ol className="canonical-overview-activity-list">
                {recentEvidence.map((event) => (
                  <li key={event.id}>
                    <span className="canonical-overview-event-icon" aria-hidden="true">{event.eventDomain.slice(0, 2).toUpperCase()}</span>
                    <div>
                      <strong>{formatAction(event.action)}</strong>
                      <span>{formatEventContext(event.resourceType, event.eventDomain, event.outcome)}</span>
                    </div>
                    <time dateTime={event.recordedAt}>{formatRelativeTime(event.recordedAt)}</time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <section className="canonical-overview-roster" aria-labelledby="overview-roster-title">
          <div className="canonical-overview-section-head">
            <div>
              <h2 id="overview-roster-title">Agent roster</h2>
              <p>Recently registered identities and their operating readiness.</p>
            </div>
            <Link className="canonical-overview-text-action" href={`/app/${org.slug}/agents`}>
              Open registry <IconArrowRight aria-hidden="true" size={12} stroke={1.8} />
            </Link>
          </div>
          {roster.length === 0 ? (
            <div className="canonical-overview-roster-empty">
              <strong>No agents registered</strong>
              <p>Create an agent identity before issuing credentials or attaching policies.</p>
              <Link href={`/app/${org.slug}/agents`}>Open registry</Link>
            </div>
          ) : (
            <>
              <TableShell className="canonical-overview-table-shell" maxHeight={420}>
                <Table className="canonical-overview-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Credential</TableHead>
                      <TableHead>Policy coverage</TableHead>
                      <TableHead>Last activity</TableHead>
                      <TableHead aria-label="Open agent" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roster.map((agent) => (
                      <TableRow key={agent.id}>
                        <TableCell>
                          <Link className="canonical-overview-agent-cell" href={`/app/${org.slug}/agents/${agent.id}`}>
                            <span aria-hidden="true">{initials(agent.name)}</span>
                            <span><strong>{agent.name}</strong><code>{agent.id}</code></span>
                          </Link>
                        </TableCell>
                        <TableCell>{agent.team.name}</TableCell>
                        <TableCell><AgentStateBadge value={agent.status} /></TableCell>
                        <TableCell><AgentStateBadge value={connectionLabel(agent.connection_health)} /></TableCell>
                        <TableCell>{agent.policy_coverage} active</TableCell>
                        <TableCell>{agent.last_activity_at === null ? 'No activity' : formatRelativeTime(agent.last_activity_at)}</TableCell>
                        <TableCell>
                          <Link aria-label={`Open ${agent.name}`} className="canonical-overview-row-link" href={`/app/${org.slug}/agents/${agent.id}`}>
                            <IconArrowRight aria-hidden="true" size={13} stroke={1.8} />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableShell>
              <OverviewPager currentPage={agentPage} orgSlug={org.slug} total={agents.length} totalPages={totalAgentPages} />
            </>
          )}
        </section>
      </div>
    </ConsoleShell>
  );
}

function buildAttentionItems(input: {
  readonly agents: readonly AgentRosterItem[];
  readonly orgSlug: string;
  readonly pendingApprovals: Awaited<ReturnType<typeof listApprovals>>['approvals'];
  readonly treasuryOverview: TreasuryOverviewRecord | null;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const unhealthyAgents = input.agents.filter(
    (agent) => agent.status === 'active' && agent.connection_health !== 'healthy',
  );
  const uncoveredAgents = input.agents.filter(
    (agent) => agent.status === 'active' && agent.policy_coverage === 0,
  );

  if ((input.treasuryOverview?.liquidity.failed_jobs ?? 0) > 0) {
    const count = input.treasuryOverview?.liquidity.failed_jobs ?? 0;
    items.push({
      title: `${count} liquidity ${count === 1 ? 'job needs' : 'jobs need'} review`,
      copy: 'A provider-backed liquidity preparation failed and requires an operator decision.',
      href: `/app/${input.orgSlug}/payments/liquidity`,
      tone: 'danger',
    });
  }
  if (input.pendingApprovals.length > 0) {
    items.push({
      title: `${input.pendingApprovals.length} ${input.pendingApprovals.length === 1 ? 'approval is' : 'approvals are'} waiting`,
      copy: 'A managed action cannot continue until an operator approves or denies the request.',
      href: `/app/${input.orgSlug}/approvals`,
      tone: 'warning',
    });
  }
  if (unhealthyAgents.length > 0) {
    items.push({
      title: `${unhealthyAgents.length} active ${unhealthyAgents.length === 1 ? 'agent lacks' : 'agents lack'} a healthy credential`,
      copy: 'Runtime access is missing, stale, or revoked for an identity that remains active.',
      href: `/app/${input.orgSlug}/agents/${unhealthyAgents[0]?.id ?? ''}`,
      tone: 'warning',
    });
  }
  if (uncoveredAgents.length > 0) {
    items.push({
      title: `${uncoveredAgents.length} active ${uncoveredAgents.length === 1 ? 'agent has' : 'agents have'} no policy coverage`,
      copy: 'No active direct or inherited policy currently governs this identity.',
      href: `/app/${input.orgSlug}/agents/${uncoveredAgents[0]?.id ?? ''}`,
      tone: 'warning',
    });
  }

  return items;
}

function OverviewPager({ currentPage, orgSlug, total, totalPages }: {
  readonly currentPage: number;
  readonly orgSlug: string;
  readonly total: number;
  readonly totalPages: number;
}) {
  const start = total === 0 ? 0 : (currentPage - 1) * AGENT_PAGE_SIZE + 1;
  const end = Math.min(total, currentPage * AGENT_PAGE_SIZE);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).slice(
    Math.max(0, Math.min(currentPage - 2, totalPages - 3)),
    Math.max(0, Math.min(currentPage - 2, totalPages - 3)) + 3,
  );
  const hrefFor = (page: number) => `/app/${orgSlug}/overview?agent_page=${page}`;

  return (
    <nav aria-label="Agent roster pagination" className="canonical-overview-pager">
      <span>Showing {start}-{end} of {total}</span>
      <div>
        {currentPage > 1 ? <Link href={hrefFor(currentPage - 1)} aria-label="Previous agent roster page">‹</Link> : <span aria-hidden="true">‹</span>}
        {pageNumbers.map((page) => (
          <Link aria-current={page === currentPage ? 'page' : undefined} href={hrefFor(page)} key={page}>{page}</Link>
        ))}
        {currentPage < totalPages ? <Link href={hrefFor(currentPage + 1)} aria-label="Next agent roster page">›</Link> : <span aria-hidden="true">›</span>}
      </div>
      <span>{AGENT_PAGE_SIZE} per page</span>
    </nav>
  );
}

function AgentStateBadge({ value }: { readonly value: string }) {
  const normalized = value.toLowerCase().replaceAll(' ', '_');
  const tone = ['active', 'healthy'].includes(normalized)
    ? 'is-active'
    : ['stale', 'not_connected', 'paused'].includes(normalized)
      ? 'is-warning'
      : ['revoked', 'deactivated', 'suspended'].includes(normalized)
        ? 'is-danger'
        : '';
  return <span className={`canonical-overview-badge ${tone}`}>{value.replaceAll('_', ' ')}</span>;
}

function formatAction(value: string): string {
  const words = value.split(/[._-]/).filter(Boolean);
  return words.map((part, index) => index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part).join(' ');
}

function formatEventContext(resourceType: string | null, domain: string, outcome: string): string {
  const resource = resourceType === null ? domain : resourceType.replaceAll('_', ' ');
  return `${resource} · ${outcome.replaceAll('_', ' ')}`;
}

function formatRelativeTime(value: string): string {
  const elapsedMs = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsedMs)) return 'Unknown';
  const future = elapsedMs < 0;
  const absoluteMs = Math.abs(elapsedMs);
  const minutes = Math.floor(absoluteMs / 60_000);
  if (minutes < 1) return future ? 'in under a minute' : 'just now';
  if (minutes < 60) return future ? `in ${minutes} min` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return future ? `in ${hours} hr` : `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return future ? `in ${days} d` : `${days} d ago`;
}

function formatUsdc(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} USDC`;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)} USDC`;
}

function connectionLabel(value: AgentRosterItem['connection_health']): string {
  if (value === 'not_connected') return 'Not connected';
  return value;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AG';
  return parts.slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();
}

function workspaceSummary(attentionItems: readonly AttentionItem[], agentCount: number): string {
  if (agentCount === 0) return 'No agent identities have been registered in this workspace.';
  if (attentionItems.length === 0) return 'No current approval, identity coverage, or liquidity exception needs operator action.';
  const dangerCount = attentionItems.filter((item) => item.tone === 'danger').length;
  return dangerCount > 0
    ? `${dangerCount} provider failure ${dangerCount === 1 ? 'requires' : 'require'} immediate review.`
    : 'Identity or approval exceptions require operator review.';
}
