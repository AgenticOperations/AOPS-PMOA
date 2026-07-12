import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TreasuryActionTabs } from '../../src/components/payments/TreasuryActionTabs.js';

const capability = {
  chain: 'base' as const,
  circle_blockchain: 'BASE',
  gateway_domain: 6,
  gateway_supported: true,
  gateway_settlement_verified: true,
  id: 'cap_base',
  mode: 'test' as const,
  nanopayments_supported: true,
  network_label: 'Base Sepolia',
  status: 'active' as const,
  wallet_account_type: 'sca' as const,
  exact_settlement_verified: true,
  wallet_supported: true,
};

describe('TreasuryActionTabs', () => {
  it('keeps the Gateway deposit form out of the page until the operator opens it', () => {
    render(
      <TreasuryActionTabs
        activeWalletCount={1}
        capabilities={[capability]}
        gatewayDepositAction={async () => {}}
        providerReady
      />,
    );

    expect(screen.queryByLabelText('Chain')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deposit' }));
    expect(screen.getByRole('dialog', { name: 'Deposit to Gateway' })).toBeInTheDocument();
    expect(screen.getByLabelText('Chain')).toHaveValue('base');
  });

  it('keeps deposits unavailable while provider health cannot be verified', () => {
    render(
      <TreasuryActionTabs
        activeWalletCount={1}
        capabilities={[capability]}
        gatewayDepositAction={async () => {}}
        providerReady={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Deposit' })).toBeDisabled();
  });
});
