'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ApprovalRecord } from '@/lib/approval-types';

type ApprovalStatus = ApprovalRecord['status'];

type ApprovalFiltersProps = {
  readonly action: string;
  readonly agent: string;
  readonly clearHref: string;
  readonly formAction: string;
  readonly status: ApprovalStatus | 'all';
  readonly statuses: readonly ApprovalStatus[];
  readonly tab: 'inbox' | 'history';
};

function label(value: string): string {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function ApprovalFilters({ action, agent, clearHref, formAction, status, statuses, tab }: ApprovalFiltersProps) {
  const [draftStatus, setDraftStatus] = useState(status);
  const [draftAction, setDraftAction] = useState(action);
  const [draftAgent, setDraftAgent] = useState(agent);
  const dirty = draftStatus !== status || draftAction !== action || draftAgent !== agent;
  const applied = status !== 'all' || action.length > 0 || agent.length > 0;

  return (
    <form action={formAction} className="approval-filter-bar">
      <input name="tab" type="hidden" value={tab} />
      <label>
        <span>Status</span>
        <select name="status" onChange={(event) => setDraftStatus(event.target.value as ApprovalStatus | 'all')} value={draftStatus}>
          <option value="all">All statuses</option>
          {statuses.map((candidate) => <option key={candidate} value={candidate}>{label(candidate)}</option>)}
        </select>
      </label>
      <label>
        <span>Action</span>
        <input name="action" onChange={(event) => setDraftAction(event.target.value)} placeholder="Search action" value={draftAction} />
      </label>
      <label>
        <span>Agent</span>
        <input name="agent" onChange={(event) => setDraftAgent(event.target.value)} placeholder="Search agent ID" value={draftAgent} />
      </label>
      <div className="approval-filter-actions">
        {applied ? <Link href={clearHref}>Clear</Link> : null}
        {dirty ? <button type="submit">Apply</button> : null}
      </div>
    </form>
  );
}
