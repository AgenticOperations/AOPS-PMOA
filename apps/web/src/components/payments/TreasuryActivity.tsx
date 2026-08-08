'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { IconArrowRight, IconSearch } from '@tabler/icons-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTablePager } from '@/components/ui/data-table-pager';
import { Sheet, SheetBody, SheetCloseButton, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import { TreasuryPageHeader, TreasurySectionNav } from './TreasuryChrome';
import { CHAIN_LABELS, formatMoney, formatOptionalRail, formatRail, titleCase } from '@/lib/payments-format';
import { formatUtcDateTime } from '@/lib/date-format';
import type { AuditEventRecord } from '@/lib/audit-types';
import type { EscrowJobActivityRecord } from '@/lib/payments-types';
import type {
  CircleProviderJobRecord,
  PaymentChain,
  PaymentEventRecord,
  PaymentReservationRecord,
  PaymentRouteObservationRecord,
} from '@/lib/payments-types';

export type TreasuryActivityTab = 'payments' | 'routing' | 'reservations' | 'jobs' | 'escrow' | 'audit';

type TreasuryActivityProps = {
  readonly activeTab: TreasuryActivityTab;
  readonly auditEvents: readonly AuditEventRecord[];
  readonly escrowJobs?: readonly EscrowJobActivityRecord[];
  readonly orgSlug: string;
  readonly paymentEvents: readonly PaymentEventRecord[];
  readonly providerJobs: readonly CircleProviderJobRecord[];
  readonly reservations: readonly PaymentReservationRecord[];
  readonly routeObservations: readonly PaymentRouteObservationRecord[];
};

type EvidenceRow = {
  readonly amount: string;
  readonly chain: PaymentChain | null;
  readonly details: readonly { readonly label: string; readonly value: string }[];
  readonly id: string;
  readonly outcome: string;
  readonly primary: string;
  readonly secondary: string;
  readonly target: string;
  readonly time: string;
};

type DateFilter = 'all' | '24h' | '7d' | '30d';
const pageSize = 10;

const EXPLORER_TX_BASE: Record<'arc' | 'base', string> = {
  arc: 'https://testnet.arcscan.app/tx/',
  base: 'https://sepolia.basescan.org/tx/',
};

function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function paymentStatus(event: PaymentEventRecord): { readonly label: string; readonly status: string } {
  const fulfillment = event.result.fulfillment;
  if (fulfillment !== null && typeof fulfillment === 'object') {
    const status = (fulfillment as Record<string, unknown>).status;
    if (status === 'delivered') return { label: 'Delivered', status: 'active' };
    if (status === 'failed') return { label: 'Fulfillment failed', status: 'failed' };
  }
  if (event.result.settlement === 'settled') return { label: 'Settled', status: 'active' };
  return { label: titleCase(event.decision), status: event.decision };
}

function outcomeTone(outcome: string): string {
  const normalized = outcome.toLowerCase();
  if (['accepted', 'active', 'approved', 'complete', 'completed', 'delivered', 'funded', 'settled', 'success'].includes(normalized)) return 'active';
  if (['blocked', 'denied', 'error', 'expired', 'failed', 'rejected', 'revoked'].includes(normalized)) return 'failed';
  if (['open', 'pending', 'queued', 'reserved', 'submitted', 'warning'].includes(normalized)) return 'pending';
  return 'inactive';
}

function escrowTxHash(job: EscrowJobActivityRecord): string | null {
  return job.terminalTxHash ?? job.submitTxHash ?? job.fundTxHash ?? job.createTxHash;
}

function rowsForTab(props: TreasuryActivityProps): EvidenceRow[] {
  if (props.activeTab === 'payments') return props.paymentEvents.map((event) => {
    const status = paymentStatus(event);
    const result = event.result as Record<string, unknown>;
    const txHash = typeof result.tx_hash === 'string' ? result.tx_hash : null;
    const payeeName = typeof result.payee_name === 'string' ? result.payee_name : null;
    const payeeAgentId = typeof result.payee_agent_id === 'string' ? result.payee_agent_id : null;
    const lane = typeof result.lane === 'string' ? result.lane : null;
    const explorer = (event.chain === 'arc' || event.chain === 'base') && txHash !== null
      ? `${EXPLORER_TX_BASE[event.chain]}${txHash}`
      : null;
    return {
      amount: formatMoney(event.amount_usdc),
      chain: event.chain,
      id: event.id,
      outcome: status.label,
      primary: event.resource_category ?? event.asset,
      secondary: payeeName === null ? event.agent_id : `payer ${event.agent_id.slice(0, 12)}… → ${payeeName}`,
      target: lane === 'permit2_intra_fleet' ? 'Permit2 · Fleet' : formatRail(event.rail),
      time: event.created_at,
      details: [
        { label: 'Payer agent', value: event.agent_id },
        ...(payeeName === null ? [] : [{ label: 'Payee agent', value: payeeName }]),
        ...(payeeAgentId === null ? [] : [{ label: 'Payee agent id', value: payeeAgentId }]),
        { label: 'Recipient wallet', value: event.recipient },
        { label: 'Network', value: event.network },
        { label: 'Resource URL', value: event.resource_url ?? 'Not recorded' },
        ...(txHash === null ? [] : [{ label: 'Tx hash', value: txHash }]),
        ...(explorer === null ? [] : [{ label: 'Explorer', value: explorer }]),
        { label: 'Lane', value: lane ?? titleCase(event.provider_mode) },
        { label: 'Reservation', value: event.reservation_id ?? 'None' },
      ],
    };
  });
  if (props.activeTab === 'routing') return props.routeObservations.map((observation) => ({ amount: formatMoney(observation.amount_usdc), chain: observation.supported_rail === null ? null : observation.supported_rail.replace(/^gateway_|^exact_/, '') as PaymentChain, id: observation.id, outcome: titleCase(observation.outcome), primary: observation.resource_category ?? observation.requested_asset ?? 'x402 request', secondary: observation.agent_id, target: formatOptionalRail(observation.supported_rail), time: observation.observed_at, details: [{ label: 'Reason', value: observation.reason_code }, { label: 'Requested network', value: observation.requested_network ?? 'Not recorded' }, { label: 'Requested rail', value: observation.requested_rail ?? 'Not recorded' }, { label: 'Resource URL', value: observation.resource_url ?? 'Not recorded' }] }));
  if (props.activeTab === 'reservations') return props.reservations.map((reservation) => ({ amount: formatMoney(reservation.amount_usdc), chain: reservation.rail.replace(/^gateway_|^exact_/, '') as PaymentChain, id: reservation.id, outcome: titleCase(reservation.status), primary: reservation.reason_code, secondary: reservation.agent_id, target: formatRail(reservation.rail), time: reservation.updated_at, details: [{ label: 'Quote hash', value: reservation.quote_hash }, { label: 'Source', value: reservation.source_id }, { label: 'Expires', value: formatUtcDateTime(reservation.expires_at) }, { label: 'Connection', value: reservation.connection_id ?? 'None' }] }));
  if (props.activeTab === 'jobs') return props.providerJobs.map((job) => ({ amount: formatMoney(job.amount_usdc), chain: job.chain, id: job.id, outcome: titleCase(job.status), primary: titleCase(job.job_type.replaceAll('.', '_')), secondary: job.chain === null ? 'Workspace' : CHAIN_LABELS[job.chain], target: job.provider_ref ?? 'Provider job', time: job.updated_at, details: [{ label: 'Provider reference', value: job.provider_ref ?? 'Not assigned' }, { label: 'Error', value: job.error_code ?? 'None' }, { label: 'Created', value: formatUtcDateTime(job.created_at) }, { label: 'Mode', value: titleCase(job.mode) }] }));
  if (props.activeTab === 'escrow') {
    return (props.escrowJobs ?? []).map((job) => {
      const txHash = escrowTxHash(job);
      const explorer = job.chain === 'arc' || job.chain === 'base'
        ? (txHash === null ? null : `${EXPLORER_TX_BASE[job.chain]}${txHash}`)
        : null;
      return {
        amount: formatMoney(job.budgetUsdc),
        chain: job.chain,
        id: job.id,
        outcome: titleCase(job.state),
        primary: job.clientAgentName ?? job.clientAgentId,
        secondary: `On-chain #${job.onchainJobId ?? '—'} · payer ${job.clientAgentId}`,
        target: `Provider ${shortAddress(job.providerAddress)}`,
        time: job.createdAt,
        details: [
          { label: 'Provider', value: job.providerAddress },
          { label: 'Evaluator', value: job.evaluatorAddress },
          { label: 'Escrow mode', value: job.escrowMode === 2 ? 'Client evaluates (mode 2)' : 'Neutral evaluator (mode 3)' },
          { label: 'On-chain job id', value: job.onchainJobId ?? 'Not recorded' },
          { label: 'Expires', value: formatUtcDateTime(job.expiresAt) },
          { label: 'Create tx', value: job.createTxHash ?? 'Not recorded' },
          { label: 'Fund tx', value: job.fundTxHash ?? 'Not funded yet' },
          { label: 'Explorer', value: explorer ?? 'Not available' },
        ],
      };
    });
  }
  return props.auditEvents.map((event) => ({ amount: event.eventCategory, chain: null, id: event.id, outcome: titleCase(event.outcome), primary: titleCase(event.eventType.replaceAll('.', '_')), secondary: `${event.actorType}:${event.actorId ?? 'system'}`, target: event.resourceType === null ? event.eventDomain : `${event.resourceType}:${event.resourceId ?? 'unknown'}`, time: event.occurredAt, details: [{ label: 'Event hash', value: event.eventHash }, { label: 'Previous hash', value: event.previousHash ?? 'Genesis' }, { label: 'Canonical body hash', value: event.canonicalBodyHash }, { label: 'Source', value: event.sourceSystem ?? 'Not recorded' }, { label: 'Severity', value: titleCase(event.severity) }] }));
}

const tabs: readonly { readonly key: TreasuryActivityTab; readonly label: string }[] = [
  { key: 'payments', label: 'Payments' },
  { key: 'routing', label: 'Routing' },
  { key: 'reservations', label: 'Reservations' },
  { key: 'jobs', label: 'Provider jobs' },
  { key: 'escrow', label: 'Escrow' },
  { key: 'audit', label: 'Audit' },
];

export function TreasuryActivity(props: TreasuryActivityProps) {
  const rows = useMemo(() => rowsForTab(props), [props]);
  const [query, setQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [chainFilter, setChainFilter] = useState<'all' | PaymentChain>('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const outcomeOptions = [...new Set(rows.map((row) => row.outcome))].sort();
  const filteredRows = rows.filter((row) => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length > 0 && !`${row.id} ${row.primary} ${row.secondary} ${row.target}`.toLowerCase().includes(normalized)) return false;
    if (chainFilter !== 'all' && row.chain !== chainFilter) return false;
    if (outcomeFilter !== 'all' && row.outcome !== outcomeFilter) return false;
    if (dateFilter !== 'all') {
      const duration = dateFilter === '24h' ? 86_400_000 : dateFilter === '7d' ? 604_800_000 : 2_592_000_000;
      if (Date.parse(row.time) < Date.now() - duration) return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selected = rows.find((row) => row.id === selectedId);

  return (
    <div className="treasury-workbench treasury-activity-workbench">
      <TreasurySectionNav active="activity" orgSlug={props.orgSlug} />
      <TreasuryPageHeader description="Payments, routing, reservations, escrow jobs, and audit." eyebrow="Treasury / activity" title="Activity" />

      <nav aria-label="Evidence type" className="treasury-evidence-tabs">{tabs.map((tab) => <Link aria-current={props.activeTab === tab.key ? 'page' : undefined} className={props.activeTab === tab.key ? 'is-active' : undefined} href={`/app/${props.orgSlug}/payments/activity${tab.key === 'payments' ? '' : `?tab=${tab.key}`}`} key={tab.key}>{tab.label}</Link>)}</nav>

      <div className="treasury-table-toolbar treasury-activity-toolbar">
        <label className="treasury-search-field"><IconSearch aria-hidden="true" size={15} stroke={1.8} /><span className="sr-only">Search evidence</span><input onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search…" value={query} /></label>
        <label><span className="sr-only">Date range</span><select onChange={(event) => { setDateFilter(event.target.value as DateFilter); setPage(1); }} value={dateFilter}><option value="all">All dates</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
        <label><span className="sr-only">Chain</span><select onChange={(event) => { setChainFilter(event.target.value as 'all' | PaymentChain); setPage(1); }} value={chainFilter}><option value="all">All chains</option>{Object.entries(CHAIN_LABELS).map(([chain, label]) => <option key={chain} value={chain}>{label}</option>)}</select></label>
        <label><span className="sr-only">Outcome</span><select onChange={(event) => { setOutcomeFilter(event.target.value); setPage(1); }} value={outcomeFilter}><option value="all">All outcomes</option>{outcomeOptions.map((outcome) => <option key={outcome} value={outcome}>{outcome}</option>)}</select></label>
      </div>

      <section aria-labelledby="treasury-evidence-title" className="treasury-table-section">
        <div className="treasury-section-heading"><div><h2 id="treasury-evidence-title">{tabs.find((tab) => tab.key === props.activeTab)?.label}</h2></div><span>{filteredRows.length}</span></div>
        {rows.length === 0 ? (
          <div className="treasury-empty-state">
            <strong>No {props.activeTab} yet</strong>
            <p>
              {props.activeTab === 'escrow'
                ? 'Escrow jobs appear here after marketplace or Empower ERC-8183 hire.'
                : 'Records appear when agents spend or route.'}
            </p>
          </div>
        ) : (
          <>
            <TableShell className="treasury-table-shell">
              <Table aria-label={`${props.activeTab} evidence`} className="treasury-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>{props.activeTab === 'escrow' ? 'Paying agent' : 'Agent / operation'}</TableHead>
                    <TableHead>{props.activeTab === 'escrow' ? 'Provider' : 'Rail / target'}</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead><span className="sr-only">Open</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell><code>{row.id}</code></TableCell>
                      <TableCell><div className="treasury-index-primary"><strong>{row.primary}</strong><small>{row.secondary}</small></div></TableCell>
                      <TableCell>{row.target}</TableCell>
                      <TableCell>{row.amount}</TableCell>
                      <TableCell><StatusBadge label={row.outcome} status={outcomeTone(row.outcome)} /></TableCell>
                      <TableCell><time dateTime={row.time}>{formatUtcDateTime(row.time)}</time></TableCell>
                      <TableCell><button aria-label={`Open evidence ${row.id}`} className="table-row-action" onClick={() => setSelectedId(row.id)} type="button"><IconArrowRight aria-hidden="true" size={13} stroke={1.8} /></button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableShell>
            <DataTablePager itemLabel="records" onPageChange={setPage} page={safePage} pageSize={pageSize} total={filteredRows.length} />
          </>
        )}
      </section>

      <Sheet labelledBy="treasury-evidence-drawer-title" onOpenChange={(open) => !open && setSelectedId(null)} open={selected !== undefined} panelClassName="treasury-drawer">
        <SheetHeader><div><SheetTitle id="treasury-evidence-drawer-title">Record</SheetTitle><SheetDescription>{selected?.primary ?? 'Evidence detail'}</SheetDescription></div><SheetCloseButton onClick={() => setSelectedId(null)} /></SheetHeader>
        <SheetBody className="treasury-evidence-drawer">{selected === undefined ? null : (
          <>
            <div className="treasury-drawer-status"><StatusBadge label={selected.outcome} status={outcomeTone(selected.outcome)} /><code>{selected.id}</code></div>
            <dl className="treasury-evidence-grid">
              <div><dt>Agent / operation</dt><dd>{selected.secondary}</dd></div>
              <div><dt>Rail / target</dt><dd>{selected.target}</dd></div>
              <div><dt>Amount</dt><dd>{selected.amount}</dd></div>
              <div><dt>Recorded</dt><dd>{formatUtcDateTime(selected.time)}</dd></div>
              {selected.details.map((detail) => (
                <div key={detail.label}>
                  <dt>{detail.label}</dt>
                  <dd>
                    {detail.label === 'Explorer' && detail.value.startsWith('http')
                      ? <a href={detail.value} rel="noreferrer" target="_blank">{detail.value}</a>
                      : detail.value}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
        </SheetBody>
      </Sheet>
    </div>
  );
}
