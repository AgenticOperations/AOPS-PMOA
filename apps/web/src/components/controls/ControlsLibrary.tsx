'use client';

import { useMemo, useState } from 'react';
import type { PolicyDraft, PolicyStatement, PolicyVersion } from '@/lib/policy-types';
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
  readonly bindTargets?: readonly BindTarget[] | undefined;
  readonly createAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly validateAction?: ((draftId: string) => Promise<void>) | undefined;
  readonly activateAction?: ((draftId: string) => Promise<void>) | undefined;
  readonly bindAction?: ((formData: FormData) => Promise<void>) | undefined;
};

type DrawerState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'detail'; readonly policyKey: string };

type TableView = 'active' | 'drafts';

const actionLabels: Record<string, string> = {
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

function primaryStatement(policy: PolicyVersion): PolicyStatement | undefined {
  return policy.statements?.[0];
}

function statementAction(statement: PolicyStatement | undefined): string {
  const action = statement?.actions?.[0];
  if (action === undefined) return 'Policy rule';
  return actionLabels[action] ?? action;
}

function bindingLabel(
  binding: PolicyVersion['bindings'][number],
  bindTargets: readonly BindTarget[],
): string {
  const target = bindTargets.find((candidate) => candidate.type === binding.target_type && candidate.id === binding.target_id);
  return `${target?.label ?? binding.target_id} · ${formatTargetType(binding.target_type)}`;
}

function allowedBindTargets(policy: PolicyVersion, bindTargets: readonly BindTarget[]): BindTarget[] {
  return bindTargets.filter((target) => policy.binding_target_types.includes(target.type));
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

  return pieces.length > 0 ? pieces.join(' · ') : 'No extra condition fields';
}

function policySummary(policy: PolicyVersion): string {
  const statement = primaryStatement(policy);
  const decision = statement?.decision;
  const action = statement?.actions?.[0];
  const condition = firstConditionSummary(statement);

  if (decision !== undefined && action !== undefined) {
    return `${formatDecision(decision)} for ${statementAction(statement)} where ${condition}.`;
  }

  return policy.description || `${formatCategory(policy.category)} policy.`;
}

function statusClass(status: string): string {
  if (status === 'active' || status === 'activated') return 'status-active';
  if (status === 'validated') return 'status-validated';
  if (status === 'draft') return 'status-draft-neutral';
  return `status-${status}`;
}

function matchesPolicySearch(policy: PolicyVersion, query: string, bindTargets: readonly BindTarget[]): boolean {
  if (query.length === 0) return true;
  const searchable = [
    policy.name,
    policy.description,
    policy.category,
    policySummary(policy),
    ...policy.bindings.map((binding) => bindingLabel(binding, bindTargets)),
  ]
    .join(' ')
    .toLowerCase();
  return searchable.includes(query.toLowerCase());
}

function matchesDraftSearch(draft: PolicyDraft, query: string): boolean {
  if (query.length === 0) return true;
  return [draft.name, draft.description, draft.category, draft.status].join(' ').toLowerCase().includes(query.toLowerCase());
}

export function ControlsLibrary({
  orgId: _orgId,
  orgSlug: _orgSlug,
  drafts,
  policies,
  bindTargets = [],
  createAction,
  validateAction,
  activateAction,
  bindAction,
}: ControlsLibraryProps) {
  const [drawer, setDrawer] = useState<DrawerState>({ kind: 'closed' });
  const [tableView, setTableView] = useState<TableView>('active');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | PolicyVersion['category']>('all');
  const [targetFilter, setTargetFilter] = useState<'all' | BindTargetType | 'unbound'>('all');

  const filteredPolicies = useMemo(
    () =>
      policies.filter((policy) => {
        const categoryMatch = categoryFilter === 'all' || policy.category === categoryFilter;
        const searchMatch = matchesPolicySearch(policy, query.trim(), bindTargets);
        const targetMatch =
          targetFilter === 'all' ||
          (targetFilter === 'unbound'
            ? policy.bindings.length === 0
            : policy.bindings.some((binding) => binding.target_type === targetFilter));
        return categoryMatch && searchMatch && targetMatch;
      }),
    [bindTargets, categoryFilter, policies, query, targetFilter],
  );
  const openDrafts = useMemo(
    () =>
      drafts.filter((draft) => {
        const categoryMatch = categoryFilter === 'all' || draft.category === categoryFilter;
        const searchMatch = matchesDraftSearch(draft, query.trim());
        return categoryMatch && searchMatch;
      }),
    [categoryFilter, drafts, query],
  );

  const detailPolicy =
    drawer.kind === 'detail'
      ? policies.find((policy) => policyKey(policy) === drawer.policyKey)
      : undefined;
  const detailStatement = detailPolicy === undefined ? undefined : primaryStatement(detailPolicy);
  const selectedTargets = detailPolicy === undefined ? [] : allowedBindTargets(detailPolicy, bindTargets);
  const targetGroups = groupedTargets(selectedTargets);
  const visibleDrafts = openDrafts.filter((draft) => draft.status !== 'activated' && draft.status !== 'discarded');
  const drawerOpen = drawer.kind !== 'closed';
  const activeView = tableView === 'active';
  const activeCount = policies.length;
  const draftCount = visibleDrafts.length;

  return (
    <div className="controls-console">
      <div className="controls-page" aria-hidden={drawerOpen}>
        <header className="controls-page-header">
          <div>
            <h1>Controls</h1>
          </div>
          <div className="controls-header-actions">
            <button
              aria-label="Drafts"
              aria-pressed={tableView === 'drafts'}
              className={`controls-secondary-action ${tableView === 'drafts' ? 'controls-action-active' : ''}`}
              onClick={() => setTableView((current) => (current === 'drafts' ? 'active' : 'drafts'))}
              type="button"
            >
              Drafts
              <span aria-hidden="true">{draftCount}</span>
            </button>
            <button className="controls-primary-action" onClick={() => setDrawer({ kind: 'create' })} type="button">
              New policy
            </button>
          </div>
        </header>

        <section className="controls-library-shell">
          <div className="controls-library-core">
            <div className="controls-library-heading">
              <div>
                <h2 id="policy-library-title">{activeView ? 'Active policies' : 'Draft policies'}</h2>
              </div>
              <span className="controls-count-pill">
                {activeView ? `${activeCount} active` : `${draftCount} draft${draftCount === 1 ? '' : 's'}`}
              </span>
            </div>

            <div className="controls-toolbar" aria-label="Policy filters">
              <label>
                <span>Search policies</span>
                <input
                  aria-label="Search policies"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search policies"
                  value={query}
                />
              </label>
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
              <label>
                <span>Target</span>
                <select
                  aria-label="Filter by target"
                  disabled={!activeView}
                  onChange={(event) => setTargetFilter(event.target.value as typeof targetFilter)}
                  value={targetFilter}
                >
                  <option value="all">All targets</option>
                  <option value="agent">Agent</option>
                  <option value="connection">Credential</option>
                  <option value="team">Team</option>
                  <option value="org">Workspace</option>
                  <option value="unbound">No binding</option>
                </select>
              </label>
            </div>

            {(activeView ? filteredPolicies.length : visibleDrafts.length) === 0 ? (
              <div className="controls-empty-state">
                <h3>{activeView ? 'No policies match this view' : 'No draft policies match this view'}</h3>
                <p>{activeView ? 'Clear the filters or create a policy draft.' : 'Clear the filters or create a new draft.'}</p>
                <button className="button-secondary" onClick={() => setDrawer({ kind: 'create' })} type="button">
                  New policy
                </button>
              </div>
            ) : (
              <div className="controls-policy-table" role="list" aria-label={activeView ? 'Active policies' : 'Draft policies'}>
                <div className="controls-policy-table-head" aria-hidden="true">
                  <span>Policy</span>
                  <span>{activeView ? 'Decision' : 'Status'}</span>
                  <span>{activeView ? 'Surface' : 'Type'}</span>
                  <span>{activeView ? 'Binding' : 'Enforcement'}</span>
                  <span>{activeView ? 'Open' : 'Action'}</span>
                </div>
                {activeView
                  ? filteredPolicies.map((policy) => {
                      const statement = primaryStatement(policy);
                      return (
                        <div className="controls-policy-item" key={policyKey(policy)} role="listitem">
                          <button
                            aria-label={`Open ${policy.name}`}
                            className="controls-policy-row"
                            onClick={() => setDrawer({ kind: 'detail', policyKey: policyKey(policy) })}
                            type="button"
                          >
                            <span className="controls-policy-name">
                              <span className="controls-policy-title">{policy.name}</span>
                              <span>{policy.description || policySummary(policy)}</span>
                            </span>
                            <span className={`controls-decision-badge decision-${statement?.decision ?? 'policy'}`}>
                              {formatDecision(statement?.decision)}
                            </span>
                            <span className="controls-neutral-badge">
                              {statement === undefined ? formatCategory(policy.category) : statementAction(statement)}
                            </span>
                            <span className="controls-neutral-badge">
                              {policy.bindings_count} binding{policy.bindings_count === 1 ? '' : 's'}
                            </span>
                            <span className="controls-row-open">Open</span>
                          </button>
                        </div>
                      );
                    })
                  : visibleDrafts.map((draft) => (
                      <div className="controls-policy-item" key={draft.id} role="listitem">
                        <div className="controls-policy-row controls-policy-row-static">
                          <span className="controls-policy-name">
                            <span className="controls-policy-title">{draft.name}</span>
                            <span>{draft.description || formatCategory(draft.category)}</span>
                          </span>
                          <span className={`status-badge ${statusClass(draft.status)}`}>{formatDraftStatus(draft.status)}</span>
                          <span className="controls-neutral-badge">{formatCategory(draft.category)}</span>
                          <span className="controls-neutral-badge">Not enforcing</span>
                          <span className="controls-row-actions">
                            {draft.status === 'draft' && validateAction !== undefined ? (
                              <form action={validateAction.bind(null, draft.id)}>
                                <button aria-label={`Validate ${draft.name}`} className="button-secondary" type="submit">
                                  Validate
                                </button>
                              </form>
                            ) : null}
                            {draft.status === 'validated' && activateAction !== undefined ? (
                              <form action={activateAction.bind(null, draft.id)}>
                                <button aria-label={`Activate ${draft.name}`} className="button-primary" type="submit">
                                  Activate
                                </button>
                              </form>
                            ) : null}
                          </span>
                        </div>
                      </div>
                    ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <section
        aria-labelledby="create-policy-title"
        aria-modal="true"
        className="controls-work-drawer"
        hidden={drawer.kind !== 'create'}
        role="dialog"
      >
        <header className="controls-drawer-header">
          <div>
            <h1 id="create-policy-title">Create policy</h1>
            <p>Build a reusable rule. It will not enforce until activated and bound.</p>
          </div>
          <button className="button-secondary" onClick={() => setDrawer({ kind: 'closed' })} type="button">
            Close
          </button>
        </header>
        <div className="controls-drawer-body">
          <main className="controls-drawer-main">
            <section className="controls-form-surface controls-create-surface">
              <div className="controls-form-heading">
                <h2>Policy draft</h2>
                <p>Choose one action surface. The form only shows fields that match that action.</p>
              </div>
              <PolicyDraftBuilder createAction={createAction} />
            </section>
          </main>
        </div>
      </section>

      <section
        aria-labelledby="policy-detail-title"
        aria-modal="true"
        className="controls-work-drawer"
        hidden={drawer.kind !== 'detail' || detailPolicy === undefined}
        role="dialog"
      >
        {detailPolicy === undefined ? null : (
          <>
            <header className="controls-drawer-header">
              <div>
                <h1 id="policy-detail-title">{detailPolicy.name}</h1>
                <p>{detailPolicy.description || policySummary(detailPolicy)}</p>
              </div>
              <button className="button-secondary" onClick={() => setDrawer({ kind: 'closed' })} type="button">
                Close
              </button>
            </header>
            <div className="controls-drawer-body">
              <main className="controls-drawer-main">
                <div className="controls-detail-grid">
                  <section className="controls-form-surface">
                    <div className="controls-form-heading">
                      <h2>Effect</h2>
                      <p>Readable policy behavior for operators.</p>
                    </div>
                    <div className="controls-effect-box">{policySummary(detailPolicy)}</div>
                    <dl className="controls-definition-grid">
                      <div>
                        <dt>Decision</dt>
                        <dd>{formatDecision(detailStatement?.decision)}</dd>
                      </div>
                      <div>
                        <dt>Surface</dt>
                        <dd>{detailStatement === undefined ? formatCategory(detailPolicy.category) : statementAction(detailStatement)}</dd>
                      </div>
                      <div>
                        <dt>Conditions</dt>
                        <dd>{firstConditionSummary(detailStatement)}</dd>
                      </div>
                      <div>
                        <dt>Created</dt>
                        <dd>{formatDate(detailPolicy.created_at)}</dd>
                      </div>
                    </dl>
                  </section>

                  <section className="controls-form-surface" aria-label={`${detailPolicy.name} bindings`}>
                    <div className="controls-form-heading">
                      <h2>Bound targets</h2>
                      <p>Attach this active policy to a workspace, team, agent, or credential.</p>
                    </div>
                    {detailPolicy.bindings.length === 0 ? (
                      <div className="controls-side-empty flush">
                        <h3>No targets yet</h3>
                        <p>This policy is active but not enforcing until it has a binding.</p>
                      </div>
                    ) : (
                      <div aria-label="Current bindings" className="controls-bound-list">
                        {detailPolicy.bindings.map((binding) => (
                          <div className="controls-bound-row" key={binding.id}>
                            <div>
                              <strong>{bindingLabel(binding, bindTargets)}</strong>
                              <span>{formatDate(binding.created_at)}</span>
                            </div>
                            <span className="controls-neutral-badge">{formatTargetType(binding.target_type)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <form action={bindAction} className="controls-bind-form">
                      <input name="policyId" type="hidden" value={detailPolicy.id} />
                      <input name="policyVersion" type="hidden" value={detailPolicy.version} />
                      <label>
                        <span>Bind target</span>
                        <select name="targetKey" required defaultValue="">
                          <option value="" disabled>
                            Select target
                          </option>
                          {targetGroups.map((group) => (
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
                      <button className="button-primary" disabled={bindAction === undefined || selectedTargets.length === 0} type="submit">
                        Bind target
                      </button>
                    </form>
                  </section>
                </div>
              </main>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
