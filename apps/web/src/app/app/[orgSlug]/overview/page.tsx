import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';

export const dynamic = 'force-dynamic';

type OverviewPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function OverviewPage({ params }: OverviewPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const agents = await listAgents(org.id);
  const activeAgents = agents.filter((agent) => agent.status === 'active').length;
  const connectedAgents = agents.filter((agent) => agent.connection_health === 'healthy').length;

  return (
    <ConsoleShell active="overview" org={org}>
      <div className="ops-page">
        <header className="ops-page-header">
          <div>
            <h1>Overview</h1>
            <p>{org.name}</p>
          </div>
          <Link className="ops-primary-action" href={`/app/${org.slug}/agents`}>
            Open agents
          </Link>
        </header>

        <section className="ops-surface" aria-labelledby="workspace-status-title">
          <div className="ops-surface-heading">
            <div>
              <h2 id="workspace-status-title">Workspace status</h2>
              <p>Current identity and access setup for this organization.</p>
            </div>
            <span className="ops-count-pill">{agents.length} {agents.length === 1 ? 'agent' : 'agents'}</span>
          </div>

          <div className="ops-summary-grid" aria-label="Workspace status">
            <div>
              <span>Workspace</span>
              <strong>{org.name}</strong>
            </div>
            <div>
              <span>Active agents</span>
              <strong>{activeAgents}</strong>
            </div>
            <div>
              <span>Connected agents</span>
              <strong>{connectedAgents}</strong>
            </div>
          </div>

          {agents.length === 0 ? (
            <div className="ops-empty-state">
              <h3>No agents registered</h3>
              <p>Create an agent identity before adding credentials or policies.</p>
              <Link className="button-secondary" href={`/app/${org.slug}/agents`}>
                Add agent
              </Link>
            </div>
          ) : (
            <div className="ops-table" role="table" aria-label="Workspace agents">
              <div className="ops-table-head" role="row">
                <span role="columnheader">Agent</span>
                <span role="columnheader">Team</span>
                <span role="columnheader">Connection</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Open</span>
              </div>
              {agents.map((agent) => (
                <Link className="ops-table-row" href={`/app/${org.slug}/agents/${agent.id}`} key={agent.id} role="row">
                  <span className="ops-name-cell" role="cell">
                    <span className="ops-row-title">{agent.name}</span>
                    <span>{agent.id}</span>
                  </span>
                  <span className="ops-muted-pill" role="cell">{agent.team.name}</span>
                  <span className={`ops-state-pill ops-state-${agent.connection_health}`} role="cell">
                    {agent.connection_health.replace('_', ' ')}
                  </span>
                  <span className={`ops-state-pill ops-state-${agent.status}`} role="cell">{agent.status}</span>
                  <span className="ops-row-open" role="cell">Open</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </ConsoleShell>
  );
}
