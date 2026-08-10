/**
 * Static sample payloads for marketplace demo / fleet services.
 * Mirrors demo/agents/shared/service-payloads.mjs so Purchases can show
 * buyers what data a hired service returns without another micropayment.
 */

const FIXED_AS_OF = '2026-08-09T12:00:00.000Z';

export type MarketplaceServiceSample = {
  readonly id: string;
  readonly label: string;
  readonly payload: unknown;
};

const DATA_FETCHER_SAMPLE = {
  service: {
    id: 'datafetcher.market-snapshot',
    name: 'DataFetcher Market Snapshot',
    version: '1.2.0',
    category: 'market-data',
  },
  query: 'fleet-run',
  value: 'real-data-payload',
  topic: 'agent-to-agent USDC payments on Arc',
  asOf: FIXED_AS_OF,
  summary:
    'Live snapshot for agent-to-agent USDC payments on Arc: Arc testnet USDC agent payments are settling via Permit2 intra-fleet drawdowns and x402 exact micropays, with measurable second-hop spend between specialist agents.',
  metrics: {
    arcUsdcSpot: 1.0,
    medianIntraFleetPaymentUsdc: 0.03,
    p95SettlementLatencyMs: 1840,
    activeAgentPairs24h: 47,
    secondHopSharePct: 28.4,
    crossChainBaseHops24h: 6,
  },
  series: [
    { label: 'Permit2 drawdowns', count: 312, volumeUsdc: 9.42 },
    { label: 'x402 exact micropays', count: 88, volumeUsdc: 1.17 },
    { label: 'Base Sepolia reviews', count: 6, volumeUsdc: 0.18 },
  ],
  sources: [
    { id: 'arcscan-testnet', label: 'Arc testnet explorer samples', confidence: 0.86 },
    { id: 'agentops-activity', label: 'Org activity feed aggregates', confidence: 0.91 },
    { id: 'seed-fixture', label: 'Deterministic demo fixture', confidence: 1.0 },
  ],
  servedAt: FIXED_AS_OF,
} as const;

const ANALYST_SAMPLE = {
  service: {
    id: 'analyst.a2a-brief',
    name: 'Analyst A2A Brief',
    version: '1.1.0',
    category: 'analysis',
  },
  query: 'fleet-run',
  topic: 'agent-to-agent USDC payments on Arc',
  analysis:
    'Analysis of "real-data-payload": agent-to-agent USDC payments on Arc shows healthy fleet velocity. Median intra-fleet payment 0.03 USDC with 28.4% second-hop share — within expected range for a governed multi-agent economy.',
  insights: [
    {
      id: 'rail-mix',
      headline: 'Permit2 dominates same-org hires',
      detail:
        'Lane 2 Permit2 drawdowns carry most volume; x402 remains the right rail for external micropays and fixtures.',
    },
    {
      id: 'second-hop',
      headline: 'Specialists are both buyers and sellers',
      detail:
        'Analyst→DataFetcher mid-task payments prove real agent-to-agent commerce, not hub-only fan-out.',
    },
  ],
  riskFlags: [] as const,
  sourcedFrom: {
    agent: 'DataFetcher',
    txHash: null,
    serviceId: 'datafetcher.market-snapshot',
  },
  asOf: FIXED_AS_OF,
  servedAt: FIXED_AS_OF,
} as const;

const WRITER_SAMPLE = {
  service: {
    id: 'writer.research-report',
    name: 'Writer Research Report',
    version: '1.0.4',
    category: 'written-report',
  },
  title: 'Research brief: agent-to-agent USDC payments on Arc',
  topic: 'agent-to-agent USDC payments on Arc',
  abstract:
    'This brief explains how agent-to-agent USDC payments work on Arc testnet under AgentOps policy: per-agent wallets, Permit2 ceilings for intra-fleet hires, x402 for external services, and a deliberate Base Sepolia review hop.',
  sections: [
    {
      heading: 'Payment rails',
      body:
        'Same-org fleet hires settle with Permit2 ceiling + drawdown (Lane 2). External paid APIs use x402 exact via Circle facilitators (Lane 1). Escrow (ERC-8183) is reserved for delivery-risk jobs.',
    },
    {
      heading: 'Control plane',
      body:
        'AgentOps evaluates policy, budgets, and approvals before settlement. Agents never hold raw spend keys in the MCP / runtime path — credentials authorize governed tools only.',
    },
  ],
  body:
    'Findings on "agent-to-agent USDC payments on Arc": Arc A2A USDC payments are production-shaped on testnet when an org control plane enforces wallets, policy, and Permit2/x402 rails.',
  citations: [
    'AgentOps change-manifest §K fleet scenario',
    'Circle Arc Permit2 / x402 surfaces',
    'DataFetcher + Analyst seeded market snapshot',
  ],
  asOf: FIXED_AS_OF,
  servedAt: FIXED_AS_OF,
} as const;

