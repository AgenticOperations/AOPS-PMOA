import Link from 'next/link';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import { formatUtcDateTime } from '@/lib/date-format';
import { formatMoney, titleCase } from '@/lib/payments-format';
import type { EscrowJobActivityRecord } from '@/lib/payments-types';
import type { MarketplaceListingRecord } from '@/lib/server/payments-client';
import { MarketplaceChainChip, MarketplaceListingMark } from './MarketplaceMarks';

type PurchasedMarketplaceViewProps = {
  readonly jobs: readonly EscrowJobActivityRecord[];
  readonly listings: readonly MarketplaceListingRecord[];
  readonly orgSlug: string;
};

function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function outcomeTone(state: EscrowJobActivityRecord['state']): string {
  if (state === 'completed') return 'active';
  if (state === 'rejected' || state === 'expired') return 'failed';
  if (state === 'open' || state === 'funded' || state === 'submitted') return 'pending';
  return 'inactive';
}

function matchListing(
  job: EscrowJobActivityRecord,
  listings: readonly MarketplaceListingRecord[],
): MarketplaceListingRecord | null {
  const provider = job.providerAddress.toLowerCase();
  return listings.find((listing) => listing.providerAddress?.toLowerCase() === provider) ?? null;
}

export function PurchasedMarketplaceView({
  jobs,
  listings,
  orgSlug,
}: PurchasedMarketplaceViewProps) {
  const purchased = [...jobs].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );

  return (
    <main className="registry-page" id="main-content">
      <header className="registry-page-header">
        <div>
          <p className="registry-eyebrow">Purchases</p>
          <h1>Hired agents &amp; services</h1>
          <p className="registry-page-copy">
            Agents and services you hired from the marketplace. Hire and pay on the public board —
            this page is your purchase history.
          </p>
        </div>
        <Link className="console-primary-button" href="/marketplace">
          Hire from marketplace
        </Link>
      </header>

      {purchased.length === 0 ? (
        <div className="marketplace-empty-panel">
          <strong>No purchases yet</strong>
          <p>
            Open the marketplace, pick an agent or service, and hire under your org policy.
            Settled escrow jobs appear here.
          </p>
          <Link className="action-nav-link" href="/marketplace">Go to marketplace</Link>
        </div>
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent / service</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Chain</TableHead>
                <TableHead>Spend</TableHead>
                <TableHead>Status</TableHead>
                <TableHead title="Reputation is 0–100; completed escrow raises the seller’s score (capped)">Reputation</TableHead>
                <TableHead>Hired</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchased.map((job) => {
                const listing = matchListing(job, listings);
                const title = listing?.name ?? shortAddress(job.providerAddress);
                const subtitle = listing !== null
                  ? `${listing.kind} · ${listing.rails.join(' · ')}`
                  : job.providerAddress;
                return (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div className="treasury-index-primary treasury-primary-cell">
                        {listing !== null ? (
                          <MarketplaceListingMark
                            agentId={listing.agentId}
                            kind={listing.kind}
                            listingId={listing.id}
                            name={listing.name}
                            size="sm"
                          />
                        ) : null}
                        <div>
                          <strong>{title}</strong>
                          <small>{subtitle}</small>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{job.clientAgentName ?? shortAddress(job.clientAgentId)}</TableCell>
                    <TableCell><MarketplaceChainChip chain={job.chain} /></TableCell>
                    <TableCell>{formatMoney(job.budgetUsdc)}</TableCell>
                    <TableCell>
                      <StatusBadge label={titleCase(job.state)} status={outcomeTone(job.state)} />
                    </TableCell>
                    <TableCell>
                      {job.state === 'completed'
                        ? <span title="Settled escrow raised the seller’s reputation (0–100 scale, capped)">Earned</span>
                        : <span className="reputation-history-muted">—</span>}
                    </TableCell>
                    <TableCell>
                      <time dateTime={job.createdAt}>{formatUtcDateTime(job.createdAt)}</time>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableShell>
      )}

      <p className="registry-page-copy" style={{ marginTop: 18 }}>
        Need the full payment trail? See{' '}
        <Link className="action-nav-link" href={`/app/${orgSlug}/payments/activity?tab=escrow`}>
          Treasury → Activity
        </Link>
        .
      </p>
    </main>
  );
}
