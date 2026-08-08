'use client';

import { useMemo, useState } from 'react';
import type { MarketplaceListingActivity } from '@/lib/server/marketplace-public-client';

type MarketplaceActivityChartProps = {
  readonly activity: MarketplaceListingActivity;
};

type RangeKey = '7' | '30' | '90';

export function MarketplaceActivityChart({ activity }: MarketplaceActivityChartProps) {
  const [range, setRange] = useState<RangeKey>('30');

  const series = useMemo(() => {
    const days = Number.parseInt(range, 10);
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    return activity.series.filter((point) => point.day >= cutoffKey);
  }, [activity.series, range]);

  const values = series.map((point) => Number.parseFloat(point.settledUsdc) || point.completedJobs);
  const width = 640;
  const height = 240;
  const max = Math.max(...values, 0.000001);
  const path = values.length < 2
    ? ''
    : values.map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - (value / max) * (height - 24) - 12;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      }).join(' ');

  const area = values.length < 2
    ? ''
    : `${path} L${width} ${height} L0 ${height} Z`;

  return (
    <section className="amkt-chart" aria-label="Settlement activity">
      <div className="amkt-chart-head">
        <div>
          <p className="amkt-eyebrow">On-chain activity</p>
          <h2>Settlement pulse</h2>
          <p className="amkt-chart-sub">
            Completed escrow volume and reputation events — not a price chart.
          </p>
        </div>
        <div className="amkt-chart-ranges" role="group" aria-label="Range">
          {(['7', '30', '90'] as const).map((key) => (
            <button
              aria-pressed={range === key}
              className={range === key ? 'is-active' : undefined}
              key={key}
              onClick={() => setRange(key)}
              type="button"
            >
              {key === '7' ? '1W' : key === '30' ? '1M' : '3M'}
            </button>
          ))}
        </div>
      </div>

      <div className="amkt-chart-stats">
        <div>
          <span>Reputation</span>
          <strong>{activity.reputationScore}</strong>
        </div>
        <div>
          <span>Completed jobs</span>
          <strong>{activity.completedJobs}</strong>
        </div>
        <div>
          <span>Settled USDC</span>
          <strong>{formatUsdc(activity.settledUsdc)}</strong>
        </div>
        <div>
          <span>Rep events</span>
          <strong>{activity.reputationEvents}</strong>
        </div>
      </div>

      <div className="amkt-chart-canvas">
        {values.length < 2 ? (
          <div className="amkt-chart-empty">
            <p>No settled activity in this window yet.</p>
            <p>Reputation rises only after completed escrow jobs.</p>
          </div>
        ) : (
          <svg aria-hidden="true" viewBox={`0 0 ${width} ${height}`} role="img">
            <path className="amkt-chart-area" d={area} />
            <path className="amkt-chart-line" d={path} fill="none" />
          </svg>
        )}
      </div>
    </section>
  );
}

function formatUsdc(value: string): string {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return '$0';
  return `$${amount.toFixed(2)}`;
}
