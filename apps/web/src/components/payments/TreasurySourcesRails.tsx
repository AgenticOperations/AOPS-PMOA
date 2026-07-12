import { Suspense } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChainDetailSection } from './ChainDetailSection';
import { TreasurySettingsMenu } from './TreasurySettingsMenu';
import { TreasuryActionTabs } from './TreasuryActionTabs';
import type {
  CircleChainCapabilityRecord,
  CircleChainWalletRecord,
  CircleProviderHealth,
  OrgPaymentModeRecord,
  PaymentRailReadinessRecord,
  PaymentSourceRecord,
} from '@/lib/payments-types';

type SourcesRailsActions = {
  readonly circleTreasuryAction: (formData: FormData) => Promise<void>;
  readonly gatewayDepositAction: (formData: FormData) => Promise<void>;
  readonly testnetFundsAction: (formData: FormData) => Promise<void>;
  readonly verifyRailAction: (formData: FormData) => Promise<void>;
  readonly verifyUnverifiedRailsAction: () => Promise<void>;
};

type TreasurySourcesRailsProps = SourcesRailsActions & {
  readonly capabilities: readonly CircleChainCapabilityRecord[];
  readonly circleWallets: readonly CircleChainWalletRecord[];
  readonly orgId: string;
  readonly orgSlug: string;
  readonly paymentMode: OrgPaymentModeRecord;
  readonly providerHealth: CircleProviderHealth;
  readonly railReadiness: readonly PaymentRailReadinessRecord[];
  readonly sources: readonly PaymentSourceRecord[];
};

export function TreasurySourcesRails({
  capabilities,
  circleTreasuryAction,
  circleWallets,
  gatewayDepositAction,
  orgId,
  orgSlug,
  paymentMode,
  providerHealth,
  railReadiness,
  sources,
  testnetFundsAction,
  verifyRailAction,
  verifyUnverifiedRailsAction,
}: TreasurySourcesRailsProps) {
  const activeWalletCount = circleWallets.filter((wallet) => wallet.status === 'active').length;
  const unverifiedSupportedRailCount = railReadiness.filter((rail) => rail.supported && !rail.settlement_verified).length;
  const readyRailCount = railReadiness.filter((rail) => rail.status === 'ready').length;
  const createTreasuryDisabled = !providerHealth.configured;

  return (
    <div className="grid gap-6">
      <PageHeader
        actions={
          <TreasurySettingsMenu
            activeWalletCount={activeWalletCount}
            capabilities={capabilities}
            circleTreasuryAction={circleTreasuryAction}
            createTreasuryDisabled={createTreasuryDisabled}
            paymentMode={paymentMode}
            testnetFundsAction={testnetFundsAction}
          />
        }
        description="Per-chain wallets, rail settlement proofs, and funding in one place."
        title="Sources & rails"
      />

      {!providerHealth.configured ? (
        <div className="flex items-center justify-between gap-4 rounded-xl bg-(--state-danger-tint) px-4 py-3 text-sm text-(--state-danger)">
          <span><strong className="font-semibold">Circle Agent Wallet is not connected.</strong> Payments remain disabled.</span>
          <Link className="button-secondary" href={`/onboarding/${orgSlug}`}>Connect treasury</Link>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-4 content-start">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusBadge label={`${readyRailCount}/${railReadiness.length} rails ready`} status={readyRailCount === railReadiness.length ? 'active' : 'info'} />
            <form action={verifyUnverifiedRailsAction}>
              <button className="button-secondary" disabled={!providerHealth.configured || unverifiedSupportedRailCount === 0} type="submit">
                Run all unverified proofs
              </button>
            </form>
          </div>

          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            <ChainDetailSection
              capabilities={capabilities}
              circleWallets={circleWallets}
              orgId={orgId}
              paymentMode={paymentMode}
              railReadiness={railReadiness}
              runProofAction={verifyRailAction}
              sources={sources}
            />
          </Suspense>
        </div>

          <TreasuryActionTabs
            activeWalletCount={activeWalletCount}
            capabilities={capabilities}
            gatewayDepositAction={gatewayDepositAction}
          />
      </div>
    </div>
  );
}
