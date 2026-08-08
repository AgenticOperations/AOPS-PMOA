import { redirect } from 'next/navigation';
import { DelegateFromTreasury } from '@/components/payments/DelegateFromTreasury';
import { DelegationsPanel } from '@/components/payments/DelegationsPanel';
import { EmpowerWorkbench } from '@/components/payments/EmpowerWorkbench';
import { OrgCeilingForm } from '@/components/payments/OrgCeilingForm';
import { TreasuryAgentAccess } from '@/components/payments/TreasuryAgentAccess';
import { TreasuryWorkbench } from '@/components/payments/TreasuryChrome';
import { DelegateToAgent } from '@/components/wallet/DelegateToAgent';
import { DelegationList } from '@/components/wallet/DelegationList';
import { WalletProvider } from '@/components/wallet/WalletProvider';
import { setAgentPaymentAccessAction } from '@/app/actions/payments';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';
import {
  listAgentPaymentAccounts,
  listAgentWalletFunding,
  listDelegations,
  listEscrowLivenessRisks,
  listOrgCeilings,
  listPaymentCapabilities,
} from '@/lib/server/payments-client';

export const dynamic = 'force-dynamic';

type EmpowerPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
  readonly searchParams: Promise<{
    readonly tab?: string;
    readonly source?: string;
    readonly from?: string;
  }>;
};

export default async function PaymentsEmpowerPage({ params, searchParams }: EmpowerPageProps) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const initialTab = query.tab === 'caps' || query.tab === 'delegations' || query.tab === 'access'
    ? query.tab
    : 'access';
  const initialSource = query.source === 'wallet' ? 'wallet' : 'treasury';
  const skipDepositNotice = query.from === 'fund' && initialSource === 'wallet';
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
    atRiskEscrowJobs,
    delegations,
    ceilings,
    agentWallets,
  ] = await Promise.all([
    listAgents(org.id),
    listAgentPaymentAccounts(org.id),
    listPaymentCapabilities(org.id),
    listEscrowLivenessRisks(org.id).catch(() => []),
    listDelegations(org.id).catch(() => []),
    listOrgCeilings(org.id).catch(() => []),
    listAgentWalletFunding(org.id).catch(() => []),
  ]);

  const agentOptions = agents.map((agent) => ({ id: agent.id, name: agent.name }));

  return (
      <TreasuryWorkbench
        active="empower"
        description={
          skipDepositNotice
            ? 'Deposit skipped — grant from your wallet on Delegations.'
            : 'Grant rails, then pick a spend source: treasury (after Fund deposit) or your own wallet.'
        }
        info={
          skipDepositNotice
            ? 'Non-custodial Permit2 — funds stay in MetaMask until an agent draws.'
            : 'Path 1: Fund deposit → From treasury. Path 2: From your wallet (Permit2) — no treasury deposit.'
        }
        orgSlug={org.slug}
        title="Empower"
      >
        <EmpowerWorkbench
          initialTab={initialTab}
          access={(
            <TreasuryAgentAccess
              accessAction={setAgentPaymentAccessAction.bind(null, org.id, org.slug)}
              accounts={agentAccounts.accounts}
              agents={agents}
              atRiskEscrowJobs={atRiskEscrowJobs}
              capabilities={capabilities}
              embedded
              orgSlug={org.slug}
            />
          )}
          caps={<OrgCeilingForm ceilings={ceilings} orgSlug={org.slug} />}
          delegations={(
            <DelegationsPanel
              activeList={<DelegationList delegations={delegations} orgSlug={org.slug} />}
              initialSource={initialSource}
              skipDepositNotice={skipDepositNotice}
              treasuryForm={(
                <DelegateFromTreasury
                  agentWallets={agentWallets.map((wallet) => ({
                    agentId: wallet.agentId,
                    chain: wallet.chain,
                    status: wallet.status,
                  }))}
                  agents={agentOptions}
                  orgSlug={org.slug}
                />
              )}
              walletForm={(
                <WalletProvider>
                  <DelegateToAgent
                    agentWallets={agentWallets.map((wallet) => ({
                      agentId: wallet.agentId,
                      chain: wallet.chain,
                      status: wallet.status,
                    }))}
                    agents={agentOptions}
                    orgSlug={org.slug}
                  />
                </WalletProvider>
              )}
            />
          )}
        />
      </TreasuryWorkbench>
  );
}
