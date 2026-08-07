'use client';

import { useState, type ReactNode } from 'react';

type Source = 'treasury' | 'wallet';

type DelegationsPanelProps = {
  readonly treasuryForm: ReactNode;
  readonly walletForm: ReactNode;
  readonly activeList: ReactNode;
  readonly initialSource?: Source;
  /** Shown when arriving from Fund → Your wallet (skip deposit). */
  readonly skipDepositNotice?: boolean;
};

/**
 * One surface for create + list. Source toggle instead of stacked boxes.
 */
export function DelegationsPanel({
  treasuryForm,
  walletForm,
  activeList,
  initialSource = 'treasury',
  skipDepositNotice = false,
}: DelegationsPanelProps) {
  const [source, setSource] = useState<Source>(initialSource);

  return (
    <section className="delegations-panel">
      {skipDepositNotice ? (
        <p className="delegations-skip-notice">
          Deposit skipped — grant spend from your wallet below.
        </p>
      ) : null}

      <header className="delegations-panel-header">
        <div>
          <h2>Delegations</h2>
          <p>Cap how much an agent can draw. Pick the source, then create.</p>
        </div>
        <div className="delegations-source-toggle" role="tablist" aria-label="Delegation source">
          <button
            aria-selected={source === 'treasury'}
            className={source === 'treasury' ? 'is-active' : undefined}
            onClick={() => setSource('treasury')}
            role="tab"
            type="button"
          >
            From treasury
          </button>
          <button
            aria-selected={source === 'wallet'}
            className={source === 'wallet' ? 'is-active' : undefined}
            onClick={() => setSource('wallet')}
            role="tab"
            type="button"
          >
            From your wallet
          </button>
        </div>
      </header>

      <p className="delegations-source-hint">
        {source === 'treasury'
          ? 'Circle path — draws from the org pool you funded on Fund. No MetaMask.'
          : 'Non-custodial — MetaMask Permit2 on the same chain as the agent wallet from Access.'}
      </p>

      <div className="delegations-form" role="tabpanel">
        {source === 'treasury' ? treasuryForm : walletForm}
      </div>

      <div className="delegations-active">
        <h3>Active</h3>
        {activeList}
      </div>
    </section>
  );
}
