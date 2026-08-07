'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconArrowRight, IconSearch } from '@tabler/icons-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTablePager } from '@/components/ui/data-table-pager';
import { Sheet, SheetBody, SheetCloseButton, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import { ChainMark } from './ChainMark';
import { TreasuryPageHeader, TreasurySectionNav } from './TreasuryChrome';
import { CHAIN_LABELS, formatMoney, formatRail, isReconcilableProviderJob, titleCase } from '@/lib/payments-format';
import type { CircleChainCapabilityRecord, CircleProviderJobRecord, PaymentChain, RebalanceRecommendationRecord } from '@/lib/payments-types';
import { formatUtcDateTime } from '@/lib/date-format';

type TreasuryLiquidityProps = {
  readonly bridgeTopUpAction: (formData: FormData) => Promise<void>;
  readonly cancelLiquidityJobAction: (formData: FormData) => Promise<void>;
  readonly capabilities: readonly CircleChainCapabilityRecord[];
  readonly liquidityJobs: readonly CircleProviderJobRecord[];
  readonly orgSlug: string;
  readonly providerState: 'ready' | 'disconnected' | 'unavailable';
  readonly reconcileJobsAction: () => Promise<void>;
  readonly rebalanceRecommendations: readonly RebalanceRecommendationRecord[];
  readonly retryLiquidityJobAction: (formData: FormData) => Promise<void>;
};

type JobStatusFilter = 'all' | CircleProviderJobRecord['status'];
const pageSize = 10;

function routeLabel(job: CircleProviderJobRecord): string {
  const source = typeof job.metadata.source_bucket === 'string' ? job.metadata.source_bucket : null;
  const destination = typeof job.metadata.destination_bucket === 'string' ? job.metadata.destination_bucket : null;
  if (source !== null && destination !== null) return `${source} → ${destination}`;
  if (job.chain !== null) return CHAIN_LABELS[job.chain];
  return 'Workspace';
}

function operationLabel(job: CircleProviderJobRecord): string {
  const rail = typeof job.metadata.rail === 'string' ? job.metadata.rail : null;
  return rail === null ? titleCase(job.job_type.replaceAll('.', '_')) : formatRail(rail);
}

export function TreasuryLiquidity({ bridgeTopUpAction, cancelLiquidityJobAction, capabilities, liquidityJobs, orgSlug, providerState, reconcileJobsAction, rebalanceRecommendations, retryLiquidityJobAction }: TreasuryLiquidityProps) {
  const firstRecommendation = rebalanceRecommendations[0] ?? null;
  const anyReconcilable = liquidityJobs.some(isReconcilableProviderJob);
  const [moveOpen, setMoveOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [confirmCancelJobId, setConfirmCancelJobId] = useState<string | null>(null);
  const [fromChain, setFromChain] = useState(firstRecommendation?.source_chain ?? 'base');
  const [toChain, setToChain] = useState(firstRecommendation?.chain ?? 'arbitrum');
  const [amount, setAmount] = useState(firstRecommendation?.amount_usdc ?? '0.05');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatusFilter>('all');
  const [chainFilter, setChainFilter] = useState<'all' | PaymentChain>('all');
  const [page, setPage] = useState(1);
  const [actionState, formAction, pending] = useActionState(async (_state: { readonly error?: string }, formData: FormData) => {
    try {
      await bridgeTopUpAction(formData);
      setMoveOpen(false);
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'The exact-wallet top-up could not be started.' };
    }
  }, {});

  const filteredJobs = useMemo(() => liquidityJobs.filter((job) => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length > 0 && !`${job.id} ${job.job_type} ${routeLabel(job)} ${job.provider_ref ?? ''} ${job.error_code ?? ''}`.toLowerCase().includes(normalized)) return false;
    if (statusFilter !== 'all' && job.status !== statusFilter) return false;
    if (chainFilter !== 'all' && job.chain !== chainFilter) return false;
    return true;
  }), [chainFilter, liquidityJobs, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageJobs = filteredJobs.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedJob = liquidityJobs.find((job) => job.id === selectedJobId);
  const queueCounts = {
    failed: liquidityJobs.filter((job) => job.status === 'failed').length,
    queued: liquidityJobs.filter((job) => job.status === 'queued').length,
    submitted: liquidityJobs.filter((job) => job.status === 'submitted').length,
  };
  const providerReady = providerState === 'ready';

  const openRecommendation = (recommendation?: RebalanceRecommendationRecord): void => {
    if (!providerReady) return;
    if (recommendation !== undefined) {
      setFromChain(recommendation.source_chain);
      setToChain(recommendation.chain);
      setAmount(recommendation.amount_usdc);
    }
    setMoveOpen(true);
  };

  return (
    <div className="treasury-workbench treasury-liquidity-workbench">
      <TreasurySectionNav active="liquidity" orgSlug={orgSlug} showAdvanced />
      <TreasuryPageHeader
        actions={<><form action={reconcileJobsAction}><button className="treasury-button" disabled={!providerReady || !anyReconcilable} type="submit">Reconcile provider</button></form><button className="treasury-button treasury-button-primary" disabled={!providerReady} onClick={() => openRecommendation()} type="button">Move liquidity</button></>}
        description="Monitor preparation work, resolve provider failures, and move exact-wallet liquidity through an explicit review step."
        eyebrow="Treasury / liquidity"
        title="Keep exact wallets ready."
      />

      {providerState === 'unavailable' ? <div className="treasury-provider-alert is-danger"><div><strong>Circle provider status is unavailable.</strong><span>New liquidity moves, retries, and reconciliation remain disabled. Existing queued work can still be cancelled.</span></div></div> : providerState === 'disconnected' ? <div className="treasury-provider-alert"><div><strong>Circle Agent Wallet is not connected.</strong><span>Connect the organization treasury before preparing liquidity.</span></div><Link href={`/onboarding/${orgSlug}`}>Connect treasury</Link></div> : null}

      <section aria-label="Liquidity preparation queue" className="treasury-status-band">
        <div className="treasury-metric treasury-metric-lead"><span>Preparation queue</span><strong>{liquidityJobs.length} provider jobs</strong><p>{queueCounts.queued} queued, {queueCounts.submitted} submitted, and {queueCounts.failed} failed.</p></div>
        <div className="treasury-metric"><span>Queued</span><strong>{queueCounts.queued}</strong></div>
        <div className="treasury-metric"><span>Submitted</span><strong>{queueCounts.submitted}</strong></div>
        <div className="treasury-metric"><span>Failed</span><strong className={queueCounts.failed > 0 ? 'is-danger' : undefined}>{queueCounts.failed}</strong></div>
      </section>

      <section className="treasury-recommendations">
        <div className="treasury-section-heading"><div><h2>Recommended moves</h2><p>Derived from recent exact-settlement demand and current exact-wallet liquidity.</p></div><span>{rebalanceRecommendations.length}</span></div>
        {rebalanceRecommendations.length === 0 ? <div className="treasury-calm-state"><strong>No exact-wallet top-up is recommended.</strong><p>Gateway x402 uses chain-scoped Gateway balances and is not represented as an exact-wallet move.</p></div> : (
          <div>{rebalanceRecommendations.map((recommendation) => <div className="treasury-recommendation-row" key={`${recommendation.source_chain}-${recommendation.chain}`}><div className="treasury-primary-cell"><ChainMark chain={recommendation.chain} size="small" /><div><strong>Top up {CHAIN_LABELS[recommendation.chain]} from {CHAIN_LABELS[recommendation.source_chain]}</strong><small>{formatMoney(recommendation.current_wallet_usdc)} current · {formatMoney(recommendation.recent_exact_spend_usdc)} recent exact spend</small></div></div><div><strong>+{formatMoney(recommendation.amount_usdc)}</strong><button className="treasury-button" disabled={!providerReady} onClick={() => openRecommendation(recommendation)} type="button">Prepare</button></div></div>)}</div>
        )}
      </section>

      <section aria-labelledby="provider-jobs-title" className="treasury-table-section">
        <div className="treasury-table-toolbar">
          <label className="treasury-search-field"><IconSearch aria-hidden="true" size={15} stroke={1.8} /><span className="sr-only">Search provider jobs</span><input onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search provider jobs…" value={query} /></label>
          <label><span className="sr-only">Job status</span><select onChange={(event) => { setStatusFilter(event.target.value as JobStatusFilter); setPage(1); }} value={statusFilter}><option value="all">All statuses</option><option value="queued">Queued</option><option value="submitted">Submitted</option><option value="complete">Complete</option><option value="failed">Failed</option><option value="blocked">Blocked</option></select></label>
          <label><span className="sr-only">Job chain</span><select onChange={(event) => { setChainFilter(event.target.value as 'all' | PaymentChain); setPage(1); }} value={chainFilter}><option value="all">All chains</option>{capabilities.map((capability) => <option key={capability.chain} value={capability.chain}>{CHAIN_LABELS[capability.chain]}</option>)}</select></label>
        </div>
        <div className="treasury-section-heading"><div><h2 id="provider-jobs-title">Provider jobs</h2><p>Preparation, funding, proof, and settlement work recorded by the Circle provider.</p></div><span>{filteredJobs.length} of {liquidityJobs.length}</span></div>
        {liquidityJobs.length === 0 ? <div className="treasury-empty-state"><strong>No liquidity jobs</strong><p>Requests that require chain preparation will appear here.</p></div> : <><TableShell className="treasury-table-shell"><Table aria-label="Liquidity provider jobs" className="treasury-table"><TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Operation</TableHead><TableHead>Route</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader><TableBody>{pageJobs.map((job) => <TableRow key={job.id}><TableCell><code>{job.id}</code></TableCell><TableCell>{operationLabel(job)}</TableCell><TableCell>{routeLabel(job)}</TableCell><TableCell>{formatMoney(job.amount_usdc)}</TableCell><TableCell><StatusBadge status={job.status} /></TableCell><TableCell><time dateTime={job.created_at}>{formatUtcDateTime(job.created_at)}</time></TableCell><TableCell><button aria-label={`Open job ${job.id}`} className="table-row-action" onClick={() => setSelectedJobId(job.id)} type="button"><IconArrowRight aria-hidden="true" size={13} stroke={1.8} /></button></TableCell></TableRow>)}</TableBody></Table></TableShell><DataTablePager itemLabel="jobs" onPageChange={setPage} page={safePage} pageSize={pageSize} total={filteredJobs.length} /></>}
      </section>

      <Sheet labelledBy="move-liquidity-title" onOpenChange={(nextOpen) => !pending && setMoveOpen(nextOpen)} open={moveOpen} panelClassName="treasury-drawer">
        <SheetHeader><div><SheetTitle id="move-liquidity-title">Move exact-wallet liquidity</SheetTitle><SheetDescription>Bridge USDC between exact-payment wallets using Circle CCTP forwarding.</SheetDescription></div><SheetCloseButton disabled={pending} onClick={() => setMoveOpen(false)} /></SheetHeader>
        <form action={formAction} className="focus-form"><SheetBody className="treasury-drawer-form"><div className="treasury-form-grid"><label><span>From</span><select name="fromChain" onChange={(event) => setFromChain(event.currentTarget.value as PaymentChain)} value={fromChain}>{capabilities.map((capability) => <option key={capability.chain} value={capability.chain}>{CHAIN_LABELS[capability.chain]}</option>)}</select></label><label><span>To</span><select name="toChain" onChange={(event) => setToChain(event.currentTarget.value as PaymentChain)} value={toChain}>{capabilities.map((capability) => <option key={capability.chain} value={capability.chain}>{CHAIN_LABELS[capability.chain]}</option>)}</select></label></div><label><span>Amount</span><input inputMode="decimal" min="0.01" name="amount" onChange={(event) => setAmount(event.currentTarget.value)} required step="0.01" value={amount} /></label><p className="treasury-form-note">Uses Circle CCTP forwarding for exact-wallet liquidity. Gateway deposits remain chain-scoped.</p>{actionState.error !== undefined ? <p className="form-error" role="alert">{actionState.error}</p> : null}<button className="treasury-button treasury-button-primary treasury-form-submit" disabled={pending || !providerReady || fromChain === toChain} type="submit">{pending ? 'Starting…' : 'Bridge top-up'}</button></SheetBody></form>
      </Sheet>

      <Sheet labelledBy="provider-job-title" onOpenChange={(open) => { if (!open) { setSelectedJobId(null); setConfirmCancelJobId(null); } }} open={selectedJob !== undefined} panelClassName="treasury-drawer">
        <SheetHeader><div><SheetTitle id="provider-job-title">Provider job</SheetTitle><SheetDescription>{selectedJob === undefined ? 'Recorded provider evidence.' : operationLabel(selectedJob)}</SheetDescription></div><SheetCloseButton onClick={() => { setSelectedJobId(null); setConfirmCancelJobId(null); }} /></SheetHeader>
        <SheetBody className="treasury-evidence-drawer">{selectedJob === undefined ? null : <><div className="treasury-drawer-status"><StatusBadge status={selectedJob.status} /><code>{selectedJob.id}</code></div><dl className="treasury-evidence-grid"><div><dt>Route</dt><dd>{routeLabel(selectedJob)}</dd></div><div><dt>Amount</dt><dd>{formatMoney(selectedJob.amount_usdc)}</dd></div><div><dt>Created</dt><dd>{formatUtcDateTime(selectedJob.created_at)}</dd></div><div><dt>Updated</dt><dd>{formatUtcDateTime(selectedJob.updated_at)}</dd></div><div><dt>Provider reference</dt><dd>{selectedJob.provider_ref ?? 'Not assigned'}</dd></div><div><dt>Error</dt><dd>{selectedJob.error_code ?? 'None'}</dd></div></dl><div className="treasury-destructive-actions">{selectedJob.status === 'failed' ? <form action={retryLiquidityJobAction}><input name="jobId" type="hidden" value={selectedJob.id} /><button className="treasury-button treasury-button-primary" disabled={!providerReady} type="submit">Retry job</button></form> : null}{selectedJob.status === 'queued' || selectedJob.status === 'submitted' ? confirmCancelJobId === selectedJob.id ? <form action={cancelLiquidityJobAction} className="treasury-cancel-confirm"><input name="jobId" type="hidden" value={selectedJob.id} /><p>Cancel this provider job before it completes? The recorded job and evidence remain available.</p><div><button className="button-secondary" onClick={() => setConfirmCancelJobId(null)} type="button">Keep job</button><button className="button-danger" type="submit">Confirm cancel</button></div></form> : <div><p>Cancel this provider job before it completes.</p><button className="button-danger" onClick={() => setConfirmCancelJobId(selectedJob.id)} type="button">Cancel job</button></div> : null}</div></>}
        </SheetBody>
      </Sheet>
    </div>
  );
}
