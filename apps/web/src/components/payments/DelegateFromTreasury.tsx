'use client';

import { useState } from 'react';
import { formatDelegationFailure } from '@/lib/delegation-errors';
import { FIELD_CLASS } from '@/lib/payments-format';
import type { SupportedChainKey } from '@/lib/wallet-chains';

const CHAIN_LABELS: Record<SupportedChainKey, string> = {
  arc: 'Arc testnet',
  base: 'Base Sepolia',
};

type Agent = {
  readonly id: string;
  readonly name: string;
};

type AgentWallet = {
  readonly agentId: string;
  readonly chain: string;
  readonly status: string;
};

type Props = {
  readonly orgSlug: string;
  readonly agents: readonly Agent[];
  readonly agentWallets: readonly AgentWallet[];
  /** When set, agent picker is hidden and this payee is used. */
  readonly lockedAgentId?: string;
};

type Step = 'idle' | 'submitting' | 'done';

export function DelegateFromTreasury({ orgSlug, agents, agentWallets, lockedAgentId }: Props) {
  const [chainKey, setChainKey] = useState<SupportedChainKey>('arc');
  const [ceiling, setCeiling] = useState('5.00');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);

  const eligible = agents.filter((agent) => agentWallets.some(
    (wallet) => wallet.agentId === agent.id
      && wallet.chain === chainKey
      && wallet.status === 'active',
  ));

  const [preferredAgentId, setPreferredAgentId] = useState(lockedAgentId ?? '');
  const agentId = lockedAgentId !== undefined && lockedAgentId.length > 0
    ? (eligible.some((agent) => agent.id === lockedAgentId) ? lockedAgentId : '')
    : eligible.some((agent) => agent.id === preferredAgentId)
      ? preferredAgentId
      : eligible[0]?.id ?? '';
  const locked = lockedAgentId !== undefined && lockedAgentId.length > 0;
  const lockedName = agents.find((agent) => agent.id === lockedAgentId)?.name;

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
        throw new Error(formatDelegationFailure(body));
      }
      setStep('done');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The delegation could not be created.');
      setStep('idle');
    }
  }

  return (
    <div className="delegation-form">
      <div className="delegation-form-grid">
        {locked ? (
          <div className="treasury-field-stack">
            <span className="treasury-field-label">Agent</span>
            <span className="delegation-form-meta">{lockedName ?? lockedAgentId}</span>
            {agentId === '' ? (
              <span className="delegation-form-meta is-warn">
                No active wallet on {CHAIN_LABELS[chainKey]} yet. Grant payment access with rails for this chain first.
              </span>
            ) : null}
          </div>
        ) : (
          <label className="treasury-field-stack">
            <span className="treasury-field-label">Agent</span>
            <select
              className={FIELD_CLASS}
              disabled={eligible.length === 0}
              onChange={(event) => setPreferredAgentId(event.target.value)}
              value={agentId}
            >
              {eligible.length === 0
                ? <option value="">No wallet on this chain</option>
                : eligible.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
            </select>
            {eligible.length === 0 ? (
              <span className="delegation-form-meta is-warn">
                Grant payment access on {CHAIN_LABELS[chainKey]} on the agent Overview first.
              </span>
            ) : null}
          </label>
        )}

        <label className="treasury-field-stack">
          <span className="treasury-field-label">Chain</span>
          <select
            className={FIELD_CLASS}
            onChange={(event) => setChainKey(event.target.value as SupportedChainKey)}
            value={chainKey}
          >
            <option value="arc">Arc testnet</option>
            <option value="base">Base Sepolia</option>
          </select>
          {chainKey === 'base' ? (
            <span className="delegation-form-meta is-warn">Base also needs ETH for gas on the agent wallet.</span>
          ) : null}
        </label>

        <label className="treasury-field-stack">
          <span className="treasury-field-label">Spending cap (USDC)</span>
          <input
            className={FIELD_CLASS}
            inputMode="decimal"
            onChange={(event) => setCeiling(event.target.value)}
            value={ceiling}
          />
        </label>
      </div>

      <div className="delegation-form-actions">
        <button
          className="delegation-primary-button"
          disabled={step === 'submitting' || agentId === ''}
          onClick={() => void handleDelegate()}
          type="button"
        >
          {step === 'submitting' ? 'Creating…' : 'Create delegation'}
        </button>
        {step === 'done' ? (
          <span className="delegation-form-meta is-ok">Created. It appears in Active below.</span>
        ) : null}
        {error === null ? null : <span className="delegation-form-meta is-error">{error}</span>}
      </div>
    </div>
  );
}
