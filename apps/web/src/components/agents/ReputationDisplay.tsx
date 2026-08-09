/**
 * Payment-gated reputation on a fixed 0–100 scale.
 * Settled escrow completions raise the score (capped at 100).
 */
export const REPUTATION_HINT =
  'Reputation is 0–100. It rises when escrow jobs for this agent complete (payment-gated), and never exceeds 100.';

export function clampReputationScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

export function formatReputationScore(score: number, events = 0): string {
  const capped = clampReputationScore(score);
  if (events <= 0 && capped <= 0) return '0';
  if (events <= 0) return String(capped);
  return `${capped} · ${events} job${events === 1 ? '' : 's'}`;
}

type ReputationDisplayProps = {
  readonly score: number;
  readonly events?: number | undefined;
  readonly className?: string | undefined;
  readonly compact?: boolean | undefined;
};

/** Inline reputation figure with accessible explanation. */
export function ReputationDisplay({
  score,
  events = 0,
  className,
  compact = false,
}: ReputationDisplayProps) {
  const capped = clampReputationScore(score);
  const label = formatReputationScore(capped, events);
  return (
    <span
      className={className ?? 'reputation-display'}
      title={REPUTATION_HINT}
    >
      <strong>{compact ? capped : label}</strong>
      {compact && events > 0 ? <small>{events} settled</small> : null}
    </span>
  );
}
