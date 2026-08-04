---
created: 2026-08-02
project: agentOps
tags: [handover, plain-english]
status: handover note
---

# agentOps — What I Want to Change, and Why

A handover note. Plain language, no jargon. Read top to bottom; it takes about ten minutes.

Full detail lives in `change-manifest.md`. This is the version you can read over coffee.

---

# 1. The one idea behind everything

Right now, when an agent tries to spend money, our software checks a number in our database and decides yes or no. That works — until our code has a bug. Then there's nothing stopping the agent.

**The change: stop guarding the money with software. Make the money itself the limit.**

Give every agent its own wallet, and put in it *exactly* what that agent is allowed to spend. Nothing more.

Why this is better:

- **An agent can't overspend, because the money isn't there.** Not a rule that code has to remember — an absence.
- **If our whole backend gets hacked**, the worst case is the money currently sitting in agent wallets. That's it.
- **Anyone can verify our safety claim** by reading a balance on the blockchain. They don't have to trust us at all.
- **To shut an agent down, we empty its wallet.** One transaction. No emails, no approvals, no waiting.

Everything below is either building this, or fixing something that would undermine it.

---

# 2. Why we're not copying Circle

There are two obvious ways to control agent money. Both are flawed, in opposite directions.

**Circle's way — a human in the loop.** Circle has a wallet product with built-in spending limits. But changing any limit requires a human to type a code from their email, every single time. Safe, but an agent can never adjust anything on its own, and at 3am nobody's there. This isn't a bug we can wait out — that emailed code *is* the human's half of the key. Circle won't remove it, and shouldn't.


**Our way** The limit is the wallet balance. No human needed, no server's word needed. It's a fact you can check yourself.

---

# 3. The awkward discovery (and why it's actually good news)

My original plan was: the human holds one master Circle wallet, and creates per-agent wallets that inherit reduced permissions signed by that master.

**I researched it properly and that can't be built.** Circle has two separate wallet products that don't connect:

- **Agent Wallets** — have spending limits, but every limit change needs that emailed code.
- **Developer-Controlled Wallets** — fully programmable from code, but have **no spending limits at all**.

We checked every endpoint in Circle's actual API. There is no limit setting, no allowlist, no delegation feature. And nothing in Circle's stack lets a "parent" wallet grant scoped authority to a "child."

**But here's the good part.** Circle's own documentation says developers *"enforce their own policies (limits, KYC, fraud checks) before any onchain action."* They're explicitly saying: *we give you the wallets, you build the control layer.*

That control layer is exactly what agentOps is. So the research killed my mechanism but confirmed the product.

---

# 4. What we found instead — and it's better

There's a contract called **Permit2** (from Uniswap, widely used, battle-tested) already deployed on Arc. I verified it's live. It does almost exactly what I originally wanted:

- You sign **one** approval with a **spending ceiling** and an **expiry date**
- The agent can then spend against it **repeatedly**, in small amounts, at full speed
- The ceiling **counts down** as it spends — it can't go over
- **The money never leaves the payer's wallet** until it's actually pulled
- Cancel any time with one on-chain call — no waiting period, no third party

So: a human signs a scoped, expiring, revocable spending allowance once. The agent uses it autonomously. We can kill it instantly.

**And it stacks with idea #1 perfectly.** Because the funds stay in the agent's own wallet, the balance *still* acts as the hard ceiling. Permit2 just adds a second, finer layer of scope on top — without moving money anywhere or parking capital in someone else's contract.

**Honest tradeoff:** since the money stays with the payer, the *receiver* takes a small risk that the payer spends it elsewhere first. Inside our own fleet — where we control the payer anyway — that's the right place for that risk.

---

# 5. Two ways money moves

| | Used for | How |
|---|---|---|
| **Lane 1** | Agents buying from **outside services** (paid APIs) | Circle's standard x402 `exact` payment. Handles amounts down to a millionth of a dollar. |
| **Lane 2** | Agents paying **each other** | Permit2 ceiling + drawdown. This is our differentiator. |

**Two terms that get confusing, since the docs use them loosely:**

