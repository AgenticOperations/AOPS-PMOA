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
import { setAgentPaymentAccessAction } from '../../../../actions/payments';
import { getAgentActivityFeed, getAgentDetail, getOrgBySlug, listTeams } from '@/lib/server/identity-spine-client';
import {
  getAgentOnchainIdentity,
  getAgentPayments,
  getTrustEvidence,
  listAgentWalletFunding,
  listDelegations,
  listEscrowJobs,
  listPaymentCapabilities,
} from '@/lib/server/payments-client';
import type { PaymentChain } from '@/lib/payments-types';
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

  const [
    detail,
    activityFeed,
    agentPolicies,
    policyLibrary,
    allowedActions,
    blockedOperations,
    teams,
    onchainIdentity,
    paymentSummary,
    capabilities,
    allDelegations,
    agentWallets,
    escrowJobs,
  ] = await Promise.all([
    getAgentDetail(org.id, agentId),
    getAgentActivityFeed(org.id, agentId),
    listAgentPolicies(org.id, agentId),
    listPolicyLibrary(org.id),
    listAgentAllowedActions(org.id, agentId),
    listBlockedOperations(org.id, { agentId, limit: 12 }),
    listTeams(org.id),
    getAgentOnchainIdentity(org.id, agentId).catch(() => null),
    getAgentPayments(org.id, agentId).catch(() => ({ account: null, sources: [] as const })),
    listPaymentCapabilities(org.id).catch(() => []),
    listDelegations(org.id).catch(() => []),
    listAgentWalletFunding(org.id).catch(() => []),
    listEscrowJobs(org.id).catch(() => []),
  ]);

  const agentDelegations = allDelegations.filter((delegation) => delegation.payeeAgentId === agentId);
  const agentWalletFunding = agentWallets
    .filter((wallet) => wallet.agentId === agentId)
    .map((wallet) => ({
      agentId: wallet.agentId,
      chain: wallet.chain,
      status: wallet.status,
    }));

  const counterpartyKeys = new Map<string, { chain: PaymentChain; address: string }>();
  for (const job of escrowJobs) {
    if (job.clientAgentId !== agentId) continue;
    const key = `${job.chain}:${job.providerAddress.toLowerCase()}`;
    if (!counterpartyKeys.has(key)) {
      counterpartyKeys.set(key, { chain: job.chain, address: job.providerAddress });
    }
  }

  const trustTargets = (
    await Promise.all(
      [...counterpartyKeys.values()].map(async (counterparty) => {
        try {
          const evidence = await getTrustEvidence(org.id, counterparty.chain, counterparty.address);
          return {
            chain: counterparty.chain,
            address: counterparty.address,
            evidence: {
              completedCount: evidence.completedCount,
              rejectedCount: evidence.rejectedCount,
              expiredCount: evidence.expiredCount,
              settledUsdc: evidence.settledUsdc,
            },
            trusted: evidence.trusted,
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter((target): target is NonNullable<typeof target> => target !== null);

  return (
      <AgentDetailShell
        activity={detail.activity}
        activityFeed={activityFeed}
        activityPollUrl={`/api/app/${org.slug}/agents/${agentId}/activity`}
        agent={detail.agent}
        activeTab={activeTab}
        agentDelegations={agentDelegations}
        agentWalletFunding={agentWalletFunding}
        allowedActions={allowedActions}
        blockedOperations={blockedOperations}
        connections={detail.connections}
        mcpEndpoint={mcpEndpoint}
        onchainIdentity={onchainIdentity}
        paymentAccessAction={setAgentPaymentAccessAction.bind(null, org.id, org.slug)}
        paymentAccount={paymentSummary.account}
        paymentCapabilities={capabilities}
        reputationHistory={detail.reputationHistory ?? []}
        trustTargets={trustTargets}
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
          registerOnchainIdentity: registerOnchainIdentityAction.bind(null, org.id, org.slug, agentId),
        }}
      />
  );
}
