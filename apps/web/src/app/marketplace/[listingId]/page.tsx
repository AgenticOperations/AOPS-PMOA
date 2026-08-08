import { notFound } from 'next/navigation';
import { MarketplaceDetailView } from '@/components/marketplace/MarketplaceDetailView';
import {
  getPublicMarketplaceActivity,
  getPublicMarketplaceListing,
  MarketplacePublicApiError,
} from '@/lib/server/marketplace-public-client';
import { getCurrentSession, listOrgs } from '@/lib/server/identity-spine-client';

export const dynamic = 'force-dynamic';

type MarketplaceDetailPageProps = {
  readonly params: Promise<{ readonly listingId: string }>;
};

export default async function MarketplaceDetailPage({ params }: MarketplaceDetailPageProps) {
  const { listingId } = await params;

  let listing;
  try {
    listing = await getPublicMarketplaceListing(listingId);
  } catch (error) {
    if (error instanceof MarketplacePublicApiError && error.status === 404) notFound();
    throw error;
  }

  const activity = await getPublicMarketplaceActivity(listing.id, 90).catch(() => ({
    listingId: listing.id,
    agentId: listing.agentId,
    providerAddress: listing.providerAddress,
    reputationScore: 0,
    reputationEvents: 0,
    completedJobs: 0,
    rejectedJobs: 0,
    settledUsdc: '0.000000',
    series: [],
  }));

  const session = await getCurrentSession().catch(() => null);
  const orgs = session === null ? [] : await listOrgs().catch(() => []);
  const primaryOrg = orgs[0];
  const hireHref = primaryOrg === undefined
    ? `/auth?next=${encodeURIComponent(`/marketplace/${encodeURIComponent(listing.id)}`)}`
    : `/app/${primaryOrg.slug}/marketplace?listing=${encodeURIComponent(listing.id)}`;

  return (
    <main className="amkt-shell">
      <MarketplaceDetailView
        activity={activity}
        hireHref={hireHref}
        listing={listing}
        signedIn={session !== null && primaryOrg !== undefined}
      />
    </main>
  );
}
