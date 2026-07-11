import type { AgentRosterItem } from '@/lib/identity-spine-types';
import type {
  AgentPaymentAccountRecord,
  CircleChainBalanceRecord,
  CircleChainCapabilityRecord,
  CircleChainWalletRecord,
  CircleProviderJobRecord,
  CircleProviderHealth,
  OrgPaymentModeRecord,
  PaymentChain,
  PaymentEventRecord,
  PaymentRail,
  PaymentRailReadinessRecord,
  PaymentReservationRecord,
  PaymentRouteObservationRecord,
  PaymentSourceRecord,
  RebalanceRecommendationRecord,
  TreasuryOverviewRecord,
  TreasuryRecord,
} from '@/lib/payments-types';

type AgentPaymentRow = {
  readonly account: AgentPaymentAccountRecord | null;
  readonly agent: Pick<AgentRosterItem, 'id' | 'name' | 'status'>;
};

type PaymentsWorkbenchProps = {
  readonly accessAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly agents: readonly AgentRosterItem[];
  readonly agentPayments: readonly AgentPaymentRow[];
  readonly bridgeTopUpAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly cancelLiquidityJobAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly capabilities: readonly CircleChainCapabilityRecord[];
  readonly circleTreasuryAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly circleBalances: readonly CircleChainBalanceRecord[];
  readonly circleJobs: readonly CircleProviderJobRecord[];
  readonly circleWallets: readonly CircleChainWalletRecord[];
  readonly gatewayDepositAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly liquidityJobs: readonly CircleProviderJobRecord[];
  readonly modeAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly paymentMode: OrgPaymentModeRecord;
  readonly paymentEvents: readonly PaymentEventRecord[];
  readonly paymentReservations: readonly PaymentReservationRecord[];
  readonly providerHealth: CircleProviderHealth;
  readonly railReadiness: readonly PaymentRailReadinessRecord[];
  readonly rebalanceRecommendations: readonly RebalanceRecommendationRecord[];
  readonly reconcileJobsAction?: (() => Promise<void>) | undefined;
  readonly routeObservations: readonly PaymentRouteObservationRecord[];
  readonly retryLiquidityJobAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly verifyRailAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly verifyUnverifiedRailsAction?: (() => Promise<void>) | undefined;
  readonly sourceAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly sources: readonly PaymentSourceRecord[];
  readonly testnetFundsAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly treasuries: readonly TreasuryRecord[];
  readonly treasuryOverview: TreasuryOverviewRecord;
  readonly treasuryAction?: ((formData: FormData) => Promise<void>) | undefined;
};

const CHAIN_LABELS: Record<PaymentChain, string> = {
  arbitrum: 'Arbitrum',
  avalanche: 'Avalanche',
  base: 'Base',
  optimism: 'Optimism',
  polygon: 'Polygon',
};

