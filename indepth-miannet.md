---
created: 2026-07-29
project: agentOps
ecosystem: [circle, full-stack]
tags: [explainer, assumption-audit, circle-stack, architecture-review]
status: non-normative companion
manifest_member: false
---

# agentOps in Plain Language — and a Deep Circle-Stack Review

**What this document is.** A plain-English explanation of the architecture your friend designed, followed by an interrogation of every load-bearing claim in it that has no proof behind it, followed by a deep read of what Circle's stack actually provides today and how agentOps should be rebuilt on top of it.

**What this document is not.** It is not a corpus member. It does not override `corpus-manifest.yaml`, it owns no definitions, and it grants no status. Where it disagrees with the corpus, the corpus is still the normative authority until an ADR changes it. Nothing here is a production claim.

**Method.** Three passes, in this order:

1. **Systems pass** — explain the design as structure and interaction rather than as a list of documents.
2. **Map-vs-territory pass** — the corpus is a *map*. Circle's live documentation is the *territory*. Where they disagree, territory wins, and I say so.
3. **First-principles pass** — strip the constraints that are convention rather than physics, then rebuild.

**Claim labels used here.** I use the corpus's own classes plus three interrogation markers:

| Label | Meaning |
|---|---|
| `RESEARCH-P` | Verified against a primary Circle/Arc/x402 doc, retrieved 2026-07-29 |
| `RESEARCH-S` | Secondary source (blog, news, third-party) — needs primary confirmation |
| `[ASSUMED]` | The corpus asserts this and nothing in the corpus proves it |
| `[GAP]` | A connection or behavior nobody in the corpus has specified at all |
| `[ONE-WAY]` | Something the corpus treats as bidirectional or controllable that is actually one-way or read-only |

---

# Part 0 — The one-paragraph version

agentOps is a **control plane**. It sits between a company's AI agents and everything those agents can touch — APIs, tools, payment rails, wallets. Every time an agent wants to do something consequential, agentOps answers nine questions before the action happens (who is asking, on whose authority, under what mission, what did policy decide, did a human approve, is the money set aside, which rail will execute it, what actually happened out there, and how does it get booked and proven). The product's bet is that the *rails* are commoditizing fast — Circle, x402, Stripe, Visa, Mastercard are all shipping agent payment primitives — but the *organizational control and proof layer above the rails* is not, and that is where a durable product lives.

Everything else in the 35-document corpus is machinery in service of that one idea, plus an unusually strict discipline about never claiming something is safe without evidence.

---

# Part 1 — The architecture in plain language

## 1.1 The single most important idea: five separate truths

Most people building this treat "the agent paid for the thing" as one event. The corpus's central insight — and it is a genuinely good one — is that it is **five different truths that can each be in a different state at the same time**:

| Truth | Question it answers | Can be true while others are false |
|---|---|---|
| **Authority** | Was this agent allowed to do this? | Yes — allowed but never executed |
| **Money** | Has value actually moved? | Yes — paid but not delivered |
| **Delivery** | Did the provider actually give you the thing? | Yes — delivered but not paid (or not accepted) |
| **Accounting** | Is it booked correctly in the books? | Yes — money moved but books not posted |
| **Proof** | Can an outsider reconstruct the whole chain? | Yes — everything worked but is unprovable |

Almost every catastrophic failure in agent payments is one of these five silently substituting for another. "The API returned 200, so we're done" conflates delivery with settlement. "The payment succeeded, so the task is complete" conflates money with delivery. "We logged it, so we can prove it" conflates logging with proof.

The corpus's structure — separate domains for authority, execution, treasury, provider commerce, and evidence, plus *cross-domain journey* documents — is a direct consequence of this. Failures happen at the seams, so the seams get their own specifications. That is the right shape.

## 1.2 The governing flow, walked end to end

The corpus states the flow as:

```
principal → workload → mandate → policy → approval/grant
→ reservation → execution attempt → external outcome
→ ledger posting → reconciliation → evidence
```

Here is what that actually means, in order, with a concrete story: *an agent needs to buy a $0.02 API call.*

**1. Principal.** A human at the company is the accountable person. `HumanPrincipal` is that person. Nothing in the system is authorized by "the system" — there is always a human at the root of the chain.

**2. Workload.** The agent is a `WorkloadPrincipal` — a non-human identity that acts *for* a sponsor, not as itself. This matters because when the human leaves the company, you need to know which agents just became orphans. The corpus is explicit that a human login, an agent API key, and a wallet address are three different things that must never collapse into one generic "user."

**3. Mandate (Mission).** A `Mission` is the agent's job description with teeth: purpose, sponsor, which outcomes are permitted, which providers, how much money, when it expires, and what "done" means. Without this, an agent has capability but no *scope*. Missions are currently **absent from the code** — the corpus's own gap register says so.

**4. Policy.** A `PolicyVersion` is an immutable set of rules. Given the exact request, it produces a `Decision` that is deterministic and pinned to the policy version that made it. Immutability is the point: six months later you can prove *which rules* allowed the thing, not just that "the policy" allowed it.

**5. Approval and grant.** If policy says a human must sign off, an `ApprovalRequest` goes to a person. But — and this is a sharp distinction — **approval is not execution**. What actually authorizes the action is an `ExecutionGrant`: a short-lived, single-use token bound to the *exact* action hash, mission, policy epoch, amount, destination, adapter, and expiry. If any of those change, the grant is worthless. This is what stops "approve a $5 payment, then swap the destination."

**6. Reservation.** Before money can move, treasury must *hold* the budget. A `Reservation` is not a counter decrement — it is a held claim that prevents two sibling agents from spending the same remaining dollar concurrently. Budget consumed = settled spend **plus** outstanding holds.

**7. Execution attempt.** A `PaymentAttempt` (financial) or `RuntimeAttempt` (non-financial) is a durable record created **before** anything leaves the building. Then the attempt enters `dispatching` — a state that exists purely so that if the process dies mid-request, recovery knows a request may have escaped.

**8. External outcome.** Whatever the provider, chain, or tool says is authoritative. Not what agentOps hoped happened.

**9. Ledger posting.** Double-entry, append-only. Every economic event is a balanced `JournalEntry`. Corrections happen by *adding* postings, never by editing old ones.

**10. Reconciliation.** Compare internal truth to external truth. Differences open a `ReconciliationCase` and can halt the adapter.

**11. Evidence.** An `EvidenceBundle` that an outside auditor can use to reconstruct all of the above.

## 1.3 The `unknown` state — the best idea in the corpus

This deserves its own section because it is the design's strongest single decision.

When you send a payment request and the connection times out, you do not know whether the payment happened. Most systems mark it `FAILED` and retry. That is how you pay twice.

The corpus makes `unknown` a **first-class, non-terminal state** with hard rules:

- A post-submit timeout becomes `unknown`, never `failed`.
- An `unknown` attempt is **never** blindly retried and **never** gets a new idempotency key.
- Its reservation **cannot be released** — the money stays held or gets `quarantined`.
- Only *authoritative external evidence that no economic effect can occur* permits release.
- A local worker timing out is explicitly **not** grounds for release.

And it goes one step further with `authorization_ready`: if you have produced a signature, token, or mandate that someone else could still submit, **you are financially exposed even though you have submitted nothing**. That state is real and the corpus names it. Most designs miss this entirely.

There is also an operator-experience consequence the corpus draws correctly: operators need a console that shows known facts, missing facts, exposure, last lookup, next action, and *why* the unsafe buttons are disabled. Hiding uncertainty behind a generic "failed" badge is treated as not production-ready.

## 1.4 The release model — three keys, one lock

The corpus refuses to have a single "we're in production" switch. Production requires a signed `ReleaseCertificate` binding three independently-earned results:

```
CoreGateResult              (the platform logic is sound)
+ ExecutionProfileGateResult (this exact rail/provider/network/signer works)
+ MarketEligibilityResult    (this entity, in this jurisdiction, for this tenant, for this use case)
→ ReleaseCertificate
```

Certified scope is a **tuple**, not a state:

```
CORE/<release> × EXECUTION_PROFILE/<...> × MARKET/<entity>/<jurisdiction>/<tenant>/<use-case>
```

Three consequences the corpus states bluntly and correctly:

- Passing core tests certifies **nothing** about an adapter, a network, a jurisdiction, or a tenant.
- **Testnet proof never implies mainnet proof.**
- A certificate is *revocable* — change the signer, the provider API, the webhook schema, the chain ID, the asset address, or the restore process, and the certificate dies until evidence is regenerated.

## 1.5 The honesty mechanisms

Three things in this corpus are unusual and worth calling out as genuinely well-built:

**Claim classes.** Every material statement must declare whether it is `CURRENT-SOURCE` (proven at a pinned commit), `CURRENT-EVIDENCE` (proven by a reproducible run), `TARGET` (approved but unbuilt), `RESEARCH` (external fact with a retrieval date), or `DECISION-REQUIRED`. Prose cannot be mistaken for proof.

**The counterevidence register.** `reference/research-synthesis.md` contains an explicit table of *attractive claims that are wrong*, each with the evidence that kills it — including "agentOps is differentiated because it gives agents wallets and spend limits," which is a claim about their own product. Writing down the arguments against your own positioning is rare and correct.

