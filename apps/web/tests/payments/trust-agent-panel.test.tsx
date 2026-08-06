import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrustAgentPanel } from '../../src/components/payments/TrustAgentPanel.js';

const noHistory = { completedCount: 0, rejectedCount: 0, expiredCount: 0, settledUsdc: '0.00' };
const withHistory = { completedCount: 3, rejectedCount: 1, expiredCount: 0, settledUsdc: '42.00' };

describe('TrustAgentPanel', () => {
  it('disables the trust action when there is no settled history', () => {
    render(
      <TrustAgentPanel evidence={noHistory} trusted={false} trustAction={vi.fn()} revokeAction={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /trust this agent/i })).toHaveProperty('disabled', true);
  });

  it('requires a ceiling before promoting', () => {
    render(
      <TrustAgentPanel evidence={withHistory} trusted={false} trustAction={vi.fn()} revokeAction={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /trust this agent/i }));
    // The operator chooses how much authority to grant. There is no default
    // and no derived number -- that is the design decision (D-2/D-3).
    expect(screen.getByText(/enter a ceiling/i)).toBeTruthy();
  });

  it('calls trustAction with the operator-chosen ceiling', () => {
    const trustAction = vi.fn().mockResolvedValue(undefined);
    render(
      <TrustAgentPanel evidence={withHistory} trusted={false} trustAction={trustAction} revokeAction={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/spending ceiling/i), { target: { value: '25.00' } });
    fireEvent.click(screen.getByRole('button', { name: /trust this agent/i }));
    expect(trustAction).toHaveBeenCalledWith(expect.objectContaining({ ceilingUsdc: '25.00' }));
  });

  it('shows the cost contrast so the operator knows what trust buys', () => {
    render(
      <TrustAgentPanel evidence={withHistory} trusted={false} trustAction={vi.fn()} revokeAction={vi.fn()} />,
    );
    expect(screen.getByText(/5 transactions/i)).toBeTruthy();
    expect(screen.getByText(/1 transaction/i)).toBeTruthy();
  });

  it('offers revoke when already trusted', () => {
    render(
      <TrustAgentPanel evidence={withHistory} trusted trustAction={vi.fn()} revokeAction={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /revoke/i })).toBeTruthy();
  });

  it('explains that there is no dispute path', () => {
    render(
      <TrustAgentPanel evidence={withHistory} trusted={false} trustAction={vi.fn()} revokeAction={vi.fn()} />,
    );
    // Stating the limit plainly is required; implying an appeal exists is
    // the overclaim this project exists to avoid.
    expect(screen.getByText(/no dispute path/i)).toBeTruthy();
  });

  it('maps expected rejections to specific guidance, not a generic failure', () => {
    render(
      <TrustAgentPanel
        error="trust_requires_escrow_history"
        evidence={withHistory}
        revokeAction={vi.fn()}
        trustAction={vi.fn()}
        trusted={false}
      />,
    );
    expect(screen.getByText(/complete at least one escrow job/i)).toBeTruthy();
  });
});
