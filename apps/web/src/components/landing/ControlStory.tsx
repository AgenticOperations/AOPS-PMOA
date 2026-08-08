'use client';

import type { CSSProperties, ReactNode } from 'react';
import { AGENT_ROBOT_SRC, agentTint } from '@/components/agents/agent-visual';
import { useScrollSequence } from './scroll-sequence';

interface StageDefinition {
  readonly id: 'identity' | 'policy' | 'treasury' | 'evidence';
  readonly name: string;
  readonly description: string;
  readonly content: ReactNode;
}

type FleetAgent = {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly rail: string;
  readonly lead?: boolean | undefined;
};

const FLEET: readonly FleetAgent[] = [
  { id: 'landing-fleet-orchestrator', name: 'Orchestrator', role: 'Coordinates the run', rail: 'Arc · Base', lead: true },
  { id: 'landing-fleet-datafetcher', name: 'DataFetcher', role: 'Serves paid data', rail: 'Arc' },
  { id: 'landing-fleet-analyst', name: 'Analyst', role: 'Pays mid-task', rail: 'Arc' },
  { id: 'landing-fleet-writer', name: 'Writer', role: 'Delivers the report', rail: 'Arc' },
  { id: 'landing-fleet-reviewer', name: 'SeniorReviewer', role: 'Cross-chain review', rail: 'Base' },
];

function Status({ children }: { readonly children: ReactNode }) {
  return <em className="aops-status">{children}</em>;
}

function FleetMark({
  agent,
  size = 'md',
}: {
  readonly agent: FleetAgent;
  readonly size?: 'sm' | 'md' | 'lg';
}) {
  const tint = agentTint(agent.id);
  // Sized for the story panel — robots must read as characters, not icons.
  const px = size === 'lg' ? 132 : size === 'md' ? 92 : 52;
  return (
    <span
      aria-hidden="true"
      className={`aops-story-robot is-${size}`}
      style={{
        width: px,
        height: px,
        ['--agent-tint' as string]: tint.color,
        ['--agent-glow' as string]: tint.glow,
      }}
      title={agent.name}
    >
      <span className="aops-story-robot-glow" />
      <span className="aops-story-robot-tint" style={{ background: tint.color }} />
      <img
        alt=""
        className="aops-story-robot-img"
        draggable={false}
        height={px}
        src={AGENT_ROBOT_SRC}
        width={px}
      />
    </span>
  );
}

/** Identify — the whole fleet under one policy surface. */
function IdentityStage() {
  const lead = FLEET[0]!;
  const specialists = FLEET.slice(1);
  return (
    <div className="aops-fleet-stage">
      <div className="aops-fleet-lead">
        <FleetMark agent={lead} size="lg" />
        <div>
          <span className="aops-stage-kicker">Fleet lead</span>
          <h3>{lead.name}</h3>
          <p>{lead.role}. Issues scoped hires; never holds the specialists’ funds.</p>
        </div>
        <Status>Active</Status>
      </div>

      <div className="aops-fleet-strip" role="list" aria-label="Specialist agents">
        {specialists.map((agent) => (
          <article className="aops-fleet-chip" key={agent.id} role="listitem">
            <FleetMark agent={agent} size="md" />
            <div>
              <strong>{agent.name}</strong>
              <span>{agent.role}</span>
              <small>{agent.rail}</small>
            </div>
          </article>
        ))}
      </div>

      <div className="aops-fleet-policy">
        <span className="aops-stage-kicker">Shared controls</span>
        <div className="aops-fleet-policy-grid">
          <div><span>Identity</span><strong>Org-scoped credentials</strong></div>
          <div><span>Spend</span><strong>Permit2 ceilings</strong></div>
          <div><span>Rails</span><strong>x402 · Escrow</strong></div>
          <div><span>Evidence</span><strong>Canonical sequence</strong></div>
        </div>
      </div>
    </div>
  );
}

/** Decide — one fleet hire evaluated against policy. */
function DecisionStage() {
  const payer = FLEET[0]!;
  const payee = FLEET[1]!;
  return (
    <div className="aops-decision-stage aops-decision-fleet">
      <div className="aops-decision-conditions">
        <span className="aops-stage-kicker">Policy evaluation</span>
        <h3>Intra-fleet hire</h3>
        <div className="aops-hire-pair" aria-label="Payer and payee">
          <div>
            <FleetMark agent={payer} size="md" />
            <div><strong>{payer.name}</strong><small>Payer</small></div>
          </div>
          <i aria-hidden="true">→</i>
          <div>
            <FleetMark agent={payee} size="md" />
            <div><strong>{payee.name}</strong><small>Payee</small></div>
          </div>
        </div>
        <div className="aops-condition-list">
          <div><span>Action</span><strong>payment.authorize</strong></div>
          <div><span>Threshold</span><strong>0.05 USDC</strong></div>
          <div><span>Lane</span><strong>Permit2 · Arc</strong></div>
        </div>
      </div>
      <div className="aops-decision-result">
        <span className="aops-stage-kicker">Outcome</span>
        <strong className="aops-request-amount">0.01 <small>USDC</small></strong>
        <h3>Allowed</h3>
        <p>Under the agent’s standing ceiling — settled without human review.</p>
        <div className="aops-decision-states">
          <span className="is-current">Allow</span>
          <span>Review</span>
          <span>Deny</span>
        </div>
      </div>
    </div>
  );
}

