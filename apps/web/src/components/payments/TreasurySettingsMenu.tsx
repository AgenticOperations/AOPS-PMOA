'use client';

import { IconSettings } from '@tabler/icons-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusBadge } from '@/components/ui/status-badge';
import type { CircleChainCapabilityRecord, OrgPaymentModeRecord } from '@/lib/payments-types';

type TreasurySettingsMenuProps = {
  readonly activeWalletCount: number;
  readonly capabilities: readonly CircleChainCapabilityRecord[];
  readonly circleTreasuryAction: (formData: FormData) => Promise<void>;
  readonly createTreasuryDisabled: boolean;
  readonly paymentMode: OrgPaymentModeRecord;
  readonly testnetFundsAction: (formData: FormData) => Promise<void>;
};

export function TreasurySettingsMenu({
  activeWalletCount,
  capabilities,
  circleTreasuryAction,
  createTreasuryDisabled,
  paymentMode,
  testnetFundsAction,
}: TreasurySettingsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <button
          aria-label="Treasury settings"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground ring-1 ring-border transition-colors hover:bg-muted hover:text-foreground"
          type="button"
        >
          <IconSettings aria-hidden="true" size={17} stroke={1.8} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Provider mode</DropdownMenuLabel>
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
          <StatusBadge label="Testnet" status="pending" />
          <span className="text-xs text-muted-foreground">Live mode unavailable</span>
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Actions</DropdownMenuLabel>

        <form action={circleTreasuryAction}>
          <input name="label" type="hidden" value={paymentMode.mode === 'live' ? 'Live Circle Agent Wallet' : 'Testnet Circle Agent Wallet'} />
          <DropdownMenuItem disabled={createTreasuryDisabled} type="submit">
            Sync Agent Wallet
            {activeWalletCount > 0 ? <span className="ml-auto text-xs text-muted-foreground">Refresh</span> : null}
          </DropdownMenuItem>
        </form>

        {paymentMode.mode === 'test' ? (
          <form action={testnetFundsAction}>
            {capabilities.map((capability) => (
              <input key={capability.chain} name="chains" type="hidden" value={capability.chain} />
            ))}
            <DropdownMenuItem disabled={activeWalletCount === 0} type="submit">
              Request testnet funds
              <span className="ml-auto text-xs text-muted-foreground">All chains</span>
            </DropdownMenuItem>
          </form>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
