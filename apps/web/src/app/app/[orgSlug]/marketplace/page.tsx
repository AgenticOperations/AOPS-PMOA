import { redirect } from 'next/navigation';
import {
  authorizeMarketplaceDestinationAction,
  hireMarketplaceEscrowAction,
  hireMarketplaceX402Action,
} from '@/app/actions/payments';
import { MarketplaceBrowse } from '@/components/marketplace/MarketplaceBrowse';
import { PurchasedMarketplaceView } from '@/components/marketplace/PurchasedMarketplaceView';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';
import { listEscrowJobs, listMarketplaceListings } from '@/lib/server/payments-client';

export const dynamic = 'force-dynamic';

type MarketplacePageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
  readonly searchParams: Promise<{ readonly listing?: string | undefined }>;
};

export default async function MarketplacePurchasesPage({ params, searchParams }: MarketplacePageProps) {
  const { orgSlug } = await params;
  const query = await searchParams;

  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const listings = await listMarketplaceListings(org.id).catch(() => []);
  const hireListingId = query.listing !== undefined && listings.some((item) => item.id === query.listing)
    ? query.listing
    : null;

  // Hire deep-link from public marketplace — keep the payment form under org policy.
  if (hireListingId !== null) {
    const agents = await listAgents(org.id).catch(() => []);
    const authorizedAddresses = new Set(
      listings
        .filter((listing) => listing.destinationAuthorized === true && listing.providerAddress !== null)
        .map((listing) => `${listing.chain}:${listing.providerAddress!.toLowerCase()}`),
    );

    return (
      <MarketplaceBrowse
        authorizeAction={authorizeMarketplaceDestinationAction.bind(null, org.id, org.slug)}
        authorizedAddresses={authorizedAddresses}
        buyerOrgId={org.id}
        clients={agents
          .filter((agent) => agent.status !== 'deactivated')
          .map((agent) => ({ id: agent.id, name: agent.name }))}
        hireEscrowAction={hireMarketplaceEscrowAction.bind(null, org.id, org.slug)}
        hireX402Action={hireMarketplaceX402Action.bind(null, org.id, org.slug)}
        initialListingId={hireListingId}
        listings={listings}
        orgSlug={org.slug}
      />
    );
  }

  const jobs = await listEscrowJobs(org.id).catch(() => []);

  return (
    <PurchasedMarketplaceView
      jobs={jobs}
      listings={listings}
      orgSlug={org.slug}
    />
  );
}
