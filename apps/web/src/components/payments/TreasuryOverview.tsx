import Link from 'next/link';
import { IconAlertTriangle, IconArrowRight } from '@tabler/icons-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { ChainMark } from './ChainMark';
import { TreasuryPageHeader } from './TreasuryChrome';
import { CHAIN_LABELS, PRIMARY_RAILS, walletUsdc } from '@/lib/payments-format';
import type { AgentRosterItem } from '@/lib/identity-spine-types';
import type {
  AgentPaymentAccountRecord,
  CircleChainBalanceRecord,
  CircleProviderJobRecord,
  OrgPaymentModeRecord,
  PaymentChain,
  PaymentRailReadinessRecord,
  TreasuryOverviewRecord,
} from '@/lib/payments-types';

type NeedsAttentionItem = {
  readonly description: string;
  readonly href: string;
  readonly title: string;
  readonly tone: 'warning' | 'danger';
};

type TreasuryOverviewProps = {
  readonly accounts: readonly AgentPaymentAccountRecord[];
  readonly agents: readonly AgentRosterItem[];
  readonly balances: readonly CircleChainBalanceRecord[];
  readonly circleConnectionState: 'connected' | 'disconnected' | 'unavailable';
  readonly failedJobs: readonly CircleProviderJobRecord[];
  readonly orgSlug: string;
  readonly overview: TreasuryOverviewRecord;
  readonly paymentMode: OrgPaymentModeRecord;
  readonly pendingReservations: number;
  readonly railReadiness: readonly PaymentRailReadinessRecord[];
};

