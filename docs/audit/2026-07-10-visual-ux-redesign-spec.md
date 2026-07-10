# agentOps Console: Visual & UX Redesign Spec

Date: 2026-07-10

Builds on: `docs/audit/2026-07-10-console-feature-data-audit.md`

Governing constraints:
- `DESIGN.md` is canonical for the authenticated product.
- `PRODUCT.md` governs product framing and anti-references.
- This spec covers Auth, Onboarding, and the authenticated console only. Landing and marketing pages are out of scope.

Reference:
- `shadcn-fintech` (github.com/abderrahimghazali/shadcn-fintech, MIT) is the dashboard reference for component structure, density, table treatment, cards, charts, command palette, and sidebar behavior.
- We do not copy its wallet-first content model, crypto page, 3D assets, or trading-dashboard framing. agentOps is an agent operations and treasury control plane.

---

## 1. Design Position

The current console does not need more decoration. It needs a stable information architecture, a reusable layout system, and clear separation between reading state and mutating state.

Target feel:
- Stripe-like clarity in forms, status, and financial controls.
- AWS-like depth, but only after progressive disclosure.
- shadcn-fintech-like implementation discipline: grouped sidebar, compact card grids, real tables, command palette, responsive shell, and charts that serve a question.

Non-goals:
- No landing-page hero patterns.
- No glass, heavy blur, gradient orbs, big-radius floating cards, or decorative motion.
- No fake metric cards that do not map to backend data.
- No global Analytics or History nav item. Analytics and history live inside the page they explain.

Visual floor:
- Light-first product UI with restrained dark mode support.
- Montserrat from `DESIGN.md`.
- 1px borders, small radius, compact table rows, tabular numbers.
- Cards and panels use ring/border elevation, not card drop shadows.
- Badges and status indicators are pills; cards and panels are not.
- Charts default to neutral/grayscale series; semantic color appears as tints only.
- Color used for state only: success, warning, danger, info, selected.
- Motion limited to 150-250ms state changes and small live-status indicators.

---

## 2. Current Product Surfaces

This is the product object map the UI must serve. Every visible card, table, form, and chart must attach to one of these backend-backed surfaces.

### Identity

Data:
- `orgs`
- `users`
- `memberships`
- `teams`
- `agents`
- `connections`
- `connection_credentials` (never exposed directly)
- `wallet_refs`
- `oauth_accounts`
- `auth_sessions`
- `org_onboarding_states`

Actions:
- Sign in with Google.
- Create org.
- Create/update agent.
- Pause, activate, deactivate agent.
- Create, rotate, revoke credential.
- Attach/detach wallet reference.
- Add/update/remove member.
- Create/update/archive team.
- Skip/resume onboarding steps.

### Policy And Control

Data:
- `policy_action_registry`
- `policy_drafts`
- `policy_versions`
- `policy_bindings`
- `policy_decisions`
- `policy_simulations`
- `approval_requests`
- `approval_actions`
- `approval_consumptions`

Actions:
- Create policy draft.
- Edit/discard draft.
- Validate draft.
- Simulate draft.
- Activate draft.
- Bind/unbind active policy.
- Archive policy.
- Create new policy version.
- Approve/deny runtime approval.
- Consume approval at runtime.

### Runtime Operations

Data:
- `tool_catalog`
- `operational_rate_limits`
- `operational_rate_counters`
- `operational_decisions`
- `mcp_sessions`
- `connection_rate_limits`
- `activity_items`

Actions:
- Import/update/archive tool.
- Create/update/disable rate limit.
- Runtime operation check/record.
- Runtime MCP/API activity record.

### Treasury And Payments

Data:
- `org_treasuries`
- `payment_sources`
- `agent_payment_accounts`
- `payment_route_observations`
- `payment_reservations`
- `payment_events`
- `org_payment_modes`
- `circle_chain_capabilities`
- `circle_wallet_sets`
- `circle_chain_wallets`
- `circle_provider_jobs`

Actions:
- Set test/live provider mode.
- Create/sync Circle treasury.
- Create source with explicit provider, chain, and rail.
- Deposit into Gateway.
- Request testnet faucet funding.
- Reconcile provider jobs.
- Verify one rail.
- Verify all unverified rails.
- Create/retry/cancel liquidity job.
- Bridge/top up exact wallet.
- Configure agent payment access.
- Runtime x402 payment request and settlement.

