import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { TreasuryOverview } from '@/components/payments/TreasuryOverview';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';
import {
  getProviderMode,
  getPaymentsConsoleSnapshot,
  listAgentPaymentAccounts,
  listCircleProviderJobs,
  listPaymentRailReadiness,
  listPaymentReservations,
  readCircleConnection,
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

  const [circleConnection, paymentMode, railReadiness, agentAccounts, recentJobs, reservations, snapshot, agents] = await Promise.all([
    readCircleConnection(org.id),
    getProviderMode(org.id),
    listPaymentRailReadiness(org.id),
    listAgentPaymentAccounts(org.id),
    listCircleProviderJobs(org.id),
    listPaymentReservations(org.id, 25),
    getPaymentsConsoleSnapshot(org.id),
    listAgents(org.id),
  ]);

  const failedJobs = recentJobs.filter((job) => job.status === 'failed');
  const pendingReservations = reservations.filter((reservation) => reservation.status === 'reserved').length;

  return (
    <ConsoleShell active="payments" org={org}>
      <TreasuryOverview
        accounts={agentAccounts.accounts}
        agents={agents}
        balances={snapshot.balances}
        circleConnectionState={circleConnection.status === 'unavailable' ? 'unavailable' : circleConnection.value.status === 'connected' ? 'connected' : 'disconnected'}
        failedJobs={failedJobs}
        orgSlug={org.slug}
        overview={snapshot.overview}
        paymentMode={paymentMode}
        pendingReservations={pendingReservations}
        railReadiness={railReadiness}
      />
    </ConsoleShell>
  );
}
