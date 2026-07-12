import type {
  CircleChainBalanceRecord,
  CircleChainCapabilityRecord,
  CircleProviderJobRecord,
  PaymentChain,
  PaymentRail,
  PaymentRailReadinessRecord,
  PaymentSourceRecord,
} from './payments-types';

export const FIELD_CLASS =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20';

export const CHAIN_LABELS: Record<PaymentChain, string> = {
  arbitrum: 'Arbitrum',
  avalanche: 'Avalanche',
  base: 'Base',
  optimism: 'Optimism',
  polygon: 'Polygon',
};

export const PRIMARY_RAILS: readonly PaymentRail[] = [
  'gateway_base',
  'exact_base',
  'gateway_arbitrum',
  'exact_arbitrum',
  'gateway_polygon',
  'exact_polygon',
  'gateway_optimism',
  'exact_optimism',
  'gateway_avalanche',
  'exact_avalanche',
];

export function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatRail(value: string): string {
  if (value === 'gateway_base') return 'Gateway · Base';
  if (value === 'exact_base') return 'Exact · Base';
  if (value.startsWith('gateway_')) return `Gateway · ${CHAIN_LABELS[value.replace('gateway_', '') as PaymentChain] ?? titleCase(value)}`;
  if (value.startsWith('exact_')) return `Exact · ${CHAIN_LABELS[value.replace('exact_', '') as PaymentChain] ?? titleCase(value)}`;
  return titleCase(value);
}

export function formatOptionalRail(value: string | null): string {
  return value === null ? 'None' : formatRail(value);
}

export function formatRailProofState(rail: PaymentRailReadinessRecord): string {
  if (typeof rail.last_proof_status === 'string' && rail.last_proof_status.length > 0) {
    return titleCase(rail.last_proof_status);
  }
  if (rail.last_payment_at !== null) return 'Payment submitted';
  if (rail.last_observed_at !== null) return 'Observed';
  return 'No run yet';
}

export function chainFromRail(rail: PaymentRail): PaymentChain {
  return rail.replace(/^gateway_/, '').replace(/^exact_/, '') as PaymentChain;
}

export function capabilityForRail(
  capabilities: readonly CircleChainCapabilityRecord[],
  rail: PaymentRail,
): CircleChainCapabilityRecord | null {
  return capabilities.find((capability) => capability.chain === chainFromRail(rail)) ?? null;
}

export function railIsSettlementVerified(
  capabilities: readonly CircleChainCapabilityRecord[],
  rail: PaymentRail,
): boolean {
  const capability = capabilityForRail(capabilities, rail);
  if (capability === null) return false;
  if (rail.startsWith('gateway_')) {
    return capability.gateway_supported && capability.nanopayments_supported && capability.gateway_settlement_verified;
  }
  return capability.wallet_supported && capability.exact_settlement_verified;
}

export function formatMoney(value: string | null): string {
  if (value === null) return '0.00 USDC';
  return `${value} USDC`;
}

export function isReconcilableProviderJob(job: CircleProviderJobRecord): boolean {
  return job.status === 'submitted'
    || (job.status === 'failed'
      && (job.error_code === 'circle_cli_command_failed' || job.error_code === 'circle_provider_job_timeout'));
}

export function chainBalance(
  balances: readonly CircleChainBalanceRecord[],
  chain: PaymentChain,
): CircleChainBalanceRecord | null {
  return balances.find((balance) => balance.chain === chain) ?? null;
}

export function walletUsdc(balance: CircleChainBalanceRecord | null): string {
  const usdc = balance?.tokens.find((token) => token.symbol === 'USDC' && !token.is_native);
  return usdc?.amount ?? '0';
}

export function sourceDisplayBalance(source: PaymentSourceRecord, balances: readonly CircleChainBalanceRecord[]): string {
  if (source.provider === 'simulation') return source.simulated_balance_usdc;
  const balance = chainBalance(balances, source.chain);
  if (source.source_type === 'gateway') return balance?.gateway?.available ?? '0';
  if (source.source_type === 'direct_exact') return walletUsdc(balance);
  return '0';
}

export function jobSummary(job: CircleProviderJobRecord | null): string {
  if (job === null) return 'No liquidity jobs yet';
  if (job.chain === null) return titleCase(job.job_type.replace('.', '_'));
  return `${CHAIN_LABELS[job.chain]} · ${titleCase(job.status)}`;
}

export function effectiveSources(sources: readonly PaymentSourceRecord[]): PaymentSourceRecord[] {
  const deduped = new Map<string, PaymentSourceRecord>();
  const sorted = [...sources].sort((left, right) => {
    const statusRank = (left.status === 'active' ? 0 : 1) - (right.status === 'active' ? 0 : 1);
    if (statusRank !== 0) return statusRank;
    return Date.parse(right.created_at) - Date.parse(left.created_at);
  });
  for (const source of sorted) {
    const key = `${source.source_type}:${source.provider}:${source.rail}:${source.chain}`;
    if (!deduped.has(key)) deduped.set(key, source);
  }
  return [...deduped.values()].sort((left, right) => left.rail.localeCompare(right.rail));
}

export function accountState(account: { payment_access: boolean; status: string } | null): string {
  if (account === null || !account.payment_access || account.status !== 'active') return 'Off';
  return 'On';
}
