# agentOps Console UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the authenticated agentOps console redesign in gated phases so every page becomes production-grade, mobile-responsive, backend-backed, visually consistent with the shadcn-fintech reference, and free of mock UI.

**Architecture:** Build the redesign from foundation to dense domains. Phase 0 creates the shared visual system and shell. Later phases rebuild pages in dependency order, each with its own implementation, tests, browser audit, refinement, retest, and commit gate before the next phase starts.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS v4, Vitest, Testing Library, existing server actions, existing API clients, `motion`, `@tabler/icons-react`, and newly approved UI dependencies (`cmdk`, `class-variance-authority`, `date-fns`, `next-themes`, `recharts`).

---

## Source Documents

Read these before implementing any phase:

- `PRODUCT.md`
- `DESIGN.md`
- `docs/audit/2026-07-10-console-feature-data-audit.md`
- `docs/audit/2026-07-10-visual-ux-redesign-spec.md`
- `docs/audit/2026-07-10-codex-handoff-complete-review.md`
- `docs/audit/2026-07-10-visual-gap-report-for-codex.md`

Reference repo:

- `/tmp/shadcn-fintech`
- Use it for structure and component treatment only.
- Keep agentOps vocabulary and backend-backed data ownership.

---

## Non-Negotiable Execution Rules

- Do not build all pages in one pass.
- Do not start a phase until the previous phase passes its tests, browser checks, visual audit, refinement, and retest.
- Do not add a button, menu item, filter, metric, chart, or card unless it maps to real data or a real backend action.
- Do not expose unbuilt features as clickable UI.
- Do not use fake counts, placeholder ledgers, placeholder charts, mock rows, or invented metrics.
- Do not move high-risk actions into generic modals. Use confirmation sheets or Focus Canvas step flows.
- Do not use card shadows for static surfaces. Cards and panels use a 1px ring/border treatment.
- Do not add `@base-ui/react` in Phase 0. Strip polymorphic render patterns from shadcn-fintech ports.
- Keep `@tabler/icons-react`. Mechanically substitute any Lucide icon from ported files.
- Command palette Phase 0 is page-jump only. Entity jump requires a real backend search endpoint and is not part of Phase 0.
- Browser QA uses the running product, not screenshots alone.

---

## Phase Gate Template

Every phase uses this gate:

- [ ] **Plan phase scope**
  - Confirm the files and routes touched by the phase.
  - Confirm no work from a following phase is being pulled in.

- [ ] **Implement**
  - Work only on the phase files.
  - Keep components smaller than the current all-in-one workbench pattern where the split is natural.

- [ ] **Unit/component tests**
  - Add or update Vitest/Testing Library tests covering the changed UI states and actions.

- [ ] **Static verification**
  - Run: `npm --workspace @agentops-pmoa/web run test -- <changed-test-files>`
  - Run: `npm --workspace @agentops-pmoa/web run typecheck`
  - Run: `npm --workspace @agentops-pmoa/web run lint`

- [ ] **Browser verification**
  - Use Chrome DevTools attached to port `9223` when available.
  - Verify desktop width around `1440x900`.
  - Verify tablet width around `1024x768`.
  - Verify mobile width around `390x844`.
  - Confirm no text overlap, no horizontal scroll, no drawer/sidebar collision, and no table infinite growth.

- [ ] **Design audit**
  - Compare against `docs/audit/2026-07-10-visual-ux-redesign-spec.md`.
  - Check ring-based surfaces, radius roles, neutral charts, tint-only semantic states, mobile behavior, and empty states.

- [ ] **Refine**
  - Fix every issue found in tests or browser/design audit.

- [ ] **Retest**
  - Re-run the exact commands and browser checks that exposed failures.

- [ ] **Commit**
  - Commit the phase only after tests and browser checks pass.

---

## Phase 0: Design System And Shell Foundation

