'use client';

type MarketplaceSparklineProps = {
  readonly values: readonly number[];
  readonly width?: number | undefined;
  readonly height?: number | undefined;
};

export function MarketplaceSparkline({
  values,
  width = 88,
  height = 28,
}: MarketplaceSparklineProps) {
  if (values.length < 2 || values.every((value) => value === 0)) {
    return (
      <svg aria-hidden="true" className="amkt-spark is-empty" height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
        <line className="amkt-spark-base" x1="0" x2={width} y1={height / 2} y2={height / 2} />
      </svg>
    );
  }

  const max = Math.max(...values, 0.000001);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 0.000001);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const polyline = points.join(' ');
  const area = `0,${height} ${polyline} ${width},${height}`;

  return (
    <svg aria-hidden="true" className="amkt-spark" height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
      <polygon className="amkt-spark-fill" points={area} />
      <polyline className="amkt-spark-line" fill="none" points={polyline} />
    </svg>
  );
}
