---
created: 2026-07-13
project: agentOps
tags: [competitive-analysis, market-research, strategy, money-control]
---

# Competitive Landscape — Agent Policy & Money-Control Infrastructure

> Research method: 5D concept-interrogation (direction, ownership, effect, independence,
> assumptions) applied to the field around AgentOps. Sources dated to July 2026.

---

## The One Thing To Internalize First

"Agent policy infrastructure" is **not one market**. It is two markets that share
vocabulary — *policy, approval, audit* — but solve different problems and are contested by
different players with different funding.

- **Market A — Agent Payments / Spend Control.** Problem: agents move real money; bound
  their financial authority. This is where Ampersend lives.
- **Market B — Agent Identity / Authorization / Governance.** Problem: who is this agent,
  what may it do across *any* action, and prove what it did. This is where AgentOps started.

**AgentOps' decision (July 2026): build hard money control *into* the policy layer — i.e.
be a superset that spans both markets.** Funds route through a surface AgentOps controls, so
a policy denial physically stops settlement. That is a real moat and a real burden — it
inherits the regulated, unfinished problems of Market A (custody, compliance screening,
on/offramp, money-transmission posture).

This decision means: **Ampersend is now a direct competitor, not a complementary layer.**
The earlier "we sit before them, they execute" framing (see
[[agentops-vs-ampersend]]) no longer holds once AgentOps owns the money path.

---

## Market A — Agent Payments / Spend Control

Every product here narrows an agent's spend authority on four axes: **how much, to whom,
when, and whether a human must confirm.** The tell that this market is real: **Visa and Amex
are directly investing.**

| Player | What it is | Backing / Traction | Live? |
|---|---|---|---|
| **Ampersend** | Control layer for agent payments on x402 + A2A. Budget caps, merchant allowlists, TRM Labs screening, dual-sided (spend + earn) governance, auto top-ups, audit export | Built by **Edge & Node** (team behind **The Graph**). Collaborated w/ Coinbase, Google, Ethereum Foundation dAI. Launched Nov 20 2025 at Pragma BA | **Public beta.** Self-custody, on/offramp, agent cards = "coming soon". No disclosed user/revenue numbers |
| **Skyfire** | "Agent trust stack" — KYA (Know Your Agent) signed-JWT identity + KYAPay instant USDC settlement | Funded 2024, TechCrunch-covered | Live |
| **Nekuda** | "Mandate model" — agentic mandates: what an agent may buy, conditions, limits, approvals | **$5M (May 2025)** — Madrona, **Amex Ventures, Visa Ventures** | Live |
| **Payman** | Marketplace for agents to pay *humans* for tasks needing judgment | Funded | Live |
| **Crossmint / Rye / Catena / Nevermined / PayOS / Basis Theory** | Various agent payment rails & spend primitives | Mixed | Mostly live |

**Underlying standards (governed by others, not us):** x402 (Coinbase), A2A (Google),
AP2 (Google), ERC-8004 (agent discovery/reputation), MCP authorization spec. Cloudflare +
Coinbase run the **x402 Foundation**.

---

## Market B — Agent Identity / Authorization / Governance

This is AgentOps' *native* category — and the one the prior docs never benchmarked against.
The strongest rivals here already ship the **hard enforcement AgentOps deferred**, and two
of them are open-source or hyperscaler-native (which compresses willingness-to-pay).

| Player | What it is | Backing / Traction | Threat |
|---|---|---|---|
| **Oasis Security** | "Agentic Access Management" — real-time policy enforcement + full audit across agents. Framework co-designed w/ Sequoia + CISO group | **$120M Series B (Mar 2026)**, $190M total — Sequoia, Accel, Craft, Cyberstarts | **Highest.** Our exact thesis, funded ~20–30×, selling to enterprise now |
| **Microsoft Agent Governance Toolkit (AGT)** | OSS runtime layer between MCP client and tool servers. Evaluates every tool call against OPA/Rego/Cedar **pre-execution**, sub-ms overhead | Microsoft, **free/OSS** | **Existential to our MCP story** — it *is* our runtime-check layer, given away |
| **Cerbos** | OSS policy engine (YAML). Pivoted from app-authz into agentic authorization + MCP security + RAG access. Request-time evaluation | Established OSS, VC-backed | High — owns the "policy engine" primitive |
| **Google Cloud IAP for Agents / Agent Identity** | First-class agent principal on **SPIFFE**, policy enforcement at the gateway | Google Cloud native | High — cloud-native default |
| **Descope / Astrix / Okta** | Non-human & agent identity governance | Okta = incumbent; others funded | High on identity |
| **Keycard** | MCP-aware credential issuance at the tool-call boundary; blocks vulnerable MCP servers | Startup | Medium, narrow |

**Category funding context:** top-10 agentic-AI-security startups raised **~$3.6B combined**;
investors explicitly funding "control planes / governance substrates / enterprise control
points."

---

## The 5D Findings — Where AgentOps Actually Stands

