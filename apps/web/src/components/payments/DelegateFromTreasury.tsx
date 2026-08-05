'use client';

import { useState } from 'react';
import type { SupportedChainKey } from '@/lib/wallet-chains';

type Agent = {
  readonly id: string;
  readonly name: string;
};

type Props = {
  readonly orgSlug: string;
  readonly agents: readonly Agent[];
};

type Step = 'idle' | 'submitting' | 'done';

// Both are configured states rather than faults, so they get their own
// wording instead of a generic failure. An operator who hits one has
// something specific to do about it.
const EXPECTED_REJECTIONS: Record<string, string> = {
  org_delegation_ceiling_exceeded:
    'This cap would push the org past its ceiling. Raise the ceiling, or revoke an unused delegation first.',
  treasury_insufficient_for_ceiling:
    'The treasury does not hold enough USDC to cover this cap. Fund the treasury first.',
};

/**
 * Delegating from the org treasury. No wallet connect, no approve, no
 * signature, no chain switching -- the treasury is platform-controlled, so
 * the platform signs the permit itself. It is a plain form, and that is the
 * visible payoff of the treasury model.
 *
 * Custody, stated honestly: the treasury IS custodial. The platform holds
 * the key. The cap below constrains a compromised or misbehaving AGENT; it
 * is not protection against a compromised platform.
 */
export function DelegateFromTreasury({ orgSlug, agents }: Props) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [chainKey, setChainKey] = useState<SupportedChainKey>('arc');
  const [ceiling, setCeiling] = useState('5.00');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleDelegate() {
    setError(null);
    setStep('submitting');
    try {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const response = await fetch(`/api/app/${orgSlug}/delegations/treasury`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chain: chainKey,
          ceiling_usdc: ceiling,
          expires_at: expiresAt.toISOString(),
          payee_agent_id: agentId,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(
          EXPECTED_REJECTIONS[body.error ?? ''] ?? body.message ?? 'The delegation could not be created.',
        );
      }
      setStep('done');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The delegation could not be created.');
      setStep('idle');
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-medium">Delegate spending to an agent</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        The agent draws from the org treasury, never more than the cap you set here.
      </p>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm">
          Agent
          <select
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            className="rounded-md border px-2 py-1"
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          Chain
          <select
            value={chainKey}
            onChange={(event) => setChainKey(event.target.value as SupportedChainKey)}
            className="rounded-md border px-2 py-1"
          >
            <option value="arc">Arc testnet</option>
            <option value="base">Base Sepolia</option>
          </select>
          {chainKey === 'base' ? (
            <span className="text-xs text-amber-600">
              On Base an agent also needs ETH for gas, which must be sent separately. On Arc, USDC
              is the gas asset, so the treasury covers both.
            </span>
          ) : null}
        </label>

        <label className="grid gap-1 text-sm">
          Spending cap (USDC)
          <input
            value={ceiling}
            onChange={(event) => setCeiling(event.target.value)}
            className="rounded-md border px-2 py-1"
            inputMode="decimal"
          />
          <span className="text-xs text-muted-foreground">
            The most this agent can ever draw. Funds stay in the treasury until it does.
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={() => void handleDelegate()}
        disabled={step === 'submitting' || agentId === ''}
        className="mt-4 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
      >
        {step === 'submitting' ? 'Creating…' : 'Create delegation'}
      </button>

      {step === 'done' ? (
        <p className="mt-3 text-sm text-emerald-600">
          Delegation created. Refresh to see it in the list below.
        </p>
      ) : null}
      {error === null ? null : <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
