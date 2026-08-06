import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EscrowJobList } from '../../src/components/payments/EscrowJobList.js';

const completedJob = {
  id: 'escrow_1',
  state: 'completed' as const,
  budgetUsdc: '12.50',
  txHash: `0x${'1'.repeat(64)}`,
};

const expiredJob = {
  id: 'escrow_2',
  state: 'expired' as const,
  budgetUsdc: '4.00',
  txHash: `0x${'2'.repeat(64)}`,
};

const rejectedJob = {
  id: 'escrow_3',
  state: 'rejected' as const,
  budgetUsdc: '7.25',
  txHash: `0x${'3'.repeat(64)}`,
};

describe('EscrowJobList', () => {
  it('shows each job with its state and budget', () => {
    render(<EscrowJobList jobs={[completedJob]} chain="arc" />);
    expect(screen.getByText(/completed/i)).toBeTruthy();
    expect(screen.getByText(/12.50/)).toBeTruthy();
  });

  it('distinguishes expired from rejected in the UI', () => {
    render(<EscrowJobList jobs={[expiredJob, rejectedJob]} chain="arc" />);
    // The chain refunds both identically; our evidence must not blur them,
    // because they mean different things to the human deciding on trust.
    expect(screen.getByText(/expired/i)).toBeTruthy();
    expect(screen.getByText(/rejected/i)).toBeTruthy();
  });

  it('links each job to the block explorer by tx hash', () => {
    render(<EscrowJobList jobs={[completedJob]} chain="arc" />);
    const link = screen.getByRole('link', { name: /view/i });
    expect(link).toHaveAttribute('href', `https://testnet.arcscan.app/tx/${completedJob.txHash}`);
  });

  it('links to base sepolia explorer for the base chain', () => {
    render(<EscrowJobList jobs={[completedJob]} chain="base" />);
    const link = screen.getByRole('link', { name: /view/i });
    expect(link).toHaveAttribute('href', `https://sepolia.basescan.org/tx/${completedJob.txHash}`);
  });

  it('renders an empty state rather than an empty table', () => {
    render(<EscrowJobList jobs={[]} chain="arc" />);
    expect(screen.getByText(/no escrow jobs yet/i)).toBeTruthy();
  });
});
