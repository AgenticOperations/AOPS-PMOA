'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { CHAIN_LABELS, FIELD_CLASS } from '@/lib/payments-format';
import { CopyableAddress } from './CopyableAddress';
import { TreasuryInfoCallout } from './TreasuryChrome';
import type { AgentWalletFundingRecord } from '@/lib/server/payments-client';
import type { CircleChainWalletRecord, PaymentChain } from '@/lib/payments-types';

type Props = {
  readonly treasuryWallets: readonly CircleChainWalletRecord[];
  readonly agentWallets: readonly AgentWalletFundingRecord[];
  readonly orgSlug: string;
};

type AgentFundingGroup = {
  readonly agentId: string;
  readonly agentName: string;
  readonly address: string;
  readonly byChain: ReadonlyMap<PaymentChain, AgentWalletFundingRecord>;
  readonly chains: readonly PaymentChain[];
};

function usdc(micros: string | null): string {
  if (micros === null) return '—';
  const value = BigInt(micros);
  return `${(value / 1_000_000n).toString()}.${(value % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`;
}

function groupAgentWallets(agentWallets: readonly AgentWalletFundingRecord[]): AgentFundingGroup[] {
  const groups = new Map<string, {
    agentId: string;
    agentName: string;
    address: string;
    byChain: Map<PaymentChain, AgentWalletFundingRecord>;
  }>();

  for (const wallet of agentWallets) {
    const existing = groups.get(wallet.agentId);
    if (existing === undefined) {
      groups.set(wallet.agentId, {
        agentId: wallet.agentId,
        agentName: wallet.agentName,
        address: wallet.address,
        byChain: new Map([[wallet.chain, wallet]]),
      });
      continue;
    }
    existing.byChain.set(wallet.chain, wallet);
  }

  return [...groups.values()].map((group) => ({
    agentId: group.agentId,
    agentName: group.agentName,
    address: group.address,
    byChain: group.byChain,
    chains: [...group.byChain.keys()].sort((left, right) => left.localeCompare(right)),
  }));
}

/**
 * Fund surface: treasury deposit + agent balances.
 * Caps live under Empower — not repeated here.
 */
export function FundingHierarchy({ treasuryWallets, agentWallets, orgSlug }: Props) {
  const fundedChains = treasuryWallets.filter((wallet) => wallet.status === 'active');
  const [treasuryChain, setTreasuryChain] = useState<PaymentChain | ''>(fundedChains[0]?.chain ?? '');
  const activeTreasury = fundedChains.find((wallet) => wallet.chain === treasuryChain) ?? fundedChains[0];
  const agentGroups = useMemo(() => groupAgentWallets(agentWallets), [agentWallets]);
  const hasBase = agentWallets.some((wallet) => wallet.chain === 'base');

  return (
    <div className="treasury-stack">
      <section className="treasury-panel">
        <header className="treasury-panel-header">
          <h2>Org treasury</h2>
        </header>
        {fundedChains.length === 0 || activeTreasury === undefined ? (
          <TreasuryInfoCallout>
            No treasury yet.{' '}
            <Link href={`/app/${orgSlug}/payments/sources`}>Open Networks</Link>
            {' '}to provision one.
          </TreasuryInfoCallout>
        ) : (
          <div className="treasury-fund-grid">
            <label className="treasury-field-stack">
              <span className="treasury-field-label">Chain</span>
              <select
                className={FIELD_CLASS}
                onChange={(event) => setTreasuryChain(event.target.value as PaymentChain)}
                value={activeTreasury.chain}
              >
                {fundedChains.map((wallet) => (
                  <option key={wallet.chain} value={wallet.chain}>
                    {CHAIN_LABELS[wallet.chain] ?? wallet.chain}
                  </option>
                ))}
              </select>
            </label>
            <div className="treasury-field-stack">
              <span className="treasury-field-label">Deposit address</span>
              <CopyableAddress address={activeTreasury.address} />
            </div>
          </div>
        )}
      </section>

      <section className="treasury-panel">
        <header className="treasury-panel-header treasury-panel-header-row">
          <h2>Agent wallets</h2>
          <Link className="treasury-text-action" href={`/app/${orgSlug}/payments/empower`}>
            Set spend limits →
          </Link>
        </header>
        {agentGroups.length === 0 ? (
          <TreasuryInfoCallout>
            No agent wallets yet. Grant access under{' '}
            <Link href={`/app/${orgSlug}/payments/empower`}>Empower</Link>.
          </TreasuryInfoCallout>
        ) : (
          <div className="treasury-agent-list">
            {agentGroups.map((group) => (
              <AgentWalletCard group={group} key={group.agentId} />
            ))}
          </div>
        )}
        {hasBase ? (
          <TreasuryInfoCallout>
            Base needs a little ETH for gas. Arc uses USDC for gas — no extra token.
          </TreasuryInfoCallout>
        ) : null}
      </section>
    </div>
  );
}

function AgentWalletCard({ group }: { readonly group: AgentFundingGroup }) {
  const initialChain = group.chains[0];
  const [chain, setChain] = useState<PaymentChain | null>(initialChain ?? null);
  if (initialChain === undefined || chain === null) return null;
  const selected = group.byChain.get(chain) ?? group.byChain.get(initialChain);
  if (selected === undefined) return null;

  return (
    <div className="treasury-agent-row">
      <div className="treasury-agent-row-identity">
        <AgentAvatar agentId={group.agentId} name={group.agentName} size="sm" />
        <div className="min-w-0">
          <p className="treasury-agent-name">{group.agentName}</p>
          <CopyableAddress address={group.address} />
        </div>
      </div>
      <label className="treasury-field-stack">
        <span className="treasury-field-label">Chain</span>
        <select
          className={FIELD_CLASS}
          onChange={(event) => setChain(event.target.value as PaymentChain)}
          value={selected.chain}
        >
          {group.chains.map((value) => (
            <option key={value} value={value}>
              {CHAIN_LABELS[value] ?? value}
            </option>
          ))}
        </select>
      </label>
      <div className="treasury-field-stack">
        <span className="treasury-field-label">Balance</span>
        <p className="treasury-metric-value">{usdc(selected.usdcMicros)}</p>
      </div>
      <div className="treasury-field-stack">
        <span className="treasury-field-label">Allocated</span>
        <p className="treasury-metric-value">
          {selected.allocatedUsdc === null
            ? <span className="text-muted-foreground">—</span>
            : selected.allocatedUsdc}
        </p>
      </div>
    </div>
  );
}
