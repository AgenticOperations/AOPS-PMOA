import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type SectionToolbarProps = {
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
};

export function SectionToolbar({ actions, children, className }: SectionToolbarProps) {
  return (
    <div
      className={cn(
        'flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--bg-panel)] px-3 py-2 ring-1 ring-[var(--border-subtle)]',
        className,
      )}
      data-slot="section-toolbar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
