---
created: 2026-08-10
updated: 2026-08-10
project: agentOps
tags: [operator, how-to, policies, funding, fleet, console]
status: operator guide — grounded in as-built Controls / Fund / Spend UI
---

# How to use the AgentOps platform (operator guide)

Practical click-path for humans: create agents, author policies in Controls, fund money correctly, enable spend, then run via Chat or MCP.

Deeper architecture and on-chain proofs: [`end-to-end-system-guide.md`](end-to-end-system-guide.md)  
Camera / demo script: [`../demo/DEMO-RUNBOOK.md`](../demo/DEMO-RUNBOOK.md)

> **Testnet only.** Org default may still be permissive; this guide designs for **fail-closed intent** using what the Controls builder can author today.

---

## 1. Ways into the product

| Path | Who | Entry | What you do |
|---|---|---|---|
| **Console** | Operator | Sign in → `/app/{orgSlug}/…` | Agents, Controls, Fund, Approvals, Activity, MCP credentials |
| **Chat** | Operator | `/chat` | NLP: create agents, fund questions, fleet goals under the same org rules |
| **MCP session** | Claude / Cursor | Credential you issued → MCP URL | `onboard`, `operation_check`, `payment_x402`, `payment_intra_fleet`, approvals, publish/identity |
| **Join** | External agent | Invite redeem / open join (when enabled) | Credential only — spend still needs human enablement |

Both human and agent paths hit the **same** API, policies, wallets, and evidence.

Console map (sidebar):

| Nav | Job |
|---|---|
| **Home** | Org overview |
| **Agents** | Create identities, Overview spend, Policies & access, Connections (MCP) |
| **Purchases** | Marketplace hire / payTo authorize for external sellers |
| **Controls** | Draft → validate → activate → bind policies |
| **Operations** | Live ops, rate limits, freezes |
| **Approvals** | Human gates from `approval_required` |
| **Activity** | Decision / payment evidence |
| **Fund** | Org ceilings, treasury deposit address, agent wallet balances |

---

## 2. Policy builder — what each field means

Lifecycle for every policy:

1. **Controls** → Create draft  
2. Define → Conditions → Review → **Create draft**  
3. **Validate** → **Activate**  
4. Bind from Controls targets **or** agent **Policies & access → Attach policy**

Each draft is **one action** + one decision. Decisions in the UI:

| Decision | Meaning |
|---|---|
| **Deny** | Block matching actions |
| **Require approval** | Pause for Approvals inbox |
| **Observe** | Allow but log / watch |

The API also supports **Allow**, but the Controls draft builder dropdown does **not** offer it yet. Under a permissive org default, unmatched actions still pass — so authored policies are mostly **guardrails** (deny / observe / approval). Flip to fail-closed only after you can author Allow (API or a UI fix).

### Condition fields (leave blank = match any)

Matching is exact string equality. Comma-separated lists are OR.

| Field | When it appears | Put this |
|---|---|---|
| **Resource category** | HTTP / x402 | Labels such as `weather`, `market-data`, `analysis`, `written-report`, `review` |
| **Resource domain** | HTTP / x402 | Hostname only (`api.example.com`), not a full URL. Leave blank if you only have a category |
| **Payment minimum / maximum** | x402 | Amount strings like `0.03` / `0.10` |
| **Payment asset** | x402 | `USDC` |
| **Payment network** | x402 | Arc `eip155:5042002` · Base Sepolia `eip155:84532` |
| **Payment recipient** | x402 | Payee `0x…` (comma-separate multiple) |
| **Tool name** | Tool call | Exact tool id, e.g. `browser.search` |
| **Tool risk level** | Tool call | `low` · `medium` · `high` · `critical` |
| **Operator role** | Any | Leave **Any role** for agent runtime policies |

---

## 3. Reusable any-agent baseline

Create and activate these once. Attach to **every** agent (or bind at workspace when that target is available).

| # | Policy name | Action | Decision | Conditions | Description |
|---|---|---|---|---|---|
| **B1** | `baseline-deny-external-x402` | Authorize x402 payment check | **Deny** | all empty | Block Lane-1 external x402 until explicitly re-authorized |
| **B2** | `baseline-observe-outbound-http` | External HTTP/API request | **Observe** | all empty | Log outbound HTTP; not a silent free-for-all |
| **B3** | `baseline-deny-weather` *(optional)* | External HTTP/API request | **Deny** | category `weather` · domain **blank** | Deny weather fixture by category (no domain required) |
| **B4** | `baseline-approve-high-risk-tools` | Tool call | **Require approval** | risk `high, critical` · name blank | Human gate for high/critical tools |

Skip B3 if you do not care about the weather demo beat.

