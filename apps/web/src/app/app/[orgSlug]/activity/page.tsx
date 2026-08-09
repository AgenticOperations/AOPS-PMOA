import { redirect } from 'next/navigation';
import { OrgActivityWorkbench, type OrgActivityTab } from '@/components/activity/OrgActivityWorkbench';
import { listApprovals } from '@/lib/server/approval-client';
import { listAuditEvents } from '@/lib/server/audit-client';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listOperationDecisions } from '@/lib/server/operations-client';
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

const activityTabs: readonly OrgActivityTab[] = [
  'payments',
  'routing',
  'reservations',
  'jobs',
  'escrow',
  'audit',
  'decisions',
  'approvals',
  'policy',
];

export default async function OrgActivityPage({ params, searchParams }: ActivityPageProps) {
  const { orgSlug } = await params;
  const query = (await searchParams) ?? {};
  const tabValue = typeof query.tab === 'string' ? query.tab : query.tab?.[0];
  const activeTab = activityTabs.includes(tabValue as OrgActivityTab)
    ? tabValue as OrgActivityTab
    : 'payments';

  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [
    paymentEvents,
    routeObservations,
    reservations,
    providerJobs,
    escrowJobs,
    auditEvents,
    decisions,
    approvalsList,
  ] = await Promise.all([
    listPaymentEvents(org.id, 50),
    listPaymentRouteObservations(org.id, 50),
    listPaymentReservations(org.id, 50),
    listCircleProviderJobs(org.id),
    listEscrowJobs(org.id).catch(() => []),
    listAuditEvents(org.id, 60),
    listOperationDecisions(org.id, { limit: 100 }).catch(() => []),
    listApprovals(org.id).catch(() => ({ approvals: [] })),
  ]);

  return (
    <OrgActivityWorkbench
      activeTab={activeTab}
      approvals={approvalsList.approvals}
      auditEvents={auditEvents.events}
      decisions={decisions}
      escrowJobs={escrowJobs}
      orgSlug={org.slug}
      paymentEvents={paymentEvents}
      providerJobs={providerJobs}
      reservations={reservations}
      routeObservations={routeObservations}
    />
  );
}
