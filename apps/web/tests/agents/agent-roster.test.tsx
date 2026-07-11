import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentRoster } from '../../src/components/agents/AgentRoster.js';

describe('AgentRoster', () => {
  it('shows Section 1 identity fields without leading with finance data', () => {
    render(
      <AgentRoster
        agents={[
          {
            id: 'agt_research',
            name: 'Research agent',
            status: 'active',
            labels: ['research', 'safe-browser'],
            team: { id: 'team_default', name: 'Default' },
            connection_health: 'not_connected',
            wallet_refs_count: 0,
            policy_coverage: 0,
            last_activity_at: null,
          },
        ]}
        orgSlug="acme-agent-ops"
      />,
    );

    expect(screen.getByRole('link', { name: /Research agent/ })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/agents/agt_research',
    );
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText('No policies')).toBeInTheDocument();
    expect(screen.getByText('No activity')).toBeInTheDocument();
    expect(screen.queryByText('Labels')).not.toBeInTheDocument();
    expect(screen.queryByText('research')).not.toBeInTheDocument();
    expect(screen.queryByText(/float/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/spendable/i)).not.toBeInTheDocument();
  });

  it('renders a useful empty state', () => {
    render(<AgentRoster agents={[]} orgSlug="empty-org" />);

    expect(screen.getByText('No agents registered')).toBeInTheDocument();
    expect(
      screen.getByText('Register the first identity, then issue its access credential from the detail page.'),
    ).toBeInTheDocument();
  });
});
