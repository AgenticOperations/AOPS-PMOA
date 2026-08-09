# Agent Spend on Overview Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move per-agent payment access + spend caps + draw allowances onto the agent Overview; strip Access/Delegations from Empower; put org ceilings on Fund.

**Architecture:** New `AgentSpendPanel` client component on agent detail Overview. Agent page loads this agent's payment account, capabilities, and filtered delegations. Empower becomes Fund-adjacent ceilings only (or redirect); create-delegation forms accept a fixed `agentId`.

**Tech Stack:** Next.js App Router, existing payments actions/clients, Sheet drawers, Permit2 delegation APIs.

---

### Task 1: AgentSpendPanel UI

**Files:**
- Create: `apps/web/src/components/agents/AgentSpendPanel.tsx`
- Modify: `apps/web/src/components/payments/TreasuryAgentAccess.tsx` (extract grant form or reuse via `lockedAgentId`)
- Modify: `apps/web/src/components/payments/DelegateFromTreasury.tsx` + wallet `DelegateToAgent` (optional fixed agent)
- Modify: `apps/web/src/components/wallet/DelegationList.tsx` (filter / agent-scoped props)
- Test: extend or add `apps/web/tests/...` for panel smoke

- [ ] **Step 1:** Build overview Spend section: Payment limits summary + Grant/Edit drawer; Draw allowances list + Add allowance drawer
- [ ] **Step 2:** Wire `setAgentPaymentAccessAction`; pre-bind agent id; show remaining = budget - spent (account for reserved in copy if useful)

### Task 2: Agent detail page wiring

**Files:**
- Modify: `apps/web/src/app/app/[orgSlug]/agents/[agentId]/page.tsx`
- Modify: `apps/web/src/components/agents/AgentDetailShell.tsx`

- [ ] **Step 1:** Fetch payment account, capabilities, delegations (filter payeeAgentId), agent wallet funding for this agent
- [ ] **Step 2:** Render `AgentSpendPanel` on Overview; remove Treasury crosslink on Policies tab (point to Overview spend or remove)

### Task 3: Empower / Fund cleanup

**Files:**
- Modify: `apps/web/src/app/app/[orgSlug]/payments/empower/page.tsx`
- Modify: `apps/web/src/components/payments/EmpowerWorkbench.tsx` (or delete tabs)
- Modify: funding page to host `OrgCeilingForm`
- Modify: `agent-access` + `delegations` routes → redirects
- Modify: sidebar, CommandPalette, LinkedActionMessage, fleet-readiness hrefs, e2e guide snippets

- [ ] **Step 1:** Empower page = ceilings only OR redirect empower → funding#ceilings; preferred: ceilings on Fund, empower redirects to agents or fund
- [ ] **Step 2:** Update nav: remove Empower or retarget; keep Fund as money + ceilings

### Task 4: Verify

- [ ] **Step 1:** Run relevant vitest; fix broken imports/tests
- [ ] **Step 2:** Grep for stale `empower?tab=access` / agent-access links
