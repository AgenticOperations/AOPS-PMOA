export type EscrowLivenessRiskSummary = {
  readonly escrowJobId: string;
  readonly providerAddress: string;
  readonly expiresAt: string;
};

type Props = {
  readonly atRisk: readonly EscrowLivenessRiskSummary[];
  readonly orgSlug: string;
};

function timeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expiring now';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return `${Math.max(1, Math.floor(ms / (60 * 1000)))}m left`;
  if (hours < 48) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

/**
 * The evaluator-liveness trap, surfaced before it costs a provider its
 * work: once a job is submitted, an evaluator who goes silent lets
 * claimRefund pay the CLIENT even though the work was delivered. In our
 * model the operator is the evaluator, so this is a required feature, not
 * a nicety -- their own risk to manage.
 */
export function EscrowLivenessBanner({ atRisk, orgSlug }: Props) {
  if (atRisk.length === 0) return null;

  return (
    <div className="escrow-liveness-banner" role="alert">
      <p>
        {atRisk.length} submitted {atRisk.length === 1 ? 'job is' : 'jobs are'} approaching expiry.
        If the evaluator window closes without a decision, the provider that delivered the work is
        the one who loses — <code>claimRefund</code> pays the budget back to the client, not the
        provider. Review on{' '}
        <a href={`/app/${orgSlug}/payments/activity?tab=escrow`}>Activity → Escrow</a>.
      </p>
      <ul>
        {atRisk.map((risk) => (
          <li key={risk.escrowJobId}>
            <a href={`/app/${orgSlug}/payments/activity?tab=escrow`}>{risk.escrowJobId}</a>
            {' — '}
            {timeRemaining(risk.expiresAt)}
          </li>
        ))}
      </ul>
    </div>
  );
}
