import { cache } from 'react';
import { ChainSwitcher, type ChainRow } from './ChainSwitcher';
import { CHAIN_LABELS, chainFromRail, effectiveSources } from '@/lib/payments-format';
import type {
  CircleChainCapabilityRecord,
  CircleChainWalletRecord,
  OrgPaymentModeRecord,
  PaymentChain,
  PaymentRailReadinessRecord,
  PaymentSourceRecord,
} from '@/lib/payments-types';
import { listCircleBalances } from '@/lib/server/payments-client';

const loadBalancesOnce = cache(async (orgId: string) => listCircleBalances(orgId));

type ChainDetailSectionProps = {
  readonly capabilities: readonly CircleChainCapabilityRecord[];
  readonly circleWallets: readonly CircleChainWalletRecord[];
  readonly orgId: string;
  readonly paymentMode: OrgPaymentModeRecord;
  readonly providerReady: boolean;
  readonly railReadiness: readonly PaymentRailReadinessRecord[];
  readonly runProofAction: (formData: FormData) => Promise<void>;
  readonly sources: readonly PaymentSourceRecord[];
};

export async function ChainDetailSection({
  capabilities,
  circleWallets,
  orgId,
  paymentMode,
  providerReady,
  railReadiness,
  runProofAction,
  sources,
}: ChainDetailSectionProps) {
  const balances = await loadBalancesOnce(orgId);
  const visibleSources = effectiveSources(sources);

  const rows: ChainRow[] = capabilities.map((capability) => {
    const chain: PaymentChain = capability.chain;
    const wallet = circleWallets.find((item) => item.chain === chain && item.mode === paymentMode.mode) ?? null;
    const balance = balances.find((item) => item.chain === chain) ?? null;
    const walletUsdc = balance?.tokens.find((token) => token.symbol === 'USDC' && !token.is_native)?.amount ?? '0';
    const gatewayAvailable = balance?.gateway?.available ?? '0';
    const gatewayRail = railReadiness.find((rail) => rail.rail === `gateway_${chain}`) ?? null;
    const exactRail = railReadiness.find((rail) => rail.rail === `exact_${chain}`) ?? null;
    const gatewaySource = visibleSources.find((source) => source.rail === `gateway_${chain}` && chainFromRail(source.rail) === chain) ?? null;
    const exactSource = visibleSources.find((source) => source.rail === `exact_${chain}` && chainFromRail(source.rail) === chain) ?? null;

    return {
      capability,
      chain,
      connected: wallet !== null,
      exactRail,
      exactSource,
      gatewayTotal: balance?.gateway?.total ?? '0',
      gatewayWithdrawable: balance?.gateway?.withdrawable ?? '0',
      gatewayAvailable,
      gatewayRail,
      gatewaySource,
      label: CHAIN_LABELS[chain],
      walletAddress: wallet?.address ?? null,
      walletId: wallet?.circle_wallet_id ?? null,
      walletUsdc,
    };
  });

  return <ChainSwitcher providerReady={providerReady} rows={rows} runProofAction={runProofAction} />;
}
