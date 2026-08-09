'use client';

import { useMemo, useState } from 'react';
import type { MarketplaceListingActivity } from '@/lib/server/marketplace-public-client';

type MarketplaceActivityChartProps = {
  readonly activity: MarketplaceListingActivity;
};

type RangeKey = '7' | '30' | '90';

export function MarketplaceActivityChart({ activity }: MarketplaceActivityChartProps) {
  const [range, setRange] = useState<RangeKey>('30');
  const [activeDay, setActiveDay] = useState<string | null>(null);

  const series = useMemo(() => {
    const days = Number.parseInt(range, 10);
    const byDay = new Map(
      activity.series.map((point) => [point.day, point] as const),
    );
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const padded: MarketplaceListingActivity['series'][number][] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setUTCDate(today.getUTCDate() - offset);
      const key = day.toISOString().slice(0, 10);
      padded.push(byDay.get(key) ?? {
        day: key,
        settledUsdc: '0',
        completedJobs: 0,
        reputationEvents: 0,
      });
    }
    return padded;
  }, [activity.series, range]);

  const events = useMemo(() => {
    const days = Number.parseInt(range, 10);
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    return (activity.recentEvents ?? []).filter((event) => event.day >= cutoffKey);
  }, [activity.recentEvents, range]);

  const values = series.map((point) => Number.parseFloat(point.settledUsdc) || point.completedJobs);
  const hasActivity = values.some((value) => value > 0);
  const width = 640;
  const height = 240;
  const padX = 8;
  const padTop = 16;
  const padBottom = 28;
  const max = Math.max(...values, 0.000001);
  const points = series.map((point, index) => {
    const x = series.length === 1
      ? width / 2
      : padX + (index / (series.length - 1)) * (width - padX * 2);
    const value = Number.parseFloat(point.settledUsdc) || point.completedJobs;
    const y = height - padBottom - (value / max) * (height - padTop - padBottom);
    return { ...point, x, y, value };
  });

  const path = points.length < 2
    ? ''
    : points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = points.length < 2
    ? ''
    : `${path} L${(points[points.length - 1]?.x ?? width).toFixed(1)} ${height - padBottom} L${(points[0]?.x ?? 0).toFixed(1)} ${height - padBottom} Z`;

  const activePoint = points.find((point) => point.day === activeDay) ?? null;
  const activeEvents = activeDay === null
    ? []
    : events.filter((event) => event.day === activeDay);

  return (
    <section className="amkt-chart" aria-label="Settlement activity">
      <div className="amkt-chart-head">
        <div>
          <p className="amkt-eyebrow">On-chain activity</p>
          <h2>Settlement pulse</h2>
          <p className="amkt-chart-sub">
            Real settled volume from Permit2 fleet hires and escrow — hover a day, then click a tx.
          </p>
        </div>
        <div className="amkt-chart-ranges" role="group" aria-label="Range">
          {(['7', '30', '90'] as const).map((key) => (
            <button
              aria-pressed={range === key}
              className={range === key ? 'is-active' : undefined}
              key={key}
              onClick={() => {
                setRange(key);
                setActiveDay(null);
              }}
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
          <strong>{Math.min(100, Math.max(0, activity.reputationScore))}</strong>
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
          <span>On-chain events</span>
          <strong>{events.length}</strong>
        </div>
      </div>

      <div
        className="amkt-chart-inspect"
        onMouseLeave={() => setActiveDay(null)}
      >
        <div className="amkt-chart-canvas">
          {!hasActivity ? (
            <div className="amkt-chart-empty">
              <p>No settled on-chain activity in this window yet.</p>
              <p>Run live marketplace hires (Permit2 / x402 / escrow) to fill this chart.</p>
            </div>
          ) : (
            <svg
              aria-label="Settlement activity chart"
              className="amkt-chart-svg"
              role="img"
              viewBox={`0 0 ${width} ${height}`}
            >
              <path className="amkt-chart-area" d={area} />
              <path className="amkt-chart-line" d={path} fill="none" />
              {points.map((point) => (
                <g key={point.day}>
                  <circle
                    className={activeDay === point.day ? 'amkt-chart-dot is-active' : 'amkt-chart-dot'}
                    cx={point.x}
                    cy={point.y}
                    r={activeDay === point.day ? 4.5 : 3}
                  />
                  <rect
                    fill="transparent"
                    height={height}
                    onFocus={() => setActiveDay(point.day)}
                    onMouseEnter={() => setActiveDay(point.day)}
                    onClick={() => setActiveDay(point.day)}
                    tabIndex={0}
                    width={Math.max(24, (width - padX * 2) / Math.max(points.length, 1))}
                    x={point.x - Math.max(12, (width - padX * 2) / Math.max(points.length, 1) / 2)}
                    y={0}
                  >
                    <title>{`${point.day}: ${formatUsdc(point.settledUsdc)} · ${point.completedJobs} jobs`}</title>
                  </rect>
                </g>
              ))}
              {activePoint !== null ? (
                <line
                  className="amkt-chart-guide"
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={padTop}
                  y2={height - padBottom}
                />
              ) : null}
            </svg>
          )}
        </div>

        {activePoint !== null ? (
          <div className="amkt-chart-hover" role="status">
            <div className="amkt-chart-hover-head">
              <strong>{activePoint.day}</strong>
              <span>{formatUsdc(activePoint.settledUsdc)} · {activePoint.completedJobs} jobs</span>
            </div>
            {activeEvents.length === 0 ? (
              <p className="amkt-chart-hover-empty">No navigable txs recorded for this day.</p>
            ) : (
              <ul className="amkt-chart-hover-list">
                {activeEvents.map((event) => (
                  <li key={event.id}>
                    <div>
                      <strong>{event.label}</strong>
                      <span>{formatUsdc(event.amountUsdc)} · {event.kind.replace('_', ' ')} · {event.chain}</span>
                    </div>
                    {event.explorerUrl !== null && event.txHash !== null ? (
                      <a href={event.explorerUrl} rel="noreferrer" target="_blank">
                        {shortTx(event.txHash)}
                      </a>
                    ) : (
                      <span className="amkt-chart-hover-muted">No tx hash</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : events.length > 0 ? (
          <p className="amkt-chart-hint">Hover or focus a point to inspect on-chain hires.</p>
        ) : null}
      </div>
    </section>
  );
}

function formatUsdc(value: string): string {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return '$0';
  return `$${amount.toFixed(2)}`;
}

function shortTx(hash: string): string {
  if (hash.length < 12) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}