### Audit And Evidence

Data:
- `audit_event_heads`
- `audit_events`
- page-local event streams from policy, operations, payments, approvals, and agent activity.

Actions:
- View event.
- Verify audit chain or event proof.
- Filter by domain/category/severity/tag/related entity.

---

## 3. Route Map

Auth and onboarding are standalone. The authenticated product uses `ConsoleShell`.

All org routes below are scoped under `/app/{orgSlug}`.

| Route | Page | Shell | Purpose |
|---|---|---|---|
| `/auth` | Auth | No | Google session and workspace selection |
| `/onboarding` | Onboarding | No | Optional setup wizard after first org creation |
| `/overview` | Overview | Yes | Org health dashboard |
| `/agents` | Agents | Yes | Agent registry |
| `/agents/{agentId}` | Agent detail | Yes | Agent identity, access, credentials, wallets, activity |
| `/controls` | Controls | Yes | Policy library, drafts, bindings, decision history |
| `/operations` | Operations | Yes | Tool catalog, rate limits, runtime decisions |
| `/approvals` | Approvals | Yes | Human approval inbox and history |
| `/payments` | Treasury overview | Yes | Payment health, balances, readiness summary |
| `/payments/sources` | Treasury sources and rails | Yes | Treasury, Circle wallets, sources, rail proofs |
| `/payments/access` | Treasury agent access | Yes | Agent budgets, caps, rails, approval thresholds |
| `/payments/liquidity` | Treasury liquidity | Yes | Liquidity jobs, top-ups, deposits, rebalancing |
| `/payments/activity` | Treasury activity | Yes | Payment ledger, route observations, reservations, provider jobs |
| `/settings` | Workspace settings | Yes | Members, teams, org profile |

### Sidebar IA

Use grouped navigation, matching the shadcn-fintech pattern, but with agentOps domains:

Workspace:
- Overview

Identity:
- Agents
- Controls

Runtime:
- Operations
- Approvals

Treasury:
- Payments parent, route `/payments`, expandable in the sidebar.
- Children:
  - Overview
  - Sources & Rails
  - Agent Access
  - Liquidity
  - Activity & Evidence

Org:
- Settings

Implementation note:
- Keep `ConsoleShell` as a server component.
- Move nav interactivity into a small client component that uses `usePathname()` for active state and Treasury expansion.
- Do not keep caller-supplied active keys. Subroutes need route-derived partial matching.
- The Payments parent label should be product copy, not a mixed "Payments/Treasury" string. Recommendation: label the sidebar parent **Treasury**, keep URLs as `/payments` for route compatibility.

---

## 4. Layout Blueprints

The product should reuse three structural layouts instead of inventing a page shape every time.

### A. Aggregator

Used by:
- Overview
- Treasury overview

Shape:
- Header with page title, one-line operational context, primary action if any.
- Four compact status tiles maximum.
- One main chart or trend panel only if it answers a current operator question.
- A "Needs attention" list with links into source pages.
- One recent activity table/feed.

Rules:
- No decorative hero metric.
- No table that grows past the first viewport.
- No action-heavy forms on aggregator pages.

### B. Index

Used by:
- Agents list
- Approvals inbox
- Operations decisions
- Policy library
- Treasury activity ledgers
- Settings members/teams

Shape:
- Header.
- Toolbar with search, filters, view toggles, and one primary action.
- Fixed-height table shell with sticky header and hidden scrollbar.
- Row click opens a Sheet drawer for details.
- Bulk actions only when the backend actually supports them.

Rules:
- Tables show the 80 percent fields only.
- JSON, hashes, raw IDs, provider payloads, and proof details live in drawers.
- Pagination or "load more" on high-volume logs.

### C. Focus Canvas

Used by:
- Onboarding wizard
- Policy draft builder
- Agent payment access form
- Treasury source setup
- Liquidity/rebalance action forms
- Credential rotate/revoke confirmations