const PRIMARY_RAILS: readonly PaymentRail[] = [
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

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatRail(value: string): string {
  if (value === 'gateway_base') return 'Gateway · Base';
  if (value === 'exact_base') return 'Exact · Base';
  if (value.startsWith('gateway_')) return `Gateway · ${CHAIN_LABELS[value.replace('gateway_', '') as PaymentChain] ?? titleCase(value)}`;
  if (value.startsWith('exact_')) return `Exact · ${CHAIN_LABELS[value.replace('exact_', '') as PaymentChain] ?? titleCase(value)}`;
  return titleCase(value);
}

function formatRailProofState(rail: PaymentRailReadinessRecord): string {
  if (typeof rail.last_proof_status === 'string' && rail.last_proof_status.length > 0) {
    return titleCase(rail.last_proof_status);
  }
  if (rail.last_payment_at !== null) return 'Payment submitted';
  if (rail.last_observed_at !== null) return 'Observed';
  return 'No run yet';
}

function formatOptionalRail(value: string | null): string {
  return value === null ? 'None' : formatRail(value);
}

function chainFromRail(rail: PaymentRail): PaymentChain {
  return rail.replace(/^gateway_/, '').replace(/^exact_/, '') as PaymentChain;
}

function capabilityForRail(
  capabilities: readonly CircleChainCapabilityRecord[],
  rail: PaymentRail,
): CircleChainCapabilityRecord | null {
  return capabilities.find((capability) => capability.chain === chainFromRail(rail)) ?? null;
}

function railIsSettlementVerified(
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

function formatMoney(value: string | null): string {
  if (value === null) return '0.00 USDC';
  return `${value} USDC`;
}

function isReconcilableProviderJob(job: CircleProviderJobRecord): boolean {
  return job.status === 'submitted'
    || (job.status === 'failed'
      && (job.error_code === 'circle_cli_command_failed' || job.error_code === 'circle_provider_job_timeout'));
}

function chainBalance(
  balances: readonly CircleChainBalanceRecord[],
  chain: PaymentChain,
): CircleChainBalanceRecord | null {
  return balances.find((balance) => balance.chain === chain) ?? null;
}

function walletUsdc(balance: CircleChainBalanceRecord | null): string {
  const usdc = balance?.tokens.find((token) => token.symbol === 'USDC' && !token.is_native);
  return usdc?.amount ?? '0';
}

function sourceDisplayBalance(source: PaymentSourceRecord, balances: readonly CircleChainBalanceRecord[]): string {
  if (source.provider === 'simulation') return source.simulated_balance_usdc;
  const balance = chainBalance(balances, source.chain);
  if (source.source_type === 'gateway') return balance?.gateway?.available ?? '0';
  if (source.source_type === 'direct_exact') return walletUsdc(balance);
  return '0';
}

function jobSummary(job: CircleProviderJobRecord | null): string {
  if (job === null) return 'No liquidity jobs yet';
  if (job.chain === null) return titleCase(job.job_type.replace('.', '_'));
  return `${CHAIN_LABELS[job.chain]} · ${titleCase(job.status)}`;
}

function effectiveSources(sources: readonly PaymentSourceRecord[]): PaymentSourceRecord[] {
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

function accountState(account: AgentPaymentAccountRecord | null): string {
  if (account === null || !account.payment_access || account.status !== 'active') return 'Off';
  return 'On';
}

export function PaymentsWorkbench({
  accessAction,
  agents,
  agentPayments,
  bridgeTopUpAction,
  cancelLiquidityJobAction,
  capabilities,
  circleTreasuryAction,
  circleBalances,
  circleJobs,
  circleWallets,
  gatewayDepositAction,
  liquidityJobs,
  modeAction,
  paymentMode,
  paymentEvents,
  paymentReservations,
  providerHealth,
  railReadiness,
  rebalanceRecommendations,
  reconcileJobsAction,
  routeObservations,
  retryLiquidityJobAction,
  verifyRailAction,
  verifyUnverifiedRailsAction,
  sources,
  testnetFundsAction,
  treasuries,
  treasuryOverview,
}: PaymentsWorkbenchProps) {
  const activeTreasury = treasuries.find((treasury) => treasury.status === 'active') ?? null;
  const visibleSources = effectiveSources(sources);
  const activeGatewaySource = visibleSources.find((source) => source.status === 'active' && source.rail === 'gateway_base') ?? null;
  const activeWalletCount = circleWallets.filter((wallet) => wallet.status === 'active').length;
  const createTreasuryDisabled = !providerHealth.configured;
  const modeLabel = paymentMode.mode === 'live' ? 'Live mode' : 'Test mode';
  const baseBalance = chainBalance(circleBalances, 'base');
  const firstRecommendation = rebalanceRecommendations[0] ?? null;
  const unverifiedSupportedRailCount = railReadiness.filter((rail) => rail.supported && !rail.settlement_verified).length;

  return (
    <div className="ops-page payments-workbench">
      <header className="ops-page-header payments-header">
        <div>
          <h1>Treasury</h1>
          <p>Fund once, enable agent access, and let agentOps prepare gasless USDC liquidity across exact and Gateway x402 rails.</p>
        </div>
      </header>

      <section className="ops-surface payments-overview" aria-labelledby="treasury-overview-title">
        <div className="ops-surface-heading">
          <div>
            <h2 id="treasury-overview-title">Workspace treasury</h2>
            <p>Operator view of usable USDC. Chain-specific wallets and Gateway buckets stay in diagnostics below.</p>
          </div>
          <span className={`ops-state-pill ${providerHealth.configured ? 'ops-state-active' : 'ops-state-pending'}`}>
            {providerHealth.configured ? modeLabel : 'Circle setup needed'}
          </span>
        </div>
        <div className="payments-overview-grid" aria-label="Treasury summary">
          <div>
            <span>Total usable USDC</span>
            <strong>{formatMoney(treasuryOverview.totals.treasury_usdc)}</strong>
          </div>
          <div>
            <span>Gateway liquidity</span>
            <strong>{formatMoney(treasuryOverview.totals.gateway_usdc)}</strong>
          </div>
          <div>
            <span>Wallet liquidity</span>
            <strong>{formatMoney(treasuryOverview.totals.wallet_usdc)}</strong>
          </div>
          <div>
            <span>Payment access</span>
            <strong>{treasuryOverview.payments.agents_with_access} agent{treasuryOverview.payments.agents_with_access === 1 ? '' : 's'}</strong>
          </div>
        </div>
        <div className="payments-overview-foot">
          <span>{treasuryOverview.liquidity.pending_jobs} liquidity job{treasuryOverview.liquidity.pending_jobs === 1 ? '' : 's'} preparing</span>
          <span>{treasuryOverview.payments.last_payment === null ? 'No payment submitted yet' : `Last payment ${formatMoney(treasuryOverview.payments.last_payment.amount)} on ${formatRail(treasuryOverview.payments.last_payment.rail)}`}</span>
          <span>{jobSummary(treasuryOverview.liquidity.last_job)}</span>
        </div>
      </section>

      <div className="payments-layout">
        <div className="payments-main-column">
          <section className="ops-surface" aria-labelledby="liquidity-jobs-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="liquidity-jobs-title">Liquidity preparation</h2>
                <p>Queued jobs created when an agent asks for a payment rail whose chain bucket is not ready.</p>
              </div>
              <span className="ops-count-pill">{liquidityJobs.length} job{liquidityJobs.length === 1 ? '' : 's'}</span>
            </div>

            {liquidityJobs.length === 0 ? (
              <div className="ops-empty-state">
                <h3>No liquidity jobs</h3>
                <p>When an agent requests a supported payment and the target bucket is empty, agentOps will queue preparation here.</p>
              </div>
            ) : (
              <div className="payments-table" role="table" aria-label="Liquidity preparation jobs">
                <div className="payments-table-head payments-jobs-head" role="row">
                  <span role="columnheader">Route</span>
                  <span role="columnheader">Amount</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Action</span>
                </div>
                {liquidityJobs.map((job) => {
                  const canRetry = job.status === 'failed';
                  const canCancel = job.status === 'queued' || job.status === 'submitted';
                  return (
                    <article className="payments-table-row payments-jobs-row" key={job.id} role="row">
                      <div role="cell">
                        <strong>{typeof job.metadata.rail === 'string' ? formatRail(job.metadata.rail) : titleCase(job.job_type.replace('.', '_'))}</strong>
                        <span>{typeof job.metadata.source_bucket === 'string' && typeof job.metadata.destination_bucket === 'string'
                          ? `${job.metadata.source_bucket} -> ${job.metadata.destination_bucket}`
                          : new Date(job.created_at).toLocaleString()}</span>
                      </div>
                      <span role="cell">{formatMoney(job.amount_usdc)}</span>
                      <span className={`ops-state-pill ops-state-${job.status}`} role="cell">
                        {job.status}
                      </span>
                      <div className="payments-job-actions" role="cell">
                        {canRetry ? (
                          <form action={retryLiquidityJobAction}>
                            <input name="jobId" type="hidden" value={job.id} />
                            <button className="button-secondary" type="submit">
                              Retry
                            </button>
                          </form>
                        ) : null}
                        {canCancel ? (
                          <form action={cancelLiquidityJobAction}>
                            <input name="jobId" type="hidden" value={job.id} />
                            <button className="button-secondary" type="submit">
                              Cancel
                            </button>
                          </form>
                        ) : null}
                        {!canRetry && !canCancel ? <span className="payments-job-action-note">No action</span> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="ops-surface" aria-labelledby="circle-treasury-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="circle-treasury-title">Advanced diagnostics</h2>
                <p>Per-chain Circle Agent Wallet and Gateway buckets used by the treasury router.</p>
              </div>
              <span className={`ops-state-pill ${providerHealth.configured ? 'ops-state-active' : 'ops-state-pending'}`}>
                {providerHealth.configured ? 'Ready' : 'Setup needed'}
              </span>
            </div>

            <div className="payments-status-strip" aria-label="Circle provider state">
              <div>
                <span>Network mode</span>
                <strong>{modeLabel}</strong>
              </div>
              <div>
                <span>Smart wallets</span>
                <strong>{activeWalletCount}/{capabilities.length}</strong>
              </div>
              <div>
                <span>Base Gateway balance</span>
                <strong>{formatMoney(baseBalance?.gateway?.available ?? '0')}</strong>
              </div>
            </div>

            {!providerHealth.configured ? (
              <div className="payments-config-warning">
                <strong>Circle Agent Wallet session is not available.</strong>
                <span>{providerHealth.missing.join(', ')}</span>
              </div>
            ) : null}

            <div className="payments-chain-grid" aria-label="Supported Circle chains">
              {capabilities.map((capability) => {
                const wallet = circleWallets.find((item) => item.chain === capability.chain && item.mode === paymentMode.mode);
                return (
                  <article className="payments-chain-card" key={capability.id}>
                    <div>
                      <strong>{CHAIN_LABELS[capability.chain]}</strong>
                      <span>{capability.network_label ?? capability.circle_blockchain}</span>
                    </div>
                    <span className={`ops-state-pill ${wallet === undefined ? 'ops-state-pending' : 'ops-state-active'}`}>
                      {wallet === undefined ? 'Not connected' : 'Connected'}
                    </span>
                    {wallet === undefined ? (
                      <code>{capability.circle_blockchain}</code>
                    ) : (
                      <code title={wallet.address}>{wallet.address.slice(0, 8)}...{wallet.address.slice(-6)}</code>
                    )}
                    <dl className="payments-chain-balances">
                      <div>
                        <dt>Wallet</dt>
                        <dd>{formatMoney(walletUsdc(chainBalance(circleBalances, capability.chain)))}</dd>
                      </div>
                      <div>
                        <dt>Gateway</dt>
                        <dd>{formatMoney(chainBalance(circleBalances, capability.chain)?.gateway?.available ?? '0')}</dd>
                      </div>
                      <div>
                        <dt>Exact</dt>
                        <dd>{capability.exact_settlement_verified ? 'Verified' : 'Unverified'}</dd>
                      </div>
                      <div>
                        <dt>Gateway x402</dt>
                        <dd>{capability.gateway_settlement_verified ? 'Verified' : 'Unverified'}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="ops-surface" aria-labelledby="payment-sources-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="payment-sources-title">Payment rails</h2>
                <p>Rails agents can use after explicit access is enabled.</p>
              </div>
              <span className="ops-count-pill">{visibleSources.length} source{visibleSources.length === 1 ? '' : 's'}</span>
            </div>

            <div className="payments-status-strip" aria-label="Payment setup state">
              <div>
                <span>Treasury</span>
                <strong>{activeTreasury === null ? 'Not configured' : activeTreasury.label}</strong>
              </div>
              <div>
                <span>Active rail</span>
                <strong>{activeGatewaySource === null ? 'None' : formatRail(activeGatewaySource.rail)}</strong>
              </div>
              <div>
                <span>Base Gateway available</span>
                <strong>{formatMoney(baseBalance?.gateway?.available ?? '0')}</strong>
              </div>
            </div>

            {visibleSources.length === 0 ? (
              <div className="ops-empty-state">
                <h3>No payment source</h3>
                <p>Connect the Circle Agent Wallet before enabling payment access.</p>
              </div>
            ) : (
              <div className="payments-table" role="table" aria-label="Payment sources">
                <div className="payments-table-head" role="row">
                  <span role="columnheader">Source</span>
                  <span role="columnheader">Rail</span>
                  <span role="columnheader">Available</span>
                  <span role="columnheader">Status</span>
                </div>
                {visibleSources.map((source) => (
                  <article className="payments-table-row" key={source.id} role="row">
                    <div role="cell">
                      <strong>{source.label}</strong>
                      <span>{titleCase(source.provider)} · {titleCase(source.source_type)}</span>
                    </div>
                    <span role="cell">{formatRail(source.rail)}</span>
                    <span role="cell">{formatMoney(sourceDisplayBalance(source, circleBalances))}</span>
                    <span className={`ops-state-pill ops-state-${source.status}`} role="cell">
                      {source.status}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="ops-surface" aria-labelledby="rail-readiness-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="rail-readiness-title">Rail readiness</h2>
                <p>Settlement support is explicit. Unverified rails stay unavailable for agent access until a successful testnet proof exists.</p>
              </div>
              <div className="payments-heading-actions">
                <span className="ops-count-pill">{railReadiness.filter((rail) => rail.status === 'ready').length} ready</span>
                <form action={verifyUnverifiedRailsAction}>
                  <button
                    className="button-secondary"
                    disabled={!providerHealth.configured || unverifiedSupportedRailCount === 0 || verifyUnverifiedRailsAction === undefined}
                    type="submit"
                  >
                    Run unverified proofs
                  </button>
                </form>
              </div>
            </div>
            <div className="payments-table" role="table" aria-label="Payment rail readiness">
              <div className="payments-table-head payments-rails-head" role="row">
                <span role="columnheader">Rail</span>
                <span role="columnheader">Type</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Last proof</span>
                <span role="columnheader">Action</span>
              </div>
              {railReadiness.map((rail) => (
                <article className="payments-table-row payments-rails-row" key={rail.rail} role="row">
                  <div role="cell">
                    <strong>{formatRail(rail.rail)}</strong>
                    <span>{rail.reason}</span>
                  </div>
                  <span role="cell">{titleCase(rail.rail_type)}</span>
                  <span className={`ops-state-pill ops-state-${rail.status === 'ready' ? 'active' : 'pending'}`} role="cell">
                    {rail.status}
                  </span>
                  <span role="cell">{formatRailProofState(rail)}</span>
                  <div className="payments-job-actions" role="cell">
                    <form action={verifyRailAction}>
                      <input name="rail" type="hidden" value={rail.rail} />
                      <button
                        className="button-secondary"
                        disabled={!providerHealth.configured || !rail.supported || verifyRailAction === undefined}
                        type="submit"
                      >
                        Run proof
                      </button>
                    </form>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="ops-surface" aria-labelledby="payment-route-observations-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="payment-route-observations-title">Route observations</h2>
                <p>Every x402 request is recorded with the selected rail or rejection reason before settlement.</p>
              </div>
              <span className="ops-count-pill">{routeObservations.length} recent</span>
            </div>
            {routeObservations.length === 0 ? (
              <div className="ops-empty-state">
                <h3>No route observations</h3>
                <p>Agent payment attempts will appear here even when policy, liquidity, or rail readiness blocks them.</p>
              </div>
            ) : (
              <div className="payments-table" role="table" aria-label="Payment route observations">
                <div className="payments-table-head" role="row">
                  <span role="columnheader">Request</span>
                  <span role="columnheader">Selected rail</span>
                  <span role="columnheader">Amount</span>
                  <span role="columnheader">Outcome</span>
                </div>
                {routeObservations.slice(0, 8).map((observation) => (
                  <article className="payments-table-row" key={observation.id} role="row">
                    <div role="cell">
                      <strong>{observation.resource_category ?? observation.requested_asset ?? 'x402 request'}</strong>
                      <span>{observation.reason_code}</span>
                    </div>
                    <span role="cell">{formatOptionalRail(observation.supported_rail)}</span>
                    <span role="cell">{formatMoney(observation.amount_usdc)}</span>
                    <span className={`ops-state-pill ${observation.outcome === 'accepted' ? 'ops-state-active' : 'ops-state-pending'}`} role="cell">
                      {observation.outcome}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="ops-surface" aria-labelledby="payment-ledger-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="payment-ledger-title">Payment ledger</h2>
                <p>Submitted x402 payments with the settlement rail, provider mode, recipient, and resource category.</p>
              </div>
              <span className="ops-count-pill">{paymentEvents.length} event{paymentEvents.length === 1 ? '' : 's'}</span>
            </div>
            {paymentEvents.length === 0 ? (
              <div className="ops-empty-state">
                <h3>No payment events</h3>
                <p>Approved and submitted x402 payments will be recorded here with audit evidence.</p>
              </div>
            ) : (
              <div className="payments-table" role="table" aria-label="Payment events">
                <div className="payments-table-head" role="row">
                  <span role="columnheader">Payment</span>
                  <span role="columnheader">Rail</span>
                  <span role="columnheader">Amount</span>
                  <span role="columnheader">Mode</span>
                </div>
                {paymentEvents.slice(0, 8).map((event) => (
                  <article className="payments-table-row" key={event.id} role="row">
                    <div role="cell">
                      <strong>{event.resource_category ?? event.asset}</strong>
                      <span>{new Date(event.created_at).toLocaleString()}</span>
                    </div>
                    <span role="cell">{formatRail(event.rail)}</span>
                    <span role="cell">{formatMoney(event.amount_usdc)}</span>
                    <span className="ops-state-pill ops-state-active" role="cell">
                      {event.provider_mode}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="ops-surface" aria-labelledby="payment-reservations-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="payment-reservations-title">Reservations</h2>
                <p>In-flight and settled payment reservations tied to source buckets and x402 quote hashes.</p>
              </div>
              <span className="ops-count-pill">{paymentReservations.length} recent</span>
            </div>
            {paymentReservations.length === 0 ? (
              <div className="ops-empty-state">
                <h3>No reservations</h3>
                <p>Reservations appear when payment execution locks budget against an agent account.</p>
              </div>
            ) : (
              <div className="payments-table" role="table" aria-label="Payment reservations">
                <div className="payments-table-head" role="row">
                  <span role="columnheader">Reservation</span>
                  <span role="columnheader">Rail</span>
                  <span role="columnheader">Amount</span>
                  <span role="columnheader">Status</span>
                </div>
                {paymentReservations.slice(0, 8).map((reservation) => (
                  <article className="payments-table-row" key={reservation.id} role="row">
                    <div role="cell">
                      <strong>{reservation.reason_code}</strong>
                      <span>{reservation.quote_hash.slice(0, 12)}...</span>
                    </div>
                    <span role="cell">{formatRail(reservation.rail)}</span>
                    <span role="cell">{formatMoney(reservation.amount_usdc)}</span>
                    <span className={`ops-state-pill ops-state-${reservation.status === 'settled' ? 'active' : 'pending'}`} role="cell">
                      {reservation.status}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="ops-surface" aria-labelledby="provider-jobs-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="provider-jobs-title">Provider jobs</h2>
                <p>Recent Circle Agent Wallet, faucet, and Gateway operations for this workspace.</p>
              </div>
              <div className="payments-heading-actions">
                <span className="ops-count-pill">{circleJobs.length} recent</span>
                {reconcileJobsAction === undefined ? null : (
                  <form action={reconcileJobsAction}>
                    <button className="button-secondary" disabled={circleJobs.every((job) => !isReconcilableProviderJob(job))} type="submit">
                      Reconcile
                    </button>
                  </form>
                )}
              </div>
            </div>

            {circleJobs.length === 0 ? (
              <div className="ops-empty-state">
                <h3>No provider jobs</h3>
                <p>Circle Agent Wallet sync, faucet, and Gateway deposit attempts will appear here.</p>
              </div>
            ) : (
              <div className="payments-table" role="table" aria-label="Circle provider jobs">
                <div className="payments-table-head payments-jobs-head" role="row">
                  <span role="columnheader">Operation</span>
                  <span role="columnheader">Chain</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Result</span>
                </div>
                {circleJobs.map((job) => (
                  <article className="payments-table-row payments-jobs-row" key={job.id} role="row">
                    <div role="cell">
                      <strong>{titleCase(job.job_type.replace('.', '_'))}</strong>
                      <span>{new Date(job.created_at).toLocaleString()}</span>
                    </div>
                    <span role="cell">{job.chain === null ? 'Workspace' : CHAIN_LABELS[job.chain]}</span>
                    <span className={`ops-state-pill ops-state-${job.status}`} role="cell">
                      {job.status}
                    </span>
                    <span role="cell">{job.error_code ?? job.provider_ref ?? 'Recorded'}</span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="ops-surface" aria-labelledby="agent-payment-access-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="agent-payment-access-title">Agent access</h2>
                <p>Payment access is off unless this table shows an active budget for the agent.</p>
              </div>
              <span className="ops-count-pill">{agentPayments.length} agent{agentPayments.length === 1 ? '' : 's'}</span>
            </div>

            {agentPayments.length === 0 ? (
              <div className="ops-empty-state">
                <h3>No agents</h3>
                <p>Create an agent before enabling payment access.</p>
              </div>
            ) : (
              <div className="payments-agent-list" aria-label="Agent payment access">
                {agentPayments.map(({ account, agent }) => (
                  <article className="payments-agent-row" key={agent.id}>
                    <div>
                      <strong>{agent.name}</strong>
                      <span>{agent.status}</span>
                    </div>
                    <div>
                      <span>Access</span>
                      <strong>{accountState(account)}</strong>
                    </div>
                    <div>
                      <span>Budget</span>
                      <strong>{formatMoney(account?.budget_usdc ?? null)}</strong>
                    </div>
                    <div>
                      <span>Spent</span>
                      <strong>{formatMoney(account?.spent_usdc ?? null)}</strong>
                    </div>
                    <div>
                      <span>Per request</span>
                      <strong>{formatMoney(account?.per_request_cap_usdc ?? null)}</strong>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="payments-action-column" aria-label="Payment setup">
          <section className="ops-surface operations-action-card" aria-labelledby="provider-mode-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="provider-mode-title">Provider mode</h2>
                <p>Switches the workspace between Circle testnet and live networks.</p>
              </div>
            </div>
            <form action={modeAction} className="operations-form">
              <label>
                <span>Mode</span>
                <select defaultValue={paymentMode.mode} name="mode">
                  <option value="test">Test mode</option>
                  <option value="live">Live mode</option>
                </select>
              </label>
              <button className="button-secondary" type="submit">
                Save mode
              </button>
            </form>
          </section>

          <section className="ops-surface operations-action-card" aria-labelledby="circle-wallets-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="circle-wallets-title">Agent Wallet sync</h2>
                <p>Connects the workspace to the signed-in Circle Agent Wallet smart wallets.</p>
              </div>
            </div>
            <form action={circleTreasuryAction} className="operations-form">
              <input
                name="label"
                type="hidden"
                value={paymentMode.mode === 'live' ? 'Live Circle Agent Wallet' : 'Testnet Circle Agent Wallet'}
              />
              <button className="button-primary" disabled={createTreasuryDisabled} type="submit">
                Sync Agent Wallet
              </button>
              {activeWalletCount > 0 ? <p className="payments-form-note">Sync again to refresh wallet addresses and rail metadata.</p> : null}
            </form>
          </section>

          <section className="ops-surface operations-action-card" aria-labelledby="gateway-deposit-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="gateway-deposit-title">Gateway deposit</h2>
                <p>Deposits chain-local USDC into the selected Gateway domain for x402 nanopayments.</p>
              </div>
            </div>
            <form action={gatewayDepositAction} className="operations-form">
              <label>
                <span>Chain</span>
                <select defaultValue="base" name="chain">
                  {capabilities.filter((capability) => capability.gateway_supported).map((capability) => (
                    <option key={capability.chain} value={capability.chain}>
                      {CHAIN_LABELS[capability.chain]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Amount</span>
                <input defaultValue="0.50" inputMode="decimal" min="0.5" name="amount" required step="0.01" />
              </label>
              <button className="button-primary" disabled={activeWalletCount === 0} type="submit">
                Deposit to Gateway
              </button>
              <p className="payments-form-note">Gateway x402 payments require balance on the same chain. Minimum deposit is 0.5 USDC.</p>
            </form>
          </section>

          <section className="ops-surface operations-action-card" aria-labelledby="exact-rebalance-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="exact-rebalance-title">Exact wallet top-up</h2>
                <p>Bridge USDC between exact-payment wallets when recent exact x402 demand needs chain-local liquidity.</p>
              </div>
              {rebalanceRecommendations.length > 0 ? (
                <span className="ops-count-pill">{rebalanceRecommendations.length} open</span>
              ) : null}
            </div>

            {rebalanceRecommendations.length === 0 ? (
              <div className="ops-empty-state payments-compact-empty">
                <h3>No top-up needed</h3>
                <p>Gateway x402 uses chain-scoped Gateway balances. This panel only tracks exact onchain wallet liquidity.</p>
              </div>
            ) : (
              <div className="payments-rebalance-list" aria-label="Exact wallet top-up recommendations">
                {rebalanceRecommendations.slice(0, 3).map((recommendation) => (
                  <article className="payments-rebalance-row" key={`${recommendation.source_chain}-${recommendation.chain}`}>
                    <div>
                      <strong>{CHAIN_LABELS[recommendation.chain]}</strong>
                      <span>{recommendation.recent_exact_spend_usdc} USDC recent exact spend</span>
                    </div>
                    <div>
                      <span>Current</span>
                      <strong>{recommendation.current_wallet_usdc} USDC</strong>
                    </div>
                    <div>
                      <span>Top up</span>
                      <strong>{recommendation.amount_usdc} USDC</strong>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <form action={bridgeTopUpAction} className="operations-form">
              <div className="operations-form-grid">
                <label>
                  <span>From</span>
                  <select defaultValue={firstRecommendation?.source_chain ?? 'base'} name="fromChain">
                    {capabilities.map((capability) => (
                      <option key={capability.chain} value={capability.chain}>
                        {CHAIN_LABELS[capability.chain]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>To</span>
                  <select defaultValue={firstRecommendation?.chain ?? 'arbitrum'} name="toChain">
                    {capabilities.map((capability) => (
                      <option key={capability.chain} value={capability.chain}>
                        {CHAIN_LABELS[capability.chain]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                <span>Amount</span>
                <input
                  defaultValue={firstRecommendation?.amount_usdc ?? '0.05'}
                  inputMode="decimal"
                  min="0.01"
                  name="amount"
                  required
                  step="0.01"
                />
              </label>
              <button className="button-secondary" disabled={activeWalletCount === 0 || !providerHealth.configured} type="submit">
                Bridge top-up
              </button>
              <p className="payments-form-note">Uses Circle CCTP forwarding for exact-wallet liquidity. It does not move Gateway deposits.</p>
            </form>
          </section>

          {paymentMode.mode === 'test' ? (
            <section className="ops-surface operations-action-card" aria-labelledby="testnet-funds-title">
              <div className="ops-surface-heading">
                <div>
                  <h2 id="testnet-funds-title">Testnet funds</h2>
                  <p>Requests Circle testnet USDC for selected Agent Wallet smart wallets.</p>
                </div>
              </div>
              <form action={testnetFundsAction} className="operations-form">
                <fieldset className="payments-rail-fieldset">
                  <legend>Chains</legend>
                  {capabilities.slice(0, 3).map((capability) => (
                    <label key={capability.chain}>
                      <input defaultChecked name="chains" type="checkbox" value={capability.chain} />
                      <span>{CHAIN_LABELS[capability.chain]}</span>
                    </label>
                  ))}
                </fieldset>
                <button className="button-secondary" disabled={activeWalletCount === 0 || !providerHealth.configured} type="submit">
                  Request funds
                </button>
                <p className="payments-form-note">Circle can rate-limit faucet requests. Failed attempts are recorded as provider jobs.</p>
              </form>
            </section>
          ) : null}

          <section className="ops-surface operations-action-card" aria-labelledby="agent-access-title">
            <div className="ops-surface-heading">
              <div>
                <h2 id="agent-access-title">Agent access</h2>
                <p>Enable spending for one agent on settlement-verified exact or Gateway rails.</p>
              </div>
            </div>
            <form action={accessAction} className="operations-form">
              <label>
                <span>Agent</span>
                <select name="agentId" required>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Status</span>
                <select defaultValue="active" name="status">
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <div className="operations-form-grid">
                <label>
                  <span>Budget</span>
                  <input defaultValue="5.00" inputMode="decimal" name="budget" required />
                </label>
                <label>
                  <span>Per request</span>
                  <input defaultValue="2.00" inputMode="decimal" name="perRequestCap" required />
                </label>
              </div>
              <label>
                <span>Approval threshold</span>
                <input defaultValue="1.00" inputMode="decimal" name="approvalThreshold" />
              </label>
              <fieldset className="payments-rail-fieldset">
                <legend>Rails</legend>
                {PRIMARY_RAILS.map((rail) => (
                  <label key={rail}>
                    <input
                      defaultChecked={(rail === 'gateway_base' || rail === 'exact_base') && railIsSettlementVerified(capabilities, rail)}
                      disabled={!railIsSettlementVerified(capabilities, rail)}
                      name="allowedRails"
                      type="checkbox"
                      value={rail}
                    />
                    <span>{formatRail(rail)}</span>
                    {!railIsSettlementVerified(capabilities, rail) ? <small>Settlement unverified</small> : null}
                  </label>
                ))}
              </fieldset>
              <button className="button-primary" disabled={agents.length === 0 || activeGatewaySource === null} type="submit">
                Save access
              </button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}
