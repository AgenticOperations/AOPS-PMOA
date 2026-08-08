export type FleetRunStatus = 'planned' | 'running' | 'completed' | 'failed' | 'cancelled';

export type FleetChecklistItem = {
  readonly id: string;
  readonly label: string;
  readonly tool: string;
  readonly required: boolean;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  readonly goalClause: string;
};

export type FleetResolvedAgent = {
  readonly agentId: string;
  readonly name: string;
  readonly role: 'orchestrator' | 'data_fetcher' | 'analyst' | 'writer' | 'senior_reviewer';
  readonly chain: 'arc' | 'base';
  readonly endpointUrl: string;
};

export type FleetRunEvent = {
  readonly id: string;
  readonly seq: number;
  readonly kind: string;
  readonly tool: string | null;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
};

export type FleetRunRecord = {
  readonly id: string;
  readonly orgId: string;
  readonly goal: string;
  readonly status: FleetRunStatus;
  readonly orchestratorAgentId: string | null;
  readonly checklist: readonly FleetChecklistItem[];
  readonly agents: Readonly<Record<string, FleetResolvedAgent>>;
  readonly fruit: Record<string, unknown> | null;
  readonly error: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly events: readonly FleetRunEvent[];
};

export const CANONICAL_FLEET_GOAL = `Research brief: how agent-to-agent USDC payments work on Arc testnet.
Hire DataFetcher → Analyst (allow Analyst to buy more data) → Writer → SeniorReviewer on Base.
Respect each agent budget. Stay inside org policy.
If any hire needs approval, wait for an operator.
Return a short brief plus payment receipts (chain, amount, tx).`;

export function buildCanonicalChecklist(): FleetChecklistItem[] {
  return [
    {
      id: 'onboard',
      label: 'Onboard Orchestrator',
      tool: 'agentops.onboard',
      required: true,
      status: 'pending',
      goalClause: 'Stay inside org policy / identity',
    },
    {
      id: 'wire',
      label: 'Wire live fleet agents',
      tool: 'listing.resolve',
      required: true,
      status: 'pending',
      goalClause: 'Hire DataFetcher → Analyst → Writer → SeniorReviewer',
    },
    {
      id: 'pay_data_fetcher',
      label: 'Pay DataFetcher (Arc)',
      tool: 'agentops.payment_intra_fleet',
      required: true,
      status: 'pending',
      goalClause: 'Hire DataFetcher',
    },
    {
      id: 'pay_analyst',
      label: 'Pay Analyst (Arc)',
      tool: 'agentops.payment_intra_fleet',
      required: true,
      status: 'pending',
      goalClause: 'Hire Analyst',
    },
    {
      id: 'second_hop',
      label: 'Second hop Analyst→DataFetcher',
      tool: 'agentops.payment_intra_fleet',
      required: true,
      status: 'pending',
      goalClause: 'Allow Analyst to buy more data',
    },
    {
      id: 'pay_writer',
      label: 'Pay Writer (Arc)',
      tool: 'agentops.payment_intra_fleet',
      required: true,
      status: 'pending',
      goalClause: 'Hire Writer',
    },
    {
      id: 'pay_reviewer',
      label: 'Pay SeniorReviewer (Base)',
      tool: 'agentops.payment_intra_fleet',
      required: true,
      status: 'pending',
      goalClause: 'SeniorReviewer on Base',
    },
    {
      id: 'activity',
      label: 'Record activity + assemble brief',
      tool: 'agentops.activity_record',
      required: true,
      status: 'pending',
      goalClause: 'Return brief plus payment receipts',
    },
  ];
}
