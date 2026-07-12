import Link from 'next/link';
import { ChainStory } from './ChainStory';
import { ControlStory } from './ControlStory';
import { LandingFooter } from './LandingFooter';
import { LandingNavigation } from './LandingNavigation';

function Hero() {
  return (
    <section className="aops-hero" id="top">
      <div className="aops-boundary-signal" aria-hidden="true">
        <span className="aops-signal-track aops-signal-in"><i data-signal-runner="incoming" /></span>
        <b className="aops-signal-gate" />
        <span className="aops-signal-track aops-signal-out"><i data-signal-runner="outgoing" /></span>
      </div>
      <div className="aops-wrap aops-hero-content">
        <div>
          <h1 aria-label="Let agents act. Keep authority.">Let agents act.<br /><span>Keep authority.</span></h1>
          <p>Identity, policy, approvals, treasury, and evidence for every agent action.</p>
          <Link className="aops-primary-link" href="/auth">Request access</Link>
        </div>
      </div>
    </section>
  );
}

function Manifesto() {
  return (
    <section className="aops-manifesto">
      <div className="aops-wrap aops-manifesto-grid">
        <aside><span>The missing layer</span><p>Agents are getting more capable. Operational control has not kept up.</p></aside>
        <div>
          <p className="aops-manifesto-copy">Agents can call tools, move money, and act across systems. <span>Most teams still cannot answer who acted, what they were allowed to do, or why a decision was made.</span></p>
          <div className="aops-manifesto-proof">
            <div><strong>Boundaries before execution.</strong><p>Identity and policy are evaluated before an action reaches a tool, approval, or payment rail.</p></div>
            <div><strong>Evidence after the fact.</strong><p>Every relevant decision and outcome stays attributable to the agent, organization, and policy context.</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProductAssets() {
  return (
    <section className="aops-assets" aria-labelledby="aops-assets-title">
      <div className="aops-wrap">
        <div className="aops-section-head">
          <h2 id="aops-assets-title">Controls that explain<br />the decision.</h2>
          <p>The interface keeps high-signal detail visible without turning every workflow into a dashboard.</p>
        </div>
        <div className="aops-assets-grid">
          <article className="aops-asset aops-policy-asset">
            <div className="aops-asset-copy"><b>01 / Policy boundary</b><h3>Rules stay readable at the moment they matter.</h3></div>
            <div className="aops-policy-visual">
              <span>PAYMENT AUTHORIZATION</span>
              <h4>Research operator</h4>
              <dl><div><dt>Recipient scope</dt><dd>Approved services</dd></div><div><dt>Per request</dt><dd>500 USDC</dd></div><div><dt>Human review</dt><dd>Above 150 USDC</dd></div></dl>
              <footer><span>Policy version 4</span><strong>Bound</strong></footer>
            </div>
          </article>
          <article className="aops-asset aops-approval-asset">
            <div className="aops-approval-visual">
              <header><span>Review queue</span><b>01 pending</b></header>
              <div><span>240 USDC</span><h4>Payment authorization</h4><p>Requested by Research operator for a policy-scoped service.</p></div>
              <dl><div><dt>Threshold</dt><dd>150 USDC</dd></div><div><dt>Expires</dt><dd>11m 42s</dd></div></dl>
              <footer><span>Decline</span><strong>Approve once</strong></footer>
            </div>
            <div className="aops-asset-copy"><b>02 / Human judgment</b><h3>Escalate the exception, not the whole workflow.</h3></div>
          </article>
          <article className="aops-asset aops-proof-asset">
            <div className="aops-asset-copy"><b>03 / Canonical evidence</b><h3>One chain of events from actor to outcome.</h3><p>Policy, approval, liquidity, and settlement remain connected instead of becoming four unrelated logs.</p></div>
            <div className="aops-proof-visual">
              <div><i>01</i><span><strong>Identity</strong><small>Scoped agent resolved</small></span><code>28c…a17</code></div>
              <div><i>02</i><span><strong>Decision</strong><small>Approval required</small></span><code>28d…c42</code></div>
              <div><i>03</i><span><strong>Authority</strong><small>One-time approval</small></span><code>28f…b09</code></div>
              <div><i>04</i><span><strong>Outcome</strong><small>Payment settled</small></span><code>291…d64</code></div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function DeveloperSection() {
  return (
    <section className="aops-developer" id="developers">
      <div className="aops-wrap aops-developer-grid">
        <div>
          <span className="aops-label">For coded agents</span>
          <h2>One surface for operators.<br />One contract for agents.</h2>
          <p>Connect through API or MCP. The same identity, policy, approval, treasury, and evidence controls apply.</p>
          <div className="aops-dev-notes">
            <div><b>01</b><p><strong>Credentials stay scoped.</strong> Issue, rotate, and revoke runtime connections without exposing existing secrets.</p></div>
            <div><b>02</b><p><strong>Decisions stay explainable.</strong> Agents receive an outcome; operators retain the policy and evidence context.</p></div>
          </div>
        </div>
        <div className="aops-code-surface" aria-label="Runtime decision example">
          <header><span>Runtime check</span><b>POST</b></header>
          <pre><code><span>const</span> decision = <span>await</span> aops.check({'{'}{`\n  agent: 'research-operator',\n  action: 'payment.authorize',\n  amount: '240.00',\n  asset: 'USDC'`}{'\n}'});{`\n\n`}<b>decision.outcome</b>{`\n// 'approval_required'`}</code></pre>
          <footer><span>Policy v4</span><span>Evidence attached</span><span>Fail closed</span></footer>
        </div>
      </div>
    </section>
  );
}

function SecuritySection() {
  const rows = [
    ['Identity', 'Every action begins with a scoped identity.', 'Organization, agent, connection, and environment establish who is acting.'],
    ['Secrets', 'Credential material stays on the server.', 'New secrets appear once. Stored connections expose status and lifecycle controls, not plaintext.'],
    ['Enforcement', 'Policy applies before the action proceeds.', 'Allow, deny, observe, rate-limit, or require a one-time approval from real action context.'],
    ['Evidence', 'The outcome remains verifiable.', 'Canonical records preserve organization sequence, related entities, redacted context, and hash integrity.'],
  ] as const;
  return (
    <section className="aops-security" id="security">
      <div className="aops-wrap">
        <div className="aops-security-head"><h2>Built to fail closed,<br />without becoming a black box.</h2><p>Tenant scope, server-side secrets, policy evaluation, and canonical evidence are part of the architecture—not marketing add-ons.</p></div>
        <div className="aops-security-spine">
          {rows.map((row, index) => (
            <article key={row[0]}>
              <b>{String(index + 1).padStart(2, '0')}</b>
              <div><span>{row[0]}</span><h3>{row[1]}</h3><p>{row[2]}</p></div>
              <i aria-hidden="true" />
            </article>
          ))}
        </div>
        <div className="aops-security-proof"><span>Tenant-fenced data</span><span>Server-side credentials</span><span>Fail-closed provider paths</span><span>Canonical audit chain</span><span>Testnet treasury mode</span></div>
      </div>
    </section>
  );
}

function WorkflowSection() {
  const steps = [
    ['Create the identity.', 'Register the agent, assign its team, and issue a runtime connection.', 'Identity'],
    ['Attach operating boundaries.', 'Bind policies, rate limits, tool access, and human approval thresholds.', 'Controls'],
    ['Route real actions through AOPS.', 'Use API or MCP for runtime checks, approvals, payments, and activity.', 'Runtime'],
    ['Review what happened.', 'Inspect decisions, jobs, outcomes, and canonical evidence in one console.', 'Evidence'],
  ] as const;
  return (
    <section className="aops-workflow" id="workflow">
      <div className="aops-wrap">
        <div className="aops-section-head"><h2>Start with one agent.<br />Grow control with the system.</h2><p>AOPS does not require a giant automation rewrite. Add the policies, approvals, and treasury access that each job actually requires.</p></div>
        <div className="aops-workflow-list">
          {steps.map((step, index) => <article key={step[0]}><b>{String(index + 1).padStart(2, '0')}</b><div><h3>{step[0]}</h3><p>{step[1]}</p></div><span>{step[2]}</span></article>)}
        </div>
      </div>
    </section>
  );
}

function ClosingSection() {
  return (
    <section className="aops-closing">
      <div className="aops-wrap">
        <span>Operational authority</span>
        <h2>Agents can move faster<br />when the boundary is clear.</h2>
        <p>Start with identity. Add policy, approvals, treasury, and evidence as the work demands.</p>
      </div>
    </section>
  );
}

export function LandingPage() {
  return (
    <div className="aops-landing">
      <LandingNavigation />
      <main className="aops-page-surface">
        <Hero />
        <Manifesto />
        <ControlStory />
        <ProductAssets />
        <ChainStory />
        <DeveloperSection />
        <SecuritySection />
        <WorkflowSection />
        <ClosingSection />
      </main>
      <LandingFooter />
    </div>
  );
}
