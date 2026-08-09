import Link from 'next/link';
import type { AgentRosterItem } from '@/lib/identity-spine-types';
import { AGENT_ROBOT_SRC, agentTint } from './agent-visual';
import { formatReputationScore, REPUTATION_HINT } from './ReputationDisplay';

type AgentFleetCardProps = {
  readonly agent: AgentRosterItem;
  readonly orgSlug: string;
  readonly index?: number;
};

function shortAgentId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/**
 * Home fleet card: robot + name + published identity + reputation.
 */
export function AgentFleetCard({ agent, orgSlug, index = 0 }: AgentFleetCardProps) {
  const tint = agentTint(agent.id);
  const ready = agent.status === 'active'
    && (agent.connection_health === 'healthy' || agent.connection_health === 'stale');
  const displayName = agent.name.length > 24
    ? `${agent.name.slice(0, 16)}…${agent.name.slice(-5)}`
    : agent.name;
  const tokenId = agent.identity_token_id ?? null;
  const publishedId = tokenId !== null ? `#${tokenId}` : shortAgentId(agent.id);
  const reputationScore = agent.reputation_score ?? 0;
  const reputationEvents = agent.reputation_events ?? 0;

  return (
    <Link
      className="agent-fleet-card"
      href={`/app/${orgSlug}/agents/${agent.id}`}
      style={{ ['--agent-tint' as string]: tint.color, ['--agent-glow' as string]: tint.glow }}
      title={agent.name}
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
            height={148}
            loading={index < 4 ? 'eager' : 'lazy'}
            src={AGENT_ROBOT_SRC}
            width={148}
          />
        </div>
        {ready ? (
          <span aria-hidden="true" className="agent-fleet-card-ready-dot" />
        ) : null}
      </div>

      <div className="agent-fleet-card-body">
        <strong title={agent.name}>{displayName}</strong>
        <dl>
          <div>
            <dt>ID</dt>
            <dd title={tokenId !== null ? `Token ${tokenId} · ${agent.id}` : agent.id}>
              {publishedId}
            </dd>
          </div>
          <div>
            <dt>Rep</dt>
            <dd title={REPUTATION_HINT}>
              {formatReputationScore(reputationScore, reputationEvents)}
            </dd>
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

/** Horizontal fleet of robot cards for the home overview — max 4. */
export function AgentFleetStrip({ agents, orgSlug }: AgentFleetStripProps) {
  const active = agents.filter((agent) => agent.status !== 'deactivated' && agent.status !== 'retired');
  const shown = (active.length > 0 ? active : agents).slice(0, 4);

  if (shown.length === 0) {
    return (
      <div className="agent-fleet-empty">
        <div aria-hidden="true" className="agent-fleet-empty-robot">
          <img alt="" height={88} src={AGENT_ROBOT_SRC} width={88} />
        </div>
        <strong>No agents yet</strong>
        <p>Create an agent to get started.</p>
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
