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
    byChain: Map<PaymentChain, AgentWalletFundingRecord>;
  }>();

  for (const wallet of agentWallets) {
    const existing = groups.get(wallet.agentId);
    if (existing === undefined) {
      groups.set(wallet.agentId, {
        agentId: wallet.agentId,
        agentName: wallet.agentName,
        byChain: new Map([[wallet.chain, wallet]]),
      });
      continue;
    }
    existing.byChain.set(wallet.chain, wallet);
  }

  return [...groups.values()].map((group) => ({
    agentId: group.agentId,
    agentName: group.agentName,
    byChain: group.byChain,
    chains: [...group.byChain.keys()].sort((left, right) => left.localeCompare(right)),
  }));
}

/**
 * Fund: pick one of two paths. Treasury deposit only for path 1.
 * Agents listed as balances only — inspect, not deposit targets.
 */
export function FundingHierarchy({ treasuryWallets, agentWallets, orgSlug }: Props) {
  const fundedChains = treasuryWallets.filter((wallet) => wallet.status === 'active');
  const [treasuryChain, setTreasuryChain] = useState<PaymentChain | ''>(fundedChains[0]?.chain ?? '');
  const activeTreasury = fundedChains.find((wallet) => wallet.chain === treasuryChain) ?? fundedChains[0];
  const agentGroups = useMemo(() => groupAgentWallets(agentWallets), [agentWallets]);
  const walletPathHref = `/app/${orgSlug}/payments/empower?tab=delegations&source=wallet&from=fund`;

  return (
    <div className="fund-surface">
      <section className="fund-paths" aria-label="Funding paths">
        <p className="fund-paths-label">Choose one path</p>
        <div className="fund-path-toggle" role="tablist">
          <button
            aria-selected
            className="is-active"
            role="tab"
            type="button"
          >
            <span className="fund-path-title">Org treasury</span>
            <span className="fund-path-sub">Deposit here</span>
          </button>
          <Link
            aria-selected={false}
            className="fund-path-link"
            href={walletPathHref}
            role="tab"
          >
            <span className="fund-path-title">Your wallet</span>
            <span className="fund-path-sub">Skip deposit → Empower</span>
          </Link>
        </div>
      </section>

      <section className="fund-body" role="tabpanel">
        {fundedChains.length === 0 || activeTreasury === undefined ? (
          <TreasuryInfoCallout>
            No treasury yet.{' '}
            <Link href={`/app/${orgSlug}/payments/sources`}>Open Networks</Link>
          </TreasuryInfoCallout>
        ) : (
          <div className="fund-deposit">
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
              <span className="treasury-field-label">Send USDC here</span>
              <CopyableAddress address={activeTreasury.address} />
            </div>
          </div>
        )}
      </section>

      <section className="fund-roster" aria-label="Balances">
        <h2>Balances</h2>
        <ul className="fund-roster-list">
          <li className="fund-roster-row is-treasury">
            <span className="fund-roster-name">Org treasury</span>
            <span className="fund-roster-meta">
              {activeTreasury === undefined
                ? '—'
                : (CHAIN_LABELS[activeTreasury.chain] ?? activeTreasury.chain)}
            </span>
            <span className="fund-roster-balance">—</span>
          </li>
          {agentGroups.length === 0 ? (
            <li className="fund-roster-empty">No agents with wallets yet</li>
          ) : (
            agentGroups.map((group) => (
              <AgentBalanceRow group={group} key={group.agentId} />
            ))
          )}
        </ul>
      </section>
    </div>
  );
}

function AgentBalanceRow({ group }: { readonly group: AgentFundingGroup }) {
  const initialChain = group.chains[0];
  const [chain, setChain] = useState<PaymentChain | null>(initialChain ?? null);
  if (initialChain === undefined || chain === null) return null;
  const selected = group.byChain.get(chain) ?? group.byChain.get(initialChain);
  if (selected === undefined) return null;

  return (
    <li className="fund-roster-row">
      <span className="fund-roster-identity">
        <AgentAvatar agentId={group.agentId} name={group.agentName} size="sm" />
        <span className="fund-roster-name">{group.agentName}</span>
      </span>
      {group.chains.length > 1 ? (
        <select
          aria-label={`${group.agentName} chain`}
          className="fund-roster-chain"
          onChange={(event) => setChain(event.target.value as PaymentChain)}
          value={selected.chain}
        >
          {group.chains.map((value) => (
            <option key={value} value={value}>
              {CHAIN_LABELS[value] ?? value}
            </option>
          ))}
        </select>
      ) : (
        <span className="fund-roster-meta">{CHAIN_LABELS[selected.chain] ?? selected.chain}</span>
      )}
      <span className="fund-roster-balance">{usdc(selected.usdcMicros)} USDC</span>
    </li>
  );
}
