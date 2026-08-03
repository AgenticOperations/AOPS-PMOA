---
created: 2026-08-02
project: agentOps
ecosystem: [circle, arc]
tags: [plan, architecture, plain-english, arc-hackathon]
status: proposal — grounded in verified Circle/Arc docs and the real codebase
---

# agentOps on Arc — Every Concern, Answered in Plain English

This document takes every concern raised in our discussion, explains it in ordinary language, says honestly what is possible and what is not, and lays out exactly what to build and in what order.

The guiding idea, stated once up front, because everything else follows from it:

> **There are two bad ways to control an AI agent's money. Circle's way puts a human with an email inbox in the middle of every decision — safe, but it kills autonomy. Ampersand's way puts their own server in the middle of every decision — fast, but now you're trusting a company's promise instead of a mathematical fact. We are going to do neither. We are going to make the limit a physical fact about money, not a rule enforced by software.**

---

# Part 1 — The five concerns, plainly stated

Before solutions, here is what we're actually worried about, in plain terms.

**Concern 1 — Scoped delegation.** A person should be able to say "this agent may spend up to $50, only on these things, until Friday" and have that be *genuinely true* — not just a note in a database that some code is supposed to respect. And they should be able to take it back instantly.

**Concern 2 — Agent-to-agent commerce.** Right now our agents can only pay *services*. We want one agent to be able to hire another agent, and for that to actually work — including knowing whether the other agent is trustworthy, and what happens if it takes the money and doesn't deliver.

**Concern 3 — Automatic top-up.** An agent that runs out of money mid-task is useless. Money should flow to it automatically when it runs low, without a human noticing and doing it manually.

**Concern 4 — Real-time compliance.** Before money moves, we should know if the destination is a sanctioned address, a known scam, or otherwise dangerous.

**Concern 5 — The fleet problem.** One agent is a demo. Ten agents working together, sharing a budget, some of them hiring each other, is a business. Nobody has built the coordination layer for that.

And underneath all five, the one that matters most:

**Concern 0 — Where does enforcement actually live?** If the answer is "in our software," then a bug in our software is an unlimited loss. That's the flaw we need to design out.

---

# Part 2 — What we checked, and the hard truths we found

We read Circle's and Arc's actual current documentation (not summaries), enumerated their real API specifications, and read Ampersand's shipped source code. Here is what is genuinely true today.

## 2.1 The bad news: the thing you hoped for does not exist

The original idea was: *the human holds one master Circle Agent Wallet, and from it creates per-agent wallets that inherit reduced, scoped permissions signed by the master.*

**This cannot be built as described, and it's important to understand exactly why.**

Circle has two completely separate wallet products, and they live in two different worlds that do not connect:

| | **Agent Wallets** | **Developer-Controlled Wallets** |
|---|---|---|
| Who holds the keys | Split between Circle and *the human* (2-of-2). Our backend holds nothing. | Our backend, via one secret called an "entity secret." |
| Can it have spending limits? | **Yes** | **No — none at all.** |
| Can we change those limits from code? | **No.** Every single change requires a fresh human OTP typed into a terminal. | N/A — there are no limits to change. |
| Can we create many of them from code? | Not really — it's tied to one human login. | **Yes — up to 10 million per wallet set.** |

So the two halves of the original plan can't be joined:
- **Agent Wallets have guardrails, but every guardrail change needs a human.**
- **Developer-Controlled Wallets are fully programmatic, but have no guardrails whatsoever.**

We verified this by enumerating all 29 endpoints in Circle's actual developer-wallet API specification. There is no policy endpoint, no limit endpoint, no allowlist endpoint. Nothing. And Circle's own documentation says spending policies work *"only [on] agent wallets, not local wallets"*, and that *"setting a policy triggers a second email OTP to confirm the change."*

There is also **no delegation primitive anywhere in Circle's stack** — no "parent grants scoped authority to child," no sub-accounts, no session keys we can use. The one thing that sounds close (Gateway's `addDelegate`) grants *blanket* authority with no spending cap, no recipient restriction, and no expiry. It's a funding pipe, not a guardrail.

**Why the OTP will never go away:** it isn't a missing feature Circle forgot to build. The OTP *is* the human's half of the key. Circle's docs are explicit that *"the user retains custody, and Circle cannot unilaterally move funds without their involvement."* Asking Circle for an OTP-free policy API is asking them to remove the human's custody — they won't, and shouldn't.

## 2.2 The good news: Circle tells us this is our job