---

## 4. Fleet pack (five-agent research story)

Agents: **Orchestrator**, **DataFetcher**, **Analyst**, **Writer**, **SeniorReviewer**.

### 4.1 Attach matrix (policies)

| Agent | Attach |
|---|---|
| All five | B1, B2, B4 (+ B3 if created) |

Optional extra policy:

| Field | Value |
|---|---|
| Name | `fleet-orch-base-x402-needs-approval` |
| Action | Authorize x402 payment check |
| Decision | **Require approval** |
| Payment minimum | `0.03` |
| Payment network | `eip155:84532` |
| Attach to | **Orchestrator** only |

Intra-fleet Base hire still uses Orchestrator’s **approval threshold** in payment access (below). Rate limits (manifest P9) live under **Operations**, not Controls.

### 4.2 Manifest → what the console can do today

| Manifest idea | Do this in product |
|---|---|
| Fail-closed default | Org setting later (keep permissive until Allow exists in UI) |
| Orch Arc hire allow | Payment access on + caps + draw allowance |
| Base needs human | Orch approval threshold `0.03` (+ optional F policy) |
| Analyst second hop only | Not a wallet-list field in payment access today — keep Analyst caps tight; same-org hires auto-resolve payees |
| Deny unknown payees | **Not** on payment access. External marketplace: Purchases → authorize payTo. Same-org fleet: auto-allowlisted on resolve |
| Deny external x402 | **B1** |
| Observe HTTP | **B2** |
| Deny weather | **B3** (category only) |

### 4.3 Payment access (Overview → Spend or Fund agent-access UI)

Payment access panel fields today: **status**, **monthly budget**, **per-request cap**, **approval threshold**, **allowed rails**. There is **no destination allowlist** on this form.

| Agent | Payment access | Per-request | Period budget | Approval threshold |
|---|---|---|---|---|
| **Orchestrator** | On | `0.10` | `1.00` | `0.03` |
| **Analyst** | On | `0.02` | `0.20` | none |
| **DataFetcher** | Off (sell-only in this pack) | — | — | — |
| **Writer** | Off | — | — | — |
| **SeniorReviewer** | Off | — | — | — |

Enable only **settlement-verified** rails you intend to use.

---

## 5. Money: treasury vs agent wallet vs draw allowance

Funding the **treasury alone does not put USDC on agent wallets**.

```text
1) Org treasury     Fund → deposit USDC on Arc / Base
2) Agent wallets    Each agent has its own address (Fund → Balances)
3) Payment access   Soft caps / rails (Overview → Spend)
4) Draw allowance   Permit2 / treasury draw ceiling (Spend → Add draw allowance)
```

| Layer | What it is | Where |
|---|---|---|
| **Treasury** | Org pool you deposit into | **Fund** → copy treasury address → send USDC |
| **Agent wallet** | That agent’s on-chain max loss / spend source | **Fund → Balances** (address + balance) |
| **Payment access** | Soft budget / per-request / rails | Agent **Overview → Spend** |
| **Draw allowance** | Standing ceiling to draw (treasury → agent, or MetaMask → agent) | Same Spend panel → **Add draw allowance** |

### Auto top-up (API / demo, not a Fund button)

Worker top-ups run only when an **`agent_allocations`** row exists (`POST /v1/orgs/:orgId/agents/:agentId/allocation`). Demo scripts set this; the console Fund page does **not** currently expose “allocate / feed agent from treasury.”

If a hire fails with **agent wallet has 0 USDC**:

- send USDC to that agent’s address on **Fund → Balances**, or  
- set allocation via API/demo so the worker tops them up.

### What to do besides funding treasury

1. Fund treasury on **Arc** (and **Base** if Orchestrator pays SeniorReviewer on Base).  
2. Confirm each agent wallet appears under Fund → Balances.  
3. Paying agents (Orchestrator, Analyst) → Overview → Spend: turn access **on**, set caps, **Add draw allowance → From treasury**.  
4. If a rail spends from the agent wallet and balance is `0`, fund that agent address (or allocation API).  
5. Sell-only agents: payment access **off**; they mainly need a wallet to receive.

---

## 6. Click-order checklist

Use this sequence for a clean fleet bootstrap.

### A. Identity

- [ ] Sign in and pick / create org  
- [ ] **Agents** → create Orchestrator, DataFetcher, Analyst, Writer, SeniorReviewer  
- [ ] Wait until wallets show on **Fund → Balances** (Arc; Base where needed)

### B. Policies

- [ ] **Controls** → create / validate / activate B1–B4 (skip B3 if unused)  
- [ ] Optionally create `fleet-orch-base-x402-needs-approval`  
- [ ] On each agent → **Policies & access** → attach the baseline set (+ Orch optional policy)

