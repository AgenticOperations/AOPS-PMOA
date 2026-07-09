import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { PaymentsWorkbench } from '@/components/payments/PaymentsWorkbench';
import {
  bridgeExactWalletTopUpAction,
  cancelLiquidityJobAction,
  createCircleTreasuryAction,
  createGatewaySourceAction,
  createTreasuryAction,
  initiateGatewayDepositAction,
  reconcileCircleProviderJobsAction,
  requestTestnetFundsAction,
  retryLiquidityJobAction,
  setProviderModeAction,
  setAgentPaymentAccessAction,
} from '@/app/actions/payments';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';
import {
  getAgentPayments,
  getProviderHealth,
  getProviderMode,
  getPaymentsConsoleSnapshot,
  listCircleProviderJobs,
  listLiquidityJobs,
  listCircleWallets,
  listPaymentCapabilities,
  listPaymentSources,
  listTreasuries,
} from '@/lib/server/payments-client';

export const dynamic = 'force-dynamic';

type PaymentsPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function PaymentsPage({ params }: PaymentsPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [
    agents,
    sources,
    treasuries,
    paymentMode,
    providerHealth,
    capabilities,
    circleWallets,
    paymentsSnapshot,
    circleJobs,
    liquidityJobs,
  ] = await Promise.all([
    listAgents(org.id),
    listPaymentSources(org.id),
    listTreasuries(org.id),
    getProviderMode(org.id),
    getProviderHealth(org.id),
    listPaymentCapabilities(org.id),
    listCircleWallets(org.id),
    getPaymentsConsoleSnapshot(org.id),
    listCircleProviderJobs(org.id),
    listLiquidityJobs(org.id),
  ]);
  const agentPayments = await Promise.all(
    agents.map(async (agent) => ({
      agent,
      account: (await getAgentPayments(org.id, agent.id)).account,
    })),
  );

  return (
    <ConsoleShell active="payments" org={org}>
      <PaymentsWorkbench
        accessAction={setAgentPaymentAccessAction.bind(null, org.id, org.slug)}
        agents={agents}
        agentPayments={agentPayments}
        capabilities={capabilities}
        bridgeTopUpAction={bridgeExactWalletTopUpAction.bind(null, org.id, org.slug)}
        cancelLiquidityJobAction={cancelLiquidityJobAction.bind(null, org.id, org.slug)}
        circleTreasuryAction={createCircleTreasuryAction.bind(null, org.id, org.slug)}
        circleBalances={paymentsSnapshot.balances}
        circleJobs={circleJobs}
        circleWallets={circleWallets}
        gatewayDepositAction={initiateGatewayDepositAction.bind(null, org.id, org.slug)}
        modeAction={setProviderModeAction.bind(null, org.id, org.slug)}
        paymentMode={paymentMode}
        providerHealth={providerHealth}
        rebalanceRecommendations={paymentsSnapshot.rebalanceRecommendations}
        reconcileJobsAction={reconcileCircleProviderJobsAction.bind(null, org.id, org.slug)}
        retryLiquidityJobAction={retryLiquidityJobAction.bind(null, org.id, org.slug)}
        testnetFundsAction={requestTestnetFundsAction.bind(null, org.id, org.slug)}
        liquidityJobs={liquidityJobs}
        sourceAction={createGatewaySourceAction.bind(null, org.id, org.slug)}
        sources={sources}
        treasuries={treasuries}
        treasuryOverview={paymentsSnapshot.overview}
        treasuryAction={createTreasuryAction.bind(null, org.id, org.slug)}
      />
    </ConsoleShell>
  );
}
