import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { ControlsLibrary } from '@/components/controls/ControlsLibrary';
import {
  activatePolicyDraftAction,
  activatePolicyRevisionDraftAction,
  archivePolicyAction,
  createPolicyDraftAction,
  createPolicyRestoreDraftAction,
  createPolicyRevisionDraftAction,
  discardPolicyDraftAction,
  simulatePolicyDraftAction,
  updatePolicyDraftAction,
  validatePolicyDraftAction,
} from '../../../actions/policy';
import { getOrgBySlug, listAgents, listConnections, listTeams } from '@/lib/server/identity-spine-client';
import { listAuditEvents } from '@/lib/server/audit-client';
import {
  listPolicyActions,
  listPolicyLibrary,
  listPolicySimulations,
} from '@/lib/server/policy-client';

export const dynamic = 'force-dynamic';

type ControlsPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function ControlsPage({ params }: ControlsPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [library, policyActions, simulations, teams, agents, auditEvents] = await Promise.all([
    listPolicyLibrary(org.id),
    listPolicyActions(org.id),
    listPolicySimulations(org.id),
    listTeams(org.id),
    listAgents(org.id),
    listAuditEvents(org.id, 30),
  ]);
  const activeTeams = teams.filter((team) => team.archived_at === null);
  const activeAgents = agents.filter((agent) => agent.status !== 'deactivated');
  const connectionGroups = await Promise.all(
    activeAgents.map(async (agent) => ({
      agent,
      connections: (await listConnections(org.id, agent.id)).filter((connection) => connection.status === 'active'),
    })),
  );
  const bindTargets = [
    { id: org.id, label: org.name, type: 'org' as const },
    ...activeTeams.map((team) => ({ id: team.id, label: team.name, type: 'team' as const })),
    ...activeAgents.map((agent) => ({ id: agent.id, label: agent.name, type: 'agent' as const })),
    ...connectionGroups.flatMap(({ agent, connections }) =>
      connections.map((connection) => ({
        id: connection.id,
        label: `${connection.name} (${agent.name})`,
        type: 'connection' as const,
      })),
    ),
  ];

  return (
    <ConsoleShell active="controls" org={org}>
      <ControlsLibrary
        activateAction={activatePolicyDraftAction.bind(null, org.id, org.slug)}
        activateRevisionAction={activatePolicyRevisionDraftAction.bind(null, org.id, org.slug)}
        archivePolicyAction={archivePolicyAction.bind(null, org.id, org.slug)}
        createAction={createPolicyDraftAction.bind(null, org.id, org.slug)}
        createRestoreDraftAction={createPolicyRestoreDraftAction.bind(null, org.id, org.slug)}
        createRevisionDraftAction={createPolicyRevisionDraftAction.bind(null, org.id, org.slug)}
        discardDraftAction={discardPolicyDraftAction.bind(null, org.id, org.slug)}
        drafts={library.drafts}
        activityEvents={auditEvents.events}
        policyActions={policyActions}
        simulations={simulations}
        bindTargets={bindTargets}
        orgId={org.id}
        orgSlug={org.slug}
        policies={library.policies}
        simulateDraftAction={simulatePolicyDraftAction.bind(null, org.id, org.slug)}
        updateDraftAction={updatePolicyDraftAction.bind(null, org.id, org.slug)}
        validateAction={validatePolicyDraftAction.bind(null, org.id, org.slug)}
      />
    </ConsoleShell>
  );
}
