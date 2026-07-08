import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { formatConnectionHealth, formatStatus } from '@/components/agents/format';
import { createAgentAction } from '../../../actions/identity-spine';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';

export const dynamic = 'force-dynamic';

type AgentsPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function AgentsPage({ params }: AgentsPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const agents = await listAgents(org.id);
  const agentCountLabel = `${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}`;

  return (
    <ConsoleShell active="agents" org={org}>
      <div className="agents-fleet-page">
        <section className="agents-console-header agents-reveal">
          <div>
            <p className="agents-kicker">Agent registry</p>
            <h1>Agents</h1>
          </div>
          <form action={createAgentAction.bind(null, org.id, org.slug)} className="agents-inline-create-form">
            <label className="agents-inline-label">
              <span>Agent name</span>
              <input aria-label="Agent name" name="name" placeholder="Authorise a new agent" required />
            </label>
            <button className="agents-inline-add-button" type="submit">
              Add
            </button>
          </form>
        </section>

        <section className="agents-roster-shell agents-reveal">
          <div className="agents-roster-core">
            <div className="agents-roster-heading">
              <div className="agents-section-heading">
                <p className="agents-kicker">Fleet roster</p>
                <h2>Registered agents</h2>
              </div>
              <span>{agentCountLabel}</span>
            </div>

            {agents.length === 0 ? (
              <div className="agents-empty-state">
                <div className="agents-empty-mark" aria-hidden="true">
                  aO
                </div>
                <h3>No agents registered</h3>
                <p>Create the first agent record, then open it to issue its credential.</p>
              </div>
            ) : (
              <div className="agents-roster-table" role="table" aria-label="Registered agents">
                <div className="agents-roster-header" role="row">
                  <span role="columnheader">Agent</span>
                  <span role="columnheader">Team</span>
                  <span role="columnheader">Credential</span>
                  <span role="columnheader">Agent status</span>
                  <span role="columnheader">Open</span>
                </div>
                {agents.map((agent) => (
                  <Link
                    className="agents-roster-row"
                    href={`/app/${org.slug}/agents/${agent.id}`}
                    key={agent.id}
                    role="row"
                  >
                    <div className="agents-identity-cell" role="cell">
                      <span className="agents-avatar" aria-hidden="true">
                        {agent.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <strong>{agent.name}</strong>
                        <span>{agent.id}</span>
                      </div>
                    </div>
                    <span className="agents-team-pill" role="cell">
                      {agent.team.name}
                    </span>
                    <span className="agents-health-cell" role="cell">
                      <span
                        className={`agents-health-dot agents-health-${agent.connection_health}`}
                        aria-hidden="true"
                      />
                      {formatConnectionHealth(agent.connection_health)}
                    </span>
                    <span className={`agents-state-pill agents-state-${agent.status}`} role="cell">
                      {formatStatus(agent.status)}
                    </span>
                    <span className="agents-open-action" role="cell">
                      <span aria-hidden="true">↗</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </ConsoleShell>
  );
}
