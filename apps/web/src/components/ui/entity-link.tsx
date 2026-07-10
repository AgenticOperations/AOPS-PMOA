import Link from 'next/link';
import type { ComponentProps } from 'react';
import { IconArrowUpRight } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

type EntityLinkProps = ComponentProps<typeof Link> & {
  readonly meta?: string;
};

export function EntityLink({ children, className, meta, ...props }: EntityLinkProps) {
  return (
    <Link
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 font-semibold text-[var(--text-primary)] transition-colors hover:text-[var(--accent-blue)]',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      {meta ? <span className="text-xs font-medium text-[var(--text-muted)]">{meta}</span> : null}
      <IconArrowUpRight aria-hidden="true" size={14} stroke={2} />
    </Link>
  );
}
