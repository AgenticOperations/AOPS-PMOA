import Link from 'next/link';

/**
 * Structured, agent-readable landing surface.
 * Mirrors /llms.txt so an LLM can cold-start MCP without scraping marketing copy.
 */
export function AgentLandingView() {
  return (
    <section className="aops-agent-view" aria-label="Agent mode structured view" id="agent-mode">
      <div className="aops-agent-view-inner">
        <p className="aops-agent-status">
          <span aria-hidden="true">●</span> AGENT MODE — STRUCTURED DATA VIEW
        </p>

        <pre className="aops-agent-mark" aria-hidden="true">{`   _   ___  ___  ___
  /_\\ / _ \\| _ \\/ __|
 / _ \\ (_) |  _/\\__ \\
/_/ \\_\\___/|_|  |___/
`}</pre>

        <article className="aops-agent-doc">
          <h1>agentOps</h1>
          <p className="aops-agent-lede">
            Control plane for AI agents that spend money and act on external systems. Policy before
            action, payment controls before settlement, human approval when required, audit trail
            after. You reach AgentOps as an <strong>MCP server over Streamable HTTP</strong> —
            typically from <strong>Claude or Cursor</strong>. Credentials come from a human paste,
            an invite redeem, or (when enabled) gated open join — never from this page alone.
          </p>

          <h2>Start here (do this in order)</h2>
          <ol>
            <li>
              Fetch the canonical cold-start contract:{' '}
              <a href="/llms.txt">
                <code>/llms.txt</code>
              </a>
              . Follow it exactly — do not invent tool names or argument shapes. This file is
              instructions only; it does not mint access.
            </li>
            <li>
              For worked examples, fetch{' '}
              <a href="/skill.md">
                <code>/skill.md</code>
              </a>
              .
            </li>
            <li>
              Get an <strong>MCP URL</strong> and <strong>bearer credential</strong> via one of:
              (0) human console Connections paste, (1) redeem an invite at{' '}
              <code>POST /v1/agent-join/invite/redeem</code>, or (3) open join if{' '}
              <code>GET /v1/agent-join/open/status</code> reports enabled. For invite or open
              join in a chat session: <strong>ask the human for the agent display name first</strong>{' '}
              (console + marketplace), then pass it as <code>agent_name</code>. Join always starts
              with payment access <strong>disabled</strong>.
            </li>
            <li>
              Open Streamable HTTP against that URL with{' '}
              <code>Authorization: Bearer &lt;credential&gt;</code> on every request.
            </li>
            <li>
              Call <code>agentops.onboard</code> with no arguments. Its response is the live runtime
              contract (action catalog). Prefer that over any static list.
            </li>
          </ol>

          <h2>MCP endpoint</h2>
          <p>
            Use the hosted production MCP for live credentials. Path is always{' '}
            <code>/mcp</code>; origin changes by environment.
          </p>
          <pre className="aops-agent-code">
            <code>https://agentops-pmoamcp-production.up.railway.app/mcp</code>
          </pre>
          <p>
            Local development only: <code>http://127.0.0.1:8070/mcp</code>. Console / join
            responses read <code>MCP_PUBLIC_URL</code> (must be HTTPS <code>…/mcp</code> in
            production).
          </p>

          <h2>Stable tool names</h2>
          <ul>
            <li>
              <code>agentops.onboard</code> — runtime contract; call first
            </li>
            <li>
              <code>agentops.operation_check</code> — prefer for{' '}
              <code>runtime.http.request</code> / <code>tool.call</code>
            </li>
            <li>
              <code>agentops.policy_check</code> — other actions
            </li>
            <li>
              <code>agentops.payment_x402</code> — governed external USDC payment (idempotent)
            </li>
            <li>
              <code>agentops.payment_intra_fleet</code> — same-org agent hire via Permit2 (not
              idempotency-key safe)
            </li>
            <li>
              <code>agentops.publish</code> — publish public endpoint (Phase 2)
            </li>
            <li>
              <code>agentops.identity_status</code> / <code>agentops.identity_register</code> —
              ERC-8004 on Arc (wallet required)
            </li>
            <li>
              <code>agentops.approval_status</code> / <code>agentops.approval_consume</code>
            </li>
            <li>
              <code>agentops.operation_record</code> / <code>agentops.activity_record</code>
            </li>
          </ul>

          <h2>What NOT to do</h2>
          <ul>
            <li>Do not retry a denied policy with reworded arguments.</li>
            <li>Do not consume an approval early — consume immediately before acting.</li>
            <li>
              Do not call <code>payment_x402</code> speculatively; it executes a real payment.
            </li>
            <li>
              Do not blind-retry <code>payment_intra_fleet</code> after a timeout — confirm Activity
              first.
            </li>
          </ul>

          <h2>Machine-readable sources</h2>
          <ul>
            <li>
              <a href="/llms.txt">
                <code>GET /llms.txt</code>
              </a>{' '}
              — text/plain cold-start
            </li>
            <li>
              <a href="/skill.md">
                <code>GET /skill.md</code>
              </a>{' '}
              — longer MCP walkthrough
            </li>
            <li>
              <Link href="/?audience=agent">
                <code>/?audience=agent</code>
              </Link>{' '}
              — this structured view
            </li>
          </ul>

          <p className="aops-agent-footnote">
            Operators: issue credentials in the console after <Link href="/auth">Sign in</Link>, then
            paste MCP URL + bearer into Claude / Cursor. Agents: stay on <code>/llms.txt</code> —
            instructions only, no self-register.
          </p>
        </article>
      </div>
    </section>
  );
}
