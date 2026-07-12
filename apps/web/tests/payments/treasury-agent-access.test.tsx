import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TreasuryAgentAccess } from '../../src/components/payments/TreasuryAgentAccess.js';

const agent = {
  id: 'agt_trade',
  name: 'Trade research agent',
  status: 'active' as const,
  labels: [],
  team: { id: 'team_default', name: 'Default' },
  connection_health: 'healthy' as const,
  wallet_refs_count: 0,
  policy_coverage: 0,
  last_activity_at: null,
};

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

const avalancheCapability = {
  ...capability,
  chain: 'avalanche' as const,
  circle_blockchain: 'AVAX-FUJI',
  gateway_domain: 1,
  id: 'cap_avalanche',
  network_label: 'Avalanche Fuji',
};

describe('TreasuryAgentAccess', () => {
  it('renders an agent with active payment access and a populated budget', () => {
    render(
      <TreasuryAgentAccess
        accessAction={async () => {}}
        accounts={[
          {
            id: 'payacct_1',
            org_id: 'org_1',
            agent_id: agent.id,
            status: 'active',
            payment_access: true,
            budget_usdc: '5.00',
            spent_usdc: '1.25',
            reserved_usdc: '0.00',
            per_request_cap_usdc: '2.00',
            approval_threshold_usdc: null,
            dedicated_wallet_required: false,
            allowed_rails: ['gateway_base'],
            created_at: '2026-07-08T08:00:00.000Z',
            updated_at: '2026-07-08T08:00:00.000Z',
          },
        ]}
        agents={[agent]}
        capabilities={[capability]}
        orgSlug="sample-qa-workspace"
      />,
    );

    expect(screen.getAllByText('Trade research agent').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByText('5.00 USDC')).toBeInTheDocument();
  });

  it('shows an empty state when there are no agents', () => {
    render(
      <TreasuryAgentAccess
        accessAction={async () => {}}
        accounts={[]}
        agents={[]}
        capabilities={[capability]}
        orgSlug="sample-qa-workspace"
      />,
    );

    expect(screen.getByText('No agents yet')).toBeInTheDocument();
  });

  it('loads the selected agent saved limits and rails into the edit form', () => {
    const secondAgent = { ...agent, id: 'agt_ops', name: 'Operations agent' };
    render(
      <TreasuryAgentAccess
        accessAction={async () => {}}
        accounts={[
          {
            id: 'payacct_1',
            org_id: 'org_1',
            agent_id: agent.id,
            status: 'active',
            payment_access: true,
            budget_usdc: '5.00',
            spent_usdc: '1.25',
            reserved_usdc: '0.00',
            per_request_cap_usdc: '2.00',
            approval_threshold_usdc: null,
            dedicated_wallet_required: false,
            allowed_rails: ['gateway_base'],
            created_at: '2026-07-08T08:00:00.000Z',
            updated_at: '2026-07-08T08:00:00.000Z',
          },
          {
            id: 'payacct_2',
            org_id: 'org_1',
            agent_id: secondAgent.id,
            status: 'active',
            payment_access: true,
            budget_usdc: '7.50',
            spent_usdc: '0.00',
            reserved_usdc: '0.00',
            per_request_cap_usdc: '3.25',
            approval_threshold_usdc: '2.00',
            dedicated_wallet_required: false,
            allowed_rails: ['gateway_avalanche'],
            created_at: '2026-07-08T08:00:00.000Z',
            updated_at: '2026-07-08T08:00:00.000Z',
          },
        ]}
        agents={[agent, secondAgent]}
        capabilities={[capability, avalancheCapability]}
        orgSlug="sample-qa-workspace"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: secondAgent.id } });

    expect(screen.getByLabelText('Monthly budget')).toHaveValue('7.50');
    expect(screen.getByLabelText('Per request')).toHaveValue('3.25');
    expect(screen.getByLabelText('Approval threshold')).toHaveValue('2.00');
    expect(screen.getByLabelText(/Gateway · Avalanche/)).toBeChecked();
    expect(screen.getByLabelText(/Gateway · Base/)).not.toBeChecked();
  });

  it('keeps the selected agent aligned with refreshed account values after save', () => {
    const secondAgent = { ...agent, id: 'agt_ops', name: 'Operations agent' };
    const firstAccount = {
      id: 'payacct_1',
      org_id: 'org_1',
      agent_id: agent.id,
      status: 'active' as const,
      payment_access: true,
      budget_usdc: '5.00',
      spent_usdc: '1.25',
      reserved_usdc: '0.00',
      per_request_cap_usdc: '2.00',
      approval_threshold_usdc: null,
      dedicated_wallet_required: false,
      allowed_rails: ['gateway_base'] as const,
      created_at: '2026-07-08T08:00:00.000Z',
      updated_at: '2026-07-08T08:00:00.000Z',
    };
    const secondAccount = {
      ...firstAccount,
      id: 'payacct_2',
      agent_id: secondAgent.id,
      budget_usdc: '7.50',
      spent_usdc: '0.00',
      per_request_cap_usdc: '3.25',
      approval_threshold_usdc: '2.00',
      allowed_rails: ['gateway_avalanche'] as const,
    };
    const props = {
      accessAction: async () => {},
      agents: [agent, secondAgent],
      capabilities: [capability, avalancheCapability],
      orgSlug: 'sample-qa-workspace',
    };
    const { rerender } = render(
      <TreasuryAgentAccess {...props} accounts={[firstAccount, secondAccount]} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: secondAgent.id } });
    rerender(
      <TreasuryAgentAccess
        {...props}
        accounts={[
          firstAccount,
          {
            ...secondAccount,
            budget_usdc: '9.00',
            per_request_cap_usdc: '4.00',
            approval_threshold_usdc: '2.50',
            updated_at: '2026-07-08T09:00:00.000Z',
          },
        ]}
      />,
    );

    expect(screen.getByLabelText('Agent')).toHaveValue(secondAgent.id);
    expect(screen.getByLabelText('Monthly budget')).toHaveValue('9.00');
    expect(screen.getByLabelText('Per request')).toHaveValue('4.00');
    expect(screen.getByLabelText('Approval threshold')).toHaveValue('2.50');
  });
});
