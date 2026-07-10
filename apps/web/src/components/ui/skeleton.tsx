import * as React from 'react';
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-[var(--bg-soft)]', className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

export { Skeleton };
