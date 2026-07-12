import { Suspense } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { ChainDetailSection } from './ChainDetailSection';
import { TreasurySettingsMenu } from './TreasurySettingsMenu';
import { TreasuryActionTabs } from './TreasuryActionTabs';
import { TreasuryPageHeader, TreasurySectionNav } from './TreasuryChrome';
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
  readonly providerHealth: CircleProviderHealth | null;
  readonly providerHealthAvailable: boolean;
  readonly railReadiness: readonly PaymentRailReadinessRecord[];
  readonly sources: readonly PaymentSourceRecord[];
};

export function TreasurySourcesRails({ capabilities, circleTreasuryAction, circleWallets, gatewayDepositAction, orgId, orgSlug, paymentMode, providerHealth, providerHealthAvailable, railReadiness, sources, testnetFundsAction, verifyRailAction, verifyUnverifiedRailsAction }: TreasurySourcesRailsProps) {
  const activeWalletCount = circleWallets.filter((wallet) => wallet.status === 'active').length;
  const unverifiedSupportedRailCount = railReadiness.filter((rail) => rail.supported && !rail.settlement_verified).length;
  const providerConfigured = providerHealthAvailable && providerHealth?.configured === true;
  const createTreasuryDisabled = !providerConfigured;

  return (
    <div className="treasury-workbench">
      <TreasurySectionNav active="sources" orgSlug={orgSlug} />
      <TreasuryPageHeader
        actions={(
          <>
            <form action={circleTreasuryAction}>
              <input name="label" type="hidden" value={paymentMode.mode === 'live' ? 'Live Circle Agent Wallet' : 'Testnet Circle Agent Wallet'} />
              <button className="treasury-button" disabled={createTreasuryDisabled} type="submit">Sync wallets</button>
            </form>
            <form action={verifyUnverifiedRailsAction}><button className="treasury-button" disabled={!providerConfigured || unverifiedSupportedRailCount === 0} type="submit">Run proofs</button></form>
            <TreasuryActionTabs activeWalletCount={activeWalletCount} capabilities={capabilities} gatewayDepositAction={gatewayDepositAction} providerReady={providerConfigured} />
            <TreasurySettingsMenu activeWalletCount={activeWalletCount} capabilities={capabilities} paymentMode={paymentMode} providerReady={providerConfigured} testnetFundsAction={testnetFundsAction} />
          </>
        )}
        description="Inspect one chain as a complete funding and settlement surface. Wallets, balances, proofs, and sources remain evidence-backed."
        eyebrow="Treasury / sources & rails"
        title="One treasury. Five settlement networks."
      />

      {!providerHealthAvailable ? (
        <div className="treasury-provider-alert is-danger"><div><strong>Circle provider status is unavailable.</strong><span>Wallet sync, deposits, and rail proofs remain disabled until the provider service recovers.</span></div></div>
      ) : providerHealth?.configured !== true ? (
        <div className="treasury-provider-alert"><div><strong>Circle Agent Wallet is not connected.</strong><span>Payments remain disabled until the organization completes treasury onboarding.</span></div><Link href={`/onboarding/${orgSlug}`}>Connect treasury</Link></div>
      ) : null}

      <Suspense fallback={<Skeleton className="h-96 w-full rounded-md" />}>
        <ChainDetailSection capabilities={capabilities} circleWallets={circleWallets} orgId={orgId} paymentMode={paymentMode} providerReady={providerConfigured} railReadiness={railReadiness} runProofAction={verifyRailAction} sources={sources} />
      </Suspense>
    </div>
  );
}
