import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-semibold leading-none whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-app)] [&>svg]:h-3.5 [&>svg]:w-3.5',
  {
    variants: {
      variant: {
        neutral:
          'border-[var(--border-subtle)] bg-[var(--bg-soft)] text-[var(--text-primary)]',
        success:
          'border-transparent bg-[var(--state-success-tint)] text-[var(--state-success)]',
        warning:
          'border-transparent bg-[var(--state-warning-tint)] text-[var(--state-warning)]',
        danger: 'border-transparent bg-[var(--state-danger-tint)] text-[var(--state-danger)]',
        info: 'border-transparent bg-[var(--accent-tint)] text-[var(--accent-blue)]',
        outline: 'border-[var(--border-subtle)] bg-transparent text-[var(--text-muted)]',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
);

type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} data-slot="badge" {...props} />;
}

export { Badge, badgeVariants };
