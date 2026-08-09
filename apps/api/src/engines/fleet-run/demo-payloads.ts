/**
 * Seeded specialist catalog used when live seller HTTP is unreachable.
 * Same shape as demo/agents/shared/service-payloads.mjs — keeps Chat with agent unblocked.
 */

const FIXED_AS_OF = '2026-08-09T12:00:00.000Z';

function topicFromGoal(goal: string): string {
  const first = goal.trim().split('\n')[0] ?? goal;
  if (/arc|usdc|a2a|agent/i.test(first)) return 'agent-to-agent USDC payments on Arc';
  return first.slice(0, 120) || 'fleet-run';
}

export function seededDataFetcher(goal: string) {
  const topic = topicFromGoal(goal);
  return {
    service: {
      id: 'datafetcher.market-snapshot',
      name: 'DataFetcher Market Snapshot',
      version: '1.2.0',
      category: 'market-data',
    },
    query: 'chat',
    value: 'real-data-payload',
    topic,
    asOf: FIXED_AS_OF,
    summary:
      `Live snapshot for ${topic}: Arc testnet USDC agent payments settle via Permit2 intra-fleet drawdowns and x402 exact micropays, with measurable second-hop spend between specialists.`,
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
      { id: 'seed-fixture', label: 'Deterministic catalog fixture', confidence: 1.0 },
    ],
    servedAt: FIXED_AS_OF,
    fulfillment: 'catalog',
  };
}

export function seededAnalyst(goal: string, data: ReturnType<typeof seededDataFetcher>) {
  const topic = topicFromGoal(goal);
  return {
    service: {
      id: 'analyst.a2a-brief',
      name: 'Analyst A2A Brief',
      version: '1.1.0',
      category: 'analysis',
    },
    query: 'chat',
    topic,
    analysis:
      `Analysis of "${data.value}": ${topic} shows healthy fleet velocity. ` +
      `Median intra-fleet payment ${data.metrics.medianIntraFleetPaymentUsdc} USDC with ` +
      `${data.metrics.secondHopSharePct}% second-hop share — within expected range for a governed multi-agent economy.`,
    insights: [
      {
        id: 'rail-mix',
        headline: 'Permit2 dominates same-org hires',
        detail:
          'Lane 2 Permit2 drawdowns carry most volume; x402 remains the right rail for external micropays.',
      },
      {
        id: 'second-hop',
        headline: 'Specialists are both buyers and sellers',
        detail: 'Analyst→DataFetcher mid-task payments prove real agent-to-agent commerce.',
      },
      {
        id: 'cross-chain',
        headline: 'Base hop is the differentiation beat',
        detail: 'Arc orchestrator paying Base SeniorReviewer needs prefunded Base USDC.',
      },
    ],
    riskFlags: [],
    sourcedFrom: {
      agent: 'DataFetcher',
      txHash: null,
      serviceId: data.service.id,
    },
    asOf: FIXED_AS_OF,
    servedAt: FIXED_AS_OF,
    fulfillment: 'catalog',
  };
}

export function seededWriter(goal: string) {
  const topic = topicFromGoal(goal);
  return {
    service: {
      id: 'writer.research-report',
      name: 'Writer Research Report',
      version: '1.0.4',
      category: 'written-report',
    },
    title: `Research brief: ${topic}`,
    topic,
    abstract:
      `This brief explains how agent-to-agent USDC payments work on Arc under AgentOps policy: per-agent wallets, Permit2 ceilings, x402 for external services, and a Base Sepolia review hop.`,
    sections: [
      {
        heading: 'Payment rails',
        body:
          'Same-org fleet hires settle with Permit2. External paid APIs use x402 exact. Escrow is for delivery-risk jobs.',
      },
      {
        heading: 'Control plane',
        body:
          'AgentOps evaluates policy and budgets before settlement. Agents authorize governed tools — not raw spend keys.',
      },
      {
        heading: 'Evidence',
        body:
          'A complete run shows hub hires, second-hop Analyst→DataFetcher, Writer on Arc, then SeniorReviewer on Base.',
      },
    ],
    body:
      `Findings on "${topic}": Arc A2A USDC payments are production-shaped on testnet when an org control plane enforces wallets, policy, and Permit2/x402 rails.`,
    citations: [
      'AgentOps change-manifest §K',
      'Circle Arc Permit2 / x402',
      'DataFetcher + Analyst market snapshot',
    ],
    asOf: FIXED_AS_OF,
    servedAt: FIXED_AS_OF,
    fulfillment: 'catalog',
  };
}

export function seededSeniorReviewer(goal: string) {
  const title = topicFromGoal(goal);
  return {
    service: {
      id: 'senior-reviewer.signoff',
      name: 'SeniorReviewer Sign-off',
      version: '1.0.2',
      category: 'review',
      chain: 'base-sepolia',
    },
    title,
    verdict: 'approved',
    score: 92,
    notes:
      `Reviewed "${title}" — no blocking issues. Permit2, second-hop, and Base settlement claims are consistent. Publish Arc + Basescan links with the brief when live receipts exist.`,
    checklist: [
      { id: 'sources', label: 'Sources cited', status: 'pass' },
      { id: 'rails', label: 'Rail claims match evidence', status: 'pass' },
      { id: 'cross-chain', label: 'Base hop addressed', status: 'pass' },
      { id: 'policy', label: 'Policy caveats present', status: 'pass' },
    ],
    recommendations: [
      'Lead with second-hop and Base explorer txs when sellers are live.',
      'Keep Lane 1 x402 as an optional encore.',
    ],
    asOf: FIXED_AS_OF,
    servedAt: FIXED_AS_OF,
    fulfillment: 'catalog',
  };
}

export function seededPayloadForRole(
  role: string,
  goal: string,
  dataFetcherPayload?: ReturnType<typeof seededDataFetcher>,
): Record<string, unknown> {
  if (role === 'data_fetcher') return { data: seededDataFetcher(goal) };
  if (role === 'analyst') {
    const data = dataFetcherPayload ?? seededDataFetcher(goal);
    return { data: seededAnalyst(goal, data) };
  }
  if (role === 'writer') return { data: seededWriter(goal) };
  if (role === 'senior_reviewer') return { data: seededSeniorReviewer(goal) };
  return { data: { note: 'unknown role', fulfillment: 'catalog' } };
}
