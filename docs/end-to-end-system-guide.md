---
created: 2026-08-09
updated: 2026-08-09
project: agentOps
ecosystem: [circle, arc]
tags: [end-to-end, guide, circle, proofs, bugs, policy, mother-doc]
status: living guide — grounded in spike-results + as-built code
---

# AgentOps (AOPS-PMOA) — End-to-End System Guide

**Mother document** for the platform: what we built, who owns which layer (us vs Circle), how a human and an agent each enter, how money moves under policy, and what is proven on testnet with explorer links. Other writeups (hackathon submission, demo script, pitch, agent `/llms.txt`) should be **derived from this**, not invented beside it.

This is the deep, human-readable map of **what the product does**, **the Human vs Agent entry paths (NLP chat + MCP / llms.txt)**, **which Circle / Arc pieces it uses**, **how money actually moves under a real policy pack**, and **what we proved on-chain** (with explorer links). It also records the **real bugs and wrong turns** we hit, so nobody relearns them the hard way.

Primary evidence source: [`docs/spike-results.md`](spike-results.md)  
Demo script: [`demo/DEMO-RUNBOOK.md`](../demo/DEMO-RUNBOOK.md)  
Why we built it this way: [`docs/handover.md`](handover.md)  
Positioning vs Circle SDKs: [`docs/arc-agentops-addon.md`](arc-agentops-addon.md)

> **Testnet only.** Nothing here claims mainnet payment execution.

---

## Table of contents

