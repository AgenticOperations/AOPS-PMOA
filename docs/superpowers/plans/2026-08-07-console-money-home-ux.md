# Console Money + Home MCP UX Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 7-item Treasury nav into a 3-section Money surface, stop repeating agent addresses across chains, and make Home the MCP kickstart for Claude/Cursor/Codex.

**Architecture:** Keep existing page modules as section bodies; rewrite IA (sidebar + redirects + composed Empower page + Home connect card). Agent wallets use one address with a chain selector (K-13); treasury stays per-chain deposit addresses.

**Tech Stack:** Next.js App Router, existing `ConsoleShell` / payments components, `resolveMcpPublicUrl`.

---

## File Structure

- Modify: `apps/web/src/components/ConsoleSidebarNav.tsx` — Money nav (Fund / Empower / Activity)
- Modify: `apps/web/src/components/ConsoleShell.tsx` — labels Overview→Home, Treasury→Money
- Modify: `apps/web/src/components/CommandPalette.tsx` — match new IA
- Modify: `apps/web/src/components/payments/FundingHierarchy.tsx` — agent address once + chain select
- Create: `apps/web/src/app/app/[orgSlug]/payments/empower/page.tsx` — composed access + delegations
- Create: `apps/web/src/components/home/HomeConnectGuide.tsx` — MCP URL, install tabs, starter prompt, checklist
- Modify: `apps/web/src/app/app/[orgSlug]/overview/page.tsx` — Home-first layout
- Modify: old payment routes → redirect to Fund / Empower / Activity
- Modify: `apps/web/src/app/overview.css` / `payments.css` as needed for Home connect card

### Task 1: Nav IA

- [x] Replace Treasury subnav with Money → Fund, Empower, Activity
- [x] Update shell breadcrumb + command palette
- [x] Redirect `/payments` → `/payments/funding`; redirect agent-access/delegations to empower

### Task 2: Funding address UX

- [x] Group agent wallets by agentId; show address once; chain dropdown for balances

### Task 3: Empower page

- [x] Compose agent-access + delegations content on `/payments/empower`

### Task 4: Home MCP

- [x] HomeConnectGuide with endpoint, Claude/Cursor/Codex snippets, checklist, attention strip

### Task 5: Verify

- [x] Typecheck web workspace + console-shell / section-1 tests
