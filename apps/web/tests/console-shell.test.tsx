import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleShell } from '../src/components/ConsoleShell.js';

let pathname = '/app/acme-agent-ops/controls';
const push = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}));

const org = {
  id: 'org_acme',
  name: 'Acme Agent Ops',
  slug: 'acme-agent-ops',
  default_team_id: 'team_default',
  settings: {},
  status: 'active' as const,
};

describe('ConsoleShell', () => {
  it('renders grouped route-aware navigation and Treasury subroutes', () => {
    pathname = '/app/acme-agent-ops/controls';
    render(
      <ConsoleShell active="controls" org={org}>
        <p>Workspace content</p>
      </ConsoleShell>,
    );

    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getAllByText('Treasury').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Org')).toBeInTheDocument();

    expect(screen.getAllByRole('link', { name: 'Overview' })[0]).toHaveAttribute(
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
    expect(screen.getByRole('link', { name: 'Treasury' })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/payments',
    );
    expect(screen.getByRole('link', { name: /Approvals/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/approvals',
    );
    expect(screen.getByRole('link', { name: /Sources & Rails/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/payments/sources',
    );
    expect(screen.getByRole('link', { name: /Agent Access/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/payments/agent-access',
    );
    expect(screen.getByRole('link', { name: /Liquidity/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/payments/liquidity',
    );
    expect(screen.getByRole('link', { name: /Activity & Evidence/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/payments/activity',
    );
    expect(screen.getByRole('link', { name: /Settings/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/settings',
    );
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Expand Treasury navigation/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTitle(/Coming in Section/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Wallets')).not.toBeInTheDocument();
  });

  it('opens Treasury navigation and marks nested payment route active from pathname', () => {
    pathname = '/app/acme-agent-ops/payments/sources';

    render(
      <ConsoleShell active="payments" org={org}>
        <p>Workspace content</p>
      </ConsoleShell>,
    );

    expect(screen.getByRole('button', { name: /Collapse Treasury navigation/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: /Sources & Rails/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('opens a page-jump command palette without fake entity search', async () => {
    pathname = '/app/acme-agent-ops/overview';
    push.mockClear();
    const user = userEvent.setup();

    render(
      <ConsoleShell active="overview" org={org}>
        <p>Workspace content</p>
      </ConsoleShell>,
    );

    await user.click(screen.getByRole('button', { name: /Open command menu/i }));

    const dialog = screen.getByRole('dialog', { name: /Page jump/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Jump to a console page/i)).toBeInTheDocument();
    expect(screen.queryByText(/Search agents/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Search policies/i)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('option', { name: /Agent Access/i }));
    expect(push).toHaveBeenCalledWith('/app/acme-agent-ops/payments/agent-access');
  });
});
