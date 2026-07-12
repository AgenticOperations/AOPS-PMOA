'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { IconArrowRight, IconSearch } from '@tabler/icons-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTablePager } from '@/components/ui/data-table-pager';
import { Sheet, SheetBody, SheetCloseButton, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import { TreasuryPageHeader, TreasurySectionNav } from './TreasuryChrome';
import { PRIMARY_RAILS, accountState, formatMoney, formatRail, railIsSettlementVerified } from '@/lib/payments-format';
import type { AgentPaymentAccountRecord, CircleChainCapabilityRecord, PaymentRail } from '@/lib/payments-types';
import type { AgentRosterItem } from '@/lib/identity-spine-types';

type TreasuryAgentAccessProps = {
  readonly accessAction: (formData: FormData) => Promise<void>;
  readonly accounts: readonly AgentPaymentAccountRecord[];
  readonly agents: readonly AgentRosterItem[];
  readonly capabilities: readonly CircleChainCapabilityRecord[];
  readonly orgSlug: string;
};

type AccessFilter = 'all' | 'active' | 'disabled' | 'unconfigured';
type RailFilter = 'all' | 'gateway' | 'exact';
const pageSize = 10;

function numeric(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

function initials(name: string): string {
  return name.split(/\s+/g).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

export function TreasuryAgentAccess({ accessAction, accounts, agents, capabilities, orgSlug }: TreasuryAgentAccessProps) {
  const accountByAgentId = useMemo(() => new Map(accounts.map((account) => [account.agent_id, account])), [accounts]);
  const assignableAgents = agents.filter((agent) => agent.status !== 'deactivated');
  const defaultRails = useMemo(() => PRIMARY_RAILS.filter((rail) => railIsSettlementVerified(capabilities, rail)), [capabilities]);
  const initialAgentId = assignableAgents[0]?.id ?? '';
  const initialAccount = accountByAgentId.get(initialAgentId);
  const [selectedAgentId, setSelectedAgentId] = useState(initialAgentId);
  const [status, setStatus] = useState(initialAccount?.status ?? 'active');
  const [budget, setBudget] = useState(initialAccount?.budget_usdc ?? '5.00');
  const [perRequestCap, setPerRequestCap] = useState(initialAccount?.per_request_cap_usdc ?? '2.00');
  const [approvalThreshold, setApprovalThreshold] = useState(initialAccount?.approval_threshold_usdc ?? '');
  const [allowedRails, setAllowedRails] = useState<readonly PaymentRail[]>(initialAccount?.allowed_rails ?? defaultRails);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('all');
  const [railFilter, setRailFilter] = useState<RailFilter>('all');
  const [page, setPage] = useState(1);
  const [actionState, formAction, pending] = useActionState(async (_state: { readonly error?: string }, formData: FormData) => {
    try {
      await accessAction(formData);
      setOpen(false);
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Agent payment access could not be saved.' };
    }
  }, {});

  useEffect(() => {
    const account = accounts.find((item) => item.agent_id === selectedAgentId);
    setStatus(account?.status ?? 'active');
    setBudget(account?.budget_usdc ?? '5.00');
    setPerRequestCap(account?.per_request_cap_usdc ?? '2.00');
    setApprovalThreshold(account?.approval_threshold_usdc ?? '');
    setAllowedRails(account?.allowed_rails ?? defaultRails);
  }, [accounts, defaultRails, selectedAgentId]);

  const visibleAgents = useMemo(() => agents.filter((agent) => {
    const account = accountByAgentId.get(agent.id);
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length > 0 && !`${agent.name} ${agent.id}`.toLowerCase().includes(normalizedQuery)) return false;
    if (accessFilter === 'active' && (account === undefined || !account.payment_access || account.status !== 'active')) return false;
    if (accessFilter === 'disabled' && account?.status !== 'disabled') return false;
    if (accessFilter === 'unconfigured' && account !== undefined) return false;
    if (railFilter !== 'all' && !account?.allowed_rails.some((rail) => rail.startsWith(`${railFilter}_`))) return false;
    return true;
  }), [accessFilter, accountByAgentId, agents, query, railFilter]);

  const totalPages = Math.max(1, Math.ceil(visibleAgents.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageAgents = visibleAgents.slice((safePage - 1) * pageSize, safePage * pageSize);

  const selectAgent = (agentId: string): void => {
    const account = accountByAgentId.get(agentId);
    setSelectedAgentId(agentId);
    setStatus(account?.status ?? 'active');
    setBudget(account?.budget_usdc ?? '5.00');
    setPerRequestCap(account?.per_request_cap_usdc ?? '2.00');
    setApprovalThreshold(account?.approval_threshold_usdc ?? '');
    setAllowedRails(account?.allowed_rails ?? defaultRails);
  };

  const setRail = (rail: PaymentRail, checked: boolean): void => {
    setAllowedRails((current) => checked ? [...new Set([...current, rail])] : current.filter((item) => item !== rail));
  };

  const openEditor = (agentId = selectedAgentId): void => {
    if (agentId.length > 0) selectAgent(agentId);
    setOpen(true);
  };

  return (
    <div className="treasury-workbench treasury-access-workbench">
      <TreasurySectionNav active="access" orgSlug={orgSlug} />
      <TreasuryPageHeader
        actions={<button className="treasury-button treasury-button-primary" disabled={assignableAgents.length === 0} onClick={() => openEditor()} type="button">Grant access</button>}
        description="Payment access is off by default. Audit delegation, budgets, caps, approval thresholds, and settlement-verified rails at a glance."
        eyebrow="Treasury / agent access"
        title="Who can spend, and how much."
      />

      <div className="treasury-table-toolbar">
        <label className="treasury-search-field"><IconSearch aria-hidden="true" size={15} stroke={1.8} /><span className="sr-only">Search agents</span><input onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search agent or ID…" value={query} /></label>
        <label><span className="sr-only">Access state</span><select onChange={(event) => { setAccessFilter(event.target.value as AccessFilter); setPage(1); }} value={accessFilter}><option value="all">All states</option><option value="active">Active</option><option value="disabled">Disabled</option><option value="unconfigured">Not configured</option></select></label>
        <label><span className="sr-only">Rail type</span><select onChange={(event) => { setRailFilter(event.target.value as RailFilter); setPage(1); }} value={railFilter}><option value="all">All rails</option><option value="gateway">Gateway</option><option value="exact">Exact</option></select></label>
      </div>

      <section aria-labelledby="treasury-agent-access-title" className="treasury-table-section">
        <div className="treasury-section-heading"><div><h2 id="treasury-agent-access-title">Agent payment access</h2><p>Only settlement-verified rails can be assigned.</p></div><span>{visibleAgents.length} of {agents.length}</span></div>
        {agents.length === 0 ? (
          <div className="treasury-empty-state"><strong>No agents yet</strong><p>Create an agent before enabling payment access.</p></div>
        ) : (
          <>
            <TableShell className="treasury-table-shell">
              <Table aria-label="Agent payment access" className="treasury-table">
                <TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>Access</TableHead><TableHead>Monthly budget</TableHead><TableHead>Spent</TableHead><TableHead>Per request</TableHead><TableHead>Approval over</TableHead><TableHead>Rails</TableHead><TableHead><span className="sr-only">Edit</span></TableHead></TableRow></TableHeader>
                <TableBody>{pageAgents.map((agent) => {
                  const account = accountByAgentId.get(agent.id) ?? null;
                  const spentPercent = account === null || numeric(account.budget_usdc) === 0 ? 0 : Math.min(100, (numeric(account.spent_usdc) / numeric(account.budget_usdc)) * 100);
                  const state = accountState(account);
                  return (
                    <TableRow key={agent.id}>
                      <TableCell><div className="treasury-primary-cell"><span>{initials(agent.name)}</span><div><strong>{agent.name}</strong><small>{agent.id}</small></div></div></TableCell>
                      <TableCell><StatusBadge label={state === 'On' ? 'Active' : account === null ? 'Not configured' : 'Disabled'} status={state === 'On' ? 'active' : 'inactive'} /></TableCell>
                      <TableCell>{formatMoney(account?.budget_usdc ?? null)}</TableCell>
                      <TableCell><div className="treasury-spend-cell"><strong>{formatMoney(account?.spent_usdc ?? null)}</strong><span><i style={{ width: `${spentPercent}%` }} /></span><small>{formatMoney(account?.reserved_usdc ?? null)} reserved</small></div></TableCell>
                      <TableCell>{formatMoney(account?.per_request_cap_usdc ?? null)}</TableCell>
                      <TableCell>{account?.approval_threshold_usdc == null ? 'None' : formatMoney(account.approval_threshold_usdc)}</TableCell>
                      <TableCell>{account?.allowed_rails.length ?? 0} / {PRIMARY_RAILS.length}</TableCell>
                      <TableCell><button aria-label={`Edit payment access for ${agent.name}`} className="table-row-action" onClick={() => openEditor(agent.id)} type="button"><IconArrowRight aria-hidden="true" size={13} stroke={1.8} /></button></TableCell>
                    </TableRow>
                  );
                })}</TableBody>
              </Table>
            </TableShell>
            <DataTablePager itemLabel="agents" onPageChange={setPage} page={safePage} pageSize={pageSize} total={visibleAgents.length} />
          </>
        )}
      </section>

      <Sheet labelledBy="agent-payment-access-title" onOpenChange={(nextOpen) => !pending && setOpen(nextOpen)} open={open} panelClassName="treasury-drawer">
        <SheetHeader><div><SheetTitle id="agent-payment-access-title">Set agent access</SheetTitle><SheetDescription>Configure one agent using only settlement-verified exact or Gateway rails.</SheetDescription></div><SheetCloseButton disabled={pending} onClick={() => setOpen(false)} /></SheetHeader>
        <form action={formAction} className="focus-form">
          <SheetBody className="treasury-drawer-form">
            <label><span>Agent</span><select name="agentId" onChange={(event) => selectAgent(event.currentTarget.value)} required value={selectedAgentId}>{assignableAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
            <label><span>Status</span><select name="status" onChange={(event) => setStatus(event.currentTarget.value as AgentPaymentAccountRecord['status'])} value={status}><option value="active">Active</option><option value="disabled">Disabled</option></select></label>
            <div className="treasury-form-grid"><label><span>Monthly budget</span><input inputMode="decimal" name="budget" onChange={(event) => setBudget(event.currentTarget.value)} required value={budget} /></label><label><span>Per request</span><input inputMode="decimal" name="perRequestCap" onChange={(event) => setPerRequestCap(event.currentTarget.value)} required value={perRequestCap} /></label></div>
            <label><span>Approval threshold</span><input inputMode="decimal" name="approvalThreshold" onChange={(event) => setApprovalThreshold(event.currentTarget.value)} placeholder="No threshold" value={approvalThreshold} /></label>
            <fieldset className="treasury-rail-fieldset"><legend>Allowed rails</legend>{PRIMARY_RAILS.map((rail) => { const verified = railIsSettlementVerified(capabilities, rail); return <label key={rail}><input checked={allowedRails.includes(rail)} disabled={!verified} name="allowedRails" onChange={(event) => setRail(rail, event.currentTarget.checked)} type="checkbox" value={rail} /><span>{formatRail(rail)}</span><small>{verified ? 'Verified' : 'Unverified'}</small></label>; })}</fieldset>
            {actionState.error !== undefined ? <p className="form-error" role="alert">{actionState.error}</p> : null}
            <button className="treasury-button treasury-button-primary treasury-form-submit" disabled={pending || assignableAgents.length === 0 || allowedRails.length === 0} type="submit">{pending ? 'Saving…' : 'Save access'}</button>
          </SheetBody>
        </form>
      </Sheet>
    </div>
  );
}
