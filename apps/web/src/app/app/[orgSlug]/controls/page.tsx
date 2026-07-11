import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { OrgAuditPanel } from '@/components/audit/OrgAuditPanel';
import { ControlsLibrary } from '@/components/controls/ControlsLibrary';
import {
  activatePolicyDraftAction,
  archivePolicyAction,
  bindPolicyAction,
  createPolicyDraftAction,
  createPolicyVersionAction,
  discardPolicyDraftAction,
  removePolicyBindingAction,
  simulatePolicyDraftAction,
  updatePolicyDraftAction,
  validatePolicyDraftAction,
} from '../../../actions/policy';
import { getOrgBySlug, listAgents, listConnections, listTeams } from '@/lib/server/identity-spine-client';
import { listAuditEvents } from '@/lib/server/audit-client';
import { listPolicyActions, listPolicyLibrary, listPolicySimulations } from '@/lib/server/policy-client';

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
        archivePolicyAction={archivePolicyAction.bind(null, org.id, org.slug)}
        bindAction={bindPolicyAction.bind(null, org.id, org.slug)}
        createAction={createPolicyDraftAction.bind(null, org.id, org.slug)}
        createVersionAction={createPolicyVersionAction.bind(null, org.id, org.slug)}
        discardDraftAction={discardPolicyDraftAction.bind(null, org.id, org.slug)}
        drafts={library.drafts}
        policyActions={policyActions}
        simulations={simulations}
        bindTargets={bindTargets}
        orgId={org.id}
        orgSlug={org.slug}
        policies={library.policies}
        removeBindingAction={removePolicyBindingAction.bind(null, org.id, org.slug)}
        simulateDraftAction={simulatePolicyDraftAction.bind(null, org.id, org.slug)}
        updateDraftAction={updatePolicyDraftAction.bind(null, org.id, org.slug)}
        validateAction={validatePolicyDraftAction.bind(null, org.id, org.slug)}
      />
      <OrgAuditPanel
        description="Policy drafts, activations, bindings, simulations, and enforcement decisions recorded in the hash-chained audit stream."
        domains={['policy']}
        events={auditEvents.events}
        title="Control activity"
      />
    </ConsoleShell>
  );
}
