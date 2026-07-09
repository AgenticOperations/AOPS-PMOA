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
  PaymentRail,
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
  readonly providerHealth: CircleProviderHealth;
  readonly rebalanceRecommendations: readonly RebalanceRecommendationRecord[];
  readonly reconcileJobsAction?: (() => Promise<void>) | undefined;
  readonly retryLiquidityJobAction?: ((formData: FormData) => Promise<void>) | undefined;
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
  providerHealth,
  rebalanceRecommendations,
  reconcileJobsAction,
  retryLiquidityJobAction,
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
                {liquidityJobs.map((job) => (
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
                      <form action={retryLiquidityJobAction}>
                        <input name="jobId" type="hidden" value={job.id} />
                        <button className="button-secondary" disabled={job.status === 'complete' || job.status === 'blocked'} type="submit">
                          Retry
                        </button>
                      </form>
                      <form action={cancelLiquidityJobAction}>
                        <input name="jobId" type="hidden" value={job.id} />
                        <button className="button-secondary" disabled={job.status === 'complete' || job.status === 'blocked'} type="submit">
                          Cancel
                        </button>
                      </form>
                    </div>
                  </article>
                ))}
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
                <p>Enable spending for one agent on the Base Gateway rail.</p>
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
              <fieldset className="payments-rail-fieldset">
                <legend>Rails</legend>
                {PRIMARY_RAILS.map((rail) => (
                  <label key={rail}>
                    <input defaultChecked={rail === 'gateway_base' || rail === 'exact_base'} name="allowedRails" type="checkbox" value={rail} />
                    <span>{formatRail(rail)}</span>
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