1. [One-sentence product](#1-one-sentence-product)
2. [How to read this doc](#2-how-to-read-this-doc)
2a. [How to extract a hackathon / pitch writeup](#2a-how-to-extract-a-hackathon--pitch-writeup)
3. [The four services](#3-the-four-services)
3a. [Platform feature map](#3a-platform-feature-map)
4. [Circle infrastructure map](#4-circle-infrastructure-map)
5. [Chains and money model](#5-chains-and-money-model)
6. [Two payment lanes](#6-two-payment-lanes)
7. [Two paths: Human and Agent](#7-two-paths-human-and-agent)
8. [Fleet end-to-end story (policy-composed + proven)](#8-fleet-end-to-end-story-policy-composed--proven)
9. [Escrow → reputation → Permit2](#9-escrow--reputation--permit2)
10. [Kill switch and sweep](#10-kill-switch-and-sweep)
11. [Bugs, traps, and wrong turns](#11-bugs-traps-and-wrong-turns)
12. [What is proven vs not](#12-what-is-proven-vs-not)
13. [Related docs](#13-related-docs)

---

## 1. One-sentence product

**AgentOps is the org control plane + hosted MCP that sits between AI agents and the outside world** — policy and budget *before* spend, Circle settlement *for* spend, human approval *when needed*, and a hash-chained audit trail *after*.

It is **not** a replacement for Circle wallets, x402, Gateway, or App Kit. Those stay Circle’s. See [`docs/arc-agentops-addon.md`](arc-agentops-addon.md).

```text
Human path                    Agent path
─────────                     ──────────
Landing: Human mode           Landing: Agent mode  (/?audience=agent)
   │                             │
   ▼                             ▼
Console + NLP chat (/chat)    GET /llms.txt → /skill.md
Fleet Run · Marketplace          │
Approvals · Fund · Policies      ▼
   │                          MCP :8070/mcp + bearer credential
   └──────────► AgentOps API ◄──┘
                     │
                     ├── policy / approvals / budgets / audit
                     └── Circle worker → wallets / Gateway / chain
```

See [§7 Two paths: Human and Agent](#7-two-paths-human-and-agent) for the full walkthrough of both.

---

## 2. How to read this doc

| Icon / label | Meaning |
|---|---|
| **Proven** | Real testnet tx or live API run with an explorer / evidence link |
| **Circle piece** | Something Circle provides that we call |
| **AgentOps piece** | Something *we* built on top |
| **Bug / trap** | Confirmed failure mode — read before debugging |

Every bold explorer link is independently checkable. Prefer those over “our tests passed.”

---

## 2a. How to extract a hackathon / pitch writeup

Do **not** paste this whole guide into a submission. Pull these slices:

| Submission section | Take from here |
|---|---|
| **Problem** | Agents that can spend need org policy, budgets, approvals, and audit — Circle already has wallets / x402 / Gateway |
| **What we built** | §1 one-liner + §3a feature map + ownership split in §4.4 |
| **Circle infra used** | §4 tables (DCW, Gateway, x402, `signTypedData`, worker) — name products, not slogans |
| **Demo path (human)** | §7.1 bootstrap → Fleet Run / chat → Approvals → Activity |
| **Demo path (agent)** | §7.0–7.2 invite redeem or Mode A paste → MCP → onboard → governed pay |
| **Money story** | §6 lanes + §8 fleet steps with explorer links |
| **Trust story** | §9 escrow → reputation → Permit2 graduation |
| **Honest limits** | §12 (especially: no claim of Lane 1 to a real third-party merchant yet) |
| **Ops reality** | §11 traps (entity secret, Base ETH indexing) — judges notice depth |

**One-paragraph spine you can reuse:**

> AgentOps is the org control plane and hosted MCP on top of Circle Developer-Controlled Wallets, Gateway, and x402. Operators set policy and fund per-agent wallets; Claude/Cursor sessions act only through MCP. Intra-fleet spend uses Permit2; external paid HTTP uses x402; first-hire uses our guarded ERC-8183 escrow with payment-gated ERC-8004 reputation. Everything below is testnet-proven with explorer links in §8–§10.

Camera script: [`demo/DEMO-RUNBOOK.md`](../demo/DEMO-RUNBOOK.md).

---

## 3. The four services

| Service | Port | Job in plain English |
|---|---|---|
| **Web** (`apps/web`) | `3005` | Operator console + Google login BFF. Thin UI — real state lives in the API. |
| **API** (`apps/api`) | `8080` | Brain: identity, policy, approvals, payments, treasury, evidence, Postgres. |
| **Circle worker** | `8090` | Private hands: talks to Circle with secrets the public API must never hold. Polls Postgres job rows (not Redis queues). |
| **MCP** (`apps/mcp`) | `8070` | Thin translator for agents. Bearer credential → runtime HTTP. No DB of its own. |

Local setup: `./setup.sh` or `npm run start:local`. Details: root [`README.md`](../README.md).

**Redis** is only a ~25s treasury balance cache. Sessions, jobs, and rate limits are **Postgres**. As-built detail: [`docs/current-architecture-and-userflow.md`](current-architecture-and-userflow.md).

Hosted MCP deploy notes: [`docs/deployment/hosted-mcp.md`](deployment/hosted-mcp.md) (local default `http://127.0.0.1:8070/mcp`; production HTTPS `/mcp` with bearer preserved).

---

## 3a. Platform feature map

What a human can do in the product today — the console index behind the money story.

### Auth and tenancy

| Piece | What it is |
|---|---|
| **Google sign-in** | Web BFF OAuth → opaque session in Postgres (`auth_sessions`). Operators are humans, not agents. |
| **Organization** | Multi-tenant: each org has its own agents, policies, treasury wallets, credentials, and marketplace view. URL space is `/app/{orgSlug}/…`. Switch workspace from the sidebar. |
| **Circle App Kit** | **Not** something we reimplemented. Circle keeps App Kit / checkout / Agent Stack marketplace. We call Circle **Wallets + Gateway + x402** via the worker; operators use **our** console for governance. |

### Console surfaces (`/app/{orgSlug}/…`)

| Nav / surface | Plain English |
|---|---|
| **Home** (`overview`) | Kickstart: connect checklist + copyable agent prompt (`/llms.txt` + invite). Not a place to paste raw MCP JSON forever. |
| **Agents** | Create identity in console **or** create a join **invite token**; Connections (MCP URL + bearer); agent detail (**Spend** + **Escrow → Permit2 trust** on Overview; policy bind; Publish tab; wallet). Roster + detail show **payment-gated reputation** on a **0–100** scale (capped). Chat agents must ask for display `agent_name` before redeem. Per-agent runtime / configuration history stays on the agent page. |
| **Purchases** (`marketplace`) | Org escrow hire history (sidebar Identity). Overlaps Activity → Escrow for the payment trail. |
| **Controls** | Policy authoring / binding — allow, deny, observe, require approval, rate limits. Policy **change log** also appears under Activity → Policy. |
| **Operations** | Tools, rate limits, and runtime decision tools. Historical decisions also under Activity → Decisions. |
| **Approvals** | Human inbox when policy says `require approval` (e.g. Base hire). Approve → agent `approval_consume` → retry. Resolved history also under Activity → Approvals. |
| **Activity** (`/activity`) | Org-wide hub (Runtime sidebar): payments, routing, reservations, provider jobs, escrow, audit, decisions, approvals, policy changes — with filters. Legacy `/payments/activity` redirects here. |
| **Fund** | Org ceilings (top), treasury deposit, balances. Per-agent budgets, draw allowances, and escrow → Permit2 trust live on each **agent Overview**. |
| **Marketplace** (`/marketplace`) | Org-governed discovery: curated demo sellers + **published** agents (`public_endpoint_url`). Hire via x402 (after payTo authorize) or ERC-8183 escrow. Not a clone of agents.circle.com. |
| **Chat** (`/chat`) | NLP operator chat — product Q&A, marketplace recommend, multi-agent research goals (replaces the old console Fleet Run page; `/app/{org}/fleet-run` redirects here). |
| **Landing** | Human mode (marketing / sign-in) vs Agent mode (`/?audience=agent`) structured cold-start pointing at `/llms.txt`. |

### Agent entry (shipped)

| Phase | Status | See |
|---|---|---|
| **0** Mode A — human issues MCP credential | ✅ primary | §7.1 |
| **1** Invite token redeem → MCP credential (payment off) | ✅ | §7.0 |
| **2** `agentops.publish` + ERC-8004 register (wallet / payment access required for register) | ✅ | §7.2 / Publish tab |
| **3** Open join (env-gated, rate-limited) | ✅ code; off unless enabled | §7.0 |

### What we deliberately do **not** own

Wallets MPC keys, x402 facilitator, Gateway batch settlement, Circle App Kit UI, Agent Stack OTP Agent Wallets (fallback only). Those stay Circle’s — §4.

---

## 4. Circle infrastructure map

This section answers: *“What Circle thing are we using, and for what?”*

### 4.1 Wallet products (two different Circle products)

| Circle product | What it is | Where AgentOps uses it | Status |
|---|---|---|---|
| **Agent Wallets** (Agent Stack) | Human email + OTP; spending limits change needs OTP | Older path behind `CIRCLE_TREASURY_PROVIDER=agent_stack` | Kept as fallback; **not** the Arc fleet path |
| **Developer-Controlled Wallets (DCW)** | One **entity secret** signs for many EOAs; no OTP | Arc build: `CIRCLE_TREASURY_PROVIDER=developer_controlled` | **Active path** for per-agent wallets |

**Decision:** flip to DCW so each agent can own a wallet without a human in the loop ([`docs/decisions.md`](decisions.md) A3). Proven by spike **S2** — two EOAs on `ARC-TESTNET` from one entity secret, no OTP.

**Important setup trap:** generating an entity secret is not enough — it must be **registered** with Circle (`registerEntitySecretCiphertext`). An unregistered secret surfaces as a *balance* error (`155258`), not a credentials error. See [§11](#11-bugs-traps-and-wrong-turns).

### 4.2 What Circle signs and moves for us

| Circle / on-chain concept | Plain English | AgentOps use |
|---|---|---|
| **Entity secret** | Master authority for all DCW wallets in the account | Create wallets, `signTypedData`, `createTransaction`, contract execution, sweeps |
| **Wallet set + EOA wallets** | Programmatic wallets, same address derivable across chains | Org treasury + one wallet per agent per chain (Arc, Base) |
| **`createTransaction` / transfer** | Move USDC between wallets | Fund agents, auto-topup, revoke sweep |
| **`signTypedData` (MPC)** | Circle signs EIP-712 without us holding keys | Permit2 permits, Gateway burn intents, x402 authorizations |
| **`createContractExecutionTransaction`** | Call a contract from a DCW | Permit2 `permit` / `transferFrom` / `lockdown`, escrow calls, Gateway mint |
| **Gateway** | Deposit USDC once → pay with signatures; settle later in batches | Lane 1 nanopayments / x402 Gateway rails; JIT Arc→Base bridge |
| **x402 facilitator** | Discovers paid HTTP resources and verifies payment | Lane 1 `payment_x402` |
| **Faucet API** (`/v1/faucet/drips`) | Testnet drip | **Blocked for our key** (403 / rate limit / mainnet-upgrade requirement) — we fund manually |

### 4.3 On-chain standards we plug into (not Circle-owned)

| Standard / contract | Address / note | AgentOps use |
|---|---|---|
| **Permit2** (Uniswap) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Lane 2 agent↔agent ceilings + drawdowns |
| **Arc native USDC** | `0x3600…0000` (precompile; **gas = USDC**) | Balances, gas reserve, Permit2 token |
| **ERC-8183 escrow** (our deploy) | Proxy `0x31C050d9D20504c4E11b2A894051d8181B14e0F5` on Arc + Base | First-hire escrow with budget guard |
| **ERC-8004 Identity** | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Agent identity NFT |
| **ERC-8004 Reputation** | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Feedback only after settled escrow |

Permit2 binding detail: [`docs/batch-settlement-binding.md`](batch-settlement-binding.md). Escrow package: [`packages/onchain/README.md`](../packages/onchain/README.md).

### 4.4 Ownership split (say this once)

| Layer | Who owns it |
|---|---|
| Plan steps, pick agents, assemble the answer | Coordinator / Orchestrator (demo / Fleet Run) |
| Allow / deny / budget / wallet / Permit2 / x402 / approvals / audit / kill | **AgentOps** |
| Wallets, signing, Gateway, x402 facilitator | **Circle** |
| Sell work over HTTP | Real agent services (org fleet or published) |

---

## 5. Chains and money model

### 5.1 Chains in scope

| Chain | Chain ID | Role |
|---|---|---|
| **Arc testnet** | `5042002` (`eip155:5042002`) | Home chain for most fleet agents |
| **Base Sepolia** | `84532` | Cross-chain reviewer / hop proof |

Spike **S1** cleared a false alarm: facilitator network `eip155:14601` is a *different* chain, not a conflicting Arc ID.

### 5.2 The safety idea

> Stop guarding money only with software counters. **Put each agent’s max loss in its own on-chain wallet.**

| Layer | Enforces | Lives where |
|---|---|---|
| Amount ceiling | How much an agent *could* spend | **Wallet balance** (checkable by anyone) |
| Detailed rules | Destinations, purpose, approvals | **AgentOps policy DB** |
| Org solvency | Sum of allocations ≤ real deposits | **AgentOps treasury rules** |

Proven max-loss gate (Phase 3 · Task 4):

- Funded wallet ≈ **$20** USDC → [Arcscan address](https://testnet.arcscan.app/address/0xecf29492264424ae73fc1434a30a66d2f6a9b48f)
- Attempt **$25** → `409 insufficient_agent_wallet_balance`
- Attempt **$5** → `200` settled

### 5.3 Arc quirk: USDC is gas

On Arc, native balance and ERC-20 USDC are **the same pool** (18dp native ↔ 6dp ERC-20 view, 1:1 truncation — spike **S6**).

Consequence: an agent that spends to zero is **bricked** (cannot even be swept). Every allocation keeps an unspendable **gas reserve**.

### 5.4 Cross-chain truth (easy to get wrong)

Gateway’s “unified balance” does **not** mean “pay on any chain from any deposit.” Source chain matters at payment time.

| Option | What we do | When |
|---|---|---|
| **A — Prefund per chain** | Same address on Arc + Base, fund both | Demo / common path |
| **B — JIT bridge** | Gateway burn on Arc → attest → mint on Base | Scale path (`bridgeWalletTopUp`) |

Bridge proven: Arc → Base **0.05 USDC** mint tx  
[`0x3c71a8a2be8fa01f75211c07526382ea42bf93c6281e953c986957225ef02058`](https://sepolia.basescan.org/tx/0x3c71a8a2be8fa01f75211c07526382ea42bf93c6281e953c986957225ef02058)

---

## 6. Two payment lanes

| | **Lane 1** | **Lane 2** |
|---|---|---|
| **For** | Pay **external** merchants / APIs | Pay **another agent in the fleet** |
| **Tool / API** | `agentops.payment_x402` | `agentops.payment_intra_fleet` |
| **Mechanism** | Circle x402 (`exact` or Gateway) | Permit2 ceiling → `transferFrom` drawdowns |
| **Idempotency** | Yes (key required) | **No** — confirm before retry |
| **Money location** | Settles per Circle rail | Stays in payer wallet until drawn |
| **Who it protects** | Payer via policy + budget | Payer (revocable ceiling); payee takes collection risk |

**Escrow (ERC-8183)** is a third path for **first-hire / untrusted** counterparties: lock funds → work → release. After enough settled jobs, graduate to Lane 2 Permit2 (cheaper: ~6 txs → 1 drawdown).

### Glossary (Circle money words that confuse people)

| Term | Everyday analogy |
|---|---|
| **Exact** | Bank transfer: one payment = one on-chain tx + gas |
| **Gateway** | Prepaid bar tab: deposit once, pay with signatures, settle later in batches |
| **Nanopayments** | Circle’s name for Gateway used to pay x402 (tiny amounts stay economic) |
| **Permit2** | Signed spending allowance with a ceiling and expiry — cancel anytime |

For Gateway nanopayments, the authoritative receipt is often **Circle’s API**, not a single explorer row per micropayment (batch settlement).

---

## 7. Two paths: Human and Agent

AgentOps is built for **two audiences** that meet at the same control plane. The public landing page has a **Human / Agent** toggle:

| Mode | Who | Entry | Job |
|---|---|---|---|
| **Human** | You — the operator | Landing **Human** → Sign in → console / NLP chat | Own org, fund wallets, set policy, **issue MCP credentials**, approve, hire |
| **Agent** | Claude / Cursor / IDE session (or any MCP client) | Landing **Agent** → `/llms.txt` | Learn how to connect; call governed tools with the credential **you** pasted in |

**Canonical product today (Mode A):** you do **not** host an agent server. **Claude or Cursor is the agent session.** You bootstrap once in the console; then that session spends and acts only through AgentOps MCP.

```text
You (Human mode / console)
  create org → fund → policy → create agent → issue MCP URL + bearer
       │
       │  paste into Claude / Cursor MCP settings
       ▼
Claude / Cursor session  ──MCP──►  AgentOps  ──►  Circle / chain
       │
       └── may also read /llms.txt (instructions only — does NOT mint credentials)
```

`/llms.txt` and Agent mode never hand out secrets by themselves. Credentials come from **you** (Phase 0), an **invite redeem** (Phase 1), or **gated open join** (Phase 3 when enabled).

Both paths hit the **same** API, policies, wallets, and evidence.

---

### 7.0 Autonomous join phases (1–3)

| Phase | What it does | Payment on join? | How |
|---|---|---|---|
| **0** | Human issues MCP credential (Mode A) | No until you enable | Console Connections |
| **1** | Invite / sandbox join | **Disabled** | Operator `POST /v1/orgs/:orgId/agent-join/invites` → agent asks human for display `agent_name`, then `POST /v1/agent-join/invite/redeem` |
| **2** | MCP publish + ERC-8004 | Unchanged | Authenticated `agentops.publish` / `agentops.identity_register` (wallet required for register) |
| **3** | Open cold register | **Disabled** | Env `AGENT_OPEN_JOIN_ENABLED=true` + `AGENT_OPEN_JOIN_ORG_ID`; agent asks for `agent_name`, then `POST /v1/agent-join/open` with rate caps |

Join never grants spend. A human still enables payment access / funds the Arc wallet before ERC-8004 register or payments succeed. Chat agents must ask for `agent_name` at redeem/open only (not again at publish); scripts may omit it and receive a generated slug.

---

### 7.1 Human path — what you provide initially

Humans never need to speak MCP. Use the product in ordinary language and buttons.

#### A. One-time bootstrap (required before Claude/Cursor can spend)

```text
1. Sign in (Google) → create / pick organization
2. Connect treasury → fund testnet USDC
3. Create an agent identity (e.g. "Research bot")
4. Bind policy + payment access / caps / allowlists (Fleet Policy Pack in §8 is the deep demo shape)
5. Allocate / fund that agent’s wallet (on-chain ceiling)
6. Agents → Connections → issue agent_credential
7. Copy MCP URL + bearer (shown once) → paste into Claude / Cursor MCP config
```

That’s all you must provide. You are **not** required to host a public agent website for this path.

Console: `http://localhost:3005` → `/app/{org}/…` after sign-in.

#### B. NLP chat — “Chat with agent” (`/chat`)

Easy human surface: type a goal in natural language; AgentOps drives real org actions under policy.

| You might say | What AgentOps does |
|---|---|
| “What can AgentOps do?” | Product Q&A (MCP, marketplace, rails) |
| “Recommend marketplace services” | Listing cards → open hire |
| “Create 3 agents for research” | Propose → **confirm** → create agents |
| Fund / policy questions | Answers + deep links into console |
| Research / fleet goal | **Chat with agent** (`/chat`): multi-agent goals, payments, brief + receipts |

**Where:** [`/chat`](../apps/web/src/app/chat/page.tsx). Legacy console `/app/{org}/fleet-run` redirects to Chat — see [`demo/DEMO-RUNBOOK.md`](../demo/DEMO-RUNBOOK.md) Part B.

#### C. Optional later (Mode B — only if you want to *sell* work)

Host an HTTPS seller → Publish URL → ERC-8004 → Marketplace listing. Not required for “Claude spends for me via MCP.”

---

### 7.2 Agent path — Claude / Cursor after credentials exist

The session obtains a credential via Phase 0 paste, Phase 1 invite redeem, or Phase 3 open join (when enabled). Then:

#### Discover (no secret)

- `/?audience=agent` — structured summary
- `GET /llms.txt` — canonical cold-start ([`docs/llms.txt`](llms.txt))
- `GET /skill.md` — worked examples
- `GET /v1/agent-join/open/status` — whether open join is live

These explain *how*. Only the join HTTP APIs (invite/open) mint a connection when allowed.

#### Connect (secret from join or you)

```text
Streamable HTTP → Authorization: Bearer <credential>
     → agentops.onboard
     → live runtime contract
```

Local MCP URL default: `http://127.0.0.1:8070/mcp`.

#### Act (all governed)

| Goal | MCP tool |
|---|---|
| Contract | `agentops.onboard` |
| Non-pay HTTP / tool | `agentops.operation_check` |
| Other checks | `agentops.policy_check` |
| Human gate | `approval_status` → you approve in console → `approval_consume` |
| External pay | `agentops.payment_x402` (idempotent) |
| Same-org hire | `agentops.payment_intra_fleet` (not idempotency-key safe) |
| Publish endpoint | `agentops.publish` |
| ERC-8004 | `agentops.identity_status` / `agentops.identity_register` (wallet required) |
| Log | `operation_record` / `activity_record` |

#### Proven

| Proof | Link |
|---|---|
| Google ADK MCP `onboard` | spike-results Phase 9 · Task 5 |
| Claude MCP-only Gateway pay + replay | [`docs/qa/2026-07-13-x402-paid-http-evidence.md`](qa/2026-07-13-x402-paid-http-evidence.md) |
| Policy matrix | [`docs/qa/2026-07-12-testnet-release-evidence.md`](qa/2026-07-12-testnet-release-evidence.md) |

---

### 7.3 How the landing toggle maps to this

| Landing toggle | Means |
|---|---|
| **Human** | Operator UI path — you set boundaries, fund, approve, create invites, mint credentials |
| **Agent** | Structured cold-start for the IDE/LLM (`/?audience=agent` → `/llms.txt` / `/skill.md`) |

**Shipped on the Agent path (do claim these):**

- Follow `/llms.txt` → redeem invite (**Phase 1**) or open join when enabled (**Phase 3**), asking the human for `agent_name` first
- Or use a human-pasted MCP credential (**Phase 0**)
- After MCP connect: `onboard`, policy/payment tools, `agentops.publish`, and `identity_register` when payment access + Arc wallet exist (**Phase 2**)

Agent mode still **does not mint secrets by itself** — credentials come from Phase 0 / 1 / 3, never from the landing page alone.

---

### 7.4 How the two paths meet

```text
You: console / NLP chat / Approvals
        │  (operator session)
        ▼
   AgentOps API  ── policy · wallets · Permit2 / x402 · evidence
        ▲
        │  (bearer you pasted into Claude / Cursor)
Claude / Cursor via MCP
```

---

## 8. Fleet end-to-end story (policy-composed + proven)

This is the same five-agent research fleet we ran on real testnets — told as a **governed AgentOps composition**, not a happy-path payment script. Money moves only after wallet ceilings, destination allowlists, payment access, and the **Fleet Policy Pack** below clear the step.

**On-chain settlement re-verified:** 2026-08-07  
**Org:** `org_9add7cd3-03eb-471f-85db-7024a9a0a5bd`  
**Drivers:** `demo/reset.mjs` + `demo/run.mjs` against live API + Circle worker  
**Raw hashes:** spike-results § “Manifest §K.4 fleet demo”  
**Policy control shapes proven separately:** QA policy matrix + deny-weather policy ([§8.5](#85-what-we-already-proved-on-the-policy-surface))

### 8.1 Cast

| Agent | Chain | Role under policy |
|---|---|---|
| Orchestrator | Arc (+ Base funded) | Only hub allowed to hire Writer / SeniorReviewer; Base hire needs human approval |
| DataFetcher | Arc | May sell data; may **not** pay external merchants in this pack |
| Analyst | Arc | May hire **only** DataFetcher (second hop); tiny per-request cap |
| Writer | Arc | Sell-only in this run (no outbound hire) |
| SeniorReviewer | **Base** | Cross-chain review; receives only after Orchestrator approval clears |

### 8.2 Fleet Policy Pack (how this example is supposed to look)

Org default effect: **fail-closed** (`deny` unknown actions). Policies are versioned, activated, and **bound to named agents** before the run — so every hire shows AgentOps in the middle.

| # | Policy name (example) | Bound to | Action(s) | Effect | What it does in this story |
|---|---|---|---|---|---|
| P1 | `fleet-fail-closed` | Org default | *(no match)* | **deny** | Anything not explicitly allowed never silently passes |
| P2 | `orch-intra-fleet-arc-allow` | Orchestrator | fleet / intra-fleet hire on Arc to DataFetcher, Analyst, Writer | **allow** | Hub→spoke Arc hires that match amounts below |
| P3 | `orch-base-review-needs-human` | Orchestrator | intra-fleet hire on **Base** → SeniorReviewer | **require approval** | Cross-chain spend pauses in Approvals inbox; operator approves → `approval_consume` → re-issue |
| P4 | `analyst-second-hop-only` | Analyst | intra-fleet → DataFetcher only | **allow** | Second hop is deliberate; Analyst cannot hire Writer / SeniorReviewer |
| P5 | `deny-unknown-payees` | Orchestrator, Analyst | any payment to non-allowlisted address | **deny** | payTo / destination allowlist must list fleet wallets first |
| P6 | `deny-external-x402-unless-authorized` | DataFetcher, Analyst, Writer | `payment.x402.authorize` | **deny** | Lane 1 off by default in this pack (optional weather fixture is a separate, explicit authorize) |
| P7 | `observe-outbound-http` | Orchestrator | `runtime.http.request` | **observe** | Free HTTP is logged / watched, not a silent free-for-all |
| P8 | `deny-weather-hosts` *(optional beat)* | any agent with HTTP | `runtime.http.request` matching weather fixture hosts | **deny** | Same shape as proven `QA deny weather requests` policy |
| P9 | `tool-rate-limit` | Orchestrator | `tool.call` / operation checks | rate limit | Blocks bursty re-checks (proven: first allow, second `operation_rate_limited`) |

**Payment controls layered on top of policies** (Controls / agent payment access — still AgentOps, still visible in the example):

| Control | Example value in this pack | Who |
|---|---|---|
| Payment access | **enabled** only after operator toggle | All paying agents |
| Per-request cap | Orchestrator `0.10` USDC · Analyst `0.02` USDC | Caps each hire |
| Monthly / period budget | Orchestrator `1.00` USDC · Analyst `0.20` USDC | Caps the whole run |
| Approval threshold | Base hire ≥ `0.03` USDC → approval | Matches SeniorReviewer amount |
| Wallet ceiling + gas reserve | On-chain max loss + Arc unspendable dust | Physics layer under policy |
| Permit2 delegation | Standing ceiling per payer→payee pair | Lane 2 settlement after policy allow |
| Destination allowlist | DataFetcher / Analyst / Writer / SeniorReviewer wallets only | P5 |

Together: **policy decides if the intent is allowed; payment controls bound how much; the wallet balance is the hard stop; Permit2 / x402 / escrow settle.**

### 8.3 Step-by-step: policy → AgentOps call → settlement (with proofs)

Read this top to bottom. Each row is one governed beat — this is what “AgentOps is deeply composed” looks like.

| Step | Intent | Policies / controls that must clear | AgentOps surface | Outcome + proof |
|---|---|---|---|---|
| 0 | Fund + allocate fleet | Solvency: Σ allocations ≤ treasury; gas reserve reserved | Console Fund / allocations | Ceilings visible on explorer before any hire |
| 1 | Orch hires DataFetcher (0.01 Arc) | P1, P2, P5 · Orch payment access · cap · Permit2 headroom | `payment_intra_fleet` | [Arc tx](https://testnet.arcscan.app/tx/0x68c135624c3909b754a1a66246925f032906d62308c027e4611682d3ad9565ee) |
| 2 | Orch hires Analyst (0.05 Arc) | P1, P2, P5 · caps | `payment_intra_fleet` | [Arc tx](https://testnet.arcscan.app/tx/0x96867c7c5493d250fdc0daeff05c6d91f457fd4f75e4de26ee282dd1bce9ceb0) |
| 3 | **Analyst** hires DataFetcher (0.01 Arc) | P1, **P4**, P5 · Analyst cap `0.02` · Analyst’s own credential | Analyst `onboard` → `payment_intra_fleet` | [Arc tx](https://testnet.arcscan.app/tx/0x576be257d15dfeddcab8801ef0187115076dde6e346c0388ca52adaceae6abfa) — Transfer from **Analyst** wallet |
| 4 | Orch hires Writer (0.02 Arc) | P1, P2, P5 | `payment_intra_fleet` | [Arc tx](https://testnet.arcscan.app/tx/0x9939df2b2c5d694802e1c53cccd5bb933cc01c01965bcb4b4f0ec548e2275822) |
| 5 | Orch hires SeniorReviewer (0.03 **Base**) | P1, **P3**, P5 · Base wallet funded · approval threshold | `payment_intra_fleet` → `approval_status` → human approve → `approval_consume` → re-issue | [Base tx](https://sepolia.basescan.org/tx/0x738e4229f6a35e953e647cca23ed102399abe871704461423aefa4e05594716e) |
| 6 *(guardrail beat)* | Over-cap hire (e.g. ask for 25 USDC) | Wallet ceiling / per-request / budget | same payment path → **deny / 409** | Proven shape: `insufficient_agent_wallet_balance` / `Payment amount exceeds the agent per-request cap` |
| 7 *(guardrail beat)* | Hire unknown payTo | **P5** deny | payment refused | No tx |
| 8 *(guardrail beat)* | Weather / disallowed HTTP | **P8** deny (or P6 for x402) | `operation_check` / `payment_x402` → `policy_denied` | Proven: QA deny weather + payment policy deny decision ids |
| 9 | Assemble brief + receipts | — | `activity_record` | Decision ids + explorer links on one screen |

**Reading Arc receipts:** one payment often shows **two** `Transfer` logs (native 18dp + ERC-20 6dp views of the same USDC). That is Arc dual-view behavior, not a double spend.

### 8.4 What the operator sees (so it feels like AgentOps)

For each step card / Activity row, the product should surface:

- AgentOps tool: `payment_intra_fleet` / `payment_x402` / `operation_check` / …
- **Policy decision:** `allow` | `deny` | `observe` | `approval_required`
- `decision_id` / `approval_id` when present
- Matched **policy name + version** (e.g. `orch-base-review-needs-human` v2)
- Rail: `permit2_intra_fleet` | `x402_*` | `escrow`
- Amount, chain, tx hash (explorer link)
- Payer → payee agent ids

Script line after each payment: *“That spend went through AgentOps — policy and budget first, then settlement.”*

### 8.5 What we already proved on the policy surface

The payment txs in §8.3 are on-chain. The **policy control vocabulary** this pack uses was exercised with a real MCP-only Claude agent (browser-authored policies), including:

| Scenario | Result | Evidence pointer |
|---|---|---|
| Default / unmatched operation | allow path recorded | `pdec_6514a9ed-…` |
| Observed HTTP policy | observe | `pdec_623f7f51-…` |
| Denied HTTP policy | deny `policy_denied` | `pdec_86ad6198-…` |
| Rate limit | first allow, second blocked | `opdec_3637a28b-…` → `opdec_87275a95-…` |
| Tool approval + one-time consume | approved then consumed; replay fail-closed | `apv_8167ac3d-…` |
| Payment policy deny | `policy_denied` | `pdec_d1c5176b-…` |
| Per-request cap | blocked | “Payment amount exceeds the agent per-request cap.” |
| Monthly budget | blocked | “Payment amount exceeds the agent budget.” |
| Approval threshold → paid retry | approval then Gateway settle | `apv_3618bdc1-…` → `payevt_1214265e-…` |
| Named deny-weather policy | MCP weather → deny v2 | Org B `QA deny weather requests` |

Full matrix: [`docs/qa/2026-07-12-testnet-release-evidence.md`](qa/2026-07-12-testnet-release-evidence.md) § Real-Agent Policy Matrix · Paid path detail: [`docs/qa/2026-07-13-x402-paid-http-evidence.md`](qa/2026-07-13-x402-paid-http-evidence.md).

### 8.6 Supporting settlement mechanism proofs

| Capability | Proof | Link |
|---|---|---|
| Permit2 full cycle (approve → permit → transferFrom) | Spike S4 | [approve](https://testnet.arcscan.app/tx/0xff5410c60a4a697427b232afcd349a68761babe7f673290d1172daa2f35c1aaa) · [permit](https://testnet.arcscan.app/tx/0x96f050c234137c33c2069650ac10fed9e4728d2fabfebcbb46e6612c306a5d45) · [transferFrom](https://testnet.arcscan.app/tx/0x5161d370609fcb7ee4e574b2ae9f71bcf3523c1b3448285f9e783d0a722679e8) |
| Production `permit2.ts` drawdown + lockdown | Phase 6 · Task 2 | [drawdown](https://testnet.arcscan.app/tx/0x823255030af94a46b64e6635914b022e86cca9ed4c685794757e7bc6dae86f25) |
| Entity-secret sweep (fund → transfer) | Spike S3 | [tx](https://testnet.arcscan.app/tx/0x0cb4fe447ad1e00bd5ef78faf4ef9cce6fe5d222e264044182eaef5d50d252a3) |

---

## 9. Escrow → reputation → Permit2

### Why both rails exist

| Situation | Use | Why |
|---|---|---|
| Both agents are ours | **Permit2** | Escrow adds many txs for little trust gain |
| External / first hire, client can judge work | **Escrow (Mode 2: client = evaluator)** | Proves funds exist before work — **not** neutral arbitration |
| Neither side trusts judgement | Escrow + independent evaluator | Rare; escrow’s real purpose |

### 9a. Escrow lifecycle (proven on our guarded deploy)

Our escrow (S9) blocks the front-run that worked on Arc’s stale deploy (S8). Proxy: [`0x31C050d9…4e0F5`](https://testnet.arcscan.app/address/0x31C050d9D20504c4E11b2A894051d8181B14e0F5).

Fleet org live job (Orchestrator → DataFetcher, 0.02 USDC):

| Step | Explorer |
|---|---|
| `createJob` | [tx](https://testnet.arcscan.app/tx/0xc35eec33792abcf1ab1e6f6d825a3f2531c68de20e9a5a9cdb2a17d0c70bdfc0) |
| `fund` (0.02 USDC into escrow) | [tx](https://testnet.arcscan.app/tx/0xfaa93bdd479d312fe1e89e393be41bc2b6b8eb740b16c7ee844ad4d696c73e7c) |
| `submit` | [tx](https://testnet.arcscan.app/tx/0x0385d604dfee77504d39762b95d6fc314beae15e0a3e1f896324fc34089e0443) |
| `complete` (escrow → provider) | [tx](https://testnet.arcscan.app/tx/0x3ca56d8657ca8e10adad9acaea773d4cddcb43004b73f2ef7f86a307dd6735fa) |

### 9b. Reputation only after paid completion

ERC-8004 alone does **not** require the rater to have paid. We only write feedback from a **settled escrow completion** hook. The platform reputation score is kept on a **0–100** scale (aggregate capped).

| Step | Proof |
|---|---|
| Register DataFetcher identity | token `864672` · [tx](https://testnet.arcscan.app/tx/0x2ac62d9f1c6ef740c062573bda7da7d6698d0042de0e5733bf7eda88984d15bb) |
| On-chain `giveFeedback` | [tx](https://testnet.arcscan.app/tx/0x885467500b8e370bd9dd5dce5285ef7e311b83258329d26f5992ed35b120fe10) |

Also: earlier identity mint token `863468` · [tx](https://testnet.arcscan.app/tx/0x7fc58f442eb853787c25ac20c9988d465154a2bcf5858245119f7df34ebaa539).

### 9c. Reputation moves capital (bounded)

Formula ([`docs/decisions.md`](decisions.md) K-6): move toward reputation target, max **10%** of current allocation per step; never past operator ceiling / gas-reserve floor; solvency still wins.

| Agent | Reputation | Allocation |
|---|---|---|
| DataFetcher | 100 | **1.50 → 1.65 USDC** |
| Writer | 0 | **1.50 → 1.35 USDC** |

### 9d. Graduation demo (6 txs → 1)

After two completed escrow jobs, operator trusts provider → Permit2 ceiling → one drawdown:

[Graduation drawdown tx](https://testnet.arcscan.app/tx/0xef084b9e1dff76fafed5a28715e07f0f6bcced77349aeba964b0a93640722e04)

---

## 10. Kill switch and sweep

Revoke agent → status suspended → worker enqueues `agent_wallet.sweep` → entity secret transfers remaining USDC to treasury (leaves designed gas dust on Arc).

| | Before | After |
|---|---|---|
| Agent wallet | $0.55 | ~$0.05 dust |
| Treasury | $18.95 | $19.44 |

**Proof:** [sweep tx `0x566966b7…5627`](https://testnet.arcscan.app/tx/0x566966b754ae9dca563f9f8592bfc6ba6051713c3bbcb423f272b3ec0f3d5627)

No Circle OTP. Machine-speed revoke.

---

## 11. Bugs, traps, and wrong turns

These are **real**. Read them before assuming “our code is broken” or “Circle is broken” blindly.

### 11.1 ★ Base Sepolia ETH from an external wallet is invisible to Circle (critical)

**What you see**

- Explorer / public RPC: wallet **has** ETH (e.g. 0.0029 ETH on-chain).
- Circle `contractExecution`: fails with `155258 "the asset amount owned by the wallet is insufficient for the transaction."`
- Circle `GET /wallets/{id}/balances?includeAll=true`: **no native ETH entry** — USDC only.

**Why**

Circle’s pre-flight checks its **indexed** balance, not live chain state. A plain inbound ETH transfer has **no ERC-20 Transfer log**, so a *newly created* Base Sepolia wallet may never show that ETH. Every tx (even zero-value `approve`) is rejected.

**What fixed it in our isolation**

A **Circle-originated** native ETH transfer of 0.00005 ETH into the same wallet forced a rescan — then `/balances` showed **0.00295 ETH** (external 0.0029 + Circle 0.00005), and signing worked.

Confirming transfer: [`0xb2e85f4064fa6933b59e99bf44c99e8b76a9dde2ae6869c8f320ccbaf4167333`](https://sepolia.basescan.org/tx/0xb2e85f4064fa6933b59e99bf44c99e8b76a9dde2ae6869c8f320ccbaf4167333)

**Product rule (accurate claim)**

> Fund Base gas **from another Circle wallet**.  
> An externally funded wallet can hold ETH on-chain and still be rejected as insufficient.

`ensureAgentGasFloor` is intentionally a no-op off Arc for this reason. Full isolation table: spike-results § “Circle native-balance indexing misses externally-received ETH”.

---

### 11.2 Unregistered entity secret looks like “insufficient balance”

Code `155258` is **undocumented** and misleading. Same message for:

- Unregistered entity secret (Phase 6 · Task 7)
- Truly insufficient gas
- Unindexed external ETH (§11.1)

**Correct DCW setup**

1. API key in full `TEST_API_KEY:…` form  
2. Generate entity secret locally → `registerEntitySecretCiphertext`  
3. Fund USDC (both chains) + Base ETH **via Circle**

---

### 11.3 Arc public RPC is flaky (~56% failure on balance reads)

Spike **S6**: failed `balanceOf` must **never** coerce to `0` (that rejects valid payments / triggers false top-ups). Retry with backoff; exhausted retries → `balance_unavailable`, distinct from `insufficient_agent_wallet_balance`.

---

### 11.4 Permit2 implementation bugs found only on live infra

Mocked tests missed all three:

1. Signed permit never submitted on-chain → drawdowns always fail  
2. Nonce hardcoded to `0` → opaque Circle `"API parameter invalid"`  
3. Overlong `refId` (~100 chars) → same opaque error  

Fixed in `permit2.ts` (`recordSignedDelegation` submits `permit()`, live nonce read, short refIds).

---

### 11.5 Sweep stored Circle UUID instead of on-chain tx hash

First revoke run recorded `provider_ref` as Circle’s internal transaction id, not `txHash`. Fixed so sweeps / topups return the real explorer hash.

---

### 11.6 Stale Arc ERC-8183 escrow allowed front-running (S8)

Deployed Arc reference escrow used `fund(jobId, bytes)` **without** `expectedBudget`. Provider raised budget after quote; client’s fund silently paid **0.04** instead of **0.02**.

Attack fund tx (succeeded on stale deploy):  
[`0x0907ac70…e2a2`](https://testnet.arcscan.app/tx/0x0907ac70b8b542a780b8f42630da30e5e8a00c9b510c7c7d3ba06db5d2f2e2a2)

**Our deploy (S9)** replays the same attack → fund **reverts**, escrow balance stays `0`:  
[`0x77f4c847…e382`](https://testnet.arcscan.app/tx/0x77f4c847adeadc3f962710d7a8e11548340c83d9c144ce7169718d3c4657e382)

Honest escrow claim until then: *proof-of-funding once funded*, not price protection.

---

### 11.7 Tutorial ABIs ≠ deployed bytecode

S8 also showed `jobs(uint256)` from tutorials does not match the contract; real getter is `getJob(uint256)`. Always decode selectors / pull ABIs from source, not from tutorial prose.

---

### 11.8 Faucet API unavailable on our key

`POST /v1/faucet/drips` → 403 / later 429. Not an Arc limitation (Base fails the same). Fund via Arc public faucet or internal transfers.

---

### 11.9 Credential / account rotation strands old wallets

After rotating Circle accounts, old addresses vanish from the new wallet list; Gateway deposits on old depositors become unreachable. Always verify ownership against the **current** API key before trusting addresses from older proofs.

---

### 11.10 Gateway attestation reserves balance before mint

Issuing an attestation reduces available Gateway balance immediately. Failed mints can leave funds reserved — retry carefully.

---

### 11.11 Early wrong conclusions (kept so we don’t repeat them)

| Wrong turn | Reality |
|---|---|
| “Circle can’t spend externally sent ETH” (global) | Only true for **newly indexed Base wallets**; Circle-originated native transfer fixes indexing |
| “Need faucet / Gas Station / SCA” | Would break Gateway + Nanopayments EOA requirements |
| “mint fails because of min ETH floor” | Disproven — successful mint used **less** ETH than earlier “not enough” amounts; real issue was credentials / account |

---

## 12. What is proven vs not

| Claim | Status | Where |
|---|---|---|
| Per-agent DCW wallets on Arc | ✅ | S2 |
| Wallet balance = max loss | ✅ | Phase 3 · Task 4 |
| Sweep on revoke | ✅ | [sweep tx](https://testnet.arcscan.app/tx/0x566966b754ae9dca563f9f8592bfc6ba6051713c3bbcb423f272b3ec0f3d5627) |
| Permit2 Lane 2 fleet payments | ✅ | Fleet table §8 |
| Second-hop agent↔agent | ✅ | [Analyst→DataFetcher](https://testnet.arcscan.app/tx/0x576be257d15dfeddcab8801ef0187115076dde6e346c0388ca52adaceae6abfa) |
| Cross-chain Arc→Base hire | ✅ | [Base tx](https://sepolia.basescan.org/tx/0x738e4229f6a35e953e647cca23ed102399abe871704461423aefa4e05594716e) |
| JIT Gateway bridge Arc→Base | ✅ | [mint tx](https://sepolia.basescan.org/tx/0x3c71a8a2be8fa01f75211c07526382ea42bf93c6281e953c986957225ef02058) |
| Guarded ERC-8183 escrow | ✅ | S9 + §9a |
| Payment-gated reputation | ✅ | [feedback tx](https://testnet.arcscan.app/tx/0x885467500b8e370bd9dd5dce5285ef7e311b83258329d26f5992ed35b120fe10) |
| Reputation → allocation | ✅ | spike §K.4 steps 9–11 |
| Escrow → Permit2 graduation | ✅ | [drawdown](https://testnet.arcscan.app/tx/0xef084b9e1dff76fafed5a28715e07f0f6bcced77349aeba964b0a93640722e04) |
| MCP onboard + paid fixture path | ✅ | ADK + [x402 evidence](qa/2026-07-13-x402-paid-http-evidence.md) |
| Invite redeem → MCP credential (payment off) | ✅ shipped | §7.0 · API `POST /v1/agent-join/invite/redeem` |
| MCP publish + ERC-8004 register path | ✅ shipped | Publish tab / `agentops.publish` · register needs wallet |
| Open join | ✅ code; ⬜ off by default | Env-gated §7.0 |
| Base external ETH indexing bug | ✅ characterized | §11.1 |
| **Lane 1 x402 to a real third-party merchant** | ⬜ **Do not claim** | Only fixture / simulation attempts on record |

Master acceptance table: [`docs/spike-results.md` § Acceptance artifacts](spike-results.md#acceptance-artifacts).

---

## 13. Related docs

| Doc | Use it for |
|---|---|
| [`README.md`](../README.md) | Setup, ports, short E2E + proof links |
| [`docs/spike-results.md`](spike-results.md) | Raw evidence log (every hash) |
| [`demo/DEMO-RUNBOOK.md`](../demo/DEMO-RUNBOOK.md) | Camera / judge demo script |
| [`docs/handover.md`](handover.md) | Plain-English “why” |
| [`docs/arc-agentops-addon.md`](arc-agentops-addon.md) | Positioning vs Circle SDKs + marketplace notes |
| [`docs/deployment/hosted-mcp.md`](deployment/hosted-mcp.md) | Hosted MCP HTTPS contract |
| [`docs/current-architecture-and-userflow.md`](current-architecture-and-userflow.md) | As-built internals (auth → org → runtime) |
| [`docs/batch-settlement-binding.md`](batch-settlement-binding.md) | Permit2 commitment / drawdown |
| [`docs/change-manifest.md`](change-manifest.md) | Sequenced build plan |
| [`docs/decisions.md`](decisions.md) | Locked decisions |
| [`docs/llms.txt`](llms.txt) / [`docs/skill.md`](skill.md) | Agent onboarding (also `/llms.txt`, `/skill.md`, `/?audience=agent`) |
| [`apps/web/src/app/chat/page.tsx`](../apps/web/src/app/chat/page.tsx) | Human NLP chat entry (`/chat`) |
| [`docs/qa/2026-07-13-x402-paid-http-evidence.md`](qa/2026-07-13-x402-paid-http-evidence.md) | MCP paid HTTP evidence |
| [`docs/qa/2026-07-12-testnet-release-evidence.md`](qa/2026-07-12-testnet-release-evidence.md) | Earlier testnet gates |
| [`docs/env-inventory.md`](env-inventory.md) | Env keys |
| [`packages/onchain/README.md`](../packages/onchain/README.md) | Escrow deploy notes |

---

*Last updated 2026-08-10 (Activity hub at `/activity`, Purchases in sidebar, Fleet Run console page retired → `/chat`). When you add a new live proof, append it to `docs/spike-results.md` first, then mirror the explorer link here.*
