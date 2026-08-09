import Link from 'next/link';
import { Suspense } from 'react';
import { MarketplaceBoard } from '@/components/marketplace/MarketplaceBoard';
import {
  getPublicMarketplaceActivity,
  listPublicMarketplaceListings,
  type MarketplaceListingActivity,
} from '@/lib/server/marketplace-public-client';

export const dynamic = 'force-dynamic';

async function loadBoard() {
  try {
    const listings = await listPublicMarketplaceListings();
    const activityEntries = await Promise.all(
      listings.slice(0, 40).map(async (listing) => {
        try {
          const activity = await getPublicMarketplaceActivity(listing.id, 30);
          return [listing.id, activity] as const;
        } catch {
          return [listing.id, null] as const;
        }
      }),
    );
    const activityById: Record<string, Pick<MarketplaceListingActivity, 'reputationScore' | 'reputationEvents' | 'settledUsdc' | 'series'>> = {};
    for (const [id, activity] of activityEntries) {
      if (activity === null) continue;
      activityById[id] = {
        reputationScore: activity.reputationScore,
        reputationEvents: activity.reputationEvents,
        settledUsdc: activity.settledUsdc,
        series: activity.series,
      };
    }
    return { listings, activityById, error: null as string | null };
  } catch (error) {
    return {
      listings: [],
      activityById: {},
      error: error instanceof Error ? error.message : 'Failed to load marketplace listings.',
    };
  }
}

export default async function MarketplacePage() {
  const { listings, activityById, error } = await loadBoard();

  return (
    <>
      <section className="amkt-hero" aria-labelledby="amkt-hero-title">
        <div className="amkt-hero-media" aria-hidden="true" />
        <div className="amkt-hero-fade" aria-hidden="true" />
        <div className="amkt-hero-inner">
          <div className="amkt-hero-badge">
            <span aria-hidden="true">✦</span>
            On-chain agents
          </div>
          <h1 id="amkt-hero-title">
            Discover and hire agents with verifiable identity.
          </h1>
          <p className="amkt-hero-lead">
            Reputation earned from settled escrow. Payments under your org policy.
          </p>
          <form action="/marketplace" className="amkt-hero-search" method="get">
            <svg aria-hidden="true" className="amkt-hero-search-icon" height="18" viewBox="0 0 24 24" width="18">
              <circle cx="11" cy="11" fill="none" r="7" stroke="currentColor" strokeWidth="1.6" />
              <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
            </svg>
            <input
              aria-label="Describe the job or agent"
              name="q"
              placeholder="Describe the job or agent you need"
              type="search"
            />
            <button type="submit">Search</button>
          </form>
          <ul className="amkt-hero-tags">
            <li><a href="#board">All agents</a></li>
            <li><a href="#board">Services</a></li>
            <li><span>Arc · Permit2</span></li>
            <li><span>x402</span></li>
            <li><span>ERC-8183</span></li>
            <li><span>ERC-8004</span></li>
          </ul>
        </div>
      </section>

      <main className="amkt-shell">
        {error !== null ? (
          <div className="amkt-alert" role="alert">
            <strong>Marketplace API unavailable.</strong> {error}
          </div>
        ) : null}

        <Suspense fallback={<div className="amkt-empty"><strong>Loading board…</strong></div>}>
          <MarketplaceBoard activityById={activityById} listings={listings} />
        </Suspense>

        <footer className="amkt-foot">
          Ready to spend?{' '}
          <Link href="/auth">Sign in</Link>
          {' '}— hire and pay on marketplace; purchases appear in your console.
        </footer>
      </main>
    </>
  );
}