function amount(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: string | number): string {
  const parsed = typeof value === 'number' ? value : amount(value);
  return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parsed)} USDC`;
}

export function TreasuryOverview({
  accounts,
  agents,
  balances,
  circleConnectionState,
  failedJobs,
  orgSlug,
  overview,
  paymentMode,
  pendingReservations,
  railReadiness,
}: TreasuryOverviewProps) {
  const base = `/app/${orgSlug}/payments`;
  const circleConnected = circleConnectionState === 'connected';
  const verifiedRails = circleConnected ? railReadiness.filter((rail) => rail.status === 'ready').length : 0;
  const supportedRails = railReadiness.filter((rail) => rail.supported);
  const activeAccounts = accounts.filter((account) => account.payment_access && account.status === 'active');
  const disabledAccounts = accounts.filter((account) => account.status === 'disabled').length;
  const unverifiedSupported = circleConnected ? supportedRails.filter((rail) => rail.status !== 'ready') : [];
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  const nearBudget = activeAccounts.find((account) => amount(account.budget_usdc) > 0 && amount(account.spent_usdc) / amount(account.budget_usdc) >= 0.8);

  const needsAttention: NeedsAttentionItem[] = [];
  if (circleConnectionState === 'unavailable') {
    needsAttention.push({
      description: 'The current Circle connection state could not be verified. Payment mutations remain disabled until the provider service recovers.',
      href: `${base}/sources`,
      title: 'Circle provider unavailable',
      tone: 'danger',
    });
  } else if (!circleConnected) {
    needsAttention.push({
      description: 'Connect the organization-owned Circle Agent Wallet before agents can execute payments.',
      href: `/onboarding/${orgSlug}`,
      title: 'Circle connection required',
      tone: 'danger',
    });
  }
  if (unverifiedSupported.length > 0) {
    needsAttention.push({
      description: `${unverifiedSupported.length} supported rail${unverifiedSupported.length === 1 ? '' : 's'} still need settlement evidence.`,
      href: `${base}/sources`,
      title: 'Rail proof required',
      tone: 'warning',
    });
  }
  if (failedJobs.length > 0) {
    needsAttention.push({
      description: `${failedJobs.length} provider job${failedJobs.length === 1 ? '' : 's'} failed and can be reviewed from Liquidity.`,
      href: `${base}/liquidity`,
      title: 'Provider job failed',
      tone: 'danger',
    });
  }
  if (activeAccounts.length === 0) {
    needsAttention.push({
      description: 'No agent currently has payment access enabled.',
      href: `/app/${orgSlug}/agents`,
      title: 'Payment access is off',
      tone: 'warning',
    });
  }
  if (nearBudget !== undefined) {
    needsAttention.push({
      description: `${agentNames.get(nearBudget.agent_id) ?? nearBudget.agent_id} has used ${money(nearBudget.spent_usdc)} of a ${money(nearBudget.budget_usdc)} budget.`,
      href: `/app/${orgSlug}/agents/${nearBudget.agent_id}`,
      title: 'Agent is near budget',
      tone: 'warning',
    });
  }

  return (
    <div className="treasury-workbench">
      <TreasuryPageHeader
        description="A calm operational view of funded liquidity, executable rails, delegated access, and exceptions."
        eyebrow="Treasury / command view"
        title="Treasury your agents can use"
      />

      <section aria-label="Treasury status" className="treasury-status-band">
        <div className="treasury-metric treasury-metric-lead">
          <span>Treasury position</span>
          <strong>{circleConnected ? money(overview.totals.treasury_usdc) : 'Unavailable'}</strong>
          <p>{circleConnected ? `${balances.length} networks reporting · ${paymentMode.mode === 'live' ? 'Live' : 'Testnet'} mode` : circleConnectionState === 'unavailable' ? 'Provider status is temporarily unavailable' : 'Circle Agent Wallet is not connected'}</p>
        </div>
        <div className="treasury-metric"><span>Rails ready</span><strong>{circleConnectionState === 'unavailable' ? 'Unavailable' : `${verifiedRails} / ${supportedRails.length}`}</strong><small>{circleConnectionState === 'unavailable' ? 'Provider status could not be verified' : !circleConnected ? 'Circle connection required' : unverifiedSupported.length === 0 ? 'All supported rails executable' : `${unverifiedSupported.length} need evidence`}</small></div>
        <div className="treasury-metric"><span>Agent access</span><strong>{activeAccounts.length}</strong><small>{disabledAccounts} disabled · {accounts.length} configured</small></div>
        <div className="treasury-metric"><span>Settled spend</span><strong>{money(overview.payments.total_spent_usdc)}</strong><small>{overview.payments.last_payment === null ? 'No settled payment yet' : `Last: ${money(overview.payments.last_payment.amount)}`}</small></div>
      </section>

      <div className="treasury-overview-grid">
        <section className="treasury-overview-section">
          <div className="treasury-section-heading"><div><h2>Needs your attention</h2><p>Only actionable treasury exceptions.</p></div><span>{needsAttention.length} open</span></div>
          {needsAttention.length === 0 ? (
            <div className="treasury-calm-state"><strong>No treasury action is required.</strong><p>Supported rails are verified, provider jobs are healthy, and payment access is configured.</p></div>
          ) : (
            <div className="treasury-attention-list">{needsAttention.map((item) => <AttentionRow item={item} key={item.title} />)}</div>
          )}
          {pendingReservations > 0 ? <p className="treasury-reservation-note">{pendingReservations} payment reservation{pendingReservations === 1 ? '' : 's'} currently in flight.</p> : null}
        </section>

        <section className="treasury-overview-section">
          <div className="treasury-section-heading"><div><h2>Network readiness</h2><p>Exact and Gateway availability by chain.</p></div></div>
          <div className="treasury-network-list">
            {PRIMARY_RAILS.filter((rail) => rail.startsWith('gateway_')).map((rail) => {
              const chain = rail.replace('gateway_', '') as PaymentChain;
              const chainRails = railReadiness.filter((item) => item.chain === chain && item.supported);
              const ready = circleConnected ? chainRails.filter((item) => item.status === 'ready').length : 0;
              const balance = balances.find((item) => item.chain === chain) ?? null;
              const available = amount(walletUsdc(balance)) + amount(balance?.gateway?.available);
              return (
                <Link className="treasury-network-row" href={`${base}/sources`} key={chain}>
                  <ChainMark chain={chain} size="small" />
                  <div><strong>{CHAIN_LABELS[chain]}</strong><small>{money(available)} available</small></div>
                  <StatusBadge label={circleConnectionState === 'unavailable' ? 'Unavailable' : `${ready}/${chainRails.length} ready`} status={ready === chainRails.length && chainRails.length > 0 ? 'active' : 'warning'} />
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function AttentionRow({ item }: { readonly item: NeedsAttentionItem }) {
  return (
    <Link className={`treasury-attention-row is-${item.tone}`} href={item.href}>
      <IconAlertTriangle aria-hidden="true" size={16} stroke={1.8} />
      <div><strong>{item.title}</strong><span>{item.description}</span></div>
      <IconArrowRight aria-hidden="true" size={15} stroke={1.8} />
    </Link>
  );
}
