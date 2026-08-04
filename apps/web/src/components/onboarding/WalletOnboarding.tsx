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

  return (
    <div className="onboarding-form">
      <ol className="grid gap-4">
        <li className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">1. Prepare the workspace</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Creates the wallet container your agents are provisioned into. No email, no code —
                and it holds no money.
              </p>
            </div>
            {treasuryReady ? (
              <span className="whitespace-nowrap text-sm">Ready</span>
            ) : (
              <form action={() => submit()}>
                <button type="submit" disabled={pending} className="rounded-md border px-3 py-2 text-sm disabled:opacity-60">
                  {pending ? 'Preparing…' : 'Prepare'}
                </button>
              </form>
            )}
          </div>
          {state.error !== undefined ? (
            <p className="mt-2 text-sm text-red-600">{state.error}</p>
          ) : null}
        </li>

        <li className="rounded-lg border p-4">
          <h3 className="font-medium">2. Connect your wallet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Your USDC stays here. Each agent gets a spending cap you set, and can never take more
            than that — you can cut any of them off at any time.
          </p>
          {isConnected ? (
            <p className="mt-3 text-sm">Connected — {address}</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {connectors.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No browser wallet detected. Install MetaMask (or any EIP-6963 wallet) and reload.
                </p>
              ) : (
                connectors.map((connector) => (
                  <button
                    key={connector.uid}
                    type="button"
                    onClick={() => connect({ connector })}
                    className="rounded-md border px-3 py-2 text-sm"
                  >
                    {connector.name}
                  </button>
                ))
              )}
            </div>
          )}
        </li>
      </ol>

      <div className="mt-5 flex items-center gap-3">
        <Link
          className={treasuryReady ? 'button-primary' : 'button-primary pointer-events-none opacity-50'}
          href={`/app/${orgSlug}/overview`}
        >
          Open agentOps
        </Link>
        {treasuryReady ? null : (
          <span className="text-sm text-muted-foreground">Prepare the workspace to continue.</span>
        )}
      </div>
    </div>
  );
}
