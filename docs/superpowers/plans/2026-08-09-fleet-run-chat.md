# Fleet Run Chat Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an org console Fleet Run chat where a user states one goal, Gemini plans/narrates, and real AgentOps runtime payments (Permit2 intra-fleet + optional x402) execute under policy — matching `demo/DEMO-RUNBOOK.md` Part B.

**Architecture:** Operator-authenticated API engine `fleet-run` creates a run, builds a structured checklist from the goal (Gemini + deterministic K.4 template), executes steps via existing `payIntraFleet` / `payRuntimeX402` / onboard-equivalent paths (same rails as Marketplace hire), streams events for the UI. Web page `/app/{org}/fleet-run` is a chat + live checklist + wire graph using existing console CSS tokens. Sellers remain backstage HTTP agents; no `demo/run.mjs` on camera.

**Tech Stack:** Fastify + Postgres (api), Next.js App Router (web), `@google/generative-ai` (Gemini), existing payments/runtime engines, console design tokens (`globals.css`).

**Commit cadence:** One commit per task below so reviewers can walk plan → code → history.

---

## File map

| Path | Responsibility |
|---|---|
| `apps/api/src/engines/fleet-run/*` | Create/get run, plan, execute steps, Gemini client |
| `apps/api/src/app.ts` + server bootstrap | Register fleet-run routes |
| `apps/api/.env.example` | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| `apps/web/src/app/app/[orgSlug]/fleet-run/page.tsx` | Server page |
| `apps/web/src/components/fleet-run/*` | Chat UI + live graph |
| `apps/web/src/app/actions/fleet-run.ts` | Server actions |
| `apps/web/src/lib/server/fleet-run-client.ts` | API client |
| `apps/web/src/components/ConsoleSidebarNav.tsx` | Nav link |
| `apps/web/src/app/fleet-run.css` | Page styles (console-consistent) |
| `validation/fleet-run-e2e.mts` | E2E against live API + sellers |
| `demo/DEMO-RUNBOOK.md` | Already updated (commit with plan) |

---

### Task 1: Docs — plan + runbook commit

- [ ] Commit `demo/DEMO-RUNBOOK.md` + this plan file.

### Task 2: API — fleet-run store + routes (no Gemini yet)

**Files:**
- Create: `apps/api/src/engines/fleet-run/types.ts`
- Create: `apps/api/src/engines/fleet-run/store.ts`
- Create: `apps/api/src/engines/fleet-run/routes.ts`
- Create: `apps/api/src/engines/fleet-run/executor.ts` (deterministic K.4 steps via `payIntraFleet`)
- Modify: `apps/api/src/app.ts` + wherever engines are wired in server entry
- Test: unit test for plan checklist builder

- [ ] Persist runs + events in Postgres (simple table migration or jsonb on a new `fleet_runs` table)
- [ ] `POST /v1/orgs/:orgId/fleet-runs` — create from goal, resolve Orchestrator + specialists by name
- [ ] `POST /v1/orgs/:orgId/fleet-runs/:runId/execute` — run remaining steps
- [ ] `GET /v1/orgs/:orgId/fleet-runs/:runId` — status + events + checklist
- [ ] Commit

### Task 3: Gemini planner/narrator

**Files:**
- Create: `apps/api/src/engines/fleet-run/gemini.ts`
- Modify: executor to call Gemini for plan intro + final brief
- Modify: `.env.example` with `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-2.0-flash`

- [ ] If no API key, fall back to template narration (still execute real payments)
- [ ] Commit

### Task 4: Web Fleet Run UI

**Files:**
- Create page, components, CSS, actions, client
- Modify: `ConsoleSidebarNav.tsx` — add Fleet Run under Runtime

- [ ] Chat composer, message stream, checklist, agent wire panel, tool-name badges
- [ ] Poll run while `running`
- [ ] Commit

### Task 5: E2E validation script

**Files:**
- Create: `validation/fleet-run-e2e.mts`

- [ ] Start/assume sellers; create run; execute; assert checklist + txs
- [ ] Commit results note in spike-results or runbook appendix if green

### Task 6: End-to-end live test (demo readiness)

- [ ] `docker` + api + worker + web + sellers
- [ ] Hit Fleet Run UI path and/or e2e script
- [ ] Verify Arc + Base txs when funded org available
- [ ] Final commit if fixes needed

---

## Execution rules (from DEMO-RUNBOOK)

- Only live listed / named org fleet agents
- All spends via AgentOps (`payIntraFleet` / x402) — never raw keys
- Goal checklist must reach ✅ before success
- Second hop + Base hop required for canonical goal
- `demo/run.mjs` backstage only
