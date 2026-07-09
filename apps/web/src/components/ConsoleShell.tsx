import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';
import type { Org } from '@/lib/identity-spine-types';

type ConsoleShellProps = {
  readonly active: 'overview' | 'agents' | 'controls' | 'operations' | 'payments' | 'approvals';
  readonly children: ReactNode;
  readonly org: Org;
};

const navItems = [
  {
    key: 'overview',
    label: 'Overview',
    href: (slug: string) => `/app/${slug}/overview`,
    icon: <OverviewIcon />,
  },
  {
    key: 'agents',
    label: 'Agents',
    href: (slug: string) => `/app/${slug}/agents`,
    icon: <AgentsIcon />,
  },
  {
    key: 'controls',
    label: 'Controls',
    href: (slug: string) => `/app/${slug}/controls`,
    icon: <ControlsIcon />,
  },
  {
    key: 'operations',
    label: 'Operations',
    href: (slug: string) => `/app/${slug}/operations`,
    icon: <OperationsIcon />,
  },
  {
    key: 'payments',
    label: 'Payments',
    href: (slug: string) => `/app/${slug}/payments`,
    icon: <PaymentsIcon />,
  },
  {
    key: 'approvals',
    label: 'Approvals',
    href: (slug: string) => `/app/${slug}/approvals`,
    icon: <ApprovalsIcon />,
  },
] as const;

export function ConsoleShell({ active, children, org }: ConsoleShellProps) {
  return (
    <main className="console-shell">
      <aside aria-label="Workspace navigation" className="app-sidebar-body">
        <Link className="sidebar-workspace" href="/auth" title={`Switch workspace (${org.name})`}>
          <span aria-hidden="true" className="sidebar-workspace-mark">
            {org.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="sidebar-link-label">
            <span>Workspace</span>
            <strong>{org.name}</strong>
          </span>
        </Link>

        <nav aria-label="Primary" className="sidebar-content">
          <div className="sidebar-section">
            <div className="sidebar-nav">
              {navItems.map((item) => (
                <Link
                  className={`sidebar-nav-link ${active === item.key ? 'nav-active' : ''}`}
                  href={item.href(org.slug)}
                  key={item.key}
                >
                  {item.icon}
                  <span className="sidebar-link-label">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </nav>

        <div className="sidebar-footer">
          <form action="/api/auth/logout" className="logout-form" method="post">
            <button aria-label="Logout" className="sidebar-logout-btn" title="Logout" type="submit">
              <LogoutIcon />
              <span className="sidebar-link-label">Logout</span>
            </button>
          </form>
        </div>
      </aside>

      <section className="app-frame">
        <header className="app-header">
          <div className="app-header-left">
            <span className="header-breadcrumb">Console</span>
            <span className="header-breadcrumb-divider">/</span>
            <span className="header-breadcrumb-current">
              {active === 'overview'
                ? 'Overview'
                : active === 'agents'
                  ? 'Agents'
                  : active === 'controls'
                    ? 'Controls'
                    : active === 'operations'
                      ? 'Operations'
                      : active === 'payments'
                        ? 'Payments'
                        : 'Approvals'}
            </span>
          </div>
          <div className="app-header-actions">
            <ThemeToggle />
          </div>
        </header>
        <div className="workspace">{children}</div>
      </section>
    </main>
  );
}

function OverviewIcon() {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect height="9" rx="1" width="7" x="3" y="3" />
      <rect height="5" rx="1" width="7" x="14" y="3" />
      <rect height="9" rx="1" width="7" x="14" y="12" />
      <rect height="5" rx="1" width="7" x="3" y="16" />
    </svg>
  );
}

function AgentsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect height="16" rx="2" width="16" x="4" y="4" />
      <rect height="6" width="6" x="9" y="9" />
      <line x1="9" x2="9" y1="1" y2="4" />
      <line x1="15" x2="15" y1="1" y2="4" />
      <line x1="9" x2="9" y1="20" y2="23" />
      <line x1="15" x2="15" y1="20" y2="23" />
      <line x1="20" x2="23" y1="9" y2="9" />
      <line x1="20" x2="23" y1="15" y2="15" />
      <line x1="1" x2="4" y1="9" y2="9" />
      <line x1="1" x2="4" y1="15" y2="15" />
    </svg>
  );
}

function ControlsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M12 3 20 7v5c0 5-3.3 8-8 9-4.7-1-8-4-8-9V7l8-4Z" />
      <path d="m9 12 2 2 4-5" />
    </svg>
  );
}

function ApprovalsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M4 4h16v16H4z" />
      <path d="m8 12 2.5 2.5L16 9" />
      <path d="M8 17h8" />
    </svg>
  );
}

function OperationsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h10" />
      <circle cx="18" cy="17" r="2" />
    </svg>
  );
}

function PaymentsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect height="14" rx="2" width="18" x="3" y="5" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
      <path d="M15 15h2" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      aria-hidden="true"
      className="logout-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}
