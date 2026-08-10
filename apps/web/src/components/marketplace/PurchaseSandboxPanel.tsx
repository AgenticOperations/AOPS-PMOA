'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  extractDeliveredResponseBody,
  resolveMarketplaceServiceSample,
} from '@/lib/marketplace-service-samples';
import type { MarketplaceListingRecord } from '@/lib/server/payments-client';
import { MarketplaceChainChip, MarketplaceListingMark } from './MarketplaceMarks';

export type PurchaseSandboxSelection = {
  readonly id: string;
  readonly kind: 'escrow' | 'fleet' | 'x402';
  readonly title: string;
  readonly subtitle: string;
  readonly spend: string;
  readonly outcome: string;
  readonly outcomeTone: string;
  readonly chain: MarketplaceListingRecord['chain'] | string;
  readonly listing: MarketplaceListingRecord | null;
  readonly endpointUrl: string | null;
  readonly paymentResult: Record<string, unknown> | null;
};

type PurchaseSandboxPanelProps = {
  readonly orgSlug: string;
  readonly selection: PurchaseSandboxSelection;
};

type SandboxTab = 'sample' | 'delivered';

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function PurchaseSandboxPanel({ orgSlug, selection }: PurchaseSandboxPanelProps) {
  const sample = useMemo(
    () => resolveMarketplaceServiceSample(selection.listing),
    [selection.listing],
  );
  const deliveredBody = useMemo(
    () => extractDeliveredResponseBody(selection.paymentResult),
    [selection.paymentResult],
  );

  const defaultTab: SandboxTab = deliveredBody !== null ? 'delivered' : 'sample';
  const [tab, setTab] = useState<SandboxTab>(defaultTab);

  const activePayload = tab === 'delivered' ? deliveredBody : sample?.payload ?? null;
  const endpoint = selection.endpointUrl
    ?? selection.listing?.endpointUrl
    ?? null;

  return (
    <div className="purchase-sandbox">
      <div className="purchase-sandbox-hero">
        {selection.listing !== null ? (
          <MarketplaceListingMark
            agentId={selection.listing.agentId}
            kind={selection.listing.kind}
            listingId={selection.listing.id}
            name={selection.listing.name}
            size="sm"
          />
        ) : null}
        <div>
          <strong>{selection.title}</strong>
          <small>{selection.subtitle}</small>
        </div>
      </div>

      <div className="treasury-drawer-status">
        <StatusBadge label={selection.outcome} status={selection.outcomeTone} />
        <MarketplaceChainChip chain={selection.chain as MarketplaceListingRecord['chain']} />
      </div>

      <dl className="treasury-evidence-grid">
        <div>
          <dt>Spend</dt>
          <dd>{selection.spend}</dd>
        </div>
        <div>
          <dt>Rail</dt>
          <dd>{selection.kind === 'escrow' ? 'Escrow' : selection.kind === 'fleet' ? 'Permit2 fleet' : 'x402'}</dd>
        </div>
        {endpoint !== null ? (
          <div>
            <dt>Endpoint</dt>
            <dd>
              <code className="purchase-sandbox-endpoint">{endpoint}</code>
            </dd>
          </div>
        ) : null}
        {selection.listing !== null ? (
          <div>
            <dt>Category</dt>
            <dd>{selection.listing.category}</dd>
          </div>
        ) : null}
      </dl>

      {selection.listing !== null ? (
        <p className="purchase-sandbox-copy">
          {selection.listing.description}
        </p>
      ) : null}

      <div className="purchase-sandbox-tabs" role="tablist" aria-label="Service response">
        <button
          aria-selected={tab === 'sample'}
          className={tab === 'sample' ? 'is-active' : undefined}
          onClick={() => setTab('sample')}
          role="tab"
          type="button"
        >
          Sample response
        </button>
        <button
          aria-selected={tab === 'delivered'}
          className={tab === 'delivered' ? 'is-active' : undefined}
          onClick={() => setTab('delivered')}
          role="tab"
          type="button"
        >
          Delivered
        </button>
      </div>

      <div className="purchase-sandbox-pane" role="tabpanel">
        {activePayload !== null ? (
          <>
            <p className="purchase-sandbox-pane-note">
              {tab === 'sample'
                ? sample !== null
                  ? `${sample.label} — preview of the JSON this service returns after payment.`
                  : 'Sample payload'
                : 'Response body stored from the settled hire (bounded).'}
            </p>
            <pre className="purchase-sandbox-json">{formatJson(activePayload)}</pre>
          </>
        ) : (
          <div className="purchase-sandbox-empty">
            {tab === 'sample' ? (
              <>
                <strong>No sample on file</strong>
                <p>
                  This listing does not publish a static sample yet. New fleet hires store
                  the delivered JSON under Delivered after settlement.
                </p>
              </>
            ) : (
              <>
                <strong>No delivered body yet</strong>
                <p>
                  Older hires may not have stored a response body. Hire again from the
                  marketplace, or open Sample response for demo fleet services.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="purchase-sandbox-actions">
        {selection.listing !== null ? (
          <Link className="action-nav-link" href={`/marketplace/${encodeURIComponent(selection.listing.id)}`}>
            Open listing / hire again
          </Link>
        ) : (
          <Link className="action-nav-link" href="/marketplace">
            Browse marketplace
          </Link>
        )}
        <Link className="action-nav-link" href={`/app/${orgSlug}/activity?tab=payments`}>
          Payment trail
        </Link>
      </div>
    </div>
  );
}
