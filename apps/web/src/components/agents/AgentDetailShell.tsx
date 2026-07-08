import type {
  ActivityItem,
  AgentActivityFeed,
  AgentDetail,
  ConnectionRecord,
} from '@/lib/identity-spine-types';
import type { AgentAllowedActionRecord, BlockedOperationRecord } from '@/lib/operations-types';
import type { AgentPolicyAssignment } from '@/lib/policy-types';
import { formatConnectionHealth, formatStatus } from './format';
import { ConnectionPanel } from './ConnectionPanel';
import { AgentLiveActivity } from './AgentLiveActivity';

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
  connections,
  activity,
  activityFeed,
  activityPollUrl,
  policies = [],
  allowedActions = [],
  blockedOperations = [],
  actions,
}: {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly agent: AgentDetail;
  readonly connections: ConnectionRecord[];
  readonly activity: ActivityItem[];
  readonly activityFeed?: AgentActivityFeed | undefined;
  readonly activityPollUrl?: string | undefined;
  readonly policies?: AgentPolicyAssignment[] | undefined;
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
  } | undefined;
}) {
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
        </div>
      </section>

      <section className="section-block policy-assignment-panel" aria-labelledby="agent-policies-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Effective controls</p>
            <h2 id="agent-policies-title">Policies</h2>
          </div>
          <p>Active policies applied through the workspace, team, agent, or its credentials.</p>
        </div>
        {policies.length === 0 ? (
          <div className="soft-row">
            <strong>No policies attached.</strong>
            <span>Bind active policies from Controls to govern this agent.</span>
          </div>
        ) : (
          <ol className="policy-assignment-list">
            {policies.map((policy) => (
              <li key={`${policy.id}:${policy.version}:${policy.binding.id}`}>
                <div className="activity-event-main">
                  <strong>{policy.name}</strong>
                  <span>{policy.description || 'Active policy'}</span>
                </div>
                <div className="activity-event-meta">
                  <strong>{formatPolicyScope(policy.binding.scope)}</strong>
                  <span>{policy.binding.target_label}</span>
                  <span>v{policy.version}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="section-block operational-access-panel" aria-labelledby="operational-access-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Runtime operations</p>
            <h2 id="operational-access-title">Operational access</h2>
          </div>
          <p>Effective operation rules and recent blocks for this agent.</p>
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
  );
}
