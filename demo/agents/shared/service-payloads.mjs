/**
 * Demo service payloads for hosted fleet agents.
 * Looks like a real market-research product; values are seeded (deterministic).
 */

const FIXED_AS_OF = '2026-08-09T12:00:00.000Z';

function topicFromQuery(raw) {
  const q = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'fleet-run';
  if (/arc|usdc|a2a|agent/i.test(q)) return 'agent-to-agent USDC payments on Arc';
  return q;
}

/** DataFetcher — paid market snapshot feed */
export function buildDataFetcherPayload(query) {
  const topic = topicFromQuery(query);
  return {
    service: {
      id: 'datafetcher.market-snapshot',
      name: 'DataFetcher Market Snapshot',
      version: '1.2.0',
      category: 'market-data',
    },
    query: query ?? null,
    // Stable marker kept for demo agent tests
    value: 'real-data-payload',
    topic,
    asOf: FIXED_AS_OF,
    summary:
      `Live snapshot for ${topic}: Arc testnet USDC agent payments are settling via Permit2 intra-fleet drawdowns and x402 exact micropays, with measurable second-hop spend between specialist agents.`,
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
  };
}

/** Analyst — paid analysis that consumes DataFetcher output */
export function buildAnalystPayload(query, dataResult, dataTxHash) {
  const topic = topicFromQuery(query);
  const rawValue = dataResult?.value ?? 'unknown';
  const metrics = dataResult?.metrics ?? {};
  return {
    service: {
      id: 'analyst.a2a-brief',
      name: 'Analyst A2A Brief',
      version: '1.1.0',
      category: 'analysis',
    },
    query: query ?? null,
    topic,
    // Tests assert analysis contains the DataFetcher value marker
    analysis:
      `Analysis of "${rawValue}": ${topic} shows healthy fleet velocity. ` +
      `Median intra-fleet payment ${metrics.medianIntraFleetPaymentUsdc ?? 0.03} USDC with ` +
      `${metrics.secondHopSharePct ?? 28}% second-hop share — within expected range for a governed multi-agent economy.`,
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
      {
        id: 'cross-chain',
        headline: 'Base hop is the differentiation beat',
        detail:
          'Arc orchestrator paying a Base SeniorReviewer requires prefunded Base USDC (Option A) — call this out on explorer receipts.',
      },
    ],
    riskFlags: [],
    sourcedFrom: {
      agent: 'DataFetcher',
      txHash: dataTxHash ?? null,
      serviceId: dataResult?.service?.id ?? 'datafetcher.market-snapshot',
    },
    asOf: FIXED_AS_OF,
    servedAt: FIXED_AS_OF,
  };
}

/** Writer — paid research report */
export function buildWriterPayload(topicRaw) {
  const topic = topicFromQuery(topicRaw);
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
      `This brief explains how agent-to-agent USDC payments work on Arc testnet under AgentOps policy: per-agent wallets, Permit2 ceilings for intra-fleet hires, x402 for external services, and a deliberate Base Sepolia review hop.`,
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
      {
        heading: 'Demo evidence',
        body:
          'A complete run shows Orchestrator→DataFetcher→Analyst (with Analyst→DataFetcher second hop)→Writer on Arc, then SeniorReviewer on Base, each with explorer receipts.',
      },
    ],
    // Keep a simple body string for older consumers / narration
    body:
      `Findings on "${topic}": Arc A2A USDC payments are production-shaped on testnet when an org control plane enforces wallets, policy, and Permit2/x402 rails. Second-hop and Base hops are the proof points.`,
    citations: [
      'AgentOps change-manifest §K fleet scenario',
      'Circle Arc Permit2 / x402 surfaces',
      'DataFetcher + Analyst seeded market snapshot',
    ],
    asOf: FIXED_AS_OF,
    servedAt: FIXED_AS_OF,
  };
}

/** SeniorReviewer — Base chain editorial / compliance review */
export function buildSeniorReviewerPayload(titleRaw) {
  const title = typeof titleRaw === 'string' && titleRaw.trim().length > 0 ? titleRaw.trim() : 'fleet-run';
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
      `Reviewed "${title}" — no blocking issues found. Claims about Permit2 intra-fleet, second-hop Analyst hire, and Base settlement are consistent with the attached receipts. Recommend publishing Arc + Basescan links with the final brief.`,
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
  };
}
