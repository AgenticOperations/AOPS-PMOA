import { formatUtcDateTime } from '@/lib/date-format';
import type { AgentReputationEventRecord } from '@/lib/identity-spine-types';
import { REPUTATION_HINT, ReputationDisplay } from './ReputationDisplay';

type AgentReputationPanelProps = {
  readonly score: number;
  readonly events: number;
  readonly history: readonly AgentReputationEventRecord[];
};

const ARC_TX = 'https://testnet.arcscan.app/tx/';

/**
 * Operator view of payment-gated reputation earned from settled escrow jobs.
 */
export function AgentReputationPanel({ score, events, history }: AgentReputationPanelProps) {
  return (
    <section className="agent-detail-section" aria-labelledby="reputation-title">
      <div className="agent-section-heading">
        <div>
          <h2 id="reputation-title">Reputation</h2>
          <p>{REPUTATION_HINT}</p>
        </div>
        <ReputationDisplay className="reputation-display is-large" events={events} score={score} />
      </div>

      {history.length === 0 ? (
        <div className="treasury-empty-state">
          <strong>No reputation yet</strong>
          <p>
            Reputation is written only when an escrow job for this agent completes. Fleet Permit2
            hires do not add score — complete escrow (marketplace hire) does.
          </p>
        </div>
      ) : (
        <ul className="reputation-history-list">
          {history.map((event) => (
            <li key={event.id}>
              <div>
                <strong>+{event.score}</strong>
                <span>{formatUtcDateTime(event.created_at)}</span>
              </div>
              <code title={event.escrow_job_id}>{event.escrow_job_id}</code>
              {event.feedback_tx_hash !== null ? (
                <a href={`${ARC_TX}${event.feedback_tx_hash}`} rel="noreferrer" target="_blank">
                  Feedback tx
                </a>
              ) : (
                <span className="reputation-history-muted">On-chain feedback pending / failed</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
