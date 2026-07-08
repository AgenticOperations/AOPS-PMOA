import type {
  BlockedOperationRecord,
  OperationsAgentOption,
  ToolCatalogRecord,
} from '@/lib/operations-types';

type OperationsWorkbenchProps = {
  readonly agents: readonly OperationsAgentOption[];
  readonly blocked: readonly BlockedOperationRecord[];
  readonly tools: readonly ToolCatalogRecord[];
  readonly importAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly rateLimitAction?: ((formData: FormData) => Promise<void>) | undefined;
};

function formatAction(value: string): string {
  if (value === 'runtime.http.request') return 'HTTP request';
  if (value === 'tool.call') return 'Tool call';
  return value;
}

function formatDecision(value: string): string {
  if (value === 'rate_limited') return 'Rate limited';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatRisk(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function agentName(agents: readonly OperationsAgentOption[], agentId: string): string {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function operationLabel(operation: BlockedOperationRecord): string {
  return operation.tool_name ?? operation.resource_label ?? operation.action;
}

export function OperationsWorkbench({
  agents,
  blocked,
  tools,
  importAction,
  rateLimitAction,
}: OperationsWorkbenchProps) {
  return (
    <div className="ops-page operations-workbench">
      <header className="ops-page-header operations-header">
        <div>
          <h1>Operations</h1>
          <p>Catalog managed tools, inspect blocked activity, and define runtime request limits.</p>
        </div>
      </header>

      <div className="operations-layout">
        <div className="operations-main-column">
          <section className="ops-surface" aria-labelledby="tool-catalog-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="tool-catalog-title">Tool catalog</h2>
                <p>Tools imported here become named surfaces for operational policy checks.</p>
              </div>
              <span className="ops-count-pill">{tools.length} tool{tools.length === 1 ? '' : 's'}</span>
            </div>

            {tools.length === 0 ? (
              <div className="ops-empty-state">
                <h3>No tools imported</h3>
                <p>Import a tool when an agent should route that operation through agentOps.</p>
              </div>
            ) : (
              <div className="operations-table" role="table" aria-label="Tool catalog">
                <div className="operations-table-head" role="row">
                  <span role="columnheader">Tool</span>
                  <span role="columnheader">Category</span>
                  <span role="columnheader">Risk</span>
                  <span role="columnheader">Status</span>
                </div>
                {tools.map((tool) => (
                  <article className="operations-table-row" key={tool.id} role="row">
                    <div role="cell">
                      <strong>{tool.display_name}</strong>
                      <span>{tool.name}</span>
                      {tool.description.length > 0 ? <span>{tool.description}</span> : null}
                    </div>
                    <span role="cell">{tool.category}</span>
                    <span role="cell">{formatRisk(tool.risk_level)}</span>
                    <span className={`ops-state-pill ops-state-${tool.status}`} role="cell">
                      {tool.status}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="ops-surface" aria-labelledby="blocked-actions-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="blocked-actions-title">Blocked actions</h2>
                <p>Recent operation checks denied by policy or runtime limits.</p>
              </div>
              <span className="ops-count-pill">{blocked.length} block{blocked.length === 1 ? '' : 's'}</span>
            </div>

            {blocked.length === 0 ? (
              <div className="ops-empty-state">
                <h3>No blocked actions</h3>
                <p>Denied operation checks will appear here after agents call the runtime API or MCP server.</p>
              </div>
            ) : (
              <div className="ops-list" aria-label="Blocked actions">
                {blocked.map((operation) => (
                  <article className="ops-approval-row operations-block-row" key={operation.id}>
                    <div className="ops-approval-main">
                      <span className="ops-row-title">{operationLabel(operation)}</span>
                      <span>{formatAction(operation.action)}</span>
                      <span>{agentName(agents, operation.agent_id)}</span>
                      <span>{operation.explanation}</span>
                    </div>
                    <div className="ops-approval-actions">
                      <span className={`ops-state-pill ops-state-${operation.decision}`}>
                        {formatDecision(operation.decision)}
                      </span>
                      <span>{operation.reasonCode}</span>
                      <time dateTime={operation.created_at}>{new Date(operation.created_at).toLocaleString()}</time>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="operations-action-column" aria-label="Operations setup">
          <section className="ops-surface operations-action-card" aria-labelledby="import-tool-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="import-tool-title">Import tool</h2>
                <p>Add a named tool surface agents can check before use.</p>
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

          <section className="ops-surface operations-action-card" aria-labelledby="limit-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="limit-title">Request limit</h2>
                <p>Throttle repeated operation checks for one agent.</p>
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
                  <option value="runtime.http.request">HTTP request</option>
                  <option value="tool.call">Tool call</option>
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
                  <span>Window</span>
                  <input defaultValue="60" min="1" name="windowSeconds" required type="number" />
                </label>
              </div>
              <button className="button-secondary" disabled={agents.length === 0} type="submit">
                Create limit
              </button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}