Shape:
- Single-column or two-pane stepper.
- Left pane: steps and short state summary.
- Right pane: current input group.
- Footer: Back, Save draft when relevant, Continue, Submit.

Rules:
- Multi-step actions are never one giant form.
- Inline validation before submit.
- Review step before irreversible actions.
- Drawers can take the width from content edge to right edge, but must not overlap the sidebar.

---

## 5. Page Designs

Pages are ordered from least dense to most dense. This order is analysis order, not sidebar order.

### 5.1 Auth

Current data/actions:
- Reads session/workspaces.
- Starts Google OAuth.
- Lets signed-in user choose a workspace.

New layout:
- Centered auth panel, no console sidebar.
- Left/top brand lockup and one sentence explaining "Agent operations control plane".
- Primary button: Continue with Google.
- If signed in, show workspace table/list with org name and role.

No charts, no metrics, no fake marketing feature grid.

Empty state:
- If signed in with no workspaces, show one compact action row: create a workspace. Do not show a feature tour.

Mobile:
- Single-column centered panel with the workspace list becoming stacked rows. OAuth button stays full width.

### 5.2 Onboarding

Current data/actions:
- Creates org.
- Backend supports domain/use case and onboarding state, but setup should not become mandatory.

New layout:
- Standalone Focus Canvas.
- Step 1 required: Organization name.
- After org creation, all setup steps are optional and skippable:
  1. Sync Circle wallet.
  2. Fund treasury.
  3. Create first agent.
  4. Create credential.
  5. Attach starter policy.
  6. Enable payment access.
  7. Test API/MCP request.

Behavior:
- User can leave after org name and do every step later from the relevant page.
- Each optional step writes `org_onboarding_states`.
- Empty or skipped setup must not block console access.

Empty state:
- Optional steps show "Not set up yet" with the one next action and a Skip link. No warning styling until the step blocks a real requested action.

Mobile:
- Step rail collapses to a compact progress header. The active step form becomes a single column with sticky bottom actions.

### 5.3 Approvals

Current data/actions:
- Lists approval requests.
- Approve/deny.
- Approval actions and consumptions exist but need a fuller operator view.

New layout:
- Index layout.
- Tabs: Inbox, History.
- Inbox table columns: request, agent, decision required, amount/resource, age/expires, status.
- Row drawer shows full context, matched policy, request body summary, approval actions, and consumption proof if present.
- Approve/deny opens a confirmation drawer with optional reason.

Analytics:
- Approval rate.
- Average time to decision.
- Expired vs approved vs denied.
- Top policies requesting approval.

Empty state:
- Inbox empty state says no pending approvals and links to Controls policies that can require approval.
- History empty state says resolved approvals appear after approve, deny, expire, or consume events.

Mobile:
- Toolbar filters collapse into a Filter sheet. Approval rows become cards with request, age, amount/resource, and status visible before opening the detail sheet.

### 5.4 Settings

Current data/actions:
- Member APIs and team APIs are backend-backed.

New layout:
- Index layout with tabs: Members, Teams, Org Profile.
- Members table: user, email, role, status, joined, actions.
- Teams table: name, status, default, agent count, actions.
- Org profile: name/domain/use case where supported.

Actions:
- Add member.
- Change member role.
- Remove member.
- Create/update/archive team.

No analytics beyond small counts. This is a management page.

Empty state:
- Members empty state shows the owner row plus an add-member action if only the creator exists.
- Teams empty state shows the default team and a create-team action.

Mobile:
- Members and teams use card rows with role/status actions in a trailing menu. Org profile stays a single-column form.

### 5.5 Overview

Current data/actions:
- Currently mostly an agent summary. It needs to become the org dashboard.

New layout:
- Aggregator layout.
- Top tiles:
  - Active agents.
  - Pending approvals.
  - Treasury available.
  - Blocked/rate-limited actions in last 24h.
- Main body:
  - Agent roster preview, compact and fixed-height.
  - Needs attention list:
    - Pending approval older than threshold.
    - Agent with no active policy binding.
    - Payment rail not verified.
    - Failed payment or provider job.
    - Rate limit repeatedly hit.
  - Recent org-wide activity feed.

No dedicated action forms. Actions are links into domain pages.