Circle's own developer-wallet documentation says developers *"enforce their own policies (limits, KYC, fraud checks) before any onchain action."*

Read that carefully. **Circle is explicitly saying: we give you programmable wallets, you build the control layer.** That control layer is exactly what agentOps is. So the finding that refutes the *mechanism* actually validates the *product*.

## 2.3 What Ampersand does, and where its flaw is

Ampersand is the closest competitor. Credit where due — their architecture is real, deployed, and clever. Each agent gets a smart account, and payments need **two** signatures: the agent's, and Ampersand's server's. Neither side can move money alone. That genuinely solves the "agent has a drainable credential" problem, and the user can always export their key and leave.

**But here is the crack, taken from their own shipped code:**

> *"Forwards the 402 to the Ampersend API, **which applies budget/policy** and returns an index to sign (plus optional co-signature)."*

Their spending limits are enforced **inside their own server**. The on-chain contract only checks *that two signatures exist* — it has no idea what the amount was, what the daily total is, or who the money went to.

In plain terms: **if you ask "can you prove this agent respected its $50 daily limit?", their honest answer is "our server says so."** There is no mathematical proof. It's a promise from a company. And their own code types the co-signature as *optional*, which implies setups where their server isn't even in the loop.

Also worth knowing: **fleet-level coordination doesn't exist in their product at all.** Every control is per-agent. No shared budget pool, no organization hierarchy, no cross-agent coordination. They *advertise* "swarm-level controls" but haven't built it. Their audit trail is a marketing claim with no export format. And they're single-chain (Base only), single-asset (USDC only), with no escrow, no dispute mechanism, and no job-completion concept.

---

# Part 3 — The core insight that solves this

Here's the thinking that unlocks everything.

Every approach so far tries to answer: *"how do we make software reliably enforce a spending limit?"* Circle answers "put a human in the loop." Ampersand answers "put our server in the loop." Both are answering the wrong question, because both leave the limit as a **rule that something has to remember to enforce**.

**Flip it. Don't enforce a limit on the money. Make the limit be the money.**

Give each agent its own wallet, and put in it *exactly* what that agent is allowed to spend. Nothing more.

Now look at what happens:

| Question | Answer under this design |
|---|---|
| What stops the agent overspending? | **The money isn't there.** Not a rule — an absence. |
| What if our software has a bug? | Doesn't matter. The agent still can't spend money that doesn't exist. |
| What if our entire backend is compromised by an attacker? | Maximum loss = the sum of what's currently in the agent wallets. Nothing more. |
| How do we revoke instantly? | **Sweep the wallet.** One transaction. No OTP, no policy API, no permission from anyone. |
| How fast can the agent act? | Full machine speed. Nobody co-signs. Nothing to ask. |
| Can an outsider verify the limit? | **Yes — read the balance on-chain.** No trust in us required. |

This is the whole thing. The limit stops being a *claim we make* and becomes a *fact anyone can check*.

**And this is why automatic top-up stops being a convenience feature and becomes the central safety mechanism.** The tighter you fund, the tighter the bound. Top-up is what makes tight funding survivable — without it, tight funding just means agents constantly running dry. Your instinct about auto-topup was right, but it's more important than you thought: it's not a nice-to-have, it's the thing that makes the security model practical.

**The honest cost, stated plainly:** money gets spread across many wallets instead of sitting in one pool, and there's a delay between "agent runs low" and "agent gets refilled." That's a real trade-off, not a free lunch. Managing it well is exactly what the fleet treasury (Part 4.5) is for.

---

# Part 4 — What to build, in sequence

Each item below says what it is, why it matters, and what it replaces.

## 4.1 Per-agent wallets with chain-enforced budgets

**What:** When an operator creates an agent in agentOps, we programmatically create a dedicated Circle developer-controlled wallet for it, and fund it with exactly that agent's allocated budget.

**Why it works:** Confirmed available today — one entity secret can create up to 10 million wallets, each with its own address, entirely from code, with no OTP. This is the one thing Circle's programmatic wallets do extremely well.

**What it replaces:** Today, every agent in an organization shares one wallet, and their individual budgets are just numbers in our Postgres database (`spent_usdc`, `reserved_usdc` columns). If our budget-checking code has a bug, an agent can drain the shared wallet. After this change, an agent physically cannot touch another agent's money.

**What we can then claim, honestly:** "Maximum loss per agent, if everything about our system is compromised, equals that agent's on-chain balance — and you can verify it yourself with a single RPC call." Ampersand cannot say this.

