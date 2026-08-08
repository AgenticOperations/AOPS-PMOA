'use client';

import { useId } from 'react';

export type SparkTone = 'up' | 'down' | 'flat';

type MarketplaceSparklineProps = {
  readonly values: readonly number[];
  readonly tone?: SparkTone | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
};

type Point = { readonly x: number; readonly y: number };

function densify(values: readonly number[], target = 32): number[] {
  if (values.length === 0) return Array.from({ length: target }, () => 0);
  if (values.length === 1) return Array.from({ length: target }, () => values[0] ?? 0);
  if (values.length >= target) return [...values];

  const out: number[] = [];
  for (let i = 0; i < target; i += 1) {
    const t = i / (target - 1);
    const pos = t * (values.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, values.length - 1);
    const f = pos - lo;
    const s = f * f * (3 - 2 * f);
    const left = values[lo] ?? 0;
    const right = values[hi] ?? left;
    out.push(left * (1 - s) + right * s);
  }
  return out;
}

function toPoints(values: readonly number[], width: number, height: number): Point[] {
  const max = Math.max(...values, 0.000001);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 0.000001);
  const top = 6;
  const bottom = height - 2;
  const usable = bottom - top;
  return values.map((value, index) => ({
    x: values.length === 1 ? width / 2 : (index / (values.length - 1)) * width,
    y: bottom - ((value - min) / range) * usable,
  }));
}

/** Catmull-Rom → cubic Bézier for a continuous Ondo-style sparkline. */
function smoothLinePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const point = points[0]!;
    return `M 0 ${point.y} L ${point.x * 2} ${point.y}`;
  }

  let d = `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function areaPath(line: string, width: number, height: number): string {
  if (line.length === 0) return '';
  return `${line} L ${width.toFixed(2)} ${height.toFixed(2)} L 0 ${height.toFixed(2)} Z`;
}

export function sparkTone(values: readonly number[]): SparkTone {
  if (values.length < 2) return 'flat';
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? first;
  if (last > first) return 'up';
  if (last < first) return 'down';
  return 'flat';
}

export function MarketplaceSparkline({
  values,
  tone,
  width = 320,
  height = 96,
}: MarketplaceSparklineProps) {
  const reactId = useId().replace(/:/g, '');
  const gradientId = `amkt-spark-fill-${reactId}`;
  const resolvedTone = tone ?? sparkTone(values);
  const empty = values.length < 2 || values.every((value) => value === 0);

  if (empty) {
    const mid = height * 0.62;
    return (
      <svg
        aria-hidden="true"
        className={`amkt-spark is-empty is-${resolvedTone}`}
        height={height}
        preserveAspectRatio="none"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        <line className="amkt-spark-base" x1="0" x2={width} y1={mid} y2={mid} />
      </svg>
    );
  }

  const samples = densify(values);
  const points = toPoints(samples, width, height);
  const line = smoothLinePath(points);
  const area = areaPath(line, width, height);

  return (
    <svg
      aria-hidden="true"
      className={`amkt-spark is-${resolvedTone}`}
      height={height}
      preserveAspectRatio="none"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop className="amkt-spark-stop-top" offset="0%" />
          <stop className="amkt-spark-stop-mid" offset="55%" />
          <stop className="amkt-spark-stop-bottom" offset="100%" />
        </linearGradient>
      </defs>
      <path className="amkt-spark-fill" d={area} fill={`url(#${gradientId})`} />
      <path
        className="amkt-spark-line"
        d={line}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
