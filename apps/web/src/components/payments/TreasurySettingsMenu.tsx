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
  readonly paymentMode: OrgPaymentModeRecord;
  readonly providerReady: boolean;
  readonly testnetFundsAction: (formData: FormData) => Promise<void>;
};

export function TreasurySettingsMenu({
  activeWalletCount,
  capabilities,
  paymentMode,
  providerReady,
  testnetFundsAction,
}: TreasurySettingsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <button
          aria-label="More treasury actions"
          className="treasury-icon-button"
          type="button"
        >
          <IconSettings aria-hidden="true" size={17} stroke={1.8} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Environment</DropdownMenuLabel>
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
          <StatusBadge label="Testnet" status="pending" />
          <span className="text-xs text-muted-foreground">Live mode unavailable</span>
        </div>

        <DropdownMenuSeparator />
        {paymentMode.mode === 'test' ? (<><DropdownMenuLabel>Funding</DropdownMenuLabel>
          <form action={testnetFundsAction}>
            {capabilities.map((capability) => (
              <input key={capability.chain} name="chains" type="hidden" value={capability.chain} />
            ))}
            <DropdownMenuItem disabled={!providerReady || activeWalletCount === 0} type="submit">
              Request testnet funds
              <span className="ml-auto text-xs text-muted-foreground">All chains</span>
            </DropdownMenuItem>
          </form>
        </>) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
