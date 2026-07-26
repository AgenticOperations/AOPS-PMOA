---
created: 2026-07-26
project: agentOps
ecosystem: circle
tags: [pmoa, checkpoint-2, pitch-deck, arc, circle, submission]
---

# PMOA Checkpoint 2 Submission Design

[[10-Projects/Web3-Builds/agentOps/HANDOFF]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/README]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/DESIGN]]

## Purpose

Create the judge-facing Checkpoint 2 package for AOPS in the Build on Arc
Programmable Money Online Accelerator. The required submission surfaces are:

1. A public source repository.
2. A presentation deck.
3. Agentic Economy track selection.

The package must make the existing working product easy to believe, show why
its control infrastructure matters for Arc and Circle, and establish a credible
company direction beyond the hackathon.

## Audience

The primary audience is a mixed product and technical judging panel with limited
review time. The deck must be understandable without reading the repository
first. A technical judge should still be able to trace every material claim to
repository code or recorded test evidence.

## Submission Boundary

### Repository

- Make `https://github.com/AgenticOperations/AOPS-PMOA` public.
- Keep `main` unchanged at the current checkpoint.
- Link judges directly to `feat/mcp-paid-http`.
- Label the branch as the latest tested development checkpoint.
- Identify commit `add41aa` in the deck or repository proof index.
- Do not imply the feature is merged into `main`.

### Current proof

The presentation may claim only the following verified current capabilities:

- Organization onboarding and role-based access.
- Organization, team, role, and agent control surfaces.
- Versioned policy creation, assignment, simulation, and inheritance.
- Spend limits, rate limits, approval requirements, service scope, and rail
  constraints enforced before execution.
- Agent credentials with rotation, revocation, pause, and deactivation controls.
- Hosted Streamable HTTP MCP plus local stdio support.
- Eight MCP tools in the current runtime contract.
- Circle Agent Wallet connection at the organization level.
- Circle-supported multi-chain wallet and Gateway rail coverage.
- Real MCP-only agent policy evaluations.
- Real USDC payment execution through Circle infrastructure.
- Paid HTTP/x402 execution, merchant-response return, and replay safety on the
  unmerged feature branch.
- Atomic budget reservations and explicit reconciliation behavior.
- Hash-chained application evidence.
- The feature branch verification gate passed `878/878` tests.

The exact proof transaction network may appear in a caption or evidence note.
It must not become the product positioning.

### Arc boundary

Arc-native settlement is the next milestone, not a current completed feature.
The deck may say:

> AOPS has a working Circle-native control foundation and is now moving its
> governed execution path onto Arc.

It must not say:

- Current payments settle on Arc.
- The current product is deployed on Arc.
- Arc-native nanopayments are already proven.
- The current feature branch is a merged or production deployment.

## Narrative Strategy

Use a proof-led structure:

- 70% verified product progress.
- 20% Arc and company vision.
- 10% technical architecture.

The narrative is:

> Circle gives agents programmable money. AOPS provides the organizational
> authority required to use it safely. The control foundation works today;
> Arc-native execution is the next product milestone.

Base, Arbitrum, Polygon, Optimism, and Avalanche are supporting evidence of
Circle stack compatibility. They are not the headline and should appear only in
a compact supported-network annotation.

## Slide Architecture

### Slide 1 — Cover

**Headline:** AOPS — programmable authority for autonomous money

**Subhead:** Give agents economic autonomy without giving them unrestricted
authority.

**Proof label:** Build on Arc · Checkpoint 2 · Agentic Economy

Purpose: establish category, product identity, and event relevance in under five
seconds.

### Slide 2 — The missing organizational layer

**Headline:** Circle gives agents programmable money. Organizations still need
control.

Show the gap between wallet/payment primitives and the operating controls a real
organization requires: roles, policies, approvals, budgets, emergency controls,
and evidence.

Avoid universal claims that no other controls exist. The differentiation is the
combination of organizational authority, governed execution, and evidence.

### Slide 3 — Working progress

**Headline:** The control foundation already works.

Use a proof strip plus real console composition to show:

- Policy inheritance and simulation.
- Credentialed MCP access.
- Approval and spend controls.
- Real Circle payment execution.
- Replay-safe paid HTTP.
- Hash-chained evidence.
- `878/878` feature-branch verification tests.

Purpose: move the judge from promise to proof before introducing architecture or
roadmap.

### Slide 4 — Governed execution workflow

**Headline:** One policy follows the agent from intent to evidence.

Visual sequence:

1. Organization defines a role policy.
2. Agent receives scoped credentials.
3. Agent calls AOPS through MCP.
4. AOPS evaluates policy and reserves budget.
5. Approval or automatic authorization is applied.
6. Circle infrastructure executes the payment.
7. The purchased response returns to the agent.
8. Decision and settlement evidence are recorded.

Use one continuous flow, not eight disconnected cards.

### Slide 5 — Product surface

**Headline:** Built as an operating system, not a wallet wrapper.

Organize the current product into four operating surfaces:

- Define authority: organization, teams, roles, policies.
- Operate agents: registry, credentials, pause, deactivate, kill controls.
- Govern money: treasury, budgets, approvals, rails.
- Prove outcomes: live operations, reconciliation, evidence, audit export.

