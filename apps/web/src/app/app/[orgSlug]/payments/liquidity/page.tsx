import { redirect } from 'next/navigation';
import { TreasuryLiquidity } from '@/components/payments/TreasuryLiquidity';
import {
  bridgeExactWalletTopUpAction,
  cancelLiquidityJobAction,
  reconcileCircleProviderJobsAction,
  retryLiquidityJobAction,
} from '@/app/actions/payments';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listLiquidityJobs, listPaymentCapabilities, listRebalanceRecommendations, readProviderHealth } from '@/lib/server/payments-client';

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

  const [liquidityJobs, rebalanceRecommendations, capabilities, providerHealth] = await Promise.all([
    listLiquidityJobs(org.id),
    listRebalanceRecommendations(org.id),
    listPaymentCapabilities(org.id),
    readProviderHealth(org.id),
  ]);
  const providerState = providerHealth.status === 'unavailable'
    ? 'unavailable'
    : providerHealth.value.configured
      ? 'ready'
      : 'disconnected';

  return (
      <TreasuryLiquidity
        bridgeTopUpAction={bridgeExactWalletTopUpAction.bind(null, org.id, org.slug)}
        cancelLiquidityJobAction={cancelLiquidityJobAction.bind(null, org.id, org.slug)}
        capabilities={capabilities}
        liquidityJobs={liquidityJobs}
        orgSlug={org.slug}
        providerState={providerState}
        reconcileJobsAction={reconcileCircleProviderJobsAction.bind(null, org.id, org.slug)}
        rebalanceRecommendations={rebalanceRecommendations}
        retryLiquidityJobAction={retryLiquidityJobAction.bind(null, org.id, org.slug)}
      />
  );
}
