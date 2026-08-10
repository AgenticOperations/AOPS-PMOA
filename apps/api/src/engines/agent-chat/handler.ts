import type pg from 'pg';
import type { OperatorContext } from '../identity/types.js';
import { createAgent, listAgents } from '../identity/store.js';
import { listMarketplaceListings, type MarketplaceListingWithAuth } from '../marketplace/store.js';
import {
  getOrgPaymentMode,
  getTreasuryOverview,
  listCircleBalances,
  setAgentPaymentAccess,
} from '../payments/store.js';
import type { CircleTreasuryProvider } from '../payments/circle-provider.js';
import type { PaymentRail } from '../payments/types.js';
import { createFleetRun, getFleetRun } from '../fleet-run/store.js';
import { resolveFleetAgents } from '../fleet-run/resolve-agents.js';
import { executeFleetRun } from '../fleet-run/executor.js';
import { buildCanonicalChecklist, CANONICAL_FLEET_GOAL } from '../fleet-run/types.js';
import { formatFleetRunChatReply, fleetRunTxLinks } from './format-fleet-reply.js';
import { DEFAULT_FLEET_AGENTS } from './knowledge.js';
import {
  answerQa,
  classifyIntent,
  inventNAgents,
  narrateShort,
  parseAgentCount,
} from './gemini.js';
import type {
  AgentChatTurnRequest,
  AgentChatTurnResponse,
  ChatConfirm,
  ChatGraph,
  ChatLink,
  ChatListingSuggestion,
  ChatPendingState,
  ProposedAgent,
} from './types.js';

const FLEET_LISTING_PRIORITY = [
  'svc_demo_data_fetcher',
  'svc_demo_analyst',
  'svc_demo_writer',
  'svc_demo_senior_reviewer',
] as const;

function listingSummary(description: string): string {
  const cleaned = description
    .replace(/\s+/g, ' ')
    .replace(/\s*Enable with\b.*$/i, '')
    .replace(/\s*GET\s+\/\w[\w/-]*.*$/i, '')
    .replace(/\s*[—–-]\s*(metrics|second hop|abstract|verdict).*$/i, '')
    .trim();
  const first = (cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned).trim();
  if (first.length <= 100) return first.replace(/[.!?]$/, '');
  return `${first.slice(0, 97).trimEnd()}…`;
}

function pickMarketplaceSuggestions(
  listings: readonly MarketplaceListingWithAuth[],
): readonly ChatListingSuggestion[] {
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  const preferred = FLEET_LISTING_PRIORITY.map((id) => byId.get(id)).filter(
    (listing): listing is MarketplaceListingWithAuth => listing !== undefined,
  );
  const rest = listings.filter(
    (listing) =>
      !FLEET_LISTING_PRIORITY.includes(listing.id as (typeof FLEET_LISTING_PRIORITY)[number]) &&
      !listing.id.startsWith('svc_testnet_') &&
      listing.id !== 'svc_nanopayments_template',
  );
  const chosen = [...preferred, ...rest].slice(0, 4);
  return chosen.map((listing) => ({
    id: listing.id,
    name: listing.name,
    category: listing.category,
    priceHint: listing.priceHint ?? 'Priced on hire',
    chain: listing.chain === 'base' ? 'Base' : 'Arc',
    summary: listingSummary(listing.description),
    href: `/marketplace/${encodeURIComponent(listing.id)}`,
  }));
}

const FLEET_RAILS: Record<string, readonly PaymentRail[]> = {
  Orchestrator: ['exact_arc', 'exact_base'],
  DataFetcher: ['exact_arc'],
  Analyst: ['exact_arc'],
  Writer: ['exact_arc'],
  SeniorReviewer: ['exact_base'],
};

function appLink(orgSlug: string, path: string, label: string): ChatLink {
  return { label, href: `/app/${orgSlug}${path}` };
}

function graphFromAgents(
  agents: readonly ProposedAgent[],
  status: ChatGraph['nodes'][number]['status'] = 'pending',
): ChatGraph {
  const nodes = agents.map((agent, index) => ({
    id: `n-${index}-${agent.name}`,
    label: agent.name,
    status,
  }));
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `w-${index}`,
    from: node.id,
    to: nodes[index + 1]!.id,
    kind: 'wire' as const,
    status: 'pending' as const,
  }));
  return { nodes, edges };
}