Use real UI excerpts and keep explanatory copy minimal.

### Slide 6 — Architecture

**Headline:** Circle-native infrastructure, designed toward Arc.

Architecture:

`Agent → AOPS MCP → policy + approval + reservation → Circle Agent Wallet /
Gateway / x402 → service → reconciliation + evidence`

Arc should be the visually dominant next execution environment. Existing
supported networks appear as a small Circle compatibility strip with an honest
caption that current proof used Circle-supported test rails.

### Slide 7 — Next milestone

**Headline:** Next: make Arc the native execution environment.

Show five concrete outcomes:

- Arc Testnet USDC settlement.
- Arc-aware Circle wallet and Gateway execution.
- Governed x402 or paid-service workflow on Arc.
- Production resilience, observability, and recovery hardening.
- Product UX refinement around missions, providers, and outcomes.

This slide must read as an execution plan, not an aspirational feature cloud.

### Slide 8 — Company direction

**Headline:** From agent control to economic operations.

Three horizons:

1. **Now — Governed execution:** policies, roles, approvals, budgets, MCP,
   payments, and evidence.
2. **Next — Arc-native operations:** authority-bound USDC settlement and
   provider workflows.
3. **Company — Economic operating layer:** agent and provider registry,
   protocol adapters, outcome verification, treasury orchestration, and
   independently verifiable evidence.

Close with the repository branch and the line:

> Programmable money needs programmable authority.

## Visual System

The deck must feel like an extension of the authenticated AOPS console rather
than a generic hackathon template.

### Palette

- Canvas: warm off-white `#F5F2EA`.
- Primary ink: deep navy `#071A3D`.
- Primary accent: confident blue `#315EF6`.
- Secondary accent: light blue `#71B7FF`.
- Surface: near-white `#FCFBF7`.
- Rule/border: cool gray-blue `#D7DEE9`.
- Muted text: slate `#657087`.

Arc and Circle marks retain their official colors when verified assets are
available. Accent colors are structural, not decorative gradients.

### Typography

- Editorial display face for cover and major statements.
- Montserrat for body copy, UI labels, architecture, and metrics.
- Large, restrained headlines with generous line height.
- No microtext except evidence footnotes and source labels.
- Numeric proof uses tabular alignment and strong hierarchy.

The production workflow must confirm that selected fonts exist in the exported
PPTX. If the preferred editorial face is unavailable, use a deliberate
Office-safe serif fallback rather than silently falling back to Calibri.

### Composition

- 16:9 widescreen.
- Flat planes, minimal rounding, and thin structural rules.
- Avoid nested bordered cards, feature-card grids, glowing crypto motifs, and
  decorative network maps.
- Use one continuous workflow graphic and one compact architecture diagram.
- Use real product UI crops where a screenshot provides stronger proof than an
  illustration.
- Use blue accents sparingly to direct attention to authority transitions,
  policy decisions, and the next Arc milestone.

### Motion

The submitted PPTX must work without animation. Any optional transitions should
be subtle and must not carry essential meaning.

## Project Image

Export a clean 16:9 cover image from Slide 1 for reuse as a checkpoint preview.
It should contain:

- The verified AOPS wordmark.
- The core headline.
- A restrained authority-to-settlement visual.
- Build on Arc / Agentic Economy labeling.

Do not create a collage of console screenshots for the project image.

## Deliverables

1. Editable `.pptx` deck.
2. Rendered 16:9 checkpoint/project image.
3. A short submission factsheet containing:
   - Repository URL.
   - Branch and commit.
   - Track selection.
   - One-paragraph checkpoint summary.
   - Claim-and-proof index.

The final deck and project image are user-facing. Scratch plans, renders, QA
ledgers, and provenance records remain outside the repository in the retained
presentation workspace.

## Evidence and Provenance

The deck source ledger must distinguish:

- User-provided event and product statements.
- Current `main` implementation evidence.
- `feat/mcp-paid-http` branch-only evidence.
- Current product screenshots.
- Official Circle and Arc assets or documentation.
- Generated decorative assets, if any.

Every material number, integration claim, and logo must be traceable. Local file
paths must not appear in the user-facing deck.

## QA Acceptance Criteria

- Every slide renders without clipping, overflow, or unreadable microtext.
- The deck is understandable in under four minutes.
- Slide 3 makes the working proof unmistakable.
- Arc is clearly the next native environment without being misrepresented as
  currently deployed.
- Base and other supported networks appear only as Circle compatibility proof.
- The repository link opens the public repository and the feature branch.
- The branch and commit identifiers are correct at delivery time.
- The deck, repository README, and submission factsheet agree on tool count,
  integration status, test result, and deployment boundary.
- All product screenshots use the current AOPS visual system.
- All logos are user-provided or verified official assets.

## Explicit Exclusions

- No claim of a public production deployment.
- No claim that the branch is merged into `main`.
- No claim of current Arc settlement.
- No unsupported per-agent wallet-provisioning claim.
- No autonomous liquidity-rebalancing claim.
- No claim that generic agent execution state can be recovered without loss.
- No broad claim that every decision is anchored onchain.
