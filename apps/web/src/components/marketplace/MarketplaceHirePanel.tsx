'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  LinkedActionMessage,
  activityEscrowHref,
  agentCredentialsHref,
  agentsListHref,
  empowerAccessHref,
  fundHref,
  type ActionNavLink,
} from '@/components/ui/LinkedActionMessage';
import type { MarketplaceListingRecord } from '@/lib/server/payments-client';

type ClientOption = { readonly id: string; readonly name: string };

type MarketplaceHirePanelProps = {
  readonly orgSlug: string;
  readonly buyerOrgId: string;
  readonly listing: MarketplaceListingRecord;
  readonly clients: readonly ClientOption[];
  readonly authorizeAction: (formData: FormData) => Promise<void>;
  readonly hireX402Action: (formData: FormData) => Promise<void>;
  readonly hireEscrowAction: (formData: FormData) => Promise<{ readonly jobId: string }>;
  readonly purchasesHref: string;
};

type FormState = { readonly error?: string; readonly ok?: string };

function guideLinksForMessage(orgSlug: string, clientAgentId: string | undefined, message: string): readonly ActionNavLink[] {
  const links: ActionNavLink[] = [];
  const lower = message.toLowerCase();
  if (lower.includes('credential') && clientAgentId !== undefined && clientAgentId.length > 0) {
    links.push({ match: 'Credentials', href: agentCredentialsHref(orgSlug, clientAgentId) });
  }
  if (lower.includes('fund')) {
    links.push({ match: 'Fund', href: fundHref(orgSlug) });
  }
  if (lower.includes('activity')) {
    links.push({ match: 'Activity', href: activityEscrowHref(orgSlug) });
  }
  if (lower.includes('empower')) {
    links.push({ match: 'Empower', href: empowerAccessHref(orgSlug) });
  }
  if (lower.includes('create an agent') || (lower.includes('agents') && lower.includes('create'))) {
    links.push({ match: 'Agents', href: agentsListHref(orgSlug) });
  }
  return links;
}

