import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type PageHeaderProps = {
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly description?: string;
  readonly eyebrow?: string;
  readonly title: string;
};

export function PageHeader({ actions, className, description, eyebrow, title }: PageHeaderProps) {
  return (
    <header className={cn('flex items-end justify-between gap-4', className)}>
      <div className="grid gap-1">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="max-w-3xl text-sm leading-6 text-[var(--text-muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
