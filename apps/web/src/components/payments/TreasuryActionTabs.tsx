import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CHAIN_LABELS, FIELD_CLASS } from '@/lib/payments-format';
import type { CircleChainCapabilityRecord } from '@/lib/payments-types';

type TreasuryActionTabsProps = {
  readonly activeWalletCount: number;
  readonly capabilities: readonly CircleChainCapabilityRecord[];
  readonly gatewayDepositAction: (formData: FormData) => Promise<void>;
};

export function TreasuryActionTabs({ activeWalletCount, capabilities, gatewayDepositAction }: TreasuryActionTabsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fund and connect</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={gatewayDepositAction} className="grid gap-3">
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
              <button className="button-primary" disabled={activeWalletCount === 0} type="submit">
                Deposit to Gateway
              </button>
              <p className="text-xs text-muted-foreground">Requires balance on the same chain. Minimum deposit is 0.5 USDC.</p>
        </form>
      </CardContent>
    </Card>
  );
}
