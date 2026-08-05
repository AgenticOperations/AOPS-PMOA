'use client';

import { useActionState, useState } from 'react';
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { CHAIN_LABELS, FIELD_CLASS } from '@/lib/payments-format';
import type { CircleChainCapabilityRecord } from '@/lib/payments-types';

type TreasuryActionTabsProps = {
  readonly activeWalletCount: number;
  readonly capabilities: readonly CircleChainCapabilityRecord[];
  readonly gatewayDepositAction: (formData: FormData) => Promise<void>;
  readonly providerReady: boolean;
};

export function TreasuryActionTabs({ activeWalletCount, capabilities, gatewayDepositAction, providerReady }: TreasuryActionTabsProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (_state: { readonly error?: string }, formData: FormData) => {
    try {
      await gatewayDepositAction(formData);
      setOpen(false);
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Gateway deposit could not be started.' };
    }
  }, {});

  return (
    <>
      {/*
        Labelled "Move to Gateway", never "Deposit". This moves USDC OUT of
        the treasury wallet, and an operator reading "Deposit" reasonably
        assumes the opposite. It is also a one-way door: Gateway funds can no
        longer back a Permit2 delegation, so a mis-click here silently makes
        every treasury delegation fail the solvency check.
      */}
      <button className="treasury-button treasury-button-primary" disabled={!providerReady || activeWalletCount === 0} onClick={() => setOpen(true)} type="button">Move to Gateway</button>
      <Sheet labelledBy="gateway-deposit-title" onOpenChange={(nextOpen) => !pending && setOpen(nextOpen)} open={open} panelClassName="treasury-drawer">
        <SheetHeader>
          <div>
            <SheetTitle id="gateway-deposit-title">Move USDC to Gateway</SheetTitle>
            <SheetDescription>Moves USDC out of this chain&apos;s treasury wallet and into its Gateway payment bucket. This is not a deposit into the treasury.</SheetDescription>
          </div>
          <SheetCloseButton disabled={pending} onClick={() => setOpen(false)} />
        </SheetHeader>
        <form action={formAction} className="focus-form">
          <SheetBody className="treasury-drawer-form">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Chain</span>
                <select className={FIELD_CLASS} defaultValue="base" name="chain">
                  {capabilities.filter((capability) => capability.gateway_supported).map((capability) => (
                    <option key={capability.chain} value={capability.chain}>
                      {CHAIN_LABELS[capability.chain]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Amount</span>
                <input className={FIELD_CLASS} defaultValue="0.50" inputMode="decimal" min="0.5" name="amount" required step="0.01" />
              </label>
              <p className="text-xs text-muted-foreground">Requires balance on the same chain. Minimum is 0.5 USDC.</p>
              <p className="text-xs text-amber-600">
                USDC moved here no longer backs Permit2 delegations — it is spent through the
                allocation rail instead. To fund agent delegations, send USDC to the treasury
                address on the Funding page rather than moving it here.
              </p>
              {state.error !== undefined ? <p className="form-error" role="alert">{state.error}</p> : null}
              <button className="treasury-button treasury-button-primary treasury-form-submit" disabled={pending || !providerReady || activeWalletCount === 0} type="submit">{pending ? 'Moving...' : 'Move USDC to Gateway'}</button>
          </SheetBody>
        </form>
      </Sheet>
    </>
  );
}
