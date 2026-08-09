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
            after. Agents reach it as an <strong>MCP server over Streamable HTTP</strong>.
          </p>

          <h2>Start here (do this in order)</h2>
          <ol>
            <li>
              Fetch the canonical cold-start contract:{' '}
              <a href="/llms.txt">
                <code>/llms.txt</code>
              </a>
              . Follow it exactly — do not invent tool names or argument shapes.
            </li>
            <li>
              For worked examples, fetch{' '}
              <a href="/skill.md">
                <code>/skill.md</code>
              </a>
              .
            </li>
            <li>
              You need an <strong>MCP URL</strong> and a <strong>bearer credential</strong> issued by
              a human operator in the console (Agents → agent → Connections). You cannot
              self-register.
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

          <h2>Default local MCP endpoint</h2>
          <pre className="aops-agent-code">
            <code>http://127.0.0.1:8070/mcp</code>
          </pre>
          <p>
            Production hosts replace the origin; the path stays <code>/mcp</code>. Credential is
            always required.
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
            Operators: issue credentials and bind policies in the console after{' '}
            <Link href="/auth">Sign in</Link>. Agents: stay on <code>/llms.txt</code>.
          </p>
        </article>
      </div>
    </section>
  );
}
