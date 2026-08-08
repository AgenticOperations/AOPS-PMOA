import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EscrowLivenessBanner } from '../../src/components/payments/EscrowLivenessBanner.js';

const jobExpiringIn2h = {
  escrowJobId: 'escrow_5',
  providerAddress: '0x4444444444444444444444444444444444444444',
  expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
};

describe('EscrowLivenessBanner', () => {
  it('warns when submitted jobs are approaching expiry', () => {
    render(<EscrowLivenessBanner atRisk={[jobExpiringIn2h]} orgSlug="demo" />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('explains who actually loses if the evaluator stays silent', () => {
    render(<EscrowLivenessBanner atRisk={[jobExpiringIn2h]} orgSlug="demo" />);
    // The provider delivered and gets refunded against. Naming that plainly
    // is the entire point of the banner.
    expect(screen.getByText(/provider/i)).toBeTruthy();
    expect(screen.getByText(/refund/i)).toBeTruthy();
  });

  it('links each at-risk row to Activity escrow', () => {
    render(<EscrowLivenessBanner atRisk={[jobExpiringIn2h]} orgSlug="demo" />);
    expect(screen.getByRole('link', { name: /escrow_5/i })).toHaveAttribute(
      'href',
      '/app/demo/payments/activity?tab=escrow',
    );
  });

  it('renders nothing when no job is at risk', () => {
    const { container } = render(<EscrowLivenessBanner atRisk={[]} orgSlug="demo" />);
    expect(container.firstChild).toBeNull();
  });
});