Empty state:
- Empty org shows the first real sequence: create agent, create credential, attach policy, enable payment access. Each item links to its source page.

Mobile:
- Stat tiles become a two-column grid, then one column under narrow widths. Needs-attention and activity lists stack below the agent preview.

### 5.6 Operations

Current data/actions:
- Tool catalog.
- Blocked/rate-limited operations.
- Rate limits.
- MCP sessions and rate counters are important but need better exposure.

New layout:
- Index layout.
- Tabs:
  - Tool Catalog
  - Rate Limits
  - Decisions
  - Sessions

Tool Catalog:
- Table: tool, category, status, last updated, actions.
- Drawer: schema/context, edit/archive.
- Action: import tool.

Rate Limits:
- Table: target, action/tool, window, limit, current usage, status.
- Utilization bar sourced from `operational_rate_counters`.
- Actions: create, edit, disable.

Decisions:
- Table: agent, action, tool/resource, decision, reason, time.
- Filters: agent, decision, action, date.

Sessions:
- MCP sessions table with live/idle/offline indicator.

Empty state:
- Tool Catalog empty state points to import tool.
- Rate Limits empty state points to create limit.
- Decisions empty state explains that runtime checks will populate the table.
- Sessions empty state explains that active MCP/API sessions appear after an agent connects.

Mobile:
- Operations tabs remain horizontal with overflow. Tool/rate/decision/session tables become compact cards, and filters open in a sheet.

### 5.7 Controls

Current data/actions:
- Policy drafts.
- Policy versions.
- Policy bindings.
- Policy decisions.
- Policy simulations.

New layout:
- Index layout plus Focus Canvas for creation.
- Top toolbar:
  - Search policies.
  - Filter by decision/action/status.
  - Primary action: Create Policy.
  - Secondary toggle: Drafts.

Tables:
- Policy library table is default.
- Drafts appear in the same workbench via the Drafts toggle, not as a separate page.
- Bindings and decisions are available as table tabs/segments inside Controls.

Create Policy:
- Full-height drawer from content edge, not a small modal.
- Stepper:
  1. Action surface and decision.
  2. Conditions, driven by backend `policy_action_registry` metadata.
  3. Scope and target preview.
  4. Validate and simulate.
  5. Review and create draft.

Policy detail drawer:
- Shows version, bindings, statements, tags, simulation history, decisions caused by this policy.
- Actions: bind, unbind, archive, create version.

Important rule:
- The UI must never expose condition fields that do not apply to the selected action.

Empty state:
- Policy library empty state points to Create Policy.
- Drafts empty state says draft policies appear before activation.
- Decision history empty state says policy checks appear after runtime/API/MCP requests.

Mobile:
- Controls table toolbar collapses search and filters into a sheet. Create Policy uses a full-screen sheet from the content edge, with the stepper shown as a top progress bar.

### 5.8 Agents

Current data/actions:
- Agents list and create.
- Agent detail includes policies, credentials, wallet refs, live activity, blocked operations.

Agents list layout:
- Index layout.
- Header with inline create control:
  - Input placeholder: "Authorize a new agent".
  - Pill button: Add.
- Table columns: agent, team, status, credential state, policy coverage, last activity.
- Row opens agent detail route.

Agent detail layout:
- Tabs:
  - Overview
  - Policies & Access
  - Credentials & Wallets
  - Activity

Overview:
- Agent identity, status, team, hierarchy, description/labels if present.
- Actions: edit, pause, activate, deactivate.

Policies & Access:
- Active bindings.
- Allowed runtime actions.
- Blocked/rate-limited operations.
- Link to Controls for editing policies.

Credentials & Wallets:
- Credentials table with create/rotate/revoke/test.
- Wallet refs table with attach/detach.
- Payment access summary linking to Treasury Agent Access.

Activity:
- Live activity feed.
- Config audit.
- Payment events filtered to agent.
- Operation decisions filtered to agent.

Empty state:
- Agents list empty state keeps the inline create control visible and explains that credentials are created on the detail page.
- Agent detail Activity empty state says API/MCP calls and configuration changes will appear here after the agent is used.

