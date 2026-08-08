import Link from 'next/link';
import type { MarketplaceListingActivity, PublicMarketplaceListing } from '@/lib/server/marketplace-public-client';
import { MarketplaceActivityChart } from './MarketplaceActivityChart';

type MarketplaceDetailViewProps = {
  readonly listing: PublicMarketplaceListing;
  readonly activity: MarketplaceListingActivity;
  readonly hireHref: string;
  readonly signedIn: boolean;
};

function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function formatUsdc(value: string): string {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount) || amount === 0) return '—';
  return `$${amount.toFixed(2)}`;
}

export function MarketplaceDetailView({
  listing,
  activity,
  hireHref,
  signedIn,
}: MarketplaceDetailViewProps) {
  return (
    <div className="amkt-detail">
      <nav className="amkt-detail-crumb" aria-label="Breadcrumb">
        <Link href="/marketplace">Marketplace</Link>
        <span aria-hidden="true">/</span>
        <span>{listing.name}</span>
      </nav>

      <header className="amkt-detail-hero">
        <div className="amkt-detail-identity">
          <span className={`amkt-mark is-lg is-${listing.kind}`} aria-hidden="true">
            {listing.kind === 'agent' ? listing.name.slice(0, 1).toUpperCase() : '◇'}
          </span>
          <div>
            <div className="amkt-detail-title-row">
              <h1>{listing.name}</h1>
              <span className="amkt-status-pill">
                <i aria-hidden="true" />
                {listing.identityStatus === 'registered' ? 'Identity registered' : 'Open for hire'}
              </span>
            </div>
            <p className="amkt-detail-desc">{listing.description}</p>
            <div className="amkt-detail-badges">
              <span className="amkt-chip is-chain">{listing.chain}</span>
              {listing.rails.map((rail) => (
                <span className="amkt-chip" key={rail}>{rail}</span>
              ))}
              {listing.identityTokenId !== null ? (
                <span className="amkt-chip is-id">ERC-8004 #{listing.identityTokenId}</span>
              ) : (
                <span className="amkt-chip is-muted">Unregistered</span>
              )}
            </div>
          </div>
        </div>

        <div className="amkt-detail-score">
          <span>Reputation</span>
          <strong>{activity.reputationScore}</strong>
          <small>{activity.completedJobs} completed · {formatUsdc(activity.settledUsdc)} settled</small>
        </div>
      </header>

      <div className="amkt-detail-layout">
        <div className="amkt-detail-main">
          <MarketplaceActivityChart activity={activity} />

          <section className="amkt-about">
            <h2>About</h2>
            <p>{listing.description}</p>
            <dl className="amkt-about-rows">
              <div>
                <dt>Endpoint</dt>
                <dd>
                  <a href={listing.endpointUrl} rel="noreferrer" target="_blank">
                    {hostOf(listing.endpointUrl)}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Payee</dt>
                <dd className="amkt-mono">{listing.providerAddress ?? 'Resolved at payment'}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>
                  <span className="amkt-chip">{listing.category}</span>
                  <span className="amkt-chip">{listing.kind}</span>
                </dd>
              </div>
              <div>
                <dt>Quote hint</dt>
                <dd>{listing.priceHint ?? 'Quote on hire'}</dd>
              </div>
              <div>
                <dt>Supported rails</dt>
                <dd className="amkt-rails">
                  {listing.rails.map((rail) => (
                    <span className="amkt-chip" key={rail}>{rail}</span>
                  ))}
                </dd>
              </div>
              <div>
                <dt>Chain</dt>
                <dd><span className="amkt-chip is-chain">{listing.chain}</span></dd>
              </div>
            </dl>
          </section>

          <section className="amkt-about">
            <h2>Statistics</h2>
            <div className="amkt-stats-grid">
              <div>
                <h3>Reputation</h3>
                <ul>
                  <li><span>Score</span><strong>{activity.reputationScore}</strong></li>
                  <li><span>Events</span><strong>{activity.reputationEvents}</strong></li>
                </ul>
              </div>
              <div>
                <h3>Settlement</h3>
                <ul>
                  <li><span>Completed</span><strong>{activity.completedJobs}</strong></li>
                  <li><span>Rejected / expired</span><strong>{activity.rejectedJobs}</strong></li>
                  <li><span>Settled USDC</span><strong>{formatUsdc(activity.settledUsdc)}</strong></li>
                </ul>
              </div>
            </div>
          </section>
        </div>

        <aside className="amkt-hire-panel" aria-label="Hire">
          <div className="amkt-hire-panel-head">
            <p className="amkt-eyebrow">Hire</p>
            <h2>{listing.name}</h2>
          </div>
          <p className="amkt-hire-copy">
            Same-org fleet uses Permit2. Cross-org uses x402 or escrow after payTo authorize.
          </p>
          <ul className="amkt-hire-facts">
            <li><span>Rails</span><strong>{listing.rails.join(' · ')}</strong></li>
            <li><span>Chain</span><strong>{listing.chain}</strong></li>
            <li><span>Reputation</span><strong>{activity.reputationScore}</strong></li>
            <li><span>Settled</span><strong>{formatUsdc(activity.settledUsdc)}</strong></li>
          </ul>
          <Link className="amkt-hire-cta" href={hireHref}>
            {signedIn ? 'Hire now' : 'Sign in to hire'}
          </Link>
          <p className="amkt-hire-note">
            Payment runs under your org policy, budget, and kill switch. Purchases show in your console.
          </p>
        </aside>
      </div>
    </div>
  );
}
