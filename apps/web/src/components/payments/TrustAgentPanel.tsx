'use client';

import { useState } from 'react';

export type EscrowEvidence = {
  readonly completedCount: number;
  readonly rejectedCount: number;
  readonly expiredCount: number;
  readonly settledUsdc: string;
};

export type TrustInput = {
  readonly label: string;
  readonly ceilingUsdc: string;
  readonly expiresAt: string;
};

type Props = {
  readonly evidence: EscrowEvidence;
  readonly trusted: boolean;
  readonly error?: string;
  readonly trustAction: (input: TrustInput) => Promise<void>;
  readonly revokeAction: () => Promise<void>;
};

// Both are configured states rather than faults, so they get their own
// wording instead of a generic failure -- following DelegateFromTreasury's
// EXPECTED_REJECTIONS pattern.
const EXPECTED_REJECTIONS: Record<string, string> = {
  trust_requires_escrow_history:
    'This agent needs to complete at least one escrow job before it can be trusted.',
  agent_already_trusted: 'This agent is already trusted. Revoke it first to change the ceiling.',
};

const TRUST_EXPIRY_DAYS = 90;

/**
 * The screen where a human actually decides to graduate an agent from
 * escrow to Permit2. The ceiling has no default and no derived number --
 * that authority is the operator's call, not ours (D-2/D-3).
 */
export function TrustAgentPanel({ evidence, trusted, error, trustAction, revokeAction }: Props) {
  const [ceiling, setCeiling] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const hasHistory = evidence.completedCount > 0;
  const displayError = error === undefined ? null : (EXPECTED_REJECTIONS[error] ?? error);

  async function handleTrust() {
    if (ceiling.trim() === '') {
      setValidationError('Enter a ceiling before trusting this agent.');
      return;
    }
    setValidationError(null);
    setPending(true);
    try {
      const expiresAt = new Date(Date.now() + TRUST_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
      await trustAction({ label: 'Trusted agent', ceilingUsdc: ceiling, expiresAt });
    } finally {
      setPending(false);
    }
  }

  async function handleRevoke() {
    setPending(true);
    try {
      await revokeAction();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="trust-agent-panel">
      <h3>Trust this agent</h3>

      <dl className="trust-agent-evidence">
        <div>
          <dt>Completed</dt>
          <dd>{evidence.completedCount}</dd>
        </div>
        <div>
          <dt>Rejected</dt>
          <dd>{evidence.rejectedCount}</dd>
        </div>
        <div>
          <dt>Expired</dt>
          <dd>{evidence.expiredCount}</dd>
        </div>
        <div>
          <dt>Settled</dt>
          <dd>{evidence.settledUsdc} USDC</dd>
        </div>
      </dl>

      <p>Escrow: 5 transactions per job, capital locked for the duration of the work.</p>
      <p>Trusted (Permit2): 1 transaction per job, nothing locked.</p>

      <p>
        Trust is granted by a person reviewing the record above, not a neutral process. Once
        granted, there is no dispute path — this decision and the ceiling you set are the only
        safeguard.
      </p>

      {trusted ? (
        <button disabled={pending} onClick={() => void handleRevoke()} type="button">
          {pending ? 'Revoking…' : 'Revoke trust'}
        </button>
      ) : (
        <>
          <label>
            Spending ceiling (USDC)
            <input
              inputMode="decimal"
              onChange={(event) => setCeiling(event.target.value)}
              placeholder="Choose the authority you're granting"
              value={ceiling}
            />
          </label>
          <button disabled={!hasHistory || pending} onClick={() => void handleTrust()} type="button">
            {pending ? 'Trusting…' : 'Trust this agent'}
          </button>
          {hasHistory ? null : (
            <p className="trust-agent-hint">
              Complete at least one escrow job with this agent before trusting it.
            </p>
          )}
        </>
      )}

      {validationError === null ? null : <p role="alert">{validationError}</p>}
      {displayError === null ? null : <p role="alert">{displayError}</p>}
    </div>
  );
}
