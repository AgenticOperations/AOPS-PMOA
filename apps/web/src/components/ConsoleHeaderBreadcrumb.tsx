'use client';

import { usePathname } from 'next/navigation';

const LABELS = {
  overview: 'Home',
  agents: 'Agents',
  controls: 'Controls',
  operations: 'Operations',
  payments: 'Treasury',
  approvals: 'Approvals',
  settings: 'Settings',
} as const;

export type ConsoleSection = keyof typeof LABELS;

export function resolveConsoleSection(pathname: string): ConsoleSection {
  if (pathname.includes('/agents')) return 'agents';
  if (pathname.includes('/controls')) return 'controls';
  if (pathname.includes('/operations')) return 'operations';
  if (pathname.includes('/payments')) return 'payments';
  if (pathname.includes('/approvals')) return 'approvals';
  if (pathname.includes('/settings')) return 'settings';
  return 'overview';
}

type ConsoleHeaderBreadcrumbProps = {
  readonly active?: ConsoleSection | undefined;
};

export function ConsoleHeaderBreadcrumb({ active }: ConsoleHeaderBreadcrumbProps) {
  const pathname = usePathname();
  const section = active ?? resolveConsoleSection(pathname);

  return (
    <>
      <span className="header-breadcrumb">Console</span>
      <span className="header-breadcrumb-divider">/</span>
      <span className="header-breadcrumb-current">{LABELS[section]}</span>
    </>
  );
}
