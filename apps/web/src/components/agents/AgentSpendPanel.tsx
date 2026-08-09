'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui/status-badge';
import { Sheet, SheetBody, SheetCloseButton, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DelegateFromTreasury } from '@/components/payments/DelegateFromTreasury';
import { DelegationList } from '@/components/wallet/DelegationList';
import { DelegateToAgent } from '@/components/wallet/DelegateToAgent';
import { WalletProvider } from '@/components/wallet/WalletProvider';
import { PRIMARY_RAILS, accountState, formatMoney, formatRail, railIsSettlementVerified } from '@/lib/payments-format';
import type { AgentPaymentAccountRecord, CircleChainCapabilityRecord, PaymentRail } from '@/lib/payments-types';
import type { DelegationSummary } from '@/lib/server/payments-client';

type AgentWallet = {
  readonly agentId: string;
  readonly chain: string;
  readonly status: string;
};

type AgentSpendPanelProps = {
  readonly accessAction: (formData: FormData) => Promise<void>;
  readonly account: AgentPaymentAccountRecord | null;
  readonly agentId: string;
  readonly agentName: string;
  readonly agentWallets: readonly AgentWallet[];
  readonly capabilities: readonly CircleChainCapabilityRecord[];
  readonly canEdit: boolean;
  readonly delegations: readonly DelegationSummary[];
  readonly orgSlug: string;
};

type AllowanceSource = 'treasury' | 'wallet';

