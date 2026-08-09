import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleShell } from '../src/components/ConsoleShell.js';

vi.mock('../src/components/platform-tour/PlatformTour.js', () => ({
  PlatformTour: () => null,
  requestPlatformTourReplay: () => {},
}));

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
    expect(screen.getAllByText('Workspace')).toHaveLength(1);
    expect(screen.queryByText('Org')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AOPS' })).toHaveAttribute(
      'src',
      '/landing/aops-wordmark-nav.png',
    );

    expect(screen.getAllByRole('link', { name: 'Home' })[0]).toHaveAttribute(
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
    expect(screen.getByText('Treasury')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Approvals/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/approvals',
    );
    expect(screen.getByRole('link', { name: /^Fund$/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/payments/funding',
    );
    expect(screen.queryByRole('link', { name: /^Empower$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Activity$/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/activity',
    );
    expect(screen.getByRole('link', { name: /^Purchases$/i })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/marketplace',
    );
    expect(screen.queryByRole('link', { name: /^Fleet Run$/i })).not.toBeInTheDocument();
    const settingsLink = screen.getByRole('link', { name: /Settings/i });
    expect(settingsLink).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/settings',
    );
    expect(settingsLink).toHaveClass('sidebar-footer-link');
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Expand Treasury navigation/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Coming in Section/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Wallets')).not.toBeInTheDocument();
  });

  it('opens the collapsed desktop rail on hover without a redundant close control', () => {
    pathname = '/app/acme-agent-ops/overview';

    render(
      <ConsoleShell active="overview" org={org}>
        <p>Workspace content</p>
      </ConsoleShell>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Workspace navigation' });
    expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    expect(within(sidebar).queryByRole('button', { name: /sidebar/i })).not.toBeInTheDocument();

    fireEvent.pointerEnter(sidebar);

    expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    const workspaceLink = within(sidebar).getByTitle('Switch workspace (Acme Agent Ops)');
    expect(workspaceLink.querySelector('svg')).toBeNull();
  });

  it('auto-collapses the expanded rail after fifteen seconds without activity', () => {
    vi.useFakeTimers();
    pathname = '/app/acme-agent-ops/overview';

    try {
      render(
        <ConsoleShell active="overview" org={org}>
          <p>Workspace content</p>
        </ConsoleShell>,
      );

      const sidebar = screen.getByRole('complementary', { name: 'Workspace navigation' });
      fireEvent.pointerEnter(sidebar);
      expect(sidebar).toHaveAttribute('data-collapsed', 'false');

      act(() => {
        vi.advanceTimersByTime(14_999);
      });
      expect(sidebar).toHaveAttribute('data-collapsed', 'false');

      fireEvent.pointerDown(sidebar);
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks nested Treasury Fund route active when viewing advanced networks', () => {
    pathname = '/app/acme-agent-ops/payments/sources';

    render(
      <ConsoleShell active="payments" org={org}>
        <p>Workspace content</p>
      </ConsoleShell>,
    );

    expect(screen.getByRole('link', { name: /^Fund$/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('keeps mobile navigation open and closes after a Treasury route is chosen', async () => {
    pathname = '/app/acme-agent-ops/controls';
    const user = userEvent.setup();

    render(
      <ConsoleShell active="controls" org={org}>
        <p>Workspace content</p>
      </ConsoleShell>,
    );

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const dialog = screen.getByRole('dialog', { name: 'Workspace navigation' });

    await user.click(within(dialog).getByRole('link', { name: /^Fund$/i }));
    expect(screen.queryByRole('dialog', { name: 'Workspace navigation' })).not.toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: /Jump/i }));

    const dialog = screen.getByRole('dialog', { name: /Page jump/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Jump to a console page/i )).toBeInTheDocument();
    expect(screen.queryByText(/Search agents/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Search policies/i)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('option', { name: /^Fund$/i }));
    expect(push).toHaveBeenCalledWith('/app/acme-agent-ops/payments/funding');
  });

  it('closes the page-jump palette with Escape and restores focus to its launcher', async () => {
    pathname = '/app/acme-agent-ops/overview';
    const user = userEvent.setup();

    render(
      <ConsoleShell active="overview" org={org}>
        <p>Workspace content</p>
      </ConsoleShell>,
    );

    const launcher = screen.getByRole('button', { name: /Jump/i });
    await user.click(launcher);
    expect(screen.getByRole('dialog', { name: /Page jump/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: /Page jump/i })).not.toBeInTheDocument();
    expect(launcher).toHaveFocus();
  });
});
