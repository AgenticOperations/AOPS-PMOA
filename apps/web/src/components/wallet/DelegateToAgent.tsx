'use client';

import { useState } from 'react';
import { useAccount, useChainId, useConnect, useDisconnect, useReadContract, useSignTypedData, useSwitchChain, useWriteContract } from 'wagmi';
import { erc20Abi } from 'viem';
import { CHAIN_ID_BY_KEY, PERMIT2_ADDRESS, USDC_ADDRESS, type SupportedChainKey } from '@/lib/wallet-chains';

type Agent = {
  readonly id: string;
  readonly name: string;
};

type Props = {
  readonly orgSlug: string;
  readonly agents: readonly Agent[];
};

type Step = 'idle' | 'approving' | 'signing' | 'recording' | 'done';

/**
 * The non-custodial delegation flow. The operator's own wallet holds the
 * money; an agent draws against a Permit2 allowance capped at the ceiling
 * set here.
 *
 * Exactly one transaction is required (approve), and only when the current
 * allowance is short. The delegation itself is a signature: no gas, no
 * transaction, no waiting for a block.
 */
export function DelegateToAgent({ orgSlug, agents }: Props) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const [chainKey, setChainKey] = useState<SupportedChainKey>('arc');
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [ceiling, setCeiling] = useState('5.00');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);

  const targetChainId = CHAIN_ID_BY_KEY[chainKey];
  const token = USDC_ADDRESS[chainKey];
  const onWrongChain = isConnected && chainId !== targetChainId;

  // Read the live allowance so approve() is only prompted when it's short,
  // rather than on every single delegation.
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
    if (address === undefined || ceilingMicros === null) return;

    try {
      // 1. Approve Permit2 on the token, if the existing allowance is short.
      //    Permit2 pulls funds through the token's own transferFrom, so
      //    without this the drawdown reverts with TRANSFER_FROM_FAILED.
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

      // 2. Ask the API for the exact EIP-712 payload. It reads the live
      //    Permit2 nonce; that value must come back unchanged in step 3.
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

      // EIP712Domain is described by the domain itself; passing it in types
      // as well makes viem throw on an ambiguous primary type.
      const { EIP712Domain: _ignored, ...types } = typedData.types;
      const signature = await signTypedDataAsync({
        domain: typedData.domain,
        types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });

      // 3. Record it. The nonce is echoed back exactly as issued -- a
      //    server-side re-read could return a newer one than was signed.
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
      if (!recordRes.ok) throw new Error(await recordRes.text());

      setStep('done');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Delegation failed.');
      setStep('idle');
    }
  }

  if (!isConnected) {
    return (
      <div className="rounded-lg border p-4">
        <h3 className="font-medium">Connect your wallet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Your wallet keeps the funds. Agents draw only what you allow, and you can revoke at any time.
        </p>
        <div className="mt-3 flex gap-2">
          {connectors.map((connector) => (
            <button
              key={connector.uid}
              type="button"
              onClick={() => connect({ connector })}
              className="rounded-md border px-3 py-2 text-sm"
            >
              {connector.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Delegate spending to an agent</h3>
          <p className="text-xs text-muted-foreground">{address}</p>
        </div>
        <button type="button" onClick={() => disconnect()} className="text-sm underline">
          Disconnect
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm">
          Agent
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)} className="rounded-md border px-2 py-1">
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
            The most this agent can ever draw. Your funds stay in your wallet until it does.
          </span>
        </label>
      </div>

      {onWrongChain ? (
        <button
          type="button"
          onClick={() => switchChain({ chainId: targetChainId })}
          className="mt-4 w-full rounded-md border px-3 py-2 text-sm"
        >
          Switch network to continue
        </button>
      ) : (
        <button
          type="button"
          onClick={handleDelegate}
          disabled={step !== 'idle' && step !== 'done'}
          className="mt-4 w-full rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          {step === 'approving' ? 'Confirm approval in your wallet…'
            : step === 'signing' ? 'Sign the delegation…'
            : step === 'recording' ? 'Recording…'
            : needsApproval ? 'Approve, then delegate' : 'Delegate (no gas)'}
        </button>
      )}

      {step === 'done' ? (
        <p className="mt-3 text-sm">Delegation active. The agent can now draw up to {ceiling} USDC.</p>
      ) : null}
      {error !== null ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
