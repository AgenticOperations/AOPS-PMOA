import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { TreasuryOverview } from '@/components/payments/TreasuryOverview';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import {
  getCircleConnection,
  getProviderMode,
  listAgentPaymentAccounts,
  listCircleProviderJobs,
  listPaymentRailReadiness,
  listPaymentReservations,
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

  const [circleConnection, paymentMode, railReadiness, agentAccounts, recentJobs, reservations] = await Promise.all([
    getCircleConnection(org.id),
    getProviderMode(org.id),
    listPaymentRailReadiness(org.id),
    listAgentPaymentAccounts(org.id),
    listCircleProviderJobs(org.id),
    listPaymentReservations(org.id, 25),
  ]);

  const agentsWithAccess = agentAccounts.accounts.filter(
    (account) => account.payment_access && account.status === 'active',
  ).length;
  const failedJobs = recentJobs.filter((job) => job.status === 'failed');
  const pendingReservations = reservations.filter((reservation) => reservation.status === 'reserved').length;

  return (
    <ConsoleShell active="payments" org={org}>
      <TreasuryOverview
        agentsWithAccess={agentsWithAccess}
        circleConnected={circleConnection.status === 'connected'}
        failedJobs={failedJobs}
        orgId={org.id}
        orgSlug={org.slug}
        paymentMode={paymentMode}
        pendingReservations={pendingReservations}
        railReadiness={railReadiness}
      />
    </ConsoleShell>
  );
}
