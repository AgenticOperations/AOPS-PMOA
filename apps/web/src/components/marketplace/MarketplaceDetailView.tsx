import Link from 'next/link';
import type { ReactNode } from 'react';
import type { MarketplaceHireActionState } from '@/app/actions/payments';
import type { MarketplaceListingActivity, PublicMarketplaceListing } from '@/lib/server/marketplace-public-client';
import type { MarketplaceListingRecord } from '@/lib/server/payments-client';
import { MarketplaceActivityChart } from './MarketplaceActivityChart';
import { MarketplaceChainChip, MarketplaceListingMark } from './MarketplaceMarks';
import { MarketplaceHirePanel } from './MarketplaceHirePanel';
import { REPUTATION_HINT } from '@/components/agents/ReputationDisplay';

type HireClient = { readonly id: string; readonly name: string };

type MarketplaceDetailViewProps = {
  readonly listing: PublicMarketplaceListing;
  readonly activity: MarketplaceListingActivity;
  readonly signedIn: boolean;
  readonly signInHref: string;
  readonly hireListing?: MarketplaceListingRecord | null | undefined;
  readonly orgSlug?: string | null | undefined;
  readonly buyerOrgId?: string | null | undefined;
  readonly clients?: readonly HireClient[] | undefined;
  readonly authorizeAction?: ((formData: FormData) => Promise<MarketplaceHireActionState>) | undefined;
  readonly hireX402Action?: ((formData: FormData) => Promise<MarketplaceHireActionState>) | undefined;
  readonly hireEscrowAction?: ((formData: FormData) => Promise<MarketplaceHireActionState>) | undefined;
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
  signedIn,
  signInHref,
  hireListing = null,
  orgSlug = null,
  buyerOrgId = null,
  clients = [],
  authorizeAction,
  hireX402Action,
  hireEscrowAction,
}: MarketplaceDetailViewProps) {
  let hirePanel: ReactNode;
  if (!signedIn || orgSlug === null || buyerOrgId === null) {
    hirePanel = (
      <aside className="amkt-hire-panel" aria-label="Hire">
        <div className="amkt-hire-panel-head">
          <p className="amkt-eyebrow">Hire</p>
          <h2>{listing.name}</h2>
        </div>
        <p className="amkt-hire-copy">
          Sign in to hire and pay on this page under your org policy.
        </p>
        <ul className="amkt-hire-facts">
          <li><span>Rails</span><strong>{listing.rails.join(' · ')}</strong></li>
          <li>
            <span>Chain</span>
            <strong><MarketplaceChainChip chain={listing.chain} /></strong>
          </li>
          <li><span>Reputation</span><strong>{activity.reputationScore}</strong></li>
          <li><span>Settled</span><strong>{formatUsdc(activity.settledUsdc)}</strong></li>
        </ul>
        <Link className="amkt-hire-cta" href={signInHref}>
          Sign in to hire
        </Link>
        <p className="amkt-hire-note">
          After sign-in you stay on marketplace to complete payment. Purchases show in your console.
        </p>
      </aside>
    );
  } else if (
    hireListing !== null
    && authorizeAction !== undefined
    && hireX402Action !== undefined
    && hireEscrowAction !== undefined
  ) {
    hirePanel = (
      <aside className="amkt-hire-panel" aria-label="Hire">
        <MarketplaceHirePanel
          authorizeAction={authorizeAction}
          buyerOrgId={buyerOrgId}
          clients={clients}
          hireEscrowAction={hireEscrowAction}
          hireX402Action={hireX402Action}
          listing={hireListing}
          orgSlug={orgSlug}
          purchasesHref={`/app/${orgSlug}/marketplace`}
        />
      </aside>
    );
  } else {
    hirePanel = (
      <aside className="amkt-hire-panel" aria-label="Hire">
        <p className="amkt-eyebrow">Hire</p>
        <h2>{listing.name}</h2>
        <p className="amkt-hire-copy">Unable to load hire context for your org. Refresh and try again.</p>
      </aside>
    );
  }

  return (
    <div className="amkt-detail">
      <nav className="amkt-detail-crumb" aria-label="Breadcrumb">
        <Link href="/marketplace">Marketplace</Link>
        <span aria-hidden="true">/</span>
        <span>{listing.name}</span>
      </nav>

      <header className="amkt-detail-hero">
        <div className="amkt-detail-identity">
          <MarketplaceListingMark
            agentId={listing.agentId}
            kind={listing.kind}
            listingId={listing.id}
            name={listing.name}
            size="lg"
          />
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
              <MarketplaceChainChip chain={listing.chain} />
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

        <div className="amkt-detail-score" title={REPUTATION_HINT}>
          <span>Reputation</span>
          <strong>{activity.reputationScore}</strong>
          <small>
            {activity.reputationEvents} settled job{activity.reputationEvents === 1 ? '' : 's'} ·{' '}
            {activity.completedJobs} completed · {formatUsdc(activity.settledUsdc)} settled
          </small>
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
                <dd><MarketplaceChainChip chain={listing.chain} /></dd>
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

        {hirePanel}
      </div>
    </div>
  );
}