- **"Exact"** = pay directly, one payment = one on-chain transaction, money moves immediately, you pay gas each time. Like a bank transfer.
- **"Gateway"** = deposit once, then each payment is just a signature — no gas, no on-chain transaction. Circle deducts from your balance instantly and settles on-chain later in batches. Like a prepaid card or a bar tab.
- **"Nanopayments"** is just Circle's name for **Gateway used to pay x402 services**. Same machinery, different label. It's what makes $0.000001 payments possible — no per-payment gas means tiny amounts stay economic.

One consequence worth knowing: between "Circle says paid" and "it hits the chain," a Gateway payment is real to everyone but not yet on-chain. So for those payments the authoritative record is **Circle's API, not a block explorer** — you can't point at an individual transaction for a single nanopayment, it's inside a batch.

---

# 5b. Cross-chain — an Arc agent paying a Base agent

This is the case that nearly broke the design, so it's worth its own section.

**The scenario:** our Orchestrator lives on Arc with $10 USDC. It wants to hire a senior reviewer agent whose payment endpoint demands **Base** USDC. Its Base balance is zero.

**The trap:** the natural assumption is that Circle Gateway's "unified USDC balance" makes chains irrelevant. **It does not.** Circle's own guidance says it flatly:

> *"Gateway does NOT do cross-chain transfers at payment time. Source chain matters."*

So $10 on Arc plus $0 on Base means **$0 spendable on Base**. Gateway's unified balance is a fast cross-chain *transfer* product, not a payment-time *abstraction* product. Also worth knowing: wallets created with a shared reference ID get the **same address** on every EVM chain — but the same address does **not** mean a shared balance. Balances are per-chain, always.

**But it is solvable, and fully autonomously.** Two practical options:

| Option | How | Payment-time speed | Trade-off |
|---|---|---|---|
| **A — fund per chain** | Give the agent a wallet on each chain it needs. Same address, split the allocation. | **Instant** — money's already there | Some capital sits idle on the unused chain |
| **B — bridge on demand** | Keep the float on Arc. When a foreign chain is needed: sign a burn intent on Arc → get an attestation → mint on Base. | **Under a second** to mint | A transfer fee, plus a one-time setup deposit |

Circle publishes a working code sample for Option B titled *"burns from Arc Testnet and mints on Base Sepolia"* — **literally our scenario**. Three API calls, no human, no private keys. Circle's MPC signs the burn intent, so we never touch key material.

**My recommendation: A + B.** Keep each agent's working float on its home chain, hold a shared reserve for bridging, and only bridge when a seller demands a chain the agent isn't funded on. Common case is free; rare case pays a fee instead of pre-splitting capital across five chains.

**For the demo: use Option A.** Pre-fund the Orchestrator on both chains. Zero bridging risk, and the cross-chain capability is still genuinely demonstrated. Show Option B's bridge as the scale story.

---

# 6. The Arc detail nobody handles

On Arc, **USDC is the gas token**. Arc's docs say it plainly: *"These are not two separate tokens — they share the same underlying balance."*

Think about what that means: **an agent that spends its balance to zero is bricked.** It can't transact at all — can't receive instructions, can't even be emptied by us. It's stuck until someone tops it up.

**So every agent's budget must reserve a slice for gas that it isn't allowed to spend.** Spendable = balance minus gas reserve.

This is small to build and genuinely nobody handles it. It's also the kind of detail that shows we actually engaged with Arc instead of treating it as a generic blockchain.

---

# 7. Automatic top-up (which turns out to be essential, not optional)

Tight funding is what makes the safety bound tight. But tight funding also means agents constantly run dry. So auto-topup isn't a convenience — **it's what makes the whole security model practical.**

How it works: a background loop watches every agent's balance. When one drops below its threshold, it's automatically refilled from the org's treasury, up to its ceiling.

Circle has **no built-in feature for this** — no low-balance alert, no auto-rebalancing. We build it. Good news: our codebase already has a job table and a worker loop that polls it, so this is an extension of existing machinery, not a new subsystem.

---

# 8. The fleet layer — our biggest competitive gap

One agent is a demo. Ten agents sharing a budget, some hiring each other, is a product.

Ampersand's controls are **entirely per-agent**. No shared pool, no org hierarchy, no cross-agent coordination. They advertise "swarm-level controls" and haven't built it.

