'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowRight } from '@tabler/icons-react';
import type { AuditEventRecord } from '@/lib/audit-types';
import type {
  PolicyActionRecord,
  PolicyDraft,
  PolicySimulationRecord,
  PolicyStatement,
  PolicyVersion,
} from '@/lib/policy-types';
import { Sheet, SheetCloseButton } from '@/components/ui/sheet';
import { DataTablePager } from '@/components/ui/data-table-pager';
import { PolicyDraftBuilder } from './PolicyDraftBuilder';

type BindTargetType = 'agent' | 'connection' | 'org' | 'team';

type BindTarget = {
  readonly id: string;
  readonly label: string;
  readonly type: BindTargetType;
};

type ControlsLibraryProps = {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly drafts: PolicyDraft[];
  readonly policies: PolicyVersion[];
  readonly activityEvents?: readonly AuditEventRecord[] | undefined;
  readonly policyActions?: readonly PolicyActionRecord[] | undefined;
  readonly simulations?: readonly PolicySimulationRecord[] | undefined;
  readonly bindTargets?: readonly BindTarget[] | undefined;
  readonly createAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly validateAction?: ((draftId: string) => Promise<void>) | undefined;
  readonly activateAction?: ((draftId: string) => Promise<void>) | undefined;
  readonly activateRevisionAction?: ((draftId: string) => Promise<void>) | undefined;
  readonly updateDraftAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly discardDraftAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly simulateDraftAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly archivePolicyAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly createRevisionDraftAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly createRestoreDraftAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly bindAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly removeBindingAction?: ((formData: FormData) => Promise<void>) | undefined;
};

type DrawerState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'detail'; readonly policyKey: string }
  | { readonly kind: 'draft'; readonly draftId: string };

type TableView = 'library' | 'drafts' | 'activity';
type PolicyDetailTab = 'details' | 'evidence' | 'lifecycle' | 'targets';

const TABLE_PAGE_SIZE = 8;

const fallbackActionLabels: Record<string, string> = {
  'runtime.http.request': 'HTTP/API request',
  'payment.x402.authorize': 'x402 authorization',
  'tool.call': 'Tool call',
  'management.connection.issue': 'Issue credential',
  'management.connection.rotate': 'Rotate credential',
  'management.connection.revoke': 'Revoke credential',
  'management.agent.pause': 'Pause agent',
  'management.agent.activate': 'Activate agent',
  'management.agent.deactivate': 'Deactivate agent',
};

function policyKey(policy: PolicyVersion): string {
  return `${policy.id}:${policy.version}`;
}

