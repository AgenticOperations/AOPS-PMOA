'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { IconArrowRight } from '@tabler/icons-react';
import { AgentFleetStrip } from '@/components/agents/AgentFleetCard';
import { ConsoleRouteSkeleton } from '@/components/ConsoleRouteSkeleton';
import { HomeConnectGuide } from '@/components/home/HomeConnectGuide';
import {
  fetchOverviewHome,
  overviewHomeQueryKey,
  type OverviewHomeData,
} from '@/lib/overview-home';
import type { AgentRosterItem } from '@/lib/identity-spine-types';
import type { TreasuryOverviewRecord } from '@/lib/payments-types';

type OverviewHomeViewProps = {
  readonly appBaseUrl?: string | undefined;
  readonly orgSlug: string;
};

type AttentionItem = {
  readonly copy: string;
  readonly href: string;
  readonly title: string;
  readonly tone: 'danger' | 'warning';
};

export function OverviewHomeView({ appBaseUrl, orgSlug }: OverviewHomeViewProps) {
  const query = useQuery({
    queryKey: overviewHomeQueryKey(orgSlug),
    queryFn: () => fetchOverviewHome(orgSlug),
  });

  if (query.isPending && query.data === undefined) {
    return <ConsoleRouteSkeleton />;
  }

  if (query.isError && query.data === undefined) {
    return (
      <div className="canonical-overview-page">
        <header className="canonical-overview-header">
          <div>
            <p className="canonical-overview-eyebrow">Home</p>
            <h1>Overview</h1>
            <p className="canonical-overview-copy">
              {query.error instanceof Error ? query.error.message : 'Overview could not be loaded.'}
            </p>
          </div>
          <div className="canonical-overview-header-actions">
            <button className="canonical-overview-primary" onClick={() => void query.refetch()} type="button">
              Retry
            </button>
          </div>
        </header>
      </div>
    );
  }

  const data = query.data as OverviewHomeData;
  return <OverviewHomeContent appBaseUrl={appBaseUrl} data={data} />;
}

