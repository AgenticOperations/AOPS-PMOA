'use client';

import { useEffect, useMemo, useState, useActionState } from 'react';
import Link from 'next/link';
import { IconCube } from '@tabler/icons-react';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import {
  LinkedActionMessage,
  activityEscrowHref,
  agentCredentialsHref,
  agentsListHref,
  empowerAccessHref,
  fundHref,
  type ActionNavLink,
} from '@/components/ui/LinkedActionMessage';
import type { MarketplaceHireActionState } from '@/app/actions/payments';
import type { MarketplaceListingRecord } from '@/lib/server/payments-client';

type ClientOption = { readonly id: string; readonly name: string };

type MarketplaceBrowseProps = {
  readonly orgSlug: string;
  readonly buyerOrgId: string;
  readonly listings: readonly MarketplaceListingRecord[];
  readonly clients: readonly ClientOption[];
  readonly authorizeAction: (formData: FormData) => Promise<MarketplaceHireActionState>;
  readonly hireX402Action: (formData: FormData) => Promise<MarketplaceHireActionState>;
  readonly hireEscrowAction: (formData: FormData) => Promise<MarketplaceHireActionState>;
  readonly authorizedAddresses: ReadonlySet<string>;
  readonly initialListingId?: string | null | undefined;
};

type FormState = {
  readonly error?: string | undefined;
  readonly ok?: string | undefined;
  readonly jobId?: string | undefined;
};
type KindFilter = 'all' | 'service' | 'agent';

function addressKey(chain: string, address: string): string {
  return `${chain}:${address.toLowerCase()}`;
}

function shortEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url.length > 48 ? `${url.slice(0, 48)}…` : url;
  }
}

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

