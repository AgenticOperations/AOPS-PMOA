import type { ReactNode } from 'react';
import {
  IconActivity,
  IconAdjustmentsHorizontal,
  IconChecks,
  IconCreditCard,
  IconDatabaseSearch,
  IconFilterOff,
  IconRobot,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconWallet,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';

type EmptyStateVariant =
  | 'agents'
  | 'policies'
  | 'approvals'
  | 'operations'
  | 'treasury'
  | 'payments'
  | 'activity'
  | 'settings'
  | 'search'
  | 'filter'
  | 'generic';

type EmptyStateProps = {
  readonly action?: ReactNode;
  readonly className?: string;
  readonly description: string;
  readonly title: string;
  readonly variant?: EmptyStateVariant;
};

const icons = {
  agents: IconRobot,
  policies: IconShieldCheck,
  approvals: IconChecks,
  operations: IconAdjustmentsHorizontal,
  treasury: IconWallet,
  payments: IconCreditCard,
  activity: IconActivity,
  settings: IconSettings,
  search: IconSearch,
  filter: IconFilterOff,
  generic: IconDatabaseSearch,
} as const;

export function EmptyState({ action, className, description, title, variant = 'generic' }: EmptyStateProps) {
  const Icon = icons[variant];

  return (
    <div
      className={cn(
        'grid min-h-48 place-items-center rounded-xl bg-[var(--bg-panel)] px-6 py-10 text-center ring-1 ring-[var(--border-subtle)]',
        className,
      )}
      data-empty-state={variant}
    >
      <div className="grid max-w-sm justify-items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--bg-soft)] text-[var(--text-muted)] ring-1 ring-[var(--border-subtle)]">
          <Icon aria-hidden="true" size={18} stroke={1.8} />
        </div>
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="text-sm leading-5 text-[var(--text-muted)]">{description}</p>
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}
