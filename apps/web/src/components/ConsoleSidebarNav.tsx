'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  IconActivity,
  IconChecks,
  IconDatabaseDollar,
  IconKey,
  IconLayoutDashboard,
  IconListDetails,
  IconLogout,
  IconMessageChatbot,
  IconRobot,
  IconSettings,
  IconShieldCheck,
} from '@tabler/icons-react';
import type { Org } from '@/lib/identity-spine-types';
import { cn } from '@/lib/utils';

type ConsoleSidebarNavProps = {
  readonly className?: string | undefined;
  readonly collapsible?: boolean | undefined;
  readonly onNavigate?: (() => void) | undefined;
  readonly org: Org;
};

const SIDEBAR_IDLE_TIMEOUT_MS = 15_000;

const iconProps = {
  size: 18,
  stroke: 1.8,
} as const;

export function ConsoleSidebarNav({ className, collapsible = true, onNavigate, org }: ConsoleSidebarNavProps) {
  const pathname = usePathname();
  const base = `/app/${org.slug}`;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(collapsible);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointerActivityRef = useRef(0);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current === null) return;
    clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
  }, []);

  const scheduleCollapse = useCallback(() => {
    clearCollapseTimer();
    if (!collapsible || sidebarCollapsed) return;
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('aops-tour-running')) {
      return;
    }

    collapseTimerRef.current = setTimeout(() => {
      if (document.documentElement.classList.contains('aops-tour-running')) return;
      setSidebarCollapsed(true);
    }, SIDEBAR_IDLE_TIMEOUT_MS);
  }, [clearCollapseTimer, collapsible, sidebarCollapsed]);

  useEffect(() => {
    scheduleCollapse();
    return clearCollapseTimer;
  }, [clearCollapseTimer, scheduleCollapse]);

  useEffect(() => {
    function keepExpandedForTour() {
      if (!document.documentElement.classList.contains('aops-tour-running')) return;
      clearCollapseTimer();
      setSidebarCollapsed(false);
    }
    keepExpandedForTour();
    const observer = new MutationObserver(keepExpandedForTour);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [clearCollapseTimer]);

  const registerActivity = useCallback(() => {
    if (!collapsible) return;
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      return;
    }
    scheduleCollapse();
  }, [collapsible, scheduleCollapse, sidebarCollapsed]);

  const handlePointerEnter = () => {
    if (!collapsible) return;
    setSidebarCollapsed(false);
  };

  const handlePointerMove = () => {
    const now = Date.now();
    if (now - lastPointerActivityRef.current < 750) return;
    lastPointerActivityRef.current = now;
    registerActivity();
  };

  const groups = useMemo(
    () => [
      {
        label: 'Workspace',
        items: [
          {
            href: `${base}/overview`,
            icon: <IconLayoutDashboard aria-hidden="true" className="nav-icon" {...iconProps} />,
            label: 'Home',
            tour: 'nav-home',
          },
        ],
      },
      {
        label: 'Identity',
        items: [
          {
            href: `${base}/agents`,
            icon: <IconRobot aria-hidden="true" className="nav-icon" {...iconProps} />,
            label: 'Agents',
            tour: 'nav-agents',
          },
          {
            href: `${base}/controls`,
            icon: <IconShieldCheck aria-hidden="true" className="nav-icon" {...iconProps} />,
            label: 'Controls',
            tour: 'nav-controls',
          },
        ],
      },
      {
        label: 'Runtime',
        items: [
          
          {
            href: `${base}/operations`,
            icon: <IconActivity aria-hidden="true" className="nav-icon" {...iconProps} />,
            label: 'Operations',
            tour: 'nav-operations',
          },
          {
            href: `${base}/approvals`,
            icon: <IconChecks aria-hidden="true" className="nav-icon" {...iconProps} />,
            label: 'Approvals',
            tour: 'nav-approvals',
          },
        ],
      },
    ],
    [base],
  );

  const moneyItems = [
    {
      href: `${base}/payments/funding`,
      icon: <IconDatabaseDollar aria-hidden="true" className="nav-icon" {...iconProps} />,
      label: 'Fund',
      tour: 'nav-fund',
    },
    {
      href: `${base}/payments/empower`,
      icon: <IconKey aria-hidden="true" className="nav-icon" {...iconProps} />,
      label: 'Empower',
      tour: 'nav-empower',
    },
    {
      href: `${base}/payments/activity`,
      icon: <IconListDetails aria-hidden="true" className="nav-icon" {...iconProps} />,
      label: 'Activity',
      tour: 'nav-activity',
    },
  ];

  const isActive = (href: string) => {
    if (!pathname) {
      return false;
    }

    if (href === `${base}/payments/funding`) {
      return pathname === href
        || pathname === `${base}/payments`
        || pathname.startsWith(`${base}/payments/sources`)
        || pathname.startsWith(`${base}/payments/liquidity`);
    }

    if (href === `${base}/payments/empower`) {
      return pathname === href
        || pathname.startsWith(`${base}/payments/agent-access`)
        || pathname.startsWith(`${base}/payments/delegations`);
    }

    if (href === `${base}/agents`) {
      return pathname === href || pathname.startsWith(`${href}/`);
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const handleSidebarClick = (event: MouseEvent<HTMLElement>) => {
    if (onNavigate === undefined || !(event.target instanceof Element)) return;

    const navigationTarget = event.target.closest('a[href], button[type="submit"]');
    if (navigationTarget !== null) onNavigate();
  };

  return (
    <aside
      aria-label="Workspace navigation"
      className={cn('app-sidebar-body', className)}
      data-collapsed={collapsible && sidebarCollapsed}
      data-tour="nav-sidebar"
      onClick={handleSidebarClick}
      onFocusCapture={registerActivity}
      onKeyDownCapture={registerActivity}
      onPointerDown={registerActivity}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
    >
      <div className="sidebar-brand">
        <span className="sidebar-brand-logo-frame">
          <Image
            alt="AOPS"
            className="sidebar-brand-logo"
            height={157}
            priority
            src="/landing/aops-wordmark-nav.png"
            unoptimized
            width={580}
          />
        </span>
      </div>
      <Link className="sidebar-workspace" href="/auth" title={`Switch workspace (${org.name})`}>
        <span className="sidebar-link-label">
          <strong>{org.name}</strong>
        </span>
      </Link>

      <nav aria-label="Primary" className="sidebar-content">
        {groups.slice(0, 3).map((group) => (
          <div className="sidebar-section" key={group.label}>
            <p className="sidebar-section-label">{group.label}</p>
            <div className="sidebar-nav">
              {group.items.map((item) => (
                <Link
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn('sidebar-nav-link', isActive(item.href) && 'nav-active')}
                  data-tour={item.tour}
                  href={item.href}
                  key={item.href}
                  title={item.label}
                >
                  {item.icon}
                  <span className="sidebar-link-label">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}

        <div className="sidebar-section">
          <p className="sidebar-section-label">Treasury</p>
          <div className="sidebar-nav">
            {moneyItems.map((item) => (
              <Link
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={cn('sidebar-nav-link', isActive(item.href) && 'nav-active')}
                data-tour={item.tour}
                href={item.href}
                key={item.href}
                title={item.label}
              >
                {item.icon}
                <span className="sidebar-link-label">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>

      </nav>

      <div className="sidebar-footer">
        <Link
          aria-current={isActive(`${base}/settings`) ? 'page' : undefined}
          className={cn('sidebar-nav-link sidebar-footer-link', isActive(`${base}/settings`) && 'nav-active')}
          href={`${base}/settings`}
          title="Settings"
        >
          <IconSettings aria-hidden="true" className="nav-icon" {...iconProps} />
          <span className="sidebar-link-label">Settings</span>
        </Link>
        <form action="/api/auth/logout" className="logout-form" method="post">
          <button aria-label="Logout" className="sidebar-logout-btn" title="Logout" type="submit">
            <IconLogout aria-hidden="true" className="logout-icon" size={18} stroke={1.8} />
            <span className="sidebar-link-label">Logout</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
