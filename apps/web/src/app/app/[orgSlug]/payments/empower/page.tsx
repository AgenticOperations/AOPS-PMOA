import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { DelegateFromTreasury } from '@/components/payments/DelegateFromTreasury';
import { EmpowerWorkbench } from '@/components/payments/EmpowerWorkbench';
import { OrgCeilingForm } from '@/components/payments/OrgCeilingForm';
import { TreasuryAgentAccess } from '@/components/payments/TreasuryAgentAccess';
import { TreasuryWorkbench } from '@/components/payments/TreasuryChrome';
import { DelegateToAgent } from '@/components/wallet/DelegateToAgent';
import { DelegationList } from '@/components/wallet/DelegationList';
import { WalletProvider } from '@/components/wallet/WalletProvider';
import { revokeTrustAction, setAgentPaymentAccessAction, trustExternalAgentAction } from '@/app/actions/payments';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';
import {
  getTrustEvidence,
  listAgentPaymentAccounts,
  listAgentWalletFunding,
  listDelegations,
  listEscrowCounterparties,
  listEscrowLivenessRisks,
  listOrgCeilings,
  listPaymentCapabilities,
} from '@/lib/server/payments-client';
import type { PaymentChain } from '@/lib/payments-types';
import type { SupportedChainKey } from '@/lib/wallet-chains';

export const dynamic = 'force-dynamic';

type EmpowerPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

function isSupportedEscrowChain(chain: PaymentChain): chain is SupportedChainKey {
  return chain === 'arc' || chain === 'base';
}

export default async function PaymentsEmpowerPage({ params }: EmpowerPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [
    agents,
    agentAccounts,
    capabilities,
    counterparties,
    atRiskEscrowJobs,
    delegations,
    ceilings,
    agentWallets,
  ] = await Promise.all([
    listAgents(org.id),
    listAgentPaymentAccounts(org.id),
    listPaymentCapabilities(org.id),
    listEscrowCounterparties(org.id).catch(() => []),
    listEscrowLivenessRisks(org.id).catch(() => []),
    listDelegations(org.id).catch(() => []),
    listOrgCeilings(org.id).catch(() => []),
    listAgentWalletFunding(org.id).catch(() => []),
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

  const agentOptions = agents.map((agent) => ({ id: agent.id, name: agent.name }));

  return (
    <ConsoleShell active="payments" org={org}>
      <TreasuryWorkbench
        active="empower"
        description="Grant rails, set ceilings, then delegate spend headroom."
        info="Caps constrain agents drawing from this platform treasury — not the platform itself."
        orgSlug={org.slug}
        title="Empower"
      >
        <EmpowerWorkbench
          access={
            <TreasuryAgentAccess
              accessAction={setAgentPaymentAccessAction.bind(null, org.id, org.slug)}
              accounts={agentAccounts.accounts}
              agents={agents}
              atRiskEscrowJobs={atRiskEscrowJobs}
              capabilities={capabilities}
              embedded
              externalAgents={externalAgents}
              orgSlug={org.slug}
            />
          }
          caps={<OrgCeilingForm ceilings={ceilings} orgSlug={org.slug} />}
          delegations={
            <div className="treasury-stack">
              <section className="treasury-panel">
                <header className="treasury-panel-header">
                  <h2>From treasury</h2>
                </header>
                <DelegateFromTreasury
                  agentWallets={agentWallets.map((wallet) => ({
                    agentId: wallet.agentId,
                    chain: wallet.chain,
                    status: wallet.status,
                  }))}
                  agents={agentOptions}
                  orgSlug={org.slug}
                />
              </section>
              <section className="treasury-panel">
                <header className="treasury-panel-header">
                  <h2>From your wallet</h2>
                </header>
                <WalletProvider>
                  <DelegateToAgent agents={agentOptions} orgSlug={org.slug} />
                </WalletProvider>
              </section>
              <section className="treasury-panel">
                <header className="treasury-panel-header">
                  <h2>Active delegations</h2>
                </header>
                <DelegationList delegations={delegations} orgSlug={org.slug} />
              </section>
            </div>
          }
        />
      </TreasuryWorkbench>
    </ConsoleShell>
  );
}
