import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { TreasuryAgentAccess } from '@/components/payments/TreasuryAgentAccess';
import { revokeTrustAction, setAgentPaymentAccessAction, trustExternalAgentAction } from '@/app/actions/payments';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';
import {
  getTrustEvidence,
  listAgentPaymentAccounts,
  listEscrowCounterparties,
  listEscrowLivenessRisks,
  listPaymentCapabilities,
} from '@/lib/server/payments-client';
import type { PaymentChain } from '@/lib/payments-types';
import type { SupportedChainKey } from '@/lib/wallet-chains';

export const dynamic = 'force-dynamic';

type AgentAccessPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

// Escrow was only ever deployed on Arc and Base Sepolia (piece 1). The DB
// column allows every PaymentChain, so this narrows before the console's
// stricter SupportedChainKey type -- silently dropping anything else rather
// than rendering a chain the console has no explorer link or label for.
function isSupportedEscrowChain(chain: PaymentChain): chain is SupportedChainKey {
  return chain === 'arc' || chain === 'base';
}

export default async function PaymentsAgentAccessPage({ params }: AgentAccessPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [agents, agentAccounts, capabilities, counterparties, atRiskEscrowJobs] = await Promise.all([
    listAgents(org.id),
    listAgentPaymentAccounts(org.id),
    listPaymentCapabilities(org.id),
    // A brand-new org, or one that has never run an escrow job, has neither
    // -- empty lists are the starting state, not an error worth failing the
    // whole page over.
    listEscrowCounterparties(org.id).catch(() => []),
    listEscrowLivenessRisks(org.id).catch(() => []),
  ]);

  const externalAgents = await Promise.all(
    counterparties
      .filter((counterparty) => isSupportedEscrowChain(counterparty.chain))
      .map(async (counterparty) => {
        const chain = counterparty.chain as SupportedChainKey;
        const evidence = await getTrustEvidence(org.id, counterparty.chain, counterparty.providerAddress);
        return {
          chain,
          address: counterparty.providerAddress,
          // No stored display name exists for a counterparty until it is
          // promoted -- the address is the only honest label pre-trust.
          label: counterparty.providerAddress,
          trusted: evidence.trusted,
          evidence: {
            completedCount: evidence.completedCount,
            rejectedCount: evidence.rejectedCount,
            expiredCount: evidence.expiredCount,
            settledUsdc: evidence.settledUsdc,
          },
          jobs: evidence.jobs,
          trustAction: trustExternalAgentAction.bind(null, org.id, org.slug, counterparty.chain, counterparty.providerAddress),
          revokeAction: revokeTrustAction.bind(null, org.id, org.slug, counterparty.chain, counterparty.providerAddress),
        };
      }),
  );

  return (
    <ConsoleShell active="payments" org={org}>
      <TreasuryAgentAccess
        accessAction={setAgentPaymentAccessAction.bind(null, org.id, org.slug)}
        accounts={agentAccounts.accounts}
        agents={agents}
        atRiskEscrowJobs={atRiskEscrowJobs}
        capabilities={capabilities}
        externalAgents={externalAgents}
        orgSlug={org.slug}
      />
    </ConsoleShell>
  );
}
