import type { ReactNode } from 'react';
import Link from 'next/link';
import { IconShoppingBag } from '@tabler/icons-react';
import { CommandPalette } from './CommandPalette';
import { ConsoleSidebarNav } from './ConsoleSidebarNav';
import { ConsoleMobileNavigation } from './ConsoleMobileNavigation';
import { ConsoleHeaderBreadcrumb, type ConsoleSection } from './ConsoleHeaderBreadcrumb';
import { ThemeToggle } from './ThemeToggle';
import type { Org } from '@/lib/identity-spine-types';

type ConsoleShellProps = {
  /** Optional override for tests; otherwise derived from the current pathname. */
  readonly active?: ConsoleSection | undefined;
  readonly children: ReactNode;
  readonly org: Org;
};

export function ConsoleShell({ active, children, org }: ConsoleShellProps) {
  return (
    <main className="console-shell">
      <ConsoleSidebarNav org={org} />

      <section className="app-frame">
        <header className="app-header">
          <div className="app-header-left">
            <ConsoleMobileNavigation org={org} />
            <ConsoleHeaderBreadcrumb active={active} />
          </div>
          <div className="app-header-actions">
            <Link className="console-hire-cta" href="/marketplace">
              <IconShoppingBag aria-hidden="true" size={16} stroke={1.8} />
              <span>Hire from marketplace</span>
            </Link>
            <CommandPalette orgSlug={org.slug} />
            <ThemeToggle />
          </div>
        </header>
        <div className="workspace">{children}</div>
      </section>
    </main>
  );
}
