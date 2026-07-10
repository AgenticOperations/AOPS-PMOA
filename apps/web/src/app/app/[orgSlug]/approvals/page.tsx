import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { OrgAuditPanel } from '@/components/audit/OrgAuditPanel';
import { PageHeader } from '@/components/ui/page-header';
import { approveApprovalAction, denyApprovalAction } from '@/app/actions/approvals';
import type { ApprovalActionRecord, ApprovalRecord } from '@/lib/approval-types';
import { listAuditEvents } from '@/lib/server/audit-client';
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
  return approvalStatuses.includes(value as ApprovalStatus) ? (value as ApprovalStatus) : 'all';
}

function normalizeTab(value: string): ApprovalTab {
  return value === 'history' ? 'history' : 'inbox';
}

function normalizePage(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function titleCase(value: string): string {
  return value
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function objectValue(value: unknown, key: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const child = (value as Record<string, unknown>)[key];
  return child !== null && typeof child === 'object' && !Array.isArray(child) ? (child as Record<string, unknown>) : {};
}

function stringValue(value: Record<string, unknown>, key: string): string | null {
  const child = value[key];
  return typeof child === 'string' && child.trim().length > 0 ? child : null;
}

function approvalContextRows(context: Record<string, unknown>): Array<{ readonly label: string; readonly value: string }> {
  const resource = objectValue(context, 'resource');
  const payment = objectValue(context, 'payment');
  const tool = objectValue(context, 'tool');
  const rows = [
    {
      label: 'Resource',
      value: stringValue(resource, 'url') ?? stringValue(resource, 'domain') ?? stringValue(resource, 'category'),
    },
    {
      label: 'Payment',
      value:
        stringValue(payment, 'amount') === null
          ? null
          : `${stringValue(payment, 'amount')} ${stringValue(payment, 'asset') ?? ''}`.trim(),
    },
    { label: 'Tool', value: stringValue(tool, 'name') },
  ];
  return rows.filter((row): row is { readonly label: string; readonly value: string } => row.value !== null);
}

function timeText(value: string): string {
  return new Date(value).toLocaleString();
}

function expiryText(expiresAt: string): string {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const minutes = Math.max(1, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes === 0 ? `${hours} hr left` : `${hours} hr ${remainingMinutes} min left`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day left' : `${days} days left`;
}

function fallbackActions(approval: ApprovalRecord): readonly ApprovalActionRecord[] {
  const actions: ApprovalActionRecord[] = [
    {
      id: `${approval.id}:requested`,
      actor_type: 'connection',
      actor_id: approval.requested_by,
      action: 'requested',
      note: '',
      created_at: approval.created_at,
    },
  ];
  if (approval.approved_at !== null && approval.approved_by !== null) {
    actions.push({
      id: `${approval.id}:approved`,
      actor_type: 'user',
      actor_id: approval.approved_by,
      action: 'approved',
      note: approval.note,
      created_at: approval.approved_at,
    });
  }
  if (approval.denied_at !== null && approval.denied_by !== null) {
    actions.push({
      id: `${approval.id}:denied`,
      actor_type: 'user',
      actor_id: approval.denied_by,
      action: 'denied',
      note: approval.note,
      created_at: approval.denied_at,
    });
  }
  if (approval.consumed_at !== null) {
    actions.push({
      id: `${approval.id}:consumed`,
      actor_type: 'connection',
      actor_id: approval.connection_id,
      action: 'consumed',
      note: '',
      created_at: approval.consumed_at,
    });
  }
  return actions;
}

function actionTimeline(approval: ApprovalRecord): readonly ApprovalActionRecord[] {
  return approval.actions !== undefined && approval.actions.length > 0 ? approval.actions : fallbackActions(approval);
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

  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [{ approvals }, auditEvents] = await Promise.all([listApprovals(org.id), listAuditEvents(org.id, 30)]);
  const tabApprovals = approvals.filter((approval) =>
    activeTab === 'inbox' ? approval.status === 'pending' : approval.status !== 'pending',
  );
  const filteredApprovals = tabApprovals.filter((approval) => {
    if (statusFilter !== 'all' && approval.status !== statusFilter) return false;
    if (actionFilter.length > 0 && !approval.action_id.toLowerCase().includes(actionFilter.toLowerCase())) return false;
    if (agentFilter.length > 0 && !approval.agent_id.toLowerCase().includes(agentFilter.toLowerCase())) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filteredApprovals.length / pageSize));
  const currentPage = Math.min(pageNumber, totalPages);
  const visibleApprovals = filteredApprovals.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pendingCount = approvals.filter((approval) => approval.status === 'pending').length;
  const consumedCount = approvals.filter((approval) => approval.status === 'consumed').length;
  const finalCount = approvals.filter((approval) => ['approved', 'denied', 'expired', 'cancelled', 'consumed'].includes(approval.status)).length;

  return (
    <ConsoleShell active="approvals" org={org}>
      <div className="ops-page approvals-workbench">
        <PageHeader
          className="approvals-header"
          description="Review one-time runtime exceptions, preserve the decision trail, and verify consumption."
          title="Approvals"
          actions={
          <div className="approvals-stats" aria-label="Approval queue summary">
            <div>
              <span>Pending</span>
              <strong>{pendingCount}</strong>
            </div>
            <div>
              <span>Consumed</span>
              <strong>{consumedCount}</strong>
            </div>
            <div>
              <span>Closed</span>
              <strong>{finalCount}</strong>
            </div>
          </div>
          }
        />

        <nav aria-label="Approval sections" className="settings-tabs">
          <Link
            aria-current={activeTab === 'inbox' ? 'page' : undefined}
            className={activeTab === 'inbox' ? 'is-active' : ''}
            href={`/app/${org.slug}/approvals`}
          >
            Inbox
          </Link>
          <Link
            aria-current={activeTab === 'history' ? 'page' : undefined}
            className={activeTab === 'history' ? 'is-active' : ''}
            href={`/app/${org.slug}/approvals?tab=history`}
          >
            History
          </Link>
        </nav>

        <section className="ops-surface" aria-labelledby="approval-inbox-title">
          <div className="ops-surface-heading approvals-surface-heading">
            <div>
              <h2 id="approval-inbox-title">{activeTab === 'inbox' ? 'Inbox' : 'Approval history'}</h2>
              <p>Every request is tied to a policy decision, target context, expiry, and single-use consumption hash.</p>
            </div>
            <span className="ops-count-pill">
              {filteredApprovals.length} of {tabApprovals.length}
            </span>
          </div>

          <form className="approvals-filter-bar" action={`/app/${org.slug}/approvals`}>
            <input name="tab" type="hidden" value={activeTab} />
            <label>
              <span>Status</span>
              <select defaultValue={statusFilter} name="status">
                <option value="all">All statuses</option>
                {approvalStatuses.map((status) => (
                  <option key={status} value={status}>
                    {titleCase(status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Action</span>
              <input defaultValue={actionFilter} name="action" placeholder="payment.x402.authorize" />
            </label>
            <label>
              <span>Agent</span>
              <input defaultValue={agentFilter} name="agent" placeholder="agt_..." />
            </label>
            <div className="approvals-filter-actions">
              <button className="button-secondary" type="submit">
                Apply
              </button>
              <Link
                className="button-ghost"
                href={activeTab === 'inbox' ? `/app/${org.slug}/approvals` : `/app/${org.slug}/approvals?tab=history`}
              >
                Reset
              </Link>
            </div>
          </form>

          {visibleApprovals.length === 0 ? (
            <div className="ops-empty-state">
              <h3>{activeTab === 'inbox' ? 'No pending approvals' : 'No matching approval history'}</h3>
              <p>Approval-required runtime checks will appear here when policy evaluation returns approval_required.</p>
            </div>
          ) : (
            <div className="approvals-list" aria-label="Approval requests">
              {visibleApprovals.map((approval) => {
                const contextRows = approvalContextRows(approval.context);
                const actions = actionTimeline(approval);
                return (
                  <article className="approval-card" key={approval.id}>
                    <div className="approval-card-main">
                      <div className="approval-title-row">
                        <div>
                          <span className="approval-eyebrow">{approval.action_id}</span>
                          <h3>{titleCase(approval.status)} request</h3>
                        </div>
                        <span className={`ops-state-pill ops-state-${approval.status}`}>{approval.status}</span>
                      </div>

                      <div className="approval-meta-grid">
                        <div>
                          <span>Agent</span>
                          <strong>{approval.agent_id}</strong>
                        </div>
                        <div>
                          <span>Decision</span>
                          <strong>{approval.decision_id}</strong>
                        </div>
                        <div>
                          <span>Target</span>
                          <strong>
                            {approval.target_type}
                            {approval.target_id === null ? '' : `:${approval.target_id}`}
                          </strong>
                        </div>
                        <div>
                          <span>Expires</span>
                          <strong>{expiryText(approval.expires_at)}</strong>
                        </div>
                      </div>

                      {contextRows.length > 0 ? (
                        <dl className="approval-context-grid">
                          {contextRows.map((row) => (
                            <div key={row.label}>
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}

                      <div className="approval-proof-grid">
                        <div>
                          <span>Request</span>
                          <strong>{approval.id}</strong>
                          <small>
                            Created <time dateTime={approval.created_at}>{timeText(approval.created_at)}</time>
                          </small>
                        </div>
                        <div>
                          <span>Context hash</span>
                          <strong>{approval.context_hash}</strong>
                          <small>Replay guard for the original request context.</small>
                        </div>
                        {approval.consumption !== null && approval.consumption !== undefined ? (
                          <div>
                            <span>Consumption proof</span>
                            <strong>{approval.consumption.id}</strong>
                            <small>
                              Decision {approval.consumption.decision_id} · {timeText(approval.consumption.created_at)}
                            </small>
                          </div>
                        ) : null}
                      </div>

                      <div className="approval-timeline" aria-label={`Approval ${approval.id} history`}>
                        {actions.map((action) => (
                          <div className="approval-timeline-row" key={action.id}>
                            <span>{titleCase(action.action)}</span>
                            <strong>
                              {action.actor_type}:{action.actor_id}
                            </strong>
                            <time dateTime={action.created_at}>{timeText(action.created_at)}</time>
                            {action.note.trim().length > 0 ? <em>{action.note}</em> : null}
                          </div>
                        ))}
                      </div>
                    </div>

                    {approval.status === 'pending' ? (
                      <div className="approval-decision-panel">
                        <form action={approveApprovalAction.bind(null, org.id, org.slug, approval.id)}>
                          <label>
                            <span>Decision note</span>
                            <input name="note" placeholder="Why this request is acceptable" />
                          </label>
                          <button className="button-primary" type="submit">
                            Approve
                          </button>
                        </form>
                        <form action={denyApprovalAction.bind(null, org.id, org.slug, approval.id)}>
                          <label>
                            <span>Decision note</span>
                            <input name="note" placeholder="Why this request is denied" />
                          </label>
                          <button className="button-danger" type="submit">
                            Deny
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}

          {filteredApprovals.length > pageSize ? (
            <nav className="approvals-pagination" aria-label="Approval pagination">
              <Link
                aria-disabled={currentPage === 1}
                className={`button-secondary ${currentPage === 1 ? 'is-disabled' : ''}`}
                href={pageHref(org.slug, Math.max(1, currentPage - 1), {
                  status: statusFilter,
                  action: actionFilter,
                  agent: agentFilter,
                  tab: activeTab,
                })}
              >
                Previous
              </Link>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <Link
                aria-disabled={currentPage === totalPages}
                className={`button-secondary ${currentPage === totalPages ? 'is-disabled' : ''}`}
                href={pageHref(org.slug, Math.min(totalPages, currentPage + 1), {
                  status: statusFilter,
                  action: actionFilter,
                  agent: agentFilter,
                  tab: activeTab,
                })}
              >
                Next
              </Link>
            </nav>
          ) : null}
        </section>
        <OrgAuditPanel
          description="Approval requests, grants, denials, and one-time consumption events recorded in the immutable audit chain."
          domains={['system']}
          emptyText="No approval audit events have been recorded yet."
          events={auditEvents.events.filter((event) => event.action.startsWith('approval.'))}
          title="Approval audit"
        />
      </div>
    </ConsoleShell>
  );
}