Mobile:
- Agents list keeps create input and Add button stacked above the table. Agent detail tabs stay sticky below the page header; table sections become row cards.

### 5.9 Treasury

Treasury is the highest-density domain. It must not be one long page.

#### `/payments` - Treasury Overview

Purpose:
- Calm, high-level state.

Data:
- Treasury balance.
- Provider mode.
- Rail readiness summary.
- Recent failed jobs/payments.
- Agent payment access count.

Layout:
- Aggregator layout.
- Top tiles:
  - Available USDC.
  - Verified rails.
  - Agents with payment access.
  - In-flight reservations.
- Needs attention:
  - Unverified supported rail.
  - Failed provider job.
  - Liquidity job stalled.
  - Agent budget near cap.

Actions:
- Switch test/live mode.
- Sync treasury.
- Navigate to focused subroutes.

Empty state:
- If no treasury exists, show one setup action: Sync Circle treasury. Do not expose chain buckets on this overview state.

Mobile:
- Treasury subnavigation becomes a horizontal segmented nav under the page header. Status tiles stack two by two, then one per row.

#### `/payments/sources` - Sources & Rails

Purpose:
- Setup and diagnostics.

Data:
- `org_treasuries`
- `payment_sources`
- `circle_chain_capabilities`
- `circle_wallet_sets`
- `circle_chain_wallets`
- live balances
- rail readiness

Layout:
- Index layout.
- Segments: Sources, Rails, Wallets.

Actions:
- Create source.
- Sync Circle wallet.
- Run proof for one rail.
- Run proofs for all unverified rails.
- Request testnet faucet.

Create Source:
- Focus Canvas drawer.
- Explicit provider, chain, rail, label.
- No hidden hardcoded provider/chain choices.

Empty state:
- Sources empty state points to create source or sync Circle wallet, depending on whether treasury exists.
- Rails empty state should not occur after setup; if it does, show a provider configuration error and link to diagnostics.

Mobile:
- Sources, Rails, and Wallets segments remain at the top. Rail proof actions collapse into row action menus to keep rows readable.

#### `/payments/access` - Agent Access

Purpose:
- Payment permissions per agent.

Data:
- `agent_payment_accounts`
- agents
- verified rails
- recent spend by agent

Layout:
- Index layout.
- Table columns: agent, status, monthly budget, spent, per-request cap, approval threshold, rails, last payment.
- Drawer for one agent account.

Actions:
- Enable/disable payment access.
- Set budget.
- Set per-request cap.
- Set approval threshold.
- Choose allowed settlement-verified rails.

Empty state:
- If no agents exist, link to Agents.
- If agents exist but none have access, show enable payment access as the primary action and explain that access is off by default.

Mobile:
- Agent access rows become budget cards with status, spent, rails, and one edit button. The edit drawer becomes full-screen on phones.

#### `/payments/liquidity` - Liquidity

Purpose:
- Internal treasury plumbing, hidden from normal Overview but available to operators.

Data:
- `circle_provider_jobs`
- liquidity jobs
- rebalance recommendations
- Gateway balances
- exact wallet balances

Layout:
- Index layout.
- Segments: Jobs, Recommendations, Deposits, Top-ups.

Actions:
- Gateway deposit.
- Bridge/top up exact wallet.
- Retry liquidity job.
- Cancel liquidity job.
- Reconcile provider jobs.

Rule:
- Every rebalance action must show source, destination, rail, amount, policy status, and expected result before submit.

Empty state:
- Jobs empty state says no liquidity operations are in progress.
- Recommendations empty state says treasury liquidity is balanced for current usage.

Mobile:
- Liquidity job and recommendation tables become timeline cards. Rebalance/deposit/top-up forms use full-screen stepped sheets.

#### `/payments/activity` - Activity & Evidence

Purpose:
- Ledger and proof trail.

Data:
- `payment_events`
- `payment_route_observations`
- `payment_reservations`
- `circle_provider_jobs`
- payment-related `audit_events`

Layout:
- Index layout.
- Tabs:
  - Ledger
  - Routes
  - Reservations
  - Provider Jobs
  - Audit