## 4.2 Scoped delegation — what it really is, and how to be honest about it

This is Concern 1, and it needs careful, honest framing.

**What we're building:** When a human grants an agent authority, we record a signed grant — a structured, cryptographically-signed statement saying "agent X may spend up to $50, only to these destinations, expiring Friday." It's signed by the human's key, so it's tamper-evident and auditable forever. Any auditor can verify the human really authorized exactly that.

**Now the honest part.** There are two different things people mean by "enforcement," and conflating them is how competitors end up overclaiming:

| Layer | What enforces it | How strong |
|---|---|---|
| **The amount** | The agent's on-chain wallet balance | **Absolute.** Chain-enforced. Survives total compromise of our system. |
| **The rules** (which destinations, expiry, purpose) | agentOps' policy engine | **Software-enforced.** A compromised agentOps could ignore these. |

So we say plainly: *"The spending ceiling is enforced by the chain and provable. The finer-grained rules — destinations, purpose, expiry — are enforced by our control plane, and the human's grant is cryptographically signed so any violation is provable after the fact."*

That's a stronger and more honest claim than Ampersand's, because our *amount* bound needs no trust at all, whereas theirs needs trust in their server for everything. And it's more usable than Circle's, because none of it requires an OTP.

**Revocation** is where this really pays off. Revoking an agent means: mark the grant revoked in our system, *and* sweep its wallet back to the treasury. That second step is the real one — it needs no OTP, no Circle policy API, no human with an inbox. It's one transaction, and it works at 3am.

## 4.3 Automatic top-up, with a gas subtlety nobody handles

**What:** A treasury loop watches every agent wallet's balance. When one drops below its threshold, it's automatically refilled from the organization's treasury pool, up to that agent's allocated ceiling.

**Important honest note:** Circle has **no built-in auto-topup**. We checked Gateway, the Wallets API, and the webhook system — there is no low-balance trigger and no auto-rebalancing primitive. We build this ourselves. The good news is our codebase already has the right shape for it (a job table plus a worker loop), so this is an extension, not a new subsystem.

**Now the Arc-specific subtlety, and this is a genuinely sharp point.** On Arc, USDC *is* the gas token. Arc's documentation says it directly:

> *"These are not two separate tokens — they share the same underlying balance."*

Think about what that means. An agent that spends its balance down to zero **cannot transact at all** — it has no gas to pay for anything, including receiving instructions or being swept. It's bricked until someone tops it up.

So our top-up logic must treat **gas headroom as a first-class budget dimension**: every allocation reserves a slice that the agent is not allowed to spend, purely so it can always afford to transact. Nobody handles this — it's specific to Arc's fused-balance design, and it's exactly the kind of detail that shows genuine engagement with the chain rather than treating it as a generic EVM.

## 4.4 Agent-to-agent commerce (Concern 2) — and the reputation gap worth exploiting

Today agentOps only does agent-pays-service. Here's how agent-to-agent actually becomes real.

**The payment part works today.** Circle's Nanopayments are live on Arc testnet, go down to $0.000001, and — importantly — we verified that the *only* requirement to receive payment is *"an EVM wallet address where you want to receive USDC payments."* No Circle registration, no API key, no approval process gates being paid. So one agent paying another is genuinely possible right now.

