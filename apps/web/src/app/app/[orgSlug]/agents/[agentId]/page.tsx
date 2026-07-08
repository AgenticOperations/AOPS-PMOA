import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { AgentDetailShell } from '@/components/agents/AgentDetailShell';
import {
  activateAgentAction,
  createConnectionFromFormAction,
  deactivateAgentAction,
  pauseAgentAction,
  revokeConnectionFromFormAction,
  rotateConnectionFromFormAction,
  testConnectionFromFormAction,
} from '../../../../actions/identity-spine';
import { getAgentActivityFeed, getAgentDetail, getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listAgentAllowedActions, listBlockedOperations } from '@/lib/server/operations-client';
import { listAgentPolicies } from '@/lib/server/policy-client';

export const dynamic = 'force-dynamic';

type AgentDetailPageProps = {
  readonly params: Promise<{ readonly agentId: string; readonly orgSlug: string }>;
};

export default async function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { agentId, orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [detail, activityFeed, policyLibrary, allowedActions, blockedOperations] = await Promise.all([
    getAgentDetail(org.id, agentId),
    getAgentActivityFeed(org.id, agentId),
    listAgentPolicies(org.id, agentId),
    listAgentAllowedActions(org.id, agentId),
    listBlockedOperations(org.id, { agentId, limit: 12 }),
  ]);

  return (
    <ConsoleShell active="agents" org={org}>
      <Link className="back-link" href={`/app/${org.slug}/agents`}>
        Back to agents
      </Link>
      <AgentDetailShell
        activity={detail.activity}
        activityFeed={activityFeed}
        activityPollUrl={`/api/app/${org.slug}/agents/${agentId}/activity`}
        agent={detail.agent}
        allowedActions={allowedActions}
        blockedOperations={blockedOperations}
        connections={detail.connections}
        orgId={org.id}
        orgSlug={org.slug}
        policies={policyLibrary.policies}
        actions={{
          pause: pauseAgentAction.bind(null, org.id, org.slug, agentId),
          activate: activateAgentAction.bind(null, org.id, org.slug, agentId),
          deactivate: deactivateAgentAction.bind(null, org.id, org.slug, agentId),
          createConnection: createConnectionFromFormAction,
          rotateConnection: rotateConnectionFromFormAction,
          testConnection: testConnectionFromFormAction,
          revokeConnection: revokeConnectionFromFormAction,
        }}
      />
    </ConsoleShell>
  );
}
