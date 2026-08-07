import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TreasuryActivity } from '../../src/components/payments/TreasuryActivity.js';

describe('TreasuryActivity', () => {
  it('shows delivered fulfillment instead of the lower-level submitted payment state', () => {
    render(
      <TreasuryActivity
        activeTab="payments"
        auditEvents={[]}
        orgSlug="sample-qa-workspace"
        paymentEvents={[
          {
            id: 'pay_1',
            org_id: 'org_1',
            agent_id: 'agt_trade',
            connection_id: null,
            source_id: null,
            reservation_id: null,
            decision: 'submitted',
            provider_mode: 'test',
            rail: 'gateway_base',
            chain: 'base',
            amount_usdc: '0.05',
            asset: 'USDC',
            recipient: '0xrecipient',
            network: 'base-sepolia',
            resource_url: null,
            resource_category: 'weather',
            quote: {},
            result: { fulfillment: { status: 'delivered' }, settlement: 'settled' },
            activity_id: null,
            created_at: '2026-07-08T08:00:00.000Z',
          },
        ]}
        providerJobs={[]}
        reservations={[]}
        routeObservations={[]}
      />,
    );

    expect(screen.getByText('weather')).toBeInTheDocument();
    expect(screen.getByText('0.05 USDC')).toBeInTheDocument();
    expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0);
    expect(screen.queryByText('submitted')).not.toBeInTheDocument();
    expect(screen.queryByText('No provider jobs')).not.toBeInTheDocument();
  });

  it('shows an empty state on the ledger tab when there are no payment events', () => {
    render(
      <TreasuryActivity activeTab="payments" auditEvents={[]} orgSlug="sample-qa-workspace" paymentEvents={[]} providerJobs={[]} reservations={[]} routeObservations={[]} />,
    );

    expect(screen.getByText('No payments yet')).toBeInTheDocument();
  });
});
