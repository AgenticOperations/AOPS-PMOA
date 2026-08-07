import Link from 'next/link';
import type { AgentRosterItem } from '@/lib/identity-spine-types';
import { AGENT_ROBOT_SRC, agentTint } from './agent-visual';
import { formatConnectionHealth, formatStatus } from './format';

type AgentFleetCardProps = {
  readonly agent: AgentRosterItem;
  readonly orgSlug: string;
  readonly index?: number;
};

/**
 * Casper-style home fleet card: dark robot header with per-agent tint,
 * white body with readiness cues.
 */
export function AgentFleetCard({ agent, orgSlug, index = 0 }: AgentFleetCardProps) {
  const tint = agentTint(agent.id);
  const ready = agent.status === 'active'
    && (agent.connection_health === 'healthy' || agent.connection_health === 'stale');
  const displayName = agent.name.length > 20
    ? `${agent.name.slice(0, 12)}…${agent.name.slice(-5)}`
    : agent.name;

  return (
    <Link
      className="agent-fleet-card"
      href={`/app/${orgSlug}/agents/${agent.id}`}
      style={{ ['--agent-tint' as string]: tint.color, ['--agent-glow' as string]: tint.glow }}
    >
      <div className="agent-fleet-card-hero">
        <div aria-hidden="true" className="agent-fleet-card-grid" />
        <div aria-hidden="true" className="agent-fleet-card-glow" />
        <div aria-hidden="true" className="agent-fleet-card-robot">
          <span className="agent-fleet-card-robot-tint" style={{ background: tint.color }} />
          <img
            alt=""
            className="agent-fleet-card-robot-img"
            draggable={false}
            height={130}
            loading={index < 3 ? 'eager' : 'lazy'}
            src={AGENT_ROBOT_SRC}
            width={130}
          />
        </div>
        <div className="agent-fleet-card-badge">
          <span className={ready ? 'is-ready' : undefined}>
            <i />
            {ready ? 'Ready' : formatStatus(agent.status)}
          </span>
        </div>
        <div className="agent-fleet-card-label">
          <p>Agent</p>
          <strong title={agent.name}>{displayName}</strong>
        </div>
        <div aria-hidden="true" className="agent-fleet-card-accent" />
      </div>

      <div className="agent-fleet-card-body">
        <code>{agent.id}</code>
        <dl>
          <div>
            <dt>Credential</dt>
            <dd>{formatConnectionHealth(agent.connection_health)}</dd>
          </div>
          <div>
            <dt>Policies</dt>
            <dd>{agent.policy_coverage === 0 ? 'None' : `${agent.policy_coverage}`}</dd>
          </div>
          <div>
            <dt>Team</dt>
            <dd title={agent.team.name}>{agent.team.name}</dd>
          </div>
        </dl>
      </div>
    </Link>
  );
}

type AgentFleetStripProps = {
  readonly agents: readonly AgentRosterItem[];
  readonly orgSlug: string;
};

/** Horizontal fleet of robot cards for the home overview. */
export function AgentFleetStrip({ agents, orgSlug }: AgentFleetStripProps) {
  const active = agents.filter((agent) => agent.status !== 'deactivated' && agent.status !== 'retired');
  const shown = (active.length > 0 ? active : agents).slice(0, 8);

  if (shown.length === 0) {
    return (
      <div className="agent-fleet-empty">
        <div aria-hidden="true" className="agent-fleet-empty-robot">
          <img alt="" height={88} src={AGENT_ROBOT_SRC} width={88} />
        </div>
        <strong>No agents yet</strong>
        <p>Create an agent identity, then connect it over MCP.</p>
        <Link className="canonical-overview-primary" href={`/app/${orgSlug}/agents`}>
          + New agent
        </Link>
      </div>
    );
  }

  return (
    <div className="agent-fleet-strip">
      {shown.map((agent, index) => (
        <AgentFleetCard agent={agent} index={index} key={agent.id} orgSlug={orgSlug} />
      ))}
    </div>
  );
}