Drawers:
- Payment event detail with x402 quote hash, rail, provider mode, status, and audit link.
- Route observation detail with accepted/rejected reason.
- Reservation detail with lifecycle and settlement.
- Provider job detail with request/response summary and retryability.

Empty state:
- Ledger empty state says payments appear after approved x402 settlement.
- Routes empty state says accepted and rejected payment attempts will be recorded.
- Reservations empty state says in-flight payment holds appear during execution.
- Provider Jobs empty state says Circle treasury operations appear after setup or payment activity.

Mobile:
- Activity tabs become a horizontally scrollable tab list. Ledger, route, reservation, provider-job, and audit rows become compact evidence cards with detail sheets.

---

## 6. Visual System And Component Requirements

This section is the implementation contract for Phase 0. It replaces generic "make it shadcn-like" direction with concrete rules verified from the `shadcn-fintech` source.

### 6.1 Visual Tokens

Elevation:
- Cards and static panels use a 1px ring or border equivalent to `ring-1 ring-foreground/10`.
- Do not use `box-shadow` on cards, tables, stat panels, or repeated rows.
- Shadows are allowed only for overlays and transient layers: Sheet, Popover, Menu, Tooltip, drag state.

Radius:
- Cards and panels use the `rounded-xl` role.
- Inputs and compact controls use a tighter control radius.
- Status badges, count pills, and segmented-control pills use the pill radius role.

Color:
- Charts default to neutral/grayscale series.
- Semantic chart color is allowed only when the series itself is semantic state, such as success vs failed.
- Semantic states use tinted backgrounds at 10-20% opacity with full-opacity text/icon.
- Avoid solid-fill warning/error/success badges except for destructive confirmation buttons.

Typography:
- Montserrat remains the product font.
- Numbers use tabular figures.
- IDs, hashes, wallet addresses, and proof values use the existing monospace token.

Motion:
- 150-250ms transitions.
- Animate opacity and transform, not layout properties.
- Empty-state illustrations may use small draw-in or fade/translate motion through the existing `motion` dependency.

### 6.2 Direct Reuse From shadcn-fintech

Port structure, not content:
- `src/components/ui/card.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/table.tsx`
- `src/components/ui/chart.tsx`
- `src/components/ui/sidebar.tsx`
- `src/components/empty-state.tsx`
- the radius scale pattern from `globals.css`

Adaptations required:
- Keep agentOps color tokens from `DESIGN.md`; do not replace them with the reference repo's literal grayscale app colors.
- Keep Tabler icons and mechanically substitute any Lucide imports during porting.
- Strip `@base-ui/react` polymorphic `render` support while porting unless a component truly needs it. The first implementation path should not add `@base-ui/react`.
- Do not import reference crypto/trading/wallet-first content components.
- Do not adopt `three`, `three-globe`, drag/drop dashboard customization, or reference crypto pages.

Dependencies allowed for Phase 0:
- `cmdk`
- `class-variance-authority`
- `date-fns`
- `next-themes`
- `recharts`

Dependencies already present and reused:
- `motion`
- `@tabler/icons-react`
- `tailwind-merge`
- `clsx`

### 6.3 Required Primitives

Create or replace these primitives before redesigning any page:
- `Card`
- `Badge`
- `Table`
- `Chart`
- `Sidebar`
- `Sheet`
- `Tabs`
- `Command`
- `Tooltip`
- `Skeleton`
- `EmptyState`
- `StatusBadge`
- `EntityLink`
- `PageHeader`
- `SectionToolbar`
- `TableShell`
- `FocusCanvas`

TableShell:
- Fixed max height.
- Sticky header.
- Hidden visual scrollbar while preserving wheel, trackpad, and keyboard scroll.
- Row click opens a Sheet detail view.

Sheet:
- On desktop, opens from the content edge and must not overlap the sidebar.
- On mobile, becomes full-screen or near-full-screen depending on action risk.

EmptyState:
- Variant-driven component with agentOps domains: `agents`, `policies`, `approvals`, `operations`, `treasury`, `payments`, `activity`, `settings`, `search`, `filter`, `generic`.
- Each variant has a restrained SVG illustration or icon composition, title, one-sentence description, and optional real action.
- Empty states are designed during page implementation, not added in final QA.

### 6.4 Command Palette Scope

