import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from './StatTile';
import { formatMoney } from '@/lib/payments-format';
import { getPaymentsConsoleSnapshot } from '@/lib/server/payments-client';

type TreasuryBalanceTilesProps = {
  readonly orgId: string;
};

export async function TreasuryBalanceTiles({ orgId }: TreasuryBalanceTilesProps) {
  const snapshot = await getPaymentsConsoleSnapshot(orgId);
  return (
    <>
      <StatTile label="Available USDC" value={formatMoney(snapshot.overview.totals.treasury_usdc)} />
      <StatTile label="Gateway liquidity" value={formatMoney(snapshot.overview.totals.gateway_usdc)} />
    </>
  );
}

export function TreasuryBalanceTilesSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3 ring-1 ring-border">
        <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Available USDC</span>
        <Skeleton className="h-6 w-24" />
      </div>
      <div className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3 ring-1 ring-border">
        <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Gateway liquidity</span>
        <Skeleton className="h-6 w-24" />
      </div>
    </>
  );
}