/** Govern — fleet budgets and rails with small agent marks. */
function GovernStage() {
  return (
    <div className="aops-govern-stage aops-govern-fleet">
      <div>
        <div className="aops-budget-head">
          <div>
            <span className="aops-stage-kicker">Fleet spend this run</span>
            <h3>Collective goal</h3>
          </div>
          <div className="aops-budget-amount"><strong>0.12 / 5.00</strong><span>USDC drawn · ceilings intact</span></div>
        </div>
        <div className="aops-budget-track"><i /></div>
        <div className="aops-fleet-budget-rows">
          {FLEET.map((agent) => (
            <div className="aops-fleet-budget-row" key={agent.id}>
              <FleetMark agent={agent} size="sm" />
              <strong>{agent.name}</strong>
              <span>{agent.rail}</span>
              <em>{agent.lead === true ? 'Payer' : 'Earn'}</em>
            </div>
          ))}
        </div>
      </div>
      <div className="aops-rail-readiness">
        <header><span>Policy bindings</span><small>Fleet-wide</small></header>
        <div><strong>Per-request cap</strong><span>Standing Permit2</span><Status>Bound</Status></div>
        <div><strong>Second hop</strong><span>Analyst → DataFetcher</span><Status>Bound</Status></div>
        <div><strong>Cross-chain</strong><span>Base reviewer</span><Status>Bound</Status></div>
      </div>
    </div>
  );
}

/** Prove — hop timeline with real explorer links. */
function shortTx(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

const EXPLORER_TX: Record<'arc' | 'base', string> = {
  arc: 'https://testnet.arcscan.app/tx/',
  base: 'https://sepolia.basescan.org/tx/',
};

function EvidenceStage() {
  // Real Permit2 fleet settlements from the demo org run (Arc + Base Sepolia).
  const hops = [
    {
      agent: FLEET[0]!,
      label: 'Orchestrator → DataFetcher',
      detail: 'Permit2 · 0.01 USDC · Arc',
      chain: 'arc' as const,
      tx: '0xb48bdf0f541b415b4fcefb3b39e22f11507772a6ec76faef9d94f96abbe80904',
    },
    {
      agent: FLEET[2]!,
      label: 'Analyst → DataFetcher',
      detail: 'Second hop · 0.01 USDC · Arc',
      chain: 'arc' as const,
      tx: '0x96c155e75c193208e9f3817fff633c854aadd449be1f1e44d33042769d95a1d5',
    },
    {
      agent: FLEET[3]!,
      label: 'Orchestrator → Writer',
      detail: 'Permit2 · 0.02 USDC · Arc',
      chain: 'arc' as const,
      tx: '0xcbe5aadb1e70faef97eacf46710637a5985659854f7b7c32e5c69d95c2decacd',
    },
    {
      agent: FLEET[4]!,
      label: 'Orchestrator → SeniorReviewer',
      detail: 'Cross-chain · 0.03 USDC · Base',
      chain: 'base' as const,
      tx: '0xb84b2c0af82edb983a2fb863068d44210f125b8b9899ef1455a2ad8bbb6c308a',
    },
  ] as const;
  return (
    <div className="aops-evidence-stage aops-evidence-fleet">
      <div className="aops-evidence-sequence">
        <div><span className="aops-stage-kicker">Fleet run</span><strong>seq_02841</strong></div>
        <small>Every hop attributable to an agent identity.</small>
      </div>
      <div className="aops-evidence-events">
        {hops.map((hop) => (
          <div className="aops-evidence-event" key={hop.tx}>
            <FleetMark agent={hop.agent} size="sm" />
            <div><strong>{hop.label}</strong><span>{hop.detail}</span></div>
            <div>
              <a
                className="aops-evidence-tx"
                href={`${EXPLORER_TX[hop.chain]}${hop.tx}`}
                rel="noreferrer"
                target="_blank"
              >
                {shortTx(hop.tx)}
              </a>
              <em>Settled</em>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const stages: readonly StageDefinition[] = [
  { id: 'identity', name: 'Identify', description: 'Compose the fleet under one org.', content: <IdentityStage /> },
  { id: 'policy', name: 'Decide', description: 'Evaluate each hire against policy.', content: <DecisionStage /> },
  { id: 'treasury', name: 'Govern', description: 'Ceilings and rails for the fleet.', content: <GovernStage /> },
  { id: 'evidence', name: 'Prove', description: 'Trace every agent payment hop.', content: <EvidenceStage /> },
];

export function ControlStory() {
  const { activeIndex, sectionRef, setActiveIndex } = useScrollSequence(stages.length);
  const active = stages[activeIndex] ?? stages[0]!;
  const zoneStyle = { '--aops-zone-height': `${100 + stages.length * 78}vh` } as CSSProperties;

  const headerCopy = {
    identity: { title: 'Fleet identity', meta: '5 agents · one org' },
    policy: { title: 'Policy decision', meta: 'Permit2 hire' },
    treasury: { title: 'Fleet governance', meta: 'Ceilings bound' },
    evidence: { title: 'Settlement evidence', meta: '4 hops verified' },
  } as const;

  return (
    <section className="aops-control" id="product">
      <div className="aops-wrap aops-section-head">
        <h2>From agent intent<br />to accountable action.</h2>
        <p>
          A living fleet — Orchestrator, DataFetcher, Analyst, Writer, SeniorReviewer —
          moving through identity, policy, spend, and evidence under one control plane.
        </p>
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
              <header>
                <span>{headerCopy[active.id].title}</span>
                <small>{headerCopy[active.id].meta}</small>
              </header>
              <div className="aops-stage-panel" id={`aops-stage-${active.id}`} role="tabpanel" key={active.id}>
                {active.content}
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
