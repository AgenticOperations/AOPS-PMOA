'use client';

import { useMemo, useState } from 'react';
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  BlockedOperationRecord,
  McpSessionRecord,
  OperationalAction,
  OperationalDecisionRecord,
  OperationsAgentOption,
  OperationDecision,
  RateLimitUtilizationRecord,
  ToolCatalogRecord,
} from '@/lib/operations-types';

type OperationsWorkbenchProps = {
  readonly agents: readonly OperationsAgentOption[];
  readonly archiveToolAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly blocked: readonly BlockedOperationRecord[];
  readonly decisions: readonly OperationalDecisionRecord[];
  readonly disableRateLimitAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly sessions: readonly McpSessionRecord[];
  readonly tools: readonly ToolCatalogRecord[];
  readonly importAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly rateLimits: readonly RateLimitUtilizationRecord[];
  readonly rateLimitAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly updateRateLimitAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly updateToolAction?: ((formData: FormData) => Promise<void>) | undefined;
};

type DetailState =
  | { readonly kind: 'tool'; readonly id: string }
  | { readonly kind: 'rate-limit'; readonly id: string }
  | { readonly kind: 'decision'; readonly id: string }
  | { readonly kind: 'session'; readonly id: string }
  | null;

const actionOptions: Array<{ readonly label: string; readonly value: OperationalAction }> = [
  { label: 'HTTP request', value: 'runtime.http.request' },
  { label: 'Tool call', value: 'tool.call' },
];

const decisionOptions: Array<{ readonly label: string; readonly value: OperationDecision }> = [
  { label: 'Allow', value: 'allow' },
  { label: 'Deny', value: 'deny' },
  { label: 'Observe', value: 'observe' },
  { label: 'Approval required', value: 'approval_required' },
  { label: 'Rate limited', value: 'rate_limited' },
];

function formatAction(value: string): string {
  if (value === 'runtime.http.request') return 'HTTP request';
  if (value === 'tool.call') return 'Tool call';
  return value;
}