export function MarketplaceHirePanel({
  orgSlug,
  buyerOrgId,
  listing,
  clients,
  authorizeAction,
  hireX402Action,
  hireEscrowAction,
  purchasesHref,
}: MarketplaceHirePanelProps) {
  const router = useRouter();
  const canX402 = listing.rails.includes('x402');
  const canEscrow = listing.rails.includes('escrow') && listing.providerAddress !== null;
  const [hireMode, setHireMode] = useState<'x402' | 'escrow'>(canX402 ? 'x402' : 'escrow');
  const [clientAgentId, setClientAgentId] = useState(clients[0]?.id ?? '');

  const sameOrgFleetHire = listing.agentId !== null && listing.orgId === buyerOrgId;
  const selectedAuthorized = (listing.orgId === buyerOrgId && listing.agentId !== null)
    || listing.destinationAuthorized === true;
  const needsAuthorize = listing.providerAddress !== null
    && !(listing.orgId === buyerOrgId && listing.agentId !== null)
    && !selectedAuthorized;

  const escrowPayerClients = useMemo(() => {
    if (listing.kind !== 'agent' || listing.agentId === null) return clients;
    return clients.filter((client) => client.id !== listing.agentId);
  }, [clients, listing.agentId, listing.kind]);

  const payerClients = hireMode === 'escrow' ? escrowPayerClients : clients;

  useEffect(() => {
    if (canX402) setHireMode('x402');
    else if (canEscrow) setHireMode('escrow');
  }, [canEscrow, canX402, listing.id]);

  useEffect(() => {
    if (payerClients.length === 0) {
      setClientAgentId('');
      return;
    }
    if (!payerClients.some((client) => client.id === clientAgentId)) {
      setClientAgentId(payerClients[0]?.id ?? '');
    }
  }, [clientAgentId, payerClients]);

  const [authState, authFormAction, authPending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      try {
        await authorizeAction(formData);
        router.refresh();
        return { ok: 'Destination authorized.' };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Authorization failed.' };
      }
    },
    {},
  );

  const [x402State, x402FormAction, x402Pending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      try {
        await hireX402Action(formData);
        router.refresh();
        return { ok: 'Payment submitted. It will show under Purchases in your console.' };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Payment failed.' };
      }
    },
    {},
  );

  const [escrowState, escrowFormAction, escrowPending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      try {
        const result = await hireEscrowAction(formData);
        router.refresh();
        return {
          ok: `Escrow job ${result.jobId} created — track it in Purchases / Activity.`,
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Hire failed.' };
      }
    },
    {},
  );

  if (clients.length === 0) {
    return (
      <div className="amkt-hire-live">
        <p className="amkt-eyebrow">Hire</p>
        <h2>{listing.name}</h2>
        <p className="amkt-hire-copy">
          Create a paying agent in your org first, then hire from this page.
        </p>
        <Link className="amkt-hire-cta" href={agentsListHref(orgSlug)}>
          Open Agents
        </Link>
      </div>
    );
  }

  const payerSelect = (
    <label className="amkt-hire-field">
      <span>Paying agent</span>
      <select
        name="clientAgentId"
        onChange={(event) => setClientAgentId(event.currentTarget.value)}
        required
        value={clientAgentId}
      >
        {payerClients.map((client) => (
          <option key={client.id} value={client.id}>{client.name}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="amkt-hire-live">
      <p className="amkt-eyebrow">Hire here</p>
      <h2>{listing.name}</h2>
      <p className="amkt-hire-copy">
        Pay on this page under your org policy. Purchases appear in your console.
      </p>

      {(canX402 || canEscrow) ? (
        <div className="amkt-hire-tabs" role="tablist" aria-label="Hire method">
          {canX402 ? (
            <button
              aria-selected={hireMode === 'x402'}
              className={hireMode === 'x402' ? 'is-active' : undefined}
              onClick={() => setHireMode('x402')}
              type="button"
            >
              {sameOrgFleetHire ? 'Permit2' : 'x402'}
            </button>
          ) : null}
          {canEscrow ? (
            <button
              aria-selected={hireMode === 'escrow'}
              className={hireMode === 'escrow' ? 'is-active' : undefined}
              onClick={() => setHireMode('escrow')}
              type="button"
            >
              Escrow
            </button>
          ) : null}
        </div>
      ) : (
        <p className="amkt-hire-copy">This listing has no hire rails configured.</p>
      )}

      {hireMode === 'x402' && canX402 ? (
        <div className="amkt-hire-body">
          {needsAuthorize ? (
            <form action={authFormAction} className="amkt-hire-form">
              <p>Authorize this payTo once for your org before micropay.</p>
              <input name="chain" type="hidden" value={listing.chain} />
              <input name="address" type="hidden" value={listing.providerAddress ?? ''} />
              <input name="label" type="hidden" value={listing.name} />
              <label className="amkt-hire-confirm">
                <input name="confirmed" type="checkbox" value="true" required />
                <span>Allow micropays to this destination</span>
              </label>
              {authState.error !== undefined ? (
                <LinkedActionMessage
                  className="form-error"
                  links={guideLinksForMessage(orgSlug, clientAgentId, authState.error)}
                  message={authState.error}
                />
              ) : null}
              {authState.ok !== undefined ? <p className="amkt-hire-ok" role="status">{authState.ok}</p> : null}
              <button className="amkt-hire-secondary" disabled={authPending} type="submit">
                {authPending ? 'Authorizing…' : 'Authorize'}
              </button>
            </form>
          ) : null}

          <form action={x402FormAction} className="amkt-hire-form">
            <input name="listingId" type="hidden" value={listing.id} />
            {payerSelect}
            {clientAgentId.length > 0 ? (
              <p className="amkt-hire-hint">
                Need a credential?{' '}
                <Link href={agentCredentialsHref(orgSlug, clientAgentId)}>Open Credentials</Link>
              </p>
            ) : null}
            {needsAuthorize ? (
              <p className="amkt-hire-hint">Authorize above to enable payment.</p>
            ) : null}
            {x402State.error !== undefined ? (
              <LinkedActionMessage
                className="form-error"
                links={guideLinksForMessage(orgSlug, clientAgentId, x402State.error)}
                message={x402State.error}
              />
            ) : null}
            {x402State.ok !== undefined ? (
              <p className="amkt-hire-ok" role="status">
                {x402State.ok}{' '}
                <Link href={purchasesHref}>View purchases</Link>
              </p>
            ) : null}
            <button className="amkt-hire-cta" disabled={x402Pending || needsAuthorize} type="submit">
              {x402Pending
                ? 'Paying…'
                : sameOrgFleetHire
                  ? 'Pay with Permit2'
                  : 'Pay with x402'}
            </button>
          </form>
        </div>
      ) : null}

      {hireMode === 'escrow' && canEscrow ? (
        payerClients.length === 0 ? (
          <div className="amkt-hire-body">
            <p className="amkt-hire-copy">
              You cannot escrow-hire an agent with itself as payer. Create another agent, fund it, then retry.
            </p>
            <Link className="amkt-hire-secondary" href={agentsListHref(orgSlug)}>Open Agents</Link>
          </div>
        ) : (
          <form action={escrowFormAction} className="amkt-hire-form amkt-hire-body">
            <input name="providerAddress" type="hidden" value={listing.providerAddress ?? ''} />
            {listing.agentId !== null ? (
              <input name="providerAgentId" type="hidden" value={listing.agentId} />
            ) : null}
            <input name="chain" type="hidden" value={listing.chain} />
            {payerSelect}
            <p className="amkt-hire-hint">
              Payer must already hold Arc USDC on Fund.
            </p>
            <div className="amkt-hire-grid">
              <label className="amkt-hire-field">
                <span>Budget (USDC)</span>
                <input defaultValue="1.00" inputMode="decimal" name="budgetUsdc" required />
              </label>
              <label className="amkt-hire-field">
                <span>Expires (hours)</span>
                <input defaultValue="72" inputMode="numeric" name="expiresInHours" required />
              </label>
            </div>
            <input name="description" type="hidden" value={`Marketplace hire: ${listing.name}`} />
            {escrowState.error !== undefined ? (
              <LinkedActionMessage
                className="form-error"
                links={guideLinksForMessage(orgSlug, clientAgentId, escrowState.error)}
                message={escrowState.error}
              />
            ) : null}
            {escrowState.ok !== undefined ? (
              <p className="amkt-hire-ok" role="status">
                {escrowState.ok}{' '}
                <Link href={purchasesHref}>View purchases</Link>
              </p>
            ) : null}
            <button className="amkt-hire-cta" disabled={escrowPending} type="submit">
              {escrowPending ? 'Creating…' : 'Create escrow job'}
            </button>
          </form>
        )
      ) : null}
    </div>
  );
}
