import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  isPurchasePaymentEvent,
  PurchasedMarketplaceView,
} from '../../src/components/marketplace/PurchasedMarketplaceView.js';
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
        listings={[
          {
            id: 'lst_writer',
            kind: 'service',
            name: 'Writer',
            category: 'writing',
            description: 'Writes briefs',
            endpointUrl: 'http://127.0.0.1:4003/report',
            chain: 'arc',
            priceHint: '0.02',
            providerAddress: '0x6c3d6a54b4fc967c8320b2e9efd09aa86f0ef02e',
            rails: ['x402'],
            orgId: 'org_1',
            agentId: 'agt_writer',
            identityStatus: 'registered',
            identityTokenId: null,
          },
        ]}
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
});
