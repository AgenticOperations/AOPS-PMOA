'use client';

import { useState } from 'react';
import type { SupportedChainKey } from '@/lib/wallet-chains';

type Ceiling = {
  readonly chain: string;
  readonly treasury_address: string | null;
  readonly ceiling_usdc: string | null;
  readonly outstanding_usdc: string;
};

type Props = {
  readonly orgSlug: string;
  readonly ceilings: readonly Ceiling[];
};

const CHAIN_LABELS: Record<SupportedChainKey, string> = {
  arc: 'Arc testnet',
  base: 'Base Sepolia',
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
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
        <h3 className="font-medium">Org spending ceiling</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No treasury wallet yet. Create one on the Treasury page, then set a ceiling here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-medium">Org spending ceiling</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        The most this org can have delegated at once, per chain. Every agent&apos;s cap counts
        against it.
      </p>

      <div className="mt-4 grid gap-4">
        {ceilings.map((ceiling) => (
          <div key={ceiling.chain} className="grid gap-2 rounded-md border p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">
                {CHAIN_LABELS[ceiling.chain as SupportedChainKey] ?? ceiling.chain}
              </span>
              {ceiling.treasury_address === null ? null : (
                <span className="font-mono text-xs text-muted-foreground">
                  {shortAddress(ceiling.treasury_address)}
                </span>
              )}
            </div>

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
              {ceiling.outstanding_usdc} USDC currently delegated
              {ceiling.ceiling_usdc === null
                ? ' · no ceiling set, bounded only by what the treasury holds'
                : ` of ${ceiling.ceiling_usdc} USDC`}
            </p>
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
