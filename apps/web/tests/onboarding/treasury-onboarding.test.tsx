import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CircleTreasuryOnboarding } from '@/components/onboarding/CircleTreasuryOnboarding';

const noOpAction = vi.fn(() => Promise.resolve());
const noOpStateAction = vi.fn(() => Promise.resolve({}));

describe('Circle treasury onboarding', () => {
  it('starts email verification and then asks for the Circle OTP', async () => {
    const startAction = vi.fn(() => Promise.resolve({
      challengeId: 'cch_123',
      email: 'owner@example.com',
    }));
    render(
      <CircleTreasuryOnboarding
        completeAction={vi.fn(() => Promise.resolve({}))}
        connection={{ email: '', expiresAt: null, status: 'disconnected' }}
        defaultEmail="owner@example.com"
        disconnectAction={noOpAction}
        fundAction={noOpStateAction}
        orgSlug="acme"
        skipAction={noOpAction}
        startAction={startAction}
        syncAction={noOpAction}
        walletCount={0}
      />,
    );

    expect(screen.getByLabelText('Circle Agent Wallet email')).toHaveValue('owner@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Circle Agent Wallet' }));

    await waitFor(() => expect(screen.getByLabelText('Circle verification code')).toBeInTheDocument());
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
  });

  it('resumes a persisted OTP challenge after a page or service restart', () => {
    render(
      <CircleTreasuryOnboarding
        completeAction={vi.fn(() => Promise.resolve({}))}
        connection={{
          challengeId: 'cch_persisted',
          email: 'owner@example.com',
          expiresAt: null,
          status: 'otp_pending',
        }}
        defaultEmail="owner@example.com"
        disconnectAction={noOpAction}
        fundAction={noOpStateAction}
        orgSlug="acme"
        skipAction={noOpAction}
        startAction={vi.fn(() => Promise.resolve({}))}
        syncAction={noOpAction}
        walletCount={0}
      />,
    );

    expect(screen.getByLabelText('Circle verification code')).toBeInTheDocument();
    expect(screen.getByDisplayValue('cch_persisted')).toHaveAttribute('name', 'challengeId');
  });

  it('offers a fresh verification start when the persisted OTP challenge expires', () => {
    render(
      <CircleTreasuryOnboarding
        completeAction={vi.fn(() => Promise.resolve({}))}
        connection={{ email: 'owner@example.com', expiresAt: null, status: 'expired' }}
        defaultEmail="owner@example.com"
        disconnectAction={noOpAction}
        fundAction={noOpStateAction}
        orgSlug="acme"
        skipAction={noOpAction}
        startAction={vi.fn(() => Promise.resolve({}))}
        syncAction={noOpAction}
        walletCount={0}
      />,
    );

    expect(screen.getByText('Circle verification expired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new verification code' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Circle verification code')).not.toBeInTheDocument();
  });

  it('shows treasury sync and funding actions only after the Circle session connects', () => {
    const { rerender } = render(
      <CircleTreasuryOnboarding
        completeAction={vi.fn(() => Promise.resolve({}))}
        connection={{ email: 'owner@example.com', expiresAt: null, status: 'connected' }}
        defaultEmail="owner@example.com"
        disconnectAction={noOpAction}
        fundAction={noOpStateAction}
        orgSlug="acme"
        skipAction={noOpAction}
        startAction={vi.fn(() => Promise.resolve({}))}
        syncAction={noOpAction}
        walletCount={0}
      />,
    );

    expect(screen.getByRole('button', { name: 'Create testnet treasury' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request testnet USDC' })).not.toBeInTheDocument();

    rerender(
      <CircleTreasuryOnboarding
        completeAction={vi.fn(() => Promise.resolve({}))}
        connection={{ email: 'owner@example.com', expiresAt: null, status: 'connected' }}
        defaultEmail="owner@example.com"
        disconnectAction={noOpAction}
        fundAction={noOpStateAction}
        orgSlug="acme"
        skipAction={noOpAction}
        startAction={vi.fn(() => Promise.resolve({}))}
        syncAction={noOpAction}
        walletCount={5}
      />,
    );

    expect(screen.getByRole('button', { name: 'Request testnet USDC' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open agentOps' })).toHaveAttribute('href', '/app/acme/overview');
    expect(screen.getByRole('button', { name: 'Disconnect Circle' })).toBeInTheDocument();
  });

  it('treats one-to-four synchronized wallets as incomplete and offers a repair sync', () => {
    render(
      <CircleTreasuryOnboarding
        completeAction={vi.fn(() => Promise.resolve({}))}
        connection={{ email: 'owner@example.com', expiresAt: null, status: 'connected' }}
        defaultEmail="owner@example.com"
        disconnectAction={noOpAction}
        fundAction={noOpStateAction}
        orgSlug="acme"
        skipAction={noOpAction}
        startAction={vi.fn(() => Promise.resolve({}))}
        syncAction={noOpAction}
        walletCount={3}
      />,
    );

    expect(screen.getByText('Treasury setup incomplete')).toBeInTheDocument();
    expect(screen.getByText('3 of 5 testnet wallet references synchronized')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue treasury setup' })).toBeInTheDocument();
    expect(screen.queryByText('Five-chain treasury ready')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request testnet USDC' })).not.toBeInTheDocument();
  });

  it('shows a controlled error when every testnet funding request fails', async () => {
    const fundAction = vi.fn(() => Promise.resolve({
      error: 'Circle testnet funding was not available. Review the failed provider jobs before retrying.',
    }));
    render(
      <CircleTreasuryOnboarding
        completeAction={vi.fn(() => Promise.resolve({}))}
        connection={{ email: 'owner@example.com', expiresAt: null, status: 'connected' }}
        defaultEmail="owner@example.com"
        disconnectAction={noOpAction}
        fundAction={fundAction}
        orgSlug="acme"
        skipAction={noOpAction}
        startAction={vi.fn(() => Promise.resolve({}))}
        syncAction={noOpAction}
        walletCount={5}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Request testnet USDC' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      'Circle testnet funding was not available. Review the failed provider jobs before retrying.',
    ));
  });

  it('requires an explicit reset before reconnecting an unreadable Circle session', () => {
    render(
      <CircleTreasuryOnboarding
        completeAction={vi.fn(() => Promise.resolve({}))}
        connection={{ email: '', expiresAt: null, status: 'blocked' }}
        defaultEmail="owner@example.com"
        disconnectAction={noOpAction}
        fundAction={noOpStateAction}
        orgSlug="acme"
        skipAction={noOpAction}
        startAction={vi.fn(() => Promise.resolve({}))}
        syncAction={noOpAction}
        walletCount={5}
      />,
    );

    expect(screen.getByText('Circle connection needs to be reset')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset Circle connection' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Circle Agent Wallet' })).not.toBeInTheDocument();
  });
});
