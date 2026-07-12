import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { FocusCanvas } from '@/components/ui/focus-canvas';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import { CHAIN_LABELS, FIELD_CLASS, formatMoney, formatRail, isReconcilableProviderJob, titleCase } from '@/lib/payments-format';
import type { CircleChainCapabilityRecord, CircleProviderJobRecord, RebalanceRecommendationRecord } from '@/lib/payments-types';

type TreasuryLiquidityProps = {
  readonly bridgeTopUpAction: (formData: FormData) => Promise<void>;
  readonly cancelLiquidityJobAction: (formData: FormData) => Promise<void>;
  readonly capabilities: readonly CircleChainCapabilityRecord[];
  readonly liquidityJobs: readonly CircleProviderJobRecord[];
  readonly reconcileJobsAction: () => Promise<void>;
  readonly rebalanceRecommendations: readonly RebalanceRecommendationRecord[];
  readonly retryLiquidityJobAction: (formData: FormData) => Promise<void>;
};

export function TreasuryLiquidity({
  bridgeTopUpAction,
  cancelLiquidityJobAction,
  capabilities,
  liquidityJobs,
  reconcileJobsAction,
  rebalanceRecommendations,
  retryLiquidityJobAction,
}: TreasuryLiquidityProps) {
  const firstRecommendation = rebalanceRecommendations[0] ?? null;
  const anyReconcilable = liquidityJobs.some(isReconcilableProviderJob);

  return (
    <div className="grid gap-6">
      <PageHeader description="Internal treasury plumbing: liquidity preparation jobs, rebalance recommendations, and cross-chain top-ups." title="Liquidity" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>Liquidity preparation</CardTitle>
              <CardDescription>Queued jobs created when an agent asks for a payment rail whose chain bucket is not ready.</CardDescription>
            </div>
            <form action={reconcileJobsAction}>
              <button className="button-secondary" disabled={!anyReconcilable} type="submit">
                Reconcile
              </button>
            </form>
          </CardHeader>
          <CardContent>
            {liquidityJobs.length === 0 ? (
              <EmptyState description="When an agent requests a supported payment and the target bucket is empty, agentOps will queue preparation here." title="No liquidity jobs" variant="treasury" />
            ) : (
              <TableShell maxHeight={480}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Route</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {liquidityJobs.map((job) => {
                      const canRetry = job.status === 'failed';
                      const canCancel = job.status === 'queued' || job.status === 'submitted';
                      const rail = typeof job.metadata.rail === 'string' ? job.metadata.rail : null;
                      return (
                        <TableRow key={job.id}>
                          <TableCell>
                            <div className="grid gap-0.5">
                              <span className="font-semibold">{rail !== null ? formatRail(rail) : titleCase(job.job_type.replace('.', '_'))}</span>
                              <span className="text-xs text-muted-foreground">
                                {typeof job.metadata.source_bucket === 'string' && typeof job.metadata.destination_bucket === 'string'
                                  ? `${job.metadata.source_bucket} -> ${job.metadata.destination_bucket}`
                                  : new Date(job.created_at).toLocaleString()}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="tabular-nums">{formatMoney(job.amount_usdc)}</TableCell>
                          <TableCell>
                            <StatusBadge status={job.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            {canRetry ? (
                              <form action={retryLiquidityJobAction} className="inline">
                                <input name="jobId" type="hidden" value={job.id} />
                                <button className="button-secondary" type="submit">
                                  Retry
                                </button>
                              </form>
                            ) : null}
                            {canCancel ? (
                              <form action={cancelLiquidityJobAction} className="inline">
                                <input name="jobId" type="hidden" value={job.id} />
                                <button className="button-secondary" type="submit">
                                  Cancel
                                </button>
                              </form>
                            ) : null}
                            {!canRetry && !canCancel ? <span className="text-xs text-muted-foreground">No action</span> : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableShell>
            )}
          </CardContent>
        </Card>

        <FocusCanvas>
          <div className="grid gap-1">
            <h2 className="text-sm font-semibold">Exact wallet top-up</h2>
            <p className="text-sm text-muted-foreground">Bridge USDC between exact-payment wallets when recent exact x402 demand needs chain-local liquidity.</p>
          </div>

          {rebalanceRecommendations.length === 0 ? (
            <div className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              No top-up needed. Gateway x402 uses chain-scoped Gateway balances; this only tracks exact onchain wallet liquidity.
            </div>
          ) : (
            <ul className="grid gap-2">
              {rebalanceRecommendations.slice(0, 3).map((recommendation) => (
                <li className="grid grid-cols-3 gap-2 rounded-xl bg-muted px-3 py-2 text-sm" key={`${recommendation.source_chain}-${recommendation.chain}`}>
                  <div className="grid gap-0.5">
                    <span className="font-semibold">{CHAIN_LABELS[recommendation.chain]}</span>
                    <span className="text-xs text-muted-foreground">{recommendation.recent_exact_spend_usdc} recent spend</span>
                  </div>
                  <div className="grid gap-0.5 text-right">
                    <span className="text-xs text-muted-foreground">Current</span>
                    <span className="tabular-nums">{recommendation.current_wallet_usdc}</span>
                  </div>
                  <div className="grid gap-0.5 text-right">
                    <span className="text-xs text-muted-foreground">Top up</span>
                    <span className="tabular-nums">{recommendation.amount_usdc}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form action={bridgeTopUpAction} className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">From</span>
                <select className={FIELD_CLASS} defaultValue={firstRecommendation?.source_chain ?? 'base'} name="fromChain">
                  {capabilities.map((capability) => (
                    <option key={capability.chain} value={capability.chain}>
                      {CHAIN_LABELS[capability.chain]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">To</span>
                <select className={FIELD_CLASS} defaultValue={firstRecommendation?.chain ?? 'arbitrum'} name="toChain">
                  {capabilities.map((capability) => (
                    <option key={capability.chain} value={capability.chain}>
                      {CHAIN_LABELS[capability.chain]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Amount</span>
              <input
                className={FIELD_CLASS}
                defaultValue={firstRecommendation?.amount_usdc ?? '0.05'}
                inputMode="decimal"
                min="0.01"
                name="amount"
                required
                step="0.01"
              />
            </label>
            <button className="button-secondary" type="submit">
              Bridge top-up
            </button>
            <p className="text-xs text-muted-foreground">Uses Circle CCTP forwarding for exact-wallet liquidity. Does not move Gateway deposits.</p>
          </form>
        </FocusCanvas>
      </div>
    </div>
  );
}
