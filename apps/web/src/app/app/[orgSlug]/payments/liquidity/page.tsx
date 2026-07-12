import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { TreasuryLiquidity } from '@/components/payments/TreasuryLiquidity';
import {
  bridgeExactWalletTopUpAction,
  cancelLiquidityJobAction,
  reconcileCircleProviderJobsAction,
  retryLiquidityJobAction,
} from '@/app/actions/payments';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listLiquidityJobs, listPaymentCapabilities, listRebalanceRecommendations } from '@/lib/server/payments-client';

export const dynamic = 'force-dynamic';

type LiquidityPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function PaymentsLiquidityPage({ params }: LiquidityPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [liquidityJobs, rebalanceRecommendations, capabilities] = await Promise.all([
    listLiquidityJobs(org.id),
    listRebalanceRecommendations(org.id),
    listPaymentCapabilities(org.id),
  ]);

  return (
    <ConsoleShell active="payments" org={org}>
      <TreasuryLiquidity
        bridgeTopUpAction={bridgeExactWalletTopUpAction.bind(null, org.id, org.slug)}
        cancelLiquidityJobAction={cancelLiquidityJobAction.bind(null, org.id, org.slug)}
        capabilities={capabilities}
        liquidityJobs={liquidityJobs}
        reconcileJobsAction={reconcileCircleProviderJobsAction.bind(null, org.id, org.slug)}
        rebalanceRecommendations={rebalanceRecommendations}
        retryLiquidityJobAction={retryLiquidityJobAction.bind(null, org.id, org.slug)}
      />
    </ConsoleShell>
  );
}
