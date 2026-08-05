import type { ReactNode } from 'react';
import { CommandPalette } from './CommandPalette';
import { ConsoleSidebarNav } from './ConsoleSidebarNav';
import { ConsoleMobileNavigation } from './ConsoleMobileNavigation';
import { ThemeToggle } from './ThemeToggle';
import type { Org } from '@/lib/identity-spine-types';

type ConsoleShellProps = {
  readonly active: 'overview' | 'agents' | 'controls' | 'operations' | 'payments' | 'approvals' | 'settings';
  readonly children: ReactNode;
  readonly org: Org;
};

const ACTIVE_LABELS: Record<ConsoleShellProps['active'], string> = {
  overview: 'Overview',
  agents: 'Agents',
  controls: 'Controls',
  operations: 'Operations',
  payments: 'Treasury',
  approvals: 'Approvals',
  settings: 'Settings',
};

export function ConsoleShell({ active, children, org }: ConsoleShellProps) {
  return (
    <main className="console-shell">
      <ConsoleSidebarNav org={org} />

      <section className="app-frame">
        <header className="app-header">
          <div className="app-header-left">
            <ConsoleMobileNavigation org={org} />
            <span className="header-breadcrumb">Console</span>
            <span className="header-breadcrumb-divider">/</span>
            <span className="header-breadcrumb-current">{ACTIVE_LABELS[active]}</span>
          </div>
          <div className="app-header-actions">
            <CommandPalette orgSlug={org.slug} />
            <ThemeToggle />
          </div>
        </header>
        <div className="workspace">{children}</div>
      </section>
    </main>
  );
}
