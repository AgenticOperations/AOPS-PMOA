import { redirect } from 'next/navigation';
import { AgentDetailShell } from '@/components/agents/AgentDetailShell';
import {
  bindAgentPolicyAction,
  removeAgentPolicyBindingAction,
} from '../../../../actions/policy';
import {
  activateAgentAction,
  attachWalletRefFromFormAction,
  createConnectionFromFormAction,
  deactivateAgentAction,
  detachWalletRefFromFormAction,
  pauseAgentAction,
  registerOnchainIdentityAction,
  revokeConnectionFromFormAction,
  rotateConnectionFromFormAction,
  savePublishListingAction,
  updateAgentAction,
} from '../../../../actions/identity-spine';
import { getAgentActivityFeed, getAgentDetail, getOrgBySlug, listTeams } from '@/lib/server/identity-spine-client';
import { getAgentOnchainIdentity } from '@/lib/server/payments-client';
import { listAgentAllowedActions, listBlockedOperations } from '@/lib/server/operations-client';
import { listAgentPolicies, listPolicyLibrary } from '@/lib/server/policy-client';
import { resolveMcpPublicUrl } from '@/lib/server/mcp-public-url';

export const dynamic = 'force-dynamic';

type AgentDetailPageProps = {
  readonly params: Promise<{ readonly agentId: string; readonly orgSlug: string }>;
  readonly searchParams?: Promise<Record<string, string | readonly string[] | undefined>>;
};

function singleParam(value: string | readonly string[] | undefined): string {
  if (typeof value === 'string') return value;
  return value?.[0] ?? '';
}

function normalizeAgentTab(value: string): 'overview' | 'access' | 'credentials' | 'publish' | 'activity' {
  if (value === 'access' || value === 'credentials' || value === 'publish' || value === 'activity') return value;
  return 'overview';
}

const DEFAULT_TEMPLATE_REPO = 'https://github.com/circlefin/arc-nanopayments';

export default async function AgentDetailPage({ params, searchParams }: AgentDetailPageProps) {
  const { agentId, orgSlug } = await params;
  const query = (await searchParams) ?? {};
  const activeTab = normalizeAgentTab(singleParam(query.tab));
  const mcpEndpoint = resolveMcpPublicUrl();
  const templateRepoUrl = process.env.NEXT_PUBLIC_AGENT_TEMPLATE_REPO_URL?.trim() || DEFAULT_TEMPLATE_REPO;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [detail, activityFeed, agentPolicies, policyLibrary, allowedActions, blockedOperations, teams, onchainIdentity] = await Promise.all([
    getAgentDetail(org.id, agentId),
    getAgentActivityFeed(org.id, agentId),
    listAgentPolicies(org.id, agentId),
    listPolicyLibrary(org.id),
    listAgentAllowedActions(org.id, agentId),
    listBlockedOperations(org.id, { agentId, limit: 12 }),
    listTeams(org.id),
    getAgentOnchainIdentity(org.id, agentId).catch(() => null),
  ]);

  return (
      <AgentDetailShell
        activity={detail.activity}
        activityFeed={activityFeed}
        activityPollUrl={`/api/app/${org.slug}/agents/${agentId}/activity`}
        agent={detail.agent}
        activeTab={activeTab}
        allowedActions={allowedActions}
        blockedOperations={blockedOperations}
        connections={detail.connections}
        mcpEndpoint={mcpEndpoint}
        onchainIdentity={onchainIdentity}
        walletRefs={detail.walletRefs}
        teams={teams.filter((team) => team.archived_at === null)}
        orgId={org.id}
        orgSlug={org.slug}
        availablePolicies={policyLibrary.policies}
        policies={agentPolicies.policies}
        templateRepoUrl={templateRepoUrl}
        actions={{
          pause: pauseAgentAction.bind(null, org.id, org.slug, agentId),
          activate: activateAgentAction.bind(null, org.id, org.slug, agentId),
          deactivate: deactivateAgentAction.bind(null, org.id, org.slug, agentId),
          createConnection: createConnectionFromFormAction,
          rotateConnection: rotateConnectionFromFormAction,
          revokeConnection: revokeConnectionFromFormAction,
          attachWalletRef: attachWalletRefFromFormAction,
          detachWalletRef: detachWalletRefFromFormAction,
          updateAgent: updateAgentAction.bind(null, org.id, org.slug, agentId),
          bindPolicy: bindAgentPolicyAction.bind(null, org.id, org.slug, agentId),
          removePolicyBinding: removeAgentPolicyBindingAction.bind(null, org.id, org.slug, agentId),
          savePublishListing: savePublishListingAction.bind(null, org.id, org.slug, agentId),
          registerOnchainIdentity: async (formData: FormData) => (
            registerOnchainIdentityAction(org.id, org.slug, agentId, formData)
          ),
        }}
      />
  );
}