function numeric(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

function remainingBudget(account: AgentPaymentAccountRecord | null): string | null {
  if (account === null) return null;
  const left = Math.max(0, numeric(account.budget_usdc) - numeric(account.spent_usdc) - numeric(account.reserved_usdc));
  return left.toFixed(2);
}

/**
 * Per-agent spend on Overview: soft payment limits + hard draw allowances.
 * Org-wide Access/Delegations tables stay off this page.
 */
export function AgentSpendPanel({
  accessAction,
  account,
  agentId,
  agentName,
  agentWallets,
  capabilities,
  canEdit,
  delegations,
  orgSlug,
}: AgentSpendPanelProps) {
  const defaultRails = useMemo(
    () => PRIMARY_RAILS.filter((rail) => railIsSettlementVerified(capabilities, rail)),
    [capabilities],
  );
  const [accessOpen, setAccessOpen] = useState(false);
  const [allowanceOpen, setAllowanceOpen] = useState(false);
  const [allowanceSource, setAllowanceSource] = useState<AllowanceSource>('treasury');
  const [status, setStatus] = useState(account?.status ?? 'active');
  const [budget, setBudget] = useState(account?.budget_usdc ?? '5.00');
  const [perRequestCap, setPerRequestCap] = useState(account?.per_request_cap_usdc ?? '2.00');
  const [approvalThreshold, setApprovalThreshold] = useState(account?.approval_threshold_usdc ?? '');
  const [allowedRails, setAllowedRails] = useState<readonly PaymentRail[]>(account?.allowed_rails ?? defaultRails);

  const [actionState, formAction, pending] = useActionState(async (_state: { readonly error?: string }, formData: FormData) => {
    try {
      await accessAction(formData);
      setAccessOpen(false);
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Payment access could not be saved.' };
    }
  }, {});

  useEffect(() => {
    setStatus(account?.status ?? 'active');
    setBudget(account?.budget_usdc ?? '5.00');
    setPerRequestCap(account?.per_request_cap_usdc ?? '2.00');
    setApprovalThreshold(account?.approval_threshold_usdc ?? '');
    setAllowedRails(account?.allowed_rails ?? defaultRails);
  }, [account, defaultRails]);

  const state = accountState(account);
  const accessOn = state === 'On';
  const left = remainingBudget(account);
  const spentPercent = account === null || numeric(account.budget_usdc) === 0
    ? 0
    : Math.min(100, ((numeric(account.spent_usdc) + numeric(account.reserved_usdc)) / numeric(account.budget_usdc)) * 100);
  const verifiedRails = (account?.allowed_rails ?? []).filter((rail) => railIsSettlementVerified(capabilities, rail));

  const setRail = (rail: PaymentRail, checked: boolean): void => {
    setAllowedRails((current) => (checked ? [...new Set([...current, rail])] : current.filter((item) => item !== rail)));
  };

  const agentOption = { id: agentId, name: agentName };

  return (
    <section className="agent-detail-section agent-spend-panel" aria-labelledby="agent-spend-title">
      <div className="agent-section-heading">
        <div>
          <h2 id="agent-spend-title">Spend</h2>
        </div>
        {canEdit ? (
          <div className="agent-spend-actions">
            <button className="agent-secondary-button" onClick={() => setAccessOpen(true)} type="button">
              {account === null ? 'Grant access' : 'Edit access'}
            </button>
            <button className="agent-secondary-button" onClick={() => setAllowanceOpen(true)} type="button">
              Add allowance
            </button>
          </div>
        ) : null}
      </div>

      {account === null ? (
        <div className="soft-row">
          <strong>No payment access yet</strong>
          <span>Grant rails and a monthly budget so this agent can spend.</span>
        </div>
      ) : (
        <div className="agent-spend-summary">
          <dl className="agent-spend-metrics">
            <div>
              <dt>Access</dt>
              <dd>
                <StatusBadge
                  label={accessOn ? 'Active' : 'Disabled'}
                  status={accessOn ? 'active' : 'inactive'}
                />
              </dd>
            </div>
            <div>
              <dt>Left this month</dt>
              <dd>{formatMoney(left)}</dd>
            </div>
            <div>
              <dt>Budget</dt>
              <dd>{formatMoney(account.budget_usdc)}</dd>
            </div>
            <div>
              <dt>Per request</dt>
              <dd>{formatMoney(account.per_request_cap_usdc)}</dd>
            </div>
            {account.approval_threshold_usdc != null && account.approval_threshold_usdc.length > 0 ? (
              <div>
                <dt>Approval over</dt>
                <dd>{formatMoney(account.approval_threshold_usdc)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="agent-spend-progress" aria-label="Budget used">
            <div className="agent-spend-progress-track">
              <i style={{ width: `${spentPercent}%` }} />
            </div>
            <p>
              {formatMoney(account.spent_usdc)} spent
              {numeric(account.reserved_usdc) > 0 ? ` · ${formatMoney(account.reserved_usdc)} reserved` : ''}
              {verifiedRails.length > 0 ? ` · ${verifiedRails.map((rail) => formatRail(rail)).join(', ')}` : ''}
            </p>
          </div>
        </div>
      )}

      <div className="agent-spend-allowances">
        <div className="agent-spend-allowances-label">
          <h3>Draw allowances</h3>
          <Link className="action-nav-link" href={`/app/${orgSlug}/payments/funding`}>
            Org ceiling on Fund
          </Link>
        </div>
        <DelegationList delegations={delegations} orgSlug={orgSlug} />
      </div>

      <Sheet
        labelledBy="agent-grant-access-title"
        onOpenChange={(nextOpen) => !pending && setAccessOpen(nextOpen)}
        open={accessOpen}
        panelClassName="treasury-drawer"
      >
        <SheetHeader>
          <div>
            <SheetTitle id="agent-grant-access-title">
              {account === null ? 'Grant payment access' : 'Edit payment access'}
            </SheetTitle>
            <SheetDescription>
              Set budget, per-request cap, and settlement-verified rails for {agentName}.
            </SheetDescription>
          </div>
          <SheetCloseButton disabled={pending} onClick={() => setAccessOpen(false)} />
        </SheetHeader>
        <form action={formAction} className="focus-form">
          <SheetBody className="treasury-drawer-form">
            <input name="agentId" type="hidden" value={agentId} />
            <label>
              <span>Status</span>
              <select
                name="status"
                onChange={(event) => setStatus(event.currentTarget.value as AgentPaymentAccountRecord['status'])}
                value={status}
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <div className="treasury-form-grid">
              <label>
                <span>Monthly budget</span>
                <input
                  inputMode="decimal"
                  name="budget"
                  onChange={(event) => setBudget(event.currentTarget.value)}
                  required
                  value={budget}
                />
              </label>
              <label>
                <span>Per request</span>
                <input
                  inputMode="decimal"
                  name="perRequestCap"
                  onChange={(event) => setPerRequestCap(event.currentTarget.value)}
                  required
                  value={perRequestCap}
                />
              </label>
            </div>
            <label>
              <span>Approval threshold</span>
              <input
                inputMode="decimal"
                name="approvalThreshold"
                onChange={(event) => setApprovalThreshold(event.currentTarget.value)}
                placeholder="No threshold"
                value={approvalThreshold}
              />
            </label>
            <fieldset className="treasury-rail-fieldset">
              <legend>Allowed rails</legend>
              {PRIMARY_RAILS.map((rail) => {
                const verified = railIsSettlementVerified(capabilities, rail);
                return (
                  <label key={rail}>
                    <input
                      checked={allowedRails.includes(rail)}
                      disabled={!verified}
                      name="allowedRails"
                      onChange={(event) => setRail(rail, event.currentTarget.checked)}
                      type="checkbox"
                      value={rail}
                    />
                    <span>{formatRail(rail)}</span>
                    <small>{verified ? 'Verified' : 'Unverified'}</small>
                  </label>
                );
              })}
            </fieldset>
            {actionState.error !== undefined ? <p className="form-error" role="alert">{actionState.error}</p> : null}
            <button
              className="treasury-button treasury-button-primary treasury-form-submit"
              disabled={pending || allowedRails.length === 0}
              type="submit"
            >
              {pending ? 'Saving…' : 'Save access'}
            </button>
          </SheetBody>
        </form>
      </Sheet>

      <Sheet
        labelledBy="agent-add-allowance-title"
        onOpenChange={setAllowanceOpen}
        open={allowanceOpen}
        panelClassName="treasury-drawer"
      >
        <SheetHeader>
          <div>
            <SheetTitle id="agent-add-allowance-title">Add draw allowance</SheetTitle>
            <SheetDescription>
              Cap how much {agentName} can draw from treasury or your wallet.
            </SheetDescription>
          </div>
          <SheetCloseButton onClick={() => setAllowanceOpen(false)} />
        </SheetHeader>
        <SheetBody className="treasury-drawer-form agent-allowance-drawer">
          <div className="delegations-source-toggle" role="tablist" aria-label="Allowance source">
            <button
              aria-selected={allowanceSource === 'treasury'}
              className={allowanceSource === 'treasury' ? 'is-active' : undefined}
              onClick={() => setAllowanceSource('treasury')}
              role="tab"
              type="button"
            >
              From treasury
            </button>
            <button
              aria-selected={allowanceSource === 'wallet'}
              className={allowanceSource === 'wallet' ? 'is-active' : undefined}
              onClick={() => setAllowanceSource('wallet')}
              role="tab"
              type="button"
            >
              From your wallet
            </button>
          </div>
          <p className="delegations-source-hint">
            {allowanceSource === 'treasury'
              ? 'Draws from the org pool on Fund. No MetaMask.'
              : 'Non-custodial Permit2 — funds stay in MetaMask until this agent draws.'}
          </p>
          {allowanceSource === 'treasury' ? (
            <DelegateFromTreasury
              agentWallets={agentWallets}
              agents={[agentOption]}
              lockedAgentId={agentId}
              orgSlug={orgSlug}
            />
          ) : (
            <WalletProvider>
              <DelegateToAgent
                agentWallets={agentWallets}
                agents={[agentOption]}
                lockedAgentId={agentId}
                orgSlug={orgSlug}
              />
            </WalletProvider>
          )}
        </SheetBody>
      </Sheet>
    </section>
  );
}