function formatDecision(value: string): string {
  if (value === 'approval_required') return 'Approval required';
  if (value === 'rate_limited') return 'Rate limited';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatRisk(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function agentName(agents: readonly OperationsAgentOption[], agentId: string): string {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function operationLabel(operation: Pick<OperationalDecisionRecord, 'action' | 'resource_label' | 'tool_name'>): string {
  return operation.tool_name ?? operation.resource_label ?? operation.action;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

function sessionState(session: McpSessionRecord): 'live' | 'idle' | 'offline' {
  const ageMs = Date.now() - new Date(session.last_seen_at).getTime();
  if (ageMs <= 2 * 60 * 1000) return 'live';
  if (ageMs <= 30 * 60 * 1000) return 'idle';
  return 'offline';
}

function sessionStateLabel(value: ReturnType<typeof sessionState>): string {
  if (value === 'live') return 'Live';
  if (value === 'idle') return 'Idle';
  return 'Offline';
}

function utilizationPercent(limit: RateLimitUtilizationRecord): number {
  if (limit.limit <= 0) return 0;
  return Math.min(100, Math.round((limit.utilization.current_count / limit.limit) * 100));
}

function jsonPreview(value: Record<string, unknown>): string {
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  return JSON.stringify(value, null, 2);
}

export function OperationsWorkbench({
  agents,
  archiveToolAction,
  blocked,
  decisions,
  disableRateLimitAction,
  sessions,
  tools,
  importAction,
  rateLimits,
  rateLimitAction,
  updateRateLimitAction,
  updateToolAction,
}: OperationsWorkbenchProps) {
  const [detail, setDetail] = useState<DetailState>(null);
  const [agentFilter, setAgentFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [decisionFilter, setDecisionFilter] = useState('all');

  const filteredDecisions = useMemo(
    () =>
      decisions.filter((decision) => {
        if (agentFilter !== 'all' && decision.agent_id !== agentFilter) return false;
        if (actionFilter !== 'all' && decision.action !== actionFilter) return false;
        if (decisionFilter !== 'all' && decision.decision !== decisionFilter) return false;
        return true;
      }),
    [actionFilter, agentFilter, decisionFilter, decisions],
  );

  const activeTools = tools.filter((tool) => tool.status === 'active').length;
  const activeLimits = rateLimits.filter((limit) => limit.status === 'active').length;
  const liveSessions = sessions.filter((session) => sessionState(session) === 'live').length;
  const selectedTool = detail?.kind === 'tool' ? tools.find((tool) => tool.id === detail.id) : undefined;
  const selectedLimit = detail?.kind === 'rate-limit' ? rateLimits.find((limit) => limit.id === detail.id) : undefined;
  const selectedDecision = detail?.kind === 'decision' ? decisions.find((decision) => decision.id === detail.id) : undefined;
  const selectedSession = detail?.kind === 'session' ? sessions.find((session) => session.id === detail.id) : undefined;

  return (
    <div className="ops-page operations-workbench">
      <header className="ops-page-header operations-header">
        <div>
          <h1>Operations</h1>
          <p>Manage the operational surfaces agents call through agentOps.</p>
        </div>
      </header>

      <section className="ops-surface operations-command-strip" aria-label="Operations summary">
        <div>
          <span>Active tools</span>
          <strong>{activeTools}</strong>
        </div>
        <div>
          <span>Active limits</span>
          <strong>{activeLimits}</strong>
        </div>
        <div>
          <span>Recent decisions</span>
          <strong>{decisions.length}</strong>
        </div>
        <div>
          <span>Live sessions</span>
          <strong>{liveSessions}</strong>
        </div>
      </section>

      <Tabs defaultValue="tools">
        <div className="operations-tab-bar">
          <TabsList>
            <TabsTrigger value="tools">Tool catalog</TabsTrigger>
            <TabsTrigger value="limits">Rate limits</TabsTrigger>
            <TabsTrigger value="decisions">Decisions</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="tools">
          <div className="operations-grid operations-grid-tools">
            <section className="ops-surface" aria-labelledby="tool-catalog-title">
              <div className="ops-surface-heading">
                <div>
                  <h2 id="tool-catalog-title">Tool catalog</h2>
                  <p>Imported tools become named operational policy surfaces.</p>
                </div>
                <span className="ops-count-pill">{tools.length} tool{tools.length === 1 ? '' : 's'}</span>
              </div>

              {tools.length === 0 ? (
                <div className="ops-empty-state">
                  <h3>No tools imported</h3>
                  <p>Import a tool when an agent should route that operation through agentOps.</p>
                </div>
              ) : (
                <div className="operations-table operations-tool-table" role="table" aria-label="Tool catalog">
                  <div className="operations-table-head" role="row">
                    <span role="columnheader">Tool</span>
                    <span role="columnheader">Category</span>
                    <span role="columnheader">Risk</span>
                    <span role="columnheader">Status</span>
                    <span role="columnheader">Details</span>
                  </div>
                  {tools.map((tool) => (
                    <article className="operations-table-row" key={tool.id} role="row">
                      <div role="cell">
                        <strong>{tool.display_name}</strong>
                        <span>{tool.name}</span>
                        {tool.description.length > 0 ? <span>{tool.description}</span> : null}
                      </div>
                      <span role="cell">{tool.category}</span>
                      <span className={`ops-state-pill ops-state-${tool.risk_level}`} role="cell">
                        {formatRisk(tool.risk_level)}
                      </span>
                      <span className={`ops-state-pill ops-state-${tool.status}`} role="cell">
                        {formatDecision(tool.status)}
                      </span>
                      <button className="ops-row-open" onClick={() => setDetail({ kind: 'tool', id: tool.id })} type="button">
                        Inspect {tool.name}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="ops-surface operations-action-card" aria-labelledby="import-tool-title">
              <div className="ops-surface-heading">
                <div>
                  <h2 id="import-tool-title">Import tool</h2>
                  <p>Add one managed tool surface.</p>
                </div>
              </div>

              <form action={importAction} className="operations-form">
                <label>
                  <span>Tool name</span>
                  <input name="name" placeholder="browser.search" required />
                </label>
                <label>
                  <span>Display name</span>
                  <input name="displayName" placeholder="Browser search" />
                </label>
                <div className="operations-form-grid">
                  <label>
                    <span>Category</span>
                    <input name="category" placeholder="browser" />
                  </label>
                  <label>
                    <span>Risk</span>
                    <select defaultValue="medium" name="riskLevel">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                </div>
                <label>
                  <span>Description</span>
                  <textarea name="description" placeholder="Managed search tool" rows={3} />
                </label>
                <button className="button-primary" type="submit">
                  Import tool
                </button>
              </form>
            </section>
          </div>
        </TabsContent>

        <TabsContent value="limits">
          <div className="operations-grid operations-grid-limits">
            <section className="ops-surface" aria-labelledby="rate-limits-title">
              <div className="ops-surface-heading">
                <div>
                  <h2 id="rate-limits-title">Rate limits</h2>
                  <p>Runtime counters for repeated API and tool checks.</p>
                </div>
                <span className="ops-count-pill">{rateLimits.length} limit{rateLimits.length === 1 ? '' : 's'}</span>
              </div>

              {rateLimits.length === 0 ? (
                <div className="ops-empty-state">
                  <h3>No rate limits</h3>
                  <p>Create a limit to throttle repeated agent actions.</p>
                </div>
              ) : (
                <div className="operations-limit-list" aria-label="Rate limits">
                  {rateLimits.map((limit) => {
                    const percent = utilizationPercent(limit);
                    return (
                      <article className="operations-limit-row" key={limit.id}>
                        <div>
                          <span className="ops-row-title">{agentName(agents, limit.target_id)}</span>
                          <span>{formatAction(limit.action)} · {limit.bucket}</span>
                        </div>
                        <div className="operations-meter" aria-label={`${percent}% utilized`}>
                          <span style={{ width: `${percent}%` }} />
                        </div>
                        <div className="operations-limit-meta">
                          <span>{limit.utilization.current_count}/{limit.limit}</span>
                          <span>{limit.window_seconds}s</span>
                          <span className={`ops-state-pill ops-state-${limit.status}`}>{formatDecision(limit.status)}</span>
                          <button className="button-secondary" onClick={() => setDetail({ kind: 'rate-limit', id: limit.id })} type="button">
                            Configure
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="ops-surface operations-action-card" aria-labelledby="limit-title">
              <div className="ops-surface-heading">
                <div>
                  <h2 id="limit-title">Create limit</h2>
                  <p>Throttle one action for one agent.</p>
                </div>
              </div>

              <form action={rateLimitAction} className="operations-form">
                <label>
                  <span>Agent</span>
                  <select name="targetId" required>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Action</span>
                  <select defaultValue="runtime.http.request" name="action">
                    {actionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Bucket</span>
                  <input name="bucket" placeholder="default" />
                </label>
                <div className="operations-form-grid">
                  <label>
                    <span>Limit</span>
                    <input defaultValue="20" min="1" name="limit" required type="number" />
                  </label>
                  <label>
                    <span>Window seconds</span>
                    <input defaultValue="60" min="1" name="windowSeconds" required type="number" />
                  </label>
                </div>
                <button className="button-secondary" disabled={agents.length === 0} type="submit">
                  Create limit
                </button>
              </form>
            </section>
          </div>
        </TabsContent>

        <TabsContent value="decisions">
          <section className="ops-surface" aria-labelledby="operation-decisions-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="operation-decisions-title">Decisions</h2>
                <p>Recent operational checks across allow, observe, approval, deny, and rate-limit outcomes.</p>
              </div>
              <span className="ops-count-pill">{filteredDecisions.length} shown</span>
            </div>

            <div className="operations-filter-bar" aria-label="Decision filters">
              <label>
                <span>Agent</span>
                <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
                  <option value="all">All agents</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Action</span>
                <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
                  <option value="all">All actions</option>
                  {actionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Decision</span>
                <select value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value)}>
                  <option value="all">All decisions</option>
                  {decisionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {filteredDecisions.length === 0 ? (
              <div className="ops-empty-state">
                <h3>No operation decisions</h3>
                <p>Checks appear here after agents call the runtime API or MCP server.</p>
              </div>
            ) : (
              <div className="operations-table operations-decision-table" role="table" aria-label="Operation decisions">
                <div className="operations-table-head" role="row">
                  <span role="columnheader">Surface</span>
                  <span role="columnheader">Agent</span>
                  <span role="columnheader">Decision</span>
                  <span role="columnheader">When</span>
                  <span role="columnheader">Details</span>
                </div>
                {filteredDecisions.map((decision) => (
                  <article className="operations-table-row" key={decision.id} role="row">
                    <div role="cell">
                      <strong>{operationLabel(decision)}</strong>
                      <span>{formatAction(decision.action)}</span>
                      <span>{decision.reasonCode}</span>
                    </div>
                    <span role="cell">{agentName(agents, decision.agent_id)}</span>
                    <span className={`ops-state-pill ops-state-${decision.decision}`} role="cell">
                      {formatDecision(decision.decision)}
                    </span>
                    <time dateTime={decision.created_at}>{formatDateTime(decision.created_at)}</time>
                    <button className="ops-row-open" onClick={() => setDetail({ kind: 'decision', id: decision.id })} type="button">
                      Inspect {operationLabel(decision)}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          {blocked.length > 0 ? (
            <section className="ops-surface operations-blocked-strip" aria-labelledby="blocked-actions-title">
              <div className="ops-surface-heading">
                <div>
                  <h2 id="blocked-actions-title">Blocked actions</h2>
                  <p>Denied and rate-limited checks are highlighted for operator review.</p>
                </div>
                <span className="ops-count-pill">{blocked.length} block{blocked.length === 1 ? '' : 's'}</span>
              </div>
              <div className="ops-list" aria-label="Blocked actions">
                {blocked.slice(0, 5).map((operation) => (
                  <article className="ops-approval-row operations-block-row" key={operation.id}>
                    <div className="ops-approval-main">
                      <span className="ops-row-title">{operationLabel(operation)}</span>
                      <span>{formatAction(operation.action)} · {agentName(agents, operation.agent_id)}</span>
                    </div>
                    <div className="ops-approval-actions">
                      <span className={`ops-state-pill ops-state-${operation.decision}`}>
                        {formatDecision(operation.decision)}
                      </span>
                      <span>{operation.reasonCode}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </TabsContent>

        <TabsContent value="sessions">
          <section className="ops-surface" aria-labelledby="mcp-sessions-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="mcp-sessions-title">MCP sessions</h2>
                <p>Observed model-context sessions for runtime credentials.</p>
              </div>
              <span className="ops-count-pill">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
            </div>

            {sessions.length === 0 ? (
              <div className="ops-empty-state">
                <h3>No MCP sessions observed</h3>
                <p>Sessions appear after an agent connects through the standalone MCP service.</p>
              </div>
            ) : (
              <div className="operations-table operations-session-table" role="table" aria-label="MCP sessions">
                <div className="operations-table-head" role="row">
                  <span role="columnheader">Session</span>
                  <span role="columnheader">Agent</span>
                  <span role="columnheader">State</span>
                  <span role="columnheader">Last seen</span>
                  <span role="columnheader">Details</span>
                </div>
                {sessions.map((session) => {
                  const state = sessionState(session);
                  return (
                    <article className="operations-table-row" key={session.id} role="row">
                      <div role="cell">
                        <strong>{session.id}</strong>
                        <span>{session.protocol}</span>
                      </div>
                      <span role="cell">{agentName(agents, session.agent_id)}</span>
                      <span className={`ops-state-pill ops-state-${state}`} role="cell">
                        {sessionStateLabel(state)}
                      </span>
                      <time dateTime={session.last_seen_at}>{formatDateTime(session.last_seen_at)}</time>
                      <button className="ops-row-open" onClick={() => setDetail({ kind: 'session', id: session.id })} type="button">
                        Inspect {session.id}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <Sheet labelledBy="operations-detail-title" onOpenChange={(open) => !open && setDetail(null)} open={detail !== null}>
        <SheetHeader>
          <div>
            <SheetTitle id="operations-detail-title">
              {selectedTool?.display_name ??
                (selectedLimit === undefined ? undefined : `${agentName(agents, selectedLimit.target_id)} limit`) ??
                (selectedDecision === undefined ? undefined : operationLabel(selectedDecision)) ??
                selectedSession?.id ??
                'Operations detail'}
            </SheetTitle>
            <SheetDescription>
              {selectedTool !== undefined
                ? 'Inspect and maintain this managed tool surface.'
                : selectedLimit !== undefined
                  ? 'Edit or disable this runtime rate limit.'
                  : selectedDecision !== undefined
                    ? 'Review the persisted operation decision context.'
                    : selectedSession !== undefined
                      ? 'Review the last observed MCP session state.'
                      : 'Review the selected operations record.'}
            </SheetDescription>
          </div>
          <SheetCloseButton onClick={() => setDetail(null)} />
        </SheetHeader>
        <SheetBody>
          {selectedTool !== undefined ? (
            <div className="operations-detail-stack">
              <dl className="operations-detail-grid">
                <div>
                  <dt>Name</dt>
                  <dd>{selectedTool.name}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{selectedTool.source}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDateTime(selectedTool.created_at)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatDateTime(selectedTool.updated_at)}</dd>
                </div>
              </dl>
              <form action={updateToolAction} className="operations-form">
                <input name="toolId" type="hidden" value={selectedTool.id} />
                <label>
                  <span>Display name</span>
                  <input defaultValue={selectedTool.display_name} name="displayName" required />
                </label>
                <label>
                  <span>Category</span>
                  <input defaultValue={selectedTool.category} name="category" />
                </label>
                <label>
                  <span>Risk</span>
                  <select defaultValue={selectedTool.risk_level} name="riskLevel">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
                <label>
                  <span>Description</span>
                  <textarea defaultValue={selectedTool.description} name="description" rows={4} />
                </label>
                <button className="button-primary" disabled={selectedTool.status === 'archived'} type="submit">
                  Save tool
                </button>
              </form>
              <form action={archiveToolAction}>
                <input name="toolId" type="hidden" value={selectedTool.id} />
                <button className="button-secondary" disabled={selectedTool.status === 'archived'} type="submit">
                  Archive tool
                </button>
              </form>
              <pre className="operations-context-block">{jsonPreview(selectedTool.metadata)}</pre>
            </div>
          ) : null}

          {selectedLimit !== undefined ? (
            <div className="operations-detail-stack">
              <dl className="operations-detail-grid">
                <div>
                  <dt>Target</dt>
                  <dd>{agentName(agents, selectedLimit.target_id)}</dd>
                </div>
                <div>
                  <dt>Current usage</dt>
                  <dd>{selectedLimit.utilization.current_count}/{selectedLimit.limit}</dd>
                </div>
                <div>
                  <dt>Current bucket</dt>
                  <dd>{selectedLimit.utilization.current_bucket ?? 'No counter yet'}</dd>
                </div>
                <div>
                  <dt>Window started</dt>
                  <dd>{selectedLimit.utilization.current_window_start === null ? 'No counter yet' : formatDateTime(selectedLimit.utilization.current_window_start)}</dd>
                </div>
              </dl>
              <form action={updateRateLimitAction} className="operations-form">
                <input name="rateLimitId" type="hidden" value={selectedLimit.id} />
                <label>
                  <span>Bucket</span>
                  <input defaultValue={selectedLimit.bucket} name="bucket" />
                </label>
                <div className="operations-form-grid">
                  <label>
                    <span>Limit</span>
                    <input defaultValue={selectedLimit.limit} min="1" name="limit" required type="number" />
                  </label>
                  <label>
                    <span>Window seconds</span>
                    <input defaultValue={selectedLimit.window_seconds} min="1" name="windowSeconds" required type="number" />
                  </label>
                </div>
                <label>
                  <span>Status</span>
                  <select defaultValue={selectedLimit.status} name="status">
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </label>
                <button className="button-primary" type="submit">
                  Save limit
                </button>
              </form>
              <form action={disableRateLimitAction}>
                <input name="rateLimitId" type="hidden" value={selectedLimit.id} />
                <button className="button-secondary" disabled={selectedLimit.status === 'disabled'} type="submit">
                  Disable limit
                </button>
              </form>
            </div>
          ) : null}

          {selectedDecision !== undefined ? (
            <div className="operations-detail-stack">
              <dl className="operations-detail-grid">
                <div>
                  <dt>Agent</dt>
                  <dd>{agentName(agents, selectedDecision.agent_id)}</dd>
                </div>
                <div>
                  <dt>Decision</dt>
                  <dd>{formatDecision(selectedDecision.decision)}</dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd>{selectedDecision.reasonCode}</dd>
                </div>
                <div>
                  <dt>Policy decision</dt>
                  <dd>{selectedDecision.policyDecisionId ?? 'None'}</dd>
                </div>
                <div>
                  <dt>Approval</dt>
                  <dd>{selectedDecision.approvalId ?? 'None'}</dd>
                </div>
                <div>
                  <dt>Recorded</dt>
                  <dd>{formatDateTime(selectedDecision.created_at)}</dd>
                </div>
              </dl>
              <p className="operations-detail-note">{selectedDecision.explanation}</p>
              <pre className="operations-context-block">{jsonPreview(selectedDecision.context)}</pre>
            </div>
          ) : null}

          {selectedSession !== undefined ? (
            <div className="operations-detail-stack">
              <dl className="operations-detail-grid">
                <div>
                  <dt>Agent</dt>
                  <dd>{agentName(agents, selectedSession.agent_id)}</dd>
                </div>
                <div>
                  <dt>Connection</dt>
                  <dd>{selectedSession.connection_id}</dd>
                </div>
                <div>
                  <dt>Protocol</dt>
                  <dd>{selectedSession.protocol}</dd>
                </div>
                <div>
                  <dt>State</dt>
                  <dd>{sessionStateLabel(sessionState(selectedSession))}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDateTime(selectedSession.created_at)}</dd>
                </div>
                <div>
                  <dt>Last seen</dt>
                  <dd>{formatDateTime(selectedSession.last_seen_at)}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </SheetBody>
      </Sheet>
    </div>
  );
}
