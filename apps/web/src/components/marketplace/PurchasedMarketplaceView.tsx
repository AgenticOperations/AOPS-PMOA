'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { StatusBadge } from '@/components/ui/status-badge';
import { Sheet, SheetBody, SheetCloseButton, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import { formatUtcDateTime } from '@/lib/date-format';
import { formatMoney, titleCase } from '@/lib/payments-format';
import type { EscrowJobActivityRecord, PaymentEventRecord } from '@/lib/payments-types';
import type { MarketplaceListingRecord } from '@/lib/server/payments-client';
import { MarketplaceChainChip, MarketplaceListingMark } from './MarketplaceMarks';
import { PurchaseSandboxPanel, type PurchaseSandboxSelection } from './PurchaseSandboxPanel';

type PurchasedMarketplaceViewProps = {
  readonly jobs: readonly EscrowJobActivityRecord[];
  readonly listings: readonly MarketplaceListingRecord[];
  readonly orgSlug: string;
  readonly paymentEvents?: readonly PaymentEventRecord[];
};

type PurchaseRow = {
  readonly chain: EscrowJobActivityRecord['chain'] | PaymentEventRecord['chain'];
  readonly clientLabel: string;
  readonly hiredAt: string;
  readonly id: string;
  readonly kind: 'escrow' | 'fleet' | 'x402';
  readonly listing: MarketplaceListingRecord | null;
  readonly outcome: string;
  readonly outcomeTone: string;
  readonly paymentResult: Record<string, unknown> | null;
  readonly reputationLabel: string;
  readonly spend: string;
  readonly subtitle: string;
  readonly title: string;
  readonly endpointUrl: string | null;
};

function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function escrowTone(state: EscrowJobActivityRecord['state']): string {
  if (state === 'completed') return 'active';
  if (state === 'rejected' || state === 'expired') return 'failed';
  if (state === 'open' || state === 'funded' || state === 'submitted') return 'pending';
  return 'inactive';
}

function paymentTone(event: PaymentEventRecord): string {
  const fulfillment = event.result.fulfillment;
  if (fulfillment !== null && typeof fulfillment === 'object') {
    const status = (fulfillment as Record<string, unknown>).status;
    if (status === 'delivered') return 'active';
    if (status === 'failed') return 'failed';
  }
  if (event.result.settlement === 'settled' || event.decision === 'settled') return 'active';
  if (event.decision === 'failed') return 'failed';
  if (event.decision === 'submitted') return 'pending';
  return 'inactive';
}

function paymentOutcome(event: PaymentEventRecord): string {
  const fulfillment = event.result.fulfillment;
  if (fulfillment !== null && typeof fulfillment === 'object') {
    const status = (fulfillment as Record<string, unknown>).status;
    if (typeof status === 'string' && status.length > 0) return titleCase(status);
  }
  if (event.result.settlement === 'settled') return 'Settled';
  return titleCase(event.decision);
}

function matchListingForEscrow(
  job: EscrowJobActivityRecord,
  listings: readonly MarketplaceListingRecord[],
): MarketplaceListingRecord | null {
  const provider = job.providerAddress.toLowerCase();
  return listings.find((listing) => listing.providerAddress?.toLowerCase() === provider) ?? null;
}

function matchListingForPayment(
  event: PaymentEventRecord,
  listings: readonly MarketplaceListingRecord[],
): MarketplaceListingRecord | null {
  const payeeAgentId = typeof event.result.payee_agent_id === 'string' ? event.result.payee_agent_id : null;
  if (payeeAgentId !== null) {
    const byAgent = listings.find((listing) => listing.agentId === payeeAgentId);
    if (byAgent !== undefined) return byAgent;
  }
  const resourceUrl = event.resource_url;
  if (resourceUrl !== null && resourceUrl.length > 0) {
    const byEndpoint = listings.find((listing) => listing.endpointUrl === resourceUrl);
    if (byEndpoint !== undefined) return byEndpoint;
  }
  const recipient = event.recipient.toLowerCase();
  return listings.find((listing) => listing.providerAddress?.toLowerCase() === recipient) ?? null;
}

/** Marketplace / fleet hire payments — not ordinary runtime x402 spend. */
export function isPurchasePaymentEvent(event: PaymentEventRecord): boolean {
  const lane = event.result.lane;
  if (lane === 'permit2_intra_fleet') return true;
  if (typeof event.result.payee_agent_id === 'string' && event.result.payee_agent_id.length > 0) return true;
  if (typeof event.result.payee_name === 'string' && event.result.payee_name.length > 0) return true;
  return false;
}

function buildRows(
  jobs: readonly EscrowJobActivityRecord[],
  paymentEvents: readonly PaymentEventRecord[],
  listings: readonly MarketplaceListingRecord[],
): PurchaseRow[] {
  const escrowRows: PurchaseRow[] = jobs.map((job) => {
    const listing = matchListingForEscrow(job, listings);
    return {
      id: job.id,
      kind: 'escrow',
      listing,
      title: listing?.name ?? shortAddress(job.providerAddress),
      subtitle: listing !== null
        ? `${listing.kind} · escrow · ${listing.rails.join(' · ')}`
        : `Escrow · ${job.providerAddress}`,
      clientLabel: job.clientAgentName ?? shortAddress(job.clientAgentId),
      chain: job.chain,
      spend: formatMoney(job.budgetUsdc),
      outcome: titleCase(job.state),
      outcomeTone: escrowTone(job.state),
      reputationLabel: job.state === 'completed' ? 'Earned' : '—',
      hiredAt: job.createdAt,
      paymentResult: null,
      endpointUrl: listing?.endpointUrl ?? null,
    };
  });

  const paymentRows: PurchaseRow[] = paymentEvents.filter(isPurchasePaymentEvent).map((event) => {
    const listing = matchListingForPayment(event, listings);
    const payeeName = typeof event.result.payee_name === 'string' ? event.result.payee_name : null;
    const lane = event.result.lane === 'permit2_intra_fleet' ? 'Permit2 fleet' : 'x402';
    return {
      id: event.id,
      kind: event.result.lane === 'permit2_intra_fleet' ? 'fleet' : 'x402',
      listing,
      title: listing?.name ?? payeeName ?? event.resource_category ?? shortAddress(event.recipient),
      subtitle: listing !== null
        ? `${listing.kind} · ${lane}`
        : `${lane} · ${event.resource_url ?? event.recipient}`,
      clientLabel: shortAddress(event.agent_id),
      chain: event.chain,
      spend: formatMoney(event.amount_usdc),
      outcome: paymentOutcome(event),
      outcomeTone: paymentTone(event),
      reputationLabel: paymentTone(event) === 'active' ? 'Earned' : '—',
      hiredAt: event.created_at,
      paymentResult: event.result,
      endpointUrl: listing?.endpointUrl ?? event.resource_url,
    };
  });

  return [...escrowRows, ...paymentRows].sort(
    (left, right) => new Date(right.hiredAt).getTime() - new Date(left.hiredAt).getTime(),
  );
}

function toSelection(row: PurchaseRow): PurchaseSandboxSelection {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    subtitle: row.subtitle,
    spend: row.spend,
    outcome: row.outcome,
    outcomeTone: row.outcomeTone,
    chain: row.chain,
    listing: row.listing,
    endpointUrl: row.endpointUrl,
    paymentResult: row.paymentResult,
  };
}

