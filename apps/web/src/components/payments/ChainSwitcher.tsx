'use client';

import { useState } from 'react';
import { IconArrowRight } from '@tabler/icons-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { ChainMark } from './ChainMark';
import { formatMoney, formatRailProofState, titleCase } from '@/lib/payments-format';
import type {
  CircleChainCapabilityRecord,
  PaymentChain,
  PaymentRailReadinessRecord,
  PaymentSourceRecord,
} from '@/lib/payments-types';

export type ChainRow = {
  readonly capability: CircleChainCapabilityRecord;
  readonly chain: PaymentChain;
  readonly connected: boolean;
  readonly exactRail: PaymentRailReadinessRecord | null;
  readonly exactSource: PaymentSourceRecord | null;
  readonly gatewayAvailable: string;
  readonly gatewayRail: PaymentRailReadinessRecord | null;
  readonly gatewaySource: PaymentSourceRecord | null;
  readonly gatewayTotal: string;
  readonly gatewayWithdrawable: string;
  readonly label: string;
  readonly walletAddress: string | null;
  readonly walletId: string | null;
  readonly walletUsdc: string;
};

type ChainSwitcherProps = {
  readonly providerReady: boolean;
  readonly rows: readonly ChainRow[];
  readonly runProofAction: (formData: FormData) => Promise<void>;
};

function sum(...values: readonly string[]): string {
  const total = values.reduce((current, value) => current + (Number.parseFloat(value) || 0), 0);
  return total.toFixed(6).replace(/\.?0+$/, '') || '0';
}

function shortAddress(value: string | null): string {
  if (value === null) return 'Not connected';
  return value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export function ChainSwitcher({ providerReady, rows, runProofAction }: ChainSwitcherProps) {
  const [selected, setSelected] = useState(rows[0]?.chain ?? 'base');
  const active = rows.find((row) => row.chain === selected) ?? rows[0];
  if (active === undefined) return null;

  const totalAvailable = sum(active.walletUsdc, active.gatewayAvailable);

  return (
    <div className="treasury-network-canvas">
      <div className="treasury-network-main" role="tabpanel">
        <section className="treasury-chain-identity">
          <div className="treasury-chain-title"><p>Active network</p><h2>{active.label}</h2></div>
          <div className="treasury-chain-logo"><ChainMark chain={active.chain} /></div>
          <dl className="treasury-chain-meta">
            <div><dt>Circle network</dt><dd>{active.capability.network_label ?? active.capability.circle_blockchain}</dd></div>
            <div><dt>Gateway domain</dt><dd>{active.capability.gateway_domain}</dd></div>
            <div><dt>Account</dt><dd>{active.capability.wallet_account_type === 'sca' ? 'Smart contract wallet' : 'Externally owned account'}</dd></div>
            <div><dt>Provider</dt><dd>Circle · {!providerReady ? 'Unavailable' : active.connected ? 'Connected' : 'Not connected'}</dd></div>
          </dl>
        </section>

        <section className="treasury-network-data">
          <div className="treasury-balance-row">
            <div><small>Available</small><strong>{providerReady ? formatMoney(totalAvailable) : 'Unavailable'}</strong></div>
            <div><small>Gateway</small><strong>{providerReady ? formatMoney(active.gatewayAvailable) : 'Unavailable'}</strong></div>
            <div><small>Exact wallet</small><strong>{providerReady ? formatMoney(active.walletUsdc) : 'Unavailable'}</strong></div>
          </div>

          <div className="treasury-network-line">
            <span>Treasury wallet</span>
            <code title={active.walletAddress ?? undefined}>{shortAddress(active.walletAddress)}{active.walletId === null ? '' : ` · ${active.walletId}`}</code>
            <StatusBadge label={active.connected ? 'Active' : 'Missing'} status={active.connected ? 'active' : 'warning'} />
          </div>

          <p className="treasury-rail-eyebrow">Executable rails</p>
          <RailRow
            description="Direct USDC authorization from the dedicated chain wallet."
            label="Exact settlement"
            rail={active.exactRail}
            railValue={`exact_${active.chain}`}
            providerReady={providerReady}
            runProofAction={runProofAction}
            source={active.exactSource}
          />
          <RailRow
            description="Chain-scoped Gateway liquidity for x402 nanopayments."
            label="Gateway x402"
            rail={active.gatewayRail}
            railValue={`gateway_${active.chain}`}
            providerReady={providerReady}
            runProofAction={runProofAction}
            source={active.gatewaySource}
          />

          <div className="treasury-network-line treasury-withdrawable-line">
            <span>Withdrawable</span>
            <strong>{formatMoney(active.gatewayWithdrawable)}</strong>
            <small>{formatMoney(active.gatewayTotal)} total Gateway balance</small>
          </div>
        </section>
      </div>

      <div aria-label="Settlement network" className="treasury-chain-strip" role="tablist">
        {rows.map((row) => {
          const ready = providerReady ? [row.exactRail, row.gatewayRail].filter((rail) => rail?.status === 'ready').length : 0;
          const tracked = [row.exactRail, row.gatewayRail].filter((rail) => rail?.supported).length;
          return (
            <button aria-selected={row.chain === selected} className={row.chain === selected ? 'is-active' : undefined} key={row.chain} onClick={() => setSelected(row.chain)} role="tab" type="button">
              <ChainMark chain={row.chain} size="small" />
              <span><strong>{row.label}</strong><small>{providerReady ? `${formatMoney(sum(row.walletUsdc, row.gatewayAvailable))} · ${ready}/${tracked} ready` : 'Provider unavailable'}</small></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RailRow({ description, label, providerReady, rail, railValue, runProofAction, source }: {
  readonly description: string;
  readonly label: string;
  readonly providerReady: boolean;
  readonly rail: PaymentRailReadinessRecord | null;
  readonly railValue: string;
  readonly runProofAction: (formData: FormData) => Promise<void>;
  readonly source: PaymentSourceRecord | null;
}) {
  const ready = rail?.status === 'ready';
  return (
    <div className="treasury-rail-row">
      <div><strong>{label}</strong><small>{description}</small>{source === null ? null : <code>{source.label}</code>}</div>
      <div><strong>{!providerReady ? 'Provider unavailable' : rail === null ? 'Not tracked' : formatRailProofState(rail)}</strong><StatusBadge label={!providerReady ? 'Unavailable' : rail === null ? 'Unsupported' : titleCase(rail.status)} status={providerReady && ready ? 'active' : 'warning'} /></div>
      <form action={runProofAction}>
        <input name="rail" type="hidden" value={railValue} />
        <button className="treasury-text-action" disabled={!providerReady || rail === null || !rail.supported} type="submit">Run proof <IconArrowRight aria-hidden="true" size={13} stroke={1.8} /></button>
      </form>
    </div>
  );
}
