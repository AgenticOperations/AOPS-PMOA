'use client';

import { useActionState, useState } from 'react';
import type { WalletRefRecord } from '@/lib/identity-spine-types';
import { AgentTablePager } from './AgentTablePager';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const PAGE_SIZE = 10;

export function WalletRefsPanel({
  orgId,
  orgSlug,
  agentId,
  walletRefs,
  attachAction,
  detachAction,
}: {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly agentId: string;
  readonly walletRefs: WalletRefRecord[];
  readonly attachAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly detachAction?: ((formData: FormData) => Promise<void>) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedWallet, setSelectedWallet] = useState<WalletRefRecord | null>(null);
  const visibleWallets = walletRefs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const [state, formAction, pending] = useActionState(async (_state: { readonly error?: string }, formData: FormData) => {
    if (attachAction === undefined) return { error: 'Wallet reference attachment is unavailable.' };
    try {
      await attachAction(formData);
      setOpen(false);
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Wallet reference could not be attached.' };
    }
  }, {});

  return (
    <section className="agent-record-section" aria-labelledby="wallet-refs-title">
      <div className="agent-section-heading">
        <div>
          <h2 id="wallet-refs-title">Wallet references</h2>
          <p>External wallet identifiers recorded for identity context. These references do not grant payment access.</p>
        </div>
        <button className="agent-secondary-button" disabled={attachAction === undefined} onClick={() => setOpen(true)} type="button">Attach wallet</button>
      </div>

      {walletRefs.length === 0 ? (
          <div className="agent-table-empty">
            <strong>No wallet references</strong>
            <span>This agent can be managed before any payment setup exists.</span>
          </div>
      ) : (
        <>
          <TableShell className="agent-record-table-shell" maxHeight={620}>
            <Table aria-label="Agent wallet references" className="agent-record-table">
              <TableHeader><TableRow><TableHead>Wallet</TableHead><TableHead>Network</TableHead><TableHead>Provider</TableHead><TableHead>Status</TableHead><TableHead aria-label="Open" /></TableRow></TableHeader>
              <TableBody>
                {visibleWallets.map((walletRef) => (
                  <TableRow key={walletRef.id}>
                    <TableCell data-label="Wallet"><div className="agent-primary-cell"><span className="agent-entity-icon">WL</span><div><strong>{walletRef.label || walletRef.provider}</strong><code>{walletRef.address ?? walletRef.external_wallet_id ?? walletRef.id}</code></div></div></TableCell>
                    <TableCell data-label="Network">{walletRef.chain ?? 'Not specified'}</TableCell>
                    <TableCell data-label="Provider">{walletRef.provider}</TableCell>
                    <TableCell data-label="Status"><span className={`agent-status-badge is-${walletRef.status === 'attached' ? 'active' : 'danger'}`}>{walletRef.status}</span></TableCell>
                    <TableCell className="agent-row-action" data-label=""><button onClick={() => setSelectedWallet(walletRef)} type="button">Open <span aria-hidden="true">→</span></button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
          <AgentTablePager itemLabel="wallet references" onPageChange={setPage} page={page} pageSize={PAGE_SIZE} total={walletRefs.length} />
        </>
      )}

      <Sheet labelledBy="attach-wallet-title" onOpenChange={setOpen} open={open} panelClassName="agent-action-sheet">
        <SheetHeader>
          <div><SheetTitle id="attach-wallet-title">Attach wallet reference</SheetTitle><SheetDescription>Record an existing wallet identifier for this agent. This does not grant payment access or move funds.</SheetDescription></div>
          <SheetCloseButton onClick={() => setOpen(false)} />
        </SheetHeader>
        <form action={formAction} className="focus-form">
          <SheetBody className="operations-form">
            <input name="orgId" type="hidden" value={orgId} />
            <input name="orgSlug" type="hidden" value={orgSlug} />
            <input name="agentId" type="hidden" value={agentId} />
            <label><span>Provider</span><input name="provider" placeholder="circle_developer_controlled" required /></label>
            <label><span>Wallet ID</span><input name="externalWalletId" placeholder="wallet_..." /></label>
            <label><span>Address</span><input name="address" placeholder="0x..." /></label>
            <label><span>Chain</span><input name="chain" placeholder="arc-testnet" /></label>
            <label><span>Label</span><input name="label" placeholder="Managed wallet" /></label>
            {state.error !== undefined ? <p className="form-error" role="alert">{state.error}</p> : null}
            <button className="agent-primary-button agent-inline-submit" disabled={pending || attachAction === undefined} type="submit">{pending ? 'Attaching...' : 'Attach wallet'}</button>
          </SheetBody>
        </form>
      </Sheet>

      <Sheet labelledBy="wallet-reference-detail-title" onOpenChange={(nextOpen) => !nextOpen && setSelectedWallet(null)} open={selectedWallet !== null} panelClassName="agent-action-sheet">
        <SheetHeader>
          <div><SheetTitle id="wallet-reference-detail-title">Wallet reference</SheetTitle><SheetDescription>Identity metadata only. Treasury controls remain separate.</SheetDescription></div>
          <SheetCloseButton onClick={() => setSelectedWallet(null)} />
        </SheetHeader>
        {selectedWallet !== null ? (
          <SheetBody>
            <dl className="agent-drawer-definitions">
              <div><dt>Label</dt><dd>{selectedWallet.label || 'Not set'}</dd></div>
              <div><dt>Provider</dt><dd>{selectedWallet.provider}</dd></div>
              <div><dt>Chain</dt><dd>{selectedWallet.chain ?? 'Not set'}</dd></div>
              <div><dt>Address</dt><dd><code>{selectedWallet.address ?? 'Not set'}</code></dd></div>
              <div><dt>External wallet ID</dt><dd><code>{selectedWallet.external_wallet_id ?? 'Not set'}</code></dd></div>
              <div><dt>Status</dt><dd>{selectedWallet.status}</dd></div>
            </dl>
            {detachAction !== undefined && selectedWallet.status === 'attached' ? (
              <div className="agent-drawer-action-section destructive">
                <h3>Remove reference</h3>
                <p>Detaching removes this reference from the agent. It does not move funds or alter the external wallet.</p>
                <WalletDetachAction action={detachAction} agentId={agentId} orgId={orgId} orgSlug={orgSlug} walletRefId={selectedWallet.id} />
              </div>
            ) : null}
          </SheetBody>
        ) : null}
      </Sheet>
    </section>
  );
}

function WalletDetachAction({ action, agentId, orgId, orgSlug, walletRefId }: { readonly action: (formData: FormData) => Promise<void>; readonly agentId: string; readonly orgId: string; readonly orgSlug: string; readonly walletRefId: string }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) return <button className="button-secondary" onClick={() => setConfirming(true)} type="button">Detach</button>;
  return (
    <form action={action} className="button-row">
      <input name="orgId" type="hidden" value={orgId} />
      <input name="orgSlug" type="hidden" value={orgSlug} />
      <input name="agentId" type="hidden" value={agentId} />
      <input name="walletRefId" type="hidden" value={walletRefId} />
      <button className="button-secondary" onClick={() => setConfirming(false)} type="button">Cancel</button>
      <button className="button-danger" type="submit">Confirm detach</button>
    </form>
  );
}
