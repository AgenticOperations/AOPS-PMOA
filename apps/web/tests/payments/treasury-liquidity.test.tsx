import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TreasuryLiquidity } from '../../src/components/payments/TreasuryLiquidity.js';

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

describe('TreasuryLiquidity', () => {
  it('renders a failed liquidity job with a retry action', () => {
    render(
      <TreasuryLiquidity
        bridgeTopUpAction={async () => {}}
        cancelLiquidityJobAction={async () => {}}
        capabilities={[capability]}
        liquidityJobs={[
          {
            id: 'cjob_1',
            org_id: 'org_1',
            mode: 'test',
            job_type: 'liquidity.prepare',
            chain: 'base',
            status: 'failed',
            amount_usdc: '0.05',
            provider_ref: null,
            error_code: 'circle_cli_command_failed',
            metadata: { rail: 'gateway_base' },
            created_at: '2026-07-08T08:00:00.000Z',
            updated_at: '2026-07-08T08:00:00.000Z',
          },
        ]}
        orgSlug="openassets-qa-workspace"
        providerState="ready"
        reconcileJobsAction={async () => {}}
        rebalanceRecommendations={[]}
        retryLiquidityJobAction={async () => {}}
      />,
    );

    expect(screen.getByText('Gateway · Base')).toBeInTheDocument();
    expect(screen.getByText(/No exact-wallet top-up is recommended/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open job cjob_1' }));
    expect(screen.getByRole('button', { name: 'Retry job' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Move liquidity' }));
    expect(screen.getByRole('dialog', { name: 'Move exact-wallet liquidity' })).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toHaveValue('0.05');
  });

  it('shows an empty state when there are no liquidity jobs', () => {
    render(
      <TreasuryLiquidity
        bridgeTopUpAction={async () => {}}
        cancelLiquidityJobAction={async () => {}}
        capabilities={[capability]}
        liquidityJobs={[]}
        orgSlug="openassets-qa-workspace"
        providerState="ready"
        reconcileJobsAction={async () => {}}
        rebalanceRecommendations={[]}
        retryLiquidityJobAction={async () => {}}
      />,
    );

    expect(screen.getByText('No liquidity jobs')).toBeInTheDocument();
  });

  it('fails closed during provider outages and confirms job cancellation', () => {
    render(
      <TreasuryLiquidity
        bridgeTopUpAction={async () => {}}
        cancelLiquidityJobAction={async () => {}}
        capabilities={[capability]}
        liquidityJobs={[{
          id: 'cjob_queued', org_id: 'org_1', mode: 'test', job_type: 'liquidity.prepare', chain: 'base',
          status: 'queued', amount_usdc: '0.05', provider_ref: null, error_code: null, metadata: {},
          created_at: '2026-07-08T08:00:00.000Z', updated_at: '2026-07-08T08:00:00.000Z',
        }]}
        orgSlug="openassets-qa-workspace"
        providerState="unavailable"
        reconcileJobsAction={async () => {}}
        rebalanceRecommendations={[]}
        retryLiquidityJobAction={async () => {}}
      />,
    );

    expect(screen.getByText('Circle provider status is unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move liquidity' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open job cjob_queued' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel job' }));
    expect(screen.getByRole('button', { name: 'Confirm cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep job' })).toBeInTheDocument();
  });
});