const SENIOR_REVIEWER_SAMPLE = {
  service: {
    id: 'senior-reviewer.signoff',
    name: 'SeniorReviewer Sign-off',
    version: '1.0.2',
    category: 'review',
    chain: 'base-sepolia',
  },
  title: 'fleet-run',
  verdict: 'approved',
  score: 92,
  notes:
    'Reviewed "fleet-run" — no blocking issues found. Claims about Permit2 intra-fleet, second-hop Analyst hire, and Base settlement are consistent with the attached receipts.',
  checklist: [
    { id: 'sources', label: 'Sources cited', status: 'pass' },
    { id: 'rails', label: 'Rail claims match receipts', status: 'pass' },
    { id: 'cross-chain', label: 'Base hop evidenced', status: 'pass' },
    { id: 'policy', label: 'Policy / budget caveats present', status: 'pass' },
  ],
  recommendations: [
    'Lead with the second-hop and Base explorer txs in the demo narrative.',
    'Keep Lane 1 x402 as an optional encore, not the hero path.',
  ],
  asOf: FIXED_AS_OF,
  servedAt: FIXED_AS_OF,
} as const;

const WEATHER_SAMPLE = {
  service: {
    id: 'testnet.weather',
    name: 'Testnet Weather',
    version: '1.0.0',
    category: 'data-search',
  },
  location: 'San Francisco',
  conditions: 'partly cloudy',
  temperatureC: 18,
  humidityPct: 62,
  asOf: FIXED_AS_OF,
  note: 'Deterministic x402 weather fixture for settlement demos.',
} as const;

const BY_LISTING_ID: Readonly<Record<string, MarketplaceServiceSample>> = {
  svc_demo_data_fetcher: {
    id: 'svc_demo_data_fetcher',
    label: 'DataFetcher sample',
    payload: DATA_FETCHER_SAMPLE,
  },
  svc_demo_analyst: {
    id: 'svc_demo_analyst',
    label: 'Analyst sample',
    payload: ANALYST_SAMPLE,
  },
  svc_demo_writer: {
    id: 'svc_demo_writer',
    label: 'Writer sample',
    payload: WRITER_SAMPLE,
  },
  svc_demo_senior_reviewer: {
    id: 'svc_demo_senior_reviewer',
    label: 'SeniorReviewer sample',
    payload: SENIOR_REVIEWER_SAMPLE,
  },
  svc_testnet_weather_base: {
    id: 'svc_testnet_weather_base',
    label: 'Weather sample',
    payload: WEATHER_SAMPLE,
  },
  svc_testnet_weather_gateway_base: {
    id: 'svc_testnet_weather_gateway_base',
    label: 'Weather gateway sample',
    payload: WEATHER_SAMPLE,
  },
};

type ListingSampleLookup = {
  readonly id?: string | null | undefined;
  readonly name?: string | null | undefined;
  readonly endpointUrl?: string | null | undefined;
};

function byNameOrPath(listing: ListingSampleLookup): MarketplaceServiceSample | null {
  const name = (listing.name ?? '').toLowerCase();
  const url = (listing.endpointUrl ?? '').toLowerCase();

  if (name.includes('datafetcher') || name.includes('data fetcher') || /\/data(?:\?|$)/.test(url)) {
    return BY_LISTING_ID.svc_demo_data_fetcher ?? null;
  }
  if (name.includes('analyst') || /\/analysis(?:\?|$)/.test(url)) {
    return BY_LISTING_ID.svc_demo_analyst ?? null;
  }
  if (name.includes('writer') || /\/report(?:\?|$)/.test(url)) {
    return BY_LISTING_ID.svc_demo_writer ?? null;
  }
  if (name.includes('senior') || name.includes('reviewer') || /\/review(?:\?|$)/.test(url)) {
    return BY_LISTING_ID.svc_demo_senior_reviewer ?? null;
  }
  if (name.includes('weather') || url.includes('/weather')) {
    return BY_LISTING_ID.svc_testnet_weather_base ?? null;
  }
  return null;
}

/** Resolve a static sample for a marketplace listing, if one is known. */
export function resolveMarketplaceServiceSample(
  listing: ListingSampleLookup | null | undefined,
): MarketplaceServiceSample | null {
  if (listing === null || listing === undefined) return null;
  const byId = listing.id !== undefined && listing.id !== null
    ? BY_LISTING_ID[listing.id]
    : undefined;
  if (byId !== undefined) return byId;
  return byNameOrPath(listing);
}

/** Pull a delivered response body from a payment event result, if present. */
export function extractDeliveredResponseBody(result: Record<string, unknown> | null | undefined): unknown | null {
  if (result === null || result === undefined) return null;
  const fulfillment = result.fulfillment;
  if (fulfillment === null || typeof fulfillment !== 'object') return null;
  const body = (fulfillment as Record<string, unknown>).body;
  if (body === undefined || body === null) return null;
  return body;
}