Phase 0 command palette is page-jump only:
- Overview
- Agents
- Controls
- Operations
- Approvals
- Treasury Overview
- Treasury Sources & Rails
- Treasury Agent Access
- Treasury Liquidity
- Treasury Activity & Evidence
- Settings

Do not build "jump to entity" in Phase 0. The backend has no cross-entity search/autocomplete route today. Entity search becomes a later explicit feature with:
- backend endpoint,
- server client,
- authorization,
- result ranking,
- entity-specific destinations,
- tests.

### 6.5 Mobile Rules

Global:
- Sidebar collapses to an icon rail/tablet mode and to an overlay drawer/mobile mode.
- Treasury subroutes become a horizontal segmented nav under the page header on mobile.
- Page toolbars collapse filters into a Filter sheet.
- Dense table rows become cards below the configured breakpoint.
- Action drawers become full-screen on phones.
- Critical submit/cancel controls stay sticky at the bottom of full-screen forms.

Per-page mobile rules are specified in Section 5 and must be implemented with the page, not deferred to Phase 7.

---

## 7. Form Rules

Single-step inline forms:
- Add agent.
- Add member.
- Create team.
- Import tool.
- Toggle provider mode.
- Run rail proof.
- Retry/cancel job.

Confirmation drawers:
- Revoke credential.
- Rotate credential.
- Pause/deactivate agent.
- Archive policy.
- Unbind policy.
- Disable rate limit.

Stepper drawers:
- Create policy.
- Configure agent payment access.
- Create treasury source.
- Gateway deposit.
- Bridge/top up exact wallet.
- Optional onboarding setup.

Validation:
- Field validation inline.
- Backend validation errors mapped to the exact field when possible.
- Review step before any financial or irreversible action.

---

## 8. Analytics Placement

Analytics are page-local.

Overview:
- Org health rollup.
- Needs attention.
- Recent activity.

Agents:
- Per-agent activity, operations, payments, config audit.

Controls:
- Policy decision frequency.
- Simulation outcomes.
- Decision breakdown by action/target.

Operations:
- Rate-limit utilization.
- Decisions by action/tool.
- Live MCP/session status.

Approvals:
- Time to decision.
- Approval/denial/expiry rate.
- Consumption proof.

Treasury:
- Spend over time.
- Budget burn-down.
- Rail success/failure rate.
- Route rejection reasons.
- Liquidity prep latency.
- Provider job success/failure.

Settings:
- No charts unless membership/team growth becomes meaningful later.

---

## 9. Implementation Roadmap

The implementation order must move from least domain-dependent foundation work to the most cross-dependent pages. Each phase follows the same gate:

1. Plan the phase against this spec.
2. Implement only that phase.
3. Run unit/type/lint tests scoped to the changed code.
4. Run browser verification at desktop and mobile widths.
5. Audit visually and functionally against this spec.
6. Refine failures.
7. Re-test.
8. Commit before starting the next phase.

No later phase starts while the current phase has known visual, mobile, functional, or backend-action gaps.

### Phase 0 - Foundation Contract

Purpose:
- Lock the design system and app shell before touching domain pages.

Build:
- Required dependencies and primitive ports.
- Token/radius/elevation/chart system.
- EmptyState variants.
- TableShell.
- Sheet/FocusCanvas.
- Route-aware grouped sidebar.
- Treasury expandable parent.
- Page-jump command palette only.

Verification:
- Desktop shell.
- Mobile shell.
- Sidebar parent/child active states.
- Treasury subroute active states.
- Page-jump command palette.
- EmptyState component variants.
- No card shadows outside overlays.

### Phase 1 - Low-Density Standalone Pages

Purpose:
- Prove the primitives on low-risk pages before rebuilding dense pages.

Build:
- Auth.
- Settings.
- Approvals inbox/history.

Verification:
- Auth signed-out and signed-in states.
- Members and teams CRUD.
- Approval approve/deny and history/detail drawer.
- Mobile cards and filter sheet.
- Empty/loading/error states per page.

### Phase 2 - Agents

Purpose:
- Rebuild identity surfaces before dependent Controls, Operations, and Treasury pages reference agents.

