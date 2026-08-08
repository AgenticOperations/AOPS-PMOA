'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useAccount, useConnect } from 'wagmi';
import type { CircleOnboardingActionState } from '@/app/actions/onboarding';

const EMPTY_STATE: CircleOnboardingActionState = {};

type Props = {
  readonly orgSlug: string;
  readonly provisionAction: (
    state: CircleOnboardingActionState,
  ) => Promise<CircleOnboardingActionState>;
  readonly treasuryReady: boolean;
};

/**
 * Onboarding without an email or a one-time code.
 *
 * The workspace is provisioned with developer-controlled wallets, which the
 * entity secret authorizes directly -- there is nothing for a human to
 * verify. What the operator does connect is their OWN wallet, because that
 * is where their money stays: agents draw against a capped, revocable
 * Permit2 allowance rather than being pre-funded from a custodied treasury.
 * See docs/decision-wallet-model.md.
 */
export function WalletOnboarding({ orgSlug, provisionAction, treasuryReady }: Props) {
  const [state, submit, pending] = useActionState(
    (previous: CircleOnboardingActionState) => provisionAction(previous),
    EMPTY_STATE,
  );
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const shortAddress = address === undefined
    ? null
    : `${address.slice(0, 6)}…${address.slice(-4)}`;

  return (
    <div className="onboarding-form">
      <div className={`soft-row${treasuryReady ? ' is-complete' : ''}`}>
        <div>
          <strong>Prepare workspace</strong>
          <span>
            {treasuryReady
              ? 'Agent wallet container is ready. No funds are held here.'
              : 'One click creates the container agents are provisioned into. It holds no money.'}
          </span>
        </div>
        {treasuryReady ? (
          <span className="onboarding-step-status" data-status="ready">Ready</span>
        ) : (
          <form action={() => submit()}>
            <button className="button-primary" disabled={pending} type="submit">
              {pending ? 'Preparing…' : 'Prepare workspace'}
            </button>
          </form>
        )}
      </div>
      {state.error !== undefined ? (
        <p className="form-error" role="alert">{state.error}</p>
      ) : null}
      {state.message !== undefined && state.error === undefined ? (
        <p role="status">{state.message}</p>
      ) : null}

      <div className={`soft-row${!treasuryReady ? ' is-blocked' : ''}${isConnected ? ' is-complete' : ''}`}>
        <div>
          <strong>Connect your wallet</strong>
          <span>
            {isConnected
              ? `Connected as ${shortAddress}. Agents spend only within caps you set.`
              : 'Your USDC stays in this wallet. Agents draw against a capped Permit2 allowance you can revoke.'}
          </span>
        </div>
        {!treasuryReady ? (
          <span className="onboarding-step-status" data-status="waiting">Waiting</span>
        ) : isConnected ? (
          <span className="onboarding-step-status" data-status="ready">Connected</span>
        ) : null}
      </div>

      {treasuryReady && !isConnected ? (
        <div className="button-row is-start">
          {connectors.length === 0 ? (
            <p className="entry-panel-copy">
              No browser wallet detected. Install MetaMask (or any EIP-6963 wallet) and reload.
            </p>
          ) : (
            connectors.map((connector) => (
              <button
                className="button-secondary"
                key={connector.uid}
                onClick={() => connect({ connector })}
                type="button"
              >
                {connector.name}
              </button>
            ))
          )}
        </div>
      ) : null}

      <div className="button-row is-start">
        {treasuryReady ? (
          <Link className="button-primary" href={`/app/${orgSlug}/overview`}>
            Open agentOps
          </Link>
        ) : (
          <button className="button-primary" disabled type="button">
            Open agentOps
          </button>
        )}
        {!treasuryReady ? (
          <span className="entry-panel-copy">Prepare the workspace to continue.</span>
        ) : !isConnected ? (
          <span className="entry-panel-copy">You can connect a wallet now or from Treasury later.</span>
        ) : null}
      </div>
    </div>
  );
}