function titleCase(value: string): string {
  return value
    .split(/[_\s.]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatTargetType(type: BindTargetType): string {
  if (type === 'org') return 'Workspace';
  if (type === 'connection') return 'Credential';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatCategory(category: PolicyVersion['category']): string {
  if (category === 'operational') return 'Operational';
  if (category === 'management') return 'Management';
  return 'Capability';
}

function formatDraftStatus(status: PolicyDraft['status']): string {
  if (status === 'draft') return 'Draft';
  if (status === 'validated') return 'Validated';
  if (status === 'activated') return 'Activated';
  return 'Discarded';
}

function formatDecision(decision: string | undefined): string {
  if (decision === 'approval_required') return 'Require approval';
  if (decision === 'observe') return 'Observe';
  if (decision === 'deny') return 'Deny';
  if (decision === 'allow') return 'Allow';
  return 'Policy';
}

function actionHasConditionGroup(action: PolicyActionRecord, group: 'payment' | 'resource' | 'tool'): boolean {
  return action.condition_groups.includes(group);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC', year: 'numeric' }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function primaryStatement(policy: PolicyVersion): PolicyStatement | undefined {
  return policy.statements?.[0];
}

function primaryDraftStatement(draft: PolicyDraft | undefined): PolicyStatement | undefined {
  return draft?.statements?.[0];
}

function actionLabel(actionId: string, policyActions: readonly PolicyActionRecord[]): string {
  return policyActions.find((action) => action.action_id === actionId)?.label ?? fallbackActionLabels[actionId] ?? actionId;
}

function statementAction(statement: PolicyStatement | undefined, policyActions: readonly PolicyActionRecord[]): string {
  const action = statement?.actions?.[0];
  if (action === undefined) return 'Policy rule';
  return actionLabel(action, policyActions);
}

function groupedTargets(targets: readonly BindTarget[]): Array<{ readonly type: BindTargetType; readonly targets: BindTarget[] }> {
  const order: BindTargetType[] = ['agent', 'connection', 'team', 'org'];
  return order
    .map((type) => ({
      type,
      targets: targets.filter((target) => target.type === type),
    }))
    .filter((group) => group.targets.length > 0);
}

function firstConditionSummary(statement: PolicyStatement | undefined): string {
  const pieces: string[] = [];
  const resource = statement?.conditions?.resource;
  const payment = statement?.conditions?.payment;
  const tool = statement?.conditions?.tool;

  if (resource?.categories !== undefined && resource.categories.length > 0) {
    pieces.push(`resource category: ${resource.categories.join(', ')}`);
  }
  if (resource?.domains !== undefined && resource.domains.length > 0) {
    pieces.push(`domain: ${resource.domains.join(', ')}`);
  }
  if (payment?.minAmount !== undefined) {
    pieces.push(`minimum amount: ${payment.minAmount}`);
  }
  if (payment?.assets !== undefined && payment.assets.length > 0) {
    pieces.push(`asset: ${payment.assets.join(', ')}`);
  }
  if (tool?.names !== undefined && tool.names.length > 0) {
    pieces.push(`tool: ${tool.names.join(', ')}`);
  }
  if (statement?.actor?.roles !== undefined && statement.actor.roles.length > 0) {
    pieces.push(`actor role: ${statement.actor.roles.join(', ')}`);
  }

  return pieces.length > 0 ? pieces.join(' · ') : 'No optional conditions';
}

function policySummary(policy: PolicyVersion, policyActions: readonly PolicyActionRecord[]): string {
  const statement = primaryStatement(policy);
  const decision = statement?.decision;
  const action = statement?.actions?.[0];
  const condition = firstConditionSummary(statement);

  if (decision !== undefined && action !== undefined) {
    return `${formatDecision(decision)} for ${statementAction(statement, policyActions)} where ${condition}.`;
  }

  return policy.description || `${formatCategory(policy.category)} policy.`;
}

function statusClass(status: string): string {
  if (status === 'active' || status === 'activated' || status === 'success') return 'status-active';
  if (status === 'validated') return 'status-validated';
  if (status === 'draft') return 'status-draft-neutral';
  if (status === 'error' || status === 'denied') return 'status-revoked';
  if (status === 'pending') return 'status-draft';
  return `status-${status}`;
}

function matchesPolicySearch(
  policy: PolicyVersion,
  query: string,
  policyActions: readonly PolicyActionRecord[],
): boolean {
  if (query.length === 0) return true;
  const searchable = [
    policy.name,
    policy.description,
    policy.category,
    policySummary(policy, policyActions),
  ]
    .join(' ')
    .toLowerCase();
  return searchable.includes(query.toLowerCase());
}

function matchesDraftSearch(draft: PolicyDraft, query: string): boolean {
  if (query.length === 0) return true;
  return [draft.name, draft.description, draft.category, draft.status].join(' ').toLowerCase().includes(query.toLowerCase());
}

function eventLabel(event: AuditEventRecord): string {
  const resource = event.resourceType === null ? null : `${titleCase(event.resourceType)}${event.resourceId === null ? '' : ` · ${event.resourceId}`}`;
  return resource ?? event.sourceSystem ?? event.eventType;
}

function isControlLifecycleEvent(event: AuditEventRecord): boolean {
  if (event.eventDomain !== 'policy') return false;
  if (event.decisionRef !== null || event.resourceType === 'policy_decision') return false;
  return !event.eventType.startsWith('policy.decision.') && !event.action.startsWith('policy.decision.');
}

function matchesActivitySearch(event: AuditEventRecord, query: string): boolean {
  if (query.length === 0) return true;
  return [
    event.action,
    event.eventType,
    event.reasonCode ?? '',
    event.resourceType ?? '',
    event.resourceId ?? '',
    event.policyRef ?? '',
    event.sourceSystem ?? '',
    event.tags.join(' '),
  ]
    .join(' ')
    .toLowerCase()
    .includes(query.toLowerCase());
}

export function ControlsLibrary({
  orgId: _orgId,
  orgSlug: _orgSlug,
  drafts,
  policies,
  activityEvents = [],
  policyActions = [],
  simulations = [],
  bindTargets = [],
  createAction,
  validateAction,
  activateAction,
  activateRevisionAction,
  updateDraftAction,
  discardDraftAction,
  simulateDraftAction,
  archivePolicyAction,
  createRevisionDraftAction,
  createRestoreDraftAction,
  bindAction,
  removeBindingAction,
}: ControlsLibraryProps) {
  const [drawer, setDrawer] = useState<DrawerState>({ kind: 'closed' });
  const [tableView, setTableView] = useState<TableView>('library');
  const [detailTab, setDetailTab] = useState<PolicyDetailTab>('details');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | PolicyVersion['category']>('all');
  const [tablePage, setTablePage] = useState(1);
  const [confirmDiscardDraftId, setConfirmDiscardDraftId] = useState<string | null>(null);
  const [confirmArchivePolicyId, setConfirmArchivePolicyId] = useState<string | null>(null);

  const filteredPolicies = useMemo(
    () =>
      policies.filter((policy) => {
        const categoryMatch = categoryFilter === 'all' || policy.category === categoryFilter;
        const searchMatch = matchesPolicySearch(policy, query.trim(), policyActions);
        return categoryMatch && searchMatch;
      }),
    [categoryFilter, policies, policyActions, query],
  );
  const openDrafts = useMemo(
    () =>
      drafts.filter((draft) => {
        const lifecycleMatch = draft.status === 'draft' || draft.status === 'validated';
        const categoryMatch = categoryFilter === 'all' || draft.category === categoryFilter;
        const searchMatch = matchesDraftSearch(draft, query.trim());
        return lifecycleMatch && categoryMatch && searchMatch;
      }),
    [categoryFilter, drafts, query],
  );
  const policyActivity = useMemo(
    () =>
      activityEvents
        .filter(isControlLifecycleEvent)
        .filter((event) => matchesActivitySearch(event, query.trim())),
    [activityEvents, query],
  );
  const detailPolicy =
    drawer.kind === 'detail'
      ? policies.find((policy) => policyKey(policy) === drawer.policyKey)
      : undefined;
  const detailDraft = drawer.kind === 'draft' ? drafts.find((draft) => draft.id === drawer.draftId) : undefined;
  const detailDraftStatement = primaryDraftStatement(detailDraft);
  const simulationAction = detailDraftStatement?.actions?.[0] ?? 'runtime.http.request';
  const simulationPolicyAction =
    policyActions.find((action) => action.action_id === simulationAction) ?? policyActions[0];

  useEffect(() => {
    if (drawer.kind !== 'draft') return;
    const selectedDraft = drafts.find((draft) => draft.id === drawer.draftId);
    if (selectedDraft !== undefined && selectedDraft.status !== 'draft' && selectedDraft.status !== 'validated') {
      setDrawer({ kind: 'closed' });
      setConfirmDiscardDraftId(null);
      return;
    }
  }, [drafts, drawer]);

  // The create form has no completion callback (it submits a Server Action
  // directly via the form's `action` prop), so once the new draft shows up
  // in `drafts` after revalidation, close the drawer ourselves -- otherwise
  // it just sits there looking like the click did nothing.
  const draftIdsRef = useRef<Set<string>>(new Set(drafts.map((draft) => draft.id)));
  useEffect(() => {
    const knownIds = draftIdsRef.current;
    if (drawer.kind === 'create' && drafts.some((draft) => !knownIds.has(draft.id))) {
      setDrawer({ kind: 'closed' });
      setTableView('drafts');
    }
    draftIdsRef.current = new Set(drafts.map((draft) => draft.id));
  }, [drafts, drawer]);
  const detailStatement = detailPolicy === undefined ? undefined : primaryStatement(detailPolicy);
  const detailPolicyActivity =
    detailPolicy === undefined
      ? []
      : policyActivity.filter(
          (event) =>
            event.relatedPolicyId === detailPolicy.id ||
            event.resourceId === detailPolicy.id ||
            event.policyRef === `${detailPolicy.id}:v${detailPolicy.version}` ||
            event.policyRef === detailPolicy.id,
        );
  const detailPolicySimulations =
    detailPolicy === undefined
      ? []
      : simulations.filter((simulation) =>
          simulation.result.matched.some(
            (match) => match.policyId === detailPolicy.id && match.policyVersion === detailPolicy.version,
          ),
        );
  const detailActionId = detailStatement?.actions?.[0];
  const detailActionRecord =
    detailActionId === undefined ? undefined : policyActions.find((action) => action.action_id === detailActionId);
  const detailSupportsResource = detailActionRecord?.condition_groups.includes('resource') ?? false;
  const detailSupportsPayment = detailActionRecord?.condition_groups.includes('payment') ?? false;
  const detailSupportsTool = detailActionRecord?.condition_groups.includes('tool') ?? false;
  const visibleDrafts = openDrafts.filter((draft) => draft.status !== 'activated' && draft.status !== 'discarded');
  const drawerOpen = drawer.kind !== 'closed';
  const activeCount = policies.length;
  const draftCount = visibleDrafts.length;
  const activityCount = policyActivity.length;
  const viewMeta: Record<TableView, { readonly title: string; readonly count: string }> = {
    library: {
      title: 'Policies',
      count: `${activeCount} active`,
    },
    drafts: {
      title: 'Drafts',
      count: `${draftCount} draft${draftCount === 1 ? '' : 's'}`,
    },
    activity: {
      title: 'Change log',
      count: `${activityCount} event${activityCount === 1 ? '' : 's'}`,
    },
  };
  const currentMeta = viewMeta[tableView];
  const currentTotal = tableView === 'library'
    ? filteredPolicies.length
    : tableView === 'drafts'
      ? visibleDrafts.length
      : policyActivity.length;
  const safeTablePage = Math.min(Math.max(1, tablePage), Math.max(1, Math.ceil(currentTotal / TABLE_PAGE_SIZE)));
  const pageStart = (safeTablePage - 1) * TABLE_PAGE_SIZE;
  const pagedPolicies = filteredPolicies.slice(pageStart, pageStart + TABLE_PAGE_SIZE);
  const pagedDrafts = visibleDrafts.slice(pageStart, pageStart + TABLE_PAGE_SIZE);
  const pagedActivity = policyActivity.slice(pageStart, pageStart + TABLE_PAGE_SIZE);

  useEffect(() => {
    setTablePage(1);
  }, [categoryFilter, query, tableView]);
  const closeDrawer = () => {
    setDrawer({ kind: 'closed' });
    setConfirmArchivePolicyId(null);
    setConfirmDiscardDraftId(null);
  };
  const isRevisionDraft = (draft: PolicyDraft) => draft.revision_policy_id !== undefined && draft.revision_policy_id !== null;
  const activationActionForDraft = (draft: PolicyDraft) => (isRevisionDraft(draft) ? activateRevisionAction : activateAction);

  return (
    <div className="controls-console">
      <div className="controls-page" aria-hidden={drawerOpen}>
        <div className="controls-workbench-top">
          <nav className="controls-view-tabs" aria-label="Controls sections">
            {([
              ['library', 'Policy library'],
              ['drafts', 'Drafts'],
              ['activity', 'Change log'],
            ] as const).map(([view, label]) => (
              <button
                aria-label={label}
                aria-current={tableView === view ? 'page' : undefined}
                className={tableView === view ? 'controls-view-tab active' : 'controls-view-tab'}
                key={view}
                onClick={() => setTableView(view)}
                type="button"
              >
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>

        <header className="controls-page-header">
          <div>
            <p className="controls-eyebrow">Identity</p>
            <h1>Controls</h1>
            <p>Policies that govern managed agent actions.</p>
          </div>
          <button className="controls-primary-action" onClick={() => setDrawer({ kind: 'create' })} type="button">
            New policy
          </button>
        </header>

        <section className="controls-library-shell" aria-labelledby="policy-library-title">
          <div className="controls-library-core">
            <div className="controls-toolbar" aria-label="Policy filters">
              <label>
                <span>Search</span>
                <input
                  aria-label="Search policies"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={tableView === 'activity' ? 'Search policy changes' : 'Search policies'}
                  value={query}
                />
              </label>
              {tableView === 'activity' ? null : (
                <label>
                  <span>Category</span>
                  <select
                    aria-label="Filter by category"
                    onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}
                    value={categoryFilter}
                  >
                    <option value="all">All categories</option>
                    <option value="operational">Operational</option>
                    <option value="management">Management</option>
                    <option value="capability">Capability</option>
                  </select>
                </label>
              )}
            </div>

            <div className="controls-library-heading">
              <div>
                <h2 id="policy-library-title">{currentMeta.title}</h2>
              </div>
              <span className="controls-muted-count">{currentMeta.count}</span>
            </div>

            {tableView === 'library' && filteredPolicies.length === 0 ? (
              <div className="controls-empty-state">
                <h3>No policies match this view</h3>
                <p>Clear the filters or start a new policy draft.</p>
                <button className="button-secondary" onClick={() => setDrawer({ kind: 'create' })} type="button">
                  New policy
                </button>
              </div>
            ) : null}

            {tableView === 'drafts' && visibleDrafts.length === 0 ? (
              <div className="controls-empty-state">
                <h3>No draft policies</h3>
                <p>Create a draft, validate it, then activate it before assigning it from an agent, team, or credential surface.</p>
                <button className="button-secondary" onClick={() => setDrawer({ kind: 'create' })} type="button">
                  New policy
                </button>
              </div>
            ) : null}

            {tableView === 'activity' && policyActivity.length === 0 ? (
              <div className="controls-empty-state">
                <h3>No policy changes yet</h3>
                <p>Policy lifecycle events appear here after drafts, activations, archive actions, or simulations are recorded.</p>
              </div>
            ) : null}

            {tableView === 'library' && filteredPolicies.length > 0 ? (
              <div className="controls-policy-table" role="table" aria-label="Active policies">
                <div className="controls-policy-table-head controls-policy-grid" role="row">
                  <span role="columnheader">Policy</span>
                  <span role="columnheader">Decision</span>
                  <span role="columnheader">Surface</span>
                  <span role="columnheader">Assigned</span>
                  <span role="columnheader">Open</span>
                </div>
                {pagedPolicies.map((policy) => {
                  const statement = primaryStatement(policy);
                  return (
                    <button
                      aria-label={`Open ${policy.name}`}
                      className="controls-policy-row controls-policy-grid"
                      key={policyKey(policy)}
                      onClick={() => {
                        setDetailTab('details');
                        setDrawer({ kind: 'detail', policyKey: policyKey(policy) });
                      }}
                      type="button"
                    >
                      <span className="controls-policy-name" role="cell">
                        <span className="controls-policy-title">{policy.name}</span>
                        <span>{policy.description || policySummary(policy, policyActions)}</span>
                      </span>
                      <span className={`controls-decision-badge decision-${statement?.decision ?? 'policy'}`} role="cell">
                        {formatDecision(statement?.decision)}
                      </span>
                      <span className="controls-neutral-badge" role="cell">
                        {statement === undefined ? formatCategory(policy.category) : statementAction(statement, policyActions)}
                      </span>
                      <span className="controls-neutral-badge" role="cell">
                        {policy.bindings_count} assigned
                      </span>
                      <span className="controls-row-open" role="cell"><IconArrowRight aria-hidden="true" size={13} stroke={1.8} /></span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {tableView === 'drafts' && visibleDrafts.length > 0 ? (
              <div className="controls-policy-table" role="table" aria-label="Draft policies">
                <div className="controls-policy-table-head controls-drafts-grid" role="row">
                  <span role="columnheader">Draft</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Type</span>
                  <span role="columnheader">Enforcement</span>
                  <span role="columnheader">Actions</span>
                </div>
                {pagedDrafts.map((draft) => {
                  const draftActivationAction = activationActionForDraft(draft);
                  return (
                  <div className="controls-policy-row controls-policy-row-static controls-drafts-grid" key={draft.id} role="row">
                    <button
                      aria-label={`Open draft ${draft.name}`}
                      className="controls-policy-name controls-policy-name-button"
                      onClick={() => setDrawer({ kind: 'draft', draftId: draft.id })}
                      role="cell"
                      type="button"
                    >
                      <span className="controls-policy-title">{draft.name}</span>
                      <span>{draft.description || formatCategory(draft.category)}</span>
                    </button>
                    <span className={`status-badge ${statusClass(draft.status)}`} role="cell">{formatDraftStatus(draft.status)}</span>
                    <span className="controls-neutral-badge" role="cell">{formatCategory(draft.category)}</span>
                    <span className="controls-neutral-badge" role="cell">Not enforcing</span>
                    <span className="controls-row-actions" role="cell">
                      {draft.status === 'draft' && validateAction !== undefined ? (
                        <form action={validateAction.bind(null, draft.id)}>
                          <button aria-label={`Validate ${draft.name}`} className="button-secondary" type="submit">
                            Validate
                          </button>
                        </form>
                      ) : null}
                      {draft.status === 'validated' && draftActivationAction !== undefined ? (
                        <form action={draftActivationAction.bind(null, draft.id)}>
                          <button aria-label={`Activate ${draft.name}`} className="button-primary" type="submit">
                            {isRevisionDraft(draft) ? 'Activate revision' : 'Activate'}
                          </button>
                        </form>
                      ) : null}
                      <button className="button-secondary" onClick={() => setDrawer({ kind: 'draft', draftId: draft.id })} type="button">
                        Open
                      </button>
                    </span>
                  </div>
                  );
                })}
              </div>
            ) : null}

            {tableView === 'activity' && policyActivity.length > 0 ? (
              <div className="controls-policy-table" role="table" aria-label="Policy change log">
                <div className="controls-policy-table-head controls-activity-grid" role="row">
                  <span role="columnheader">Change</span>
                  <span role="columnheader">Policy</span>
                  <span role="columnheader">Outcome</span>
                  <span role="columnheader">Recorded</span>
                  <span role="columnheader">Evidence</span>
                </div>
                {pagedActivity.map((event) => (
                  <div className="controls-policy-row controls-policy-row-static controls-activity-grid" key={event.id} role="row">
                    <span className="controls-policy-name" role="cell">
                      <span className="controls-policy-title">{titleCase(event.action)}</span>
                      <span>{event.reasonCode ?? event.eventType}</span>
                    </span>
                    <span className="controls-neutral-badge" role="cell">{eventLabel(event)}</span>
                    <span className={`status-badge ${statusClass(event.outcome)}`} role="cell">{event.outcome}</span>
                    <time dateTime={event.recordedAt} role="cell">{formatDateTime(event.recordedAt)}</time>
                    <code className="controls-hash-cell" role="cell">{event.eventHash.slice(0, 18)}...</code>
                  </div>
                ))}
              </div>
            ) : null}

            {currentTotal > 0 ? (
              <DataTablePager
                itemLabel={tableView === 'library' ? 'policies' : tableView === 'drafts' ? 'drafts' : 'policy changes'}
                onPageChange={setTablePage}
                page={safeTablePage}
                pageSize={TABLE_PAGE_SIZE}
                total={currentTotal}
              />
            ) : null}
          </div>
        </section>
      </div>

      <Sheet
        labelledBy="create-policy-title"
        onOpenChange={(open) => {
          if (!open) closeDrawer();
        }}
        open={drawer.kind === 'create'}
        panelClassName="controls-work-drawer"
      >
        <header className="controls-drawer-header">
          <div>
            <span className="controls-page-kicker">New policy draft</span>
            <h1 id="create-policy-title">Create policy</h1>
            <p>Pick one action surface, set only the conditions that can match it, then save a draft for validation.</p>
          </div>
          <SheetCloseButton ariaLabel="Close" onClick={closeDrawer} />
        </header>
        <div className="controls-drawer-body">
          <main className="controls-drawer-main">
            <PolicyDraftBuilder actions={policyActions} createAction={createAction} />
          </main>
        </div>
      </Sheet>

      <Sheet
        labelledBy="draft-policy-title"
        onOpenChange={(open) => {
          if (!open) closeDrawer();
        }}
        open={drawer.kind === 'draft' && detailDraft !== undefined}
        panelClassName="controls-work-drawer"
      >
        {detailDraft === undefined ? null : (
          (() => {
            const detailDraftActivationAction = activationActionForDraft(detailDraft);
            const detailDraftEditable = detailDraft.status === 'draft' || detailDraft.status === 'validated';
            return (
          <>
            <header className="controls-drawer-header">
              <div>
                <span className="controls-page-kicker">Draft policy</span>
                <h1 id="draft-policy-title">{detailDraft.name}</h1>
                <p>Drafts are editable. They do not enforce until validation, activation, and binding complete.</p>
              </div>
              <SheetCloseButton ariaLabel="Close" onClick={closeDrawer} />
            </header>
            <div className="controls-drawer-body">
              <main className="controls-drawer-main">
                <div className="controls-detail-grid">
                  <section className="controls-form-surface">
                    <div className="controls-form-heading">
                      <h2>Draft state</h2>
                      <p>Current lifecycle and classification.</p>
                    </div>
                    <dl className="controls-definition-grid">
                      <div>
                        <dt>Status</dt>
                        <dd>{formatDraftStatus(detailDraft.status)}</dd>
                      </div>
                      <div>
                        <dt>Category</dt>
                        <dd>{formatCategory(detailDraft.category)}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{formatDate(detailDraft.updated_at)}</dd>
                      </div>
                      <div>
                        <dt>Enforcement</dt>
                        <dd>Not enforcing</dd>
                      </div>
                      <div>
                        <dt>Action</dt>
                        <dd>{statementAction(detailDraftStatement, policyActions)}</dd>
                      </div>
                      <div>
                        <dt>Decision</dt>
                        <dd>{formatDecision(detailDraftStatement?.decision)}</dd>
                      </div>
                      <div>
                        <dt>Actor role</dt>
                        <dd>{detailDraftStatement?.actor?.roles?.join(', ') ?? 'Any role'}</dd>
                      </div>
                      <div>
                        <dt>Target scope</dt>
                        <dd>{detailDraftStatement?.target?.types?.map(formatTargetType).join(', ') ?? 'Any supported target'}</dd>
                      </div>
                      {detailDraftStatement?.conditions?.resource?.categories?.length ? (
                        <div>
                          <dt>Resource</dt>
                          <dd>{detailDraftStatement.conditions.resource.categories.join(', ')}</dd>
                        </div>
                      ) : null}
                      {detailDraftStatement?.conditions?.payment?.minAmount !== undefined ? (
                        <div>
                          <dt>Payment</dt>
                          <dd>
                            {detailDraftStatement.conditions.payment.minAmount}{' '}
                            {detailDraftStatement.conditions.payment.assets?.join(', ') ?? 'Any asset'}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </section>

                  {detailDraftEditable ? (
                  <section className="controls-form-surface controls-draft-editor" aria-label={`${detailDraft.name} edit`}>
                    <div className="controls-form-heading">
                      <h2>Edit draft</h2>
                      <p>Change the complete enforcement rule, then validate the resulting snapshot before activation.</p>
                    </div>
                    <PolicyDraftBuilder
                      actions={policyActions}
                      initialDraft={detailDraft}
                      key={detailDraft.id}
                      submitAction={updateDraftAction}
                      submitLabel="Save draft changes"
                    />
                  </section>
                  ) : null}

                  {detailDraftEditable ? (
                  <section className="controls-form-surface" aria-label={`${detailDraft.name} dry run`}>
                    <div className="controls-form-heading">
                      <h2>Simulation</h2>
                      <p>Dry runs evaluate this draft without recording a live agent decision.</p>
                    </div>
                    <form action={simulateDraftAction} className="controls-bind-form">
                      <input name="draftId" type="hidden" value={detailDraft.id} />
                      <label>
                        <span>Action</span>
                        <input
                          readOnly
                          value={simulationPolicyAction?.label ?? simulationAction}
                        />
                      </label>
                      <input name="action" type="hidden" value={simulationAction} />
                      <label>
                        <span>Target</span>
                        <select name="targetKey" required defaultValue="">
                          <option value="" disabled>Select target</option>
                          {groupedTargets(bindTargets).map((group) => (
                            <optgroup key={group.type} label={formatTargetType(group.type)}>
                              {group.targets.map((target) => (
                                <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>
                                  {target.label} · {formatTargetType(target.type)}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Actor role</span>
                        <select name="actorRole" defaultValue={detailDraftStatement?.actor?.roles?.[0] ?? 'member'}>
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="operator">Operator</option>
                          <option value="auditor">Auditor</option>
                          <option value="viewer">Viewer</option>
                          <option value="member">Member</option>
                        </select>
                      </label>
                      {simulationPolicyAction !== undefined && actionHasConditionGroup(simulationPolicyAction, 'resource') ? (
                        <>
                          <label>
                            <span>Resource URL</span>
                            <input name="resourceUrl" placeholder="https://api.example.com/data" type="url" />
                          </label>
                          <label>
                            <span>Resource category</span>
                            <input name="resourceCategory" placeholder="weather" />
                          </label>
                          <label>
                            <span>Resource domain</span>
                            <input name="resourceDomain" placeholder="api.example.com" />
                          </label>
                        </>
                      ) : null}
                      {simulationPolicyAction !== undefined && actionHasConditionGroup(simulationPolicyAction, 'payment') ? (
                        <>
                          <label>
                            <span>Payment amount</span>
                            <input name="paymentAmount" placeholder="1.00" />
                          </label>
                          <label>
                            <span>Payment asset</span>
                            <input name="paymentAsset" placeholder="USDC" />
                          </label>
                          <label>
                            <span>Payment network</span>
                            <input name="paymentNetwork" placeholder="eip155:84532" />
                          </label>
                          <label>
                            <span>Payment recipient</span>
                            <input name="paymentRecipient" placeholder="0x..." />
                          </label>
                        </>
                      ) : null}
                      {simulationPolicyAction !== undefined && actionHasConditionGroup(simulationPolicyAction, 'tool') ? (
                        <>
                          <label>
                            <span>Tool name</span>
                            <input name="toolName" placeholder="browser.search" />
                          </label>
                          <label>
                            <span>Tool risk level</span>
                            <input name="toolRiskLevel" placeholder="high" />
                          </label>
                        </>
                      ) : null}
                      <button className="button-secondary" disabled={simulateDraftAction === undefined} type="submit">
                        Run dry run
                      </button>
                    </form>
                    {simulations.filter((simulation) => simulation.draft_id === detailDraft.id).length === 0 ? (
                      <div className="controls-side-empty flush">
                        <h3>No dry runs yet</h3>
                        <p>Run a simulation before activation to preview the decision outcome.</p>
                      </div>
                    ) : (
                      <ol className="controls-bound-list">
                        {simulations
                          .filter((simulation) => simulation.draft_id === detailDraft.id)
                          .slice(0, 5)
                          .map((simulation) => (
                            <li className="controls-bound-row" key={simulation.id}>
                              <div>
                                <strong>{formatDecision(simulation.result.decision)}</strong>
                                <span>{actionLabel(simulation.request.action, policyActions)}</span>
                              </div>
                              <span className={`controls-decision-badge decision-${simulation.result.decision}`}>
                                {simulation.result.reasonCode}
                              </span>
                            </li>
                          ))}
                      </ol>
                    )}
                  </section>
                  ) : null}

                  <section className="controls-form-surface" aria-label={`${detailDraft.name} lifecycle`}>
                    <div className="controls-form-heading">
                      <h2>Lifecycle</h2>
                      <p>Validate, activate, or discard the draft.</p>
                    </div>
                    <div className="controls-lifecycle-actions">
                      {detailDraft.status === 'draft' && validateAction !== undefined ? (
                        <form action={validateAction.bind(null, detailDraft.id)}>
                          <button aria-label={`Validate ${detailDraft.name}`} className="button-secondary" type="submit">
                            Validate draft
                          </button>
                        </form>
                      ) : null}
                      {detailDraft.status === 'validated' && detailDraftActivationAction !== undefined ? (
                        <form action={detailDraftActivationAction.bind(null, detailDraft.id)}>
                          <button aria-label={`Activate ${detailDraft.name}`} className="button-primary" type="submit">
                            {isRevisionDraft(detailDraft) ? 'Activate revision' : 'Activate draft'}
                          </button>
                        </form>
                      ) : null}
                      {(detailDraft.status === 'draft' || detailDraft.status === 'validated') && discardDraftAction !== undefined ? (
                        confirmDiscardDraftId === detailDraft.id ? (
                          <form action={discardDraftAction} className="controls-confirm-row">
                            <input name="draftId" type="hidden" value={detailDraft.id} />
                            <span>This discards only the draft. Active policies are not changed.</span>
                            <button aria-label={`Confirm discard ${detailDraft.name}`} className="button-secondary danger" type="submit">
                              Confirm discard
                            </button>
                            <button className="button-secondary" onClick={() => setConfirmDiscardDraftId(null)} type="button">
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <button
                            aria-label={`Discard ${detailDraft.name}`}
                            className="button-secondary"
                            onClick={() => setConfirmDiscardDraftId(detailDraft.id)}
                            type="button"
                          >
                            Discard draft
                          </button>
                        )
                      ) : null}
                    </div>
                  </section>
                </div>
              </main>
            </div>
          </>
            );
          })()
        )}
      </Sheet>

      <Sheet
        labelledBy="policy-detail-title"
        onOpenChange={(open) => {
          if (!open) closeDrawer();
        }}
        open={drawer.kind === 'detail' && detailPolicy !== undefined}
        panelClassName="controls-work-drawer"
      >
        {detailPolicy === undefined ? null : (
          <>
            <header className="controls-drawer-header">
              <div>
                <span className="controls-page-kicker">{detailPolicy.status === 'archived' ? 'Archived policy' : 'Policy'}</span>
                <h1 id="policy-detail-title">{detailPolicy.name}</h1>
                <p>{detailPolicy.description || policySummary(detailPolicy, policyActions)}</p>
              </div>
              <SheetCloseButton ariaLabel="Close" onClick={closeDrawer} />
            </header>
            <div className="controls-drawer-body">
              <main className="controls-drawer-main">
                <div className="controls-detail-workbench">
                  <nav className="controls-detail-tabs" aria-label="Policy detail sections">
                    {([
                      ['details', 'Details'],
                      ['evidence', 'Evidence'],
                      ['targets', 'Targets'],
                      ['lifecycle', 'Lifecycle'],
                    ] as const).map(([tab, label]) => (
                      <button
                        aria-current={detailTab === tab ? 'page' : undefined}
                        className={detailTab === tab ? 'controls-detail-tab active' : 'controls-detail-tab'}
                        key={tab}
                        onClick={() => setDetailTab(tab)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </nav>

                  {detailTab === 'details' ? (
                    <section className="controls-form-surface controls-detail-panel">
                      <div className="controls-form-heading">
                        <h2>Details</h2>
                        <p>What this reusable policy does before it is assigned from an agent, team, credential, or workspace surface.</p>
                      </div>
                      <div className="controls-effect-box">{policySummary(detailPolicy, policyActions)}</div>
                      <dl className="controls-definition-grid">
                        <div>
                          <dt>Decision</dt>
                          <dd>{formatDecision(detailStatement?.decision)}</dd>
                        </div>
                        <div>
                          <dt>Surface</dt>
                          <dd>{detailStatement === undefined ? formatCategory(detailPolicy.category) : statementAction(detailStatement, policyActions)}</dd>
                        </div>
                        <div>
                          <dt>Category</dt>
                          <dd>{formatCategory(detailPolicy.category)}</dd>
                        </div>
                        <div>
                          <dt>Version</dt>
                          <dd>v{detailPolicy.version}</dd>
                        </div>
                        <div>
                          <dt>Assignment scopes</dt>
                          <dd>{detailPolicy.binding_target_types.map(formatTargetType).join(', ')}</dd>
                        </div>
                        <div>
                          <dt>Created</dt>
                          <dd>{formatDate(detailPolicy.created_at)}</dd>
                        </div>
                      </dl>
                      <p className="controls-detail-note">
                        Assignments are managed where the target lives. Open an agent, team, workspace, or credential surface to attach or remove this policy.
                      </p>
                      <div className="controls-form-heading controls-detail-subheading">
                        <h2>Match conditions</h2>
                        <p>The exact fields this policy can match. Empty groups mean this policy is controlled by action and assignment scope.</p>
                      </div>
                      <dl className="controls-condition-list">
                        <div>
                          <dt>Action</dt>
                          <dd>{detailStatement === undefined ? 'Policy rule' : statementAction(detailStatement, policyActions)}</dd>
                        </div>
                        <div>
                          <dt>Actor role</dt>
                          <dd>{detailStatement?.actor?.roles?.join(', ') ?? 'Any role'}</dd>
                        </div>
                        {detailSupportsResource ? (
                          <>
                            <div>
                              <dt>Resource category</dt>
                              <dd>{detailStatement?.conditions?.resource?.categories?.join(', ') ?? 'Any category'}</dd>
                            </div>
                            <div>
                              <dt>Resource domain</dt>
                              <dd>{detailStatement?.conditions?.resource?.domains?.join(', ') ?? 'Any domain'}</dd>
                            </div>
                          </>
                        ) : null}
                        {detailSupportsPayment ? (
                          <>
                            <div>
                              <dt>Payment minimum</dt>
                              <dd>{detailStatement?.conditions?.payment?.minAmount ?? 'No minimum'}</dd>
                            </div>
                            <div>
                              <dt>Payment asset</dt>
                              <dd>{detailStatement?.conditions?.payment?.assets?.join(', ') ?? 'Any supported asset'}</dd>
                            </div>
                          </>
                        ) : null}
                        {detailSupportsTool ? (
                          <div>
                            <dt>Tool name</dt>
                            <dd>{detailStatement?.conditions?.tool?.names?.join(', ') ?? 'Any managed tool'}</dd>
                          </div>
                        ) : null}
                        {!detailSupportsResource && !detailSupportsPayment && !detailSupportsTool ? (
                          <div>
                            <dt>Additional conditions</dt>
                            <dd>No condition fields apply to this action surface.</dd>
                          </div>
                        ) : null}
                      </dl>
                    </section>
                  ) : null}

                  {detailTab === 'evidence' ? (
                    <section className="controls-form-surface controls-detail-panel" aria-label={`${detailPolicy.name} evidence`}>
                      <div className="controls-form-heading">
                        <h2>Evidence</h2>
                        <p>Policy lifecycle records and draft simulations. Live agent decisions stay on agent activity surfaces.</p>
                      </div>
                      {detailPolicyActivity.length === 0 && detailPolicySimulations.length === 0 ? (
                        <div className="controls-side-empty flush">
                          <h3>No policy evidence yet</h3>
                          <p>Policy events and dry runs appear here after this policy is changed or simulated.</p>
                        </div>
                      ) : (
                        <div className="controls-bound-list">
                          {detailPolicyActivity.slice(0, 8).map((event) => (
                            <div className="controls-bound-row" key={event.id}>
                              <div>
                                <strong>{titleCase(event.action)}</strong>
                                <span>{formatDateTime(event.recordedAt)}</span>
                              </div>
                              <span className={`status-badge ${statusClass(event.outcome)}`}>{event.outcome}</span>
                            </div>
                          ))}
                          {detailPolicySimulations.slice(0, 8).map((simulation) => (
                            <div className="controls-bound-row" key={simulation.id}>
                              <div>
                                <strong>Dry run: {formatDecision(simulation.result.decision)}</strong>
                                <span>{actionLabel(simulation.request.action, policyActions)}</span>
                              </div>
                              <span className={`controls-decision-badge decision-${simulation.result.decision}`}>
                                {simulation.result.reasonCode}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  ) : null}

                  {detailTab === 'targets' ? (
                    <section className="controls-form-surface controls-detail-panel" aria-label={`${detailPolicy.name} targets`}>
                      <div className="controls-form-heading">
                        <h2>Targets</h2>
                        <p>Assign this policy to a supported scope, or remove an existing assignment.</p>
                      </div>
                      {detailPolicy.bindings.length === 0 ? (
                        <div className="controls-side-empty flush">
                          <h3>No active assignments</h3>
                          <p>This policy is not currently enforcing for any target.</p>
                        </div>
                      ) : (
                        <ol className="controls-bound-list">
                          {detailPolicy.bindings.map((binding) => (
                            <li className="controls-bound-row" key={binding.id}>
                              <div>
                                <strong>{formatTargetType(binding.target_type)}</strong>
                                <span>{binding.target_id}</span>
                              </div>
                              <span className={`status-badge ${statusClass(binding.status)}`}>{binding.status}</span>
                              {removeBindingAction === undefined ? null : (
                                <form action={removeBindingAction}>
                                  <input name="policyId" type="hidden" value={detailPolicy.id} />
                                  <input name="bindingId" type="hidden" value={binding.id} />
                                  <button className="button-secondary" type="submit">Remove</button>
                                </form>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                      {detailPolicy.status === 'active' && bindAction !== undefined ? (
                        <form action={bindAction} className="controls-bind-form">
                          <input name="policyId" type="hidden" value={detailPolicy.id} />
                          <input name="policyVersion" type="hidden" value={detailPolicy.version} />
                          <label>
                            <span>Assign to</span>
                            <select name="targetKey" required defaultValue="">
                              <option value="" disabled>Select target</option>
                              {groupedTargets(
                                bindTargets.filter((target) => detailPolicy.binding_target_types.includes(target.type)),
                              ).map((group) => (
                                <optgroup key={group.type} label={formatTargetType(group.type)}>
                                  {group.targets.map((target) => (
                                    <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>
                                      {target.label} · {formatTargetType(target.type)}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </label>
                          <button className="button-primary" type="submit">Assign</button>
                        </form>
                      ) : null}
                    </section>
                  ) : null}

                  {detailTab === 'lifecycle' ? (
                    <section className="controls-form-surface controls-detail-panel" aria-label={`${detailPolicy.name} lifecycle`}>
                      <div className="controls-form-heading">
                        <h2>Lifecycle</h2>
                        <p>Revisions create a new immutable enforcement snapshot. Archive stops enforcement while retaining audit history.</p>
                      </div>
                      <dl className="controls-definition-grid">
                        <div>
                          <dt>Status</dt>
                          <dd>{detailPolicy.status}</dd>
                        </div>
                        <div>
                          <dt>Active assignments</dt>
                          <dd>{detailPolicy.bindings_count}</dd>
                        </div>
                        {detailPolicy.archived_at !== undefined && detailPolicy.archived_at !== null ? (
                          <div>
                            <dt>Archived</dt>
                            <dd>{formatDate(detailPolicy.archived_at)}</dd>
                          </div>
                        ) : null}
                      </dl>
                      {detailPolicy.status === 'active' ? (
                        <>
                          <form action={createRevisionDraftAction} className="controls-danger-zone neutral">
                            <input name="policyId" type="hidden" value={detailPolicy.id} />
                            <div>
                              <strong>Create revision draft</strong>
                              <span>Edit this policy through a draft. Existing assignments migrate only after the revision is validated and activated.</span>
                            </div>
                            <button className="button-secondary" disabled={createRevisionDraftAction === undefined} type="submit">
                              Create revision
                            </button>
                          </form>

                          {confirmArchivePolicyId === detailPolicy.id ? (
                            <form action={archivePolicyAction} className="controls-danger-zone">
                              <input name="policyId" type="hidden" value={detailPolicy.id} />
                              <input name="changeReason" type="hidden" value="Archived from Controls." />
                              <div>
                                <strong>Confirm archive</strong>
                                <span>This removes {detailPolicy.bindings_count} active assignment{detailPolicy.bindings_count === 1 ? '' : 's'} and stops enforcement.</span>
                              </div>
                              <button className="button-secondary danger" disabled={archivePolicyAction === undefined} type="submit">
                                Confirm archive
                              </button>
                              <button className="button-secondary" onClick={() => setConfirmArchivePolicyId(null)} type="button">
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <div className="controls-danger-zone">
                              <div>
                                <strong>Archive policy</strong>
                                <span>This is not deletion. The policy and its evidence remain in history.</span>
                              </div>
                              <button className="button-secondary" onClick={() => setConfirmArchivePolicyId(detailPolicy.id)} type="button">
                                Archive
                              </button>
                            </div>
                          )}
                        </>
                      ) : null}

                      {detailPolicy.status === 'archived' ? (
                        <form action={createRestoreDraftAction} className="controls-danger-zone neutral">
                          <input name="policyId" type="hidden" value={detailPolicy.id} />
                          <div>
                            <strong>Restore as revision</strong>
                            <span>Create a restore draft from the archived version. Previous assignments stay detached unless you select them below.</span>
                            {detailPolicy.bindings.length > 0 ? (
                              <fieldset className="controls-restore-targets">
                                <legend>Assignments to restore</legend>
                                {detailPolicy.bindings.map((binding) => {
                                  const target = bindTargets.find(
                                    (candidate) => candidate.type === binding.target_type && candidate.id === binding.target_id,
                                  );
                                  return (
                                    <label key={binding.id}>
                                      <input
                                        name="restoreTargetKey"
                                        type="checkbox"
                                        value={`${binding.target_type}:${binding.target_id}`}
                                      />
                                      <span>
                                        {target?.label ?? binding.target_id} · {formatTargetType(binding.target_type)}
                                      </span>
                                    </label>
                                  );
                                })}
                              </fieldset>
                            ) : (
                              <span>No previous assignments are available. The restored revision will remain unattached.</span>
                            )}
                          </div>
                          <button className="button-secondary" disabled={createRestoreDraftAction === undefined} type="submit">
                            Create restore draft
                          </button>
                        </form>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              </main>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