What we build:
- One org treasury funding many agent wallets
- A **solvency rule**: the sum of all agent allocations can never exceed what the org actually deposited
- Idle agents' unused capital reallocated to busy ones
- Gas headroom reserved per agent
- Allocation tracked **per agent per chain**, not just per agent (see section 5b — a balance on one chain isn't spendable on another)

We already have a version of this solvency concept in the codebase, so we're starting ahead.

### Two fair objections to per-agent wallets, and the answers

**"Doesn't this mean managing a spending key for every agent?"** No — not with developer-controlled wallets. One secret creates up to 10 million wallets and Circle's infrastructure does all the signing. We hold **one** secret whether there's 1 agent or 1,000. No per-agent credential, no OTP.

This objection *is* valid for the Agent Wallet model we run today, where every wallet is tied to a human's email login. Per-agent wallets there would mean per-agent human logins — unworkable. That's an argument for switching, not for giving up per-agent wallets.

**"Won't wallets multiply badly across chains and payment methods?"** It's a real cost — 5 agents × 5 chains would be 25 wallets to fund and monitor. Three things keep it manageable: we scope to the chains actually needed (Arc, plus one more to prove cross-chain — not five); Option B in section 5b replaces breadth with a single shared reserve; and wallet creation is programmatic and cheap, so the real cost is *idle capital*, not operational work — which is exactly what the treasury and auto-topup exist to manage.

### Why not just keep one org-level wallet and check budgets in the database?

That's what we have today, and it's the weakest position available. With one shared wallet and database-only enforcement, **the maximum loss is the entire treasury** — there's no containment between agents. One bug in the budget check and any agent can drain everything. And the safety claim is unprovable: "did this agent stay within budget?" can only be answered *"our database says so."* That's exactly the competitor weakness we're trying to beat.

The fix isn't to throw away the policy database — it's to **split the two jobs**:

| Layer | Enforces | Lives where |
|---|---|---|
| **The amount ceiling** | How much an agent could possibly spend | **The blockchain** — its funded balance. Holds even if our whole system is compromised. |
| **The detailed rules** | Which destinations, purpose, expiry, approvals needed | **The policy database** — unchanged, still needed |

Org-level wallets stay useful — as the **treasury and cross-chain reserve** that funds agent wallets — rather than as the wallet agents spend from directly.

---

# 9. Agents hiring each other

Today our agents can only pay *services*. To let them pay each other:

**The payment part already works.** Circle's Nanopayments only require *"an EVM wallet address where you want to receive USDC payments"* — no registration, no API key, no approval. One agent paying another is possible right now.

Two constraints to know: the receiving agent must run an **HTTP endpoint** (payments are request/response, not a push to a wallet), and agent wallets must be **simple wallets, not smart-contract wallets**.

**The trust part is where it gets interesting.** Arc has two agent standards deployed:

- **ERC-8004** — agent identity plus a reputation score
- **ERC-8183** — escrow: money is locked before work starts, released when the work is accepted

**The gap worth exploiting:** ERC-8004's reputation system only forbids rating *yourself*. It does **not** require the rater to have actually paid you. So anyone can write feedback with zero proof of a real transaction — which makes the score close to meaningless.

**Our fix:** only write reputation when an escrowed job genuinely completes. Then reputation can *only* be earned by finishing real, paid work. Ampersand reads ERC-8004 but doesn't implement reputation at all.

**Then close the loop:** feed that earned reputation back into how much budget each agent gets. Reliable agents automatically get more; failing agents get less, with no human adjusting numbers. That's genuine autonomy, not an AI wrapper.

---

# 10. When to use Permit2 vs escrow

These aren't competitors — they protect *different people*:

- **Permit2 protects the payer.** Money stays in their wallet; they can cancel instantly.
- **Escrow protects the worker.** Money is locked up front and the client can't yank it back, so the worker can start knowing the money is real.

And the one thing Permit2 fundamentally can't do: it only understands two parties, payer and payee. It has no way to say *"a third person decides whether the worker gets paid."* That's the whole reason escrow standards exist.

**The rule:**

| Situation | Use | Why |
|---|---|---|
| Both agents are **ours**, client can judge the work | **Permit2** | We already control both sides. Escrow would add ~5 blockchain transactions for zero extra trust. |
| Worker is **external**, but client can judge the work | **Escrow, client as the judge** | Value here is *proof the money exists* before work starts — not neutral arbitration. |
| Neither side trusts the other's **judgement** | **Escrow with an independent judge** | The only case where escrow's real purpose is used. |

**One thing to be careful about:** when the client is also the judge (the common case, and explicitly allowed), escrow really just becomes "a client-controlled hold with a refund timer." The worker protection mostly disappears, since the client decides release. It's still useful — it proves funds exist — but **we must never describe that as neutral arbitration.**

For reference: Arc's own example job runs exactly this mode (client and judge are the same address), so their tutorial doesn't actually demonstrate the trust-minimized case.

---

# 10b. The demo — what we actually show

A 5-agent fleet producing a paid market-research report. Four agents live on Arc; one deliberately lives on Base, to prove the cross-chain case.

| Agent | Chain | Sells | Pays for |
|---|---|---|---|
| **Orchestrator** | Arc | Takes the client's job, assembles the report | Hiring the other four |
| **DataFetcher** | Arc | Raw data retrieval | External paid APIs |
| **Analyst** | Arc | Analysis of the data | Extra data from DataFetcher |
| **Writer** | Arc | The written report | — |
| **SeniorReviewer** | **Base** | Expert review of the finished report | — |

**Why this shape:** it produces three genuinely different payment cases in one run — a hub paying spokes, an agent paying *another agent* mid-task (Analyst → DataFetcher, so it's a real economy not just a fan-out), and a cross-chain payment (Arc → Base).

### Setup — done once, by a human

1. Operator signs in and creates the org
2. Funds the org treasury with testnet USDC
3. Creates the 5 agents — **each automatically gets its own wallet**; the Orchestrator gets one on Arc *and* one on Base
4. Sets each agent's allocation (e.g. Orchestrator $15 Arc + $5 Base, others $5) — the **solvency check rejects it** if the total exceeds what the treasury actually holds
5. Each allocation reserves a slice of gas that the agent can't spend
6. Operator signs **one** Permit2 ceiling per paying relationship — the scoped, expiring, revocable allowance
7. Each agent gets its access credential

**At this point:** five distinct wallet addresses, each holding exactly its allocation, visible on the public block explorer. **This is the moment the safety claim becomes checkable by anyone.**

### The run — no human involved

1. A client submits a research request to the Orchestrator
2. Orchestrator hires DataFetcher — draws against its Permit2 ceiling; the allowance counts down on-chain
3. DataFetcher buys external data with a real x402 payment from its **own** wallet
4. DataFetcher runs low → auto-topup refills it from the treasury, within its ceiling and the solvency rule
5. Orchestrator hires the Analyst — second drawdown
6. **Analyst pays DataFetcher directly** for extra data — agent-to-agent, its own independent ceiling
7. Orchestrator hires the Writer; report assembled
8. **Orchestrator pays the SeniorReviewer on Base** — settles on Base while the rest of the fleet runs on Arc
9. *(Stretch)* If the Base balance were empty, the agent **bridges just-in-time** instead — burn intent on Arc, mint on Base in under a second, still no human

### The four things to make judges look at

1. **The ceiling is physics, not policy.** Tell an agent to overspend. It fails. Then show the wallet balance on the explorer: *"That's not our software refusing — the money isn't there. Check it yourself."*

2. **Revocation in one move, at machine speed.** Mid-run, revoke an agent: its Permit2 allowance is killed **and** its wallet is emptied back to treasury. Both visible on-chain. *"No email, no code to type, no approval queue. Works at 3am."*

3. **The ceiling drawn down live.** Show the allowance decrementing across successive payments, then reclaim the unspent remainder — and note the funds never left the payer's wallet, so there's no waiting period and nothing parked in anyone else's contract.

4. **Cross-chain, autonomously.** Arc agent pays Base agent. *"Chains aren't interchangeable at payment time, whatever 'unified balance' suggests. We fund per chain, and bridge on demand when we have to — under a second, no human."*

Optional fifth, if there's time: let an agent spend to near-zero and show the gas reserve keeping it alive — *"on Arc, USDC is gas, so an agent that spends to zero can't even be rescued. We budget for that. Nobody else does."*

### If we run out of time

Drop features in this order, and **always say which version is running**:

| Drop | Still demonstrates |
|---|---|
| Reputation → budget feedback | Escrow + earned reputation |
| Escrow entirely (Permit2 only for agent-to-agent) | **Scoped on-chain delegation + agent-to-agent + fleet treasury** — and needs no draft standards |
| The cross-chain agent | Everything else, Arc-only |
| Agent-to-agent (external services only) | Per-agent wallets, chain-enforced budgets, auto-topup, gas headroom, instant revocation |

**The floor is still a strong story:** provable maximum loss plus instant revocation. That alone beats both of the alternatives in section 2.

### Three things the demo needs that aren't obvious

- **Every earning agent has to run its own paid HTTP endpoint.** These payments are request-and-response — you can't push money to an idle agent and have it "receive a job." That's real work, not configuration.
- **The agents themselves don't exist yet.** We have the payment and policy layer; we don't have four processes that make decisions. This is the biggest hidden cost, and it's the part judges actually watch.
- **It needs to be re-runnable.** Judges may run it twice. Needs a clean-slate path with fresh wallets that doesn't collide with the previous run.

---

# 11. Bugs we should fix regardless

These are confirmed in our code, not theoretical. I'd do the first two **before** any of the new work above.

**1. Policy lets things through when no rule matches.** If an org hasn't written a rule for some action, that action is silently **allowed**. It should be denied. This is the worst thing in the audit and it's a small fix.

**2. There's no emergency stop.** No way to halt an agent or an org. Only narrow per-tool rate-limit toggles.

**3. Audit trail verification only checks the beginning.** We hash-chain audit events, which is good. But the verify function only checks the first 500 events, starting from the very beginning. So for any org with real history, "chain verified" means "the oldest part verified." Someone could delete recent events and we wouldn't catch it. Needs full-history checking plus a check from the newest end backward.

**4. Anyone can approve their own request.** Nothing stops the person who triggered an action from approving it, and there's no two-person requirement for large amounts.

**5. Money is tracked with editable running totals**, not an append-only record. So we can't reconstruct how a balance got where it is. Proper fix is a full ledger; the quick version is append-only entries with balances calculated by adding them up.

**6. Payment destinations aren't checked before signing.** In x402, the *server being paid* tells us where to send money. If a service is spoofed or compromised, it returns its own address and we sign it — and after signing it's irreversible. We must check the destination against an approved list *before* signing.

---

# 12. Things we must not claim

Getting any of these wrong in front of judges who check the docs costs more than the claim gains.

1. **Arc mainnet doesn't exist.** Arc's docs: *"Arc is currently available on Testnet only."* Always say testnet.
2. **Arc's privacy features and post-quantum signatures are not live** — both documented as "on the roadmap."
3. **ERC-8004 and ERC-8183 are both Draft standards.** ERC-8183 is ~5 months old with one implementation. Interfaces can still change, and there's no sign either has been audited.
4. **ERC-8183 is not Circle's standard** — it's from the Ethereum Foundation plus Virtuals Protocol. Arc just hosts it.
5. **Don't use Circle's Paymaster on Arc.** It exists to let you pay gas in USDC on chains where gas is a different token. On Arc gas already *is* USDC, so it does nothing — and it charges 10%. (Circle's own docs are contradictory here, which is why it's worth knowing.)
6. **Don't claim ERC-8004 reputation is trustworthy out of the box.** It isn't — that's the gap we're filling.
7. **Keep two claims separate.** The *amount* limit is enforced by the blockchain and provable. The *finer rules* (which destinations, purpose) are enforced by our software. Blurring those is exactly the overclaim that makes Ampersand's story weak — if we blur it too, we lose our actual advantage.

8. **Never say a Gateway balance is spendable on any chain.** Circle's own docs say source chain matters. We say we *handle* the constraint (fund per chain, or bridge on demand) — not that it doesn't exist.

9. **Don't claim gas sponsorship and Nanopayments together.** They need opposite wallet types — sponsorship needs smart-contract wallets, Nanopayments needs regular ones. Pick regular (see section 14).

---

# 13. What I'd build, in order

| Order | What | Why here |
|---|---|---|
| **0** | Pin wallets to the regular (non-smart-contract) type; settle Arc's chain ID | Near-zero effort, and both fail confusingly later if skipped. See section 14. |
| **1** | Fix fail-open policy + add kill switch | Cheapest, most serious. Do first regardless. |
| **2** | Per-agent wallets, funded to exact budget | Everything depends on it. Makes the safety claim provable. |
| **3** | Auto-topup + gas headroom | Without it, #2 means agents constantly run dry. |
| **4** | Fleet treasury + solvency rule | Biggest competitive gap. Partly exists already. |
| **5** | Revoke-by-emptying-wallet | Tiny once #2 is done. Best thing to demo live. |
| **6** | Permit2 scoped delegation | The original goal, now with real on-chain teeth. |
| **7** | Cross-chain via per-chain funding (Option A) | Cheap — just a schema change plus a second wallet. Unlocks the cross-chain demo. |
| **8** | Audit/approval/destination fixes | Makes it credible to anyone security-minded. |
| **9** | Agents paying each other | The "agentic economy" story. |
| **10** | Earned reputation → budget allocation | Most novel piece. Real autonomy. |
| **11** | Bridge-on-demand (Option B) | The scale story. Also replaces a stubbed function — see section 14. |
| **12** | Ledger, Google ADK, compliance screening | Valuable, but shouldn't displace 1–11. |

Items 1–7 stand alone as a coherent system. 9–10 make it specifically an *agentic economy* rather than a treasury tool.

---

# 14. Things I still need to check

Genuine unknowns. Each could change the plan.

1. **Can we empty an agent wallet** using the same credential that created it? The whole instant-revocation story depends on this. Expected to work, unverified.
2. **Does Permit2 work with Arc's USDC?** Arc's USDC is the native gas token exposed through a token interface that **rounds down**. Needs testing — this one gates agents paying each other, so **test it first**.
3. **Do Circle's programmable wallets work on Arc end-to-end?** Docs say yes; our code has never tried.
4. **How do we get testnet USDC on Arc**, and does our existing faucet function work there?
5. **Circle's compliance screening API is sales-gated** — we may not get access.
6. **Circle's payment authorizations on Arc are valid for 7 days**, which is a long exposure window. Decide if that's acceptable for larger amounts.
7. **Wallet type must be the regular (EOA) kind, not smart-contract — this one is mostly already fine, but the database disagrees with the code.**

   The rule: Gateway rejects signatures from smart-contract wallets (*"only EOA signatures are accepted"*), and Nanopayments only works with regular ones. So a smart-contract wallet would break **both** cross-chain bridging and the sub-cent payment rail.

   **Good news:** the developer-controlled wallet code already hardcodes `EOA` at creation — it's not configurable, so every wallet it makes is the right type. The Agent Wallets we run *today* are genuinely smart-contract accounts.

   > ⚠️ **Corrected 2026-08-05.** This paragraph previously concluded that being smart-contract accounts meant Agent Wallets "couldn't do Gateway cross-chain even if we wanted to." **That conclusion was wrong.** Circle documents Agent Nanopayments (built on Gateway Nanopayments) for agent wallets, and they bridge cross-chain via CCTP (`circle bridge transfer` — which our own `bridgeWalletTopUp` already calls). The account type is right; the inference drawn from it was not. See `docs/decision-wallet-model.md` for the reasoning that actually decides the wallet model.

   **What's still stale:** an old migration set the database default to smart-contract across the wallet tables and rewrote existing rows to match — correct at the time, since it was describing Agent Wallets. For the new per-agent wallet table we need the default set to regular, and ideally constrained to regular only, so the database rejects a wrong value instead of letting it surface as a confusing payment failure later.
8. **Arc's chain ID doesn't agree across sources** — Arc's own docs say one number, Circle's live payment service reports another. Confirm which before hardcoding; a wrong value fails silently or signs against the wrong domain.
9. **The bridge function is stubbed in the programmable-wallet path.** The current Agent-Wallet code can bridge between chains; the developer-controlled code returns "not supported." So switching wallet models **removes the only working cross-chain path we have today**. Either build Option B (section 5b) or knowingly accept the gap.

---

# 15. The short version

> Every agent gets its own wallet holding exactly what it may spend. So the spending limit isn't a rule our software enforces — it's a blockchain balance anyone can verify without trusting us. No human typing codes from their email (Circle's approach), no company server approving each payment . Agents run at full speed, shutting one down means emptying its wallet in one transaction, and the worst case if we're completely hacked is provably just what's in those wallets. On top: one treasury funding many agents across chains, auto-refilling them, reserving gas so Arc's shared USDC-gas balance can't brick them, letting them hire each other — including an agent on Arc paying an agent on Base, with no human in the loop — and adjusting each agent's budget based on reputation that can only be earned by finishing real paid work.
