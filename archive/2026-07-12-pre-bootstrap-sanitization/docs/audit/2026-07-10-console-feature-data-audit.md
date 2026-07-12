# agentOps Console Feature & Data Audit

Date: 2026-07-10
Scope: `apps/web/src/app/[orgSlug]/*` (BUILD-PMOA operator console only — Overview, Agents, Controls, Operations, Payments, Approvals, plus Auth and Onboarding). Landing/marketing sites are out of scope.

Purpose: ground the upcoming visual-redesign spec and per-page-analytics spec in what actually exists today — real pages, real columns, real actions — instead of assumptions. This document does not propose designs; it inventories current state.

Reference: `shadcn-fintech` (github.com/abderrahimghazali/shadcn-fintech, MIT) was reviewed live and via its source tree as a candidate visual/component foundation. Each page section below notes the closest structural pattern from that reference. Its wallet-first/crypto-trading framing conflicts with `PRODUCT.md`'s anti-references and will not be copied as-is — only structure, motion, and component patterns transfer.

---

## 1. Overview (`overview/page.tsx`)

**Purpose:** Workspace summary — org identity + agent roster with counts. Nothing else.

**Data shown:** `orgs` (display_name, slug, settings, status) + `agents` joined with `teams`/`connections`/`wallet_refs` via `listAgents()`. Renders: agent name/id, team, connection-health pill, status pill. Computes active/connected counts client-side by filtering the same array.

**Actions & forms:** None — 100% read-only. Links out to Agents page.

**Current gaps:**
- Ignores every other section (Payments, Approvals, Operations, Controls) despite being the org's front door — not actually an "overview" of the org, just an agent list summary.
- `agent.labels` and `agent.default_environment` fetched but never rendered.
- Static heading copy regardless of real state.

**Analytics opportunity:** This page is the natural home for the cross-section rollup (see §14 below) — pending approvals, payment health, blocked-operations trend, policy coverage gaps, recent critical audit events.

**shadcn-fintech pattern fit:** `Dashboard` page (`financial-overview` chart + stat cards + `quick-transfer`-style action shortcuts) — but content replaced with operational signals, not money-first framing.

---

## 2. Agents (`agents/page.tsx`, `agents/[agentId]/page.tsx`)

**Purpose:** Agent registry (list + create) and per-agent detail console (identity, policies, operational access, credentials, activity).

**Data shown:**
- List: same `listAgents()` as Overview, fuller table (avatar, name, id, team, connection_health, status).
- Detail, in parallel: `getAgentDetail` (agents + teams + parent agent + connections + wallet_refs aggregates + children + up to 50 `audit_events` rows filtered to `event_category='configuration'`), `getAgentActivityFeed` (merges `activity_items` + configuration `audit_events`, computes live/idle/offline from `connections.last_used_at` vs `activity_items.created_at`), `listAgentPolicies` (`policy_versions` + `policy_bindings`), `listAgentAllowedActions` (`policy_versions`/`policy_bindings` expanded to runtime actions), `listBlockedOperations` (`operational_decisions`, last 12).

**Actions & forms:**
- Create agent → writes `agents` (form only collects `name`; schema also supports team_id/parent_agent_id/description/labels/default_environment — unused).
- Pause/Activate/Deactivate → `agents.status`.
- Create/Test/Rotate/Revoke credential → `connections` + `connection_credentials`.
- Zod validation lives server-side in `apps/api/src/engines/identity/routes.ts`; client-side is HTML `required` only. Nothing in `packages/contracts` covers agent/policy schemas.

**Current gaps:**
- `WalletRefsPanel` component and its actions (`attachWalletRefAction`/`detachWalletRefAction`) are fully built and API-backed but **never rendered** — dead UI, live data (`wallet_refs`).
- Agent hierarchy (`parent`/`children`) returned by the API, never displayed.
- No "update agent" UI despite a working `PATCH` endpoint (rename, team change, description, labels).
- No team management UI at all despite full `teams` CRUD server-side.

