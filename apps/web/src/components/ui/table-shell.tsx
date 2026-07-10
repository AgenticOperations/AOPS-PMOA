import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type TableShellProps = {
  readonly children: ReactNode;
  readonly className?: string;
  readonly maxHeight?: number;
};

export function TableShell({ children, className, maxHeight = 560 }: TableShellProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl bg-[var(--bg-panel)] ring-1 ring-[var(--border-subtle)]',
        className,
      )}
    >
      <div
        className="table-shell-scroll overflow-auto"
        style={{ maxHeight }}
      >
        {children}
      </div>
    </div>
  );
}
