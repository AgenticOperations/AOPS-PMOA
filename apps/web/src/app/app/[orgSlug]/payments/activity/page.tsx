import { redirect } from 'next/navigation';
import { TreasuryActivity, type TreasuryActivityTab } from '@/components/payments/TreasuryActivity';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listAuditEvents } from '@/lib/server/audit-client';
import {
  listCircleProviderJobs,
  listEscrowJobs,
  listPaymentEvents,
  listPaymentReservations,
  listPaymentRouteObservations,
} from '@/lib/server/payments-client';

export const dynamic = 'force-dynamic';

type ActivityPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
  readonly searchParams?: Promise<Record<string, string | readonly string[] | undefined>>;
};

const activityTabs: readonly TreasuryActivityTab[] = ['payments', 'routing', 'reservations', 'jobs', 'escrow', 'audit'];

export default async function PaymentsActivityPage({ params, searchParams }: ActivityPageProps) {
  const { orgSlug } = await params;
  const query = (await searchParams) ?? {};
  const tabValue = typeof query.tab === 'string' ? query.tab : query.tab?.[0];
  const activeTab = activityTabs.includes(tabValue as TreasuryActivityTab) ? tabValue as TreasuryActivityTab : 'payments';
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [paymentEvents, routeObservations, reservations, providerJobs, escrowJobs, auditEvents] = await Promise.all([
    listPaymentEvents(org.id, 50),
    listPaymentRouteObservations(org.id, 50),
    listPaymentReservations(org.id, 50),
    listCircleProviderJobs(org.id),
    listEscrowJobs(org.id).catch(() => []),
    listAuditEvents(org.id, 40),
  ]);

  return (
      <TreasuryActivity
        activeTab={activeTab}
        auditEvents={auditEvents.events}
        escrowJobs={escrowJobs}
        orgSlug={org.slug}
        paymentEvents={paymentEvents}
        providerJobs={providerJobs}
        reservations={reservations}
        routeObservations={routeObservations}
      />
  );
}
