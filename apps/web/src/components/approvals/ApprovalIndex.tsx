'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconArrowRight } from '@tabler/icons-react';
import type { ApprovalActionRecord, ApprovalRecord } from '@/lib/approval-types';
import { formatUtcDateTime } from '@/lib/date-format';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

type ApprovalIndexProps = {
  readonly approvals: readonly ApprovalRecord[];
  readonly renderedAt: string;
  readonly actions: Readonly<Record<string, {
    readonly approve: (formData: FormData) => Promise<void>;
    readonly deny: (formData: FormData) => Promise<void>;
  }>>;
};

function titleCase(value: string): string {
  return value.split(/[_\s]+/g).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function objectValue(value: unknown, key: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const child = (value as Record<string, unknown>)[key];
  return child !== null && typeof child === 'object' && !Array.isArray(child) ? child as Record<string, unknown> : {};
}

function stringValue(value: Record<string, unknown>, key: string): string | null {
  const child = value[key];
  return typeof child === 'string' && child.trim().length > 0 ? child : null;
}

function contextSummary(approval: ApprovalRecord): string {
  const payment = objectValue(approval.context, 'payment');
  const resource = objectValue(approval.context, 'resource');
  const tool = objectValue(approval.context, 'tool');
  const amount = stringValue(payment, 'amount');
  if (amount !== null) return `${amount} ${stringValue(payment, 'asset') ?? ''}`.trim();
  return stringValue(resource, 'domain') ?? stringValue(resource, 'category') ?? stringValue(tool, 'name') ?? 'Recorded context';
}

function contextRows(context: Record<string, unknown>): Array<{ readonly label: string; readonly value: string }> {
  const payment = objectValue(context, 'payment');
  const resource = objectValue(context, 'resource');
  const tool = objectValue(context, 'tool');
  return [
    { label: 'Resource', value: stringValue(resource, 'url') ?? stringValue(resource, 'domain') ?? stringValue(resource, 'category') },
    { label: 'Payment', value: stringValue(payment, 'amount') === null ? null : `${stringValue(payment, 'amount')} ${stringValue(payment, 'asset') ?? ''}`.trim() },
    { label: 'Tool', value: stringValue(tool, 'name') },
  ].filter((row): row is { readonly label: string; readonly value: string } => row.value !== null);
}

function fallbackActions(approval: ApprovalRecord): readonly ApprovalActionRecord[] {
  const actions: ApprovalActionRecord[] = [{ id: `${approval.id}:requested`, actor_type: 'connection', actor_id: approval.requested_by, action: 'requested', note: '', created_at: approval.created_at }];
  if (approval.approved_at !== null && approval.approved_by !== null) actions.push({ id: `${approval.id}:approved`, actor_type: 'user', actor_id: approval.approved_by, action: 'approved', note: approval.note, created_at: approval.approved_at });
  if (approval.denied_at !== null && approval.denied_by !== null) actions.push({ id: `${approval.id}:denied`, actor_type: 'user', actor_id: approval.denied_by, action: 'denied', note: approval.note, created_at: approval.denied_at });
  if (approval.consumed_at !== null) actions.push({ id: `${approval.id}:consumed`, actor_type: 'connection', actor_id: approval.connection_id, action: 'consumed', note: '', created_at: approval.consumed_at });
  return actions;
}

function expiryLabel(value: string, nowMs: number): string {
  const remainingMs = Date.parse(value) - nowMs;
  if (!Number.isFinite(remainingMs)) return 'Invalid expiry';
  if (remainingMs <= 0) return 'Expired';
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  if (minutes < 60) return `Expires in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `Expires in ${hours} hr${remainder === 0 ? '' : ` ${remainder} min`}`;
}

export function ApprovalIndex({ actions, approvals, renderedAt }: ApprovalIndexProps) {
  const router = useRouter();
  const refreshRef = useRef(router.refresh);
  refreshRef.current = router.refresh;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.parse(renderedAt));
  const selected = approvals.find((approval) => approval.id === selectedId);
  const selectedActions = selected === undefined ? [] : selected.actions?.length ? selected.actions : fallbackActions(selected);
  const selectedMutation = selected === undefined ? undefined : actions[selected.id];
  const selectedExpired = selected?.status === 'pending' && Date.parse(selected.expires_at) <= nowMs;

  useEffect(() => {
    const updateClock = () => setNowMs(Date.now());
    updateClock();
    const interval = window.setInterval(updateClock, 30_000);
    const futureExpiries = approvals
      .filter((approval) => approval.status === 'pending')
      .map((approval) => Date.parse(approval.expires_at))
      .filter((expiresAt) => Number.isFinite(expiresAt) && expiresAt > Date.now());
    const nextExpiry = futureExpiries.length === 0 ? null : Math.min(...futureExpiries);
    const expiryDelay = nextExpiry === null ? null : nextExpiry - Date.now() + 100;
    const timeout = expiryDelay === null || expiryDelay > 2_147_483_647 ? null : window.setTimeout(() => {
      updateClock();
      refreshRef.current();
    }, Math.max(0, expiryDelay));
    return () => {
      window.clearInterval(interval);
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [approvals]);

  return (
    <>
      <TableShell className="approval-table-shell" maxHeight={620}>
        <Table aria-label="Approval requests" className="approval-table">
          <TableHeader><TableRow><TableHead>Request</TableHead><TableHead>Agent</TableHead><TableHead>Context</TableHead><TableHead>Expires / updated</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Review</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {approvals.map((approval) => {
              const expired = approval.status === 'pending' && Date.parse(approval.expires_at) <= nowMs;
              const displayStatus = expired ? 'expired' : approval.status;
              return <TableRow key={approval.id}>
                <TableCell><div className="approval-index-primary"><strong>{approval.action_id}</strong><span>{approval.id}</span></div></TableCell>
                <TableCell><code>{approval.agent_id}</code></TableCell>
                <TableCell>{contextSummary(approval)}</TableCell>
                <TableCell>
                  <time
                    dateTime={approval.status === 'pending' ? approval.expires_at : approval.updated_at}
                    title={formatUtcDateTime(approval.status === 'pending' ? approval.expires_at : approval.updated_at)}
                  >
                    {approval.status === 'pending' ? expiryLabel(approval.expires_at, nowMs) : formatUtcDateTime(approval.updated_at)}
                  </time>
                </TableCell>
                <TableCell><StatusBadge status={displayStatus} /></TableCell>
                <TableCell><button aria-label={`Review ${approval.id}`} className="table-row-action" onClick={() => setSelectedId(approval.id)} type="button"><IconArrowRight aria-hidden="true" size={13} stroke={1.8} /></button></TableCell>
              </TableRow>;
            })}
          </TableBody>
        </Table>
      </TableShell>

      <Sheet labelledBy="approval-detail-title" onOpenChange={(open) => !open && setSelectedId(null)} open={selected !== undefined} panelClassName="approval-drawer">
        <SheetHeader>
          <div><SheetTitle id="approval-detail-title">Approval request</SheetTitle><SheetDescription>{selected?.action_id ?? 'Runtime approval context and evidence.'}</SheetDescription></div>
          <SheetCloseButton ariaLabel="Close" onClick={() => setSelectedId(null)} />
        </SheetHeader>
        <SheetBody>
          {selected !== undefined ? (
            <div className="approval-drawer-content">
              <div className="approval-drawer-status"><StatusBadge status={selectedExpired ? 'expired' : selected.status} /><code>{selected.id}</code></div>
              <dl className="approval-detail-grid">
                <div><dt>Agent</dt><dd>{selected.agent_id}</dd></div>
                <div><dt>Decision</dt><dd>{selected.decision_id}</dd></div>
                <div><dt>Target</dt><dd>{selected.target_type}{selected.target_id === null ? '' : `:${selected.target_id}`}</dd></div>
                <div><dt>Expires</dt><dd>{formatUtcDateTime(selected.expires_at)}</dd></div>
                {contextRows(selected.context).map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
              </dl>
              <section className="approval-proof-section"><h3>Evidence</h3><dl><div><dt>Context hash</dt><dd><code>{selected.context_hash}</code></dd></div>{selected.consumption ? <div><dt>Consumption proof</dt><dd><code>{selected.consumption.id}</code></dd></div> : null}</dl></section>
              <section className="approval-proof-section"><h3>Decision history</h3><ol className="approval-drawer-timeline">{selectedActions.map((action) => <li key={action.id}><span>{titleCase(action.action)}</span><strong>{action.actor_type}:{action.actor_id}</strong><time dateTime={action.created_at}>{formatUtcDateTime(action.created_at)}</time>{action.note ? <p>{action.note}</p> : null}</li>)}</ol></section>
              {selected.status === 'pending' && selectedExpired ? <p className="approval-expired-note">This request reached its persisted expiry deadline and can no longer be decided.</p> : null}
              {selected.status === 'pending' && !selectedExpired && selectedMutation !== undefined ? <ApprovalDecisionActions actions={selectedMutation} approvalId={selected.id} key={selected.id} onComplete={() => { setSelectedId(null); router.refresh(); }} /> : null}
            </div>
          ) : null}
        </SheetBody>
      </Sheet>
    </>
  );
}

function ApprovalDecisionActions({ actions, approvalId, onComplete }: {
  readonly actions: { readonly approve: (formData: FormData) => Promise<void>; readonly deny: (formData: FormData) => Promise<void> };
  readonly approvalId: string;
  readonly onComplete: () => void;
}) {
  const [approveState, approveAction, approvePending] = useActionState(async (_state: { readonly error?: string }, formData: FormData) => {
    try { await actions.approve(formData); onComplete(); return {}; }
    catch (error) { return { error: error instanceof Error ? error.message : 'The request could not be approved.' }; }
  }, {});
  const [denyState, denyAction, denyPending] = useActionState(async (_state: { readonly error?: string }, formData: FormData) => {
    try { await actions.deny(formData); onComplete(); return {}; }
    catch (error) { return { error: error instanceof Error ? error.message : 'The request could not be denied.' }; }
  }, {});
  const busy = approvePending || denyPending;
  return (
    <div className="approval-drawer-actions" key={approvalId}>
      <form action={approveAction}><label><span>Approval note</span><input name="note" placeholder="Reason for approval" /></label>{approveState.error === undefined ? null : <p className="form-error" role="alert">{approveState.error}</p>}<button className="console-primary-button" disabled={busy} type="submit">{approvePending ? 'Approving…' : 'Approve'}</button></form>
      <form action={denyAction}><label><span>Denial note</span><input name="note" placeholder="Reason for denial" /></label>{denyState.error === undefined ? null : <p className="form-error" role="alert">{denyState.error}</p>}<button className="button-danger" disabled={busy} type="submit">{denyPending ? 'Denying…' : 'Deny'}</button></form>
    </div>
  );
}
