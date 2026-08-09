import { redirect } from 'next/navigation';
import { FleetRunWorkspace } from '@/components/fleet-run/FleetRunWorkspace';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { getCanonicalFleetGoal, listFleetRuns } from '@/lib/server/fleet-run-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type FleetRunPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function FleetRunPage({ params }: FleetRunPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [canonical, runs] = await Promise.all([
    getCanonicalFleetGoal(org.id).catch(() => ({
      goal: 'Research brief on Arc agent-to-agent USDC payments. Hire DataFetcher, Analyst, Writer, and Base SeniorReviewer. Return brief plus receipts.',
      checklist: [],
    })),
    listFleetRuns(org.id).catch(() => []),
  ]);

  return (
    <FleetRunWorkspace
      canonicalGoal={canonical.goal}
      initialRuns={runs}
      orgId={org.id}
      orgSlug={org.slug}
    />
  );
}
