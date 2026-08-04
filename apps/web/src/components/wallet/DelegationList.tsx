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
      // Be exact about what happened. For a user-owned payer this platform
      // cannot call Permit2's lockdown() -- only the owner can -- so the
      // on-chain allowance is still live. Saying "revoked" here would tell
      // the operator they are safe when they are not.
      setNotice(onChainRevoked
        ? 'Revoked. The on-chain allowance is closed.'
        : 'Stopped in agentOps: this agent can no longer draw through us. The on-chain '
          + 'Permit2 allowance is still open until you sign a lockdown from your own wallet.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Revoke failed.');
    } finally {
      setRevoking(null);
    }
  }

  if (delegations.length === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        No delegations yet. Connect a wallet above and set a spending cap for an agent.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {notice !== null ? <p className="rounded-md border p-3 text-sm">{notice}</p> : null}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2 font-medium">Payer</th>
              <th className="p-2 font-medium">Agent</th>
              <th className="p-2 font-medium">Chain</th>
              <th className="p-2 font-medium">Cap</th>
              <th className="p-2 font-medium">Drawn</th>
              <th className="p-2 font-medium">Remaining</th>
              <th className="p-2 font-medium">Status</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {delegations.map((delegation) => (
              <tr key={delegation.id} className="border-b last:border-0">
                <td className="p-2">
                  {shortAddress(delegation.payerAddress)}
                  {delegation.platformControlsPayer ? null : (
                    <span className="ml-1 text-xs text-muted-foreground">(your wallet)</span>
                  )}
                </td>
                <td className="p-2">{delegation.payeeAgentId ?? shortAddress(delegation.payeeAddress)}</td>
                <td className="p-2">{delegation.chain}</td>
                <td className="p-2">{delegation.ceilingUsdc}</td>
                <td className="p-2">{delegation.drawnUsdc}</td>
                <td className="p-2">{delegation.remainingUsdc}</td>
                <td className="p-2">{delegation.status}</td>
                <td className="p-2 text-right">
                  {delegation.status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => void handleRevoke(delegation)}
                      disabled={revoking === delegation.id}
                      className="rounded-md border px-2 py-1 text-xs disabled:opacity-60"
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
    </div>
  );
}