export function PurchasedMarketplaceView({
  jobs,
  listings,
  orgSlug,
  paymentEvents = [],
}: PurchasedMarketplaceViewProps) {
  const purchased = useMemo(
    () => buildRows(jobs, paymentEvents, listings),
    [jobs, paymentEvents, listings],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = purchased.find((row) => row.id === selectedId);

  return (
    <main className="registry-page" id="main-content">
      <header className="registry-page-header">
        <div>
          <p className="registry-eyebrow">Purchases</p>
          <h1>Hired agents &amp; services</h1>
          <p className="registry-page-copy">
            Agents and services you hired — open a row to preview sample data or the delivered response.
          </p>
        </div>
        <p className="registry-page-copy purchases-header-trail">
          Need the full payment trail? See{' '}
          <Link className="action-nav-link" href={`/app/${orgSlug}/activity?tab=payments`}>
            Activity → Payments
          </Link>
          {' '}or{' '}
          <Link className="action-nav-link" href={`/app/${orgSlug}/activity?tab=escrow`}>
            Escrow
          </Link>
          .
        </p>
      </header>

      {purchased.length === 0 ? (
        <div className="marketplace-empty-panel">
          <strong>No purchases yet</strong>
          <p>
            Open the marketplace, pick an agent or service, and hire under your org policy.
            Escrow jobs and Permit2 fleet hires appear here.
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
                <TableHead title="Reputation is 0–100; completed hires raise the seller’s score (capped)">Reputation</TableHead>
                <TableHead>Hired</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchased.map((row) => (
                <TableRow
                  key={row.id}
                  className={selectedId === row.id ? 'purchase-row is-selected' : 'purchase-row'}
                  data-purchase-id={row.id}
                  onClick={() => setSelectedId(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId(row.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open sandbox for ${row.title}`}
                >
                  <TableCell>
                    <div className="treasury-index-primary treasury-primary-cell">
                      {row.listing !== null ? (
                        <MarketplaceListingMark
                          agentId={row.listing.agentId}
                          kind={row.listing.kind}
                          listingId={row.listing.id}
                          name={row.listing.name}
                          size="sm"
                        />
                      ) : null}
                      <div>
                        <strong>{row.title}</strong>
                        <small>{row.subtitle}</small>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{row.clientLabel}</TableCell>
                  <TableCell><MarketplaceChainChip chain={row.chain} /></TableCell>
                  <TableCell>{row.spend}</TableCell>
                  <TableCell>
                    <StatusBadge label={row.outcome} status={row.outcomeTone} />
                  </TableCell>
                  <TableCell>
                    {row.reputationLabel === 'Earned'
                      ? <span title="Settled hire raised the seller’s reputation (0–100 scale, capped)">Earned</span>
                      : <span className="reputation-history-muted">—</span>}
                  </TableCell>
                  <TableCell>
                    <time dateTime={row.hiredAt}>{formatUtcDateTime(row.hiredAt)}</time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}

      <Sheet
        labelledBy="purchase-sandbox-title"
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        open={selected !== undefined}
        panelClassName="treasury-drawer purchase-sandbox-drawer"
      >
        <SheetHeader>
          <div>
            <SheetTitle id="purchase-sandbox-title">Service sandbox</SheetTitle>
            <SheetDescription>
              {selected?.title ?? 'Preview the data this hire returns'}
            </SheetDescription>
          </div>
          <SheetCloseButton onClick={() => setSelectedId(null)} />
        </SheetHeader>
        <SheetBody className="treasury-evidence-drawer">
          {selected !== undefined ? (
            <PurchaseSandboxPanel
              key={selected.id}
              orgSlug={orgSlug}
              selection={toSelection(selected)}
            />
          ) : null}
        </SheetBody>
      </Sheet>
    </main>
  );
}
