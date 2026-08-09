import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentSpendPanel } from '../../src/components/agents/AgentSpendPanel.js';
import type { AgentPaymentAccountRecord } from '../../src/lib/payments-types.js';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('../../src/components/wallet/WalletProvider.js', () => ({
  WalletProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../src/components/wallet/DelegateToAgent.js', () => ({
  DelegateToAgent: () => <div>wallet-delegate</div>,
}));

vi.mock('../../src/components/payments/DelegateFromTreasury.js', () => ({
  DelegateFromTreasury: () => <div>treasury-delegate</div>,
}));

vi.mock('../../src/components/wallet/DelegationList.js', () => ({
  DelegationList: ({ delegations }: { delegations: readonly unknown[] }) => (
    <div>{delegations.length === 0 ? 'None yet.' : `${delegations.length} allowances`}</div>
  ),
}));

const account: AgentPaymentAccountRecord = {
  id: 'apa_1',
  org_id: 'org_1',
  agent_id: 'agt_1',
  status: 'active',
  payment_access: true,
  budget_usdc: '10.00',
  spent_usdc: '2.50',
  reserved_usdc: '1.00',
  per_request_cap_usdc: '2.00',
  approval_threshold_usdc: '5.00',
  dedicated_wallet_required: true,
  allowed_rails: ['exact_arc'],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('AgentSpendPanel', () => {
  it('shows important payment limits and empty allowances for one agent', () => {
    render(
      <AgentSpendPanel
        accessAction={async () => undefined}
        account={account}
        agentId="agt_1"
        agentName="Writer"
        agentWallets={[]}
        capabilities={[]}
        canEdit
        delegations={[]}
        orgSlug="acme"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Spend' })).toBeInTheDocument();
    expect(screen.getByText('Left this month')).toBeInTheDocument();
    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getByText('Per request')).toBeInTheDocument();
    expect(screen.getByText('Approval over')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit access' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add allowance' })).toBeInTheDocument();
    expect(screen.getByText('None yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Org ceiling on Fund' })).toHaveAttribute(
      'href',
      '/app/acme/payments/funding',
    );
  });

  it('offers Grant access when the agent has no payment account', () => {
    render(
      <AgentSpendPanel
        accessAction={async () => undefined}
        account={null}
        agentId="agt_1"
        agentName="Writer"
        agentWallets={[]}
        capabilities={[]}
        canEdit
        delegations={[]}
        orgSlug="acme"
      />,
    );

    expect(screen.getByText('No payment access yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant access' })).toBeInTheDocument();
  });
});
