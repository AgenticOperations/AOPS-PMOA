import type { ReactNode } from 'react';
import { CommandPalette } from './CommandPalette';
import { ConsoleSidebarNav } from './ConsoleSidebarNav';
import { ThemeToggle } from './ThemeToggle';
import type { Org } from '@/lib/identity-spine-types';

type ConsoleShellProps = {
  readonly active: 'overview' | 'agents' | 'controls' | 'operations' | 'payments' | 'approvals' | 'settings';
  readonly children: ReactNode;
  readonly org: Org;
};

export function ConsoleShell({ active, children, org }: ConsoleShellProps) {
  const currentLabel =
    active === 'overview'
      ? 'Overview'
      : active === 'agents'
        ? 'Agents'
        : active === 'controls'
          ? 'Controls'
          : active === 'operations'
            ? 'Operations'
            : active === 'payments'
              ? 'Treasury'
              : active === 'approvals'
                ? 'Approvals'
                : 'Settings';

  return (
    <main className="console-shell">
      <ConsoleSidebarNav org={org} />

      <section className="app-frame">
        <header className="app-header">
          <div className="app-header-left">
            <span className="header-breadcrumb">Console</span>
            <span className="header-breadcrumb-divider">/</span>
            <span className="header-breadcrumb-current">{currentLabel}</span>
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