function graphAfterCreate(agents: readonly ProposedAgent[]): ChatGraph {
  return {
    nodes: agents.map((agent, index) => ({
      id: `n-${index}-${agent.name}`,
      label: agent.name,
      status: 'ready' as const,
    })),
    edges: agents.slice(0, -1).map((_, index) => ({
      id: `w-${index}`,
      from: `n-${index}-${agents[index]!.name}`,
      to: `n-${index + 1}-${agents[index + 1]!.name}`,
      kind: 'wire' as const,
      status: 'done' as const,
    })),
  };
}

function graphFromFleetRun(
  agents: readonly ProposedAgent[],
  runAgents: Readonly<Record<string, { agentId: string; name: string }>>,
  events: readonly { kind: string; payload: Record<string, unknown> }[],
): ChatGraph {
  const base = graphAfterCreate(agents);
  const byId = new Map(Object.values(runAgents).map((a) => [a.agentId, a.name]));
  const byName = new Map(base.nodes.map((n) => [n.label, n]));

  function nodeForName(name: string | null): ChatGraph['nodes'][number] | undefined {
    if (name === null) return undefined;
    return byName.get(name);
  }

  const paymentEdges: ChatGraph['edges'][number][] = [];
  let payIndex = 0;
  for (const event of events) {
    if (event.kind !== 'payment' && event.kind !== 'service' && event.kind !== 'tool') continue;
    const payload = event.payload;
    const payerName =
      typeof payload.payer === 'string'
        ? payload.payer
        : typeof payload.payer_agent_id === 'string'
          ? (byId.get(payload.payer_agent_id) ?? null)
          : null;
    const payeeName =
      typeof payload.payee === 'string'
        ? payload.payee
        : typeof payload.payee_agent_id === 'string'
          ? (byId.get(payload.payee_agent_id) ?? null)
          : null;
    if (event.kind === 'payment') {
      const from = nodeForName(payerName);
      const to = nodeForName(payeeName);
      if (from === undefined || to === undefined) continue;
      const amount = typeof payload.amount_usdc === 'string' ? payload.amount_usdc : undefined;
      paymentEdges.push({
        id: `p-${payIndex}`,
        from: from.id,
        to: to.id,
        kind: 'payment',
        label: amount !== undefined ? `${amount} USDC` : 'payment',
        status: 'done',
      });
      payIndex += 1;
    }
  }
  const nodeStatus = new Map(base.nodes.map((n) => [n.id, n.status as ChatGraph['nodes'][number]['status']]));
  for (const event of events) {
    if (event.kind !== 'service' && event.kind !== 'payment' && event.kind !== 'tool') continue;
    const payload = event.payload;
    const names = [
      typeof payload.payee === 'string' ? payload.payee : null,
      typeof payload.payer === 'string' ? payload.payer : null,
      typeof payload.payee_agent_id === 'string' ? (byId.get(payload.payee_agent_id) ?? null) : null,
      typeof payload.payer_agent_id === 'string' ? (byId.get(payload.payer_agent_id) ?? null) : null,
    ];
    for (const name of names) {
      const node = nodeForName(name);
      if (node) nodeStatus.set(node.id, 'done');
    }
  }
  return {
    nodes: base.nodes.map((n) => ({ ...n, status: nodeStatus.get(n.id) ?? n.status })),
    edges: [...base.edges, ...paymentEdges],
  };
}

async function treasurySnapshot(
  pool: pg.Pool,
  orgId: string,
  provider: CircleTreasuryProvider,
  orgSlug: string,
): Promise<{ readonly reply: string; readonly links: readonly ChatLink[]; readonly low: boolean }> {
  const [overview, balances] = await Promise.all([
    getTreasuryOverview(pool, orgId, provider).catch(() => null),
    listCircleBalances(pool, orgId, provider).catch(() => []),
  ]);
  const preferred =
    balances.find((b) => b.chain === 'arc') ?? balances.find((b) => b.chain === 'base') ?? balances[0];
  const balance = overview?.totals.treasury_usdc ?? 'unknown';
  const address = preferred?.address ?? null;
  const parsed = Number.parseFloat(overview?.totals.treasury_usdc ?? 'NaN');
  const low = overview !== null && Number.isFinite(parsed) && parsed < 1;

  const addrLine =
    address === null
      ? 'No treasury wallet yet — open Fund to provision one.'
      : `Treasury (${preferred?.chain ?? 'wallet'}): ${address}`;
  const reply = low
    ? `Treasury looks low (${balance} USDC). Fund it so agents can pay.\n\n${addrLine}`
    : `Treasury balance: ${balance} USDC.\n\n${addrLine}`;
  return {
    reply,
    links: [appLink(orgSlug, '/payments/funding', 'Fund')],
    low,
  };
}