**The validation gate.** `reference/architecture-validation-gate.md` says, in plain text:

```
ARCHITECTURE DESIGN: REVIEWED
EMPIRICAL VALIDATION: BLOCKED
IMPLEMENTATION PLAN AUTHORITY: NOT GRANTED
```

A design document that refuses to authorize its own implementation until three named spikes pass is a good design document.

## 1.6 Where the code actually is

Per the gap register at `main` = `ef4e42e` and the paid-HTTP candidate at `a0556e6`:

| Domain | Reality |
|---|---|
| Orgs / human IAM | Partial — no invitations, MFA, SSO/SCIM, or separation of duties |
| Agent identity | Partial — hierarchy is a **pointer**, not delegated authority |
| Missions | **Absent** |
| Policy | Built but **defaults to `allow`** on no-match |
| Approvals/grants | Partial — any operator can approve; no durable grant, no kill switch |
| Runtime enforcement | Partial — **advisory and bypassable** |
| Provider commerce | Absent |
| Treasury/ledger | Counters, **not** double-entry |
| Signing | Static env secret; no KMS/rotation |
| Evidence | Hash chain with **prefix-only verification** — tail deletion evades it |

The five P0 blockers: external requests fire **before** policy evaluation; policy fails **open**; `unknown` resolution has no worker or operator flow; accounting is counters; and the evidence chain can be truncated without detection.

The distance between the design and the code is very large. The corpus says so itself, which is to its credit.

---

# Part 2 — Systems view: where this thing actually breaks

Explaining the parts is not enough; the failure modes live in the loops.

```
boundary: agent intent → external effect → recorded truth, across AOPS + Circle + chain
```

**Stocks (things that accumulate):**

| Stock | Fills from | Drains to |
|---|---|---|
| Outstanding reservations | Grants consumed | Settlement or proven-dead authorization |
| Unresolved `unknown` attempts | Ambiguous dispatch | Authoritative lookup |
| Quarantined exposure | Signed-but-unsubmitted authorizations | Expiry or reconciliation |
| Reconciliation cases | Internal/external divergence | Operator resolution |
| Unsealed evidence bundles | Terminal journeys | Seal + export |

**The dominant loop — and it is reinforcing (bad):**

```
ambiguous outcome → reservation cannot release → available budget shrinks
→ legitimate agent work is denied → operators feel pressure to release manually
→ manual release without proof → duplicate spend → more ambiguity
```

The corpus's own invariants are the balancing loop that stops this: `TR-RSV-002` forbids release without authoritative proof. But **the delay in that balancing loop is unbounded** — it is however long authoritative lookup takes. Long delay plus a hard block equals liquidity starvation under stress, and liquidity starvation is what makes humans override safety controls.

**This is the structural driver nobody has addressed:** the corpus makes release *hard* (correct) but never makes it *fast*. There is no bound on how long a reservation can be held hostage by an unresolvable outcome. Part 5.1 shows that on Circle, this is fixable *cryptographically* rather than operationally — that is the highest-leverage change available.

**Archetype: Shifting the Burden.** The corpus's instinct at every decision point is to add a software control in agentOps. Software controls are bounded by "did our code work," so the maximum-loss story stays software-bounded, so more software controls get added, so the fundamental fix — pushing enforcement into primitives that hold outside agentOps entirely — gets starved. Part 6 is the fundamental fix.

---

# Part 3 — The assumption audit

This is the part you asked for: everything the corpus leans on that has no proof under it. I have sorted by how much breaks if the assumption is wrong.

## Tier A — Load-bearing. If wrong, the product changes shape.

### A1. There is a customer. `[ASSUMED]` — and this is the biggest one

The corpus specifies a "primary customer": a technical organization running multiple agents that buy APIs and initiate bounded financial actions. **No customer is named anywhere in 35 documents.** No interview, no design partner, no letter of intent, no usage data. `ADR-MP-P08` lists "Customer validation" as *required evidence* for choosing the first market profile — and that ADR is unresolved.

So the situation is: a complete, rigorous, revocable-certificate control architecture has been designed for a buyer who has not been confirmed to exist.

**Why this is the top item:** every other assumption is downstream. If the real first customer turns out to be a single developer running one agent with $50 of spend, then missions, quorum approvals, market eligibility results, and three-part release certificates are not underbuilt — they are the wrong product. The corpus's own opportunity cost is severe: implementation authority is `NOT GRANTED` while the assurance layer keeps growing.

**Falsifier:** one signed design partner who will state, in writing, that they will not deploy agents to production without mission-scoped authority and exportable evidence. Until then, treat the entire assurance apparatus as a hypothesis.

### A2. Provider-neutrality. `[ASSUMED]`

`ADR-MP-007` locks in "keep the core provider-neutral and adapters rail-specific." The claim is that the kernel does not bend to any one rail.

**Nothing tests this.** Every phase in the roadmap is Circle: Phase 2 is Circle mainnet, Phase 3 is Arc testnet, and the second rail does not arrive until Phase 4 — *after* the kernel is built and certified. A neutrality claim that will not be exercised until after the design is frozen is unfalsified by construction.

**Concrete evidence that the kernel is already Circle-shaped:** the canonical payment machine is `prepared → authorization_ready → dispatching → submitted → pending → confirmed → settled`. That is a blockchain lifecycle. A card authorization/capture/clearing/chargeback lifecycle, an ACH return-window lifecycle, and an invoice/net-30 lifecycle do not fit it. `authorization_ready` in particular assumes AOPS *possesses* an externally executable artifact — which, as Part 5.2 shows, is **false even for some Circle products**.

**Falsifier, and it is cheap:** take one non-blockchain rail on paper — a card network with a 120-day chargeback window — and map it onto the kernel. Count how many canonical objects need new fields. Do this *before* Phase 1, not in Phase 4.

### A3. agentOps can be the enforcement point. `[ASSUMED]` — and the territory says mostly no

The whole product rests on agentOps being a chokepoint that an agent cannot go around. The corpus is more honest than most here — it admits direct use is "advisory and bypassable" and requires each profile to declare its enforcement strength. But `AOPS-SEC-005` still requires that certified paths "prevent or explicitly disable direct bypass," and `AOPS-KRN-003` requires that no external side effect occur without a durable intent.

**Territory check.** From Circle's own docs (`RESEARCH-P`):

- Agent Wallets are built on Circle's **user-controlled** wallet infrastructure with **2-of-2 MPC**, and *"key shares are never exposed to the agent."* Users retain custody and **Circle cannot independently move funds**.
- Agent Wallets are operated through the **Circle CLI** with **email + OTP login**.
- Setting or resetting spending limits is **OTP-gated**, and Circle's own skill states: *"OTPs are password-equivalent. The agent must NOT receive, store, or relay the OTP."* The agent hands the human a verbatim command to run in their own terminal.

**What this means, stated precisely:** if agentOps is built on Circle **Agent Wallets**, then agentOps is *not* the enforcement point and cannot become one. It cannot sign (no key share). It cannot change spending limits without a human at a terminal with an emailed OTP. There is no programmatic write path.

`[ONE-WAY]` — agentOps can **read** agent-wallet limits (`circle wallet limit` needs no OTP). It **cannot write** them. The corpus's custody profile list contains `provider_managed_agent_wallet` as if it were interchangeable with the others; it is not, because it removes agentOps' write access to the control surface.

**The consequence for the kill switch is severe.** `AOPS-SEC-009` requires that new destructive actions stop when emergency revocation succeeds. On Agent Wallets, agentOps' revocation stops *agentOps-mediated* actions only. The provider-enforced ceiling — the thing that would actually stop a compromised agent — cannot be lowered by agentOps at all. An incident at 3am requires a human with inbox access.

