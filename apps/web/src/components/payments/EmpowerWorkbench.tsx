'use client';

import { useState, type ReactNode } from 'react';

type EmpowerTab = 'access' | 'caps' | 'delegations';

const tabs: readonly { readonly id: EmpowerTab; readonly label: string }[] = [
  { id: 'access', label: 'Access' },
  { id: 'caps', label: 'Ceilings' },
  { id: 'delegations', label: 'Delegations' },
];

type EmpowerWorkbenchProps = {
  readonly access: ReactNode;
  readonly caps: ReactNode;
  readonly delegations: ReactNode;
};

/**
 * One job at a time — mirrors Home’s scannable density instead of stacking
 * access + ceilings + three delegation surfaces on one scroll.
 */
export function EmpowerWorkbench({ access, caps, delegations }: EmpowerWorkbenchProps) {
  const [tab, setTab] = useState<EmpowerTab>('access');

  return (
    <div className="empower-workbench">
      <div className="empower-tabs" role="tablist" aria-label="Empower sections">
        {tabs.map((item) => (
          <button
            aria-selected={tab === item.id}
            className={tab === item.id ? 'is-active' : undefined}
            key={item.id}
            onClick={() => setTab(item.id)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="empower-panel" role="tabpanel">
        {tab === 'access' ? access : null}
        {tab === 'caps' ? caps : null}
        {tab === 'delegations' ? delegations : null}
      </div>
    </div>
  );
}
