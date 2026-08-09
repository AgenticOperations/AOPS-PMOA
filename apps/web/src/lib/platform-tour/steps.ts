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
      'Every agent lives here — create one, then grant Spend on Overview (payment access, budgets, draw allowances), plus credentials and policies.',
    element: '[data-tour="nav-agents"]',
    side: 'right',
  },
  {
    id: 'add-agent',
    title: 'Create your first agent',
    description:
      'Use Add agent → Create in console or Invite with token. Agents follow /llms.txt to redeem.',
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
      'Deposit USDC and set org ceilings on Fund. Per-agent budgets and draw allowances live on each agent’s Overview → Spend.',
    element: '[data-tour="nav-fund"]',
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
      'Create → policy → credential → fund → grant spend on agent → publish → hire. Replay anytime from the header.',
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
