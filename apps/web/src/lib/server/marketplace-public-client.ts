import 'server-only';
import { readWebEnv } from '../env';

export type PublicMarketplaceListing = {
  readonly id: string;
  readonly kind: 'agent' | 'service';
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly endpointUrl: string;
  readonly chain: string;
  readonly priceHint: string | null;
  readonly providerAddress: string | null;
  readonly rails: readonly ('x402' | 'escrow')[];
  readonly orgId: string | null;
  readonly agentId: string | null;
  readonly identityStatus: 'pending' | 'registered' | 'failed' | null;
  readonly identityTokenId: string | null;
};

export type MarketplaceActivityPoint = {
  readonly day: string;
  readonly settledUsdc: string;
  readonly completedJobs: number;
  readonly reputationEvents: number;
};

export type MarketplaceActivityEvent = {
  readonly id: string;
  readonly day: string;
  readonly kind: 'fleet_hire' | 'x402' | 'escrow';
  readonly label: string;
  readonly amountUsdc: string;
  readonly chain: string;
  readonly txHash: string | null;
  readonly explorerUrl: string | null;
  readonly occurredAt: string;
};

export type MarketplaceListingActivity = {
  readonly listingId: string;
  readonly agentId: string | null;
  readonly providerAddress: string | null;
  readonly reputationScore: number;
  readonly reputationEvents: number;
  readonly completedJobs: number;
  readonly rejectedJobs: number;
  readonly settledUsdc: string;
  readonly series: readonly MarketplaceActivityPoint[];
  readonly recentEvents: readonly MarketplaceActivityEvent[];
};

type ApiErrorBody = {
  readonly error?: string;
  readonly message?: string;
};

export class MarketplacePublicApiError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? body.error ?? `Marketplace API request failed with ${status}`);
    this.name = 'MarketplacePublicApiError';
    this.code = body.error ?? null;
    this.status = status;
  }
}

function apiBaseUrl(): string {
  return readWebEnv().AGENTOPS_API_BASE_URL.replace(/\/$/, '');
}

/** Public catalog — no session cookie (changelog pattern). */
async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, { cache: 'no-store' });
  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = {};
    }
    throw new MarketplacePublicApiError(response.status, body);
  }
  return (await response.json()) as T;
}

export async function listPublicMarketplaceListings(input?: {
  readonly chain?: string | undefined;
  readonly kind?: 'all' | 'agent' | 'service' | undefined;
}): Promise<readonly PublicMarketplaceListing[]> {
  const params = new URLSearchParams();
  if (input?.chain !== undefined) params.set('chain', input.chain);
  if (input?.kind !== undefined && input.kind !== 'all') params.set('kind', input.kind);
  const query = params.toString();
  const body = await apiFetch<{ readonly listings: readonly PublicMarketplaceListing[] }>(
    `/v1/marketplace/listings${query.length > 0 ? `?${query}` : ''}`,
  );
  return body.listings;
}

export async function getPublicMarketplaceListing(
  listingId: string,
): Promise<PublicMarketplaceListing> {
  const body = await apiFetch<{ readonly listing: PublicMarketplaceListing }>(
    `/v1/marketplace/listings/${encodeURIComponent(listingId)}`,
  );
  return body.listing;
}

export async function getPublicMarketplaceActivity(
  listingId: string,
  days = 30,
): Promise<MarketplaceListingActivity> {
  const body = await apiFetch<{ readonly activity: MarketplaceListingActivity }>(
    `/v1/marketplace/listings/${encodeURIComponent(listingId)}/activity?days=${days}`,
  );
  return body.activity;
}
