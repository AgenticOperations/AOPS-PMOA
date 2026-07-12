'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { FocusCanvas } from '@/components/ui/focus-canvas';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import { PRIMARY_RAILS, FIELD_CLASS, accountState, formatMoney, formatRail, railIsSettlementVerified } from '@/lib/payments-format';
import type { AgentPaymentAccountRecord, CircleChainCapabilityRecord, PaymentRail } from '@/lib/payments-types';
import type { AgentRosterItem } from '@/lib/identity-spine-types';

type TreasuryAgentAccessProps = {
  readonly accessAction: (formData: FormData) => Promise<void>;
  readonly accounts: readonly AgentPaymentAccountRecord[];
  readonly agents: readonly AgentRosterItem[];
  readonly capabilities: readonly CircleChainCapabilityRecord[];
  readonly hasActiveGatewaySource: boolean;
};

export function TreasuryAgentAccess({ accessAction, accounts, agents, capabilities, hasActiveGatewaySource }: TreasuryAgentAccessProps) {
  const accountByAgentId = new Map(accounts.map((account) => [account.agent_id, account]));
  const assignableAgents = agents.filter((agent) => agent.status !== 'deactivated');
  const defaultRails = PRIMARY_RAILS.filter(
    (rail) => (rail === 'gateway_base' || rail === 'exact_base') && railIsSettlementVerified(capabilities, rail),
  );
  const initialAgentId = assignableAgents[0]?.id ?? '';
  const initialAccount = accountByAgentId.get(initialAgentId);
  const [selectedAgentId, setSelectedAgentId] = useState(initialAgentId);
  const [status, setStatus] = useState(initialAccount?.status ?? 'active');
  const [budget, setBudget] = useState(initialAccount?.budget_usdc ?? '5.00');
  const [perRequestCap, setPerRequestCap] = useState(initialAccount?.per_request_cap_usdc ?? '2.00');
  const [approvalThreshold, setApprovalThreshold] = useState(initialAccount?.approval_threshold_usdc ?? '');
  const [allowedRails, setAllowedRails] = useState<readonly PaymentRail[]>(initialAccount?.allowed_rails ?? defaultRails);

  useEffect(() => {
    const account = accounts.find((item) => item.agent_id === selectedAgentId);
    const refreshedDefaultRails = PRIMARY_RAILS.filter(
      (rail) => (rail === 'gateway_base' || rail === 'exact_base') && railIsSettlementVerified(capabilities, rail),
    );
    setStatus(account?.status ?? 'active');
    setBudget(account?.budget_usdc ?? '5.00');
    setPerRequestCap(account?.per_request_cap_usdc ?? '2.00');
    setApprovalThreshold(account?.approval_threshold_usdc ?? '');
    setAllowedRails(account?.allowed_rails ?? refreshedDefaultRails);
  }, [accounts, capabilities, selectedAgentId]);

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
    setAllowedRails((current) => checked ? [...current, rail] : current.filter((item) => item !== rail));
  };

  return (
    <div className="grid gap-6">
      <PageHeader description="Payment access is off by default. Enable it per agent with an explicit budget, per-request cap, and settlement-verified rails." title="Agent access" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Agents</CardTitle>
            <StatusBadge label={`${agents.length} agent${agents.length === 1 ? '' : 's'}`} status="info" />
          </CardHeader>
          <CardContent>
            {agents.length === 0 ? (
              <EmptyState description="Create an agent before enabling payment access." title="No agents yet" variant="agents" />
            ) : (
              <TableShell maxHeight={520}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Access</TableHead>
                      <TableHead>Budget</TableHead>
                      <TableHead>Spent</TableHead>
                      <TableHead>Per request</TableHead>
                      <TableHead>Approval threshold</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agents.map((agent) => {
                      const account = accountByAgentId.get(agent.id) ?? null;
                      return (
                        <TableRow key={agent.id}>
                          <TableCell>
                            <div className="grid gap-0.5">
                              <span className="font-semibold">{agent.name}</span>
                              <span className="text-xs text-muted-foreground">{agent.status}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge label={accountState(account)} status={accountState(account) === 'On' ? 'active' : 'inactive'} />
                          </TableCell>
                          <TableCell className="tabular-nums">{formatMoney(account?.budget_usdc ?? null)}</TableCell>
                          <TableCell className="tabular-nums">{formatMoney(account?.spent_usdc ?? null)}</TableCell>
                          <TableCell className="tabular-nums">{formatMoney(account?.per_request_cap_usdc ?? null)}</TableCell>
                          <TableCell className="tabular-nums">{account?.approval_threshold_usdc === null || account?.approval_threshold_usdc === undefined ? 'None' : formatMoney(account.approval_threshold_usdc)}</TableCell>
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
            <h2 className="text-sm font-semibold">Set agent access</h2>
            <p className="text-sm text-muted-foreground">Enable spending for one agent on settlement-verified exact or Gateway rails.</p>
          </div>
          <form action={accessAction} className="grid gap-3">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Agent</span>
              <select
                className={FIELD_CLASS}
                name="agentId"
                onChange={(event) => selectAgent(event.currentTarget.value)}
                required
                value={selectedAgentId}
              >
                {assignableAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Status</span>
              <select className={FIELD_CLASS} name="status" onChange={(event) => setStatus(event.currentTarget.value as AgentPaymentAccountRecord['status'])} value={status}>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Budget</span>
                <input className={FIELD_CLASS} inputMode="decimal" name="budget" onChange={(event) => setBudget(event.currentTarget.value)} required value={budget} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Per request</span>
                <input className={FIELD_CLASS} inputMode="decimal" name="perRequestCap" onChange={(event) => setPerRequestCap(event.currentTarget.value)} required value={perRequestCap} />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Approval threshold</span>
              <input className={FIELD_CLASS} inputMode="decimal" name="approvalThreshold" onChange={(event) => setApprovalThreshold(event.currentTarget.value)} value={approvalThreshold} />
            </label>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Rails</legend>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {PRIMARY_RAILS.map((rail) => {
                  const verified = railIsSettlementVerified(capabilities, rail);
                  return (
                    <label className="!flex !items-center gap-2 !font-normal text-sm" key={rail}>
                      <input
                        className="!h-4 !w-4 !min-h-0 shrink-0"
                        checked={allowedRails.includes(rail)}
                        disabled={!verified}
                        name="allowedRails"
                        onChange={(event) => setRail(rail, event.currentTarget.checked)}
                        type="checkbox"
                        value={rail}
                      />
                      <span className={verified ? undefined : 'text-muted-foreground'}>{formatRail(rail)}</span>
                      {!verified ? <span className="text-xs text-(--state-warning)">Unverified</span> : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <button className="button-primary" disabled={assignableAgents.length === 0 || !hasActiveGatewaySource} type="submit">
              Save access
            </button>
          </form>
        </FocusCanvas>
      </div>
    </div>
  );
}
