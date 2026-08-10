import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  isPurchasePaymentEvent,
  PurchasedMarketplaceView,
} from '../../src/components/marketplace/PurchasedMarketplaceView.js';
import {
  extractDeliveredResponseBody,
  resolveMarketplaceServiceSample,
} from '../../src/lib/marketplace-service-samples.js';
import type { PaymentEventRecord } from '../../src/lib/payments-types.js';

function payment(overrides: Partial<PaymentEventRecord> = {}): PaymentEventRecord {
  return {
    id: 'payevt_writer',
    org_id: 'org_1',
    agent_id: 'agt_payer',
    connection_id: null,
    source_id: null,
    reservation_id: null,
    decision: 'submitted',
    provider_mode: 'test',
    rail: 'exact_arc',
    chain: 'arc',
    amount_usdc: '0.02',
    asset: 'USDC',
    recipient: '0x6c3d6a54b4fc967c8320b2e9efd09aa86f0ef02e',
    network: 'eip155:5042002',
    resource_url: 'http://127.0.0.1:4003/report',
    resource_category: 'Fleet hire → Writer',
    quote: {},
    result: {
      lane: 'permit2_intra_fleet',
      payee_name: 'Writer',
      payee_agent_id: 'agt_writer',
      fulfillment: { status: 'delivered' },
      settlement: 'settled',
    },
    activity_id: null,
    created_at: '2026-08-09T19:02:00.000Z',
    ...overrides,
  };
}

const writerListing = {
  id: 'svc_demo_writer',
  kind: 'service' as const,
  name: 'Writer',
  category: 'writing',
  description: 'Writes briefs',
  endpointUrl: 'http://127.0.0.1:4003/report',
  chain: 'arc' as const,
  priceHint: '0.02',
  providerAddress: '0x6c3d6a54b4fc967c8320b2e9efd09aa86f0ef02e',
  rails: ['x402'] as const,
  orgId: 'org_1',
  agentId: 'agt_writer',
  identityStatus: 'registered' as const,
  identityTokenId: null,
};

describe('marketplace service samples', () => {
  it('resolves demo Writer sample by listing id', () => {
    const sample = resolveMarketplaceServiceSample(writerListing);
    expect(sample?.label).toBe('Writer sample');
    expect(JSON.stringify(sample?.payload)).toContain('writer.research-report');
  });

  it('extracts delivered fulfillment body', () => {
    expect(extractDeliveredResponseBody({
      fulfillment: { status: 'delivered', body: { hello: 'world' } },
    })).toEqual({ hello: 'world' });
    expect(extractDeliveredResponseBody({ fulfillment: { status: 'delivered' } })).toBeNull();
  });
});

describe('PurchasedMarketplaceView', () => {
  it('treats Permit2 fleet hires as purchase events', () => {
    expect(isPurchasePaymentEvent(payment())).toBe(true);
    expect(isPurchasePaymentEvent(payment({
      result: { settlement: 'settled' },
      resource_category: 'weather',
    }))).toBe(false);
  });

  it('shows Permit2 fleet hires when escrow jobs are empty', () => {
    render(
      <PurchasedMarketplaceView
        jobs={[]}
        listings={[writerListing]}
        orgSlug="demo"
        paymentEvents={[payment()]}
      />,
    );

    expect(screen.getByText('Writer')).toBeInTheDocument();
    expect(screen.getByText('service · Permit2 fleet')).toBeInTheDocument();
    expect(screen.getByText('0.02 USDC')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Activity → Payments' })).toHaveAttribute(
      'href',
      '/app/demo/activity?tab=payments',
    );
    expect(screen.queryByText('No purchases yet')).not.toBeInTheDocument();
  });

  it('opens a sandbox panel with sample JSON when a purchase row is clicked', () => {
    render(
      <PurchasedMarketplaceView
        jobs={[]}
        listings={[writerListing]}
        orgSlug="demo"
        paymentEvents={[payment()]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open sandbox for Writer' }));

    expect(screen.getByRole('heading', { name: 'Service sandbox' })).toBeInTheDocument();
    expect(screen.getByText(/Writer sample/)).toBeInTheDocument();
    expect(screen.getByText(/writer\.research-report/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open listing / hire again' })).toHaveAttribute(
      'href',
      '/marketplace/svc_demo_writer',
    );
  });

  it('shows delivered body when fulfillment includes a response', () => {
    render(
      <PurchasedMarketplaceView
        jobs={[]}
        listings={[writerListing]}
        orgSlug="demo"
        paymentEvents={[payment({
          result: {
            lane: 'permit2_intra_fleet',
            payee_name: 'Writer',
            payee_agent_id: 'agt_writer',
            settlement: 'settled',
            fulfillment: {
              status: 'delivered',
              body: { title: 'Delivered research brief', score: 1 },
            },
          },
        })]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open sandbox for Writer' }));
    expect(screen.getByText(/Delivered research brief/)).toBeInTheDocument();
  });
});
