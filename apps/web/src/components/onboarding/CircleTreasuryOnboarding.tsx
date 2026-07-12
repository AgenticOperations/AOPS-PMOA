'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { CircleOnboardingActionState } from '@/app/actions/onboarding';
import type { CircleConnectionRecord } from '@/lib/payments-types';

type CircleTreasuryOnboardingProps = {
  readonly completeAction: (
    state: CircleOnboardingActionState,
    formData: FormData,
  ) => Promise<CircleOnboardingActionState>;
  readonly connection: CircleConnectionRecord;
  readonly defaultEmail: string;
  readonly disconnectAction: () => Promise<void>;
  readonly fundAction: (
    state: CircleOnboardingActionState,
    formData: FormData,
  ) => Promise<CircleOnboardingActionState>;
  readonly orgSlug: string;
  readonly skipAction: () => Promise<void>;
  readonly startAction: (
    state: CircleOnboardingActionState,
    formData: FormData,
  ) => Promise<CircleOnboardingActionState>;
  readonly syncAction: () => Promise<void>;
  readonly walletCount: number;
};

const EMPTY_STATE: CircleOnboardingActionState = {};
const TESTNET_TREASURY_WALLET_COUNT = 5;

export function CircleTreasuryOnboarding({
  completeAction,
  connection,
  defaultEmail,
  disconnectAction,
  fundAction,
  orgSlug,
  skipAction,
  startAction,
  syncAction,
  walletCount,
}: CircleTreasuryOnboardingProps) {
  const [startState, submitStart, startPending] = useActionState(startAction, EMPTY_STATE);
  const [completeState, submitComplete, completePending] = useActionState(completeAction, EMPTY_STATE);
  const [fundState, submitFund, fundPending] = useActionState(fundAction, EMPTY_STATE);
  const challengeId = startState.challengeId ?? connection.challengeId;
  const challengeEmail = startState.email ?? connection.email;

  if (connection.status === 'blocked') {
    return (
      <div className="onboarding-form">
        <div className="soft-row">
          <strong>Circle connection needs to be reset</strong>
          <span>The encrypted session cannot be read. Wallet references and payment history are unchanged.</span>
        </div>
        <form
          action={disconnectAction}
          onSubmit={(event) => {
            if (!window.confirm('Reset this unreadable Circle session? Wallet references and payment history will remain, but you must verify the Circle email again.')) {
              event.preventDefault();
            }
          }}
        >
          <button className="button-primary" type="submit">Reset Circle connection</button>
        </form>
        <Link className="button-secondary" href={`/app/${orgSlug}/overview`}>Return to agentOps</Link>
      </div>
    );
  }

  if (connection.status === 'connected') {
    return (
      <div className="onboarding-form">
        <div className="soft-row">
          <strong>Circle Agent Wallet connected</strong>
          <span>{connection.email}</span>
        </div>
        {walletCount === 0 ? (
          <form action={syncAction}>
            <button className="button-primary" type="submit">Create testnet treasury</button>
          </form>
        ) : walletCount < TESTNET_TREASURY_WALLET_COUNT ? (
          <>
            <div className="soft-row">
              <strong>Treasury setup incomplete</strong>
              <span>{walletCount} of {TESTNET_TREASURY_WALLET_COUNT} testnet wallet references synchronized</span>
            </div>
            <form action={syncAction}>
              <button className="button-primary" type="submit">Continue treasury setup</button>
            </form>
          </>
        ) : (
          <>
            <div className="soft-row">
              <strong>Five-chain treasury ready</strong>
              <span>{walletCount} wallet references synchronized</span>
            </div>
            <form action={submitFund}>
              <button className="button-secondary" disabled={fundPending} type="submit">
                {fundPending ? 'Requesting testnet USDC...' : 'Request testnet USDC'}
              </button>
            </form>
            {fundState.error !== undefined ? <p className="form-error" role="alert">{fundState.error}</p> : null}
            {fundState.message !== undefined ? <p role="status">{fundState.message}</p> : null}
          </>
        )}
        <Link className="button-primary" href={`/app/${orgSlug}/overview`}>Open agentOps</Link>
        <form
          action={disconnectAction}
          onSubmit={(event) => {
            if (!window.confirm('Disconnect this Circle session? Existing wallet and payment history will remain, but Circle actions will stop until you reconnect.')) {
              event.preventDefault();
            }
          }}
        >
          <button className="button-secondary" type="submit">Disconnect Circle</button>
        </form>
      </div>
    );
  }

  if (challengeId !== undefined) {
    return (
      <form action={submitComplete} className="onboarding-form">
        <input name="challengeId" type="hidden" value={challengeId} />
        <div className="soft-row">
          <strong>Verification code sent</strong>
          <span>{challengeEmail}</span>
        </div>
        <label>
          <span>Circle verification code</span>
          <input autoComplete="one-time-code" name="otp" placeholder="ABC-123456" required />
        </label>
        {completeState.error !== undefined ? <p className="form-error" role="alert">{completeState.error}</p> : null}
        <button className="button-primary" disabled={completePending} type="submit">
          {completePending ? 'Connecting...' : 'Verify and create treasury'}
        </button>
      </form>
    );
  }

  return (
    <div className="onboarding-form">
      {connection.status === 'expired' ? (
        <div className="soft-row">
          <strong>Circle verification expired</strong>
          <span>Request a new one-time code to continue. Existing treasury records are unchanged.</span>
        </div>
      ) : null}
      <form action={submitStart} className="onboarding-form">
        <label>
          <span>Circle Agent Wallet email</span>
          <input autoComplete="email" defaultValue={connection.email || defaultEmail} name="email" required type="email" />
        </label>
        <p>Circle sends a one-time code to verify the wallet owner. This connection is isolated to this workspace.</p>
        {startState.error !== undefined ? <p className="form-error" role="alert">{startState.error}</p> : null}
        <button className="button-primary" disabled={startPending} type="submit">
          {startPending
            ? 'Sending code...'
            : connection.status === 'expired'
              ? 'Send a new verification code'
              : 'Connect Circle Agent Wallet'}
        </button>
      </form>
      <form action={skipAction}>
        <button className="button-secondary" type="submit">Skip for now</button>
      </form>
    </div>
  );
}
