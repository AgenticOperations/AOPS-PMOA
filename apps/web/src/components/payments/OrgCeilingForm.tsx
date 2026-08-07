'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { SupportedChainKey } from '@/lib/wallet-chains';
import { CopyableAddress } from './CopyableAddress';
import { TreasuryInfoCallout } from './TreasuryChrome';

type Ceiling = {
  readonly chain: string;
  readonly treasury_address: string | null;
  readonly ceiling_usdc: string | null;
  readonly outstanding_usdc: string;
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

export function OrgCeilingForm({ orgSlug, ceilings }: Props) {
  const [selectedChain, setSelectedChain] = useState(ceilings[0]?.chain ?? '');
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
      <section className="treasury-panel">
        <header className="treasury-panel-header">
          <h2>Org ceiling</h2>
        </header>
        <TreasuryInfoCallout>
          No treasury wallet yet.{' '}
          <Link href={`/app/${orgSlug}/payments/sources`}>Networks</Link>
          {' · '}
          <Link href={`/app/${orgSlug}/payments/funding`}>Fund</Link>
        </TreasuryInfoCallout>
      </section>
    );
  }

  const ceiling = ceilings.find((item) => item.chain === selectedChain) ?? ceilings[0];
  if (ceiling === undefined) return null;

  return (
    <section className="treasury-panel">
      <header className="treasury-panel-header">
        <h2>Org ceiling</h2>
      </header>

      <TreasuryInfoCallout>
        Max delegated at once, per chain. Only wallet USDC backs Permit2 — Gateway funds do not.
      </TreasuryInfoCallout>

      <div className="treasury-fund-grid">
        <label className="treasury-field-stack">
          <span className="treasury-field-label">Chain</span>
          <select
            className="treasury-select"
            onChange={(event) => setSelectedChain(event.target.value)}
            value={ceiling.chain}
          >
            {ceilings.map((item) => (
              <option key={item.chain} value={item.chain}>
                {CHAIN_LABELS[item.chain as SupportedChainKey] ?? item.chain}
              </option>
            ))}
          </select>
        </label>
        {ceiling.treasury_address === null ? null : (
          <div className="treasury-field-stack">
            <span className="treasury-field-label">Treasury address</span>
            <CopyableAddress address={ceiling.treasury_address} />
          </div>
        )}
      </div>

      <p className="treasury-inline-meta">
        Holds <strong>{usdc(ceiling.treasury_balance_usdc)} USDC</strong>
        {' · '}
        {usdc(ceiling.outstanding_usdc)} delegated
        {ceiling.ceiling_usdc === null ? '' : ` of ${usdc(ceiling.ceiling_usdc)}`}
      </p>

      <div className="treasury-inline-actions">
        <label className="treasury-field-stack">
          <span className="treasury-field-label">Ceiling (USDC)</span>
          <input
            className="treasury-input"
            inputMode="decimal"
            onChange={(event) =>
              setDrafts((previous) => ({ ...previous, [ceiling.chain]: event.target.value }))
            }
            placeholder="No ceiling"
            value={drafts[ceiling.chain] ?? ''}
          />
        </label>
        <button
          className="treasury-button treasury-button-primary"
          disabled={saving === ceiling.chain}
          onClick={() => void handleSave(ceiling.chain)}
          type="button"
        >
          {saving === ceiling.chain ? 'Saving…' : 'Save'}
        </button>
      </div>

      {ceiling.ceiling_usdc !== null
        && ceiling.treasury_balance_usdc !== null
        && Number(ceiling.treasury_balance_usdc) < Number(ceiling.ceiling_usdc) ? (
          <TreasuryInfoCallout>
            Balance is below this ceiling — deposits, not a higher ceiling, unlock more headroom.
          </TreasuryInfoCallout>
        ) : null}

      {saved === ceiling.chain ? <p className="treasury-ok">Saved.</p> : null}
      {error === null ? null : <p className="treasury-error">{error}</p>}
    </section>
  );
}
