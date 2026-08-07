'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconArrowRight } from '@tabler/icons-react';
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTablePager } from '@/components/ui/data-table-pager';
import type {
  OperationalAction,
  OperationalDecisionRecord,
  OperationsAgentOption,
  OperationDecision,
  RateLimitUtilizationRecord,
  ToolCatalogRecord,
} from '@/lib/operations-types';
import { formatUtcDateTime } from '@/lib/date-format';

type OperationsWorkbenchProps = {
  readonly agents: readonly OperationsAgentOption[];
  readonly archiveToolAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly decisions: readonly OperationalDecisionRecord[];
  readonly disableRateLimitAction?: ((formData: FormData) => Promise<void>) | undefined;
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
  | null;

type OperationsTab = 'tools' | 'limits' | 'decisions';

const TABLE_PAGE_SIZE = 10;

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
  return formatUtcDateTime(value);
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
  decisions,
  disableRateLimitAction,
  tools,
  importAction,
  rateLimits,
  rateLimitAction,
  updateRateLimitAction,
  updateToolAction,
}: OperationsWorkbenchProps) {
  const [detail, setDetail] = useState<DetailState>(null);
  const [confirmLifecycle, setConfirmLifecycle] = useState<'archive-tool' | 'disable-limit' | null>(null);
  const [createMode, setCreateMode] = useState<'tool' | 'rate-limit' | null>(null);
  const [activeTab, setActiveTab] = useState<OperationsTab>('tools');
  const [query, setQuery] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [agentFilter, setAgentFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [decisionFilter, setDecisionFilter] = useState('all');

  const filteredDecisions = useMemo(
    () =>
      decisions.filter((decision) => {
        const searchText = [
          operationLabel(decision),
          decision.action,
          decision.reasonCode,
          agentName(agents, decision.agent_id),
        ].join(' ').toLowerCase();
        if (query.trim().length > 0 && !searchText.includes(query.trim().toLowerCase())) return false;
        if (agentFilter !== 'all' && decision.agent_id !== agentFilter) return false;
        if (actionFilter !== 'all' && decision.action !== actionFilter) return false;
        if (decisionFilter !== 'all' && decision.decision !== decisionFilter) return false;
        return true;
      }),
    [actionFilter, agentFilter, agents, decisionFilter, decisions, query],
  );

  const filteredTools = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) return tools;
    return tools.filter((tool) => [tool.name, tool.display_name, tool.category, tool.description]
      .join(' ')
      .toLowerCase()
      .includes(normalized));
  }, [query, tools]);

  const filteredLimits = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) return rateLimits;
    return rateLimits.filter((limit) => [
      agentName(agents, limit.target_id),
      formatAction(limit.action),
      limit.bucket,
      limit.status,
    ].join(' ').toLowerCase().includes(normalized));
  }, [agents, query, rateLimits]);

  const currentTotal = activeTab === 'tools'
    ? filteredTools.length
    : activeTab === 'limits'
      ? filteredLimits.length
      : filteredDecisions.length;
  const safePage = Math.min(Math.max(1, tablePage), Math.max(1, Math.ceil(currentTotal / TABLE_PAGE_SIZE)));
  const pageStart = (safePage - 1) * TABLE_PAGE_SIZE;
  const pagedTools = filteredTools.slice(pageStart, pageStart + TABLE_PAGE_SIZE);
  const pagedLimits = filteredLimits.slice(pageStart, pageStart + TABLE_PAGE_SIZE);
  const pagedDecisions = filteredDecisions.slice(pageStart, pageStart + TABLE_PAGE_SIZE);

  useEffect(() => {
    setTablePage(1);
  }, [actionFilter, activeTab, agentFilter, decisionFilter, query]);

  const selectedTool = detail?.kind === 'tool' ? tools.find((tool) => tool.id === detail.id) : undefined;
  const selectedLimit = detail?.kind === 'rate-limit' ? rateLimits.find((limit) => limit.id === detail.id) : undefined;
  const selectedDecision = detail?.kind === 'decision' ? decisions.find((decision) => decision.id === detail.id) : undefined;
  const closeDetail = () => {
    setDetail(null);
    setConfirmLifecycle(null);
  };

  return (
    <div className="ops-page operations-workbench">
      <Tabs
        defaultValue="tools"
        onValueChange={(value) => setActiveTab(value as OperationsTab)}
        value={activeTab}
      >
        <div className="operations-tab-bar">
          <TabsList>
            <TabsTrigger value="tools">Tool catalog</TabsTrigger>
            <TabsTrigger value="limits">Rate limits</TabsTrigger>
            <TabsTrigger value="decisions">Decisions</TabsTrigger>
          </TabsList>
        </div>

        <header className="ops-page-header operations-header">
          <div>
            <p className="operations-eyebrow">Runtime</p>
            <h1>Operations</h1>
            <p>Tools, limits, and runtime decisions.</p>
          </div>
          {activeTab === 'tools' ? (
            <button className="console-primary-button" onClick={() => setCreateMode('tool')} type="button">Import tool</button>
          ) : activeTab === 'limits' ? (
            <button className="console-primary-button" disabled={agents.length === 0} onClick={() => setCreateMode('rate-limit')} type="button">Create limit</button>
          ) : null}
        </header>

        <TabsContent value="tools">
          <section className="ops-surface" aria-labelledby="tool-catalog-title">
              <div className="operations-toolbar">
                <label>
                  <span>Search tools</span>
                  <input onChange={(event) => setQuery(event.target.value)} placeholder="Search tools, categories, or risk" value={query} />
                </label>
              </div>
              <div className="ops-surface-heading">
                <div>
                  <h2 id="tool-catalog-title">Tools</h2>
                </div>
                <div className="operations-heading-actions">
                  <span className="ops-count-pill">{filteredTools.length} tool{filteredTools.length === 1 ? '' : 's'}</span>
                </div>
              </div>

              {filteredTools.length === 0 ? (
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
                  {pagedTools.map((tool) => (
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
                      <button aria-label={`Inspect ${tool.name}`} className="ops-row-open" onClick={() => setDetail({ kind: 'tool', id: tool.id })} type="button">
                        <IconArrowRight aria-hidden="true" size={13} stroke={1.8} />
                      </button>
                    </article>
                  ))}
                </div>
              )}
              {filteredTools.length > 0 ? (
                <DataTablePager itemLabel="tools" onPageChange={setTablePage} page={safePage} pageSize={TABLE_PAGE_SIZE} total={filteredTools.length} />
              ) : null}
          </section>
        </TabsContent>

        <TabsContent value="limits">
          <section className="ops-surface" aria-labelledby="rate-limits-title">
              <div className="operations-toolbar">
                <label>
                  <span>Search rate limits</span>
                  <input onChange={(event) => setQuery(event.target.value)} placeholder="Search agents, actions, or buckets" value={query} />
                </label>
              </div>
              <div className="ops-surface-heading">
                <div>
                  <h2 id="rate-limits-title">Rate limits</h2>
                </div>
                <div className="operations-heading-actions">
                  <span className="ops-count-pill">{filteredLimits.length} limit{filteredLimits.length === 1 ? '' : 's'}</span>
                </div>
              </div>

              {filteredLimits.length === 0 ? (
                <div className="ops-empty-state">
                  <h3>No rate limits</h3>
                  <p>Create a limit to throttle repeated agent actions.</p>
                </div>
              ) : (
                <div className="operations-limit-list" aria-label="Rate limits">
                  {pagedLimits.map((limit) => {
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
              {filteredLimits.length > 0 ? (
                <DataTablePager itemLabel="rate limits" onPageChange={setTablePage} page={safePage} pageSize={TABLE_PAGE_SIZE} total={filteredLimits.length} />
              ) : null}
          </section>
        </TabsContent>

        <TabsContent value="decisions">
          <section className="ops-surface" aria-labelledby="operation-decisions-title">
            <div className="operations-filter-bar" aria-label="Decision filters">
              <label className="operations-search-field">
                <span>Search</span>
                <input onChange={(event) => setQuery(event.target.value)} placeholder="Search agents, actions, or resources" value={query} />
              </label>
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

            <div className="ops-surface-heading">
              <div>
                <h2 id="operation-decisions-title">Decisions</h2>
              </div>
              <span className="ops-count-pill">{filteredDecisions.length} shown</span>
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
                {pagedDecisions.map((decision) => (
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
                    <button aria-label={`Inspect ${operationLabel(decision)}`} className="ops-row-open" onClick={() => setDetail({ kind: 'decision', id: decision.id })} type="button">
                      <IconArrowRight aria-hidden="true" size={13} stroke={1.8} />
                    </button>
                  </article>
                ))}
                </div>
              )}
              {filteredDecisions.length > 0 ? (
                <DataTablePager itemLabel="runtime decisions" onPageChange={setTablePage} page={safePage} pageSize={TABLE_PAGE_SIZE} total={filteredDecisions.length} />
              ) : null}
          </section>
        </TabsContent>

      </Tabs>

      <Sheet labelledBy="operations-create-title" onOpenChange={(open) => !open && setCreateMode(null)} open={createMode !== null} panelClassName="operations-drawer">
        <SheetHeader>
          <div>
            <SheetTitle id="operations-create-title">{createMode === 'tool' ? 'Import tool' : 'Create rate limit'}</SheetTitle>
            <SheetDescription>{createMode === 'tool' ? 'Add one named tool surface agents can route through agentOps.' : 'Throttle one managed action for one agent.'}</SheetDescription>
          </div>
          <SheetCloseButton ariaLabel="Close" onClick={() => setCreateMode(null)} />
        </SheetHeader>
        <SheetBody>
          {createMode === 'tool' ? (
            <form action={importAction} className="operations-form">
              <label><span>Tool name</span><input name="name" placeholder="browser.search" required /></label>
              <label><span>Display name</span><input name="displayName" placeholder="Browser search" /></label>
              <div className="operations-form-grid">
                <label><span>Category</span><input name="category" placeholder="browser" /></label>
                <label><span>Risk</span><select defaultValue="medium" name="riskLevel"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
              </div>
              <label><span>Description</span><textarea name="description" placeholder="Managed search tool" rows={3} /></label>
              <button className="console-primary-button" type="submit">Import tool</button>
            </form>
          ) : null}
          {createMode === 'rate-limit' ? (
            <form action={rateLimitAction} className="operations-form">
              <label><span>Agent</span><select name="targetId" required>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
              <label><span>Action</span><select defaultValue="runtime.http.request" name="action">{actionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label><span>Bucket</span><input name="bucket" placeholder="default" /></label>
              <div className="operations-form-grid">
                <label><span>Limit</span><input defaultValue="20" min="1" name="limit" required type="number" /></label>
                <label><span>Window seconds</span><input defaultValue="60" min="1" name="windowSeconds" required type="number" /></label>
              </div>
              <button className="console-primary-button" type="submit">Create limit</button>
            </form>
          ) : null}
        </SheetBody>
      </Sheet>

      <Sheet labelledBy="operations-detail-title" onOpenChange={(open) => !open && closeDetail()} open={detail !== null} panelClassName="operations-drawer">
        <SheetHeader>
          <div>
            <SheetTitle id="operations-detail-title">
              {selectedTool?.display_name ??
                (selectedLimit === undefined ? undefined : `${agentName(agents, selectedLimit.target_id)} limit`) ??
                (selectedDecision === undefined ? undefined : operationLabel(selectedDecision)) ??
                'Operations detail'}
            </SheetTitle>
            <SheetDescription>
              {selectedTool !== undefined
                ? 'Inspect and maintain this managed tool surface.'
                : selectedLimit !== undefined
                  ? 'Edit or disable this runtime rate limit.'
                  : selectedDecision !== undefined
                    ? 'Review the persisted operation decision context.'
                    : 'Review the selected operations record.'}
            </SheetDescription>
          </div>
          <SheetCloseButton ariaLabel="Close" onClick={closeDetail} />
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
              {selectedTool.status === 'archived' ? <p className="operations-lifecycle-note">This tool is archived and remains available only as historical operational evidence.</p> : confirmLifecycle === 'archive-tool' ? <form action={archiveToolAction} className="operations-lifecycle-confirm"><input name="toolId" type="hidden" value={selectedTool.id} /><div><strong>Archive this tool?</strong><p>New managed calls can no longer target it. Existing decisions and evidence remain available.</p></div><div><button className="button-secondary" onClick={() => setConfirmLifecycle(null)} type="button">Keep tool</button><button className="button-danger" disabled={archiveToolAction === undefined} type="submit">Confirm archive</button></div></form> : <button className="button-secondary operations-lifecycle-trigger" disabled={archiveToolAction === undefined} onClick={() => setConfirmLifecycle('archive-tool')} type="button">Archive tool</button>}
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
              <form
                action={updateRateLimitAction}
                className="operations-form"
                key={`${selectedLimit.id}:${selectedLimit.bucket}:${selectedLimit.limit}:${selectedLimit.window_seconds}:${selectedLimit.status}`}
              >
                <input name="rateLimitId" type="hidden" value={selectedLimit.id} />
                <input name="action" type="hidden" value={selectedLimit.action} />
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
              {selectedLimit.status === 'disabled' ? <p className="operations-lifecycle-note">This rate limit is disabled. Set its status to Active and save to restore enforcement.</p> : confirmLifecycle === 'disable-limit' ? <form action={disableRateLimitAction} className="operations-lifecycle-confirm"><input name="rateLimitId" type="hidden" value={selectedLimit.id} /><div><strong>Disable this limit?</strong><p>Requests stop consuming this counter until the rate limit is reactivated.</p></div><div><button className="button-secondary" onClick={() => setConfirmLifecycle(null)} type="button">Keep active</button><button className="button-danger" disabled={disableRateLimitAction === undefined} type="submit">Confirm disable</button></div></form> : <button className="button-secondary operations-lifecycle-trigger" disabled={disableRateLimitAction === undefined} onClick={() => setConfirmLifecycle('disable-limit')} type="button">Disable limit</button>}
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

        </SheetBody>
      </Sheet>
    </div>
  );
}