### C. Money

- [ ] **Fund** → deposit USDC to org treasury on Arc (and Base if needed)  
- [ ] Set org ceiling if prompted  
- [ ] Confirm agent addresses/balances on Fund → Balances  
- [ ] If agent balances stay `0` and you need on-wallet spend: send to agent address or call allocation API

### D. Spend enablement

- [ ] Orchestrator + Analyst → **Overview → Spend** → payment access on with table values in §4.3  
- [ ] Same agents → **Add draw allowance → From treasury** (Permit2 / draw ceilings)  
- [ ] Leave sell-only agents’ payment access **off**

### E. Live sellers (required for real Activity txs)

Chat fleet falls back to **catalog mode** (seeded briefs, no payments) unless seller HTTP is reachable.

**Local (5th process beside api/web/mcp/worker):**

```bash
# apps/api/.env — optional DEMO_ORG_ID (sellers auto-pick any org with the full fleet)
MARKETPLACE_DEMO_HOST=http://127.0.0.1
FLEET_SELLERS_PUBLIC_BASE=http://127.0.0.1
FLEET_REQUIRE_LIVE_SELLERS=true

# restart API, then:
npm run dev:fleet-sellers
# Boot auto-picks an org with the five fleet agents and publishes public_endpoint_url.
# Use Chat in that same workspace (check the log line "auto-picked org …").
```

**Docker Compose:**

```bash
# .env used by compose
DEMO_ORG_ID=org_…
ARC_RPC_URL=https://rpc.testnet.arc.network
FLEET_SELLERS_OPTIONAL=0
FLEET_REQUIRE_LIVE_SELLERS=true
# defaults: MARKETPLACE_DEMO_HOST / FLEET_SELLERS_PUBLIC_BASE = http://fleet-sellers

docker compose --env-file .env -f deploy/docker-compose.testnet.yml up -d --build
curl -sf http://127.0.0.1:4001/healthz
```

Then open `/chat` in that same org. If sellers are down, Chat now **errors** (no silent catalog success) when `FLEET_REQUIRE_LIVE_SELLERS=true`.

**Laptop sellers → production Chat (nginx + ngrok):** see [`fleet-sellers-tunnel.md`](fleet-sellers-tunnel.md).

### F. Credentials / run (MCP)

**Production MCP URL (copy into Claude / Cursor):**

```text
https://agentops-pmoamcp-production.up.railway.app/mcp
```

Local-only alternative while developing the MCP process: `http://127.0.0.1:8070/mcp`.

- [ ] Set `MCP_PUBLIC_URL` on **web** and **API** (and Railway services) to the production `…/mcp` URL so Connections / join redeem do **not** show localhost  
- [ ] Confirm `curl -sf https://agentops-pmoamcp-production.up.railway.app/healthz` → ok  
- [ ] Confirm `curl -sf https://agentops-pmoamcp-production.up.railway.app/readyz` → ready (if 503, fix MCP’s `AGENTOPS_API_BASE_URL` to the production API)  
- [ ] Agents → Connections → issue MCP credential → paste **production** URL + bearer into Claude / Cursor **or** run a goal from **`/chat`**  
- [ ] Watch **Approvals** for Base / high-risk gates; **Activity** / explorer for receipts  

See [`deployment/hosted-mcp.md`](deployment/hosted-mcp.md) for Railway env checklist.

### G. Guardrail beats (optional)

- [ ] Ask for over-cap spend → expect per-request / budget / wallet deny  
- [ ] Hit weather HTTP with B3 attached → expect `policy_denied`  
- [ ] External x402 with B1 attached → expect deny until you intentionally revise policy

---

## 7. After bootstrap — day-two ops

| Need | Where |
|---|---|
| Approve a paused payment / tool | **Approvals** |
| See matched policy + decision ids | **Activity** / Operations |
| Pause / revoke / sweep | Agent detail + payment revoke flows |
| External marketplace payTo | **Purchases** → authorize destination once |
| Cross-chain exact-wallet liquidity | Fund → Liquidity (bridge top-up), not the same as agent allocation |

---

## 8. Related docs

| Doc | Use when |
|---|---|
| [`end-to-end-system-guide.md`](end-to-end-system-guide.md) §7–§8 | Human/Agent paths + fleet story with proofs |
| [`change-manifest.md`](change-manifest.md) | Sequenced Arc build decisions |
| [`../demo/DEMO-RUNBOOK.md`](../demo/DEMO-RUNBOOK.md) | Live demo script |
| [`skill.md`](skill.md) / [`llms.txt`](llms.txt) | Agent cold-start |
