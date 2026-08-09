'use client';

import { useState } from 'react';
import { useAccount, useChainId, useConnect, useDisconnect, useReadContract, useSignTypedData, useSwitchChain, useWriteContract } from 'wagmi';
import { erc20Abi } from 'viem';
import { formatDelegationFailureFromBody } from '@/lib/delegation-errors';
import { FIELD_CLASS } from '@/lib/payments-format';
import { CHAIN_ID_BY_KEY, PERMIT2_ADDRESS, USDC_ADDRESS, type SupportedChainKey } from '@/lib/wallet-chains';

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

type Step = 'idle' | 'approving' | 'signing' | 'recording' | 'done';

/**
 * Non-custodial Permit2 grant from the operator wallet.
 * Spender = agent wallet on the selected chain — only those agents are listed.
 */
export function DelegateToAgent({ orgSlug, agents, agentWallets, lockedAgentId }: Props) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

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

  const targetChainId = CHAIN_ID_BY_KEY[chainKey];
  const token = USDC_ADDRESS[chainKey];
  const onWrongChain = isConnected && chainId !== targetChainId;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    abi: erc20Abi,
    address: token,
    functionName: 'allowance',
    args: address === undefined ? undefined : [address, PERMIT2_ADDRESS],
    chainId: targetChainId,
    query: { enabled: isConnected && address !== undefined },
  });

  const ceilingMicros = (() => {
    const parsed = /^(\d+)(?:\.(\d{1,6}))?$/.exec(ceiling.trim());
    if (parsed === null) return null;
    const whole = BigInt(parsed[1] ?? '0') * 1_000_000n;
    return whole + BigInt((parsed[2] ?? '').padEnd(6, '0') || '0');
  })();

  const needsApproval = ceilingMicros !== null && (allowance === undefined || allowance < ceilingMicros);

  async function handleDelegate() {
    setError(null);
    if (address === undefined || ceilingMicros === null || agentId === '') return;

    try {
      if (needsApproval) {
        setStep('approving');
        await writeContractAsync({
          abi: erc20Abi,
          address: token,
          functionName: 'approve',
          args: [PERMIT2_ADDRESS, ceilingMicros],
          chainId: targetChainId,
        });
        await refetchAllowance();
      }

      setStep('signing');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const typedRes = await fetch(`/api/app/${orgSlug}/delegations/typed-data`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payer_address: address,
          chain: chainKey,
          ceiling_usdc: ceiling,
          expires_at: expiresAt.toISOString(),
          payee_agent_id: agentId,
        }),
      });
      if (!typedRes.ok) throw new Error(await typedRes.text());
      const { typedData, nonce } = await typedRes.json() as {
        typedData: {
          domain: Record<string, unknown>;
          types: Record<string, readonly { name: string; type: string }[]>;
          primaryType: string;
          message: Record<string, unknown>;
        };
        nonce: string;
      };

      const { EIP712Domain: _ignored, ...types } = typedData.types;
      const signature = await signTypedDataAsync({
        domain: typedData.domain,
        types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });

      setStep('recording');
      const recordRes = await fetch(`/api/app/${orgSlug}/delegations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payer_address: address,
          signature,
          nonce,
          chain: chainKey,
          ceiling_usdc: ceiling,
          expires_at: expiresAt.toISOString(),
          payee_agent_id: agentId,
        }),
      });
      if (!recordRes.ok) {
        throw new Error(formatDelegationFailureFromBody(await recordRes.text()));
      }

      setStep('done');
    } catch (caught) {
      const raw = caught instanceof Error ? caught.message : 'Delegation failed.';
      setError(formatDelegationFailureFromBody(raw));
      setStep('idle');
    }
  }

  if (!isConnected) {
    return (
      <div className="delegation-form">
        <p className="delegation-form-meta">
          Connect MetaMask on the chain where the agent already has a wallet.
        </p>
        <div className="delegation-form-actions">
          {connectors.map((connector) => (
            <button
              className="delegation-secondary-button"
              key={connector.uid}
              onClick={() => connect({ connector })}
              type="button"
            >
              {connector.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="delegation-form">
      <div className="delegation-wallet-bar">
        <code>{address}</code>
        <button className="treasury-text-action" onClick={() => disconnect()} type="button">
          Disconnect
        </button>
      </div>

      <div className="delegation-form-grid">
        {locked ? (
          <div className="treasury-field-stack">
            <span className="treasury-field-label">Agent</span>
            <span className="delegation-form-meta">{lockedName ?? lockedAgentId}</span>
            {agentId === '' ? (
              <span className="delegation-form-meta is-warn">
                No active wallet on {CHAIN_LABELS[chainKey]} yet. Grant payment access for this chain first.
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
                Grant payment access on {CHAIN_LABELS[chainKey]} first — Permit2 names that wallet as spender.
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
        {onWrongChain ? (
          <button
            className="delegation-primary-button"
            onClick={() => switchChain({ chainId: targetChainId })}
            type="button"
          >
            Switch to {CHAIN_LABELS[chainKey]}
          </button>
        ) : (
          <button
            className="delegation-primary-button"
            disabled={(step !== 'idle' && step !== 'done') || agentId === ''}
            onClick={() => void handleDelegate()}
            type="button"
          >
            {step === 'approving' ? 'Confirm approval…'
              : step === 'signing' ? 'Sign in wallet…'
              : step === 'recording' ? 'Recording…'
              : needsApproval ? 'Approve, then delegate' : 'Delegate'}
          </button>
        )}
        {step === 'done' ? (
          <span className="delegation-form-meta is-ok">Active — agent can draw up to {ceiling} USDC.</span>
        ) : null}
        {error === null ? null : <span className="delegation-form-meta is-error">{error}</span>}
      </div>
    </div>
  );
}
