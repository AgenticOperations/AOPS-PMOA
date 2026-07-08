import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listApprovals } from '@/lib/server/approval-client';
import { approveApprovalAction, denyApprovalAction } from '@/app/actions/approvals';

export const dynamic = 'force-dynamic';

type ApprovalsPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

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
    { label: 'Resource', value: stringValue(resource, 'url') ?? stringValue(resource, 'domain') ?? stringValue(resource, 'category') },
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

export default async function ApprovalsPage({ params }: ApprovalsPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const { approvals } = await listApprovals(org.id);

  return (
    <ConsoleShell active="approvals" org={org}>
      <div className="ops-page">
        <header className="ops-page-header">
          <div>
            <h1>Approvals</h1>
            <p>One-time runtime requests waiting for a human decision.</p>
          </div>
        </header>

        <section className="ops-surface" aria-labelledby="approval-inbox-title">
          <div className="ops-surface-heading">
            <div>
              <h2 id="approval-inbox-title">Inbox</h2>
              <p>Requests are created only when an active policy requires approval.</p>
            </div>
            <span className="ops-count-pill">{approvals.length} request{approvals.length === 1 ? '' : 's'}</span>
          </div>

          {approvals.length === 0 ? (
            <div className="ops-empty-state">
              <h3>No approval requests</h3>
              <p>Approval-required runtime checks will appear here.</p>
            </div>
          ) : (
            <div className="ops-list" aria-label="Approval requests">
              {approvals.map((approval) => (
                <article className="ops-approval-row" key={approval.id}>
                  <div className="ops-approval-main">
                    <span className="ops-row-title">{approval.action_id}</span>
                    <span>Agent {approval.agent_id}</span>
                    <span>Decision {approval.decision_id}</span>
                    <span>
                      Target {approval.target_type}
                      {approval.target_id === null ? '' : `:${approval.target_id}`}
                    </span>
                    {approvalContextRows(approval.context).map((row) => (
                      <span key={row.label}>{row.label}: {row.value}</span>
                    ))}
                  </div>
                  <div className="ops-approval-actions">
                    <span className={`ops-state-pill ops-state-${approval.status}`}>{approval.status}</span>
                    <time dateTime={approval.created_at}>{new Date(approval.created_at).toLocaleString()}</time>
                    {approval.status === 'pending' ? (
                      <div className="ops-button-row">
                        <form action={approveApprovalAction.bind(null, org.id, org.slug, approval.id)}>
                          <button className="button-primary" type="submit">
                            Approve
                          </button>
                        </form>
                        <form action={denyApprovalAction.bind(null, org.id, org.slug, approval.id)}>
                          <button className="button-danger" type="submit">
                            Deny
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </ConsoleShell>
  );
}
