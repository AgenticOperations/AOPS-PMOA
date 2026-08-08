import type pg from 'pg';
import { IdentityError } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import type { ConnectionAuthResult } from '../identity/store.js';
import type { PaymentChain, PaymentMode } from '../payments/types.js';
import { seedMarketplaceServices, seedServiceById, type MarketplaceRail } from './seed-catalog.js';

export type MarketplaceListing = {
  readonly id: string;
  readonly kind: 'agent' | 'service';
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly endpointUrl: string;
  readonly chain: PaymentChain;
  readonly priceHint: string | null;
  readonly providerAddress: string | null;
  readonly rails: readonly MarketplaceRail[];
  readonly orgId: string | null;
  readonly agentId: string | null;
  readonly identityStatus: 'pending' | 'registered' | 'failed' | null;
  readonly identityTokenId: string | null;
};

type PublishedAgentRow = {
  readonly id: string;
  readonly org_id: string;
  readonly name: string;
  readonly status: string;
  readonly metadata: unknown;
  readonly description: string;
  readonly wallet_address: string | null;
  readonly wallet_chain: PaymentChain | null;
  readonly identity_status: 'pending' | 'registered' | 'failed' | null;
  readonly identity_token_id: string | null;
};

function metadataObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringMeta(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function agentListingId(agentId: string): string {
  return `agent_${agentId}`;
}

function parseListingId(listingId: string): { readonly kind: 'agent' | 'service'; readonly raw: string } {
  if (listingId.startsWith('agent_')) {
    return { kind: 'agent', raw: listingId.slice('agent_'.length) };
  }
  if (listingId.startsWith('svc_')) {
    return { kind: 'service', raw: listingId };
  }
  throw new IdentityError('listing_not_found', 404, 'Marketplace listing was not found.');
}

/**
 * Cross-org marketplace: curated seed services + any published agent (public_endpoint_url set).
 */
export type MarketplaceListingWithAuth = MarketplaceListing & {
  readonly destinationAuthorized: boolean;
};

/** Map fleet seed service ids → agent display names resetDemo / K.4 uses. */
const FLEET_SEED_AGENT_NAMES: Readonly<Record<string, string>> = {
  svc_demo_data_fetcher: 'DataFetcher',
  svc_demo_analyst: 'Analyst',
  svc_demo_writer: 'Writer',
  svc_demo_senior_reviewer: 'SeniorReviewer',
};

/**
 * When the buyer's org already has the fleet agents, attach their wallet +
 * agentId onto the matching seed listing so marketplace hire can use Lane 2
 * (Permit2 intra-fleet) instead of failing the payTo allowlist on a null
 * providerAddress.
 */
async function enrichFleetSeedListings(
  pool: pg.Pool,
  listings: readonly MarketplaceListing[],
  input: { readonly mode: PaymentMode; readonly buyerOrgId: string },
): Promise<readonly MarketplaceListing[]> {
  const neededNames = [...new Set(
    listings
      .map((listing) => FLEET_SEED_AGENT_NAMES[listing.id])
      .filter((name): name is string => name !== undefined),
  )];
  if (neededNames.length === 0) return listings;

  const result = await pool.query<{
    id: string;
    name: string;
    wallet_address: string | null;
    chain: string;
  }>(
    `SELECT a.id, a.name, w.address AS wallet_address, w.chain
       FROM agents a
       LEFT JOIN agent_chain_wallets w
         ON w.agent_id = a.id AND w.mode = $2 AND w.status = 'active'
      WHERE a.org_id = $1
        AND a.status NOT IN ('deactivated', 'retired')
        AND a.name = ANY($3::text[])`,
    [input.buyerOrgId, input.mode, neededNames],
  );

  return listings.map((listing) => {
    const fleetName = FLEET_SEED_AGENT_NAMES[listing.id];
    if (fleetName === undefined) return listing;
    const matches = result.rows.filter((row) => row.name === fleetName);
    if (matches.length === 0) return listing;
    const onListingChain = matches.find((row) => row.chain === listing.chain && row.wallet_address !== null)
      ?? matches.find((row) => row.wallet_address !== null)
      ?? matches[0];
    if (onListingChain === undefined) return listing;
    const providerAddress = onListingChain.wallet_address ?? listing.providerAddress;
    const rails: MarketplaceRail[] = providerAddress === null ? ['x402'] : ['x402', 'escrow'];
    return {
      ...listing,
      orgId: input.buyerOrgId,
      agentId: onListingChain.id,
      providerAddress,
      rails,
    };
  });
}

export async function listMarketplaceListings(
  pool: pg.Pool,
  input: {
    readonly mode: PaymentMode;
    readonly chain?: PaymentChain | undefined;
    readonly buyerOrgId?: string | undefined;
  },
): Promise<readonly MarketplaceListingWithAuth[]> {
  let seed = seedMarketplaceServices()
    .filter((service) => input.chain === undefined || service.chain === input.chain)
    .map((service): MarketplaceListing => ({
      id: service.id,
      kind: 'service',
      name: service.name,
      category: service.category,
      description: service.description,
      endpointUrl: service.endpointUrl,
      chain: service.chain,
      priceHint: service.priceHint,
      providerAddress: service.providerAddress,
      rails: service.rails,
      orgId: null,
      agentId: null,
      identityStatus: null,
      identityTokenId: null,
    }));

  if (input.buyerOrgId !== undefined) {
    seed = [...await enrichFleetSeedListings(pool, seed, {
      mode: input.mode,
      buyerOrgId: input.buyerOrgId,
    })];
  }

  const agentResult = await pool.query<PublishedAgentRow>(
    `SELECT DISTINCT ON (a.id)
            a.id, a.org_id, a.name, a.status, a.metadata, a.description,
            w.address AS wallet_address,
            w.chain AS wallet_chain,
            i.status AS identity_status,
            i.token_id::text AS identity_token_id
       FROM agents a
       LEFT JOIN LATERAL (
         SELECT address, chain
           FROM agent_chain_wallets
          WHERE agent_id = a.id AND mode = $1 AND status = 'active'
            AND ($2::text IS NULL OR chain = $2)
          ORDER BY CASE chain WHEN 'arc' THEN 0 WHEN 'base' THEN 1 ELSE 2 END, created_at ASC
          LIMIT 1
       ) w ON true
       LEFT JOIN agent_onchain_identities i
         ON i.agent_id = a.id AND i.mode = $1 AND i.chain = coalesce(w.chain, coalesce($2, 'arc'))
      WHERE a.status <> 'deactivated'
        AND coalesce(a.metadata->>'public_endpoint_url', '') <> ''
      ORDER BY a.id, a.name ASC`,
    [input.mode, input.chain ?? null],
  );

  const agents: MarketplaceListing[] = agentResult.rows.flatMap((row) => {
    const metadata = metadataObject(row.metadata);
    const endpointUrl = stringMeta(metadata, 'public_endpoint_url');
    if (endpointUrl === null) return [];
    const providerAddress = row.wallet_address;
    const chain = (row.wallet_chain ?? input.chain ?? 'arc') as PaymentChain;
    if (input.chain !== undefined && chain !== input.chain) return [];
    const rails: MarketplaceRail[] = providerAddress === null ? ['x402'] : ['x402', 'escrow'];
    return [{
      id: agentListingId(row.id),
      kind: 'agent' as const,
      name: row.name,
      category: 'Agents',
      description: row.description.trim().length > 0
        ? row.description
        : 'Published AgentOps agent with a public hireable endpoint.',
      endpointUrl,
      chain,
      priceHint: null,
      providerAddress,
      rails,
      orgId: row.org_id,
      agentId: row.id,
      identityStatus: row.identity_status,
      identityTokenId: row.identity_token_id,
    }];
  });

  agents.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const combined = [...seed, ...agents];
  if (input.buyerOrgId === undefined) {
    return combined.map((listing) => ({ ...listing, destinationAuthorized: false }));
  }

  const allowlist = await pool.query<{ chain: string; address: string }>(
    `SELECT chain, address FROM payment_destination_allowlist
      WHERE org_id = $1 AND status = 'active'`,
    [input.buyerOrgId],
  );
  const allowed = new Set(
    allowlist.rows.map((row) => `${row.chain}:${row.address.toLowerCase()}`),
  );
  return combined.map((listing) => ({
    ...listing,
    // Same-org fleet agents are auto-allowlisted at hire via resolveAgentPayee.
    destinationAuthorized: listing.orgId === input.buyerOrgId && listing.agentId !== null
      ? true
      : listing.providerAddress === null
        ? false
        : allowed.has(`${listing.chain}:${listing.providerAddress.toLowerCase()}`),
  }));
}

export async function getMarketplaceListing(
  pool: pg.Pool,
  listingId: string,
  input: { readonly mode: PaymentMode; readonly buyerOrgId?: string | undefined },
): Promise<MarketplaceListing> {
  const parsed = parseListingId(listingId);
  if (parsed.kind === 'service') {
    const service = seedServiceById(parsed.raw);
    if (service === null) {
      throw new IdentityError('listing_not_found', 404, 'Marketplace listing was not found.');
    }
    const base: MarketplaceListing = {
      id: service.id,
      kind: 'service',
      name: service.name,
      category: service.category,
      description: service.description,
      endpointUrl: service.endpointUrl,
      chain: service.chain,
      priceHint: service.priceHint,
      providerAddress: service.providerAddress,
      rails: service.rails,
      orgId: null,
      agentId: null,
      identityStatus: null,
      identityTokenId: null,
    };
    if (input.buyerOrgId === undefined) return base;
    const enriched = await enrichFleetSeedListings(pool, [base], {
      mode: input.mode,
      buyerOrgId: input.buyerOrgId,
    });
    return enriched[0] ?? base;
  }

  const result = await pool.query<PublishedAgentRow>(
    `SELECT a.id, a.org_id, a.name, a.status, a.metadata, a.description,
            w.address AS wallet_address,
            w.chain AS wallet_chain,
            i.status AS identity_status,
            i.token_id::text AS identity_token_id
       FROM agents a
       LEFT JOIN LATERAL (
         SELECT address, chain
           FROM agent_chain_wallets
          WHERE agent_id = a.id AND mode = $2 AND status = 'active'
          ORDER BY CASE chain WHEN 'arc' THEN 0 WHEN 'base' THEN 1 ELSE 2 END, created_at ASC
          LIMIT 1
       ) w ON true
       LEFT JOIN agent_onchain_identities i
         ON i.agent_id = a.id AND i.mode = $2 AND i.chain = coalesce(w.chain, 'arc')
      WHERE a.id = $1
        AND a.status <> 'deactivated'
        AND coalesce(a.metadata->>'public_endpoint_url', '') <> ''
      LIMIT 1`,
    [parsed.raw, input.mode],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new IdentityError('listing_not_found', 404, 'Marketplace listing was not found.');
  }
  const metadata = metadataObject(row.metadata);
  const endpointUrl = stringMeta(metadata, 'public_endpoint_url');
  if (endpointUrl === null) {
    throw new IdentityError('listing_not_found', 404, 'Marketplace listing was not found.');
  }
  const providerAddress = row.wallet_address;
  const chain = (row.wallet_chain ?? 'arc') as PaymentChain;
  return {
    id: agentListingId(row.id),
    kind: 'agent',
    name: row.name,
    category: 'Agents',
    description: row.description.trim().length > 0
      ? row.description
      : 'Published AgentOps agent with a public hireable endpoint.',
    endpointUrl,
    chain,
    priceHint: null,
    providerAddress,
    rails: providerAddress === null ? ['x402'] : ['x402', 'escrow'],
    orgId: row.org_id,
    agentId: row.id,
    identityStatus: row.identity_status,
    identityTokenId: row.identity_token_id,
  };
}

/**
 * Explicit operator allowlist for marketplace x402 payTo (no escrow history required).
 * Does not open Permit2 delegation — micropay only needs the destination checkmark.
 */
export async function authorizeMarketplaceDestination(
  pool: pg.Pool,
  input: {
    readonly orgId: string;
    readonly chain: PaymentChain;
    readonly address: string;
    readonly label: string;
    readonly approvedBy: string;
  },
): Promise<{ readonly allowlistId: string; readonly alreadyAuthorized: boolean }> {
  const existing = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM payment_destination_allowlist
      WHERE org_id = $1 AND chain = $2 AND lower(address) = lower($3)`,
    [input.orgId, input.chain, input.address],
  );
  const row = existing.rows[0];
  if (row !== undefined && row.status === 'active') {
    return { allowlistId: row.id, alreadyAuthorized: true };
  }

  if (row !== undefined && row.status === 'revoked') {
    await pool.query(
      `UPDATE payment_destination_allowlist
          SET status = 'active', approved_by = $2, label = $3
        WHERE id = $1`,
      [row.id, input.approvedBy, input.label],
    );
    return { allowlistId: row.id, alreadyAuthorized: false };
  }

  const allowlistId = prefixedId('payto');
  await pool.query(
    `INSERT INTO payment_destination_allowlist (id, org_id, chain, address, label, source, created_by, approved_by)
     VALUES ($1, $2, $3, $4, $5, 'marketplace', $6, $6)`,
    [allowlistId, input.orgId, input.chain, input.address, input.label, input.approvedBy],
  );
  return { allowlistId, alreadyAuthorized: false };
}

export async function isDestinationAuthorized(
  pool: pg.Pool,
  input: { readonly orgId: string; readonly chain: PaymentChain; readonly address: string },
): Promise<boolean> {
  const result = await pool.query<{ status: string }>(
    `SELECT status FROM payment_destination_allowlist
      WHERE org_id = $1 AND chain = $2 AND lower(address) = lower($3) AND status = 'active'`,
    [input.orgId, input.chain, input.address],
  );
  return result.rows.length > 0;
}

/** Active connection auth context for operator-driven marketplace x402 hire. */
export async function resolveClientAgentAuth(
  pool: pg.Pool,
  buyerOrgId: string,
  clientAgentId: string,
): Promise<ConnectionAuthResult> {
  const agent = await pool.query<{ id: string; org_id: string; status: string }>(
    `SELECT id, org_id, status FROM agents WHERE id = $1 AND org_id = $2`,
    [clientAgentId, buyerOrgId],
  );
  const agentRow = agent.rows[0];
  if (agentRow === undefined) {
    throw new IdentityError('agent_not_found', 404, 'Client agent was not found in this org.');
  }
  if (agentRow.status === 'deactivated' || agentRow.status === 'retired') {
    throw new IdentityError('agent_inactive', 409, 'Client agent is inactive.');
  }

  const connection = await pool.query<{ id: string }>(
    `SELECT id FROM connections
      WHERE org_id = $1 AND agent_id = $2 AND status = 'active'
      ORDER BY created_at ASC
      LIMIT 1`,
    [buyerOrgId, clientAgentId],
  );
  const connectionRow = connection.rows[0];
  if (connectionRow === undefined) {
    throw new IdentityError(
      'connection_required',
      400,
      'Client agent needs an active credential before marketplace x402 hire. Issue one on Credentials.',
    );
  }

  return {
    org_id: buyerOrgId,
    agent_id: clientAgentId,
    connection_id: connectionRow.id,
  };
}