**There is a fix, and it is a different product choice** (Part 6.2, move 1): developer-controlled wallets, where an **entity secret** held by agentOps authorizes transactions programmatically. Circle documents controls on machine-operated wallets — time-bound USDC spending limits for transfers and x402, plus allowlists and blocklists — with *"policies enforced at the wallet layer... checked against predefined rules before execution."* (`RESEARCH-S`, from Circle's Agent Stack announcement.) **Whether that policy surface is fully available on developer-controlled wallets via API, with no OTP step, is the single most important unverified fact in this entire review.** It decides whether agentOps can be an enforcement point on Circle at all. It is a two-hour spike and it should happen before anything else.

### A4. A reservation can always eventually be released. `[ASSUMED]`

`TR-RSV-002` permits release only on "authoritative proof that no external effect or valid authorization can occur." The corpus never demonstrates that such proof is *obtainable* — it just requires it.

For a generic HTTP provider, it often is not obtainable. If a facilitator silently drops your signed payment and never answers lookups, you hold that reservation forever. The corpus has no maximum hold duration, no forced-decision procedure, and no accounting treatment for permanently-quarantined capital.

**This is the reinforcing loop from Part 2, and on Circle it is solvable.** See Part 5.1 — this is the best news in this document.

### A5. Atomic grant + reservation + attempt is achievable. `[ASSUMED]`, and the corpus knows it

`AOPS-KRN-012` demands one atomic commit for grant consumption, attempt creation, and reservation creation before signing. Assumption 1 of the validation gate admits this is unproven and specifies the crash-matrix spike. **Correctly flagged, not yet done.** No note needed beyond: nothing should be built on the money path until that spike runs.

### A6. Evidence integrity can survive an insider. `[ASSUMED]`

The corpus states the problem correctly — if one administrator can rewrite both the events and the chain head, the mechanism is only *internally* tamper-evident — and offers four options in `ADR-MP-P05`. All four are unselected. Meanwhile the shipped code verifies a **bounded prefix** and never compares the verified tail to the canonical head, so tail deletion is currently undetectable.

Until `ADR-MP-P05` resolves, the phrase "canonical audit chain" is doing work it has not earned. The gap register flags this as a claim contradiction; it should be treated as a marketing-language blocker, not just a technical one.

## Tier B — Contradicted or complicated by Circle's live documentation

These are map-vs-territory deltas. Territory wins.

### B1. `authorization_ready` does not exist for Circle Wallets `RESEARCH-P`

The corpus's payment machine treats `authorization_ready` as a general stage: an externally executable artifact exists before dispatch, so exposure begins before submission.

**Territory:** Circle's signing and authorization models doc describes three models. For **developer-controlled** wallets, your backend authorizes with an entity secret and *Circle's MPC does the signing*. agentOps never holds a signed transaction. There is no artifact anyone else could submit.

So within the *same* "Circle" adapter family:

| Circle product | Who holds the executable authorization | Does `authorization_ready` exist? |
|---|---|---|
| Dev-controlled Wallets | Circle's MPC | **No** — exposure begins at API call |
| Agent Wallets | 2-of-2 MPC, agent/user side | **No** for agentOps |
| x402 / Nanopayments | The payer signs EIP-3009 offchain | **Yes** — and it is the dominant exposure |
| Gateway transfers | The payer signs an EIP-712 burn intent | **Yes** |

This is a **strong vindication of `ADR-MP-007`** — "Circle payment" genuinely is not one thing — but for a sharper reason than the corpus gives. The corpus separates Circle products by *feature*. The real discriminator is **authorization-artifact custody**, because that is what determines where exposure starts and who can still spend your money. That should be a declared field in the adapter capability schema.

### B2. The `confirmed` state never fires on Arc `RESEARCH-P`

Circle's transaction-states doc: `CONFIRMED` *"may be omitted on instant-finality blockchains; transitions directly from SENT to COMPLETE on Arc."*

The corpus's canonical machine is `pending → confirmed → settled`. On Arc, `confirmed` is unreachable. `TR-PAY-005` does already allow `pending → settled`, so the kernel survives — **credit where due, this one is already handled.** But two things follow that are not handled:

- The adapter capability schema must declare which states are *reachable*, or conformance tests will assert on states that can never occur.
- **Arc has deterministic BFT finality with no reversions.** So the corpus's reorg-handling path (`domains/10`: "Reorg after confirmation: transition through adapter-specific reorg/reversal and correcting ledger entry") is **dead code on Arc and live code on Base/Ethereum**. Untested branches on the money path are a liability. Adapters need an explicit `reorg_possible: bool`, and the reorg path must be exercised on a chain where it can actually happen.

### B3. Arc's status is at its expiry date `RESEARCH-P` + `RESEARCH-S`

`ADR-MP-011` locks "Arc is a Public Testnet conformance profile until mainnet is available," citing Arc's deployment-model doc.

**Territory, retrieved today:** Arc's docs confirm Public Testnet is the live network (**chain ID 5042002**), with *"Private Mainnet"* (~20 permissioned validators, limited access) and *"Public Mainnet"* both listed as upcoming. Developer access is permissionless at every phase. **So the corpus is still correct.**

But `RESEARCH-S`: multiple reports put Arc **mainnet Beta in "summer 2026"** — which is now. The corpus's own governance requires provider facts to be reverified "before each adapter release," and the Arc fact carries a retrieval date of 2026-07-28. This is a fact with hours of remaining shelf life, and an entire ADR plus a roadmap phase plus submission copy hang off it. Put a weekly recheck on it.

**Also missing from the Arc profile entirely** (`RESEARCH-P`, all from Arc's docs): Malachite BFT consensus; ~0.48s testnet block time, sub-second deterministic finality; **USDC as native gas**, with EURC and USYC also native; EVM at the **Osaka** hard fork; **Arc Privacy Sector (APS)** confidential contract execution; and **SLH-DSA-SHA2-128s post-quantum wallet signatures**. The Phase 3 pin list asks for "gas and finality behavior" but never mentions privacy or post-quantum signing — and a post-quantum signature scheme is a *signer profile* fact, which by the corpus's own rules is certificate-invalidating.

### B4. Idempotency semantics are unverified in the way that matters most `RESEARCH-S` `[GAP]`

`AOPS-ADP-002` (`S0`): "Same key with changed payload MUST be rejected."

**Territory:** Circle requires a UUIDv4 `Idempotency-Key` on mutating endpoints, and *"if the same key is reused, it will be treated as the same request and the original response will be returned."*

That is **return-the-original**, not **reject**. If Circle silently returns the original response when agentOps reuses a key with a *changed* payload, then an agentOps bug produces a **phantom settlement**: a fresh attempt with new amount and new destination gets back a success response describing a *different, older* transaction. agentOps books the new intent as settled. Nothing moved. The reconciliation difference will be real but the immediate signal is indistinguishable from success.

Two unknowns, both certification-blocking:

1. Does Circle *reject* changed-payload-same-key, or return the original? **Unverified.**
2. What is the idempotency-key **retention window**? **Not documented.** After it lapses, the same key stops being idempotent, so a delayed replay can duplicate. `domains/10` requires every adapter to declare "idempotency scope and retention window" — for Circle this cannot currently be declared, which by the corpus's own rules blocks the adapter gate.

**Silver lining, and it is important:** because reuse returns the original response, **the idempotency key is your recovery handle**. If the POST response is lost, agentOps has no Circle transaction ID — but re-POSTing with the *same* key returns the original response, including the ID. This is precisely why `AOPS-ADP-010` (durable `dispatching` lease containing exact request and provider identity) is the right requirement. Write that down as the recovery procedure; right now it is implied, not specified.

### B5. Webhook guarantees are stronger and better-documented than the corpus cites `RESEARCH-S`

The corpus cites *Gateway* webhooks for duplication and reordering. Circle's Wallets webhook documentation is more explicit: delivery is **at-least-once**; the same notification **can be sent more than once**; consumers must **deduplicate on Notification ID / MessageId** before applying side effects; applications **must not assume delivery order**; each webhook is **ECDSA-signed** with `X-Circle-Signature` and `X-Circle-Key-Id`, verified against a public key from `/v1/notifications/publicKey/get`; and events can be **resent from the console's Webhook Logs tab**.

This *supports* `AOPS-ADP-005`, and it also gives you three concrete things the corpus does not name: the exact dedupe key, the exact signature-verification mechanism, and an **operator replay capability** that belongs in the unknown-resolution runbook.

Gateway's own webhook page documents three event types — `gateway.deposit.finalized`, `gateway.mint.finalized`, `gateway.mint.forwarded` — and notes that on instant-finality chains events skip `confirmed`, so **multiple event types must be combined** to track one transfer lifecycle. `[GAP]`: the corpus has no notion of a lifecycle that must be assembled from several event types.

### B6. "Fail closed" is impossible on the gas dimension `RESEARCH-P` `[GAP]`

Circle's Agent Wallets doc: *"Agent wallet transactions are gas-sponsored. Sponsorship is capped and subject to change."* Gas Station adds configurable per-transaction and daily caps, and if a transaction exceeds them **it will not be sponsored**. Gas Station on EVM requires an **ERC-4337 SCA** (`"accountType": "SCA"`), across 22 networks.

Three consequences the corpus does not cover:

- **A new failure mode:** authorization valid, policy passed, reservation held, *sponsorship declined*. Almost certainly no economic effect, so it maps to `failed` — but only if agentOps can prove non-submission, which requires knowing whether the decline happened pre- or post-broadcast.
- **Fee accounting becomes bimodal:** sometimes gas is free to the tenant (cost borne by Circle or by agentOps' Gas Station policy), sometimes it is not. "Fees/gas/FX accounting" in Phase 2 assumes one model.
- **A third-party cap sits on your critical path** and is documented as "subject to change." That is a dependency whose change invalidates certificates under `AOPS-KRN-010`, and nothing in the dependency map tracks it.

### B7. Circle is a third decision authority `RESEARCH-P` `[GAP]`

The corpus gives `Decision` to the policy domain: agentOps evaluates, agentOps decides.

**Territory:** Agent Wallets state that *"all transfers are screened against sanctions controls before submission onchain."* Circle's Compliance Engine performs real-time transaction screening for sanctions, terrorist financing, and suspicious behavior, with configurable rules and blocklists, across all Wallets-supported chains. And Circle's transaction states include **`DENIED`** — *"the platform denies the transaction"* — with `errorReason` and `errorDetails`.

So three independent authorities can stop the same payment:

1. agentOps' `PolicyVersion`
2. Circle's wallet spending policy
3. Circle's compliance screening

`[GAP]` — nobody has specified what happens when they disagree. Concretely:

- A Circle `DENIED` needs to be captured as a **first-class decision record**, not an adapter error, or the evidence bundle will show "agentOps authorized" with no explanation of why nothing moved. That is exactly the reconstruction failure `AOPS-KRN-009` exists to prevent.
- A compliance denial is **information about a counterparty**. It should feed the provider lifecycle (suspend the provider, quarantine the destination). There is no such feedback edge in the design — it is `[ONE-WAY]` today: agentOps reads the error and drops it.
- **Policy split-brain:** agentOps' budget and Circle's remaining spending limit are two numbers that can drift. Circle's is the *hard* one. agentOps can be tracking $400 of remaining authority against a Circle daily cap that has $12 left. Nobody designed the reconciliation.

### B8. Reconciliation to "zero unexplained difference" is unachievable as written `RESEARCH-P` — this one would fail their own gate

Phase 2's exit gate: *"Mainnet canary has one economic effect per intent and zero unexplained difference."* `domains/08` requires zero unexplained monetary difference at the certified cutoff.

**Territory, from Gateway's technical guide:** Gateway maintains *"an offchain ledger that represents the USDC balances that are deposited and are available for use in instant transfers,"* and those balances are *"eventually consistent with onchain state."* Nanopayments *"aggregates signed payment authorizations and settles net positions in bulk"* — onchain settlement happens **later, in batches**.

So reconciliation is not two-way, it is **three-way**:

```
agentOps double-entry ledger  ↔  Gateway offchain ledger  ↔  onchain USDC
```

And the second arrow is *designed* to be inconsistent during a batch window. Which means:

- **"Zero unexplained difference" against chain state is not satisfiable per-payment.** During a batch window the difference is expected, not unexplained. The standard needs a named `batch_in_flight` allowance with an explicit bound and an aging alarm.
- **The certified cutoff has to be defined on Gateway's ledger**, with chain settlement as a separate, batch-level reconciliation.
- Phase 3's exit gate — *"at least one real Arc transaction externally verifies"* — is fine for a wallet transaction and **not satisfiable per-nanopayment**, because an individual nanopayment has no individual transaction to look up. Nanopayment verification is necessarily batch-level.

`[GAP]` — the corpus has exactly one notion of external truth. It needs two tiers: **provider-ledger truth** (authoritative, per-payment, Gateway API) and **chain truth** (authoritative, per-batch, explorer).

### B9. Treasury recovery has a 7-day floor `RESEARCH-P` `[GAP]`

Gateway's technical guide: to withdraw USDC without API interaction, a user *"must first initiate a withdrawal with a transaction, wait for a **7-day withdrawal delay period**, and then... complete the withdrawal."* This is the trustless escape hatch for when Circle's API is unavailable.

Burn intents also expire (`maxBlockHeight`, plus a `maxFee` ceiling), attestations carry a **10-minute** validity window on the destination chain, and a `BurnIntentSet` is capped at **16 intents** per request on EVM.

`[GAP]` — nothing in `domains/12` (platform operations) or the Phase 2 funding/liquidity model acknowledges that funds parked in Gateway have a **7-day worst-case recovery time**. Any incident runbook that implies faster treasury recovery from Gateway is wrong. The 16-intent batch cap is also a hard throughput constraint on multi-source transfers that no capacity plan mentions.

### B10. The x402 destination comes from the *attacker's* response `RESEARCH-P` — upgrade this to P0

The corpus lists "provider catalog poisoning or destination replacement" as a threat and asks every profile "who can change a payment destination." It never connects this to how x402 actually works.

**Territory:** in x402, the **server's `402` response** supplies `payTo`, `amount`, `asset`, and `network`. The client then signs an EIP-3009 authorization over those values. The facilitator *"cannot modify the amount or destination and serves only as the transaction broadcaster."*

Read those two facts together:

- **After** signing, amount and destination are **cryptographically immutable**. This is a genuine upgrade — for x402, agentOps' destination fence is *cryptographic*, not "software only." The corpus's threat model should say so; it currently undersells its own strongest control.
- **Before** signing, the destination is **supplied by the counterparty, per request**. A compromised, spoofed, or MITM'd provider returns its own `payTo` and the agent signs it. The signature then makes the theft irreversible.

So the entire security of x402 payment collapses onto **one control**: what agentOps validates `payTo` against *before* it signs. That must be an allowlist bound to a previously-verified destination — Circle's Agent Marketplace listing value, or a tenant-configured provider destination under dual control (`AOPS-SGN-007`). This deserves to be an `S0` requirement of its own. It currently is not.

## Tier C — Silent assumptions nobody stated out loud

**C1. That the same architecture serves $0.000001 and $50,000 payments.** Nanopayments go down to a millionth of a dollar (`RESEARCH-P`). At that size, a durable `ActionIntent`, a policy evaluation, a reservation, a `dispatching` lease, an attempt row, balanced journal postings, and an evidence event **cost more than the payment**. The corpus has one control model for all amounts. It needs tiers: full ceremony above a threshold, and below it a *pre-authorized envelope* (one grant, one reservation, one bounded EIP-3009 authorization budget) with aggregate post-hoc accounting. See Part 6.2, move 5.

**C2. That policy evaluation is cheap.** Every governed action does durable-write → policy eval → reservation → attempt. No latency budget appears anywhere. Nanopayments' selling point is sub-second machine-speed. If agentOps adds 300ms of synchronous ceremony, agents route around it — and routing around it is possible (see A3).

**C3. That operators exist.** The design leans hard on human operators: unknown-attempt consoles, reconciliation cases, break-glass with two-person approval, incident runbooks, staged limit increases. For a first customer, that may be one engineer who is asleep. Every control whose resolution path is "an operator decides" needs a documented default for *nobody is watching*.

**C4. That "878/878 tests" means anything right now.** The gap register cites it and then says the audit "did not rerun the suite." By the corpus's own claim classes, that makes it a stale `CURRENT-EVIDENCE` claim on a branch that is not `main`. Fine to keep, but it should not be quoted in any submission as current.

**C5. That two commits will converge.** `main` at `ef4e42e` and the paid-HTTP candidate at `a0556e6`, unmerged, with the candidate carrying the design docs, the QA evidence, *and* the P0 pre-policy-egress bug. The branch strategy is listed as an exit condition, not a decision. Every day this persists, the two diverge and evidence provenance gets harder.

**C6. That the assurance layer is proportionate.** Five conformance standards, a release-certificate schema, monotonic epochs, and revocation propagation — before one real payment. This may well be right for the stated customer. It is definitely wrong if A1 is wrong. It should be stated as a *bet*, not as a baseline.

---
# Part 4 — The Circle stack, actually mapped

The corpus names five Circle things: Wallets, Gateway, CCTP, Nanopayments, Agent Stack. Circle's live documentation index (`developers.circle.com/llms.txt`, `RESEARCH-P`) shows **thirteen** product areas. Several of the missing ones do work the corpus plans to build itself.

## 4.1 Two planes

Circle is not "a blockchain company with an API." It is an **offchain control plane** bolted onto an **onchain settlement plane**, and almost every interesting agentOps property comes from understanding which plane a given guarantee lives on.

```
┌──── OFFCHAIN CONTROL PLANE (Circle-operated, API/policy/attestation) ────┐
│  Wallets API (MPC signing)   Wallet spending policies   Compliance Engine │
│  Gateway offchain ledger + attestation service   Nanopayments batcher     │
│  Gas Station sponsorship policy   Agent Marketplace Discovery API         │
│  CPN orchestration   Circle Mint   StableFX   Webhooks (at-least-once)    │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ attestations, signed intents, batched txs
┌──────────────────────────────▼───────────────────────────────────────────┐
│  ONCHAIN SETTLEMENT PLANE                                                │
│  USDC/EURC contracts (EIP-2612 permit, ERC-3009 authorization)           │
│  Gateway Wallet + Gateway Minter contracts   CCTP v2 TokenMessenger       │
│  Paymaster (ERC-4337 v0.7/v0.8)   Refund Protocol escrow                 │
│  Smart Contract Platform + Event Monitoring   xReserve                   │
│  Arc L1 (USDC gas, Malachite BFT, APS privacy, post-quantum sigs)         │
└──────────────────────────────────────────────────────────────────────────┘
```

**The rule that follows from this picture, and it is the most useful single rule in this document:**

> Circle's **speed** comes from the offchain plane. Circle's **finality** comes from the onchain plane. Every Circle product that feels instant is instant because an offchain component made a promise before the chain confirmed it. agentOps must therefore record **two settlement facts per payment**, not one — and must know which one it is reconciling against.

## 4.2 Full inventory, with agentOps relevance

| Circle product | Plane | What it actually gives you | In corpus? | Verdict for agentOps |
|---|---|---|---|---|
| **Dev-controlled Wallets** | Off | Programmatic wallets; backend authorizes with an **entity secret**; MPC signs (Circle-hosted *or* on-prem) | Named | **The enforcement-point candidate.** On-prem MPC is the strongest custody story available |
| **User-controlled Wallets** | Off | User must complete signing; Circle cannot proceed alone | Named | Wrong shape for autonomous agents |
| **Modular Wallets** | Off | Passkey auth; passkey never leaves user's device | No | Human-approval UX, not agent execution |
| **Agent Wallets** | Off | 2-of-2 MPC on user-controlled infra; CLI + email/OTP; **OTP-gated policy writes**; **mainnet-only policies** | Named | Great demo, **wrong control surface** for a control plane (see A3) |
| **Wallet spending policies** | Off | Time-bound USDC limits (per-tx/daily/weekly/monthly), allow/blocklists, enforced **pre-submission at the wallet layer** | Named | **Your provider-enforced loss bound.** Highest-value primitive in the stack |
| **Compliance Engine** | Off | Real-time sanctions/risk screening pre-submission, monitoring, Travel Rule, blocklists | **No** | Third decision authority (B7); also free counterparty intel |
| **Gateway** | Both | Unified USDC balance via offchain ledger + EIP-712 burn intents + signed attestations + Minter contract; 7-day trustless withdrawal | Named | **Where reservations should live** (Part 6.2 move 2) |
| **Nanopayments** | Both | Gasless EIP-3009 authorizations from $0.000001, batched net settlement | Named | Sub-cent tier; forces a two-tier control model |
| **CCTP v2** | Both | `depositForBurn` with `minFinalityThreshold`; **1000 = hard finality, ≤500 = Fast**; Fast fee 0–14bps, Standard free; **Circle absorbs reorg loss from a Fast Transfer Allowance escrow** | Named | Fast Transfer **removes reorg risk from your ledger** — but FTA exhaustion is an undesigned failure mode |
| **Paymaster** | On | Pay gas in USDC; ERC-4337 v0.7/v0.8; 7 chains; no Circle account needed; 10% surcharge on Arbitrum/Base | **No** | Makes fee accounting single-asset. Permissionless = no vendor dependency |
| **Gas Station** | Off | Sponsorship policies with per-tx/daily caps; **requires SCA on EVM**; 22 networks | **No** | Bimodal fee accounting + a third-party cap on your critical path (B6) |
| **Agent Marketplace** | Off | Discovery API (**no API key**), submit-for-review listing, **continuous sanctions screening of seller payout wallets**, **continuous health checks with auto-delisting**, structured `accepts` array, input/output JSON Schema + OpenAPI | **No** | **Replaces most of domain 07 and much of `ADR-MP-P10`** |
| **Smart Contract Platform** | On | Deploy bytecode/templates, interact, **Event Monitoring** | **No** | Event Monitoring = an authoritative-lookup feed; templates = evidence anchor without writing Solidity |
| **Refund Protocol** | On | Non-custodial ERC-20 escrow, lockup period, arbiter limited to **release-to-recipient or refund-to-payer** | **No** | **Makes `ADR-MP-008` enforceable instead of merely recorded** |
| **CPN** | Off | Offchain orchestration between originating and beneficiary institutions for fiat payout; AML/KYC/sanctions/Travel Rule embedded in the protocol | **No** | The offchain rail for anything that must land in a bank account |
| **Circle Mint** | Off | Fiat↔USDC, bank withdrawal | **No** | The actual treasury funding path. Phase 2 says "funding model" and never names it |
| **StableFX** | Off | Currency conversion (taker/maker) | **No** | Multi-currency budgets without an external FX provider |
| **xReserve** | On | Partner chains mint USDC-backed tokens against attested USDC deposits; **partner-only** | **No** | Not relevant near-term |
| **Arc** | On | USDC-gas L1; Malachite BFT; ~0.48s blocks, sub-second deterministic finality; EVM Osaka; EURC + USYC native; **APS confidential execution**; **SLH-DSA-SHA2-128s post-quantum signatures**; permissioned validators, permissionless devs; **testnet chain 5042002**, Private then Public Mainnet upcoming | Named | Correctly deferred. Profile pin list is materially incomplete (B3) |
| **Circle CLI + Skills + MCP** | Off | `@circle-fin/cli` covering wallet/bridge/gateway/services/contract/transaction; open-source skills; MCP for volatile ground truth (addresses, signatures) | **No** | **A competitor to your MCP surface**, and a distribution channel if you ship agentOps as a Circle Skill |

## 4.3 The details that change the design

**Gateway's burn intent is a bounded liability, by construction.** `RESEARCH-P` — `BurnIntent` carries `maxBlockHeight` (expiry, expressed in *Ethereum L1* block height when on Arbitrum), `maxFee` (a ceiling on what Circle may take), and `spec`. Attestations carry a **10-minute** destination-chain validity window. `BurnIntentSet` is capped at **16** intents per EVM request. Deposits must **finalize onchain** before they count toward the unified balance — so funding latency is chain-dependent, not instant.

**Gateway's non-custodial claim is precise and worth restating exactly.** Circle cannot move your USDC without your signature; you can always exit trustlessly after 7 days; burn intents expire so the system does not hold live intents. But the *unified balance* is an offchain number, eventually consistent with chain state. Those two facts coexist: **custody is cryptographic, accounting is offchain.**

**Nanopayments' trust window is real and deliberate.** `RESEARCH-P/S` — the buyer signs EIP-3009 offchain at zero gas; the middleware verifies the signature and available balance and **deducts from the unified balance immediately**; the seller is told "authorized" and can deliver at once; onchain settlement happens later in a batch. So for a nanopayment, **the authoritative source of truth is the Gateway API, not a block explorer** — and the seller's assurance is Circle's promise of batch inclusion, not a chain receipt.

**x402 exact scheme, precisely.** `RESEARCH-P` — `PaymentRequirements` = `scheme`, `network` (CAIP-2), `amount` (atomic units), `asset`, `payTo`, `maxTimeoutSeconds`, `extra`. The EVM `exact` payload is an EIP-712 signature over an EIP-3009 authorization: `from`, `to`, `value`, `validAfter`, `validBefore`, `nonce` (32 bytes). Facilitator exposes `POST /verify`, `POST /settle`, `GET /supported`. Replay protection is layered: unique nonce, onchain nonce-reuse rejection, time window, signature verification. **And the spec explicitly does not address settlement certainty, risk allocation, refunds, or liability** — that silence is precisely the space agentOps occupies.

**CCTP v2's risk transfer is a gift.** `RESEARCH-S` — Fast Transfer means Circle attests *before* source-chain finality and **absorbs reorg loss from its Fast Transfer Allowance escrow**. So on the Fast path, reorg risk is Circle's, not your ledger's. The undesigned failure mode: **FTA exhaustion**, which silently degrades you to the Standard (slow, hard-finality) path — a latency cliff no capacity plan mentions.

---

# Part 5 — Five things Circle gives you that the corpus does not claim

## 5.1 A **cryptographic** reservation-release proof — the single biggest win

This solves A4, and it is the fix for the reinforcing loop in Part 2.

`TR-RSV-002` permits releasing a reservation only on "authoritative proof that no external effect or valid authorization can occur." In general that proof does not exist, which is why the corpus's only honest answer is indefinite quarantine.

**On Circle, that proof exists and is checkable against chain state.** Every Circle authorization artifact is a *time-or-height-bounded, nonce-bearing, signed object*:

| Artifact | Expiry field | Uniqueness field | Death predicate — provable onchain |
|---|---|---|---|
| x402 / Nanopayments EIP-3009 authorization | `validBefore` | 32-byte `nonce` | `block.timestamp > validBefore` **AND** `authorizationState(from, nonce) == false` |
| Gateway burn intent | `maxBlockHeight` | intent `spec` | source-chain height `> maxBlockHeight` |
| Gateway attestation | 10-minute window | `spec` | window elapsed without a mint event |

Once both halves of the EIP-3009 predicate hold, the authorization is **provably dead forever**: the time window has closed, so it can never be submitted; and the nonce was never consumed, so it never *was* submitted. That is not a heuristic or a timeout — it is a mathematical certainty read directly from the token contract.

**What this changes:**

- `authorization_ready` stops being an open-ended liability and becomes a **bounded, quantified exposure window** with a known end time. You can put a number on it: exposure = amount × (validBefore − now).
- The adapter contract should gain a declared **`authorization_death_predicate`** that the treasury domain evaluates against chain state. Release becomes automatic and *proven*, not manual and *hoped*.
- Reservation release goes from an operations problem to a chain query. The reinforcing starvation loop is cut at its source.
- **Policy gets a new lever:** agentOps chooses `validBefore` when it signs. Short windows mean small exposure and fast release; long windows mean tolerance for slow facilitators. That is a *policy* decision that should be expressed in `PolicyVersion`, per mission. Nothing in the corpus contemplates this.

This should be an `S0` requirement and it should be in Phase 1, not Phase 2. It is the corpus's hardest unsolved invariant and Circle hands you the solution.

## 5.2 A precise taxonomy for what "Circle payment" means

From B1: the discriminator is **authorization-artifact custody**, and it determines exposure shape. Add these fields to the adapter capability schema and the corpus's "no false universal lifecycle" principle becomes mechanically checkable rather than aspirational:

```yaml
authorization_custody: aops_holds | provider_holds | user_holds | none
authorization_expiry_kind: timestamp | block_height | none
authorization_death_predicate: <chain-verifiable expression or null>
reachable_states: [...]          # e.g. Arc omits `confirmed`
reorg_possible: true | false
external_truth_tier: provider_ledger | chain | both
settlement_granularity: per_payment | batch
idempotency_changed_payload: rejects | returns_original | unknown
idempotency_retention: <duration or unknown>
```

## 5.3 A provider-enforced maximum-loss bound you can actually publish

`AOPS-SGN-003` requires every signer profile to publish maximum loss per compromise case. Today that would be a software claim — "our policy engine would have stopped it" — which the corpus's own threat model correctly dismisses: *"a software destination fence is not cryptographic if the compromised signer can ignore it."*

On Circle, the bound becomes a **min() over independently-enforced ceilings**, and you can name which party enforces each:

```
loss(compromised agent) = min(
    agentOps reservation ceiling,          [software  — agentOps]
    Circle wallet per-tx / daily limit,    [PROVIDER  — Circle, pre-submission]
    funded wallet balance,                 [CRYPTO    — chain]
    Gateway unified balance,               [PROVIDER  — Circle offchain ledger]
    Compliance Engine screening            [PROVIDER  — Circle]
)
```

The crucial property: **if agentOps itself is fully compromised, the bound is still `min(Circle limits, funded balance)`.** That is a real, externally-enforced number — the thing `04-trust-tenancy-and-threat-model.md` asks for and cannot currently produce. This is the strongest security argument the product has and the corpus does not make it.

Caveat that must ship alongside it: on **Agent Wallets** the Circle limit cannot be lowered by agentOps (A3), so it is a *static* ceiling, useful for bounding loss but useless as an incident-response lever.

## 5.4 Delivery-versus-payment becomes *enforced*, not merely *recorded*

`ADR-MP-008` separates payment settlement from delivery and mission completion. Today that separation is bookkeeping: agentOps records two facts and hopes.

**Refund Protocol** (`RESEARCH-S`, Circle) is a non-custodial ERC-20 escrow with a lockup period and an arbiter whose powers are deliberately limited to exactly two actions: **release to recipient** or **refund to payer**. It records recipient address, refund address, and value, and supports early withdrawal.

Map that onto the corpus and the fit is exact:

| Corpus concept | Refund Protocol mechanism |
|---|---|
| `Delivery: pending` | Funds locked in escrow, lockup running |
| `Delivery: accepted` | Arbiter releases to provider |
| `Delivery: rejected` | Arbiter refunds to payer |
| `Delivery: disputed` | Lockup period is the dispute window |
| `refund_pending → refunded` | An onchain path instead of "documented compensating path" |

This directly fills the corpus's largest commerce gap — Phase 2's exit gate currently accepts *"refund or documented compensating path,"* which is an admission that there is no refund mechanism.

**Interrogate it honestly, though.** Escrow introduces a new trusted role: who is the arbiter? If agentOps is the arbiter, agentOps has acquired a *quasi-custodial* power (it can direct funds between two parties), which changes the custody analysis, the legal analysis, and the maximum-loss analysis — a compromised agentOps arbiter can release every escrow to a provider it controls. If a third party is the arbiter, you have a new dependency and a new SLA. And escrow is per-payment, so it cannot serve nanopayment volumes. Conclusion: **use it for the high-value tier only, and treat the arbiter role as a first-class custody profile requiring its own certificate.**

## 5.5 Provider commerce is largely already built

Domain 07 is marked **Absent**, and `ADR-MP-P10` asks how deep to build seller onboarding: curated, self-service, or partner-only.

Circle's Agent Marketplace already provides (`RESEARCH-P`): a **Discovery API with no API key required**, filterable by network, price, payment rail, and protocol type; **submit-for-review** listing; **continuous sanctions screening of every seller's payout wallet with automatic exclusion of blocked parties**; **continuous endpoint health checks with automatic removal of unreachable services**; structured payment requirements (`asset`, `network`, `amount`, `payTo`) in an `accepts` array; and **input/output JSON Schema plus OpenAPI specs** so an agent can construct calls unaided.

So the right answer to `ADR-MP-P10` is: **consume, do not build.** agentOps reads the Discovery API as its provider registry and adds only the four things Circle does not provide:

1. **Per-tenant provider allowlists** — Circle screens for sanctions; it does not know your procurement policy.
2. **Negotiated terms and offer versioning** — `ProviderOffer` with tenant-specific pricing and terms.
3. **Delivery acceptance and dispute** — Circle knows a payment settled; it does not know you got what you paid for.
4. **Destination binding under dual control** — the B10 fix. The marketplace-listed `payTo` becomes the allowlisted value that a live `402` response must match before signing.

That last one is the real product: Circle's marketplace gives you a **trustworthy prior** for `payTo`, which is exactly the input the x402 attack in B10 needs.

---

# Part 6 — First-principles rebuild

## 6.1 Sorting the constraints

| Claimed constraint | Class | Verdict |
|---|---|---|
| No side effect before durable intent + policy | physics (distributed systems) | **Binding.** Keep |
| Post-submit timeout is `unknown` | physics | **Binding.** Keep |
| Economic history is append-only, double-entry | math / audit requirement | **Binding.** Keep |
| Descendant authority may narrow, never widen | math (attenuation) | **Binding.** Keep |
| Keys/secrets never in model context | measured threat | **Binding.** Keep |
| Testnet ≠ mainnet | measured fact | **Binding.** Keep |
| Personal data must not be made immutable | regulation (GDPR/EDPB) | **Binding.** Keep |
| **agentOps must own the signer to enforce anything** | **convention** | **Drop.** Circle enforces pre-submission at the wallet layer |
| **Reservations must be software-enforced counters/rows** | **convention** | **Drop.** A funded wallet balance is a chain-enforced reservation |
| **Reservation release requires an operator** | **convention** | **Drop.** EIP-3009 death predicate is chain-verifiable (5.1) |
| **agentOps must build a provider registry** | **convention** | **Drop.** Discovery API exists (5.5) |
| **Refunds need a "documented compensating path"** | **convention** | **Drop.** Refund Protocol escrow (5.4) |
| **One control model for all payment sizes** | **convention** | **Drop.** $0.000001 cannot carry $1 of ceremony (C1) |
| **Reconciliation is two-way** | **wrong** | **Drop.** It is three-way (B8) |
| Every profile needs its own certificate | product policy | Keep, but scope it to what actually changes |

## 6.2 Ten concrete moves

**Move 1 — Choose developer-controlled wallets with an entity secret, not Agent Wallets.**
This is the decision that determines whether agentOps is an enforcement point or a dashboard. Agent Wallets put a human-with-an-OTP between agentOps and the control surface, which breaks programmatic policy writes and the kill switch (A3). Developer-controlled wallets give agentOps the entity secret, and Circle documents an **on-premises MPC option** — which is the strongest custody story in the stack and the direct answer to `ADR-MP-P03`. *Blocking prerequisite:* verify that the spending-policy surface (time-bound limits, allow/blocklists) is available on developer-controlled wallets via API with no OTP step. **Two-hour spike. Do it first. Everything else depends on the answer.**

**Move 2 — "Budget as balance": make the reservation a funded wallet, not a database row.**
This is the highest-leverage change in the whole review, because it changes *structure* rather than tuning a parameter. Today, `AOPS-KRN-005` and the concurrent-sibling-overspend problem are enforced by Postgres — meaning a bug in agentOps is an unbounded loss. Instead: give each agent (or each mission) a wallet funded from Gateway with **exactly its allocated budget**, with Circle spending limits set to the same envelope.

Consequences: two sibling agents *cannot* overspend the same dollar because the dollar is not there. The reservation invariant moves from software to chain-plus-provider. Maximum loss per agent equals its funded balance — a number you can put in a certificate. Serializable-isolation contention on the hot reservation path largely disappears.

Costs, stated honestly: funding and rebalancing become continuous operations (Gateway deposits must **finalize onchain** first, so top-up latency is chain-dependent); capital is fragmented across wallets; and you now need a treasury allocation loop with its own controls. The corpus already lists `allocated_float_wallet` as custody profile 4 — **that is the right profile and it should be the default, not one of six equals.** The corpus currently frames the wallet-topology ADR as an open comparison; the Circle territory makes the answer much less open.

**Move 3 — Compile agentOps policy down to Circle policy, then continuously reconcile.**
Stop treating them as two policy engines (B7). Treat agentOps' `PolicyVersion` as the **source** and Circle's wallet spending policy as its **compiled, provider-enforced projection**. Then add a reconciler that reads Circle's limits (`circle wallet limit` needs no OTP — the read path is open) and alarms on drift. Drift is a security incident: it means the enforced ceiling no longer matches the authored intent. This also gives you a truthful enforcement-strength claim per rule: rules that compile down are provider-enforced; rules that cannot (mission scope, approval requirements, purpose limits) remain agentOps-enforced and must be labelled as such.

**Move 4 — Bind `payTo` before signing, under dual control. Make it `S0`.**
The B10 fix. Pipeline: marketplace-listed `payTo` (or tenant-configured destination changed only under `AOPS-SGN-007` dual control) → allowlist → compare against the live `402` response → refuse to sign on mismatch. After signing, EIP-3009 makes amount and destination immutable, so this one check is the whole ballgame. Then update the threat model to state that for x402 the destination fence is **cryptographic post-signature**, which is a stronger claim than the corpus currently makes about itself.

**Move 5 — Two control tiers, split by amount.**
Below a tenant-configured threshold (nanopayments, sub-cent, high frequency): one grant, one reservation, one **bounded EIP-3009 authorization envelope** with a short `validBefore`, aggregate journal postings per batch, sampled evidence. Above it: full ceremony — durable intent, per-action decision, approval, per-payment reservation, per-payment postings, sealed bundle, and Refund Protocol escrow where delivery risk warrants it. The threshold itself is a policy field and an auditable control. Without this, C1 makes the sub-cent tier economically impossible and agents will route around agentOps to get it.

**Move 6 — Model three-way reconciliation explicitly.**
Per B8: `agentOps ledger ↔ Gateway offchain ledger ↔ chain`. Define the certified cutoff on **Gateway's ledger** for per-payment reconciliation, and reconcile chain state at **batch** granularity. Introduce a named `batch_in_flight` account with an explicit bound and an aging alarm, so an expected mid-batch difference is *explained* rather than "unexplained." Add `external_truth_tier` and `settlement_granularity` to the adapter schema (5.2). Rewrite the Phase 2 and Phase 3 exit gates accordingly — as written, they cannot be satisfied by nanopayments.

**Move 7 — Adopt Circle's primitives for the things you were going to build.**
Provider registry → **Agent Marketplace Discovery API**. Refunds and disputes → **Refund Protocol**. Sanctions/risk screening → **Compliance Engine** (and capture its `DENIED` + `errorReason` as a first-class decision record, per B7). Authoritative lookup and reconciliation feeds → **Smart Contract Event Monitoring**. Gas in a single asset → **Paymaster** (permissionless, no Circle account, so no new vendor dependency). Fiat funding → **Circle Mint**. Multi-currency budgets → **StableFX**. Fiat payout → **CPN**. Each one deleted from your build list is a domain you do not have to certify.

**Move 8 — Make webhook handling match documented reality.**
At-least-once delivery, duplicates expected, **no ordering guarantee**, dedupe on **Notification ID / MessageId**, verify **ECDSA `X-Circle-Signature`** against `/v1/notifications/publicKey/get` with `X-Circle-Key-Id` for rotation. Treat `CONFIRMED` and `COMPLETE` as equally-final and accept either first. Assemble Gateway transfer lifecycles from **multiple event types** (`deposit.finalized`, `mint.finalized`, `mint.forwarded`) rather than expecting one. Put Circle's **console webhook resend** into the unknown-resolution runbook as an explicit operator action — it is a recovery tool the corpus does not know it has.

**Move 9 — Anchor evidence on Arc, but only a digest.**
`ADR-MP-P05` is unresolved and the current chain has a tail-deletion hole. Arc gives you sub-second deterministic finality, USDC-denominated (predictable) cost, and — via the Smart Contract Platform — deployment without hand-writing Solidity. Anchor **only a non-personal digest plus schema version**, exactly as Phase 3 already specifies, which keeps EDPB/GDPR compliance intact. Note the two Arc facts that make this attractive and that the corpus does not mention: **no reorgs** (an anchor cannot be un-anchored) and **APS confidential execution** if any anchor metadata is sensitive. Caveat: an anchor fixes tail deletion, not overcollection — you still need retention execution and deletion workflows.

**Move 10 — Publish the min() loss bound as the product's security claim.**
Per 5.3. Replace software-only assurances with a table naming each ceiling and its enforcer, including the row that matters most: **if agentOps is fully compromised, loss is still bounded by Circle's pre-submission limits and the funded balance.** This is both the honest claim and the strongest one.

## 6.3 What is left of agentOps — and why it is still a real product

Push all that enforcement into Circle primitives and a fair question is whether anything remains. A lot does, and it is more defensible than the current framing:

**Circle does not have, and shows no sign of building:**

- **Organizations, missions, and attenuated delegation.** Circle has wallets and limits. It has no concept of *a company*, *a purpose*, *a sponsor*, or *authority that narrows as it is delegated down an agent tree*. This is the durable core.
- **Cross-provider policy.** Circle enforces Circle. The moment a tenant uses Circle *and* Stripe MPP *and* a card mandate *and* a raw HTTP tool, only agentOps can hold one authority model across all of them. This is where "provider-neutral core" earns its keep — and why A2's cheap falsification test matters so much.
- **Human approvals with quorum and separation of duties.** Circle has an OTP. It does not have maker/checker, quorum, or approver eligibility rules.
- **Double-entry accounting across rails.** Circle gives balances and transaction records per product. Nobody gives a tenant one balanced ledger spanning Gateway, wallets, cards, and invoices.
- **Unknown-state recovery as a product surface.** x402's spec explicitly declines to address settlement certainty and liability. Circle documents async states and leaves resolution to you. The operator console for ambiguous outcomes is genuinely unbuilt territory.
- **Three-way reconciliation and exportable evidence.** Nobody is going to hand a tenant's auditor a bundle that ties a human principal, through a mission and policy version, to a Gateway batch and an onchain settlement.
- **Revocable certification of the whole tuple.** Circle certifies nothing about *your* deployment.

**The sharper positioning that falls out of this:** agentOps is not "governance for agent payments" — Circle is eating that. agentOps is **the accountability and recovery layer for agent actions across providers**, which happens to compile its controls down into whichever provider primitives can enforce them. That is a better story *and* a smaller build.

## 6.4 Target shape

```
                        HUMAN ACCOUNTABILITY
        org · sponsor · mission · delegation · approval · quorum
                                 │
                    ┌────────────▼────────────┐
                    │   agentOps POLICY CORE  │   authored once
                    │  PolicyVersion→Decision │
                    └────┬───────────────┬────┘
              compiles to│               │stays here (not compilable)
        ┌────────────────▼──┐      ┌─────▼──────────────────────┐
        │ PROVIDER-ENFORCED │      │ agentOps-ENFORCED          │
        │ Circle wallet     │      │ mission scope · purpose    │
        │  limits + allow/  │      │ approval gates · delegation│
        │  blocklists       │◄────►│ cross-provider aggregates  │
        │ Compliance Engine │drift │ payTo pre-sign binding     │
        │ funded balance    │alarm │                            │
        └─────────┬─────────┘      └────────────────────────────┘
                  │
        ┌─────────▼─────────────────────────────────────────────┐
        │ EXECUTION — tiered by amount                          │
        │  sub-cent : bounded EIP-3009 envelope → Nanopayments  │
        │  standard : per-payment grant → dev-controlled wallet │
        │  high-val : Refund Protocol escrow → delivery gate    │
        └─────────┬─────────────────────────────────────────────┘
                  │
        ┌─────────▼──────────┐  ┌──────────────┐  ┌───────────┐
        │ Gateway offchain   │  │ chain        │  │ agentOps  │
        │ ledger (per-pmt    │◄►│ (per-batch   │◄►│ double-   │
        │ authoritative)     │  │ authoritative)│  │ entry     │
        └────────────────────┘  └──────────────┘  └─────┬─────┘
              THREE-WAY RECONCILIATION                  │
                                              ┌─────────▼─────────┐
                                              │ EVIDENCE          │
                                              │ sealed bundle +   │
                                              │ Arc digest anchor │
                                              └───────────────────┘

RELEASE ends reservations by PROOF, not by timeout:
  authorization_death_predicate  =  validBefore elapsed  AND  nonce unused
```

---

# Part 7 — Circle → corpus state mapping

Concrete mapping for the Wallets adapter. This table does not exist in the corpus and is a prerequisite for `AOPS-ADP-006`.

| Circle state | Corpus state | Notes |
|---|---|---|
| *(none)* | `prepared` | agentOps-internal only |
| *(none)* | `authorization_ready` | **Does not exist** for Wallets — Circle's MPC signs (B1) |
| *(HTTP request in flight)* | `dispatching` | Lease must persist the `Idempotency-Key` — it is the recovery handle (B4) |
| `INITIATED` | `submitted` | POST accepted |
| `QUEUED` | `pending` | In processing queue |
| `CLEARED` | `pending` | Passed risk screening |
| `SENT` | `pending` | In mempool, hash assigned |
| `STUCK` | **no mapping** `[GAP]` | Sent but not includable. Distinct and *actionable* (accelerate) — not the same as `unknown` |
| `CONFIRMED` | `confirmed` | **Unreachable on Arc** (B2) |
| `COMPLETE` | `settled` | May arrive without a preceding `CONFIRMED` |
| `FAILED` | `failed` | Requires re-initiation |
| `CANCELLED` | `failed` | Cancellable **only** in `INITIATED`/`QUEUED`/`SENT` — a cancel *window* the corpus does not model `[GAP]` |
| `DENIED` | `failed` + **decision record** | Platform denial. Must carry `errorReason`/`errorDetails` into evidence (B7) |
| *(transport failure)* | `unknown` | agentOps-side only. Circle has no `unknown` — correct, and the corpus is right to own it |

Two gaps worth fixing in the kernel: `STUCK` needs a home (an actionable pending substate with an `accelerate` operation), and the **cancel window** needs to be a declared adapter capability, since cancellation is only legal in three early states.

---

# Part 8 — What to actually do next

Ordered by "how much else depends on the answer." The first three are cheap and unblock everything.

| # | Action | Cost | Unblocks |
|---|---|---|---|
| 1 | **Verify the developer-controlled-wallet policy API**: are time-bound limits + allow/blocklists settable programmatically with no OTP? | ~2h | A3, move 1, `ADR-MP-P02`, `ADR-MP-P03`, and whether agentOps can enforce anything on Circle |
| 2 | **Test changed-payload-same-idempotency-key against Circle sandbox**: reject or return-original? Measure the retention window empirically | ~3h | B4, `AOPS-ADP-002`, phantom-settlement risk, the whole adapter gate |
| 3 | **Prototype the death predicate**: sign an EIP-3009 authorization, let it expire unused, verify `authorizationState(from, nonce) == false` onchain, release the reservation on proof | ~1d | 5.1, `TR-RSV-002`, A4, the starvation loop |
| 4 | **Recheck Arc mainnet status weekly** and add the missing profile facts (Malachite, APS privacy, SLH-DSA post-quantum signatures, chain 5042002, USYC/EURC native) | ~1h | B3, `ADR-MP-011`, Phase 3, submission copy |
| 5 | **Name a design partner** — or explicitly reclassify the entire assurance layer as a bet | — | A1, and the honesty of everything downstream |
| 6 | **Falsify provider-neutrality on paper**: map a card rail with a 120-day chargeback window onto the kernel; count new fields | ~4h | A2 before the kernel freezes, not in Phase 4 |
| 7 | Promote `payTo` pre-sign binding to an `S0` requirement with dual-control destination changes | ~2h | B10, move 4 |
| 8 | Rewrite the Phase 2/3 reconciliation exit gates for three-way, two-granularity truth | ~4h | B8, move 6 |
| 9 | Add the adapter capability fields from 5.2 and the state mapping from Part 7 | ~4h | B1, B2, B4, `AOPS-ADP-006` |
| 10 | Add the 7-day Gateway recovery floor and the FTA-exhaustion cliff to platform ops and the funding model | ~2h | B9, CCTP degradation |
| 11 | Then, and only then, run the three validation-gate spikes | — | Implementation authority |

**One framing note on sequencing.** The corpus's gate currently blocks implementation on three spikes that are all *internal* (atomicity, Circle profile capability, revocation isolation). Items 1–3 above are cheaper than any of them, and item 1 in particular can invalidate the premise of validation-gate Assumption 2 before you spend a day on it. Run the cheap external checks first.

---

# Part 9 — Sources

All retrieved **2026-07-29**. Primary Circle/Arc/x402 documentation marked `RESEARCH-P`; everything else needs primary confirmation before it enters the corpus.

**Circle — primary developer documentation (`RESEARCH-P`)**
- [Agent Stack overview](https://developers.circle.com/agent-stack) · [Agent Wallets](https://developers.circle.com/agent-stack/agent-wallets) · [Agent Nanopayments](https://developers.circle.com/agent-stack/agent-nanopayments) · [Agent Marketplace](https://developers.circle.com/agent-stack/agent-marketplace)
- [Wallet signing and authorization models](https://developers.circle.com/wallets/signing-and-authorization-models) · [Transaction states and errors](https://developers.circle.com/wallets/asynchronous-states-and-statuses) · [Dev-controlled wallets](https://developers.circle.com/wallets/dev-controlled) · [Gas Station](https://developers.circle.com/wallets/gas-station) · [Transaction Screening](https://developers.circle.com/wallets/compliance-engine/tx-screening) · [Webhooks API reference](https://developers.circle.com/api-reference/webhooks)
- [Gateway technical guide](https://developers.circle.com/gateway/references/technical-guide) · [Gateway webhooks](https://developers.circle.com/gateway/webhooks) · [Nanopayments](https://developers.circle.com/gateway/nanopayments)
- [CCTP finality thresholds and fees](https://developers.circle.com/cctp/cctp-finality-and-fees) · [Paymaster](https://developers.circle.com/paymaster) · [CPN](https://developers.circle.com/cpn) · [Full documentation index](https://developers.circle.com/llms.txt)
- [Circle Skills — agent wallet policy (OTP gating)](https://github.com/circlefin/skills/blob/master/plugins/circle/skills/agent-wallet-policy/SKILL.md) · [Circle Skills — use agent wallet](https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-agent-wallet/SKILL.md) · [circlefin/skills](https://github.com/circlefin/skills)

**Arc — primary (`RESEARCH-P`)**
- [Arc Network](https://docs.arc.io/arc-chain) · [Deployment model](https://docs.arc.io/arc/concepts/deployment-model)

**x402 — primary (`RESEARCH-P`)**
- [x402 v2 specification](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md) · [exact scheme, EVM](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md) · [network and token support](https://docs.x402.org/core-concepts/network-and-token-support)

**Circle — announcements and blogs (`RESEARCH-S`)**
- [Introducing Circle Agent Stack](https://www.circle.com/blog/introducing-circle-agent-stack-financial-infrastructure-for-the-agentic-economy) · [Agent Stack product page](https://www.circle.com/agent-stack) · [AI infrastructure press release](https://www.circle.com/pressroom/circle-launches-ai-infrastructure-to-power-the-agentic-economy)
- [Gateway: redefining crosschain UX](https://www.circle.com/blog/circle-gateway-redefining-crosschain-ux) · [Practical guide to Gateway](https://www.circle.com/blog/a-practical-guide-to-building-with-circle-gateway) · [Nanopayments live on mainnet](https://www.circle.com/blog/nanopayments-powered-by-circle-gateway-is-now-live-on-mainnet) · [Nanopayments on testnet](https://www.circle.com/blog/circle-nanopayments-launches-on-testnet-as-the-core-primitive-for-agentic-economic-activity) · [Agentic systems on Arc](https://www.circle.com/blog/build-agentic-systems-for-high-frequency-sub-cent-transactions)
- [Refund Protocol](https://www.circle.com/blog/refund-protocol-non-custodial-dispute-resolution-for-stablecoin-payments) · [Introducing Paymaster](https://www.circle.com/blog/introducing-circle-paymaster) · [Gas Station launch](https://www.circle.com/blog/circle-launches-smart-contract-platform-gas-station) · [Gas-abstracted crosschain UX](https://www.circle.com/blog/building-a-gas-abstracted-crosschain-usdc-ux-with-gateway-and-gas-station) · [Autonomous payments with Wallets, USDC, x402](https://www.circle.com/blog/autonomous-payments-using-circle-wallets-usdc-and-x402)
- [Introducing Arc](https://www.circle.com/blog/introducing-arc-an-open-layer-1-blockchain-purpose-built-for-stablecoin-finance) · [Introducing xReserve](https://www.circle.com/blog/introducing-circle-xreserve) · [CPN core services](https://www.circle.com/blog/core-services-of-circle-payments-network-a-new-foundation-for-compliant-stablecoin-payments) · [CPN whitepaper](https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/PDFs/Whitepapers/CPN_Whitepaper.pdf) · [CCTP V2 whitepaper](https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/PDFs/Whitepapers/CCTPV2_White_Paper.pdf) · [ChainSecurity audit of Gateway contracts](https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/CCTP/[Public]%20[ChainSecurity]%20Circle_Gateway_audit.pdf)

**Third-party / news — treat as unverified (`RESEARCH-S`)**
- Arc mainnet timing: [Phemex](https://phemex.com/news/article/circle-unveils-arc-blockchain-whitepaper-mainnet-launch-set-for-summer-2026-82817) · [Decrypt on token/PoS exploration](https://decrypt.co/364295/circle-exploring-arc-network-token-proof-stake-shift-ceo) · [Imperator](https://www.imperator.co/resources/blog/what-is-arc-blockchain-circle%E2%80%99s-stablecoin-native-l1) · [Everstake](https://everstake.one/resources/blog/what-is-arc-network-circles-stablecoin-native-layer-1-explained)
- Compliance Engine launch: [The Block](https://www.theblock.co/post/317958/usdc-issuer-circle-unveils-new-compliance-tool-for-programmable-wallets)
- CCTP V2 mechanics: [Eco](https://eco.com/support/en/articles/11813797-circle-cctp-v2-native-usdc-across-13-chains) · [Sei](https://blog.sei.io/education/cross-chain-transfer-protocol-cctp-v2-native-usdc/)
- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004) — not a Circle product; relevant if cross-organization agent identity and reputation ever become a requirement. Deliberately **not** recommended here: agentOps' identity model is org-scoped and private, and a public onchain agent registry conflicts with the corpus's privacy invariants.

---

## Closing assessment

The architecture is unusually good at the thing most teams get wrong: it refuses to let a hopeful claim pass as proof. The five-truths separation, the non-terminal `unknown`, the three-part revocable certificate, and the counterevidence register are all correct and hard-won.

Its two real weaknesses are not technical. The first is that it has been designed for a customer nobody has confirmed exists, while implementation authority stays withheld — so the assurance layer keeps growing and the product does not. The second is that it consistently reaches for a software control in agentOps where Circle already offers a provider-enforced or cryptographic one. That second habit is why the maximum-loss story is weaker than it needs to be, and why the hardest invariant in the corpus — when may a reservation be released — is treated as unsolvable when on Circle it is a chain query.

Fix the reservation-release proof, move the reservation into a funded wallet, compile policy down into Circle's pre-submission limits, and bind `payTo` before signing. Those four moves make the product both smaller and stronger, and they turn three of the corpus's open ADRs into decided ones.

