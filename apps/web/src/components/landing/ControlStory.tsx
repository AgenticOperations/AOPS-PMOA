'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useScrollSequence } from './scroll-sequence';

interface StageDefinition {
  readonly id: 'identity' | 'policy' | 'treasury' | 'evidence';
  readonly name: string;
  readonly description: string;
  readonly content: ReactNode;
}

function Status({ children }: { readonly children: ReactNode }) {
  return <em className="aops-status">{children}</em>;
}

function IdentityStage() {
  return (
    <div className="aops-identity-stage">
      <div className="aops-identity-primary">
        <div className="aops-entity-head">
          <i>RO</i>
          <div><span className="aops-stage-kicker">Agent</span><h3>Research operator</h3></div>
          <Status>Active</Status>
        </div>
        <dl className="aops-identity-scope">
          <div><dt>Organization</dt><dd>Northline Systems</dd></div>
          <div><dt>Team</dt><dd>Analysis</dd></div>
          <div><dt>Environment</dt><dd>Testnet</dd></div>
        </dl>
      </div>
      <div className="aops-connections">
        <header><span>Connections</span><small>3 healthy</small></header>
        <div className="aops-connection"><b>01</b><div><strong>Primary runtime</strong><small>Credential healthy</small></div><span>Live</span></div>
        <div className="aops-connection"><b>02</b><div><strong>Wallet reference</strong><small>Base Sepolia · 0x6bd1…92F4</small></div><span>Linked</span></div>
        <div className="aops-connection"><b>03</b><div><strong>Monitoring worker</strong><small>Child agent · inherited scope</small></div><span>Active</span></div>
      </div>
    </div>
  );
}

function DecisionStage() {
  return (
    <div className="aops-decision-stage">
      <div className="aops-decision-conditions">
        <span className="aops-stage-kicker">Policy evaluation</span>
        <h3>High-value payment review</h3>
        <div className="aops-condition-list">
          <div><span>Action</span><strong>Payment authorization</strong></div>
          <div><span>Threshold</span><strong>150 USDC</strong></div>
          <div><span>Scope</span><strong>Research operators</strong></div>
        </div>
      </div>
      <div className="aops-decision-result">
        <span className="aops-stage-kicker">Request value</span>
        <div className="aops-threshold-scale"><span>150 threshold</span></div>
        <strong className="aops-request-amount">240 <small>USDC</small></strong>
        <h3>Approval required</h3>
        <p>The request exceeds its delegated threshold by 90 USDC and moves to human review.</p>
        <div className="aops-decision-states"><span>Allow</span><span className="is-current">Review</span><span>Deny</span></div>
      </div>
    </div>
  );
}

function GovernStage() {
  return (
    <div className="aops-govern-stage">
      <div>
        <div className="aops-budget-head">
          <div><span className="aops-stage-kicker">Monthly agent budget</span><h3>Research operations</h3></div>
          <div className="aops-budget-amount"><strong>1,340 / 4,000</strong><span>USDC used · 33.5%</span></div>
        </div>
        <div className="aops-budget-track"><i /></div>
        <div className="aops-limit-grid">
          <div><span>Per request</span><strong>500 USDC</strong></div>
          <div><span>Approval over</span><strong>150 USDC</strong></div>
          <div><span>Daily ceiling</span><strong>900 USDC</strong></div>
        </div>
      </div>
      <div className="aops-rail-readiness">
        <header><span>Payment rail readiness</span><small>3 of 5 shown</small></header>
        <div><strong>Base</strong><span>Exact settlement</span><Status>Ready</Status></div>
        <div><strong>Arbitrum</strong><span>Gateway liquidity</span><Status>Ready</Status></div>
        <div><strong>Polygon</strong><span>Exact settlement</span><Status>Ready</Status></div>
      </div>
    </div>
  );
}

function EvidenceStage() {
  const events = [
    ['Identity resolved', 'Research operator · scoped credential', 'evt_28c…a17'],
    ['Policy evaluated', 'Payment authorization · review required', 'evt_28d…c42'],
    ['Approval recorded', 'Operations lead · threshold exception', 'evt_28f…b09'],
    ['Outcome settled', 'Exact x402 · 240 USDC', 'evt_291…d64'],
  ] as const;
  return (
    <div className="aops-evidence-stage">
      <div className="aops-evidence-sequence">
        <div><span className="aops-stage-kicker">Sequence</span><strong>00002841</strong></div>
        <small>One canonical record from intent to outcome.</small>
      </div>
      <div className="aops-evidence-events">
        {events.map((event, index) => (
          <div className="aops-evidence-event" key={event[0]}>
            <b>{String(index + 1).padStart(2, '0')}</b>
            <div><strong>{event[0]}</strong><span>{event[1]}</span></div>
            <div><code>{event[2]}</code><em>Verified</em></div>
          </div>
        ))}
      </div>
    </div>
  );
}

const stages: readonly StageDefinition[] = [
  { id: 'identity', name: 'Identify', description: 'Know every agent and connection.', content: <IdentityStage /> },
  { id: 'policy', name: 'Decide', description: 'Evaluate policy and approvals.', content: <DecisionStage /> },
  { id: 'treasury', name: 'Govern', description: 'Control budgets and payment rails.', content: <GovernStage /> },
  { id: 'evidence', name: 'Prove', description: 'Keep a verifiable action record.', content: <EvidenceStage /> },
];

export function ControlStory() {
  const { activeIndex, sectionRef, setActiveIndex } = useScrollSequence(stages.length);
  const active = stages[activeIndex] ?? stages[0]!;
  const zoneStyle = { '--aops-zone-height': `${100 + stages.length * 78}vh` } as CSSProperties;

  return (
    <section className="aops-control" id="product">
      <div className="aops-wrap aops-section-head">
        <h2>From agent intent<br />to accountable action.</h2>
        <p>AOPS connects identity, decisions, money movement, and evidence. Operators see one system; agents receive one consistent control contract.</p>
      </div>
      <section className="aops-scroll-zone" ref={sectionRef} style={zoneStyle}>
        <div className="aops-story-sticky">
          <div className="aops-wrap aops-story-layout">
            <div className="aops-story-steps" role="tablist" aria-label="Control plane stages">
              {stages.map((stage, index) => (
                <button
                  aria-controls={`aops-stage-${stage.id}`}
                  aria-selected={activeIndex === index}
                  className="aops-story-step"
                  data-active={activeIndex === index}
                  key={stage.id}
                  onClick={() => setActiveIndex(index)}
                  role="tab"
                  type="button"
                >
                  <b>{String(index + 1).padStart(2, '0')}</b>
                  <span><strong>{stage.name}</strong><small>{stage.description}</small></span>
                </button>
              ))}
            </div>
            <div className="aops-stage-shell" aria-live="polite">
              <header><span>{active.id === 'identity' ? 'Scoped identity' : active.id === 'policy' ? 'Decision plane' : active.id === 'treasury' ? 'Treasury controls' : 'Canonical evidence'}</span><small>{active.id === 'identity' ? '4 active connections' : active.id === 'policy' ? 'Policy version 4' : active.id === 'treasury' ? '5 supported chains' : 'Hash chain verified'}</small></header>
              <div className="aops-stage-panel" id={`aops-stage-${active.id}`} role="tabpanel" key={active.id}>{active.content}</div>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
