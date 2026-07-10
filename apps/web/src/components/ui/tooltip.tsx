'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type TooltipProps = {
  readonly children: React.ReactNode;
  readonly content: string;
};

export function Tooltip({ children, content }: TooltipProps) {
  const id = React.useId();

  return (
    <span className="tooltip-root">
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<{ 'aria-describedby'?: string }>, {
            'aria-describedby': id,
          })
        : children}
      <span className={cn('tooltip-content')} id={id} role="tooltip">
        {content}
      </span>
    </span>
  );
}
