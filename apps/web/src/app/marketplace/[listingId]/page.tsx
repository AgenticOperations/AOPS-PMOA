import { notFound } from 'next/navigation';
import {
  authorizeMarketplaceDestinationAction,
  hireMarketplaceEscrowAction,
  hireMarketplaceX402Action,
} from '@/app/actions/payments';
import { MarketplaceDetailView } from '@/components/marketplace/MarketplaceDetailView';
import {
  getPublicMarketplaceActivity,
  getPublicMarketplaceListing,
  MarketplacePublicApiError,
} from '@/lib/server/marketplace-public-client';
import { getCurrentSession, listAgents, listOrgs } from '@/lib/server/identity-spine-client';
import { getMarketplaceListing } from '@/lib/server/payments-client';

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
    recentEvents: [],
  }));

  const session = await getCurrentSession().catch(() => null);
  const orgs = session === null ? [] : await listOrgs().catch(() => []);
  const primaryOrg = orgs[0];
  const signInHref = `/auth?next=${encodeURIComponent(`/marketplace/${encodeURIComponent(listing.id)}`)}`;

  if (primaryOrg === undefined) {
    return (
      <main className="amkt-shell">
        <MarketplaceDetailView
          activity={activity}
          listing={listing}
          signInHref={signInHref}
          signedIn={false}
        />
      </main>
    );
  }

  const [hireContext, agents] = await Promise.all([
    getMarketplaceListing(primaryOrg.id, listing.id).catch(() => null),
    listAgents(primaryOrg.id).catch(() => []),
  ]);

  const hireListing = hireContext === null
    ? null
    : {
        ...hireContext.listing,
        destinationAuthorized: hireContext.destination_authorized,
      };

  return (
    <main className="amkt-shell">
      <MarketplaceDetailView
        activity={activity}
        authorizeAction={authorizeMarketplaceDestinationAction.bind(null, primaryOrg.id, primaryOrg.slug)}
        buyerOrgId={primaryOrg.id}
        clients={agents
          .filter((agent) => agent.status !== 'deactivated')
          .map((agent) => ({ id: agent.id, name: agent.name }))}
        hireEscrowAction={hireMarketplaceEscrowAction.bind(null, primaryOrg.id, primaryOrg.slug)}
        hireListing={hireListing}
        hireX402Action={hireMarketplaceX402Action.bind(null, primaryOrg.id, primaryOrg.slug)}
        listing={listing}
        orgSlug={primaryOrg.slug}
        signInHref={signInHref}
        signedIn
      />
    </main>
  );
}
