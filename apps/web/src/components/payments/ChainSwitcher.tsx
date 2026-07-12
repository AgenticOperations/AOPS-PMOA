'use client';

import { useState } from 'react';
import { IconCircleCheck, IconCircleDashed } from '@tabler/icons-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';
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
  readonly label: string;
  readonly walletAddress: string | null;
  readonly walletUsdc: string;
};

type ChainSwitcherProps = {
  readonly rows: readonly ChainRow[];
  readonly runProofAction: (formData: FormData) => Promise<void>;
};

export function ChainSwitcher({ rows, runProofAction }: ChainSwitcherProps) {
  const [selected, setSelected] = useState(rows[0]?.chain ?? 'base');
  const active = rows.find((row) => row.chain === selected) ?? rows[0];

  if (active === undefined) return null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {rows.map((row) => (
          <button
            aria-selected={row.chain === selected}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
              row.chain === selected
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
            key={row.chain}
            onClick={() => setSelected(row.chain)}
            role="tab"
            type="button"
          >
            {row.connected ? (
              <IconCircleCheck aria-hidden="true" size={14} stroke={2} />
            ) : (
              <IconCircleDashed aria-hidden="true" size={14} stroke={2} />
            )}
            {row.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 rounded-xl bg-muted p-4 ring-1 ring-border md:grid-cols-[1fr_1fr]">
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Wallet</span>
            <StatusBadge label={active.connected ? 'Connected' : 'Not connected'} status={active.connected ? 'active' : 'pending'} />
          </div>
          {active.walletAddress !== null ? (
            <code className="truncate text-xs text-muted-foreground" title={active.walletAddress}>
              {active.walletAddress.slice(0, 10)}...{active.walletAddress.slice(-8)}
            </code>
          ) : (
            <p className="text-sm text-muted-foreground">Sync the Agent Wallet to connect this chain.</p>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="grid gap-0.5">
              <span className="text-xs text-muted-foreground">Wallet balance</span>
              <span className="tabular-nums font-semibold">{formatMoney(active.walletUsdc)}</span>
            </div>
            <div className="grid gap-0.5">
              <span className="text-xs text-muted-foreground">Gateway balance</span>
              <span className="tabular-nums font-semibold">{formatMoney(active.gatewayAvailable)}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-2">
          <RailRow
            label="Exact settlement"
            rail={active.exactRail}
            railValue={`exact_${active.chain}`}
            runProofAction={runProofAction}
            source={active.exactSource}
          />
          <RailRow
            label="Gateway x402"
            rail={active.gatewayRail}
            railValue={`gateway_${active.chain}`}
            runProofAction={runProofAction}
            source={active.gatewaySource}
          />
        </div>
      </div>
    </div>
  );
}

function RailRow({
  label,
  rail,
  railValue,
  runProofAction,
  source,
}: {
  readonly label: string;
  readonly rail: PaymentRailReadinessRecord | null;
  readonly railValue: string;
  readonly runProofAction: (formData: FormData) => Promise<void>;
  readonly source: PaymentSourceRecord | null;
}) {
  const ready = rail?.status === 'ready';
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2.5 ring-1 ring-border">
      <div className="grid min-w-0 gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        <span className="truncate text-xs text-muted-foreground">
          {source !== null ? `${source.label} · ` : ''}
          {rail !== null ? formatRailProofState(rail) : 'Not tracked'}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge label={rail !== null ? titleCase(rail.status) : 'Unsupported'} status={ready ? 'active' : 'pending'} />
        <form action={runProofAction}>
          <input name="rail" type="hidden" value={railValue} />
          <button className="button-secondary" disabled={rail === null || !rail.supported} type="submit">
            Run proof
          </button>
        </form>
      </div>
    </div>
  );
}
