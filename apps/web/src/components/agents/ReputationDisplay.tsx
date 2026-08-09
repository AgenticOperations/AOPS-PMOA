/**
 * Payment-gated reputation: +100 per settled escrow completion (not a 0–100 star rating).
 */
export const REPUTATION_HINT =
  'Cumulative score from settled escrow jobs (+100 each). Not a star rating — earned only after payment completes.';

export function formatReputationScore(score: number, events = 0): string {
  if (events <= 0 && score <= 0) return '0';
  if (events <= 0) return String(score);
  return `${score} · ${events} job${events === 1 ? '' : 's'}`;
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
  const label = formatReputationScore(score, events);
  return (
    <span
      className={className ?? 'reputation-display'}
      title={REPUTATION_HINT}
    >
      <strong>{compact ? score : label}</strong>
      {compact && events > 0 ? <small>{events} settled</small> : null}
    </span>
  );
}