One structural constraint to know: the receiving agent must expose an HTTP endpoint (it's request-response, not a push to a wallet). And Nanopayments only work with simple wallets, not smart-contract accounts.

**The trust part is where the real opportunity is.** Arc has two agent-specific standards deployed on testnet:

- **ERC-8004** gives agents an on-chain identity (as an NFT) plus a reputation registry.
- **ERC-8183** gives a full escrow job lifecycle: a job goes Open → Funded → Submitted → Completed or Rejected, with money held in escrow and released on completion. There's a distinct "evaluator" role separate from buyer and seller.

**Here is the gap we should exploit.** ERC-8004's reputation system has a weakness: the standard only says you can't rate *yourself*. It does **not** require that a rater actually paid you or received anything. So any random address can write feedback about any agent with zero proof of a real transaction. That makes the reputation number nearly meaningless as shipped.

Ampersand implements ERC-8004 only as a *client* — they publish identities and read them. They explicitly do not ship the reputation registry, and they have no escrow or job-completion mechanism at all.

**So: wire ERC-8183's completion hook to write ERC-8004 reputation, and only on genuine completion.** Reputation then becomes something that can only be earned by a real, settled, escrowed payment. That's a property the standard itself lacks, that no competitor has, and that's specific to Arc.

**And then close the loop:** feed that earned reputation back into budget allocation. Agents with a proven delivery record automatically get larger allocations; agents that fail get smaller ones. **That is real autonomy** — the fleet tunes its own capital allocation based on verifiable on-chain outcomes, with no human adjusting numbers. This is the difference between "an AI wrapper" and an actual autonomous financial system.

## 4.5 The fleet layer (Concern 5) — the biggest competitive gap

This is where the product genuinely wins, because it's the thing Ampersand advertises and hasn't built.

A fleet is not N independent agents. It's a treasury with a coordination problem. Concretely:

- **One organization treasury** funds many agent wallets.
- **A solvency invariant** guarantees the sum of all agent allocations never exceeds what the organization actually deposited. (This concept already exists in our codebase — it becomes the fleet's backbone.)
- **Reallocation** moves unused capital from idle agents to busy ones, automatically.
- **Gas headroom** is reserved per agent, per Part 4.3.
- **One agent can hire another** inside the same fleet, with the payment going through escrow and updating both agents' reputation.

The problems you named — agents needing funds for data access, task execution, calling APIs, hiring other agents, DeFi actions — are all fundamentally *allocation* problems once each agent has its own wallet. The fleet layer is the answer to all of them at once.

## 4.6 Real-time compliance screening (Concern 4)

**What:** Before releasing an agent's payment, check the destination address against Circle's Compliance/Transaction Screening API, which returns an approve/deny plus a risk score.

**Honest notes:** This API is entity-level and sales-gated (not self-serve), so availability needs confirming. It screens *counterparty risk* — it does not enforce spending amounts, so it complements our budget system rather than replacing any of it.

**Why it's worth doing:** it turns a payment authorization into something conditional on a *live external risk signal* rather than a static allowlist. That's a genuine "agent reacting to real-world data" story. Note that Ampersand markets compliance heavily (via TRM Labs) but it's dashboard-only — not available to developers through their API. Ours would be in the actual decision path.

## 4.7 Google ADK integration (your point 2)

**What it is:** Google's Agent Development Kit is a framework for building agents, with a growing ecosystem. Integrating means an ADK-built agent can use agentOps as its payment and policy layer without custom plumbing.

**How it fits our architecture:** cleanly, because we already expose everything through MCP. Our MCP service already offers the tools an agent needs (check policy, make a payment, check an approval). ADK support is primarily a matter of exposing that same surface in the shape ADK expects, plus a working example.

**Why it matters strategically:** it's a distribution channel, not an architectural change. Ampersand supports ADK, LangChain, CrewAI and several others, and publishes an agent-readable onboarding file so agents can self-onboard. That's genuinely their strongest distribution advantage, and it's cheap for us to match.

**Honest scoping:** this is valuable but it is *adoption* work, not *architecture* work. If time is short before the deadline, the architecture items (4.1, 4.3, 4.5) demonstrate more to judges than another framework binding does.

---

# Part 5 — Where we sit, versus the two bad options

The one-page summary of the whole argument:

| | **Circle's approach** | **Ampersand's approach** | **Ours** |
|---|---|---|---|
| How is a limit enforced? | Human types an OTP for every change | Their server decides, per payment | **The money isn't there to spend** |
| Can an outsider verify it? | Somewhat (limits are readable) | **No** — server's word only | **Yes — read the on-chain balance** |
| Agent speed | Fast to spend, slow to re-authorize | Fast, but their server is in every payment | **Fast, nobody in the loop** |
| If the control plane is fully compromised? | Circle's limits still hold | **Unbounded within the account** | **Bounded by on-chain balance** |
| Revoke at 3am | Needs a human with email access | Their server refuses to co-sign | **Sweep the wallet — one transaction** |
| Fleet coordination | None | **None** (marketed, not built) | **Core feature** |
| Escrow / job completion | None | **None** (proposal only, unmerged) | **ERC-8183 on Arc** |
| Reputation | None | Reads ERC-8004 only | **Payment-gated, written on real completion** |

Two sentences worth memorizing for the pitch:

1. *"Ampersand's spending limit is a promise from their server. Ours is a fact about a blockchain balance that you can verify without trusting us at all."*
2. *"Circle requires a human with an email inbox to change any spending rule. We require nobody — and we're still more bounded than they are, because our ceiling is the funded balance itself."*

---

# Part 6 — Things we must NOT claim

Being wrong about any of these in front of judges who check the documentation would cost more credibility than the claim would gain.

1. **Do not claim Arc mainnet.** It does not exist. Arc's own documentation states Arc *"is currently available on Testnet only"* — there is no mainnet chain ID, no timeline. Circle's own guidance says *"NEVER target mainnet — Arc is testnet only."*

2. **Do not claim Arc Privacy Sector or post-quantum signatures.** Both are documented as *"on the roadmap and not yet available."*

3. **Do not present ERC-8004/ERC-8183 as finalized standards.** Both are **Draft**. ERC-8183 was created in February 2026 — about five months old, with one testnet implementation. Their interfaces can still change. Also worth noting: their deployed addresses appear only in Arc's tutorials, not in Arc's official contract-address reference page.

4. **Do not use Circle Paymaster on Arc.** It's structurally pointless there — Paymaster exists to let people pay gas in USDC on chains where gas is a *different* token. On Arc, gas already *is* USDC. It also carries a 10% surcharge versus Gas Station's 5%. (Circle's own docs contradict themselves here — Arc is absent from Paymaster's supported-chain table but has live Arc addresses published. Treat that as a documentation bug, not permission.)

5. **Do not claim both Nanopayments and gas sponsorship on the same wallet.** They're mutually exclusive: Nanopayments require simple wallets (Gateway verifies signatures off-chain), while Gas Station requires smart-contract accounts. Choose simple wallets — policy has to run *before* the payment signature anyway.

6. **Do not claim ERC-8004 reputation is trustworthy out of the box.** It isn't — that's precisely the gap we're filling. Describe it accurately: the standard permits unearned feedback, and *our* contribution is gating it on settled escrow completion.

---

# Part 7 — Suggested build order

Ordered by how much each one proves, relative to effort.

| # | What | Why this order |
|---|---|---|
| 1 | **Per-agent wallets, funded to their exact budget** (4.1) | Everything else depends on it. Turns our central safety claim from software into chain-enforced fact. |
| 2 | **Auto top-up with reserved gas headroom** (4.3) | Without it, item 1 means agents constantly run dry. The Arc fused-gas detail is a genuine differentiator. |
| 3 | **Fleet treasury with solvency ceiling** (4.5) | The biggest competitive gap. Turns a demo into a system. Partly exists in the codebase already. |
| 4 | **Instant revocation by wallet sweep** (4.2) | Very small change once 1 is done, and it's a dramatic live demo: revoke an agent mid-flight, in one transaction, with no human approval. |
| 5 | **Agent-to-agent payment via escrow** (4.4) | This is the "agentic economy" story judges are looking for. |
| 6 | **Payment-gated reputation → allocation feedback** (4.4) | The most novel piece. Real autonomy: the fleet re-allocates its own capital based on on-chain outcomes. |
| 7 | **Compliance screening in the decision path** (4.6) | Valuable, but gated on API access we need to confirm. |
| 8 | **Google ADK integration** (4.7) | Distribution, not architecture. Highest value *after* the deadline. |

Items 1–4 form a coherent, demonstrable system on their own. Items 5–6 are what make it specifically an *agentic economy* story rather than a treasury tool. Items 7–8 are genuinely valuable but should not displace 1–6 if time is short.

---

# Part 8 — The one-paragraph version, for a pitch

> agentOps gives every AI agent its own wallet on Arc, funded with exactly what it's allowed to spend — so an agent's spending limit isn't a rule our software enforces, it's a fact about a blockchain balance that anyone can verify without trusting us. That means no human OTP in the loop (Circle's approach), and no company server deciding each payment (Ampersand's approach). Agents run at full machine speed, revocation is a single sweep transaction that works at 3am, and the maximum possible loss from a total compromise of our own system is the on-chain balance — provably. On top of that we coordinate fleets: one treasury allocating across many agents, automatically topping them up, reserving gas headroom for Arc's fused USDC-gas balance, letting agents hire each other through on-chain escrow, and re-allocating capital automatically based on reputation that can only be earned by completing a real, settled job.

---

## Open items that need a decision or a check

- **Confirm Compliance/Transaction Screening API access** — it's sales-gated, so 4.6 depends on getting approved.
- **Decide how much of 4.4 (escrow + reputation) is in scope for the deadline** versus shown as a working prototype.
- **The signed-grant format for 4.2** needs designing (what fields the human signs over).
- **Sweep authority** — confirm the treasury can sweep an agent wallet using the same entity secret that created it (expected to work, but should be verified in code before relying on it for the revocation demo).