export function MarketplaceBrowse({
  orgSlug,
  buyerOrgId,
  listings,
  clients,
  authorizeAction,
  hireX402Action,
  hireEscrowAction,
  authorizedAddresses,
  initialListingId = null,
}: MarketplaceBrowseProps) {
  const [kind, setKind] = useState<KindFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(initialListingId);
  const [query, setQuery] = useState('');
  const [hireMode, setHireMode] = useState<'x402' | 'escrow'>('x402');
  const [clientAgentId, setClientAgentId] = useState(clients[0]?.id ?? '');

  useEffect(() => {
    if (initialListingId === null) return;
    if (listings.some((item) => item.id === initialListingId)) {
      setSelectedId(initialListingId);
    }
  }, [initialListingId, listings]);

  const escrowPayerClients = useMemo(() => {
    const listing = listings.find((item) => item.id === selectedId) ?? null;
    if (listing === null || listing.kind !== 'agent' || listing.agentId === null) return clients;
    // ERC-8183 forbids client == provider — hide the listed agent as payer for escrow.
    return clients.filter((client) => client.id !== listing.agentId);
  }, [clients, listings, selectedId]);

  const payerClients = hireMode === 'escrow' ? escrowPayerClients : clients;

  useEffect(() => {
    if (payerClients.length === 0) {
      setClientAgentId('');
      return;
    }
    if (!payerClients.some((client) => client.id === clientAgentId)) {
      setClientAgentId(payerClients[0]?.id ?? '');
    }
  }, [clientAgentId, payerClients]);

  const counts = useMemo(() => ({
    all: listings.length,
    service: listings.filter((item) => item.kind === 'service').length,
    agent: listings.filter((item) => item.kind === 'agent').length,
  }), [listings]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return listings.filter((listing) => {
      if (kind !== 'all' && listing.kind !== kind) return false;
      if (normalized.length === 0) return true;
      return `${listing.name} ${listing.description} ${listing.endpointUrl} ${listing.category}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [kind, listings, query]);

  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId === null || !visible.some((item) => item.id === selectedId)) {
      setSelectedId(visible[0]?.id ?? null);
    }
  }, [selectedId, visible]);

  const selected = visible.find((listing) => listing.id === selectedId) ?? null;

  useEffect(() => {
    if (selected === null) return;
    if (selected.rails.includes('x402')) setHireMode('x402');
    else if (selected.rails.includes('escrow')) setHireMode('escrow');
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reset hire mode when listing changes

  const [authState, authFormAction, authPending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      try {
        const result = await authorizeAction(formData);
        if (result.error !== undefined) return result;
        return result.ok !== undefined ? result : { ok: 'Destination authorized.' };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Authorization failed.' };
      }
    },
    {},
  );

  const [x402State, x402FormAction, x402Pending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      try {
        const result = await hireX402Action(formData);
        if (result.error !== undefined) return result;
        return result.ok !== undefined ? result : { ok: 'Payment submitted.' };
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
        if (result.error !== undefined) return result;
        if (result.ok !== undefined) return result;
        if (result.jobId !== undefined) {
          return {
            ok: `Escrow job ${result.jobId} created — open Activity to track fund/submit/complete.`,
            jobId: result.jobId,
          };
        }
        return { error: 'Escrow hire failed.' };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Hire failed.' };
      }
    },
    {},
  );

  const selectedAuthorized = selected !== null && (
    (selected.orgId === buyerOrgId && selected.agentId !== null)
    || (selected.providerAddress !== null
      && authorizedAddresses.has(addressKey(selected.chain, selected.providerAddress)))
    || selected.destinationAuthorized === true
  );
  // Cross-org / external sellers need an explicit payTo authorize once.
  // Same-org fleet agents skip it — hire auto-allowlists via resolveAgentPayee.
  const needsAuthorize = selected !== null
    && selected.providerAddress !== null
    && !(selected.orgId === buyerOrgId && selected.agentId !== null)
    && !selectedAuthorized;
  const canX402 = selected?.rails.includes('x402') === true;
  const canEscrow = selected?.rails.includes('escrow') === true && selected.providerAddress !== null;
  const sameOrgFleetHire = selected !== null
    && selected.agentId !== null
    && selected.orgId === buyerOrgId;

  const payerSelect = (
    <label>
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
    <div className="marketplace-page">
      <header className="marketplace-header">
        <div>
          <p className="marketplace-eyebrow">Discover</p>
          <h1>Marketplace</h1>
          <p>Hire published agents or demo x402 services from your org.</p>
        </div>
      </header>

      <div className="marketplace-toolbar">
        <div className="marketplace-kind-tabs" role="tablist" aria-label="Listing type">
          {(
            [
              ['all', 'All', counts.all],
              ['service', 'Services', counts.service],
              ['agent', 'Agents', counts.agent],
            ] as const
          ).map(([value, label, count]) => (
            <button
              aria-selected={kind === value}
              className={kind === value ? 'is-active' : undefined}
              key={value}
              onClick={() => setKind(value)}
              type="button"
            >
              {label}
              <span>{count}</span>
            </button>
          ))}
        </div>
        <label className="marketplace-search">
          <span className="sr-only">Search</span>
          <input
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search by name"
            value={query}
          />
        </label>
      </div>

      <div className="marketplace-layout">
        <section className="marketplace-results" aria-label="Listings">
          {visible.length === 0 ? (
            <div className="marketplace-empty-panel">
              <strong>Nothing here yet</strong>
              <p>
                {kind === 'agent' ? (
                  <>
                    Publish an agent endpoint to list it for hire from{' '}
                    <Link className="action-nav-link" href={agentsListHref(orgSlug)}>Agents</Link>
                    .
                  </>
                ) : (
                  'No matching listings. Try All or clear search.'
                )}
              </p>
            </div>
          ) : (
            <ul className="marketplace-list">
              {visible.map((listing) => {
                const active = selected?.id === listing.id;
                return (
                  <li key={listing.id}>
                    <button
                      aria-current={active ? 'true' : undefined}
                      className={active ? 'marketplace-row is-selected' : 'marketplace-row'}
                      onClick={() => setSelectedId(listing.id)}
                      type="button"
                    >
                      <span className="marketplace-row-mark">
                        {listing.kind === 'agent' && listing.agentId !== null ? (
                          <AgentAvatar agentId={listing.agentId} name={listing.name} size="sm" />
                        ) : (
                          <span className="marketplace-service-mark" aria-hidden="true">
                            <IconCube size={18} stroke={1.6} />
                          </span>
                        )}
                      </span>
                      <div className="marketplace-row-main">
                        <div className="marketplace-row-title">
                          <strong>{listing.name}</strong>
                          <span className={`marketplace-kind is-${listing.kind}`}>
                            {listing.kind === 'agent' ? 'Agent' : 'Service'}
                          </span>
                        </div>
                        <p>{listing.description}</p>
                      </div>
                      <div className="marketplace-row-side">
                        {listing.priceHint !== null ? (
                          <span className="marketplace-price">{listing.priceHint}</span>
                        ) : (
                          <span className="marketplace-price is-muted">Quote on hire</span>
                        )}
                        <span className="marketplace-chain">{listing.chain}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="marketplace-detail" aria-label="Hire">
          {selected === null ? (
            <div className="marketplace-empty-panel">
              <strong>Select a listing</strong>
              <p>Details and hire actions appear here.</p>
            </div>
          ) : (
            <>
              <div className="marketplace-detail-head">
                <div className="marketplace-detail-identity">
                  {selected.kind === 'agent' && selected.agentId !== null ? (
                    <AgentAvatar agentId={selected.agentId} name={selected.name} size="md" />
                  ) : (
                    <span className="marketplace-service-mark is-lg" aria-hidden="true">
                      <IconCube size={22} stroke={1.6} />
                    </span>
                  )}
                  <div>
                    <span className={`marketplace-kind is-${selected.kind}`}>
                      {selected.kind === 'agent' ? 'Agent' : 'Service'}
                    </span>
                    <h2>{selected.name}</h2>
                  </div>
                </div>
                <p>{selected.description}</p>
              </div>

              <div className="marketplace-facts">
                <div>
                  <span>Network</span>
                  <strong>{selected.chain}</strong>
                </div>
                <div>
                  <span>Price</span>
                  <strong>{selected.priceHint ?? 'On hire'}</strong>
                </div>
                <div className="marketplace-facts-wide">
                  <span>Endpoint</span>
                  <strong title={selected.endpointUrl}>{shortEndpoint(selected.endpointUrl)}</strong>
                </div>
              </div>

              {clients.length === 0 ? (
                <div className="marketplace-empty-panel">
                  <strong>No payer agent</strong>
                  <p>
                    Create an agent on{' '}
                    <Link className="action-nav-link" href={agentsListHref(orgSlug)}>Agents</Link>
                    , then open that agent and issue a credential on its Credentials tab.
                  </p>
                </div>
              ) : (
                <div className="marketplace-hire">
                  {(canX402 || canEscrow) ? (
                    <div className="marketplace-hire-tabs" role="tablist" aria-label="Hire method">
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
                  ) : null}

                  {hireMode === 'x402' && canX402 ? (
                    <div className="marketplace-hire-body">
                      {needsAuthorize ? (
                        <form action={authFormAction} className="marketplace-hire-form">
                          <p>Authorize this payTo once for your org before micropay.</p>
                          <input name="chain" type="hidden" value={selected.chain} />
                          <input name="address" type="hidden" value={selected.providerAddress ?? ''} />
                          <input name="label" type="hidden" value={selected.name} />
                          <label className="marketplace-confirm">
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
                          {authState.ok !== undefined ? <p className="marketplace-ok" role="status">{authState.ok}</p> : null}
                          <button className="marketplace-btn" disabled={authPending} type="submit">
                            {authPending ? 'Authorizing…' : 'Authorize'}
                          </button>
                        </form>
                      ) : null}

                      <form action={x402FormAction} className="marketplace-hire-form">
                        <input name="listingId" type="hidden" value={selected.id} />
                        {payerSelect}
                        {clientAgentId.length > 0 ? (
                          <p className="marketplace-hint">
                            Need a credential? Open{' '}
                            <Link className="action-nav-link" href={agentCredentialsHref(orgSlug, clientAgentId)}>
                              Credentials
                            </Link>
                            {' '}for this paying agent.
                          </p>
                        ) : null}
                        {needsAuthorize ? (
                          <p className="marketplace-hint">Authorize above to enable payment.</p>
                        ) : null}
                        {x402State.error !== undefined ? (
                          <LinkedActionMessage
                            className="form-error"
                            links={guideLinksForMessage(orgSlug, clientAgentId, x402State.error)}
                            message={x402State.error}
                          />
                        ) : null}
                        {x402State.ok !== undefined ? <p className="marketplace-ok" role="status">{x402State.ok}</p> : null}
                        <button className="marketplace-btn marketplace-btn-primary" disabled={x402Pending || needsAuthorize} type="submit">
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
                      <div className="marketplace-hire-body marketplace-empty-panel">
                        <strong>Need a different paying agent</strong>
                        <p>
                          You cannot escrow-hire an agent with itself as payer. Create or pick another agent on{' '}
                          <Link className="action-nav-link" href={agentsListHref(orgSlug)}>Agents</Link>
                          , fund it on{' '}
                          <Link className="action-nav-link" href={fundHref(orgSlug)}>Fund</Link>
                          , then retry.
                        </p>
                      </div>
                    ) : (
                      <form action={escrowFormAction} className="marketplace-hire-form marketplace-hire-body">
                        <input name="providerAddress" type="hidden" value={selected.providerAddress ?? ''} />
                        {selected.agentId !== null ? (
                          <input name="providerAgentId" type="hidden" value={selected.agentId} />
                        ) : null}
                        <input name="chain" type="hidden" value={selected.chain} />
                        {payerSelect}
                        <p className="marketplace-hint">
                          Payer must already hold Arc USDC on Fund (the listed agent is excluded — it cannot pay itself).
                        </p>
                        <div className="marketplace-hire-grid">
                          <label>
                            <span>Budget (USDC)</span>
                            <input defaultValue="1.00" inputMode="decimal" name="budgetUsdc" required />
                          </label>
                          <label>
                            <span>Expires (hours)</span>
                            <input defaultValue="72" inputMode="numeric" name="expiresInHours" required />
                          </label>
                        </div>
                        <input name="description" type="hidden" value={`Marketplace hire: ${selected.name}`} />
                        {escrowState.error !== undefined ? (
                          <LinkedActionMessage
                            className="form-error"
                            links={guideLinksForMessage(orgSlug, clientAgentId, escrowState.error)}
                            message={escrowState.error}
                          />
                        ) : null}
                        {escrowState.ok !== undefined ? (
                          <LinkedActionMessage
                            className="marketplace-ok"
                            links={guideLinksForMessage(orgSlug, clientAgentId, escrowState.ok)}
                            message={escrowState.ok}
                            role="status"
                          />
                        ) : null}
                        <button className="marketplace-btn marketplace-btn-primary" disabled={escrowPending} type="submit">
                          {escrowPending ? 'Creating…' : 'Create escrow job'}
                        </button>
                      </form>
                    )
                  ) : null}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
