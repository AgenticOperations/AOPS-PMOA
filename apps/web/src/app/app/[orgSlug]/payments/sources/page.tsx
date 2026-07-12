import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { TreasurySourcesRails } from '@/components/payments/TreasurySourcesRails';
import {
  createCircleTreasuryAction,
  initiateGatewayDepositAction,
  requestTestnetFundsAction,
  verifyPaymentRailAction,
  verifyUnverifiedPaymentRailsAction,
} from '@/app/actions/payments';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import {
  getProviderMode,
  listCircleWallets,
  listPaymentCapabilities,
  listPaymentRailReadiness,
  listPaymentSources,
  readProviderHealth,
} from '@/lib/server/payments-client';

export const dynamic = 'force-dynamic';

type SourcesPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function PaymentsSourcesPage({ params }: SourcesPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [sources, paymentMode, providerHealth, capabilities, circleWallets, railReadiness] = await Promise.all([
    listPaymentSources(org.id),
    getProviderMode(org.id),
    readProviderHealth(org.id),
    listPaymentCapabilities(org.id),
    listCircleWallets(org.id),
    listPaymentRailReadiness(org.id),
  ]);

  return (
    <ConsoleShell active="payments" org={org}>
      <TreasurySourcesRails
        capabilities={capabilities}
        circleTreasuryAction={createCircleTreasuryAction.bind(null, org.id, org.slug)}
        circleWallets={circleWallets}
        gatewayDepositAction={initiateGatewayDepositAction.bind(null, org.id, org.slug)}
        orgId={org.id}
        orgSlug={org.slug}
        paymentMode={paymentMode}
        providerHealth={providerHealth.value}
        providerHealthAvailable={providerHealth.status === 'available'}
        railReadiness={railReadiness}
        sources={sources}
        testnetFundsAction={requestTestnetFundsAction.bind(null, org.id, org.slug)}
        verifyRailAction={verifyPaymentRailAction.bind(null, org.id, org.slug)}
        verifyUnverifiedRailsAction={verifyUnverifiedPaymentRailsAction.bind(null, org.id, org.slug)}
      />
    </ConsoleShell>
  );
}