Build:
- Agents list.
- Agent detail tabs.
- Agent update actions.
- Credentials & Wallets tab.
- WalletRefsPanel integration.
- Agent activity tab.

Verification:
- Create agent.
- Edit agent.
- Credential lifecycle.
- Wallet ref attach/detach.
- Activity update after API/MCP call.
- Mobile detail tabs and row cards.

### Phase 3 - Operations

Purpose:
- Make runtime/tool evidence visible before policy creation is reworked.

Build:
- Tool Catalog.
- Rate Limits.
- Decisions.
- Sessions.
- Full row detail sheets and utilization views.

Verification:
- Tool import/edit/archive.
- Rate limit create/edit/disable.
- Rate-limit utilization from counters.
- Decisions filters.
- MCP/session empty and active states.
- Mobile toolbar and card rows.

### Phase 4 - Controls

Purpose:
- Rebuild policy creation after shell, agents, and operations surfaces are stable.

Build:
- Policy library and drafts toggle.
- Policy detail drawer.
- Policy creation Focus Canvas.
- Backend-driven condition fields.
- Validate and simulate.
- Bind, unbind, archive, and create-version flows.

Verification:
- HTTP policy with resource fields only.
- x402 policy with payment fields.
- tool.call policy with tool fields.
- simulation before activation.
- bind/unbind/archive/version actions.
- Mobile full-screen policy builder.
- Empty states for policy library, drafts, and decisions.

### Phase 5 - Treasury Route Split

Purpose:
- Split the densest surface only after shared primitives and less-dense domain pages prove the system.

Build:
- `/payments` Overview.
- `/payments/sources`.
- `/payments/access`.
- `/payments/liquidity`.
- `/payments/activity`.
- Focused data loaders per subroute.
- Detail drawers for payment event, route observation, reservation, provider job, and audit event.

Verification:
- Test mode setup.
- Source creation.
- Rail proof.
- Agent access.
- Gateway deposit.
- Exact wallet top-up.
- Retry/cancel liquidity job.
- Reconcile provider jobs.
- Payment ledger, route, reservation, provider-job detail sheets.
- Mobile Treasury subnav.

### Phase 6 - Overview

Purpose:
- Build the true dashboard after domain pages expose the data it links to.

Build:
- Org health rollup.
- Needs attention.
- Recent org activity.
- Compact agent preview.

Verification:
- Empty org.
- Org with agent but no policies.
- Org with pending approval.
- Org with payment/provider issue.
- Org with rate-limited operation.
- All cards link to the correct source page.

### Phase 7 - Optional Onboarding

Purpose:
- Build optional setup after destination pages exist.

Build:
- Minimal required org creation.
- Optional post-org setup steps.
- Skip/resume state persistence.
- Links into Treasury, Agents, Controls, and runtime test flows.

Verification:
- Create org and skip all optional steps.
- Resume each step later.
- Complete full testnet setup path.
- Mobile stepper.

### Phase 8 - Whole Product Polish

Purpose:
- Final cross-page QA only after all phases pass locally.

Build:
- Cross-page visual alignment.
- Copy cleanup.
- Accessibility fixes.
- Dark mode adjustments.
- Performance cleanup.

Verification:
- Browser pass over every route.
- Desktop and mobile screenshots.
- Keyboard navigation.
- Focus states.
- Empty/loading/error states.
- No fake actions.
- No table infinite growth.
- Drawers do not overlap sidebar.
- Typecheck, lint, tests, and build.

---

## 10. Acceptance Criteria

The redesign is ready only when:

- Every sidebar item maps to a real route.
- Every route uses one of the three layout blueprints.
- Treasury is split into focused subroutes.
- No visible action is a mock, placeholder, or future promise.
- No hidden hardcoded provider/chain/rail choices remain in operator-facing forms.
- Every high-volume table has fixed-height behavior, filters/search where needed, and detail drawers.
- Every financial action has review and confirmation.
- Every policy action form only exposes valid condition fields for that action.
- Every page has local history/evidence where the backend already records it.
- Overview shows true org health, not a duplicate agent list.
- Browser QA proves desktop and mobile layouts do not overlap, overflow, or hide critical actions.
