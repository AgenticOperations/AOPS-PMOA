import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrustGraduationSection } from '../../src/components/payments/TrustGraduationSection.js';

vi.mock('../../src/app/actions/payments.js', () => ({
  trustExternalAgentAction: vi.fn(),
  revokeTrustAction: vi.fn(),
}));

describe('TrustGraduationSection', () => {
  it('shows empty state when there are no escrow counterparties', () => {
    render(<TrustGraduationSection orgId="org_1" orgSlug="demo" targets={[]} />);
    expect(screen.getByText(/no escrow counterparties yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /marketplace/i })).toBeTruthy();
  });

  it('scopes empty-state copy to the paying agent when provided', () => {
    render(
      <TrustGraduationSection agentName="Writer" orgId="org_1" orgSlug="demo" targets={[]} />,
    );
    expect(screen.getByText('Writer')).toBeTruthy();
    expect(screen.getByText(/as the paying agent/i)).toBeTruthy();
  });

  it('renders a trust panel for each counterparty', () => {
    render(
      <TrustGraduationSection
        orgId="org_1"
        orgSlug="demo"
        targets={[
          {
            chain: 'arc',
            address: '0xabc123',
            trusted: false,
            evidence: {
              completedCount: 2,
              rejectedCount: 0,
              expiredCount: 0,
              settledUsdc: '0.04',
            },
          },
        ]}
      />,
    );
    expect(screen.getByText('0xabc123')).toBeTruthy();
    expect(screen.getByRole('button', { name: /trust this agent/i })).toBeTruthy();
    expect(screen.getByLabelText(/not trusted/i)).toBeTruthy();
  });
});