**Why first:** Every page depends on these primitives. Building pages before this repeats the current one-off styling problem.

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/ConsoleShell.tsx`
- Modify: `apps/web/src/components/ThemeToggle.tsx`
- Replace or expand: `apps/web/src/components/ui/sidebar.tsx`
- Create: `apps/web/src/components/ui/card.tsx`
- Create: `apps/web/src/components/ui/badge.tsx`
- Create: `apps/web/src/components/ui/table.tsx`
- Create: `apps/web/src/components/ui/chart.tsx`
- Create: `apps/web/src/components/ui/sheet.tsx`
- Create: `apps/web/src/components/ui/tabs.tsx`
- Create: `apps/web/src/components/ui/command.tsx`
- Create: `apps/web/src/components/ui/tooltip.tsx`
- Create: `apps/web/src/components/ui/skeleton.tsx`
- Create: `apps/web/src/components/ui/empty-state.tsx`
- Create: `apps/web/src/components/ui/status-badge.tsx`
- Create: `apps/web/src/components/ui/entity-link.tsx`
- Create: `apps/web/src/components/ui/page-header.tsx`
- Create: `apps/web/src/components/ui/section-toolbar.tsx`
- Create: `apps/web/src/components/ui/table-shell.tsx`
- Create: `apps/web/src/components/ui/focus-canvas.tsx`
- Create: `apps/web/src/components/ConsoleSidebarNav.tsx`
- Create: `apps/web/src/components/CommandPalette.tsx`
- Modify or create tests: `apps/web/tests/console-shell.test.tsx`
- Create tests: `apps/web/tests/ui/design-system.test.tsx`

**Steps:**

- [ ] Add approved dependencies.
  - Run: `npm install --workspace @agentops-pmoa/web cmdk class-variance-authority date-fns next-themes recharts`
  - Expected: `apps/web/package.json` and lockfile update with only these UI dependencies.

- [ ] Port and adapt core primitives.
  - Use `/tmp/shadcn-fintech/src/components/ui/card.tsx`, `badge.tsx`, `table.tsx`, `chart.tsx`, and `sidebar.tsx` as source structure.
  - Replace Lucide icons with Tabler icons.
  - Remove `@base-ui/react` `useRender` and `mergeProps` patterns.
  - Keep ring-based static surfaces and pill badges.

- [ ] Add `EmptyState`.
  - Variants: `agents`, `policies`, `approvals`, `operations`, `treasury`, `payments`, `activity`, `settings`, `search`, `filter`, `generic`.
  - Use restrained SVG/icon compositions and existing `motion`.
  - No marketing copy.

- [ ] Add `TableShell`.
  - Fixed max-height.
  - Sticky header support.
  - Hidden visual scrollbar while preserving scroll behavior.

- [ ] Add `FocusCanvas`.
  - Desktop: content-edge sheet.
  - Mobile: full-screen sheet.
  - Sticky footer actions.

- [ ] Replace shell navigation.
  - Keep `ConsoleShell` server-rendered.
  - Move route-derived active state into `ConsoleSidebarNav.tsx`.
  - Add grouped nav: Workspace, Identity, Runtime, Treasury, Org.
  - Treasury parent label: `Treasury`; route remains `/payments`.
  - Treasury children: Overview, Sources & Rails, Agent Access, Liquidity, Activity & Evidence.

- [ ] Add command palette page jump only.
  - Entries only navigate to routes.
  - Do not add entity results.
  - Add a visible or keyboard-triggered launcher consistent with the shell.

- [ ] Tests.
  - Verify sidebar renders groups and Treasury children.
  - Verify active state for `/payments`, `/payments/sources`, `/payments/access`, `/payments/liquidity`, `/payments/activity`.
  - Verify command palette has page entries and no entity placeholders.
  - Verify static cards do not include shadow classes.

- [ ] Browser QA.
  - Verify sidebar expanded/collapsed behavior.
  - Verify Treasury subnav on mobile.
  - Verify command palette keyboard open/close and navigation.
  - Verify sheets do not overlap sidebar.

**Phase 0 exit criteria:**
- Shell looks production-ready before any domain page redesign starts.
- The command palette does not pretend to search entities.
- The visual system rules are enforceable by tests and browser inspection.
- Interactive primitives are keyboard-operable and screen-reader labeled where they expose controls.

---

## Phase 1: Low-Density Standalone Pages

**Why second:** These pages exercise primitives without the Treasury and Controls complexity.

**Routes:**
- `/auth`
- `/app/{orgSlug}/settings`
- `/app/{orgSlug}/approvals`

**Files:**
- Modify: `apps/web/src/app/auth/page.tsx`
- Modify: `apps/web/src/components/AuthEntryShell.tsx`
- Modify: `apps/web/src/app/app/[orgSlug]/settings/page.tsx`
- Modify: `apps/web/src/app/app/[orgSlug]/approvals/page.tsx`
- Modify: `apps/web/src/app/actions/workspace.ts`
- Modify: `apps/web/src/app/actions/approvals.ts`
- Create or modify tests under `apps/web/tests/settings/` and `apps/web/tests/approvals/`

**Steps:**

- [ ] Rebuild Auth using the Focus/Index patterns.
  - Signed-out state: Google OAuth action only.
  - Signed-in state: workspace list with org name and role.
  - No marketing feature grid.

- [ ] Rebuild Settings.
  - Tabs: Members, Teams, Org Profile.
  - Members: list, add, role change, remove.
  - Teams: list, create, update, archive.
  - Org Profile: only fields backed by current APIs.

- [ ] Rebuild Approvals.
  - Tabs: Inbox and History.
  - Inbox table/card rows: request, agent, decision required, amount/resource, age/expires, status.
  - Row sheet: context, matched policy details when present in approval context, approval actions, consumption proof.
  - Approve/deny via confirmation sheet with optional `note` field submitted through the existing approval action.

- [ ] Empty/loading/error states.
  - Auth: no workspace state.
  - Settings: owner-only members state and default-team state.
  - Approvals: no pending approvals and no history states.

- [ ] Mobile behavior.
  - Auth full-width panel.
  - Settings row cards and trailing action menu.
  - Approvals filter sheet and card rows.

- [ ] Tests.
  - Member add/update/remove actions are still wired.
  - Team create/update/archive actions are still wired.
  - Approve/deny forms call server actions.
  - Empty states render for no data.

**Phase 1 exit criteria:**
- Three low-density pages match the new shell and primitives.
- No old stacked-card clutter remains.
- All page actions are backend-backed.

---

## Phase 2: Agents

**Why third:** Agents are core identity objects used by Controls, Operations, Treasury, and Overview.

**Routes:**
- `/app/{orgSlug}/agents`
- `/app/{orgSlug}/agents/{agentId}`

**Files:**
- Modify: `apps/web/src/app/app/[orgSlug]/agents/page.tsx`
- Modify: `apps/web/src/app/app/[orgSlug]/agents/[agentId]/page.tsx`
- Modify: `apps/web/src/components/agents/AgentRoster.tsx`
- Modify: `apps/web/src/components/agents/AgentDetailShell.tsx`
- Modify: `apps/web/src/components/agents/ConnectionPanel.tsx`
- Modify: `apps/web/src/components/agents/WalletRefsPanel.tsx`
- Modify: `apps/web/src/components/agents/AgentLiveActivity.tsx`
- Modify: `apps/web/tests/agents/agent-roster.test.tsx`
- Modify: `apps/web/tests/agents/agent-detail-shell.test.tsx`
- Modify: `apps/web/tests/agents/connection-panel.test.tsx`

**Steps:**

- [ ] Preserve the Agents list workflow.
  - Header inline create control: input placeholder `Authorize a new agent`, pill button `Add`.
  - Table columns: agent, team, status, credential state, policy coverage, last activity.

- [ ] Rebuild Agent Detail into tabs.
  - Overview.
  - Policies & Access.
  - Credentials & Wallets.
  - Activity.

- [ ] Surface backend-backed fields.
  - Agent hierarchy.
  - Description and labels returned by `getAgentDetail` or `listAgents`.
  - Wallet refs with attach/detach.
  - Active policy bindings and allowed actions.
  - Payment access summary linking to `/payments/access`.

- [ ] Keep credential operations explicit.
  - Create credential.
  - Rotate credential via confirmation sheet.
  - Revoke credential via confirmation sheet.
  - Test credential only if the product still intentionally supports the action.

- [ ] Activity tab.
  - Live activity.
  - Configuration audit.
  - Operation decisions filtered to agent.
  - Payment events filtered to agent when available.

- [ ] Tests and browser QA.
  - Create agent works.
  - Agent update works.
  - Credential lifecycle still works.
  - Wallet refs attach/detach works.
  - Activity updates after API/MCP call.
  - Mobile tabs and row cards do not overflow.

**Phase 2 exit criteria:**
- Agent detail becomes a real operator console, not a long stack.
- Wallet refs are no longer dead UI.
- The page remains identity-first and does not lead with payments.

---

## Phase 3: Operations

**Why fourth:** Operations provides runtime evidence needed before Controls and Overview can summarize system behavior cleanly.

**Route:**
- `/app/{orgSlug}/operations`

**Files:**
- Modify: `apps/web/src/app/app/[orgSlug]/operations/page.tsx`
- Modify: `apps/web/src/components/operations/OperationsWorkbench.tsx`
- Modify: `apps/web/src/app/actions/operations.ts`
- Modify: `apps/web/src/lib/server/operations-client.ts`
- Modify: `apps/web/tests/operations/operations-workbench.test.tsx`

**Steps:**

- [ ] Split Operations into tabs.
  - Tool Catalog.
  - Rate Limits.
  - Decisions.
  - Sessions.

- [ ] Tool Catalog.
  - Import tool.
  - Edit tool.
  - Archive tool.
  - Detail sheet with schema/context.

- [ ] Rate Limits.
  - Create limit.
  - Edit limit.
  - Disable limit.
  - Utilization from `operational_rate_counters`.

- [ ] Decisions.
  - Include all decision values returned by the operations API: allow, deny, observe, and rate_limited. If the current route filters any of these out, extend the operations route and client in this phase before building the table.
  - Filters: agent, decision, action, date.

- [ ] Sessions.
  - Show `mcp_sessions` live/idle/offline.
  - Empty state explains sessions appear after agent connection.

- [ ] Tests and browser QA.
  - Tool actions still call backend.
  - Rate-limit actions still call backend.
  - Filters work.
  - Mobile cards and filter sheet work.

**Phase 3 exit criteria:**
- Operations is no longer write-only for rate limits.
- Runtime evidence is readable before Controls and Overview consume it.

---

## Phase 4: Controls

**Why fifth:** Controls is high-stakes policy authoring and needs stable shell, agents, and operations surfaces first.

**Route:**
- `/app/{orgSlug}/controls`

**Files:**
- Modify: `apps/web/src/app/app/[orgSlug]/controls/page.tsx`
- Modify: `apps/web/src/components/controls/ControlsLibrary.tsx`
- Modify: `apps/web/src/components/controls/PolicyDraftBuilder.tsx`
- Modify: `apps/web/src/app/actions/policy.ts`
- Modify: `apps/web/src/lib/server/policy-client.ts`
- Modify: `apps/web/tests/controls/controls-library.test.tsx`

**Steps:**

- [ ] Rebuild Controls as an Index workbench.
  - Policy Library default.
  - Drafts toggle.
  - Bindings segment.
  - Decision history segment.

- [ ] Replace policy creation with Focus Canvas.
  - Step 1: action surface and decision.
  - Step 2: valid conditions only, driven by backend metadata.
  - Step 3: scope and target preview.
  - Step 4: validate and simulate.
  - Step 5: review and create draft.

- [ ] Detail sheets.
  - Policy detail: version, bindings, statements, simulation history, decisions.
  - Draft detail: edit, discard, validate, simulate, activate.
  - Binding detail: target and remove binding.

- [ ] Lifecycle actions.
  - Edit draft.
  - Discard draft.
  - Validate draft.
  - Simulate draft.
  - Activate draft.
  - Bind/unbind policy.
  - Archive policy.
  - Create new version.

- [ ] Tests and browser QA.
  - HTTP policies show resource fields only.
  - x402 policies show payment fields.
  - tool.call policies show tool fields.
  - Invalid action/condition combinations cannot be submitted.
  - Simulation works before activation.
  - Mobile policy builder is full-screen and readable.

**Phase 4 exit criteria:**
- Policy authoring no longer mixes unrelated condition fields.
- Drafts, bindings, versions, simulations, and decisions are all discoverable.

---

## Phase 5: Treasury Route Split

**Why sixth:** Treasury is the densest domain and should only be rebuilt after the shell, tables, sheets, forms, and core identity pages are proven.

**Routes:**
- `/app/{orgSlug}/payments`
- `/app/{orgSlug}/payments/sources`
- `/app/{orgSlug}/payments/access`
- `/app/{orgSlug}/payments/liquidity`
- `/app/{orgSlug}/payments/activity`

**Files:**
- Modify: `apps/web/src/app/app/[orgSlug]/payments/page.tsx`
- Create: `apps/web/src/app/app/[orgSlug]/payments/sources/page.tsx`
- Create: `apps/web/src/app/app/[orgSlug]/payments/access/page.tsx`
- Create: `apps/web/src/app/app/[orgSlug]/payments/liquidity/page.tsx`
- Create: `apps/web/src/app/app/[orgSlug]/payments/activity/page.tsx`
- Split: `apps/web/src/components/payments/PaymentsWorkbench.tsx`
- Create: `apps/web/src/components/payments/TreasuryOverview.tsx`
- Create: `apps/web/src/components/payments/TreasurySourcesRails.tsx`
- Create: `apps/web/src/components/payments/TreasuryAgentAccess.tsx`
- Create: `apps/web/src/components/payments/TreasuryLiquidity.tsx`
- Create: `apps/web/src/components/payments/TreasuryActivity.tsx`
- Modify: `apps/web/src/lib/server/payments-client.ts`
- Modify: `apps/web/src/app/actions/payments.ts`
- Modify: `apps/web/tests/payments/payments-workbench.test.tsx`
- Add focused tests under `apps/web/tests/payments/`

**Steps:**

- [ ] Create focused loaders.
  - Overview loader: high-level balance, readiness summary, failed jobs/payments, access count.
  - Sources loader: treasuries, sources, capabilities, wallets, balances, readiness.
  - Access loader: agents, agent payment accounts, verified rails, recent spend.
  - Liquidity loader: provider jobs, liquidity jobs, recommendations, balances.
  - Activity loader: payment events, route observations, reservations, provider jobs, audit events.

- [ ] Rebuild `/payments`.
  - Treasury overview only.
  - No setup tables.
  - No long ledgers.
  - Links to focused subroutes.

- [ ] Build `/payments/sources`.
  - Sources, Rails, Wallets segments.
  - Source creation Focus Canvas.
  - Sync Circle wallet.
  - Run rail proof.
  - Run unverified proofs.
  - Testnet faucet.

- [ ] Build `/payments/access`.
  - Agent payment access table.
  - Edit drawer with budget, cap, threshold, allowed verified rails.
  - Access disabled by default.

- [ ] Build `/payments/liquidity`.
  - Jobs, Recommendations, Deposits, Top-ups.
  - Gateway deposit Focus Canvas.
  - Bridge/top-up Focus Canvas.
  - Retry/cancel/reconcile actions.

- [ ] Build `/payments/activity`.
  - Ledger, Routes, Reservations, Provider Jobs, Audit tabs.
  - Detail sheets for each evidence type.

- [ ] Tests and browser QA.
  - Every existing payment action still works from its new route.
  - All ten testnet rails render with verified/unverified state from backend data.
  - No route fetches the full old `PaymentsWorkbench` payload.
  - Mobile Treasury subnav is usable.
  - Ledgers have fixed-height behavior and detail drawers.

**Phase 5 exit criteria:**
- Payments is no longer one long page.
- Treasury complexity is progressive.
- Operators can understand status before handling chain-specific details.

---

## Phase 6: Overview Dashboard

**Why seventh:** Overview depends on stable domain routes and summary data from the prior phases.

**Route:**
- `/app/{orgSlug}/overview`

**Files:**
- Modify: `apps/web/src/app/app/[orgSlug]/overview/page.tsx`
- Create: `apps/web/src/components/overview/OverviewDashboard.tsx`
- Modify summary clients explicitly: `apps/web/src/lib/server/identity-spine-client.ts`, `apps/web/src/lib/server/approval-client.ts`, `apps/web/src/lib/server/payments-client.ts`, `apps/web/src/lib/server/operations-client.ts`, and `apps/web/src/lib/server/audit-client.ts`.
- Add tests under `apps/web/tests/overview/`

**Steps:**

- [ ] Build Aggregator dashboard.
  - Active agents.
  - Pending approvals.
  - Treasury available.
  - Blocked/rate-limited actions in last 24h.

- [ ] Build Needs Attention.
  - Pending approval older than threshold.
  - Agent with no active policy binding.
  - Payment rail not verified.
  - Failed payment/provider job.
  - Rate limit repeatedly hit.

- [ ] Build recent activity.
  - Org-wide activity feed.
  - Links to source pages.

- [ ] Keep actions as links.
  - No mutation forms on Overview.

- [ ] Tests and browser QA.
  - Empty org.
  - Agent but no policy.
  - Pending approval.
  - Payment/provider issue.
  - Rate-limited action.
  - Mobile stacked layout.

**Phase 6 exit criteria:**
- Overview becomes a true dashboard and not another agent list.
- Every card links to a real source page.

---

## Phase 7: Optional Onboarding

**Why eighth:** Optional onboarding links into pages built in earlier phases. Building it earlier would create dead paths or weak shortcuts.

**Route:**
- `/onboarding`

**Files:**
- Modify: `apps/web/src/app/onboarding/page.tsx`
- Modify: `apps/web/src/app/actions/identity-spine.ts`
- Modify: `apps/web/src/app/actions/workspace.ts`
- Create: `apps/web/src/components/onboarding/OnboardingWizard.tsx`
- Add tests under `apps/web/tests/onboarding/`

**Steps:**

- [ ] Keep required setup minimal.
  - Organization name is the only required first action.

- [ ] Add optional setup steps.
  - Sync Circle wallet.
  - Fund treasury.
  - Create first agent.
  - Create credential.
  - Attach starter policy.
  - Enable payment access.
  - Test API/MCP request.

- [ ] Add skip/resume.
  - Persist skipped and completed states in `org_onboarding_states`.
  - Never block console access after org creation.

- [ ] Tests and browser QA.
  - Create org and skip optional setup.
  - Resume each step from Settings or onboarding route.
  - Complete full testnet setup path.
  - Mobile stepper is usable.

**Phase 7 exit criteria:**
- Onboarding helps setup without becoming a gate.
- Every step links to or performs real functionality.

---

## Phase 8: Whole Product Polish And Release QA

**Why last:** This phase only runs after every route is functionally redesigned.

**Files:**
- Modify route/component files only where audit finds concrete issues.
- Update tests only for real behavior changes.

**Steps:**

- [ ] Full route browser pass.
  - `/auth`
  - `/onboarding`
  - `/app/{orgSlug}/overview`
  - `/app/{orgSlug}/agents`
  - `/app/{orgSlug}/agents/{agentId}`
  - `/app/{orgSlug}/controls`
  - `/app/{orgSlug}/operations`
  - `/app/{orgSlug}/approvals`
  - `/app/{orgSlug}/payments`
  - `/app/{orgSlug}/payments/sources`
  - `/app/{orgSlug}/payments/access`
  - `/app/{orgSlug}/payments/liquidity`
  - `/app/{orgSlug}/payments/activity`
  - `/app/{orgSlug}/settings`

- [ ] Full functional smoke.
  - Create agent.
  - Credential lifecycle.
  - Create and simulate policy.
  - Bind/unbind policy.
  - Create/update rate limit.
  - Approve/deny approval.
  - Configure payment access.
  - Run rail proof.
  - View payment activity evidence.
  - Member/team actions.

- [ ] Full visual audit.
  - No card shadows on static surfaces.
  - No nested cards.
  - No fake metrics.
  - No table grows without bound.
  - No drawer overlaps sidebar.
  - Empty states are designed and page-specific.
  - Mobile has no horizontal scroll.
  - Dark mode is restrained and readable.

- [ ] Full command verification.
  - Run: `npm --workspace @agentops-pmoa/web run test`
  - Run: `npm --workspace @agentops-pmoa/web run typecheck`
  - Run: `npm --workspace @agentops-pmoa/web run lint`
  - Run: `npm --workspace @agentops-pmoa/web run build`

**Phase 8 exit criteria:**
- The product is visually and functionally production-ready across the authenticated console.
- Every visible control is backed by real backend behavior.
- Every route has verified desktop and mobile behavior.

---

## Recommended Commit Boundaries

- `ui: add console design system primitives`
- `ui: rebuild console shell navigation`
- `ui: redesign auth settings and approvals`
- `ui: redesign agent registry and detail`
- `ui: redesign operations workbench`
- `ui: redesign controls policy workbench`
- `ui: split treasury console routes`
- `ui: build overview dashboard`
- `ui: add optional onboarding wizard`
- `ui: polish console responsive states`

---

## Completion Checklist

The redesign is complete only when all are true:

- [ ] Every phase has a commit.
- [ ] Every phase has tests.
- [ ] Every phase has browser evidence.
- [ ] Every route exists and is reachable from the sidebar or onboarding flow.
- [ ] Every sidebar item maps to a real route.
- [ ] Every visible action is backed by a server action or route.
- [ ] Command palette page jumps work and entity search is not falsely exposed.
- [ ] Treasury is split into five focused routes.
- [ ] Controls policy builder is action-specific and backend-metadata-driven.
- [ ] Overview is a true org dashboard.
- [ ] Empty/loading/error states are page-specific.
- [ ] Mobile layouts are verified route by route.
- [ ] `npm --workspace @agentops-pmoa/web run test` passes.
- [ ] `npm --workspace @agentops-pmoa/web run typecheck` passes.
- [ ] `npm --workspace @agentops-pmoa/web run lint` passes.
- [ ] `npm --workspace @agentops-pmoa/web run build` passes.
