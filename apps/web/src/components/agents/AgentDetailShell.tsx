'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import type {
  ActivityItem,
  AgentActivityFeed,
  AgentDetail,
  ConnectionRecord,
  TeamRecord,
  WalletRefRecord,
} from '@/lib/identity-spine-types';
import type { AgentAllowedActionRecord, BlockedOperationRecord } from '@/lib/operations-types';
import type { AgentPolicyAssignment, PolicyVersion } from '@/lib/policy-types';
import { formatStatus } from './format';
import { AgentAvatar } from './AgentAvatar';
import { ConnectionPanel } from './ConnectionPanel';
import { AgentActivityWorkspace } from './AgentActivityWorkspace';
import { WalletRefsPanel } from './WalletRefsPanel';
import { AgentPublishPanel, type AgentOnchainIdentityView } from './AgentPublishPanel';
import { formatUtcDateTime } from '@/lib/date-format';
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export type AgentDetailTab = 'overview' | 'access' | 'credentials' | 'publish' | 'activity';

const agentDetailTabs: ReadonlyArray<{
  readonly id: AgentDetailTab;
  readonly label: string;
  readonly description: string;
}> = [
  { id: 'overview', label: 'Overview', description: 'Identity, status, and editable metadata.' },
  { id: 'access', label: 'Policies & access', description: 'Effective policy bindings and runtime operation controls.' },
  { id: 'credentials', label: 'Credentials & wallets', description: 'Agent credentials and external wallet references.' },
  { id: 'publish', label: 'Publish', description: 'Arc nanopayments template, public URL, ERC-8004 identity.' },
  { id: 'activity', label: 'Activity', description: 'Recorded runtime history and an on-demand live monitor.' },
];

function formatPolicyScope(value: AgentPolicyAssignment['binding']['scope']): string {
  if (value === 'workspace') return 'Workspace';
  if (value === 'direct') return 'Direct';
  if (value === 'credential') return 'Credential';
  return 'Team';
}

function formatOperationalAction(value: string): string {
  if (value === 'runtime.http.request') return 'HTTP request';
  if (value === 'tool.call') return 'Tool call';
  return value;
}

