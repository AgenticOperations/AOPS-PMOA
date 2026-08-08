# Fleet demo runbook — real-user path + Fleet Run chat plan

Live 5-agent fleet on Arc + Base. Real USDC. Real txs. Real org guardrails.

**Pitch (one line):** A real operator funds an org fleet; agents and published services hire each other under AgentOps policy; the user gets the deliverable and on-chain receipts — from the product, not a hackathon script on camera.

Positioning: AgentOps is the **org control plane + hosted MCP** on Arc, not another wallets/x402 SDK. See [`docs/arc-agentops-addon.md`](../docs/arc-agentops-addon.md). Change-manifest scenario: [`docs/change-manifest.md`](../docs/change-manifest.md) §K–L.

| Mode | What it is | On camera? |
|---|---|---|
| **Fleet Run chat** (target UX) | User types one goal → Orchestrator wires **only live listed agents/services** under policy → final fruit in the same thread | **Yes — hero** |
| **Console Marketplace / Hire desk** | Same payment rails without the chat; real hires from UI | **Yes — until chat ships / as fallback** |
| **Mode A — Hosted MCP** | One agent in Claude/Cursor via bearer MCP | Optional encore (single agent, not the fleet) |
| **Mode B — Publish** | Host [arc-nanopayments](https://github.com/circlefin/arc-nanopayments) (or own HTTPS) → Publish + ERC-8004 → Marketplace | **Yes — “build a real agent”** |
| **`demo/run.mjs`** | Spawns sellers + Orchestrator `/run` for CI / dry-run / backstage reset | **No — never the hero** |

---

## Product story judges must feel

```text
Real user
  → one org
  → real agents with real wallets
  → real published / listed services (live HTTP)
  → one goal in Fleet Run chat (or Hire desk today)
  → agents wire & pay under AgentOps guardrails
  → final deliverable + explorer receipts on one screen
```

**Ownership split (say this once):**

| Layer | Who |
|---|---|
| Plan steps, pick agents, assemble answer | **Coordinator / Orchestrator** (Fleet Run) |
| Allow / deny / budget / wallet / Permit2 / x402 / approvals / audit / kill | **AgentOps** |
| Sell work over HTTP | **Real agent services** (org fleet or external published) |

External agents join only by being **listed + hired under policy** — never a side channel.

---

## Where AgentOps is shown clearly (call these out live)

Use these moments so judges see *AgentOps*, not “just crypto payments”:

| # | Moment | Where in UI | What AgentOps did |
|---|---|---|---|
| 1 | **Per-agent wallet / max loss** | Fund + Arcscan agent address | Chain-enforced ceiling; not a shared org purse alone |
| 2 | **Policy binding** | Agent → Policies & access | Rules attached before any hire |
| 3 | **Deny or approval** | Fleet Run / hire error or Approvals inbox | Fail-closed / human gate — not silent allow |
| 4 | **Lane 2 fleet hire** | Hire desk or chat step card | `payment_intra_fleet` + Permit2 drawdown under org solvency |
| 5 | **Lane 1 external / fixture** | Marketplace weather (optional) | `payment_x402` + payTo allowlist + idempotency |
| 6 | **Second hop** | Analyst → DataFetcher mid-task | Agent is buyer *and* seller; real economy |
| 7 | **Cross-chain** | SeniorReviewer on Basescan | Arc orchestrator pays Base agent (Option A prefund) |
| 8 | **Publish + identity** | Agent → Publish → Marketplace Agents | Real service URL + ERC-8004 on Arc |
| 9 | **Activity / audit** | Activity feed + tx links | Durable evidence of governed spends |
| 10 | **Kill / sweep** | Revoke agent | Instant revoke + sweep to treasury — no Circle OTP |

Script this line after each payment: *“That spend went through AgentOps runtime — policy and budget first, then settlement.”*

---

## Policies that must hold in this demo

Do not run a “happy path only” that skips governance. Before showtime:

| Policy / control | Demo behavior | If violated |
|---|---|---|
| **Fail-closed default** | Unknown action types deny (or explicit org opt-in) | Do not demo permissive empty policy as “governed” |
| **Budget / wallet ceiling** | Orchestrator and specialists funded with known caps | Attempt one over-cap hire → show deny |
| **payTo allowlist** | Marketplace / fleet payees pre-resolved | Refuse unknown destinations |
| **Same-org Permit2** | Intra-fleet hires only for org agents | External = x402 authorize or escrow |
| **Approval path** (optional beat) | One action requires approval → pause chat → operator approves → continue | Proves human-in-the-loop |
| **Gas headroom (Arc)** | Unspendable reserve so agents don’t brick | Mention if showing near-empty wallet |
| **Kill switch** | Revoke mid-demo or after fruit | Sweep visible on explorer |

Fleet Run must **never** call an agent that is not a live listing (org endpoint or Marketplace published URL). Down endpoint → honest failure in chat.

---

# PART A — Judge show (camera on product)

Target **~8–10 minutes**. Terminals stay off-camera (backstage only).

### Pre-show (once, backstage)

```bash
cd AOPS-PMOA
docker compose up -d postgres redis
```

`apps/api/.env` (required):

- `CIRCLE_TREASURY_PROVIDER=developer_controlled`
- `CIRCLE_API_KEY` / `CIRCLE_ENTITY_SECRET` (test mode)
- `DATABASE_URL`
- `ARC_RPC_URL`
- `BASE_SEPOLIA_RPC_URL` ← worker needs this or Base top-up dies
- `ENABLE_TESTNET_X402_FIXTURES=true` ← optional Lane 1 weather hire

```bash
npm run dev:api
npm run dev:circle-worker
npm run dev:web          # console :3005
# optional when Fleet Run / MCP live:
# npm run dev:mcp:http
```

**Always reuse a funded org** (fresh org = empty treasury):

```bash
export DEMO_ORG_ID=<funded-org-id>
```

First-time funding: run backstage harness without `DEMO_ORG_ID`, fund printed treasury (Arc USDC ≥ ~8, Base USDC ≥ ~4), wait for Gateway credit, set `DEMO_ORG_ID`. Base agents need a little native ETH (manual).

Start **live seller HTTP** off-camera (treat as “deployed fleet services”). Prefer fixed ports for Hire desk seed URLs (`4001–4004`) via `demo/live-marketplace-hires.mjs` warm-up or your process manager — not as the on-camera story.

Open tabs:

- Console → demo org → **Fund** · **Agents** · **Hire desk** / **Fleet Run** (when shipped)
- Public Marketplace → http://localhost:3005/marketplace
- https://testnet.arcscan.app
- https://sepolia.basescan.org

Dry-run once. Save tx hashes. Record a backup video.

---

### Scene 1 — Real org, real money ceiling (~1.5 min)

**Do:** Sign in → org → **Fund** → open one agent address on Arcscan.

**Say:** “Max loss is the on-chain wallet balance — verify it yourself. That’s AgentOps’ per-agent ceiling, not a slide.”

**AgentOps shown:** #1 Fund / wallet.

---

### Scene 2 — Build / list a real agent (~2 min)

**Do:** Agent → **Publish** → HTTPS endpoint (nanopayments or fleet seller) → register ERC-8004 if gas available → Marketplace **Agents** lists it.

**Say:** “Real users publish a real service. Only live listed agents are hireable under org policy.”

**AgentOps shown:** #8 Publish + identity.

*Time-box:* if needed, skip fresh publish and point at already-listed fleet services as “agents this org made available.”

---

### Scene 3 — Fleet work (hero) (~3–4 min)

#### 3a — When Fleet Run chat is shipped (preferred)

**Do:** Open **Fleet Run** → use the **canonical goal** in §B.4.1 (or equivalent). Confirm the **goal checklist** (§B.4.5) appears before spends.

**Show live in the thread (every step = real AgentOps tool — §B.3 / §B.4.3):**

1. `agentops.onboard` → catalog + identity.  
2. Plan card maps each goal clause → tool calls (nothing dropped).  
3. Wire **only** live listed agents.  
4. Each hire: `payment_intra_fleet` (or `payment_x402` if goal asks Lane 1) → decision → tx.  
5. Second hop: Analyst credential + `payment_intra_fleet` → DataFetcher.  
6. Base hop: `chain: "base"` → Basescan.  
7. If approval: `approval_status` → human → `approval_consume` → re-issue.  
8. Close: `activity_record` + brief + receipts; all checklist rows ✅.

**Say:** “One goal. The plan is checked against AgentOps tools — onboard, pay, approve, record — not a side channel.”

**AgentOps shown:** #3–7, #9 (and #2 if Publish was Scene 2).

#### 3b — Until chat ships (honest fallback — still product UI)

**Do:** **Hire desk** / Marketplace (same rails):

1. Hire DataFetcher (Permit2) → Activity + Arc tx.  
2. Hire Analyst (second hop visible in activity/txs if Analyst paid DataFetcher).  
3. Hire Writer.  
4. Hire SeniorReviewer → **Basescan**.

**Say:** “Same economy a Fleet Run chat will drive — today the operator hires from the desk; tomorrow the user states a goal and the orchestrator hires under the same guardrails.”

**Do not say:** “I’m running `demo/run.mjs`.”  
**Do say:** “These services are deployed; the console is how a real operator uses them.”

---

### Scene 4 — Guardrails beat (~1.5 min)

Pick one (both if time):

- **Deny / budget:** force an over-budget or disallowed hire → show AgentOps refusal in UI.  
- **Kill switch:** revoke one Arc agent → wait for circle-worker sweep → treasury on Arcscan.

**Say:** “At 3am you don’t email Circle OTP. You revoke; funds return.”

**AgentOps shown:** #3 and/or #10.

---

### Scene 5 — Final fruit (~1 min)

Same screen: deliverable (chat) or Activity receipts + explorer links.

**Say:** “User goal → fleet work under guardrails → fruit and receipts.”

---

### Optional encores

| Encore | How | Claim |
|---|---|---|
| Escrow + reputation | `validation/spike-manifest-k4-completion.mts` backstage or Escrow UI | ERC-8183 hire; ERC-8004 feedback only after settle |
| Mode A MCP | One agent credential → Claude Code MCP → `agentops.onboard` + one `payment_x402` | Single governed agent in an IDE — **not** the multi-agent fleet |
| Lane 1 weather | Hire desk x402 fixture after authorize payTo | External micropay under policy |

---

# PART B — Fleet Run chat — product plan (LLM + live wiring)

This is the **target demo surface**. Build this so the script stays test-only forever.

## B.1 UX (one screen)

```text
┌──────────────────────────────────────────────────────────┐
│  Fleet Run · {org}                          [Policies]   │
├────────────────────────────┬─────────────────────────────┤
│  Chat thread               │  Live fleet                   │
│  • User goal               │  • Agent nodes (wired)      │
│  • Orchestrator plan       │  • Edges = hires/payments   │
│  • Step cards:             │  • Status: pending/paid/…   │
│    check → hire → tx       │  • Click → explorer         │
│  • Denies / approvals      │                             │
│  • Final deliverable       │  Available services         │
│                            │  • Org fleet (live only)    │
│                            │  • Marketplace published    │
└────────────────────────────┴─────────────────────────────┘
```

**Beauty bar:** one composition, clear hierarchy, live motion on wire/pay events (2–3 intentional motions), no fake “AI purple dashboard” clutter. Brand **AgentOps** as the guardrail rail on every step card (decision id / allow|deny|approval).

**Input:** single goal composer (natural language).  
**Output:** final fruit in-thread + receipt strip (chain, amount, tx, policy decision).

## B.2 Who may be wired (hard rule)

A run may attach **only**:

1. Org agents with `public_endpoint_url` (or demo-stable live URL) **reachable now**, and/or  
2. Marketplace listings that resolve to a live payee + endpoint.

No phantom script personas on the user path. Unreachable → step fails in chat with repair hint (“start seller” / “publish endpoint”).

## B.3 All AgentOps tools — must be wired (no orphans)

Fleet Run’s Orchestrator (and mid-run specialists that pay) talk to AgentOps **only** through the canonical nine-tool contract. MCP names and runtime HTTP are the same surface (`docs/skill.md`, `apps/mcp/src/tools.ts`, `@agentops-pmoa/runtime-client`).

| # | MCP tool | Runtime HTTP | Who calls it in Fleet Run | Required? |
|---|---|---|---|---|
| 1 | `agentops.onboard` | `POST /v1/runtime/onboard` | Orchestrator at run start; Analyst before second-hop pay | **Yes — every run** |
| 2 | `agentops.operation_check` | `POST /v1/runtime/operations/check` | Before any non-payment HTTP/tool the LLM wants (prefer over policy_check for `runtime.http.request` / `tool.call`) | **Yes — when step is not a payment_*** |
| 3 | `agentops.policy_check` | `POST /v1/runtime/check` | Any other action type from onboard catalog | Yes when catalog says so |
| 4 | `agentops.payment_intra_fleet` | `POST /v1/runtime/payments/intra-fleet` | Orchestrator→specialists; Analyst→DataFetcher | **Yes — every org fleet hire** |
| 5 | `agentops.payment_x402` | `POST /v1/runtime/payments/x402` | Optional Lane 1 (weather / external published micropay); embeds its own policy | Yes when goal asks external paid API |
| 6 | `agentops.approval_status` | `GET /v1/runtime/approvals/:id` | When check/payment returns approval_required | **Yes — poll until resolved** |
| 7 | `agentops.approval_consume` | `POST /v1/runtime/approvals/:id/consume` | Immediately before re-issuing the approved action | **Yes — never skip** |
| 8 | `agentops.operation_record` | `POST /v1/runtime/operations/record` | After a checked non-payment operation completes | Yes for those steps |
| 9 | `agentops.activity_record` | `POST /v1/runtime/activity` | After final fruit assembled (and optional mid-run summaries) | **Yes — close the run** |

**Hard rules**

- Never settle with raw Circle keys, private keys, or direct chain writes from the chat worker — only these APIs.  
- `payment_x402` **includes** policy; do not double-pay by also calling a separate check unless the plan step is non-payment HTTP.  
- `payment_intra_fleet` is bounded by Permit2 ceiling + treasury solvency (not the same policy path as x402); still only call it for **same-org** live payees; **no idempotency key** — never blind-retry; confirm Activity first.  
- On `deny`: stop that branch; surface decision in chat; **do not** rephrase to bypass.  
- On `approval_required`: pause UI → operator Approvals → `approval_status` → `approval_consume` → re-issue **same** payment/operation.  
- Escrow (ERC-8183) is console/API hire, not one of the nine MCP tools — if the goal asks escrow, Fleet Run opens that path via existing escrow engines and still records Activity.

---

## B.4 Goal → structured plan (must achieve everything the user asked)

Fleet Run must **parse the goal into a checklist**, show the plan in chat **before** spending, then execute only that plan. Nothing in the goal may be silently dropped.

### B.4.1 Canonical demo goal (pre-fill)

> Research brief: how agent-to-agent USDC payments work on Arc testnet.  
> Hire DataFetcher → Analyst (allow Analyst to buy more data) → Writer → SeniorReviewer on Base.  
> Respect each agent budget. Stay inside org policy.  
> If any hire needs approval, wait for an operator.  
> Return a short brief plus payment receipts (chain, amount, tx).

### B.4.2 Goal requirements matrix (acceptance for *this* goal)

| Goal clause | Plan must include | AgentOps call(s) | Done when |
|---|---|---|---|
| Research brief on A2A USDC / Arc | Assemble fruit from specialist payloads | `activity_record` at end | Brief text in chat |
| Hire DataFetcher | Orch → DataFetcher Arc | `onboard` → `payment_intra_fleet` | Arc tx + data payload |
| Hire Analyst + allow buy more data | Orch → Analyst; **Analyst → DataFetcher** | Orch `payment_intra_fleet`; Analyst `onboard` + `payment_intra_fleet` | Second-hop Arc tx |
| Hire Writer | Orch → Writer Arc | `payment_intra_fleet` | Arc tx + writeup |
| SeniorReviewer on Base | Orch → SeniorReviewer `chain: base` | `payment_intra_fleet` with `chain: "base"` | **Basescan** tx + review |
| Respect each agent budget | Preflight balances / deny on overspend | Runtime payment path rejects; optional demo over-cap step | No spend above wallet/ceiling |
| Stay inside org policy | Checks + payment policy embedding | `operation_check` / `policy_check` / payment_* | Every step shows decision |
| Wait if approval needed | Pause + consume | `approval_status` + `approval_consume` | Resume only after consume |
| Brief + payment receipts | Final card | `activity_record` + streamed tx fields | Receipts strip complete |

If the user edits the goal (e.g. adds “also buy the weather fixture”), the planner **adds** a Lane 1 step with `payment_x402` + unique `idempotency_key` — it must not ignore that clause.

### B.4.3 Exact execution plan (ordered tool calls)

Credentials: Orchestrator bearer for hub steps; Analyst bearer for second hop. Resolve live URLs from Marketplace / agent publish metadata only.

```text
RUN START
  [Orch]  agentops.onboard
          → cache agent_id, action catalog, enforcement modes
  [Orch]  Resolve live listings: DataFetcher, Analyst, Writer, SeniorReviewer
          → fail fast if any endpoint down (show in chat)
  [Orch]  Publish PLAN card (checklist from B.4.2) — wait for user Confirm optional

STEP 1 — DataFetcher (Arc hub→spoke)
  [Orch]  agentops.payment_intra_fleet
          { payee_agent_id: DataFetcher, chain: "arc", url: <live /data> }
  [Orch]  Stream step card: decision/rail/tx/body summary
  [Orch]  On approval_required → APPROVAL SUBFLOW → re-issue same call
  [Orch]  On deny → STOP branch; mark goal clause failed

STEP 2 — Analyst (Arc) + second hop
  [Orch]  agentops.payment_intra_fleet
          { payee_agent_id: Analyst, chain: "arc", url: <live /analysis> }
          Analyst service, mid-request, as Analyst identity:
            [Analyst] agentops.onboard
            [Analyst] agentops.payment_intra_fleet
                      { payee_agent_id: DataFetcher, chain: "arc", url: <live /data> }
  [Orch]  Stream both txs (hub hire + second hop) — goal “buy more data” satisfied only if second hop tx present

STEP 3 — Writer (Arc)
  [Orch]  agentops.payment_intra_fleet
          { payee_agent_id: Writer, chain: "arc", url: <live /report> }

STEP 4 — SeniorReviewer (Base cross-chain)
  [Orch]  agentops.payment_intra_fleet
          { payee_agent_id: SeniorReviewer, chain: "base", url: <live /review> }
          → Orchestrator Base wallet must be prefunded (Option A)

STEP 5 — Optional non-payment HTTP (only if plan needs free URL fetch)
  [Orch]  agentops.operation_check { action: runtime.http.request, resource: { url } }
          → allow: fetch
          → approval_required: APPROVAL SUBFLOW then fetch
          → deny: stop
  [Orch]  agentops.operation_record { outcome: success|denied|error }

STEP 6 — Optional Lane 1 external (only if goal asks)
  [Orch]  agentops.payment_x402
          { idempotency_key: "fleet-run:{runId}:weather:1",
            request: { url, method, headers } }
          retry unknown outcome with SAME idempotency_key

APPROVAL SUBFLOW (any step)
  [caller] agentops.approval_status { approval_id }  (backoff 2s…30s)
  [human]  Approves in console
  [caller] agentops.approval_consume { approval_id, decision_id }
  [caller] Re-issue the exact payment_* or guarded operation

RUN CLOSE
  [Orch]  Assemble brief from DataFetcher + Analyst + Writer + SeniorReviewer payloads
  [Orch]  agentops.activity_record
          { summary: "Fleet Run {runId}: brief complete; N payments; goal checklist …" }
  [Orch]  Render fruit + receipts; mark each B.4.2 row pass/fail
```

### B.4.4 Guardrail demo beats (wire into the same plan)

Schedule **one** of these in the show run so policy is visible, not only happy path:

| Beat | How to trigger | Tools shown |
|---|---|---|
| **Deny** | Extra step: hire with amount / destination that policy or budget rejects | `payment_*` or `operation_check` → deny card |
| **Approval** | Policy on Orchestrator: large Base hire requires approval | `payment_intra_fleet` → `approval_status` → consume → re-issue |
| **Budget** | Ask chat to spend above Orchestrator Arc allocation | Payment fails; show wallet ceiling on Fund/explorer |

### B.4.5 Plan card UI (before/during run)

Show a living checklist derived from the goal:

```text
☐ Onboard Orchestrator (agentops.onboard)
☐ Wire live: DataFetcher, Analyst, Writer, SeniorReviewer
☐ Pay DataFetcher (intra_fleet / arc)
☐ Pay Analyst (intra_fleet / arc)
☐ Second hop Analyst→DataFetcher (intra_fleet / arc)
☐ Pay Writer (intra_fleet / arc)
☐ Pay SeniorReviewer (intra_fleet / base)
☐ Approvals resolved if any
☐ activity_record + brief + receipts
```

Flip to ✅ only when the matching tool result + (for pays) tx hash exist. Goal is **achieved** only when all required boxes are ✅ (optional Lane 1 only if requested).

---

## B.5 Policy instrumentation in the chat UI

Every step card must show:

- MCP/runtime tool name used (`agentops.payment_intra_fleet`, etc.)  
- `decision` allow | deny | approval_required (when the rail returns one)  
- `decision_id` / `approval_id` when present  
- rail: `permit2_intra_fleet` | `x402_exact` | `escrow`  
- amount + chain + tx hash (explorer link)  
- agent ids (payer → payee)  
- which **goal clause** this step satisfies  

Pinned sidebar: **Effective policies** for Orchestrator (expand per specialist) + onboard catalog snippet.  
If deny: stop branch; plain-language reason; **no** auto-retry around policy.

---

## B.6 Implementation sketch (when building)

| Piece | Responsibility |
|---|---|
| `apps/web` Fleet Run page | Chat + live graph + goal checklist; SSE/WS or polled run events |
| `apps/api` runs engine | Create run, store plan checklist, append events, x402 idempotency keys |
| Orchestrator worker | LLM → structured plan (B.4.2) → **only** runtime-client / MCP tools above |
| Analyst path | Same `payment_intra_fleet` with Analyst credential (second hop) |
| Listing resolver | Marketplace store — live endpoints only |
| Approvals bridge | Deep link + poll `approval_status` / `approval_consume` |

Use `@agentops-pmoa/runtime-client` (or hosted MCP with Orchestrator credential) so every call is a real tool/API — no parallel “demo settle” path.

**Backstage sellers:** `demo/agents/*` or Mode B hosts — keep off camera.

**Out of scope for v1:** multi-Cursor fleet; Gateway pays any chain at payment time; ValidationRegistry; inventing MCP tools beyond the nine.

---

## B.7 Acceptance criteria (chat demo is “real”)

- [ ] All nine tools are reachable from Fleet Run code paths (used when scenario needs them; onboard + intra_fleet + activity_record always on canonical goal)  
- [ ] Goal checklist (B.4.2) is shown and fully ✅ before claiming success  
- [ ] Second-hop and Base hop have real txs in-thread  
- [ ] Deny **or** approval **or** budget failure shown at least once in the session  
- [ ] No settlement outside AgentOps runtime  
- [ ] User never needs the terminal for the happy path  
- [ ] No `demo/run.mjs` output on camera  

---

# PART C — Backstage harness (testing only)

Keep these for reset, CI, and seller boot. **Not the show.**

### Full scenario once (off-camera dry-run)

```bash
cd AOPS-PMOA
DEMO_ORG_ID=$DEMO_ORG_ID node --env-file=apps/api/.env demo/run.mjs
```

Starts five agent HTTP servers → Orchestrator `/run` → hub/spoke, second hop, cross-chain. Save JSON txs for backup slides.

### Marketplace charts (real on-chain)

```bash
DEMO_ORG_ID=$DEMO_ORG_ID HIRES_PER_LISTING=2 \
  node --env-file=apps/api/.env demo/live-marketplace-hires.mjs
```

Starts sellers :4001–4004 and pays listings with real Permit2.  
Do **not** use `demo/seed-marketplace-purchases.mjs` for demos (fake rows).

### Escrow + reputation spike

```bash
cd AOPS-PMOA/apps/api
node --env-file=.env ../../node_modules/.bin/tsx \
  ../../validation/spike-manifest-k4-completion.mts
```

### Kill switch

```bash
curl -sS -X POST \
  "http://127.0.0.1:8080/v1/orgs/$DEMO_ORG_ID/agents/<agentId>/revoke" \
  -H "Authorization: Bearer <operator-session>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"demo_kill_switch"}'
```

Wait for circle-worker sweep. Show Arcscan.

### Console hire path (same rails)

1. Marketplace lists fleet seeds + published agents.  
2. Same-org → Permit2 (Lane 2).  
3. Other-org / weather → x402 (Lane 1) after authorize payTo.  
4. Escrow → Activity → Escrow lifecycle.  
5. Publish → endpoint + ERC-8004 → Marketplace Agents.

---

## Do not claim

- That the on-camera hero is `demo/run.mjs`  
- LLM agents deciding the fleet inside Cursor/Claude (MCP = one agent)  
- Multiple IDE chats = the product fleet  
- Gateway pays any chain at payment time (balances are per-chain; we prefund Option A or bridge JIT)  
- Arc ecommerce storefront / ValidationRegistry  
- That AgentOps replaces Circle Agent Stack or Arc tutorials (we add org governance on top)  
- Fleet Run chat capabilities before they ship — use Hire desk and say so  

## If live fails

Play backup video → open saved explorer links → still show Fund ceiling + Publish list + revoke if API is up.

## Commands cheat-sheet

| Step | Command |
|---|---|
| Infra | `docker compose up -d postgres redis` |
| API | `npm run dev:api` |
| Worker | `npm run dev:circle-worker` |
| Web | `npm run dev:web` |
| Fleet Run UI | http://localhost:3005/app/{orgSlug}/fleet-run |
| Fleet Run E2E | `DEMO_ORG_ID=… node --env-file=apps/api/.env --import tsx validation/fleet-run-e2e.mts` |
| Backstage full fleet | `DEMO_ORG_ID=… node --env-file=apps/api/.env demo/run.mjs` |
| Live marketplace hires | `KEEP_SELLERS=1 demo/live-marketplace-hires.mjs` |
| Escrow+rep | `tsx validation/spike-manifest-k4-completion.mts` (from `apps/api` + `--env-file=.env`) |
| Revoke | `POST /v1/orgs/:orgId/agents/:agentId/revoke` |

### Fleet Run wake-up checklist (demo morning)

1. API + circle-worker + web running; `GEMINI_API_KEY` optional in `apps/api/.env`.
2. Reuse funded `DEMO_ORG_ID` with Orchestrator/DataFetcher/Analyst/Writer/SeniorReviewer wallets.
3. Start sellers on `:4001–4004` (`KEEP_SELLERS=1` live-marketplace-hires or e2e script).
4. Open **Runtime → Fleet Run**, submit canonical goal, watch checklist + receipts.
5. If pay fails with `circle_worker_operation_failed`, Fund the Orchestrator on Arc/Base and retry — sellers must use the **same** agent wallet addresses Fleet Run resolved.

---

## Related docs

- [`docs/change-manifest.md`](../docs/change-manifest.md) — §K scenario, §L on-chain proof  
- [`docs/arc-agentops-addon.md`](../docs/arc-agentops-addon.md) — Mode A / B / Marketplace  
- [`docs/skill.md`](../docs/skill.md) — MCP tool contract for Mode A  
- [`docs/deployment/hosted-mcp.md`](../docs/deployment/hosted-mcp.md) — hosted MCP  
- [`templates/arc-nanopayments-agentops`](../templates/arc-nanopayments-agentops) — Mode B buyer overlay  
