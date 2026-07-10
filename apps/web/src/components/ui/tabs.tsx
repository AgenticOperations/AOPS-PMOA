'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type TabsContextValue = {
  value: string;
  setValue: (value: string) => void;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs() {
  const context = React.useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs components must be used inside <Tabs>');
  }
  return context;
}

function Tabs({
  children,
  defaultValue,
  value,
  onValueChange,
}: {
  readonly children: React.ReactNode;
  readonly defaultValue: string;
  readonly value?: string;
  readonly onValueChange?: (value: string) => void;
}) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const selectedValue = value ?? internalValue;
  const setValue = React.useCallback(
    (nextValue: string) => {
      setInternalValue(nextValue);
      onValueChange?.(nextValue);
    },
    [onValueChange],
  );

  return <TabsContext.Provider value={{ setValue, value: selectedValue }}>{children}</TabsContext.Provider>;
}

function TabsList({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'inline-flex min-h-9 items-center gap-1 rounded-lg bg-[var(--bg-soft)] p-1 ring-1 ring-[var(--border-subtle)]',
        className,
      )}
      role="tablist"
      {...props}
    />
  );
}

function TabsTrigger({ className, value, ...props }: React.ComponentProps<'button'> & { readonly value: string }) {
  const { setValue, value: selectedValue } = useTabs();
  const selected = selectedValue === value;

  return (
    <button
      aria-selected={selected}
      className={cn(
        'inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]',
        selected && 'bg-[var(--bg-panel)] text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)]',
        className,
      )}
      onClick={() => setValue(value)}
      role="tab"
      type="button"
      {...props}
    />
  );
}

function TabsContent({ className, value, ...props }: React.ComponentProps<'div'> & { readonly value: string }) {
  const { value: selectedValue } = useTabs();
  if (selectedValue !== value) {
    return null;
  }

  return <div className={cn('pt-4', className)} role="tabpanel" {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
