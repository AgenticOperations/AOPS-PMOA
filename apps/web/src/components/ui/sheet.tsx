'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
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

const openSheetStack: symbol[] = [];

function Sheet({ children, labelledBy, onOpenChange, open, panelClassName, side = 'right' }: SheetProps) {
  const panelRef = React.useRef<HTMLElement>(null);
  const onOpenChangeRef = React.useRef(onOpenChange);
  const sheetIdRef = React.useRef(Symbol('sheet'));
  const [mounted, setMounted] = React.useState(false);

  // Tracks whether we are in the DOM (stays true during exit animation).
  const [rendered, setRendered] = React.useState(false);
  // Drive the data-state attribute to trigger CSS enter/exit animations.
  const [animState, setAnimState] = React.useState<'open' | 'closed'>('closed');

  React.useEffect(() => { setMounted(true); }, []);

  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  React.useEffect(() => {
    if (open) {
      setRendered(true);
      // Let the DOM paint the closed state first, then flip to open.
      requestAnimationFrame(() => setAnimState('open'));
    } else {
      // Flip to closed — CSS exit animation plays, onAnimationEnd unmounts.
      setAnimState('closed');
    }
  }, [open]);

  // Focus management + scroll lock.
  React.useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const sheetId = sheetIdRef.current;
    openSheetStack.push(sheetId);
    document.body.style.overflow = 'hidden';

    const focusableSelector = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const focusFirst = () => {
      const firstFocusable = panelRef.current?.querySelector<HTMLElement>(focusableSelector);
      (firstFocusable ?? panelRef.current)?.focus();
    };
    focusFirst();

    const onKeyDown = (event: KeyboardEvent) => {
      if (openSheetStack.at(-1) !== sheetId) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }

      if (event.key !== 'Tab' || panelRef.current === null) return;

      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const stackIndex = openSheetStack.lastIndexOf(sheetId);
      if (stackIndex >= 0) openSheetStack.splice(stackIndex, 1);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  // After exit animation ends, remove from DOM.
  const handleAnimationEnd = (event: React.AnimationEvent<HTMLElement>) => {
    // Only unmount after the panel's own exit animation (not child animations).
    if (event.target === event.currentTarget && animState === 'closed') {
      setRendered(false);
    }
  };

  if (!mounted || !rendered) return null;

  return createPortal(
    <div className="sheet-root" data-side={side} data-state={animState}>
      <button
        aria-label="Dismiss panel"
        className="sheet-backdrop"
        onClick={() => onOpenChange(false)}
        type="button"
      />
      <aside
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={cn('sheet-panel', side === 'left' && 'sheet-panel-left', panelClassName)}
        onAnimationEnd={handleAnimationEnd}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </aside>
    </div>,
    document.body,
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

function SheetCloseButton({
  ariaLabel = 'Close panel',
  className,
  disabled = false,
  onClick,
}: {
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn('sheet-close', className)}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
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
