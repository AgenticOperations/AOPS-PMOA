import * as React from 'react';
import { cn } from '@/lib/utils';

type CardProps = React.ComponentProps<'section'> & {
  readonly size?: 'default' | 'compact';
};

function Card({ className, size = 'default', ...props }: CardProps) {
  return (
    <section
      className={cn(
        'group/card flex flex-col gap-4 overflow-hidden rounded-xl bg-[var(--bg-panel)] py-4 text-sm text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)]',
        size === 'compact' && 'gap-3 py-3',
        className,
      )}
      data-size={size}
      data-slot="card"
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'grid auto-rows-min items-start gap-1 px-4 data-[compact=true]:px-3',
        className,
      )}
      data-slot="card-header"
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      className={cn('text-sm font-semibold leading-snug text-[var(--text-primary)]', className)}
      data-slot="card-title"
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn('text-sm leading-5 text-[var(--text-muted)]', className)}
      data-slot="card-description"
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      data-slot="card-action"
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-4', className)} data-slot="card-content" {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center border-t border-[var(--border-subtle)] bg-[var(--bg-soft)] px-4 py-3',
        className,
      )}
      data-slot="card-footer"
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
