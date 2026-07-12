import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { ApprovalIndex } from '@/components/approvals/ApprovalIndex';
import { ApprovalFilters } from '@/components/approvals/ApprovalFilters';
import { approveApprovalAction, denyApprovalAction } from '@/app/actions/approvals';
import type { ApprovalRecord } from '@/lib/approval-types';
import { listApprovals } from '@/lib/server/approval-client';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';

export const dynamic = 'force-dynamic';

type ApprovalsPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
  readonly searchParams?: Promise<Record<string, string | readonly string[] | undefined>>;
};

type ApprovalStatus = ApprovalRecord['status'];
type StatusFilter = ApprovalStatus | 'all';
type ApprovalTab = 'inbox' | 'history';

const approvalStatuses: readonly ApprovalStatus[] = ['pending', 'approved', 'denied', 'expired', 'cancelled', 'consumed'];
const pageSize = 10;

function singleParam(value: string | readonly string[] | undefined): string {
  if (typeof value === 'string') return value;
  return value?.[0] ?? '';
}

function normalizeStatus(value: string): StatusFilter {
  return approvalStatuses.includes(value as ApprovalStatus) ? value as ApprovalStatus : 'all';
}

function normalizeTab(value: string): ApprovalTab {
  return value === 'history' ? 'history' : 'inbox';
}

function normalizePage(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function pageHref(orgSlug: string, nextPage: number, filters: {
  readonly status: StatusFilter;
  readonly action: string;
  readonly agent: string;
  readonly tab: ApprovalTab;
}): string {
  const params = new URLSearchParams();
  if (filters.tab !== 'inbox') params.set('tab', filters.tab);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.action.length > 0) params.set('action', filters.action);
  if (filters.agent.length > 0) params.set('agent', filters.agent);
  if (nextPage > 1) params.set('page', String(nextPage));
  const query = params.toString();
  return query.length === 0 ? `/app/${orgSlug}/approvals` : `/app/${orgSlug}/approvals?${query}`;
}

export default async function ApprovalsPage({ params, searchParams }: ApprovalsPageProps) {
  const { orgSlug } = await params;
  const query = (await searchParams) ?? {};
  const statusFilter = normalizeStatus(singleParam(query.status));
  const activeTab = normalizeTab(singleParam(query.tab));
  const actionFilter = singleParam(query.action).trim();
  const agentFilter = singleParam(query.agent).trim();
  const pageNumber = normalizePage(singleParam(query.page));
  const renderedAt = new Date().toISOString();

  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const { approvals } = await listApprovals(org.id);
  const tabApprovals = approvals.filter((approval) => activeTab === 'inbox' ? approval.status === 'pending' : approval.status !== 'pending');
  const filteredApprovals = tabApprovals.filter((approval) => {
    if (statusFilter !== 'all' && approval.status !== statusFilter) return false;
    if (actionFilter.length > 0 && !approval.action_id.toLowerCase().includes(actionFilter.toLowerCase())) return false;
    if (agentFilter.length > 0 && !approval.agent_id.toLowerCase().includes(agentFilter.toLowerCase())) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filteredApprovals.length / pageSize));
  const currentPage = Math.min(pageNumber, totalPages);
  const visibleApprovals = filteredApprovals.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const actions = Object.fromEntries(visibleApprovals.map((approval) => [approval.id, {
    approve: approveApprovalAction.bind(null, org.id, org.slug, approval.id),
    deny: denyApprovalAction.bind(null, org.id, org.slug, approval.id),
  }]));

  return (
    <ConsoleShell active="approvals" org={org}>
      <div className="approvals-workbench">
        <nav aria-label="Approval sections" className="approval-subnav">
          <Link aria-current={activeTab === 'inbox' ? 'page' : undefined} className={activeTab === 'inbox' ? 'is-active' : ''} href={`/app/${org.slug}/approvals`}>Inbox</Link>
          <Link aria-current={activeTab === 'history' ? 'page' : undefined} className={activeTab === 'history' ? 'is-active' : ''} href={`/app/${org.slug}/approvals?tab=history`}>History</Link>
        </nav>

        <header className="approval-page-header">
          <div>
            <p className="approval-eyebrow">Runtime / human decisions</p>
            <h1>Approvals</h1>
            <p>Resolve one-time policy exceptions with their full context, expiry, decision, and consumption trail.</p>
          </div>
        </header>

        <ApprovalFilters
          action={actionFilter}
          agent={agentFilter}
          clearHref={activeTab === 'inbox' ? `/app/${org.slug}/approvals` : `/app/${org.slug}/approvals?tab=history`}
          formAction={`/app/${org.slug}/approvals`}
          status={statusFilter}
          statuses={activeTab === 'inbox' ? ['pending'] : ['approved', 'denied', 'expired', 'cancelled', 'consumed']}
          tab={activeTab}
        />

        <section className="approval-index-section" aria-labelledby="approval-index-title">
          <div className="approval-index-heading">
            <div><h2 id="approval-index-title">{activeTab === 'inbox' ? 'Pending requests' : 'Approval history'}</h2><p>Each request remains tied to its decision, target, context hash, expiry, and consumption evidence.</p></div>
            <span>{filteredApprovals.length} of {tabApprovals.length}</span>
          </div>
          <div className="approval-index-body">
            {visibleApprovals.length === 0 ? (
              <div className="console-empty-state"><h3>{activeTab === 'inbox' ? 'No pending approvals' : 'No matching approval history'}</h3><p>Approval-required managed requests appear here with their persisted policy context.</p></div>
            ) : <ApprovalIndex actions={actions} approvals={visibleApprovals} renderedAt={renderedAt} />}
          </div>

          <ApprovalPager
            action={actionFilter}
            agent={agentFilter}
            currentPage={currentPage}
            orgSlug={org.slug}
            status={statusFilter}
            tab={activeTab}
            total={filteredApprovals.length}
            totalPages={totalPages}
          />
        </section>
      </div>
    </ConsoleShell>
  );
}

function ApprovalPager({ action, agent, currentPage, orgSlug, status, tab, total, totalPages }: {
  readonly action: string;
  readonly agent: string;
  readonly currentPage: number;
  readonly orgSlug: string;
  readonly status: StatusFilter;
  readonly tab: ApprovalTab;
  readonly total: number;
  readonly totalPages: number;
}) {
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(total, currentPage * pageSize);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).slice(
    Math.max(0, Math.min(currentPage - 2, totalPages - 3)),
    Math.max(0, Math.min(currentPage - 2, totalPages - 3)) + 3,
  );
  const href = (page: number) => pageHref(orgSlug, page, { status, action, agent, tab });

  return (
    <nav aria-label="Approval pagination" className="approval-pager">
      <span>Showing {start}-{end} of {total}</span>
      <div>
        {currentPage > 1 ? <Link aria-label="Previous approval page" href={href(currentPage - 1)}>‹</Link> : <span aria-hidden="true">‹</span>}
        {pageNumbers.map((page) => <Link aria-current={page === currentPage ? 'page' : undefined} href={href(page)} key={page}>{page}</Link>)}
        {currentPage < totalPages ? <Link aria-label="Next approval page" href={href(currentPage + 1)}>›</Link> : <span aria-hidden="true">›</span>}
      </div>
      <span>{pageSize} per page</span>
    </nav>
  );
}
