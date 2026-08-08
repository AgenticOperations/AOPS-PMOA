'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { PublicMarketplaceListing } from '@/lib/server/marketplace-public-client';
import { MarketplaceChainChip, MarketplaceListingMark } from './MarketplaceMarks';
import { MarketplaceSparkline } from './MarketplaceSparkline';

type MarketplaceBoardProps = {
  readonly listings: readonly PublicMarketplaceListing[];
  readonly activityById: Readonly<Record<string, {
    readonly reputationScore: number;
    readonly settledUsdc: string;
    readonly series: readonly { readonly day: string; readonly settledUsdc: string; readonly completedJobs: number }[];
  }>>;
};

type KindFilter = 'all' | 'agent' | 'service';
type ViewMode = 'grid' | 'list';

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatUsdc(value: string): string {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount) || amount === 0) return '—';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

function sparkValues(
  series: readonly { readonly settledUsdc: string; readonly completedJobs: number }[] | undefined,
): number[] {
  return (series ?? []).map((point) => Number.parseFloat(point.settledUsdc) || point.completedJobs);
}

export function MarketplaceBoard({ listings, activityById }: MarketplaceBoardProps) {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<KindFilter>('all');
  const [view, setView] = useState<ViewMode>('grid');

  const counts = useMemo(() => ({
    all: listings.length,
    agent: listings.filter((item) => item.kind === 'agent').length,
    service: listings.filter((item) => item.kind === 'service').length,
  }), [listings]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return listings.filter((listing) => {
      if (kind !== 'all' && listing.kind !== kind) return false;
      if (normalized.length === 0) return true;
      return `${listing.name} ${listing.description} ${listing.category} ${listing.chain}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [kind, listings, query]);

  return (
    <section className="amkt-explore" id="board" aria-label="Explore agents">
      <div className="amkt-explore-head">
        <div>
          <h2>Explore agents</h2>
          <p>Hireable endpoints with identity, rails, and settlement activity.</p>
        </div>
        <span className="amkt-status-pill">
          <i aria-hidden="true" />
          Live on Arc testnet
        </span>
      </div>

      <div className="amkt-explore-toolbar">
        <label className="amkt-search">
          <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
            <circle cx="11" cy="11" fill="none" r="7" stroke="currentColor" strokeWidth="1.6" />
            <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
          </svg>
          <span className="sr-only">Search agents and services</span>
          <input
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search agent name or service"
            type="search"
            value={query}
          />
        </label>

        <div className="amkt-filters" role="tablist" aria-label="Listing kind">
          {([
            ['all', 'All', counts.all],
            ['agent', 'Agents', counts.agent],
            ['service', 'Services', counts.service],
          ] as const).map(([id, label, count]) => (
            <button
              aria-selected={kind === id}
              className={kind === id ? 'is-active' : undefined}
              key={id}
              onClick={() => setKind(id)}
              type="button"
            >
              {label}
              <em>{count}</em>
            </button>
          ))}
        </div>

        <div className="amkt-toolbar-right">
          <div className="amkt-view-toggle" role="group" aria-label="View mode">
            <button
              aria-label="Grid view"
              aria-pressed={view === 'grid'}
              className={view === 'grid' ? 'is-active' : undefined}
              onClick={() => setView('grid')}
              type="button"
            >
              <svg aria-hidden="true" height="15" viewBox="0 0 16 16" width="15">
                <rect fill="currentColor" height="6" rx="1" width="6" x="1" y="1" />
                <rect fill="currentColor" height="6" rx="1" width="6" x="9" y="1" />
                <rect fill="currentColor" height="6" rx="1" width="6" x="1" y="9" />
                <rect fill="currentColor" height="6" rx="1" width="6" x="9" y="9" />
              </svg>
            </button>
            <button
              aria-label="List view"
              aria-pressed={view === 'list'}
              className={view === 'list' ? 'is-active' : undefined}
              onClick={() => setView('list')}
              type="button"
            >
              <svg aria-hidden="true" height="15" viewBox="0 0 16 16" width="15">
                <rect fill="currentColor" height="2" rx="1" width="14" x="1" y="2" />
                <rect fill="currentColor" height="2" rx="1" width="14" x="1" y="7" />
                <rect fill="currentColor" height="2" rx="1" width="14" x="1" y="12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="amkt-empty">
          <strong>No listings match</strong>
          <p>Try another filter, or publish an agent with a public endpoint.</p>
        </div>
      ) : view === 'grid' ? (
        <ul className="amkt-grid">
          {visible.map((listing) => {
            const activity = activityById[listing.id];
            const spark = sparkValues(activity?.series);
            return (
              <li key={listing.id}>
                <Link className="amkt-card" href={`/marketplace/${encodeURIComponent(listing.id)}`}>
                  <div className="amkt-card-top">
                    <MarketplaceListingMark
                      agentId={listing.agentId}
                      kind={listing.kind}
                      listingId={listing.id}
                      name={listing.name}
                      size="md"
                    />
                    <div className="amkt-card-id">
                      <strong>{listing.name}</strong>
                      <p className="amkt-card-sub">
                        <span className="amkt-card-kind">{listing.kind}</span>
                        <span className="amkt-card-dot" aria-hidden="true">·</span>
                        <MarketplaceChainChip chain={listing.chain} />
                      </p>
                    </div>
                  </div>

                  <div className="amkt-card-body">
                    <div className="amkt-card-metric">
                      <strong>{activity?.reputationScore ?? 0}</strong>
                      <span className="amkt-card-delta">
                        {formatUsdc(activity?.settledUsdc ?? '0')} settled
                      </span>
                    </div>
                    <div className="amkt-card-meta">
                      <span className="amkt-card-rails">
                        {listing.rails.slice(0, 2).join(' · ') || 'Open rails'}
                      </span>
                      <span className="amkt-card-price">
                        {listing.priceHint ?? 'Quote on hire'}
                      </span>
                    </div>
                  </div>

                  <div className="amkt-card-chart" aria-hidden="true">
                    <MarketplaceSparkline height={56} values={spark} width={320} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="amkt-table-wrap">
          <table className="amkt-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Agent</th>
                <th scope="col">Rails</th>
                <th scope="col">Chain</th>
                <th className="is-num" scope="col">Reputation</th>
                <th className="is-num" scope="col">Settled</th>
                <th scope="col">Activity</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((listing, index) => {
                const activity = activityById[listing.id];
                const spark = sparkValues(activity?.series);
                return (
                  <tr key={listing.id}>
                    <td className="amkt-rank">{index + 1}</td>
                    <td>
                      <Link className="amkt-identity" href={`/marketplace/${encodeURIComponent(listing.id)}`}>
                        <MarketplaceListingMark
                          agentId={listing.agentId}
                          kind={listing.kind}
                          listingId={listing.id}
                          name={listing.name}
                          size="sm"
                        />
                        <span className="amkt-identity-text">
                          <strong>{listing.name}</strong>
                          <small>
                            {listing.identityTokenId !== null ? `#${listing.identityTokenId} · ` : ''}
                            {hostOf(listing.endpointUrl)}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <div className="amkt-rails">
                        {listing.rails.map((rail) => (
                          <span className="amkt-chip" key={rail}>{rail}</span>
                        ))}
                      </div>
                    </td>
                    <td><MarketplaceChainChip chain={listing.chain} /></td>
                    <td className="amkt-num">{activity?.reputationScore ?? 0}</td>
                    <td className="amkt-num">{formatUsdc(activity?.settledUsdc ?? '0')}</td>
                    <td><MarketplaceSparkline values={spark} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
