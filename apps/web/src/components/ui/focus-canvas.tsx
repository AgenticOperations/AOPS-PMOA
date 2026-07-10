import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type FocusCanvasProps = {
  readonly children: ReactNode;
  readonly className?: string;
};

export function FocusCanvas({ children, className }: FocusCanvasProps) {
  return (
    <div
      className={cn(
        'grid gap-5 rounded-xl bg-[var(--bg-panel)] p-5 ring-1 ring-[var(--border-subtle)]',
        className,
      )}
      data-slot="focus-canvas"
    >
      {children}
    </div>
  );
}

export function FocusCanvasFooter({ children, className }: FocusCanvasProps) {
  return (
    <div
      className={cn(
        'sticky bottom-0 -mx-5 -mb-5 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] px-5 py-4',
        className,
      )}
      data-slot="focus-canvas-footer"
    >
      {children}
    </div>
  );
}