async function createAndEmpowerAgents(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  proposed: readonly ProposedAgent[],
): Promise<{ readonly created: string[]; readonly reused: string[] }> {
  const existing = await listAgents(pool, orgId);
  const active = existing.filter((a) => a.status !== 'deactivated' && a.status !== 'retired');
  const byName = new Map<string, { readonly id: string; readonly name: string }>(
    active.map((a) => [a.name, { id: a.id, name: a.name }]),
  );
  const created: string[] = [];
  const reused: string[] = [];

  for (const spec of proposed) {
    let agent = byName.get(spec.name);
    if (agent === undefined) {
      const createdAgent = await createAgent(pool, operator, orgId, {
        name: spec.name,
        description: spec.description,
        labels: ['chat', 'fleet'],
        metadata: {
          setup_mode: 'publish',
          fleet_role: spec.role ?? spec.name,
          created_via: 'agent_chat',
        },
      });
      agent = { id: createdAgent.id, name: createdAgent.name };
      byName.set(spec.name, agent);
      created.push(spec.name);
    } else {
      reused.push(spec.name);
    }

    const rails = FLEET_RAILS[spec.name] ?? (['exact_arc'] as const);
    await setAgentPaymentAccess(pool, operator, orgId, agent.id, {
      allowed_rails: [...rails],
      budget_usdc: spec.name === 'Orchestrator' ? '10.00' : '5.00',
      dedicated_wallet_required: true,
      per_request_cap_usdc: '2.00',
      status: 'active',
    });
  }

  return { created, reused };
}

function proposeFromMessage(
  message: string,
  classifiedAgents: readonly ProposedAgent[] | null,
  preferFleet: boolean,
): ProposedAgent[] {
  if (classifiedAgents !== null && classifiedAgents.length > 0) return [...classifiedAgents];
  if (preferFleet) return DEFAULT_FLEET_AGENTS.map((a) => ({ ...a }));
  const count = parseAgentCount(message);
  if (count !== null) return inventNAgents(count, message);
  return inventNAgents(3, message);
}

