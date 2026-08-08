'use client';

import { useActionState } from 'react';

export type HireListingOption = {
  readonly agentId: string;
  readonly name: string;
  readonly publicEndpointUrl: string;
  readonly providerAddress: string | null;
  readonly identityStatus: string | null;
  readonly chain: string;
};

export type HireClientOption = {
  readonly id: string;
  readonly name: string;
};

type HireFromListingPanelProps = {
  readonly listings: readonly HireListingOption[];
  readonly clients: readonly HireClientOption[];
  readonly hireAction: (formData: FormData) => Promise<void>;
};

type FormState = { readonly error?: string; readonly ok?: string };

export function HireFromListingPanel({ listings, clients, hireAction }: HireFromListingPanelProps) {
  const [state, formAction, pending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      try {
        await hireAction(formData);
        return { ok: 'ERC-8183 escrow job created. Fund and complete from the escrow lifecycle.' };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Hire failed.' };
      }
    },
    {},
  );

  const hireable = listings.filter((listing) => listing.providerAddress !== null);

  return (
    <section aria-labelledby="hire-published-title" className="treasury-table-section">
      <div className="treasury-section-heading">
        <div>
          <h2 id="hire-published-title">Hire published agent</h2>
          <p>
            Discrete jobs use our ERC-8183 escrow (not Circle arc-escrow Refund Protocol).
            For x402 micropayments against the listing URL, use MCP or the thin runtime client.
          </p>
        </div>
      </div>

      {hireable.length === 0 || clients.length === 0 ? (
        <p className="treasury-empty-hint">
          {clients.length === 0
            ? 'Create a client agent with payment access first.'
            : 'No published listings with a provider wallet yet. Publish an endpoint and provision the seller wallet.'}
        </p>
      ) : (
        <form action={formAction} className="focus-form hire-listing-form">
          <label>
            <span>Provider (published)</span>
            <select name="providerAgentId" required defaultValue={hireable[0]?.agentId}>
              {hireable.map((listing) => (
                <option key={listing.agentId} value={listing.agentId}>
                  {listing.name}
                  {listing.identityStatus === 'registered' ? ' · 8004' : ''}
                  {' · '}
                  {listing.publicEndpointUrl}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Client (payer)</span>
            <select name="clientAgentId" required defaultValue={clients[0]?.id}>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          <div className="treasury-form-grid">
            <label>
              <span>Budget (USDC)</span>
              <input defaultValue="1.00" inputMode="decimal" name="budgetUsdc" required />
            </label>
            <label>
              <span>Expires (hours)</span>
              <input defaultValue="72" inputMode="numeric" name="expiresInHours" required />
            </label>
          </div>
          <input name="chain" type="hidden" value="arc" />
          <label>
            <span>Description</span>
            <input name="description" placeholder="Job brief (on-chain description)" />
          </label>
          {state.error !== undefined ? <p className="form-error" role="alert">{state.error}</p> : null}
          {state.ok !== undefined ? <p className="agent-publish-ok" role="status">{state.ok}</p> : null}
          <button className="treasury-button treasury-button-primary" disabled={pending} type="submit">
            {pending ? 'Creating escrow job…' : 'Hire via ERC-8183'}
          </button>
        </form>
      )}
    </section>
  );
}
