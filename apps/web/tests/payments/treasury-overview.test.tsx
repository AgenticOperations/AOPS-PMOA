import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TreasuryOverview } from '../../src/components/payments/TreasuryOverview.js';

vi.mock('server-only', () => ({}));

describe('TreasuryOverview', () => {
  it('does not present historical rail proofs as executable when Circle is disconnected', () => {
    render(
      <TreasuryOverview
        agentsWithAccess={0}
        circleConnected={false}
        failedJobs={[]}
        orgId="org_1"
        orgSlug="openassets-qa-workspace"
        paymentMode={{
          mode: 'test',
          org_id: 'org_1',
          updated_at: '2026-07-11T00:00:00.000Z',
          updated_by: 'usr_1',
        }}
        pendingReservations={0}
        railReadiness={Array.from({ length: 10 }, (_, index) => ({
          chain: index % 2 === 0 ? 'base' : 'arbitrum',
          last_observed_at: '2026-07-10T00:00:00.000Z',
          last_payment_at: null,
          last_proof_at: '2026-07-10T00:00:00.000Z',
          last_proof_status: 'complete',
          rail: index % 2 === 0 ? 'exact_base' : 'gateway_arbitrum',
          rail_type: index % 2 === 0 ? 'exact' : 'gateway',
          reason: 'verified',
          settlement_verified: true,
          status: 'ready',
          supported: true,
        }))}
      />,
    );

    expect(screen.getByText('Circle connection required')).toBeInTheDocument();
    expect(screen.getByText('0/10')).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Circle connection required/ })).toHaveAttribute(
      'href',
      '/onboarding/openassets-qa-workspace',
    );
  });
});
