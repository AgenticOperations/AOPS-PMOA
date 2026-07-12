import type { ReactNode } from 'react';
import { Suspense } from 'react';
import Link from 'next/link';
import { IconAlertTriangle } from '@tabler/icons-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from './StatTile';
import { TreasuryBalanceTiles, TreasuryBalanceTilesSkeleton } from './TreasuryBalanceTiles';
import type { CircleProviderJobRecord, OrgPaymentModeRecord, PaymentRailReadinessRecord } from '@/lib/payments-types';

type NeedsAttentionItem = {
  readonly description: string;
  readonly href: string;
  readonly title: string;
};

type TreasuryOverviewProps = {
  readonly agentsWithAccess: number;
  readonly circleConnected: boolean;
  readonly failedJobs: readonly CircleProviderJobRecord[];
  readonly orgId: string;
  readonly orgSlug: string;
  readonly paymentMode: OrgPaymentModeRecord;
  readonly pendingReservations: number;
  readonly railReadiness: readonly PaymentRailReadinessRecord[];
};

export function TreasuryOverview({
  agentsWithAccess,
  circleConnected,
  failedJobs,
  orgId,
  orgSlug,
  paymentMode,
  pendingReservations,
  railReadiness,
}: TreasuryOverviewProps) {
  const base = `/app/${orgSlug}/payments`;
  const verifiedRails = circleConnected ? railReadiness.filter((rail) => rail.status === 'ready').length : 0;
  const unverifiedSupported = circleConnected
    ? railReadiness.filter((rail) => rail.supported && rail.status !== 'ready')
    : [];

  const needsAttention: NeedsAttentionItem[] = [];
  if (!circleConnected) {
    needsAttention.push({
      description: 'Connect the organization-owned Circle Agent Wallet before agents can access treasury liquidity or execute payments.',
      href: `/onboarding/${orgSlug}`,
      title: 'Circle connection required',
    });
  }
  if (unverifiedSupported.length > 0) {
    needsAttention.push({
      description: `${unverifiedSupported.length} supported rail${unverifiedSupported.length === 1 ? '' : 's'} still ${unverifiedSupported.length === 1 ? 'needs' : 'need'} a settlement proof before agents can use ${unverifiedSupported.length === 1 ? 'it' : 'them'}.`,
      href: `${base}/sources`,
      title: 'Unverified payment rail',
    });
  }
  if (failedJobs.length > 0) {
    needsAttention.push({
      description: `${failedJobs.length} provider job${failedJobs.length === 1 ? '' : 's'} recently failed. Review and retry from Liquidity.`,
      href: `${base}/liquidity`,
      title: 'Failed provider job',
    });
  }
  if (agentsWithAccess === 0) {
    needsAttention.push({
      description: 'No agent currently has payment access enabled. Grant access from Agent Access.',
      href: `${base}/agent-access`,
      title: 'No agent has payment access',
    });
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        description="Fund once, enable agent access, and let agentOps prepare gasless USDC liquidity across exact and Gateway x402 rails."
        title="Treasury"
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {circleConnected ? (
          <Suspense fallback={<TreasuryBalanceTilesSkeleton />}>
            <TreasuryBalanceTiles orgId={orgId} />
          </Suspense>
        ) : (
          <>
            <StatTile label="Available USDC" value="Unavailable" />
            <StatTile label="Gateway liquidity" value="Unavailable" />
          </>
        )}
        <StatTile label="Executable rails" value={`${verifiedRails}/${railReadiness.length}`} />
        <StatTile label="Agents with access" value={agentsWithAccess} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Needs attention</CardTitle>
          <StatusBadge label={paymentMode.mode === 'live' ? 'Live mode' : 'Test mode'} status={paymentMode.mode === 'live' ? 'active' : 'pending'} />
        </CardHeader>
        <CardContent>
          {needsAttention.length === 0 ? (
            <EmptyState
              description="Everything supported is verified, provider jobs are healthy, and at least one agent has payment access."
              title="Nothing needs your attention"
              variant="treasury"
            />
          ) : (
            <ul className="grid gap-2">
              {needsAttention.map((item) => (
                <NeedsAttentionRow key={item.title} {...item} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <StatTile label="In-flight reservations" value={pendingReservations} />
        <OverviewLinkCard description="Treasury, wallets, sources, and rail proofs." href={`${base}/sources`} title="Sources & rails" />
        <OverviewLinkCard description="Payment ledger, routing, and provider job evidence." href={`${base}/activity`} title="Activity & evidence" />
      </div>
    </div>
  );
}

function NeedsAttentionRow({ description, href, title }: NeedsAttentionItem) {
  return (
    <li>
      <Link
        className="flex items-start gap-3 rounded-xl bg-(--state-warning-tint) px-4 py-3 ring-1 ring-(--state-warning)/30 transition-colors hover:ring-(--state-warning)/60"
        href={href}
      >
        <IconAlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-(--state-warning)" size={16} stroke={2} />
        <div className="grid gap-0.5">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className="text-sm text-muted-foreground">{description}</span>
        </div>
      </Link>
    </li>
  );
}

function OverviewLinkCard({ description, href, title }: { readonly description: string; readonly href: string; readonly title: string }): ReactNode {
  return (
    <Link className="group/card" href={href}>
      <Card className="h-full transition-colors group-hover/card:ring-primary/40">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