**DIRECTION (enforcement).** The prior model was *advisory*: AgentOps issues a verdict but
"does not physically stop the agent." Competitors (MS AGT, Google IAP, Cerbos, Keycard)
enforce at a **choke point they own**. The July 2026 decision to put AgentOps **in the money
path** closes this gap *for payments* — a denial physically stops settlement. It does **not**
close it for non-payment actions (HTTP/tools) unless execution also routes through an
AgentOps-controlled surface. So: hard enforcement on money, advisory on everything else,
until a general execution proxy exists.

**OWNERSHIP (moat).** Ampersend's moat = it owns money movement (Coinbase custody). Oasis'
moat = enterprise identity relationship + CISO co-design. AgentOps' moat only becomes real
**if the money path ships** — funds must route through a surface we control (own custody, or
orchestrate a custodian like Coinbase/Fireblocks/Bridge). Riding a custodian = we're an
orchestration layer; building custody = a different, regulated company. **This is the
single decision that determines whether the moat exists.**

**EFFECT (downstream).** Advisory denial changes only our DB + audit log. Money-path denial
stops real USDC. Committing to hard money control is what upgrades our "effect" from weakest
to competitive — but only on the payment surface.

**INDEPENDENCE (standards).** Every rail we depend on (x402, A2A, AP2, MCP-authz, SPIFFE) is
governed by Coinbase / Google / Cloudflare / Microsoft — not us. If MCP bakes authorization
into the protocol spec (actively happening), our MCP-adapter value shrinks. We are a
consumer of standards we don't govern.

**ASSUMPTIONS (load-bearing).**
- ⚠️ Old assumption "Ampersend is our reference competitor, and we're complementary" is
  **void** now that we target money control. We are a **superset competitor** to Ampersend
  and a **direct competitor** to Oasis.
- ⚠️ Ampersend's own site now advertises policy engine + approvals + audit + dual-sided
  governance — they are **expanding up into governance**. The clean market split is closing
  from both directions.
- ⚠️ Superset positioning is credible **only if the money path actually ships.** Until then
  we make a stronger product's claims with a weaker product.

---

## Did They Actually Come To Market / Do They Have Users?

- **Ampersend** — Yes (Nov 2025, public beta), credible team, heavy press, **no disclosed
  user/revenue numbers.** Treat traction as unproven.
- **Oasis Security** — Yes, in-market with enterprise CISOs, $190M raised. **The one with
  real customers in our exact category.**
- **Skyfire / Nekuda / Payman** — Yes, live, funded (Visa/Amex/Madrona) — Market A.
- **Cerbos / Microsoft AGT / Google IAP** — Yes, shipping, with enforcement we deferred;
  Microsoft & Google variants are **free/OSS/cloud-native**.

---

## Open Strategic Questions (unresolved)

1. **Custody: build or orchestrate?** Own rails (regulated, slow, moat) vs orchestrate a
   custodian (fast, thinner moat). Determines whether the money-path moat is real.
2. **Compliance parity:** Ampersend has TRM Labs screening today. Hard money control without
   sanctions/risk screening is not enterprise-sellable. What's our equivalent?
3. **Wedge vs Oasis:** Oasis attacks enterprise CISOs top-down with $190M. What un-owned
   segment (solo devs, crypto-native agents, a vertical) do we win first?
4. **Enforcement breadth:** money path is hard-controlled; HTTP/tool actions stay advisory
   until a general execution proxy exists. Is that split acceptable to buyers, or does it
   read as "half-enforced"?

---

## Follow-up docs to write

- Full 5D teardown of **Oasis Security** (biggest governance threat) and **Ampersend**
  (biggest money-control threat).
- Rewrite [[what-is-agentops]] — it still says payment execution "is not built yet," which
  now contradicts the money-control thesis.
- Rewrite [[agentops-vs-ampersend]] — reframe from "complementary" to "superset / direct".

---

## Sources

- Ampersend — https://ampersend.ai/
- CoinDesk, Edge & Node launch ampersend — https://www.coindesk.com/tech/2025/10/30/the-graph-builders-edge-and-node-unveil-ampersend-dashboard-to-manage-ai-agent-payments
- Oasis Security $120M Series B — https://techstartups.com/2026/03/19/cybersecurity-startup-oasis-security-raises-120m-from-craft-sequoia-accel-to-tackle-ai-identity-risks/
- Agentic AI security funding roundup — https://softwarestrategiesblog.com/2026/03/28/agentic-ai-security-startups-funding-mna-rsac-2026/
- Microsoft Agent Governance Toolkit — https://opensource.microsoft.com/blog/2026/04/02/introducing-the-agent-governance-toolkit-open-source-runtime-security-for-ai-agents/
- Cerbos agentic authorization — https://www.cerbos.dev/features-benefits-and-use-cases/agentic-authorization
- Google Cloud IAM agent runtime defense — https://cloud.google.com/blog/products/identity-security/whats-new-in-iam-security-governance-and-runtime-defense
- Proxy — AI Agent Payments Landscape 2026 — https://www.useproxy.ai/blog/ai-agent-payments-landscape-2026
- Skyfire — https://skyfire.xyz/
- Superblocks — 9 Best Agent Governance Platforms 2026 — https://www.superblocks.com/blog/ai-agent-governance-platform
