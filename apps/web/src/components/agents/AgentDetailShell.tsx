import Link from 'next/link';
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
import { formatConnectionHealth, formatStatus } from './format';
import { ConnectionPanel } from './ConnectionPanel';
import { AgentLiveActivity } from './AgentLiveActivity';
import { WalletRefsPanel } from './WalletRefsPanel';

export type AgentDetailTab = 'overview' | 'access' | 'credentials' | 'activity';

const agentDetailTabs: ReadonlyArray<{
  readonly id: AgentDetailTab;
  readonly label: string;
  readonly description: string;
}> = [
  { id: 'overview', label: 'Overview', description: 'Identity, status, and editable metadata.' },
  { id: 'access', label: 'Policies & access', description: 'Effective policy bindings and runtime operation controls.' },
  { id: 'credentials', label: 'Credentials & wallets', description: 'Agent credentials and external wallet references.' },
  { id: 'activity', label: 'Activity history', description: 'Live runtime events and configuration audit history.' },
];

function formatAuditLabel(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

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
  actions,
}: {
  readonly orgId: string;
  readonly orgSlug: string;
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
  readonly actions?: {
    readonly pause?: (() => Promise<void>) | undefined;
    readonly activate?: (() => Promise<void>) | undefined;
    readonly deactivate?: (() => Promise<void>) | undefined;
    readonly createConnection?: Parameters<typeof ConnectionPanel>[0]['createAction'] | undefined;
    readonly rotateConnection?: Parameters<typeof ConnectionPanel>[0]['rotateAction'] | undefined;
    readonly testConnection?: Parameters<typeof ConnectionPanel>[0]['testAction'] | undefined;
    readonly revokeConnection?: Parameters<typeof ConnectionPanel>[0]['revokeAction'] | undefined;
    readonly attachWalletRef?: Parameters<typeof WalletRefsPanel>[0]['attachAction'] | undefined;
    readonly detachWalletRef?: Parameters<typeof WalletRefsPanel>[0]['detachAction'] | undefined;
    readonly updateAgent?: ((formData: FormData) => Promise<void>) | undefined;
    readonly bindPolicy?: ((formData: FormData) => Promise<void>) | undefined;
    readonly removePolicyBinding?: ((formData: FormData) => Promise<void>) | undefined;
  } | undefined;
}) {
  const detailPath = `/app/${orgSlug}/agents/${agent.id}`;
  const activeTabMeta = agentDetailTabs.find((tab) => tab.id === activeTab) ?? agentDetailTabs[0]!;
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
    <div className="detail-layout">
      <section className="detail-hero">
        <div>
          <p className="eyebrow">Agent identity</p>
          <h1>{agent.name}</h1>
          <p>Registered runtime identity with credential controls and audit history.</p>
        </div>
        <div className="hero-actions">
          <span className={`pill status-${agent.status}`}>{formatStatus(agent.status)}</span>
          <span className="pill">{formatConnectionHealth(agent.connection_health)}</span>
        </div>
      </section>

      <section className="metric-strip" aria-label="Agent summary">
        <div>
          <span>Team</span>
          <strong>{agent.team.name}</strong>
        </div>
        <div>
          <span>Credentials</span>
          <strong>{connections.length}</strong>
        </div>
        <div>
          <span>Runtime events</span>
          <strong>{feed.events.length}</strong>
        </div>
      </section>

      <nav className="agent-detail-tabs" aria-label="Agent detail sections">
        {agentDetailTabs.map((tab) => {
          const href = tab.id === 'overview' ? detailPath : `${detailPath}?tab=${tab.id}`;
          const isActive = tab.id === activeTab;
          return (
            <Link aria-current={isActive ? 'page' : undefined} className={isActive ? 'is-active' : ''} href={href} key={tab.id}>
              <span>{tab.label}</span>
              <small>{tab.description}</small>
            </Link>
          );
        })}
      </nav>

      <section className="agent-detail-tab-summary" aria-label="Current agent section">
        <span>{activeTabMeta.label}</span>
        <p>{activeTabMeta.description}</p>
      </section>

      {activeTab === 'overview' ? (
        <div className="agent-detail-panel-grid">
          <section className="section-block" aria-labelledby="overview-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Controls</p>
                <h2 id="overview-title">Identity details</h2>
              </div>
              <div className="button-row">
                {agent.status === 'active' && actions?.pause !== undefined ? (
                  <form action={actions.pause}>
                    <button className="button-secondary" type="submit">
                      Pause
                    </button>
                  </form>
                ) : null}
                {agent.status === 'paused' && actions?.activate !== undefined ? (
                  <form action={actions.activate}>
                    <button className="button-primary" type="submit">
                      Activate
                    </button>
                  </form>
                ) : null}
                {agent.status !== 'deactivated' && actions?.deactivate !== undefined ? (
                  <form action={actions.deactivate}>
                    <button className="button-danger" type="submit">
                      Deactivate
                    </button>
                  </form>
                ) : null}
              </div>
            </div>

            <div className="identity-grid">
              <div>
                <span>Agent ID</span>
                <code>{agent.id}</code>
              </div>
              <div>
                <span>Team</span>
                <strong>{agent.team.name}</strong>
              </div>
              <div>
                <span>Parent</span>
                <strong>{agent.parent?.name ?? 'None'}</strong>
              </div>
              <div>
                <span>Child agents</span>
                <strong>{agent.children.length === 0 ? 'None' : String(agent.children.length)}</strong>
              </div>
              <div>
                <span>Description</span>
                <strong>{agent.description.length > 0 ? agent.description : 'Not set'}</strong>
              </div>
              <div>
                <span>Labels</span>
                <strong>{agent.labels.length === 0 ? 'None' : agent.labels.join(', ')}</strong>
              </div>
              <div>
                <span>Environment</span>
                <strong>{agent.default_environment ?? 'Not set'}</strong>
              </div>
            </div>
          </section>

          <section className="section-block" aria-labelledby="edit-agent-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Profile</p>
                <h2 id="edit-agent-title">Agent settings</h2>
              </div>
              <p>Update identity metadata used by policy targeting and operator views.</p>
            </div>
            <form action={actions?.updateAgent} className="inline-form wallet-form agent-settings-form">
              <label>
                <span>Name</span>
                <input defaultValue={agent.name} name="name" required />
              </label>
              <label>
                <span>Team</span>
                <select defaultValue={agent.team.id} name="teamId">
                  {(teams ?? [agent.team]).map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Description</span>
                <input defaultValue={agent.description} name="description" />
              </label>
              <label>
                <span>Labels</span>
                <input defaultValue={agent.labels.join(', ')} name="labels" />
              </label>
              <label>
                <span>Environment</span>
                <input defaultValue={agent.default_environment ?? ''} name="defaultEnvironment" />
              </label>
              <button className="button-secondary" disabled={actions?.updateAgent === undefined} type="submit">
                Save agent
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {activeTab === 'access' ? (
        <div className="agent-detail-panel-grid">
          <section className="section-block policy-assignment-panel" aria-labelledby="agent-policies-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Effective controls</p>
                <h2 id="agent-policies-title">Policies</h2>
              </div>
              <p>Attach direct agent policies here. Workspace, team, and credential policies are inherited read-only context.</p>
            </div>
            <form action={actions?.bindPolicy} className="agent-policy-bind-form">
              <label>
                <span>Policy</span>
                <select name="policySelection" disabled={assignablePolicies.length === 0 || actions?.bindPolicy === undefined}>
                  {assignablePolicies.length === 0 ? (
                    <option value="">No unassigned agent policies</option>
                  ) : (
                    assignablePolicies.map((policy) => (
                      <option key={`${policy.id}:${policy.version}`} value={`${policy.id}:${policy.version}`}>
                        {policy.name} · v{policy.version}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button className="button-secondary" disabled={assignablePolicies.length === 0 || actions?.bindPolicy === undefined} type="submit">
                Attach policy
              </button>
            </form>
            {directPolicies.length === 0 ? (
              <div className="soft-row">
                <strong>No direct policies attached.</strong>
                <span>Attach an active agent-compatible policy to govern this agent directly.</span>
              </div>
            ) : (
              <ol className="policy-assignment-list">
                {directPolicies.map((policy) => (
                  <li key={`${policy.id}:${policy.version}:${policy.binding.id}`}>
                    <div className="activity-event-main">
                      <strong>{policy.name}</strong>
                      <span>{policy.description || 'Active policy'}</span>
                    </div>
                    <div className="activity-event-meta">
                      <strong>{formatPolicyScope(policy.binding.scope)}</strong>
                      <span>{policy.binding.target_label}</span>
                      <span>v{policy.version}</span>
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
                      <div className="activity-event-main">
                        <strong>{policy.name}</strong>
                        <span>{policy.description || 'Inherited policy'}</span>
                      </div>
                      <div className="activity-event-meta">
                        <strong>{formatPolicyScope(policy.binding.scope)}</strong>
                        <span>{policy.binding.target_label}</span>
                        <span>v{policy.version}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>

          <section className="section-block operational-access-panel" aria-labelledby="operational-access-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Runtime operations</p>
                <h2 id="operational-access-title">Operational access</h2>
              </div>
              <p>Effective operation rules and recent blocks for this agent.</p>
            </div>
            <div className="agent-access-crosslink">
              <div>
                <strong>Payment access lives in Treasury</strong>
                <span>Budgets, allowed rails, and approval thresholds are managed from the Agent Access treasury view.</span>
              </div>
              <Link className="button-secondary" href={`/app/${orgSlug}/payments/agent-access`}>
                Open Treasury
              </Link>
            </div>
            <div className="operational-access-grid">
              <div>
                <h3>Allowed actions</h3>
                {allowedActions.length === 0 ? (
                  <div className="soft-row">
                    <strong>No operational policies.</strong>
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
        <div className="agent-detail-panel-grid">
          <ConnectionPanel
            agentId={agent.id}
            connections={connections}
            createAction={actions?.createConnection}
            orgId={orgId}
            orgSlug={orgSlug}
            revokeAction={actions?.revokeConnection}
            rotateAction={actions?.rotateConnection}
            testAction={actions?.testConnection}
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

      {activeTab === 'activity' ? (
        <div className="agent-detail-panel-grid">
          <AgentLiveActivity initialFeed={feed} pollUrl={activityPollUrl} />

          <section className="section-block" aria-labelledby="activity-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Audit ledger</p>
                <h2 id="activity-title">Configuration history</h2>
              </div>
              <p>Agent setup and credential changes from the canonical audit event stream.</p>
            </div>
            {activity.length === 0 ? (
              <div className="soft-row">
                <strong>No configuration events yet.</strong>
                <span>New identity and credential changes will appear here.</span>
              </div>
            ) : (
              <ol className="activity-list">
                {activity.map((item) => (
                  <li key={item.id}>
                    <div className="activity-event-main">
                      <strong>{item.summary}</strong>
                      {item.subject !== null ? <span className="activity-event-subject">{item.subject}</span> : null}
                      <span>{item.description ?? 'Recorded configuration change'}</span>
                    </div>
                    <div className="activity-event-meta">
                      <span>{formatAuditLabel(item.eventDomain)}</span>
                      <strong>{formatStatus(item.outcome)}</strong>
                      <time dateTime={item.recordedAt}>{new Date(item.recordedAt).toLocaleString()}</time>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
