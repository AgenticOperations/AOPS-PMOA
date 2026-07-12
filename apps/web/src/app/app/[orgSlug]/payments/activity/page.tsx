import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { TreasuryActivity } from '@/components/payments/TreasuryActivity';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listAuditEvents } from '@/lib/server/audit-client';
import {
  listCircleProviderJobs,
  listPaymentEvents,
  listPaymentReservations,
  listPaymentRouteObservations,
} from '@/lib/server/payments-client';

export const dynamic = 'force-dynamic';

type ActivityPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function PaymentsActivityPage({ params }: ActivityPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [paymentEvents, routeObservations, reservations, providerJobs, auditEvents] = await Promise.all([
    listPaymentEvents(org.id, 50),
    listPaymentRouteObservations(org.id, 50),
    listPaymentReservations(org.id, 50),
    listCircleProviderJobs(org.id),
    listAuditEvents(org.id, 40),
  ]);

  return (
    <ConsoleShell active="payments" org={org}>
      <TreasuryActivity
        auditEvents={auditEvents.events}
        paymentEvents={paymentEvents}
        providerJobs={providerJobs}
        reservations={reservations}
        routeObservations={routeObservations}
      />
    </ConsoleShell>
  );
}