**Analytics opportunity:** Per-agent policy/decision/payment activity is already assembled server-side (`getAgentActivityFeed`, `listBlockedOperations`) — extending this into a proper "Activity & history" tab per agent (not just a 5s-polled list) is close to free.

**shadcn-fintech pattern fit:** List → `Accounts` grid/table; Detail → `Cards` page's per-item detail panel + `investments/watchlist`-style activity list.

---

## 3. Controls (`controls/page.tsx`)

**Purpose:** Policy authoring/lifecycle — draft, validate, activate, bind policies to org/team/agent/connection.

**Data shown:** `listPolicyLibrary()` → `policy_drafts` (all columns) + `policy_versions` joined to active `policy_bindings` counts and full binding rows. `bindTargets` (teams/agents/connections) computed client-side for the bind `<select>` — the API's own `binding_target_label` is always `''`.

**Actions & forms:**
- Create draft → `policy_drafts` (UI always builds exactly one statement, `audit: 'detailed'`).
- Validate → server-side `validatePolicyStatements()` (custom logic, not Zod) against `policy_action_registry`.
- Activate → new `policy_versions` row (always version 1).
- Bind → `policy_bindings`, validated against `policy_action_registry`/target existence.
- Client validation is HTML `required` only; which condition fields show (resource/payment/tool) is a hand-maintained `fieldEnabled` map in `PolicyDraftBuilder.tsx`, duplicating (and risking drift from) the server's `actionConditionSupport` map.

**Current gaps:**
- No unbind action — `policy_bindings.status` supports `'removed'` but nothing ever sets it.
- No draft discard/edit — `policy_drafts.status` supports `'discarded'`, never used.
- No policy versioning UI — every edit is a brand-new policy, always version 1.
- Action/condition metadata is hardcoded in two separate places in the UI (`PolicyDraftBuilder.tsx`, `ControlsLibrary.tsx`) instead of reading `policy_action_registry` directly.
- `policy_simulations` table (dry-run a draft against a hypothetical request) exists server-side with zero UI — not just an analytics gap, a whole feature never exposed.

**Analytics opportunity:** `policy_decisions` (the master allow/deny/approval_required/observe log across the whole system) has **no UI anywhere** — Controls is the natural home for "which policies are firing, how often, on what."

**shadcn-fintech pattern fit:** No direct match — the reference has no policy/rules builder. The multi-step draft → validate → activate → bind flow needs a fresh wizard/stepper pattern (candidate: adapt `shadcn/ui`'s `Tabs`/`Dialog`/`Command` primitives into a stepper, since the reference itself has no stepper component).

---

## 4. Operations (`operations/page.tsx`)

**Purpose:** Tool catalog management, blocked/rate-limited operation review, rate-limit configuration.

**Data shown:** `tool_catalog` (active tools), `operational_decisions` (deny/rate_limited only, last 50, no filter), `agents` (for the rate-limit form's agent picker).

**Actions & forms:**
- Import tool → upserts `tool_catalog`.
- Create request limit → `operational_rate_limits` (form always sends `target_type: 'agent'` even though org/team/connection are valid).

**Current gaps:**
- Rate-limit form is write-only — no list/view/disable of existing `operational_rate_limits`.
- No tool edit/archive UI despite `tool_catalog.status` supporting `'archived'`.
- No pagination/agent-filter on blocked actions despite `listBlockedOperations` supporting it.
- `listAgentAllowedActions` implemented server-side, never called from this page.

**Analytics opportunity:** `operational_rate_counters` (actual consumption per rate limit/agent/window) has **zero UI** — this is the direct data source for a "rate limit utilization" chart. `operational_decisions` currently only shows denies — a full allow/deny/observe/rate_limited trend view is straightforward from the same table.

**shadcn-fintech pattern fit:** `Transactions` page's stat-tiles + filterable/searchable table pattern maps directly onto both the tool catalog and the blocked-operations list.

---

## 5. Payments (`payments/page.tsx`)

**Purpose:** Treasury/Circle Agent Wallet setup, Gateway/x402 rail configuration, liquidity job monitoring, per-agent payment budgets.

**Data shown:** `org_treasuries`, `payment_sources`, `circle_provider_jobs` (all job types), `circle_chain_capabilities` with settlement-verification flags, `circle_wallet_sets`/`circle_chain_wallets`, `agent_payment_accounts` (per agent), `org_payment_modes`, `payment_events`, `payment_route_observations`, `payment_reservations`, live Circle balances, rail-readiness diagnostics, and server-computed rebalance recommendations.

**Actions & forms:** Provider mode toggle; Sync Agent Wallet; Gateway deposit; Testnet faucet (test-mode only); Reconcile provider jobs; Bridge exact wallet top-up; Retry/Cancel liquidity job; Run rail proof for one rail or all unverified rails; Create treasury; Create Gateway source with explicit provider/chain/rail; Set agent payment access with budget, per-request cap, approval threshold, and settlement-verified exact/Gateway rails.

**Current gaps:**
- The page is now the densest surface in the product: setup, diagnostics, sources, balances, agent budgets, reservations, provider jobs, route observations, liquidity jobs, rail proofs, and event ledgers all compete in one long page. This is functionally real, but not cognitively sustainable.
- Payment events, route observations, reservations, and provider jobs are shown as recent snippets, not full operator ledgers with filters, pagination, export, or detail drawers.
- Treasury setup, source/rail diagnostics, agent access, liquidity management, and payment history are separate operator jobs but currently share one route and one large data load.
- Settlement verification is correctly explicit, but the UI still needs clearer separation between "Circle supports this rail", "agentOps has verified this rail for this org/mode", and "this rail is enabled for an agent".
- Reconcile/retry affordances exist for some provider/liquidity failures, but the operator cannot yet open a job detail drawer that explains every failure reason and available next action.

**Analytics opportunity:** The raw data is now surfaced, but not yet composed. `payment_events`, `payment_route_observations`, `payment_reservations`, `circle_provider_jobs`, and `agent_payment_accounts` can support spend-over-time, rail success rates, per-agent budget burn-down, rejected-route reasons, liquidity-prep latency, settlement-failure rate, and approval-threshold hit rate. These belong inside Payments/Treasury subroutes, not a global analytics page.

**shadcn-fintech pattern fit:** `Accounts` + `Transfers` pages (balances/sources list, transfer stats) for the setup surfaces; `Analytics` page's month-over-month + category-style breakdowns for the payment-events history once built; `Transactions` table pattern for `circle_provider_jobs`/`payment_events` listings.

---

## 6. Approvals (`approvals/page.tsx`)

**Purpose:** Inbox for one-time human approval decisions from runtime policy checks.

**Data shown:** `listApprovals()` — **all** `approval_requests` rows for the org, no limit/offset, ordered by created_at desc. Context (resource/payment/tool) parsed client-side from the jsonb `context` column.

**Actions & forms:** Approve/Deny → update `approval_requests.status` + insert `approval_actions`; both always send a fixed canned note string — no free-text reason field exists in the UI.

**Current gaps:**
- No status filter (pending/approved/denied/expired/consumed) or pagination — `listApprovals` itself has no limit param; will not scale.
- No expiry countdown despite `expires_at` = created_at + 15 minutes — a pending approval can silently go stale with no visual warning.
- No display of `approval_actions` (who requested/approved/denied) on this page.

**Analytics opportunity:** `approval_actions` (full audit trail) and `approval_consumptions` (proof an approval was actually used at runtime) both have **zero UI** — an approvals history/analytics view (approval rate, average time-to-decision, denial reasons) is straightforward from existing data.

**shadcn-fintech pattern fit:** `Transactions` table pattern (status badges, filters, search) is a near-exact structural match for a redesigned Approvals inbox + history.

---

## 7. Auth (`auth/page.tsx`)

**Purpose:** Google OAuth entry + workspace picker.

**Data shown:** `getCurrentSession()` → `auth_sessions` + `users`, workspace list from `memberships` joined to `orgs`.

**Actions & forms:** "Continue with Google" (OAuth start/callback flow) → writes `users`, `oauth_accounts`, `auth_sessions`. Logout exists (`ConsoleShell`, not this page) → revokes `auth_sessions`.

**Current gaps:**
- Google-only, no fallback; no UI distinction between "session expired" and "never logged in" beyond two error codes.
- `oauth_accounts.email_verified` captured but never checked/gated on anywhere.
- No session-management UI (list/revoke active sessions).

**Analytics opportunity:** Low priority for analytics — this is an entry surface, not an operational one.

**shadcn-fintech pattern fit:** `(auth)` route group (`sign-in`/`sign-up` pages) — simple centered-card auth layout, directly transferable.

---

## 8. Onboarding (`onboarding/page.tsx`)

**Purpose:** Single-step "create your organization" form for signed-in users with zero orgs.

**Data shown:** Session presence only; redirects to `/auth` or straight into the org if one already exists.

**Actions & forms:** Create organization (name only) → writes `orgs`, `memberships` (role=owner), `teams` (default team), `org_onboarding_states` (flow_key='section_1_foundation', inserted directly as `completed`).

**Current gaps:**
- Form only collects `name`; schema/backend fully support `domain`, `primary_use_case`, `slug` — always stored null.
- `org_onboarding_states` is schema-designed for a multi-step, multi-flow wizard (`flow_key`, `status: not_started|in_progress|completed`) but only one flow is ever written, always synchronously complete — no in-progress multi-step onboarding UI exists today despite the data model being ready for one.
- No inline error handling (`createOrgAction` has no try/catch, unlike sibling identity actions).
- No slug-conflict feedback even though the backend silently appends a suffix when a name collides.

**Analytics opportunity:** N/A (onboarding is a one-time flow, not an ongoing operational surface).

**shadcn-fintech pattern fit:** No equivalent (the reference has no onboarding flow) — this is exactly the kind of low-cognitive-load multi-step form the user wants; will need a fresh stepper design, likely reusing whatever stepper primitive gets built for the Controls policy-draft flow.

---

## 9. Full data model map

### Identity/org
| Table | Stores | Current UI |
|---|---|---|
| `orgs` | org identity, slug, settings | Overview, Onboarding, Auth |
| `users` | user identity | Auth |
| `memberships` | org↔user role/status | Written by Onboarding only — **no member management UI exists anywhere** (no invite, no role change, no view of who's in the org) |
| `teams` | team identity, default flag | Read-only dropdown in Controls; **no team management UI** |
| `agents` | agent identity/status/hierarchy | Overview, Agents, Controls, Operations, Payments |
| `connections` | runtime credentials | Agents, Controls, Operations |
| `connection_credentials` | hashed secrets | Backend only (by design) |
| `wallet_refs` | attached wallet references | Fetched, **never rendered** (dead `WalletRefsPanel`) |
| `oauth_accounts` | Google OAuth identity | Backend only |
| `auth_sessions` | session tokens | Backend only, no session-mgmt UI |
| `org_onboarding_states` | onboarding flow progress | Write-only, single flow, no multi-step UI |

### Audit/evidence
| Table | Stores | Current UI |
|---|---|---|
| `audit_event_heads` | hash-chain tip per org | None (integrity-only) |
| `audit_events` | canonical, hash-chained event log (domain/category/severity/tags/related_*) | Partially surfaced only inside Agent Detail, filtered to `event_category='configuration'` — **no org-wide audit log page** despite this being the richest, most structured table in the schema |

### Operations
| Table | Stores | Current UI |
|---|---|---|
| `tool_catalog` | managed tool registry | Operations (import only) |
| `operational_rate_limits` | configured rate limits | Operations (create-only, write-only form) |
| `operational_rate_counters` | actual consumption per limit/window | **No UI** |
| `operational_decisions` | every allow/deny/observe/rate_limited runtime decision | Operations (deny/rate_limited only), Agent Detail (last 12) |
| `mcp_sessions` | live MCP session tracking | **No UI** |
| `connection_rate_limits` | per-connection rate counters | **No UI** |

### Policy/approvals
| Table | Stores | Current UI |
|---|---|---|
| `policy_action_registry` | canonical action catalog | Read server-side only; UI hand-duplicates it in two places |
| `policy_drafts` | in-progress policy authoring | Controls (create/validate/activate; no discard/edit) |
| `policy_versions` | activated, immutable policy versions | Controls (no versioning/archive UI) |
| `policy_bindings` | policy↔target attachments | Controls (bind-only, no unbind) |
| `policy_decisions` | master allow/deny/approval_required/observe log, system-wide | **No direct UI anywhere** |
| `policy_simulations` | dry-run a draft against a hypothetical request | **No UI** — unexposed feature, not just missing analytics |
| `approval_requests` | pending/resolved human approvals | Approvals (no filter/pagination/expiry UI) |
| `approval_actions` | approval audit trail | **No UI** |
| `approval_consumptions` | proof an approval was used at runtime | **No UI** |

### Payments/treasury
| Table | Stores | Current UI |
|---|---|---|
| `org_treasuries` | treasury config | Payments |
| `payment_sources` | funding sources/rails | Payments (explicit provider/chain/rail source creation) |
| `agent_payment_accounts` | per-agent budget/caps/rails | Payments (budget, per-request cap, approval threshold, allowed rails) |
| `payment_route_observations` | routing accept/reject history | Payments (recent route observations only) |
| `payment_reservations` | in-flight payment holds | Payments (recent reservations only) |
| `payment_events` | full payment ledger | Payments (recent ledger only) |
| `org_payment_modes` | test/live toggle | Payments |
| `circle_chain_capabilities` | per-chain provider capability | Payments (diagnostics) |
| `circle_wallet_sets` / `circle_chain_wallets` | Circle wallet infra | Payments |
| `circle_provider_jobs` | all provider job types | Payments (liquidity-job subset only; other job types not filterable) |

### Cross-cutting
| Table | Stores | Current UI |
|---|---|---|
| `activity_items` | merged runtime/policy/approval/payment activity feed | Agent Detail only (per-agent) — **no org-wide activity feed** |

---

## 10. Overview-dashboard candidate signals

Pulled from the per-page analytics-opportunity sections above, shortlisted for the Overview page rollup (vs. staying page-local):

1. **Pending approvals** — count + oldest-pending age, from `approval_requests` (urgency signal, currently invisible outside the Approvals inbox itself).
2. **Payment health** — current treasury balance, today's spend vs. budget, any recent `failed` `payment_events`, and any settlement-supported rails that still lack org-level verification.
3. **Blocked/rate-limited operations trend** — rolling count from `operational_decisions`.
4. **Policy coverage gaps** — agents with zero active `policy_bindings` (computable from existing tables, currently not surfaced anywhere).
5. **Recent critical/warning audit events** — using `audit_events.severity`, org-wide, not agent-scoped.
6. **Org-wide activity feed** — a cross-agent version of the existing per-agent `activity_items` feed.

Everything else (tool catalog detail, per-agent policy list, liquidity job detail, rate-limit configuration) stays page-local per the user's direction — no dedicated Analytics/History nav item.

---

## 11. Notable cross-page findings

- **Dead UI:** `WalletRefsPanel` (Agents) is fully implemented, API-backed, and never rendered.
- **Unexposed features (not just analytics gaps):** `policy_simulations` (dry-run policy testing) and multi-step `org_onboarding_states` (the schema is built for a wizard that was never built) are complete backend capabilities with zero frontend surface.
- **No member/team management UI** anywhere, despite full CRUD existing server-side for both.
- **Duplicated/hand-maintained metadata:** policy action labels and condition-field visibility are hardcoded in two separate UI files instead of reading `policy_action_registry` — a real drift risk, worth fixing during the redesign rather than just re-skinning around it.
- **Payments density:** Payments has become a real testnet control plane, but it is now too dense for a single route. Treasury overview, sources/rails, agent access, liquidity operations, and activity/evidence should be split before visual polish.
