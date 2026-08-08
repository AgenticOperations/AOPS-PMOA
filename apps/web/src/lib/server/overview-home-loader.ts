import 'server-only';
import { listApprovals } from '@/lib/server/approval-client';
import { listAuditEvents } from '@/lib/server/audit-client';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';
import { getTreasuryOverview } from '@/lib/server/payments-client';
import type { OverviewHomeData } from '@/lib/overview-home';

export async function loadOverviewHome(orgSlug: string): Promise<OverviewHomeData> {
  const org = await getOrgBySlug(orgSlug);
  const [agents, approvalList, auditList, treasuryOverview] = await Promise.all([
    listAgents(org.id),
    listApprovals(org.id),
    listAuditEvents(org.id, 8),
    getTreasuryOverview(org.id).catch(() => null),
  ]);

  return {
    org: { id: org.id, name: org.name, slug: org.slug },
    agents,
    pendingApprovals: approvalList.approvals.filter((approval) => approval.status === 'pending'),
    recentEvidence: auditList.events.slice(0, 4),
    treasuryOverview,
  };
}