function formatOperationalDecision(value: string): string {
  if (value === 'approval_required') return 'Approval required';
  if (value === 'rate_limited') return 'Rate limited';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function blockedOperationLabel(operation: BlockedOperationRecord): string {
  return `Blocked ${operation.tool_name ?? operation.resource_label ?? operation.action}`;
}

export function AgentDetailShell({
  orgId,
  orgSlug,
  mcpEndpoint,
  agent,
  activeTab = 'overview',
  connections,
  walletRefs = [],
  activity,
  activityFeed,
  activityPollUrl,
  teams,
  policies = [],
  availablePolicies = [],
  allowedActions = [],
  blockedOperations = [],
  templateRepoUrl = 'https://github.com/circlefin/arc-nanopayments',
  onchainIdentity = null,
  actions,
}: {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly mcpEndpoint: string;
  readonly agent: AgentDetail;
  readonly activeTab?: AgentDetailTab | undefined;
  readonly connections: ConnectionRecord[];
  readonly walletRefs?: WalletRefRecord[] | undefined;
  readonly activity: ActivityItem[];
  readonly activityFeed?: AgentActivityFeed | undefined;
  readonly activityPollUrl?: string | undefined;
  readonly teams?: readonly TeamRecord[] | undefined;
  readonly policies?: AgentPolicyAssignment[] | undefined;
  readonly availablePolicies?: PolicyVersion[] | undefined;
  readonly allowedActions?: AgentAllowedActionRecord[] | undefined;
  readonly blockedOperations?: BlockedOperationRecord[] | undefined;
  readonly templateRepoUrl?: string | undefined;
  readonly onchainIdentity?: AgentOnchainIdentityView | undefined;
  readonly actions?: {
    readonly pause?: (() => Promise<void>) | undefined;
    readonly activate?: (() => Promise<void>) | undefined;
    readonly deactivate?: (() => Promise<void>) | undefined;
    readonly createConnection?: Parameters<typeof ConnectionPanel>[0]['createAction'] | undefined;
    readonly rotateConnection?: Parameters<typeof ConnectionPanel>[0]['rotateAction'] | undefined;
    readonly revokeConnection?: Parameters<typeof ConnectionPanel>[0]['revokeAction'] | undefined;
    readonly attachWalletRef?: Parameters<typeof WalletRefsPanel>[0]['attachAction'] | undefined;
    readonly detachWalletRef?: Parameters<typeof WalletRefsPanel>[0]['detachAction'] | undefined;
    readonly updateAgent?: ((formData: FormData) => Promise<void>) | undefined;
    readonly bindPolicy?: ((formData: FormData) => Promise<void>) | undefined;
    readonly removePolicyBinding?: ((formData: FormData) => Promise<void>) | undefined;
    readonly savePublishListing?: ((formData: FormData) => Promise<void>) | undefined;
    readonly registerOnchainIdentity?: ((formData: FormData) => Promise<void>) | undefined;
  } | undefined;
}) {
  const [drawer, setDrawer] = useState<'edit' | 'lifecycle' | 'policy' | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [updateState, updateFormAction, updatePending] = useActionState(async (_state: { readonly error?: string }, formData: FormData) => {
    if (actions?.updateAgent === undefined) return { error: 'Agent editing is unavailable.' };
    try {
      await actions.updateAgent(formData);
      setDrawer(null);
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Agent details could not be saved.' };
    }
  }, {});
  const [bindState, bindFormAction, bindPending] = useActionState(async (_state: { readonly error?: string }, formData: FormData) => {
    if (actions?.bindPolicy === undefined) return { error: 'Policy attachment is unavailable.' };
    try {
      await actions.bindPolicy(formData);
      setDrawer(null);
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Policy attachment could not be completed.' };
    }
  }, {});
  const detailPath = `/app/${orgSlug}/agents/${agent.id}`;
  const feed =
    activityFeed ??
    ({
      live: {
        active_connection_count: connections.filter((connection) => connection.status === 'active').length,
        last_seen_at: null,
        latest_event_at: null,
        status: 'offline',
      },
      events: [],
    } satisfies AgentActivityFeed);
  const directPolicies = policies.filter((policy) => policy.binding.scope === 'direct');
  const inheritedPolicies = policies.filter((policy) => policy.binding.scope !== 'direct');
  const directPolicyIds = new Set(directPolicies.map((policy) => policy.id));
  const assignablePolicies = availablePolicies.filter(
    (policy) => policy.status === 'active' && policy.binding_target_types.includes('agent') && !directPolicyIds.has(policy.id),
  );

  return (
    <div className="agent-detail-page">
      <Link className="agent-detail-back" href={`/app/${orgSlug}/agents`}>← Agents</Link>
      <header className="agent-detail-page-header">
        <div>
          <p className="registry-eyebrow">Identity</p>
          <h1>{agent.name}</h1>
        </div>
      </header>

      <section className="agent-identity-band" aria-label="Agent identity summary">
        <div className="agent-identity-lead">
          <AgentAvatar agentId={agent.id} name={agent.name} size="md" />
          <div><strong>{agent.name}</strong><code>{agent.id} · {agent.default_environment ?? 'environment not set'}</code></div>
        </div>
        <div className="agent-identity-stat"><span>Status</span><strong><i className={`agent-status-badge is-${agent.status === 'active' ? 'active' : agent.status === 'paused' ? 'warning' : 'danger'}`}>{formatStatus(agent.status)}</i></strong></div>
        <div className="agent-identity-stat"><span>Credentials</span><strong>{connections.filter((connection) => connection.status === 'active').length} active</strong></div>
        <div className="agent-identity-stat"><span>Last activity</span><strong>{feed.live.latest_event_at === null ? 'No activity' : formatUtcDateTime(feed.live.latest_event_at)}</strong></div>
      </section>

      <nav className="agent-detail-tabs" aria-label="Agent detail sections">
        {agentDetailTabs.map((tab) => {
          const href = tab.id === 'overview' ? detailPath : `${detailPath}?tab=${tab.id}`;
          const isActive = tab.id === activeTab;
          return (
            <Link aria-current={isActive ? 'page' : undefined} className={isActive ? 'is-active' : ''} href={href} key={tab.id}>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      {activeTab === 'overview' ? (
        <div className="agent-detail-canvas">
          <section className="agent-detail-section" aria-labelledby="overview-title">
            <div className="agent-section-heading">
              <div>
                <h2 id="overview-title">Identity details</h2>
                <p>Metadata used for policy targeting and operator context.</p>
              </div>
              <button className="agent-secondary-button" disabled={actions?.updateAgent === undefined} onClick={() => setDrawer('edit')} type="button">Edit agent</button>
            </div>

            <dl className="agent-definition-list">
              <div><dt>Agent ID</dt><dd><code>{agent.id}</code></dd></div>
              <div><dt>Team</dt><dd>{agent.team.name}</dd></div>
              <div><dt>Parent agent</dt><dd>{agent.parent?.name ?? 'None'}</dd></div>
              <div><dt>Child agents</dt><dd>{agent.children.length === 0 ? 'None' : String(agent.children.length)}</dd></div>
              <div><dt>Environment</dt><dd>{agent.default_environment ?? 'Not set'}</dd></div>
              <div><dt>Labels</dt><dd>{agent.labels.length === 0 ? 'None' : agent.labels.join(', ')}</dd></div>
              <div><dt>Description</dt><dd>{agent.description.length > 0 ? agent.description : 'Not set'}</dd></div>
            </dl>
          </section>

          <section className="agent-detail-section" aria-labelledby="agent-lifecycle-title">
            <div className="agent-section-heading">
              <div>
                <h2 id="agent-lifecycle-title">Lifecycle</h2>
                <p>Identity controls with explicit confirmation.</p>
              </div>
            </div>
            <div className="agent-lifecycle-list">
              <div><div><strong>{agent.status === 'paused' ? 'Activate runtime access' : 'Pause runtime access'}</strong><span>{agent.status === 'paused' ? 'Restore managed calls for active credentials.' : 'Credentials remain recorded, but managed calls stop.'}</span></div><button className="agent-secondary-button" onClick={() => setDrawer('lifecycle')} type="button">{agent.status === 'paused' ? 'Activate' : 'Pause'}</button></div>
              <div><div><strong>Deactivate agent</strong><span>Permanently disable this identity and its active runtime access.</span></div><button className="agent-danger-button" disabled={agent.status === 'deactivated'} onClick={() => setDrawer('lifecycle')} type="button">{agent.status === 'deactivated' ? 'Deactivated' : 'Deactivate'}</button></div>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === 'access' ? (
        <div className="agent-detail-canvas">
          <section className="agent-detail-section policy-assignment-panel" aria-labelledby="agent-policies-title">
            <div className="agent-section-heading">
              <div>
                <h2 id="agent-policies-title">Effective policies</h2>
                <p>Direct assignments and inherited controls currently governing this identity.</p>
              </div>
              <button className="agent-secondary-button" disabled={assignablePolicies.length === 0 || actions?.bindPolicy === undefined} onClick={() => setDrawer('policy')} type="button">Attach policy</button>
            </div>
            {directPolicies.length === 0 ? (
              <div className="soft-row">
                <strong>No direct policies attached.</strong>
                <span>Attach an active agent-compatible policy to govern this agent directly.</span>
              </div>
            ) : (
              <ol className="policy-assignment-list">
                {directPolicies.map((policy) => (
                  <li key={`${policy.id}:${policy.version}:${policy.binding.id}`}>
                    <div className="agent-policy-row-main">
                      <strong>{policy.name}</strong>
                      <span>{policy.description || 'Active policy'}</span>
                    </div>
                    <div className="agent-policy-row-meta">
                      <span className="agent-status-badge is-active">{formatPolicyScope(policy.binding.scope)}</span>
                      <span>{policy.binding.target_label}</span>
                      <code>v{policy.version}</code>
                      {actions?.removePolicyBinding !== undefined ? (
                        <form action={actions.removePolicyBinding}>
                          <input name="policyId" type="hidden" value={policy.id} />
                          <input name="bindingId" type="hidden" value={policy.binding.id} />
                          <button className="button-secondary" type="submit">
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {inheritedPolicies.length > 0 ? (
              <div className="inherited-policy-block">
                <h3>Inherited policies</h3>
                <ol className="policy-assignment-list">
                  {inheritedPolicies.map((policy) => (
                    <li key={`${policy.id}:${policy.version}:${policy.binding.id}`}>
                      <div className="agent-policy-row-main">
                        <strong>{policy.name}</strong>
                        <span>{policy.description || 'Inherited policy'}</span>
                      </div>
                      <div className="agent-policy-row-meta">
                        <span className="agent-status-badge is-info">{formatPolicyScope(policy.binding.scope)}</span>
                        <span>{policy.binding.target_label}</span>
                        <code>v{policy.version}</code>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>

          <section className="agent-detail-section operational-access-panel" aria-labelledby="operational-access-title">
            <div className="agent-section-heading">
              <div>
                <h2 id="operational-access-title">Operational access</h2>
                <p>Effective action rules and the most recent blocked operations.</p>
              </div>
            </div>
            <div className="agent-access-crosslink">
              <div>
                <strong>Payment access lives in Treasury</strong>
                <span>Budgets, allowed rails, and approval thresholds are managed from the Agent Access treasury view.</span>
              </div>
              <Link className="agent-secondary-button" href={`/app/${orgSlug}/payments/agent-access`}>
                Open Treasury
              </Link>
            </div>
            <div className="operational-access-grid">
              <div>
                <h3>Effective action rules</h3>
                {allowedActions.length === 0 ? (
                  <div className="soft-row">
                    <strong>No action rules.</strong>
                    <span>Bind an active operational policy from Controls to show action-level access here.</span>
                  </div>
                ) : (
                  <ol className="operational-access-list">
                    {allowedActions.map((action) => (
                      <li key={`${action.action}:${action.label}:${action.policyName}`}>
                        <div>
                          <strong>{action.label}</strong>
                          <span>{formatOperationalAction(action.action)}</span>
                        </div>
                        <div>
                          <span className={`ops-state-pill ops-state-${action.decision}`}>
                            {formatOperationalDecision(action.decision)}
                          </span>
                          <span>{action.policyName}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div>
                <h3>Recent blocks</h3>
                {blockedOperations.length === 0 ? (
                  <div className="soft-row">
                    <strong>No blocked operations.</strong>
                    <span>Denied runtime checks will appear here after the agent calls agentOps.</span>
                  </div>
                ) : (
                  <ol className="operational-access-list">
                    {blockedOperations.map((operation) => (
                      <li key={operation.id}>
                        <div>
                          <strong>{blockedOperationLabel(operation)}</strong>
                          <span>{formatOperationalAction(operation.action)}</span>
                        </div>
                        <div>
                          <span className={`ops-state-pill ops-state-${operation.decision}`}>
                            {formatOperationalDecision(operation.decision)}
                          </span>
                          <span>{operation.reasonCode}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === 'credentials' ? (
        <div className="agent-record-stack">
          <ConnectionPanel
            agentId={agent.id}
            connections={connections}
            createAction={actions?.createConnection}
            mcpEndpoint={mcpEndpoint}
            orgId={orgId}
            orgSlug={orgSlug}
            revokeAction={actions?.revokeConnection}
            rotateAction={actions?.rotateConnection}
          />

          <WalletRefsPanel
            agentId={agent.id}
            attachAction={actions?.attachWalletRef}
            detachAction={actions?.detachWalletRef}
            orgId={orgId}
            orgSlug={orgSlug}
            walletRefs={walletRefs}
          />
        </div>
      ) : null}

      {activeTab === 'publish' ? (
        <AgentPublishPanel
          endpointUrl={typeof agent.metadata.public_endpoint_url === 'string' ? agent.metadata.public_endpoint_url : ''}
          identity={onchainIdentity}
          registerIdentityAction={
            actions?.registerOnchainIdentity
            ?? (async () => {
              throw new Error('Identity registration is unavailable.');
            })
          }
          saveListingAction={
            actions?.savePublishListing
            ?? (async () => {
              throw new Error('Listing save is unavailable.');
            })
          }
          templateRepoUrl={templateRepoUrl}
        />
      ) : null}

      {activeTab === 'activity' ? (
        <AgentActivityWorkspace activity={activity} feed={feed} pollUrl={activityPollUrl} />
      ) : null}

      <Sheet labelledBy="edit-agent-drawer-title" onOpenChange={(open) => setDrawer(open ? 'edit' : null)} open={drawer === 'edit'} panelClassName="agent-action-sheet">
        <SheetHeader>
          <div><SheetTitle id="edit-agent-drawer-title">Edit agent</SheetTitle><SheetDescription>Update identity metadata used by policy targeting and operator views.</SheetDescription></div>
          <SheetCloseButton onClick={() => setDrawer(null)} />
        </SheetHeader>
        <form action={updateFormAction} className="focus-form">
          <SheetBody className="operations-form">
            <label><span>Name</span><input defaultValue={agent.name} name="name" required /></label>
            <label><span>Team</span><select defaultValue={agent.team.id} name="teamId">{(teams ?? [agent.team]).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            <label><span>Description</span><input defaultValue={agent.description} name="description" /></label>
            <label><span>Labels</span><input defaultValue={agent.labels.join(', ')} name="labels" /></label>
            <label><span>Environment</span><input defaultValue={agent.default_environment ?? ''} name="defaultEnvironment" /></label>
            {updateState.error !== undefined ? <p className="form-error" role="alert">{updateState.error}</p> : null}
            <button className="agent-primary-button agent-inline-submit" disabled={updatePending || actions?.updateAgent === undefined} type="submit">{updatePending ? 'Saving...' : 'Save agent'}</button>
          </SheetBody>
        </form>
      </Sheet>

      <Sheet labelledBy="agent-policy-drawer-title" onOpenChange={(open) => setDrawer(open ? 'policy' : null)} open={drawer === 'policy'} panelClassName="agent-action-sheet">
        <SheetHeader>
          <div><SheetTitle id="agent-policy-drawer-title">Attach policy</SheetTitle><SheetDescription>Add one direct agent assignment. Inherited workspace, team, and credential policies remain unchanged.</SheetDescription></div>
          <SheetCloseButton onClick={() => setDrawer(null)} />
        </SheetHeader>
        <form action={bindFormAction} className="focus-form">
          <SheetBody className="operations-form">
            <label><span>Policy</span><select name="policySelection" disabled={assignablePolicies.length === 0}>{assignablePolicies.length === 0 ? <option value="">No unassigned agent policies</option> : assignablePolicies.map((policy) => <option key={`${policy.id}:${policy.version}`} value={`${policy.id}:${policy.version}`}>{policy.name} · v{policy.version}</option>)}</select></label>
            {bindState.error !== undefined ? <p className="form-error" role="alert">{bindState.error}</p> : null}
            <button className="agent-primary-button agent-inline-submit" disabled={bindPending || assignablePolicies.length === 0 || actions?.bindPolicy === undefined} type="submit">{bindPending ? 'Attaching...' : 'Attach policy'}</button>
          </SheetBody>
        </form>
      </Sheet>

      <Sheet labelledBy="agent-lifecycle-drawer-title" onOpenChange={(open) => { setDrawer(open ? 'lifecycle' : null); if (!open) setConfirmDeactivate(false); }} open={drawer === 'lifecycle'} panelClassName="agent-action-sheet">
        <SheetHeader>
          <div><SheetTitle id="agent-lifecycle-drawer-title">Agent lifecycle</SheetTitle><SheetDescription>Pause, reactivate, or permanently deactivate this runtime identity.</SheetDescription></div>
          <SheetCloseButton onClick={() => { setDrawer(null); setConfirmDeactivate(false); }} />
        </SheetHeader>
        <SheetBody className="lifecycle-action-list">
          {agent.status === 'active' && actions?.pause !== undefined ? <form action={actions.pause} className="lifecycle-action-row"><div><strong>Pause runtime access</strong><span>Credentials remain recorded, but managed calls stop.</span></div><button className="button-secondary" type="submit">Pause</button></form> : null}
          {agent.status === 'paused' && actions?.activate !== undefined ? <form action={actions.activate} className="lifecycle-action-row"><div><strong>Activate agent</strong><span>Restore managed runtime access for active credentials.</span></div><button className="console-primary-button" type="submit">Activate</button></form> : null}
          {agent.status !== 'deactivated' && actions?.deactivate !== undefined ? (
            confirmDeactivate ? <form action={actions.deactivate} className="lifecycle-action-row destructive"><div><strong>Confirm deactivation</strong><span>This permanently disables the identity and its active runtime access.</span></div><div className="button-row"><button className="button-secondary" onClick={() => setConfirmDeactivate(false)} type="button">Cancel</button><button className="button-danger" type="submit">Deactivate</button></div></form> : <div className="lifecycle-action-row destructive"><div><strong>Deactivate agent</strong><span>Use only when this identity should no longer operate.</span></div><button className="button-danger" onClick={() => setConfirmDeactivate(true)} type="button">Deactivate</button></div>
          ) : null}
        </SheetBody>
      </Sheet>
    </div>
  );
}
