import type { AgentRosterItem } from '@/lib/identity-spine-types';
import type { PaymentRail } from '@/lib/payments-types';

function agentsListHref(orgSlug: string): string {
  return `/app/${orgSlug}/agents`;
}

function empowerAccessHref(orgSlug: string): string {
  return `/app/${orgSlug}/agents`;
}

function fundHref(orgSlug: string): string {
  return `/app/${orgSlug}/payments/funding`;
}

export const FLEET_AGENT_NAMES = [
  'Orchestrator',
  'DataFetcher',
  'Analyst',
  'Writer',
  'SeniorReviewer',
] as const;

export type FleetAgentName = (typeof FLEET_AGENT_NAMES)[number];

export type FleetAgentReadiness = {
  readonly name: FleetAgentName;
  readonly present: boolean;
  readonly agentId: string | null;
  readonly hasWallet: boolean;
};

export type FleetReadiness = {
  readonly ready: boolean;
  readonly agents: readonly FleetAgentReadiness[];
  readonly missingNames: readonly FleetAgentName[];
  readonly needsWalletNames: readonly FleetAgentName[];
};

export const FLEET_RAILS_BY_NAME: Readonly<Record<FleetAgentName, readonly PaymentRail[]>> = {
  Orchestrator: ['exact_arc', 'exact_base'],
  DataFetcher: ['exact_arc'],
  Analyst: ['exact_arc'],
  Writer: ['exact_arc'],
  SeniorReviewer: ['exact_base'],
};

export function assessFleetReadiness(agents: readonly AgentRosterItem[]): FleetReadiness {
  const active = agents.filter((agent) => agent.status !== 'deactivated' && agent.status !== 'retired');
  const byName = new Map<string, AgentRosterItem>();
  for (const agent of active) {
    if (!byName.has(agent.name)) byName.set(agent.name, agent);
  }

  const rows: FleetAgentReadiness[] = FLEET_AGENT_NAMES.map((name) => {
    const agent = byName.get(name);
    return {
      name,
      present: agent !== undefined,
      agentId: agent?.id ?? null,
      hasWallet: (agent?.wallet_refs_count ?? 0) > 0,
    };
  });

  const missingNames = rows.filter((row) => !row.present).map((row) => row.name);
  const needsWalletNames = rows.filter((row) => row.present && !row.hasWallet).map((row) => row.name);

  return {
    ready: missingNames.length === 0 && needsWalletNames.length === 0,
    agents: rows,
    missingNames,
    needsWalletNames,
  };
}

export type FleetFixLink = {
  readonly href: string;
  readonly label: string;
  readonly detail: string;
};

export function fleetFixLinks(orgSlug: string, readiness: FleetReadiness): readonly FleetFixLink[] {
  const links: FleetFixLink[] = [];
  if (readiness.missingNames.length > 0) {
    links.push({
      href: `${agentsListHref(orgSlug)}?setup=fleet`,
      label: 'Create fleet agents',
      detail: `Missing: ${readiness.missingNames.join(', ')} — use exact names`,
    });
  }
  if (readiness.needsWalletNames.length > 0 || readiness.missingNames.length > 0) {
    links.push({
      href: empowerAccessHref(orgSlug),
      label: 'Grant spend on agents',
      detail: 'Open each fleet agent → Overview → Spend to enable payment access and wallets',
    });
  }
  links.push({
    href: fundHref(orgSlug),
    label: 'Fund treasury',
    detail: 'Fleet hires need USDC on Arc (and Base for SeniorReviewer)',
  });
  return links;
}

export function fleetErrorFixLinks(orgSlug: string, message: string, code: string | null): readonly FleetFixLink[] {
  const lower = message.toLowerCase();
  const links: FleetFixLink[] = [];

  if (code === 'fleet_agents_missing' || lower.includes('missing fleet agents')) {
    links.push({
      href: `${agentsListHref(orgSlug)}?setup=fleet`,
      label: 'Open Agents',
      detail: 'Create Orchestrator, DataFetcher, Analyst, Writer, SeniorReviewer (exact names)',
    });
    links.push({
      href: empowerAccessHref(orgSlug),
      label: 'Agent Spend',
      detail: 'After create, grant payment access on each agent Overview',
    });
    links.push({
      href: '/chat',
      label: 'Back to chat',
      detail: 'Retry after agents + wallets are ready',
    });
  }

  if (code === 'fleet_endpoint_missing' || lower.includes('no public endpoint') || lower.includes('ports 4001')) {
    links.push({
      href: `${agentsListHref(orgSlug)}`,
      label: 'Publish endpoints',
      detail: 'Set public_endpoint_url on each specialist, or start demo sellers on :4001–4004',
    });
  }

  if (lower.includes('budget') || lower.includes('insufficient') || lower.includes('treasury')) {
    links.push({
      href: fundHref(orgSlug),
      label: 'Fund',
      detail: 'Top up org treasury / agent wallets',
    });
  }

  if (links.length === 0) {
    links.push({
      href: `${agentsListHref(orgSlug)}?setup=fleet`,
      label: 'Agents',
      detail: 'Check fleet roster and wallets',
    });
    links.push({
      href: empowerAccessHref(orgSlug),
      label: 'Agent Spend',
      detail: 'Payment access and draw allowances on each agent',
    });
  }

  return links;
}
