import type pg from 'pg';
import { getAgentOnchainIdentity } from '../identity/erc8004.js';
import { findAgentWallet } from './agent-wallets.js';
import type { PaymentChain, PaymentMode } from './types.js';

export type PublishedAgentListing = {
  readonly agentId: string;
  readonly name: string;
  readonly status: string;
  readonly publicEndpointUrl: string;
  readonly setupMode: string | null;
  readonly chain: PaymentChain;
  readonly providerAddress: string | null;
  readonly identityStatus: 'pending' | 'registered' | 'failed' | null;
  readonly identityTokenId: string | null;
};

type AgentListingRow = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly metadata: unknown;
};

function metadataObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringMeta(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Org-scoped publish directory: agents with a saved public endpoint URL.
 * Used for hire-from-listing (ERC-8183) and to surface x402 seller URLs.
 */
export async function listPublishedAgentListings(
  pool: pg.Pool,
  input: {
    readonly orgId: string;
    readonly mode: PaymentMode;
    readonly chain: PaymentChain;
  },
): Promise<readonly PublishedAgentListing[]> {
  const result = await pool.query<AgentListingRow>(
    `SELECT id, name, status, metadata
       FROM agents
      WHERE org_id = $1
        AND status <> 'deactivated'
        AND coalesce(metadata->>'public_endpoint_url', '') <> ''
      ORDER BY name ASC, id ASC`,
    [input.orgId],
  );

  const listings: PublishedAgentListing[] = [];
  for (const row of result.rows) {
    const metadata = metadataObject(row.metadata);
    const publicEndpointUrl = stringMeta(metadata, 'public_endpoint_url');
    if (publicEndpointUrl === null) continue;

    const wallet = await findAgentWallet(pool, row.id, input.mode, input.chain);
    const identity = await getAgentOnchainIdentity(pool, input.orgId, row.id, input.mode, input.chain);

    listings.push({
      agentId: row.id,
      name: row.name,
      status: row.status,
      publicEndpointUrl,
      setupMode: stringMeta(metadata, 'setup_mode'),
      chain: input.chain,
      providerAddress: wallet?.address ?? null,
      identityStatus: identity?.status ?? null,
      identityTokenId: identity?.token_id ?? null,
    });
  }
  return listings;
}