function OverviewHomeContent({
  appBaseUrl,
  data,
}: {
  readonly appBaseUrl?: string | undefined;
  readonly data: OverviewHomeData;
}) {
  const { agents, org, pendingApprovals, recentEvidence, treasuryOverview } = data;
  const activeAgents = agents.filter((agent) => agent.status === 'active').length;
  const agentsWithCredentials = agents.filter(
    (agent) =>
      agent.status === 'active'
      && (agent.connection_health === 'healthy' || agent.connection_health === 'stale'),
  ).length;
  const attentionItems = buildAttentionItems({
    agents,
    pendingApprovals,
    treasuryOverview,
    orgSlug: org.slug,
  });
  const oldestPendingApproval = [...pendingApprovals].sort(
    (left, right) => Date.parse(left.created_at) - Date.parse(right.created_at),
  )[0];
  const treasuryFunded = treasuryOverview !== null
    && Number.parseFloat(treasuryOverview.totals.treasury_usdc) > 0;
  const checklist = [
    {
      done: agents.length > 0,
      href: `/app/${org.slug}/agents`,
      label: 'Create or invite agent',
      detail: agents.length > 0 ? `${agents.length} registered` : 'Add agent → create or invite token',
    },
    {
      done: treasuryFunded,
      href: `/app/${org.slug}/payments/funding`,
      label: 'Fund treasury',
      detail: treasuryFunded ? 'USDC available' : 'Deposit USDC',
    },
    {
      done: agentsWithCredentials > 0,
      href: `/app/${org.slug}/agents`,
      label: 'Agent joined',
      detail: agentsWithCredentials > 0
        ? `${agentsWithCredentials} with credentials`
        : 'Invite token redeem or Connections',
    },
    {
      done: agents.some((agent) => agent.status === 'active' && agent.policy_coverage > 0),
      href: `/app/${org.slug}/controls`,
      label: 'Attach policy',
      detail: 'Controls decide what agents may do',
    },
  ];

  return (
    <div className="canonical-overview-page">
      <header className="canonical-overview-header">
        <div>
          <p className="canonical-overview-eyebrow">Home</p>
          <h1>Overview</h1>
          <p className="canonical-overview-copy">
            Govern agent spend — fund treasury, invite agents, review activity.
          </p>
        </div>
        <div className="canonical-overview-header-actions">
          <Link className="canonical-overview-primary" href={`/app/${org.slug}/agents`}>
            + New agent
          </Link>
        </div>
      </header>

      <section className="canonical-overview-status" aria-label="Workspace status">
        <div className="canonical-overview-metric">
          <span>Active agents</span>
          <strong>{activeAgents}</strong>
          <small>{agentsWithCredentials} with credentials</small>
        </div>
        <div className="canonical-overview-metric">
          <span>Pending approvals</span>
          <strong>{pendingApprovals.length}</strong>
          <small>
            {oldestPendingApproval === undefined
              ? 'Clear'
              : `Oldest ${formatRelativeTime(oldestPendingApproval.created_at)}`}
          </small>
        </div>
        <div className="canonical-overview-metric">
          <span>Treasury</span>
          <strong>{treasuryOverview === null ? '—' : formatUsdc(treasuryOverview.totals.treasury_usdc)}</strong>
          <small>
            {treasuryOverview === null
              ? 'Unavailable'
              : `${treasuryOverview.payments.agents_with_access} with access`}
          </small>
        </div>
        <div className="canonical-overview-metric">
          <span>Exceptions</span>
          <strong>{attentionItems.length}</strong>
          <small>{attentionItems.length === 0 ? 'All clear' : 'Needs review'}</small>
        </div>
      </section>

      <section aria-labelledby="overview-fleet-title" className="canonical-overview-fleet">
        <div className="canonical-overview-section-head">
          <div>
            <h2 id="overview-fleet-title">Agent fleet</h2>
          </div>
          <Link className="canonical-overview-text-action" href={`/app/${org.slug}/agents`}>
            All agents <IconArrowRight aria-hidden="true" size={12} stroke={1.8} />
          </Link>
        </div>
        <AgentFleetStrip agents={agents} orgSlug={org.slug} />
      </section>

      <div className="canonical-overview-columns">
        <section aria-labelledby="overview-attention-title">
          <div className="canonical-overview-section-head">
            <div>
              <h2 id="overview-attention-title">Needs attention</h2>
            </div>
            <span className="canonical-overview-count">{attentionItems.length}</span>
          </div>
          {attentionItems.length === 0 ? (
            <div className="canonical-overview-empty-line">
              <span className="canonical-overview-attention-dot is-clear" aria-hidden="true" />
              <div>
                <strong>Nothing waiting</strong>
                <span>Approvals, credentials, and liquidity look clear.</span>
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
                    Open <IconArrowRight aria-hidden="true" size={12} stroke={1.8} />
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
            </div>
            <Link className="canonical-overview-text-action" href={`/app/${org.slug}/operations`}>
              Evidence <IconArrowRight aria-hidden="true" size={12} stroke={1.8} />
            </Link>
          </div>
          {recentEvidence.length === 0 ? (
            <div className="canonical-overview-empty-line">
              <span className="canonical-overview-event-icon" aria-hidden="true">AU</span>
              <div><strong>No events yet</strong><span>Runtime and config events land here.</span></div>
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

      <HomeConnectGuide
        appBaseUrl={appBaseUrl}
        checklist={checklist}
        orgSlug={org.slug}
      />
    </div>
  );
}

function buildAttentionItems(input: {
  readonly agents: readonly AgentRosterItem[];
  readonly orgSlug: string;
  readonly pendingApprovals: OverviewHomeData['pendingApprovals'];
  readonly treasuryOverview: TreasuryOverviewRecord | null;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const missingCredentialAgents = input.agents.filter(
    (agent) =>
      agent.status === 'active'
      && (agent.connection_health === 'not_connected' || agent.connection_health === 'revoked'),
  );
  const staleCredentialAgents = input.agents.filter(
    (agent) => agent.status === 'active' && agent.connection_health === 'stale',
  );
  const uncoveredAgents = input.agents.filter(
    (agent) => agent.status === 'active' && agent.policy_coverage === 0,
  );

  if ((input.treasuryOverview?.liquidity.failed_jobs ?? 0) > 0) {
    const count = input.treasuryOverview?.liquidity.failed_jobs ?? 0;
    items.push({
      title: `${count} liquidity ${count === 1 ? 'job' : 'jobs'} failed`,
      copy: 'Review provider jobs in Treasury → Activity.',
      href: `/app/${input.orgSlug}/payments/activity?tab=jobs`,
      tone: 'danger',
    });
  }
  if (input.pendingApprovals.length > 0) {
    items.push({
      title: `${input.pendingApprovals.length} pending ${input.pendingApprovals.length === 1 ? 'approval' : 'approvals'}`,
      copy: 'An agent action is waiting on an operator.',
      href: `/app/${input.orgSlug}/approvals`,
      tone: 'warning',
    });
  }
  if (missingCredentialAgents.length > 0) {
    items.push({
      title: `${missingCredentialAgents.length} ${missingCredentialAgents.length === 1 ? 'agent needs' : 'agents need'} a credential`,
      copy: 'Active identity without an MCP credential.',
      href: `/app/${input.orgSlug}/agents/${missingCredentialAgents[0]?.id ?? ''}`,
      tone: 'warning',
    });
  }
  if (staleCredentialAgents.length > 0) {
    items.push({
      title: `${staleCredentialAgents.length} ${staleCredentialAgents.length === 1 ? 'credential is' : 'credentials are'} stale`,
      copy: 'Re-verify MCP or use the credential so health refreshes.',
      href: `/app/${input.orgSlug}/agents/${staleCredentialAgents[0]?.id ?? ''}?tab=credentials`,
      tone: 'warning',
    });
  }
  if (uncoveredAgents.length > 0) {
    items.push({
      title: `${uncoveredAgents.length} ${uncoveredAgents.length === 1 ? 'agent has' : 'agents have'} no policy`,
      copy: 'Attach a policy under Controls or the agent page.',
      href: `/app/${input.orgSlug}/agents/${uncoveredAgents[0]?.id ?? ''}`,
      tone: 'warning',
    });
  }

  return items;
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