export async function handleAgentChatTurn(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  operator: OperatorContext,
  orgId: string,
  input: AgentChatTurnRequest,
): Promise<AgentChatTurnResponse> {
  const orgSlug = input.orgSlug.trim() || 'org';
  const message = input.message.trim();
  const history = input.history ?? [];
  const pending = input.pending ?? null;
  const confirmId = input.confirmId ?? null;

  const empty = (): AgentChatTurnResponse => ({
    reply: '',
    links: [],
    confirms: [],
    listings: [],
    graph: null,
    pending: null,
    runId: null,
  });

  // --- Explicit confirm buttons ---
  if (confirmId !== null && pending !== null) {
    if (confirmId === 'create_agents' && pending.kind === 'create_agents') {
      const { created, reused } = await createAndEmpowerAgents(pool, operator, orgId, pending.agents);
      const graph = graphAfterCreate(pending.agents);
      const fund = await treasurySnapshot(pool, orgId, provider, orgSlug);
      const names = pending.agents.map((a) => a.name);
      const reply = await narrateShort(
        `Agents are ready: created ${created.join(', ') || 'none'}; already present ${reused.join(', ') || 'none'}. Ask about policies next, then whether to run the goal.`,
        `Ready: ${names.join(', ')}.${created.length > 0 ? ` Created ${created.join(', ')}.` : ' Reused existing roster.'}\n\nNext: attach policies (spend caps / approvals), then ${fund.low ? 'fund treasury and ' : ''}run the goal.`,
      );
      const nextPending: ChatPendingState = {
        kind: 'after_create',
        agents: pending.agents,
        goal: pending.goal,
        createdNames: names,
      };
      const confirms: ChatConfirm[] = pending.goal
        ? [{ id: 'run_fleet', kind: 'run_fleet', label: 'Run fleet now' }]
        : [{ id: 'continue_after_create', kind: 'continue_after_create', label: 'Continue' }];
      return {
        ...empty(),
        reply: `${reply}${fund.low ? `\n\n${fund.reply}` : ''}`,
        links: [
          appLink(orgSlug, '/agents', 'Agents'),
          appLink(orgSlug, '/agents', 'Agents'),
          appLink(orgSlug, '/controls', 'Controls'),
          ...(fund.low ? fund.links : []),
        ],
        confirms,
        graph,
        pending: nextPending,
      };
    }

    if (
      (confirmId === 'run_fleet' || confirmId === 'continue_after_create') &&
      (pending.kind === 'run_fleet' || pending.kind === 'after_create' || pending.kind === 'create_agents')
    ) {
      // Ensure agents exist, then execute fleet if goal looks like fleet OR we have default roster
      await createAndEmpowerAgents(pool, operator, orgId, pending.agents);
      const goal = pending.goal?.trim() || message || CANONICAL_FLEET_GOAL;
      let createdId: string | null = null;
      try {
        const agents = await resolveFleetAgents(pool, orgId);
        const checklist = buildCanonicalChecklist();
        const created = await createFleetRun(pool, {
          orgId,
          goal,
          createdBy: operator.actorId,
          orchestratorAgentId: agents.orchestrator!.agentId,
          checklist,
          agents,
        });
        createdId = created.id;
        const run = await executeFleetRun(pool, provider, {
          orgId,
          runId: created.id,
          actorId: operator.actorId,
        });
        const graph = graphFromFleetRun(pending.agents, run.agents, run.events);
        const reply = formatFleetRunChatReply(run);
        const txLinks = fleetRunTxLinks(run);
        return {
          ...empty(),
          reply,
          links: [
            ...txLinks,
            appLink(orgSlug, '/activity', 'Activity'),
            appLink(orgSlug, '/agents', 'Agents'),
            appLink(orgSlug, '/payments/fund', 'Fund'),
            { label: 'Marketplace', href: '/marketplace' },
          ],
          confirms: [],
          graph,
          pending: null,
          runId: run.id,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Could not run fleet.';
        const needsAgents = /fleet_agents_missing|Fleet roster incomplete/i.test(errMsg);

        if (createdId !== null && !needsAgents) {
          try {
            const run = await getFleetRun(pool, orgId, createdId);
            const graph = graphFromFleetRun(pending.agents, run.agents, run.events);
            const txLinks = fleetRunTxLinks(run);
            return {
              ...empty(),
              reply: formatFleetRunChatReply(run),
              links: [
                ...txLinks,
                appLink(orgSlug, '/activity', 'Activity'),
                appLink(orgSlug, '/agents', 'Agents'),
                appLink(orgSlug, '/payments/fund', 'Fund'),
              ],
              confirms: [],
              graph,
              pending: null,
              runId: run.id,
            };
          } catch {
            // fall through to short error
          }
        }

        return {
          ...empty(),
          reply: needsAgents
            ? `${errMsg}\n\nI can create the standard research fleet (5 agents) first — confirm below.`
            : errMsg,
          links: [
            appLink(orgSlug, '/agents', 'Agents'),
            appLink(orgSlug, '/payments/fund', 'Fund'),
          ],
          confirms: needsAgents
            ? [{ id: 'create_agents', kind: 'create_agents', label: 'Create fleet agents' }]
            : [],
          graph: graphFromAgents(pending.agents, 'failed'),
          pending: needsAgents
            ? { kind: 'create_agents', agents: DEFAULT_FLEET_AGENTS.map((a) => ({ ...a })), goal }
            : pending,
        };
      }
    }
  }

  const { intent, agents: classifiedAgents } = await classifyIntent(message, history, pending !== null);

  // Soft confirm via natural language
  if (intent === 'confirm' && pending !== null) {
    return handleAgentChatTurn(pool, provider, operator, orgId, {
      ...input,
      confirmId: pending.kind === 'after_create' ? 'run_fleet' : pending.kind === 'run_fleet' ? 'run_fleet' : 'create_agents',
    });
  }

  if (intent === 'smalltalk') {
    return {
      ...empty(),
      reply: 'Hey — I can explain AgentOps, recommend marketplace services, create agents, check funding, or run a multi-agent goal.',
      links: [{ label: 'Marketplace', href: '/marketplace' }],
    };
  }

  if (intent === 'fund') {
    const fund = await treasurySnapshot(pool, orgId, provider, orgSlug);
    return { ...empty(), reply: fund.reply, links: fund.links };
  }

  if (intent === 'policies') {
    return {
      ...empty(),
      reply:
        'Policies cap what agents may spend and when approvals are required. Set them in Controls after agents exist — start with per-request caps and approval thresholds.',
      links: [appLink(orgSlug, '/controls', 'Controls'), appLink(orgSlug, '/agents', 'Agents')],
    };
  }

  if (intent === 'marketplace') {
    const mode = (await getOrgPaymentMode(pool, orgId)).mode;
    const listings = await listMarketplaceListings(pool, { mode, buyerOrgId: orgId });
    const suggestions = pickMarketplaceSuggestions(listings);
    const reply = await narrateShort(
      'Write one short intro (max 2 sentences) for marketplace hire cards. Say they settle in USDC under org policy. Do NOT name any services, prices, or chains — the UI cards already show those.',
      suggestions.length > 0
        ? 'Here are hireable marketplace services for research and agent-to-agent USDC payments. Open a card to hire under org policy.'
        : 'No marketplace listings are available yet. Open Marketplace after publishing a seller or seeding the demo catalog.',
    );
    return {
      ...empty(),
      reply,
      listings: suggestions,
      links: [{ label: 'Browse marketplace', href: '/marketplace' }],
    };
  }

  if (intent === 'create_agents') {
    const proposed = proposeFromMessage(message, classifiedAgents, false);
    const pendingNext: ChatPendingState = { kind: 'create_agents', agents: proposed };
    const list = proposed.map((a) => `• ${a.name} — ${a.description}`).join('\n');
    return {
      ...empty(),
      reply: `Shall I create these ${proposed.length} agents?\n\n${list}\n\nAfter create I'll prompt you about policies and funding.`,
      links: [appLink(orgSlug, '/agents', 'Agents')],
      confirms: [{ id: 'create_agents', kind: 'create_agents', label: `Create ${proposed.length} agents` }],
      graph: graphFromAgents(proposed, 'pending'),
      pending: pendingNext,
    };
  }

  if (intent === 'fleet_run') {
    const proposed = proposeFromMessage(message, classifiedAgents, true);
    // Prefer standard fleet names when message looks like research fleet
    const useDefault =
      /\b(datafetcher|analyst|writer|seniorreviewer|orchestrator|research|fleet|canonical)\b/i.test(message) ||
      classifiedAgents === null;
    const agents = useDefault ? DEFAULT_FLEET_AGENTS.map((a) => ({ ...a })) : proposed;
    const existing = await listAgents(pool, orgId);
    const names = new Set(
      existing.filter((a) => a.status !== 'deactivated' && a.status !== 'retired').map((a) => a.name),
    );
    const missing = agents.filter((a) => !names.has(a.name));

    if (missing.length > 0) {
      const pendingNext: ChatPendingState = {
        kind: 'create_agents',
        agents,
        goal: message.length >= 8 ? message : CANONICAL_FLEET_GOAL,
      };
      const list = missing.map((a) => `• ${a.name}`).join('\n');
      return {
        ...empty(),
        reply: `To run that goal I'll use a ${agents.length}-agent fleet. Missing from your org:\n\n${list}\n\nShall I create them (and empower payment access)?`,
        links: [appLink(orgSlug, '/agents', 'Agents'), appLink(orgSlug, '/payments/funding', 'Fund')],
        confirms: [{ id: 'create_agents', kind: 'create_agents', label: 'Create agents' }],
        graph: graphFromAgents(agents, 'pending'),
        pending: pendingNext,
      };
    }

    const fund = await treasurySnapshot(pool, orgId, provider, orgSlug);
    const pendingNext: ChatPendingState = {
      kind: 'run_fleet',
      agents,
      goal: message.length >= 8 ? message : CANONICAL_FLEET_GOAL,
    };
    return {
      ...empty(),
      reply: `Roster is ready (${agents.map((a) => a.name).join(', ')}).${fund.low ? `\n\n${fund.reply}` : ''}\n\nPolicies live in Controls. Run the fleet when you're ready — I'll show nodes, then payment edges as work settles.`,
      links: [
        appLink(orgSlug, '/controls', 'Controls'),
        ...(fund.low ? fund.links : []),
        appLink(orgSlug, '/activity', 'Activity'),
      ],
      confirms: [{ id: 'run_fleet', kind: 'run_fleet', label: 'Run fleet' }],
      graph: graphFromAgents(agents, 'ready'),
      pending: pendingNext,
    };
  }

  // Default QA
  const reply = await answerQa(message, history);
  return {
    ...empty(),
    reply,
    links: [
      { label: 'Marketplace', href: '/marketplace' },
      appLink(orgSlug, '/agents', 'Agents'),
      appLink(orgSlug, '/controls', 'Controls'),
    ],
  };
}
