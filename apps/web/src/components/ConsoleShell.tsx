import type { ReactNode } from 'react';
import Link from 'next/link';
import { IconMessageChatbot, IconShoppingBag } from '@tabler/icons-react';
import { CommandPalette } from './CommandPalette';
import { ConsoleSidebarNav } from './ConsoleSidebarNav';
import { ConsoleMobileNavigation } from './ConsoleMobileNavigation';
import { ConsoleHeaderBreadcrumb, type ConsoleSection } from './ConsoleHeaderBreadcrumb';
import { ThemeToggle } from './ThemeToggle';
import { PlatformTour } from './platform-tour/PlatformTour';
import { TourReplayButton } from './platform-tour/TourReplayButton';
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
            <Link className="console-hire-cta console-hire-cta-secondary" href="/chat">
              <IconMessageChatbot aria-hidden="true" size={16} stroke={1.8} />
              <span>Chat with agent</span>
            </Link>
            <Link className="console-hire-cta" data-tour="hire-cta" href="/marketplace">
              <IconShoppingBag aria-hidden="true" size={16} stroke={1.8} />
              <span>Hire from marketplace</span>
            </Link>
            <TourReplayButton />
            <CommandPalette orgSlug={org.slug} />
            <ThemeToggle />
          </div>
        </header>
        <div className="workspace">{children}</div>
      </section>
      <PlatformTour orgSlug={org.slug} />
    </main>
  );
}
