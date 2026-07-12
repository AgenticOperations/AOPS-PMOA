import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TreasuryOverview } from '../../src/components/payments/TreasuryOverview.js';

vi.mock('server-only', () => ({}));

describe('TreasuryOverview', () => {
  it('does not present historical rail proofs as executable when Circle is disconnected', () => {
    render(
      <TreasuryOverview
        accounts={[]}
        agents={[]}
        balances={[]}
        circleConnectionState="disconnected"
        failedJobs={[]}
        orgSlug="sample-qa-workspace"
        overview={{
          mode: 'test',
          totals: { gateway_usdc: '0', wallet_usdc: '0', treasury_usdc: '0' },
          liquidity: { pending_jobs: 0, failed_jobs: 0, last_job: null },
          payments: { agents_with_access: 0, total_spent_usdc: '0', last_payment: null },
        }}
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

    expect(screen.getAllByText('Circle connection required')).toHaveLength(2);
    expect(screen.getByText('0 / 10')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Circle connection required/ })).toHaveAttribute(
      'href',
      '/onboarding/sample-qa-workspace',
    );
  });

  it('distinguishes provider unavailability from a disconnected organization', () => {
    render(
      <TreasuryOverview
        accounts={[]}
        agents={[]}
        balances={[]}
        circleConnectionState="unavailable"
        failedJobs={[]}
        orgSlug="sample-qa-workspace"
        overview={{
          mode: 'test',
          totals: { gateway_usdc: '0', wallet_usdc: '0', treasury_usdc: '0' },
          liquidity: { pending_jobs: 0, failed_jobs: 0, last_job: null },
          payments: { agents_with_access: 0, total_spent_usdc: '0', last_payment: null },
        }}
        paymentMode={{
          mode: 'test',
          org_id: 'org_1',
          updated_at: '2026-07-11T00:00:00.000Z',
          updated_by: 'usr_1',
        }}
        pendingReservations={0}
        railReadiness={[]}
      />,
    );

    expect(screen.getByText('Circle provider unavailable')).toBeInTheDocument();
    expect(screen.getByText('Provider status is temporarily unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Circle connection required')).not.toBeInTheDocument();
  });
});
