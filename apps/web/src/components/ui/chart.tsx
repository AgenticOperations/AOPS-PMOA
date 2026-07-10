'use client';

import * as React from 'react';
import { ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';

export type ChartConfig = Record<
  string,
  {
    readonly color?: string;
    readonly label?: React.ReactNode;
  }
>;

function ChartContainer({
  children,
  className,
  config,
}: React.ComponentProps<'div'> & {
  readonly children: React.ComponentProps<typeof ResponsiveContainer>['children'];
  readonly config: ChartConfig;
}) {
  return (
    <div
      className={cn(
        'h-64 w-full text-xs text-[var(--text-muted)] [&_.recharts-cartesian-axis-tick_text]:fill-[var(--text-muted)] [&_.recharts-cartesian-grid_line]:stroke-[var(--border-subtle)]',
        className,
      )}
      data-chart-series={Object.keys(config).join(',')}
      data-slot="chart"
    >
      <ResponsiveContainer>{children}</ResponsiveContainer>
    </div>
  );
}

const ChartTooltip = Tooltip;

type ChartTooltipContentProps = {
  readonly active?: boolean;
  readonly payload?: Array<{
    readonly dataKey?: string | number;
    readonly name?: React.ReactNode;
    readonly value?: React.ReactNode;
  }>;
};

function ChartTooltipContent({ active, payload }: ChartTooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-lg bg-[var(--bg-panel)] px-3 py-2 text-xs ring-1 ring-[var(--border-subtle)]">
      {payload.map((item, index) => (
        <div className="flex items-center justify-between gap-6" key={item.dataKey ?? index}>
          <span className="text-[var(--text-muted)]">{item.name}</span>
          <strong className="font-semibold text-[var(--text-primary)]">{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent };
