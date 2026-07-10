# agentOps Console: Visual & UX Redesign Spec

Date: 2026-07-10
Builds on: `docs/audit/2026-07-10-console-feature-data-audit.md` (data/feature inventory — read that first for exact tables/columns cited here)
Governing constraints: `PRODUCT.md` (register: product; anti-crypto-trading-dashboard; anti-wallet-first), `DESIGN.md` (restrained color, warm off-white/light theme, Stripe/RazorpayX/Linear anchors, 8px radius ceiling)
Design-skill grounding: `impeccable` product register (`~/.claude/skills/impeccable/reference/product.md`) governs — this is a product UI, not a marketing surface. `high-end-visual-design` and `frontend-design` are brand/hero-page skills; their glass/mesh/huge-radius/exotic-font guidance is **not** applied here because it directly conflicts with `DESIGN.md`'s light, restrained, 8px-radius, familiar-navigation mandate. What carries over from them: disciplined spacing rhythm, purposeful micro-motion, "earn every element" restraint — the spirit, not the literal techniques.
Visual reference: `shadcn-fintech` (github.com/abderrahimghazali/shadcn-fintech, MIT) — mined for component structure and interaction patterns only, not its wallet-first/crypto-trading content or dark accents.

---

## Part 0: Why this order

Per the product register's own slop test: "would a user fluent in Linear/Stripe/Notion trust this, or pause at every subtly-off component?" The current console fails that test not because it's ugly, but because it's *incomplete* — dead panels (`WalletRefsPanel`), write-only forms with no corresponding read view (rate limits, payment events), and hardcoded assumptions presented as real choices (Gateway source always "simulation"/"base"). A visual reskin on top of that would look worse, not better — polished chrome around broken affordances reads as *more* suspicious, not less.

That's why the parallel backend-hardening plan (member management, policy simulations, rail verification, wallet refs rendering, hardcode removal) has to land before or alongside this visual work, not after it. This spec assumes that hardening plan's data/actions become real; where a widget below depends on an endpoint that plan is adding, it's noted.

---

## Part 1: Foundations

### Color — Restrained (the product-register floor, not a ceiling we're choosing to skip)

- Background: warm-tinted off-white (`DESIGN.md` existing token — keep).
- Surface: near-white panel, one step lighter than background.
- Second neutral layer (per impeccable product register): a slightly cooler-tinted panel for the sidebar/toolbar, distinct from the content surface — this is new; today everything is one flat surface.
- Text: dark neutral, cool tint, never pure black (existing token — keep).
- Accent: one clear blue for primary actions/selection/links (existing token — keep). This is also directionally close to USDC's own brand blue (`#2775CA`), which is convenient, not a coincidence to lean into further.
- Semantic state colors (new, currently under-used): success green, warning amber, danger red, info blue — for status badges (`payment_events.decision`, `approval_requests.status`, `operational_decisions.decision`, `circle_provider_jobs.status`). Used only on badges/indicators, never as background washes.
- USDC branding: the official USDC mark (blue circle, white "$") appears **only** as a small icon next to a balance/amount figure (treasury balance, agent budget, payment amount) — never as a page-wide color theme, never as decorative background art. This keeps faith with `PRODUCT.md`'s "do not lead with token balances" / "do not look like a crypto trading dashboard" — the logo identifies the currency, it doesn't brand the product.

### Typography

- One system sans family (`-apple-system, "Segoe UI", system-ui` stack — legitimate per product register, and correct for a console used for hours of scanning work). No display face anywhere in the app chrome.
- Fixed rem scale, ratio ~1.15 between steps (tighter than a marketing site — more type sizes needed for dense data screens).
- Tabular figures (`font-variant-numeric: tabular-nums`) on every number column — amounts, counts, dates — so columns of numbers align. This single change will visibly lift every table in the app.
- Line length rule (65-75ch) applies to prose blocks (policy descriptions, empty-state copy) only; tables run as dense as the data needs.

### Motion

- 150-250ms on all transitions (product register, not brand register — no orchestrated page-load sequences, no scroll-triggered reveals in the console itself).
- Motion conveys state only: row insert/remove, panel expand/collapse, status-badge change, live-activity pulse. Never decorative.
- The one place sanctioned "liveliness" belongs: real-time agent activity indicators (see Part 3) — a subtle pulse/glow on a "live" status dot, not a page-load animation.

### Component primitives (adopted from shadcn/ui, restyled to the tokens above)

Pull in: `Card`, `Table`, `Sidebar`, `Chart` (recharts wrapper), `Command` (palette), `Dialog`, `Tabs`, `Badge`, `Select`, `Popover`, `Sheet`, `Tooltip`, `Skeleton`, `Separator`. This becomes the missing design-system layer the audit flagged (`apps/web/src/components/ui/`, currently only has `sidebar.tsx`).

Explicitly **not** adopted from the reference: `@dnd-kit` (drag-drop dashboard customization — no evidence operators want to rearrange their own console), `three`/`three-globe`/`@react-three/*` (3D globe — pure decoration, fails "does it complete an action or expose real state").

New primitives this app needs that shadcn-fintech doesn't have (it has no equivalent flow):
- **Stepper/wizard** — for Controls' draft→validate→activate→bind flow and the redesigned Onboarding form. Built from `Tabs`+`Dialog`+`Separator` composition (see Part 4).
- **Fixed-height scroll table** — see below.

### The "no infinite stretch, hidden scrollbar" table pattern

Every data table in the app (Approvals inbox, Agents roster, Transactions/Payment events, Blocked operations, Audit log) uses one shared table shell:

```
.table-shell {
  max-height: <viewport-relative value, e.g. 60vh or a fixed px per page's layout>;
  overflow-y: auto;
  scrollbar-width: none;           /* Firefox */
}
.table-shell::-webkit-scrollbar { display: none; }  /* Chrome/Safari */
```

Scrolling still works (mouse wheel, trackpad, keyboard) — only the visible scrollbar track/thumb is hidden, so a long table doesn't visually dominate or push page footer content around. Pair with a sticky header row inside the shell so column labels stay visible while scrolling. Pagination (or "load more") still applies for genuinely large sets (Approvals, Audit log) — hiding the scrollbar is a visual choice, not a substitute for pagination on 1000+ row tables.

---

## Part 2: Information architecture & routing

Keep the existing top-level nav (`ConsoleShell`): **Overview, Agents, Controls, Operations, Payments, Approvals** — per your direction, no dedicated Analytics/History nav item. What changes is what lives *inside* each page.

Every domain page (Agents detail, Controls, Operations, Payments, Approvals) gets the same internal shape, using `Tabs`:

```
[ Overview | Activity & history | Settings/Config ]
```

- **Overview tab** (default): the page's primary workflow — what's there today, cleaned up (e.g., Payments' treasury setup, Controls' policy library).
- **Activity & history tab** (new, per page): the embedded analytics/history section, sourced from the tables the audit flagged as UI-less (see Part 3 for exact mapping per page). This is where "per-page analytics, not a dedicated nav item" actually lives.
- **Settings/Config tab**: configuration surfaces that aren't the main workflow (e.g., Operations' rate-limit configuration separated from the tool catalog; Payments' provider-mode/rail-verification settings separated from the treasury dashboard).

Agent Detail gets a fourth tab structure since it's already the richest page:
```
[ Overview | Policies & access | Credentials & wallets | Activity & history ]
```
(Policies&access and Credentials&wallets already exist as sections on the page today — this just gives them tab-level separation instead of one long scroll, and is where the fix for the dead `WalletRefsPanel` and unrendered agent hierarchy lands.)

New page: **Workspace Settings** (`/app/{orgSlug}/settings`), added to the nav (or under an org-name dropdown, not the primary domain nav) once the backend-hardening plan's member/team APIs land — members list+invite, teams CRUD, org profile. This isn't a domain page like Payments/Controls, so it sits apart from the main six.

Onboarding becomes a real multi-step flow (see Part 4), still a standalone route outside `ConsoleShell` chrome, consistent with Auth.

---

## Part 3: Data → per-page analytics/history mapping

For each page's new "Activity & history" tab, the exact source tables (all already exist per the audit — no new tables needed beyond what the backend-hardening plan adds):

**Overview** (org-wide rollup, not a tab — this *is* the whole page, redesigned; see Part 4)

**Agents → Activity & history tab**
- Timeline: `activity_items` + `audit_events` (already merged server-side by `getAgentActivityFeed` — just needs a fuller view than today's 5s-polled snippet).
- Blocked/rate-limited operations for this agent: `operational_decisions` (already fetched, currently only "recent 12" — extend to full filterable history).
- Payment activity for this agent: `payment_events` filtered by `agent_id` (net-new surface — today only "last payment" shows anywhere, and not on this page at all).

**Controls → Activity & history tab**
- Policy decision log: `policy_decisions` (currently zero UI anywhere) — filterable by action/target/decision, this is the single biggest untapped table in the schema.
- Simulation history: `policy_simulations` (once the hardening plan's simulate endpoint exists) — "what would this draft have done."

**Operations → Activity & history tab**
- Full decision trend (not just deny/rate_limited): `operational_decisions`, all decision types, chartable over time.
- Rate-limit utilization: `operational_rate_counters` (zero UI today) — per limit, consumption vs. `limit_count`/`window_seconds`, the direct data source for a utilization bar/heatmap.
- Live session visibility: `mcp_sessions` (zero UI today) — which agents/connections have an active session right now.

**Payments → Activity & history tab**
- Payment ledger: `payment_events`, full history (today: "last payment" only) — amount, rail, chain, decision, over time. This is the richest payments surface to build; maps directly to shadcn-fintech's Transactions-table pattern.
- Routing outcomes: `payment_route_observations` (zero UI) — accepted/rejected routing attempts per agent/rail, with reason codes. Maps to shadcn-fintech's Analytics-page category-breakdown pattern (breakdown by rejection reason instead of spend category).
- Provider job history: `circle_provider_jobs`, all job types (today: liquidity-jobs subset only).

**Approvals → Activity & history tab**
- Full audit trail: `approval_actions` (zero UI) — who requested/approved/denied, with notes, per approval.
- Consumption proof: `approval_consumptions` (zero UI) — confirms an approval was actually used at runtime, not just decided on.
- Approval-rate metrics: computed from `approval_requests` — approval rate, average time-to-decision, denial-reason breakdown.

None of this requires new tables. It requires new read endpoints/queries against tables that already exist (the backend-hardening plan's pattern — expose, don't invent) plus the chart/table components from Part 1.

---

## Part 4: Overview page — complete design

Goal (per your ask): the org's front door, low cognitive load, intuitive, engaging, not a wall of numbers. Currently: just an agent roster. Target: the aggregate dashboard pulling the highest-signal item from every section, per the audit's §10 shortlist.

**Layout** (adapting shadcn-fintech's Dashboard structure, restyled to restrained tokens, no wallet-first framing):

```
┌─────────────────────────────────────────────────────────────┐
│  Org name · workspace switcher                    [search] 🔔│
├─────────────────────────────────────────────────────────────┤
│  Row 1 — four compact stat tiles (not hero-metric template): │
│  [Active agents]  [Pending approvals]  [Treasury balance]    │
│  [Blocked ops, 24h]                                          │
│  Each tile: current value + one-line trend, no sparkline     │
│  noise. Pending-approvals tile is the one that gets a        │
│  color cue (amber) when count > 0 — everything else neutral. │
├───────────────────────────────┬───────────────────────────────┤
│ Agent roster (existing table, │ Needs attention (new)         │
│ kept, but trimmed to essential│ - oldest pending approval,    │
│ columns: name, team, status,  │   with age + one-click open   │
│ connection health, "open")    │ - agents with zero policy     │
│ Uses the fixed-height/hidden- │   bindings (coverage gap)     │
│ scrollbar table shell.        │ - any failed payment_events   │
│                               │   in last 24h (surfaces the   │
│                               │   Arbitrum-class issue at     │
│                               │   the org level, not buried   │
│                               │   in Payments)                │
├───────────────────────────────┴───────────────────────────────┤
│ Recent activity (new) — org-wide activity_items feed, cross-  │
│ agent, last ~20 events, each with a link to the source page.  │
│ This is the one place a genuinely "live" feel is earned:      │
│ a subtle pulse on new items arriving, nothing else animated.  │
└─────────────────────────────────────────────────────────────┘
```

**Why this structure, not a bigger grid of cards**: the "Needs attention" panel is the actual answer to "low cognitive load" — instead of making the operator scan six sections to find what's wrong, the page tells them directly. This is also the one place `impeccable`'s "cards are the lazy answer" caution matters: "Needs attention" is a list of actionable rows (icon + one line + link), not a grid of decorative cards — a list is the correct affordance here, not a card grid.

**What's deliberately absent**: no chart-heavy "financial overview" hero (shadcn-fintech's Dashboard leads with a 12-month revenue chart — wrong shape for this product; agentOps' Overview isn't reporting revenue, it's reporting operational health). No wallet balance treated as the hero metric, consistent with `PRODUCT.md`.

---

## Part 5: Multi-step forms / wizards

Two flows need a real stepper (shadcn-fintech has no equivalent — this is net-new pattern work):

**Onboarding** (currently one field: org name):
1. Organization name
2. Domain + primary use case (currently collected by the backend, dropped by the UI per the audit — the hardening plan restores this)
3. Review + create

Each step is a `Card` with a `Tabs`-driven step indicator (not literal `<Tabs>` navigation — a read-only progress indicator + Next/Back buttons), single form submission at the end (org creation stays atomic — no partial-org autosave, matching the hardening plan's constraint that `org_onboarding_states` needs an `org_id` that doesn't exist yet).

**Controls policy draft builder** (currently one flat drawer form):
1. Choose action(s) + decision (allow/deny/approval_required/observe)
2. Configure conditions (resource/payment/tool) — fields shown driven by the backend's new `policy-actions` metadata endpoint (from the hardening plan), not a hardcoded map
3. Validate (calls the existing validate endpoint, shows warnings/errors inline before allowing "Next")
4. Review + create draft (and, separately, a "Simulate" action once that endpoint exists, before Activate)

This directly fixes the audit's finding that `PolicyDraftBuilder.tsx`'s field-visibility logic is hand-maintained and can drift from the server's validation rules — the stepper's "which fields show" now reads from the same backend metadata the validator uses.

---

## Part 6: Real-time agent monitoring pattern

Today: `AgentLiveActivity` polls every 5 seconds, tucked into one panel on Agent Detail. Keep the polling approach (no infra case for websockets here), but standardize the pattern app-wide since Operations' `mcp_sessions` (live session tracking, currently unexposed) needs the same treatment:

- A small live-status dot (green pulse / gray / red) next to any entity with a real-time dimension: agent connection health, MCP session activity, liquidity-job status.
- The pulse itself is the only decorative motion sanctioned outside of state-change transitions — subtle, on a 2px dot, never on a whole card.
- Underlying data refresh stays poll-based (5-15s depending on page cost), surfaced via the same `Skeleton`-on-load / no-spinner-mid-content rule from the product register.

---

## Part 7: Step-by-step build-out roadmap

This assumes the backend-hardening plan (member mgmt, policy metadata/simulation, rail verification, wallet-refs rendering, hardcode removal) is in flight or complete — visual work sequenced to not race ahead of real data/actions.

**Phase 0 — Design system foundation** (blocks everything else)
- Install `recharts`, `cmdk`, `class-variance-authority`, `next-themes`, `date-fns` into `apps/web`.
- Build `apps/web/src/components/ui/*` primitives (Card, Table, Sidebar upgrade, Chart wrapper, Command, Dialog, Tabs, Badge, Select, Popover, Sheet, Tooltip, Skeleton) restyled to `DESIGN.md` tokens.
- Build the shared fixed-height/hidden-scrollbar table shell.
- Run `impeccable document` once this exists to generate an updated `DESIGN.md` capturing the real component library (so it stops being a token-only doc).
- *Skill to invoke:* `impeccable shape` for this phase specifically, since it's pure component/system work with no page-level UX decisions left open.

**Phase 1 — Overview redesign**
- Build the four stat tiles, "Needs attention" panel, org-wide activity feed, trimmed agent roster.
- Requires: pending-approvals count (existing `approval_requests` query), policy-coverage-gap query (new, simple `agents` LEFT JOIN `policy_bindings`), failed-payment-events-24h query (existing `payment_events` filtered), org-wide `activity_items` query (existing table, new "no agent filter" query variant).
- *Skill:* `impeccable craft` (shape, then build, single page).

**Phase 2 — Per-page tab restructure + Activity & history tabs**
- Roll out the `[Overview | Activity & history | Settings]` tab shape to Agents (detail), Controls, Operations, Payments, Approvals, one page at a time.
- Each page's Activity & history tab wired to the tables in Part 3.
- Wallet refs panel re-attached to Agent Detail as part of this phase (Agents page).
- *Skill:* `impeccable craft` per page; `impeccable critique` after each to catch cognitive-load regressions before moving to the next page.

**Phase 3 — Wizards**
- Onboarding multi-step form.
- Controls policy-draft stepper, wired to the backend's policy-actions metadata endpoint.
- *Skill:* `impeccable shape` first (these are genuinely new UX flows, not reskins), then `craft`.

**Phase 4 — Workspace Settings (new page)**
- Members list/invite/role-change/remove, teams CRUD — gated on the backend-hardening plan's member APIs landing.
- *Skill:* `impeccable craft`.

**Phase 5 — Hardening pass**
- Run `impeccable audit` (a11y, perf, responsive) and `impeccable polish` across the full app.
- Verify every interactive component has all states (default/hover/focus/active/disabled/loading/error) per the product register's component bar — the audit's "no edit/discard/unbind" findings become explicit empty/disabled-state checks here, not just missing buttons.
- Empty states rewritten to teach the interface (per product register), not "nothing here" placeholders — this matters especially for the new Activity & history tabs on orgs with little history yet.

**Ordering rationale**: Phase 0 first because every later phase consumes its primitives. Phase 1 (Overview) second because it's the highest-visibility, most self-contained win and validates the design system against real layout pressure before rolling out to five more pages. Phases 2-4 can run in parallel across pages once Phase 0/1 are done, if using `subagent-driven-development` with one implementer per page (they don't share state). Phase 5 always last.

---

## Open decisions flagged, not blocking

- **Workspace Settings nav placement**: under the org-name dropdown vs. a seventh top-level nav item — recommend the dropdown (keeps the six-item domain nav clean per your "no extra nav items" direction), but worth a quick visual check once built.
- **Chart color mapping**: recharts series need a small, fixed categorical palette (rail types, decision types, job statuses) — will define exact hex values against `DESIGN.md` tokens during Phase 0, not guessed here.
