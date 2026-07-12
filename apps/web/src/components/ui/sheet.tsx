'use client';

import * as React from 'react';
import { IconX } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

type SheetProps = {
  readonly children: React.ReactNode;
  readonly labelledBy: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly panelClassName?: string | undefined;
  readonly side?: 'right' | 'left';
};

function Sheet({ children, labelledBy, onOpenChange, open, panelClassName, side = 'right' }: SheetProps) {
  React.useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onOpenChange, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="sheet-root" data-side={side}>
      <button
        aria-label="Close panel"
        className="sheet-backdrop"
        onClick={() => onOpenChange(false)}
        type="button"
      />
      <aside
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={cn('sheet-panel', side === 'left' && 'sheet-panel-left', panelClassName)}
        role="dialog"
      >
        {children}
      </aside>
    </div>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('sheet-header', className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('sheet-title', className)} {...props} />;
}

function SheetDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('sheet-description', className)} {...props} />;
}

function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('sheet-body', className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('sheet-footer', className)} {...props} />;
}

function SheetCloseButton({ className, onClick }: { readonly className?: string; readonly onClick: () => void }) {
  return (
    <button aria-label="Close panel" className={cn('sheet-close', className)} onClick={onClick} type="button">
      <IconX aria-hidden="true" size={17} />
    </button>
  );
}

export {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  SheetFooter,
  SheetCloseButton,
};
