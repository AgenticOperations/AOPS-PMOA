import type { PlatformTourStep, TourPath } from './types';

/**
 * Unique spotlight targets per path. Only `add-agent` route-hops (to Agents)
 * so we can move sidebar Agents → the real Add agent button smoothly.
 */
const ALL_STEPS: readonly PlatformTourStep[] = [
  {
    id: 'map',
    title: 'How the console is organized',
    description:
      'Workspace for status, Identity for agents & policies, Runtime for runs & approvals, Treasury for funding & spend.',
    element: '[data-tour="nav-sidebar"]',
    side: 'right',
  },
  {
    id: 'agents',
    title: 'Agents are identities',
    description:
      'Every agent lives here — create one, then give it credentials, policies, and (optionally) a public endpoint.',
    element: '[data-tour="nav-agents"]',
    side: 'right',
  },
  {
    id: 'add-agent',
    title: 'Create your first agent',
    description:
      'Use Add agent and pick Publish Arc agent (hire story) or Connect via MCP. Optional — you can do this later.',
    element: '[data-tour="add-agent"]',
    route: 'agents',
    side: 'bottom',
  },
  {
    id: 'controls',
    title: 'Policies are the rules',
    description:
      'In Controls: draft → validate → activate a policy, then attach it on an agent’s Policies & access tab.',
    element: '[data-tour="nav-controls"]',
    side: 'right',
  },
  {
    id: 'fund',
    title: 'Fund the treasury',
    description:
      'Deposit USDC to the org treasury — or skip deposit and use your own wallet path into Empower.',
    element: '[data-tour="nav-fund"]',
    side: 'right',
    paths: ['publish', 'explore'],
  },
  {
    id: 'empower',
    title: 'Empower spend rails',
    description:
      'Grant agents access, ceilings, and delegations so they can pay under policy — not with unbounded wallets.',
    element: '[data-tour="nav-empower"]',
    side: 'right',
    paths: ['publish', 'explore'],
  },
  {
    id: 'marketplace',
    title: 'Discover and hire',
    description:
      'Buyers browse the public marketplace, pick a listing, and hire with x402 or escrow — using their own paying agent.',
    element: '[data-tour="hire-cta"]',
    side: 'bottom',
  },
  {
    id: 'approvals',
    title: 'You stay in control',
    description:
      'When a policy needs a human, requests land in Approvals. Purchases and treasury activity keep a full receipt trail.',
    element: '[data-tour="nav-approvals"]',
    side: 'right',
  },
  {
    id: 'done',
    title: 'You’re free to explore',
    description:
      'Create → policy → credential → fund → publish → hire. Replay this story anytime from the header. Nothing is required.',
    element: '[data-tour="nav-home"]',
    side: 'right',
  },
];

export function stepsForPath(path: TourPath): PlatformTourStep[] {
  return ALL_STEPS.filter((step) => step.paths === undefined || step.paths.includes(path));
}

/** Ensures the guided story never highlights the same control twice. */
export function assertUniqueStepTargets(path: TourPath): string[] {
  const elements = stepsForPath(path).map((step) => step.element ?? '');
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const element of elements) {
    if (element.length === 0) continue;
    if (seen.has(element)) duplicates.push(element);
    seen.add(element);
  }
  return duplicates;
}

export function tourRoute(orgSlug: string, route: string | undefined): string | null {
  if (route === undefined || route.length === 0) return null;
  return `/app/${orgSlug}/${route}`;
}
