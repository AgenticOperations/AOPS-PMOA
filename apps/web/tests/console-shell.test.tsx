import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConsoleShell } from '../src/components/ConsoleShell.js';

const org = {
  id: 'org_acme',
  name: 'Acme Agent Ops',
  slug: 'acme-agent-ops',
  default_team_id: 'team_default',
  settings: {},
  status: 'active' as const,
};

describe('ConsoleShell', () => {
  it('renders only functional navigation through Section 5', () => {
    render(
      <ConsoleShell active="controls" org={org}>
        <p>Workspace content</p>
      </ConsoleShell>,
    );

    expect(screen.getByRole('link', { name: /Overview/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/overview',
    );
    expect(screen.getByRole('link', { name: /Agents/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/agents',
    );
    expect(screen.getByRole('link', { name: /Controls/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/controls',
    );
    expect(screen.getByRole('link', { name: /Operations/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/operations',
    );
    expect(screen.getByRole('link', { name: /Approvals/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/approvals',
    );
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
    expect(screen.queryByTitle(/Coming in Section/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Wallets')).not.toBeInTheDocument();
  });
});
