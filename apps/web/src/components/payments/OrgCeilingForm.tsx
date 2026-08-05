'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { SupportedChainKey } from '@/lib/wallet-chains';
import { CopyableAddress } from './CopyableAddress';

type Ceiling = {
  readonly chain: string;
  readonly treasury_address: string | null;
  readonly ceiling_usdc: string | null;
  readonly outstanding_usdc: string;
  // null when the balance RPC was unreachable. Distinct from '0': one means
  // "we could not look", the other means "there is nothing there".
  readonly treasury_balance_usdc: string | null;
};

type Props = {
  readonly orgSlug: string;
  readonly ceilings: readonly Ceiling[];
};

const CHAIN_LABELS: Record<SupportedChainKey, string> = {
  arc: 'Arc testnet',
  base: 'Base Sepolia',
};

function usdc(value: string | null): string {
  return value === null ? '—' : Number(value).toFixed(2);
}

/**
 * The org-wide cap on total delegated spend, set per chain.
 *
 * Per chain and never global: a Permit2 allowance lives on one chain, so a
 * single cross-chain number could not be enforced on-chain and would be a
 * comforting lie.
 */
export function OrgCeilingForm({ orgSlug, ceilings }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(ceilings.map((c) => [c.chain, c.ceiling_usdc ?? ''])),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function handleSave(chain: string) {
    setError(null);
    setSaved(null);
    setSaving(chain);
    try {
      const response = await fetch(`/api/app/${orgSlug}/delegations/ceiling`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chain, ceiling_usdc: drafts[chain] ?? '0' }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? 'The ceiling could not be saved.');
      }
      setSaved(chain);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The ceiling could not be saved.');
    } finally {
      setSaving(null);
    }
  }

  if (ceilings.length === 0) {
    return (
      <div className="rounded-lg border p-4">
        <h3 className="font-medium">Treasury &amp; org spending ceiling</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No treasury wallet yet — there is nothing for an agent to draw from. Create one on{' '}
          <Link className="underline" href={`/app/${orgSlug}/payments/sources`}>Sources</Link>, then
          fund it from{' '}
          <Link className="underline" href={`/app/${orgSlug}/payments/funding`}>Funding</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-medium">Treasury &amp; org spending ceiling</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        The most this org can have delegated at once, per chain. Every agent&apos;s cap counts
        against it, and a delegation also has to be covered by the treasury balance below.
      </p>
      {/*
        Only the WALLET balance backs a Permit2 pull. USDC moved to Gateway
        (Payments -> Sources -> "Move to Gateway") leaves that balance and
        stops backing delegations, which is a surprising enough one-way door
        to name here rather than let operators discover it.
      */}
      <p className="mt-1 text-xs text-muted-foreground">
        Only USDC held in the treasury wallet backs a delegation. Funds moved into Circle Gateway
        are spent through the allocation rail instead and do not count here.
      </p>

      <div className="mt-4 grid gap-4">
        {ceilings.map((ceiling) => (
          <div key={ceiling.chain} className="grid gap-2 rounded-md border p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">
                {CHAIN_LABELS[ceiling.chain as SupportedChainKey] ?? ceiling.chain}
              </span>
              {ceiling.treasury_address === null ? null : (
                <CopyableAddress address={ceiling.treasury_address} />
              )}
            </div>

            {/*
              Deposit address and balance sit together deliberately. When a
              delegation is refused for insolvency, the number that caused it
              and the address that fixes it are both already on screen.
            */}
            <p className="text-xs text-muted-foreground">
              Treasury holds{' '}
              <span className="font-medium text-foreground">
                {usdc(ceiling.treasury_balance_usdc)} USDC
              </span>
              {ceiling.treasury_balance_usdc === null
                ? ' — balance unavailable, the chain RPC did not respond'
                : '. Send USDC to the address above to add more.'}
            </p>

            <div className="flex items-end gap-2">
              <label className="grid flex-1 gap-1 text-sm">
                Ceiling (USDC)
                <input
                  value={drafts[ceiling.chain] ?? ''}
                  onChange={(event) =>
                    setDrafts((previous) => ({ ...previous, [ceiling.chain]: event.target.value }))
                  }
                  placeholder="No ceiling set"
                  className="rounded-md border px-2 py-1"
                  inputMode="decimal"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleSave(ceiling.chain)}
                disabled={saving === ceiling.chain}
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {saving === ceiling.chain ? 'Saving…' : 'Save'}
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              {usdc(ceiling.outstanding_usdc)} USDC currently delegated
              {ceiling.ceiling_usdc === null
                ? ' · no ceiling set, bounded only by what the treasury holds'
                : ` of ${usdc(ceiling.ceiling_usdc)} USDC`}
            </p>

            {/*
              A delegation must fit under BOTH bounds, so the smaller one is
              what actually binds. Saying so is the difference between an
              operator raising the ceiling (no effect) and funding the
              treasury (the actual fix).
            */}
            {ceiling.ceiling_usdc !== null
              && ceiling.treasury_balance_usdc !== null
              && Number(ceiling.treasury_balance_usdc) < Number(ceiling.ceiling_usdc) ? (
                <p className="text-xs text-amber-600">
                  The treasury holds less than this ceiling, so the balance is what actually limits
                  new delegations. Raising the ceiling will not help until you deposit more.
                </p>
              ) : null}

            {saved === ceiling.chain ? (
              <p className="text-xs text-emerald-600">Saved.</p>
            ) : null}
          </div>
        ))}
      </div>

      {error === null ? null : <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
