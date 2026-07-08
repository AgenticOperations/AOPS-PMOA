import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { ControlsLibrary } from '@/components/controls/ControlsLibrary';
import {
  activatePolicyDraftAction,
  bindPolicyAction,
  createPolicyDraftAction,
  validatePolicyDraftAction,
} from '../../../actions/policy';
import { getOrgBySlug, listAgents, listConnections, listTeams } from '@/lib/server/identity-spine-client';
import { listPolicyLibrary } from '@/lib/server/policy-client';

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

  const [library, teams, agents] = await Promise.all([
    listPolicyLibrary(org.id),
    listTeams(org.id),
    listAgents(org.id),
  ]);
  const connectionGroups = await Promise.all(
    agents.map(async (agent) => ({
      agent,
      connections: await listConnections(org.id, agent.id),
    })),
  );
  const bindTargets = [
    { id: org.id, label: org.name, type: 'org' as const },
    ...teams.map((team) => ({ id: team.id, label: team.name, type: 'team' as const })),
    ...agents.map((agent) => ({ id: agent.id, label: agent.name, type: 'agent' as const })),
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
        bindAction={bindPolicyAction.bind(null, org.id, org.slug)}
        createAction={createPolicyDraftAction.bind(null, org.id, org.slug)}
        drafts={library.drafts}
        bindTargets={bindTargets}
        orgId={org.id}
        orgSlug={org.slug}
        policies={library.policies}
        validateAction={validatePolicyDraftAction.bind(null, org.id, org.slug)}
      />
    </ConsoleShell>
  );
}
