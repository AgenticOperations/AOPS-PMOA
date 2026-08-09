'use client';

import { useState } from 'react';
import type { DelegationSummary } from '@/lib/server/payments-client';

type Props = {
  readonly orgSlug: string;
  readonly delegations: readonly DelegationSummary[];
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function DelegationList({ orgSlug, delegations }: Props) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleRevoke(delegation: DelegationSummary) {
    setRevoking(delegation.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/app/${orgSlug}/delegations/${delegation.id}/revoke`, { method: 'POST' });
      if (!response.ok) throw new Error(await response.text());
      const { onChainRevoked } = await response.json() as { onChainRevoked: boolean };
      setNotice(onChainRevoked
        ? 'Revoked. On-chain allowance closed.'
        : 'Stopped in agentOps. On-chain Permit2 may still be open until you lockdown from your wallet.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Revoke failed.');
    } finally {
      setRevoking(null);
    }
  }

  if (delegations.length === 0) {
    return <p className="delegation-form-meta">None yet.</p>;
  }

  return (
    <div className="delegation-list">
      {notice === null ? null : <p className="delegation-form-meta">{notice}</p>}
      <table className="delegation-table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Chain</th>
            <th>Cap</th>
            <th>Left</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {delegations.map((delegation) => (
            <tr key={delegation.id}>
              <td>
                {delegation.platformControlsPayer
                  ? 'Treasury'
                  : shortAddress(delegation.payerAddress)}
              </td>
              <td>{delegation.chain}</td>
              <td>{delegation.ceilingUsdc}</td>
              <td>{delegation.remainingUsdc}</td>
              <td>{delegation.status}</td>
              <td className="delegation-table-action">
                {delegation.status === 'active' ? (
                  <button
                    className="treasury-text-action"
                    disabled={revoking === delegation.id}
                    onClick={() => void handleRevoke(delegation)}
                    type="button"
                  >
                    {revoking === delegation.id ? 'Revoking…' : 'Revoke'}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
