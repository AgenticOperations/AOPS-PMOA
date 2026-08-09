/** Compact product knowledge for AgentOps co-pilot answers. */
export const AGENTOPS_KNOWLEDGE = `
AgentOps is a control plane for agentic payments and operations on Arc (and Base where needed).

What it does:
- Host and manage agents in an org (Agents page).
- Empower agents with payment access, budgets, rails, and wallets (Empower).
- Enforce policies and approvals (Controls / Policy).
- Fund the org treasury so agents can pay (Fund / Treasury).
- Discover and hire marketplace services and published agents (Marketplace).
- Track payment activity and receipts (Activity).
- MCP tools for developer agents (payment_x402, payment_intra_fleet, etc.) so Cursor/Claude can buy under org policy without holding BUYER_PRIVATE_KEY.
- Chat with agent: natural-language co-pilot that can answer questions, recommend marketplace listings, create agents, guide policies/funding, and run multi-agent fleets with live payment graphs.

Typical flows:
1) Create agents → Empower wallets/rails → Fund treasury → Attach policies → Run goals or MCP buys.
2) Publish a seller (e.g. arc-nanopayments template) → register identity → appear on marketplace.
3) Fleet research path: Orchestrator + DataFetcher + Analyst + Writer + SeniorReviewer (Base), with A2A USDC payments when sellers are live.

Keep answers short, practical, and product-accurate. Prefer one minimal dashboard link when guiding the user.
`.trim();

export const DEFAULT_FLEET_AGENTS = [
  {
    name: 'Orchestrator',
    description: 'Coordinates the research fleet and pays specialists under policy.',
    role: 'orchestrator',
  },
  {
    name: 'DataFetcher',
    description: 'Fetches market and reference data for the brief.',
    role: 'data_fetcher',
  },
  {
    name: 'Analyst',
    description: 'Analyzes data; may hire DataFetcher for a second hop.',
    role: 'analyst',
  },
  {
    name: 'Writer',
    description: 'Writes the research brief from analysis.',
    role: 'writer',
  },
  {
    name: 'SeniorReviewer',
    description: 'Cross-chain review on Base before final delivery.',
    role: 'senior_reviewer',
  },
] as const;
