import type { ApprovalRecord } from '@/lib/approval-types';
import type { AuditEventRecord } from '@/lib/audit-types';
import type { AgentRosterItem } from '@/lib/identity-spine-types';
import type { TreasuryOverviewRecord } from '@/lib/payments-types';

export const overviewHomeQueryKey = (orgSlug: string) =>
  ['console', 'overview', orgSlug] as const;

export type OverviewHomeData = {
  readonly agents: readonly AgentRosterItem[];
  readonly org: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly pendingApprovals: readonly ApprovalRecord[];
  readonly recentEvidence: readonly AuditEventRecord[];
  readonly treasuryOverview: TreasuryOverviewRecord | null;
};

export async function fetchOverviewHome(orgSlug: string): Promise<OverviewHomeData> {
  const response = await fetch(`/api/app/${encodeURIComponent(orgSlug)}/overview`, {
    credentials: 'same-origin',
  });
  if (!response.ok) {
    let message = `Overview failed with ${response.status}`;
    try {
      const body = (await response.json()) as { readonly message?: string };
      if (typeof body.message === 'string' && body.message.length > 0) {
        message = body.message;
      }
    } catch {
      // keep status message
    }
    throw new Error(message);
  }
  return (await response.json()) as OverviewHomeData;
}
