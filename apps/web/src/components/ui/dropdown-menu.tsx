'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type DropdownMenuContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
};

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenu() {
  const context = React.useContext(DropdownMenuContext);
  if (!context) {
    throw new Error('DropdownMenu components must be used inside <DropdownMenu>');
  }
  return context;
}

function DropdownMenu({ children }: { readonly children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef }}>
      <div className="relative inline-block">{children}</div>
    </DropdownMenuContext.Provider>
  );
}

function DropdownMenuTrigger({ children }: { readonly children: React.ReactElement<{ onClick?: () => void; 'aria-expanded'?: boolean }> }) {
  const { open, setOpen, triggerRef } = useDropdownMenu();
  return React.cloneElement(children, {
    onClick: () => setOpen(!open),
    'aria-expanded': open,
    // @ts-expect-error -- attaching a ref to a cloned element for outside-click targeting
    ref: triggerRef,
  });
}

function DropdownMenuContent({ align = 'end', children, className }: { readonly align?: 'start' | 'end'; readonly children: React.ReactNode; readonly className?: string }) {
  const { open, setOpen, triggerRef } = useDropdownMenu();
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (contentRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpen, triggerRef]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'absolute z-20 mt-2 w-72 rounded-xl bg-card p-1.5 shadow-lg ring-1 ring-border',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
      ref={contentRef}
      role="menu"
    >
      {children}
    </div>
  );
}

function DropdownMenuLabel({ children, className }: { readonly children: React.ReactNode; readonly className?: string }) {
  return <p className={cn('px-2.5 pt-2 pb-1 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground', className)}>{children}</p>;
}

function DropdownMenuSeparator() {
  return <div className="my-1.5 h-px bg-border" role="separator" />;
}

function DropdownMenuItem({ children, className, ...props }: React.ComponentProps<'button'>) {
  const { setOpen } = useDropdownMenu();
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      onClick={(event) => {
        props.onClick?.(event);
        setOpen(false);
      }}
      role="menuitem"
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem };
