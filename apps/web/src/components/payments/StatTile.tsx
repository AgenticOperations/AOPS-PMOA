import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type StatTileProps = {
  readonly label: string;
  readonly tone?: 'neutral' | 'warning';
  readonly value: ReactNode;
};

export function StatTile({ label, tone = 'neutral', value }: StatTileProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-xl bg-card px-4 py-3 ring-1',
        tone === 'warning' ? 'bg-(--state-warning-tint) ring-(--state-warning)/40' : 'ring-border',
      )}
    >
      <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}
