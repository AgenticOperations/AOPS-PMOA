import Link from 'next/link';
import type { AgentRosterItem } from '@/lib/identity-spine-types';
import { formatConnectionHealth, formatStatus } from './format';

export function AgentRoster({
  agents,
  orgSlug,
}: {
  readonly agents: AgentRosterItem[];
  readonly orgSlug: string;
}) {
  if (agents.length === 0) {
    return (
      <section className="empty-state" aria-labelledby="empty-agents-title">
        <p className="eyebrow">Identity first</p>
        <h2 id="empty-agents-title">No agents registered</h2>
        <p>Register the first identity, then issue its access credential from the detail page.</p>
      </section>
    );
  }

  return (
    <div className="table-wrap">
      <table className="agent-table">
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">Status</th>
            <th scope="col">Team</th>
            <th scope="col">Connection</th>
            <th scope="col">Wallet refs</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.id}>
              <td data-label="Agent">
                <Link className="agent-link" href={`/app/${orgSlug}/agents/${agent.id}`}>
                  {agent.name}
                </Link>
                <span className="subtle-id">{agent.id}</span>
              </td>
              <td data-label="Status">
                <span className={`pill status-${agent.status}`}>{formatStatus(agent.status)}</span>
              </td>
              <td data-label="Team">{agent.team.name}</td>
              <td data-label="Credential">
                <span className={`health-dot health-${agent.connection_health}`} aria-hidden="true" />
                {formatConnectionHealth(agent.connection_health)}
              </td>
              <td data-label="Wallet refs">{agent.wallet_refs_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
