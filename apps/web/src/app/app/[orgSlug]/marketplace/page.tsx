import { redirect } from 'next/navigation';
import { PurchasedMarketplaceView } from '@/components/marketplace/PurchasedMarketplaceView';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
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

  // Old hire desk deep-links now complete on the public marketplace.
  if (query.listing !== undefined && query.listing.length > 0) {
    redirect(`/marketplace/${encodeURIComponent(query.listing)}`);
  }

  const [jobs, listings] = await Promise.all([
    listEscrowJobs(org.id).catch(() => []),
    listMarketplaceListings(org.id).catch(() => []),
  ]);

  return (
    <PurchasedMarketplaceView
      jobs={jobs}
      listings={listings}
      orgSlug={org.slug}
    />
  );
}
