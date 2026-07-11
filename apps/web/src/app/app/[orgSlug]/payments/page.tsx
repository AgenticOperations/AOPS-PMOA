import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { OrgAuditPanel } from '@/components/audit/OrgAuditPanel';
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
  verifyPaymentRailAction,
  verifyUnverifiedPaymentRailsAction,
} from '@/app/actions/payments';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';
import { listAuditEvents } from '@/lib/server/audit-client';
import {
  getAgentPayments,
  getProviderHealth,
  getProviderMode,
  getPaymentsConsoleSnapshot,
  listCircleProviderJobs,
  listLiquidityJobs,
  listCircleWallets,
  listPaymentCapabilities,
  listPaymentEvents,
  listPaymentRailReadiness,
  listPaymentReservations,
  listPaymentRouteObservations,
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
    paymentEvents,
    routeObservations,
    paymentReservations,
    railReadiness,
    auditEvents,
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
    listPaymentEvents(org.id, 25),
    listPaymentRouteObservations(org.id, 25),
    listPaymentReservations(org.id, 25),
    listPaymentRailReadiness(org.id),
    listAuditEvents(org.id, 40),
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
        paymentEvents={paymentEvents}
        paymentMode={paymentMode}
        paymentReservations={paymentReservations}
        providerHealth={providerHealth}
        railReadiness={railReadiness}
        rebalanceRecommendations={paymentsSnapshot.rebalanceRecommendations}
        reconcileJobsAction={reconcileCircleProviderJobsAction.bind(null, org.id, org.slug)}
        routeObservations={routeObservations}
        retryLiquidityJobAction={retryLiquidityJobAction.bind(null, org.id, org.slug)}
        verifyRailAction={verifyPaymentRailAction.bind(null, org.id, org.slug)}
        verifyUnverifiedRailsAction={verifyUnverifiedPaymentRailsAction.bind(null, org.id, org.slug)}
        testnetFundsAction={requestTestnetFundsAction.bind(null, org.id, org.slug)}
        liquidityJobs={liquidityJobs}
        sourceAction={createGatewaySourceAction.bind(null, org.id, org.slug)}
        sources={sources}
        treasuries={treasuries}
        treasuryOverview={paymentsSnapshot.overview}
        treasuryAction={createTreasuryAction.bind(null, org.id, org.slug)}
      />
      <OrgAuditPanel
        description="Treasury setup, wallet funding, liquidity jobs, route decisions, and payment settlement evidence."
        domains={['payment', 'treasury', 'wallet']}
        events={auditEvents.events}
        title="Payment activity"
      />
    </ConsoleShell>
  );
}
