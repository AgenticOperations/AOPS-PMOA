# AgentOps on Arc — control plane, not another SDK

AgentOps is the **org control plane + hosted MCP** on top of Circle/Arc primitives. It is **not** a replacement for Circle wallets, x402 batching, Gateway, App Kit, or Agent Stack CLI.

Agents reach AgentOps via:

1. **Hosted MCP** (Mode A — Cursor / Claude) — no SDK required  
2. **Runtime HTTP** (`/v1/runtime/...` with an agent credential)  
3. **Operator console** (policy, treasury, publish, hire)  
4. **Optional thin client** [`@agentops-pmoa/runtime-client`](../packages/runtime-client) — credential + `check` / `paymentX402` / `paymentIntraFleet` for Node templates only  

We do **not** publish a wallets / x402 / Gateway SDK. That stays Circle’s.

```text
IDE (MCP) ──► Runtime HTTP ──► Arc / Circle primitives
Template ──► thin client ─┘         ▲
Console (policy, treasury, publish) ┘
```

## Two onboarding modes

| Mode | Path | What AgentOps adds |
|---|---|---|
| **A — MCP** | Create agent → credential → Cursor/Claude hosted MCP | Policy, approvals, treasury spend without a local private key |
| **B — Publish Arc agent** | Fork/enhance [arc-nanopayments](https://github.com/circlefin/arc-nanopayments) → host seller → paste URL → register ERC-8004 | Governed buyer path + identity + hire (x402 via runtime / ERC-8183 escrow) |

Reputation is earned only after **settled escrow**, never at publish.

## Official Arc / Circle surfaces → AgentOps plug-in

| Source | What it is | AgentOps use |
|---|---|---|
| [circlefin/arc-nanopayments](https://github.com/circlefin/arc-nanopayments) | LangChain buyer + Next.js x402 seller + Gateway | **Primary Mode B template** — see [`templates/arc-nanopayments-agentops`](../templates/arc-nanopayments-agentops) |
| Arc tutorial [Register AI agent](https://docs.arc.io/arc/tutorials/register-your-first-ai-agent) | DCW + ERC-8004 identity | Console **Publish** → `registerAgentIdentity` |
| Arc tutorial [ERC-8183 job](https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job) | create/fund/submit/complete | Console **Hire** → our ERC-8183 escrow engines |
| [circlefin/arc-escrow](https://github.com/circlefin/arc-escrow) | Freelance + EIP-712 Refund Protocol | **Out of scope** for hire (not ERC-8183) |
| [arc-ecommerce-payments](https://github.com/circlefin/arc-ecommerce-payments) / [arc-commerce](https://github.com/circlefin/arc-commerce) | Human checkout / credits | Not Mode B |
| Circle [Agent Stack](https://developers.circle.com/agent-stack) | CLI, Agent Wallets, Marketplace | Compose on payments; compete on **governance** |

## Ownership split

| Layer | AgentOps | Leave to Arc/Circle |
|---|---|---|
| Org policy, approvals, budgets, kill/sweep | Yes | — |
| Per-agent DCW + treasury | Yes | Circle Wallets API underneath |
| Hosted MCP | Yes | — |
| Thin runtime client | Optional | — |
| x402 facilitator / Gateway | Call via runtime | `@circle-fin/x402-batching`, Gateway |
| Identity registries | Register via our wallet | On-chain 8004 |
| Escrow job lifecycle | Our 8183 client | On-chain 8183 |
| Agent discovery | Org directory (governed) | agents.circle.com (don’t clone) |

## Marketplace (cross-org discovery)

Logged-in **Marketplace** (`/app/{org}/marketplace`) lists:

1. **Curated demo/test x402 services** (fleet DataFetcher/Analyst/Writer/SeniorReviewer + testnet weather fixtures)
2. **Published agents** across orgs (`metadata.public_endpoint_url` set via Publish tab)

Hire from a listing with **x402 micropay** (after explicit payTo authorize) or **ERC-8183 escrow** (when the seller has a wallet address). This is org-governed discovery — not a clone of Ampersend / agents.circle.com.

## Fleet demo

Live multi-agent payments stay on the scripted fleet — see [`demo/DEMO-RUNBOOK.md`](../demo/DEMO-RUNBOOK.md). Mode A MCP drives **one** governed agent; the five-agent show is `demo/run.mjs`. Marketplace is additive discovery/hire UX.
