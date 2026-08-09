import type { PlatformTourStep, TourPath } from './types';

const ALL_STEPS: readonly PlatformTourStep[] = [
  {
    id: 'map',
    title: 'How the console is organized',
    description:
      'Workspace for status, Identity for agents & policies, Runtime for runs & approvals, Treasury for funding & spend.',
    element: '[data-tour="nav-sidebar"]',
    route: 'overview',
    side: 'right',
  },
  {
    id: 'agents',
    title: 'Agents are identities',
    description:
      'Every agent lives here — create one, then give it credentials, policies, and (optionally) a public endpoint.',
    element: '[data-tour="nav-agents"]',
    route: 'agents',
    side: 'right',
  },
  {
    id: 'add-agent',
    title: 'Create your first agent',
    description:
      'Optional: open Add agent and pick Publish Arc agent (hire story) or Connect via MCP (operator story). You can do this later.',
    element: '[data-tour="add-agent"]',
    route: 'agents',
    side: 'bottom',
  },
  {
    id: 'controls',
    title: 'Policies are the rules',
    description:
      'Draft → validate → activate a policy in Controls, then attach it on the agent’s Policies & access tab.',
    element: '[data-tour="nav-controls"]',
    route: 'controls',
    side: 'right',
  },
  {
    id: 'credentials',
    title: 'Credentials connect the agent',
    description:
      'On an agent’s Credentials & wallets tab, issue an MCP credential so Cursor or Claude can reach AgentOps.',
    element: '[data-tour="nav-agents"]',
    route: 'agents',
    side: 'right',
    paths: ['mcp', 'explore'],
  },
  {
    id: 'fund',
    title: 'Fund the treasury',
    description:
      'Deposit USDC to the org treasury — or skip deposit and use your own wallet path into Empower.',
    element: '[data-tour="nav-fund"]',
    route: 'payments/funding',
    side: 'right',
    paths: ['publish', 'explore'],
  },
  {
    id: 'empower',
    title: 'Empower spend rails',
    description:
      'Grant agents access, ceilings, and delegations so they can pay under policy — not with unbounded wallets.',
    element: '[data-tour="nav-empower"]',
    route: 'payments/empower',
    side: 'right',
    paths: ['publish', 'explore'],
  },
  {
    id: 'publish',
    title: 'Publish for hire',
    description:
      'On an agent’s Publish tab: save a public endpoint, then Register on Arc. That identity can surface on the marketplace.',
    element: '[data-tour="nav-agents"]',
    route: 'agents',
    side: 'right',
    paths: ['publish', 'explore'],
  },
  {
    id: 'marketplace',
    title: 'Discover and hire',
    description:
      'Buyers browse the public marketplace, pick a listing, and hire with x402 or escrow — using their own paying agent.',
    element: '[data-tour="hire-cta"]',
    route: 'overview',
    side: 'bottom',
  },
  {
    id: 'approvals',
    title: 'You stay in control',
    description:
      'When a policy needs a human, requests land in Approvals. Purchases and treasury activity keep a full receipt trail.',
    element: '[data-tour="nav-approvals"]',
    route: 'approvals',
    side: 'right',
  },
  {
    id: 'done',
    title: 'You’re free to explore',
    description:
      'Create → policy → credential → fund → publish → hire. Replay this story anytime from the header. Nothing is required.',
    element: '[data-tour="nav-home"]',
    route: 'overview',
    side: 'right',
  },
];

export function stepsForPath(path: TourPath): PlatformTourStep[] {
  return ALL_STEPS.filter((step) => step.paths === undefined || step.paths.includes(path));
}

export function tourRoute(orgSlug: string, route: string | undefined): string | null {
  if (route === undefined || route.length === 0) return null;
  return `/app/${orgSlug}/${route}`;
}
