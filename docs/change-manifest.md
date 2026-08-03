---
created: 2026-08-02
project: agentOps
ecosystem: [circle, arc]
tags: [change-manifest, migration, arc-hackathon, actionable]
status: actionable change list — not an explainer
---

# agentOps — Change Manifest

**What this is:** every change to make, in sequence. Each item says the exact flow being modified, what it is now, what it becomes, and what breaks if skipped.

**What this is not:** an explanation of the architecture. For that, see `current-architecture-and-userflow.md` (as-built), `checker.md` (design audit), `agentops-arc-plan-plain-english.md` (reasoning behind these choices).

**Legend:**
`[FLOW-CHANGE]` modifies an existing code path · `[NEW]` adds something that doesn't exist · `[FIX]` closes a confirmed defect · `[DECISION]` needs a human call before coding · `[VERIFY]` unconfirmed assumption, check before relying on it

---

# SECTION A — Pre-work: decisions and verifications that gate everything

Do these before writing code. Each one can invalidate work downstream.

| # | Item | Type | Why it gates |
|---|---|---|---|
| A1 | **Confirm sweep authority**: can the entity secret that created a wallet move funds *out* of it back to treasury? | `[VERIFY]` | The entire revocation story (C4) depends on this. Expected to work; unverified in our code. |
| A2 | **Confirm Circle dev-controlled wallets work on `ARC-TESTNET`** end to end (create → fund → transfer). | `[VERIFY]` | Docs list Arc-Testnet as supported; no code in our repo has ever exercised it. |
| A3 | **Decide: flip to developer-controlled wallets, or keep Agent Wallets?** | `[DECISION]` | This is *the* decision. Everything in Sections B–D assumes dev-controlled. See A3-note below. |
| A4 | **Decide: Arc-only, or Arc + existing 5 testnet chains?** | `[DECISION]` | Affects `circle_chain_capabilities` seeding and rail enum scope. Recommend Arc-only for the demo. |
| A5 | **Confirm Compliance/Transaction Screening API access** (sales-gated). | `[VERIFY]` | Gates E1 entirely. If denied, drop E1 rather than fake it. |
| A6 | **Decide scope: how much of agent-to-agent escrow ships vs. is prototyped?** | `[DECISION]` | Gates Section D sizing. |

**A3-note — the decision, stated concretely.** Current production path is hardcoded to Agent Wallets (`circle-org-provider.ts` → `createCircleAgentWalletTreasuryProvider`, no env branch). The dev-controlled implementation already exists (`circle-provider.ts:565-823`) but is unreachable. Flipping means: per-agent wallets become possible, OTP disappears from the loop, and **the org's existing Agent Wallet connection stops being the funding source** — the entity secret becomes it. Not flipping means Sections B, C, D are mostly impossible. Recommend flipping, Arc-testnet only, with the Agent Wallet path left intact behind the existing env flag for fallback.

---

# SECTION B — Per-agent wallets (the foundation)

Everything else depends on this. Currently every agent in an org shares ONE wallet; budgets are only Postgres numbers.

## B1 `[FLOW-CHANGE]` Agent creation now provisions a wallet

- **Flow today:** operator creates agent → row in `agents` → optional `wallet_refs` pointer → no real wallet exists for that agent.
- **Change to:** operator creates agent → row in `agents` → **create a dedicated Circle dev-controlled wallet on Arc** → persist its `circle_wallet_id` + address → link to the agent.
- **Where:** identity engine agent-creation path (`engines/identity/routes.ts`, `engines/identity/store.ts`); wallet creation belongs behind the Circle worker boundary, not in the public API process.
- **Note:** confirmed capacity — 10M wallets per wallet set, 200 per create-request, distinct address per chain per wallet.
- **If skipped:** no chain-enforced budgets, no sweep-revocation, no fleet allocation. Everything below collapses.

## B2 `[NEW]` Schema: per-agent wallet binding

- **Add:** a table (or columns on `agent_payment_accounts`) binding `agent_id` → `circle_wallet_id`, `address`, `chain`, `wallet_set_id`, plus `provisioned_at` and `swept_at`.
- **Do not** reuse `circle_chain_wallets` as-is — that table is keyed `(org_id, mode, chain)`, i.e. one wallet per org per chain. Per-agent needs a different grain.
- **Migration:** new file after `0020`.

## B3 `[FLOW-CHANGE]` Budget check reads chain balance, not just counters

- **Flow today:** `payRuntimeX402` (`engines/payments/store.ts:4839-4858`) checks `spent + reserved + amount > budget` — pure arithmetic on `agent_payment_accounts` numeric columns.
- **Change to:** keep the counter check as a *fast pre-filter*, then add the authoritative check: **does the agent's own wallet actually hold enough?** The counters become an optimization/bookkeeping layer; the wallet balance becomes the truth.
- **Why both:** counters give fast rejection and intent tracking; the balance gives the unforgeable ceiling.
- **If skipped:** the "provable max-loss" claim is false, and this is the single most important claim in the pitch.

## B4 `[FLOW-CHANGE]` Settlement pays from the agent's wallet, not the org's

- **Flow today:** `settleExactX402` / `settleGatewayX402` operate on the org's single connected Agent Wallet.
- **Change to:** operate on the *calling agent's* wallet — pass the agent's `circle_wallet_id` through the provider interface.
- **Where:** `circle-provider.ts` provider interface + `circle-org-provider.ts` scoping (currently org-scoped only; needs agent-scoping).
- **Interface impact:** `createOrgScopedCircleTreasuryProvider(connectionService, orgId)` becomes org+agent scoped. This is a signature change touching every call site.

---

# SECTION C — Treasury, top-up, and revocation

## C1 `[NEW]` Org treasury → agent wallet allocation

- **Add:** an allocation record per agent (`allocated_usdc`, `gas_reserve_usdc`, `low_water_mark`, `ceiling`), and a treasury-side funding source.
- **Invariant to enforce:** `sum(allocated across all agents) <= real org treasury deposits`. This is the solvency ceiling — the fleet's backbone.
- **Note:** the codebase already has an allocation/solvency concept to build on rather than inventing fresh.

## C2 `[NEW]` Auto top-up loop

- **Add:** a job type in the existing `circle_provider_jobs` table + handler in the existing worker poll loop (`circle-liquidity-worker.ts` — already polls every 5s with a per-org advisory lock). **This is an extension of existing machinery, not a new subsystem.**
- **Trigger:** agent wallet balance < low-water-mark → enqueue top-up job → worker funds it from treasury up to ceiling.
- **Circle has no built-in low-balance webhook or auto-rebalance** — confirmed absent from Gateway, Wallets API, and webhooks. We build this.
- **If skipped:** tight funding (B3) just means agents constantly run dry. C2 is what makes B viable.

## C3 `[NEW]` Gas headroom as a budget dimension — **Arc-specific, do not skip**

- **The fact:** on Arc, USDC *is* native gas — *"These are not two separate tokens — they share the same underlying balance."* Native is 18-decimals, ERC-20 view is 6-decimals, same pool.
- **Consequence:** an agent that spends to zero **cannot transact at all** — can't receive, can't be swept, can't do anything. Bricked.
- **Change to:** every allocation reserves a `gas_reserve_usdc` slice that budget checks (B3) treat as **unspendable**. Spendable = balance − gas reserve.
- **Also:** top-up (C2) must trigger on *spendable* balance, not raw balance.
- **Gotcha:** Arc's ERC-20 view **truncates** — a `balanceOf` of 0 does NOT mean zero native balance. Read native balance for gas decisions, not the ERC-20 view.
- **If skipped:** agents brick themselves in the demo. Nobody else handles this; it's a genuine differentiator.

## C4 `[NEW]` Revocation = sweep the wallet

- **Add:** a "revoke agent" action that (a) marks the agent's grant revoked, (b) **sweeps its wallet balance back to treasury**, (c) writes an audit event.
- **Depends on:** A1 (sweep authority verified).
- **Why it matters:** this is the answer to "what do you do at 3am" — one transaction, no OTP, no Circle policy API, no human. It's also the most dramatic live demo moment.
- **Sweep must leave gas:** paradoxically, sweeping requires gas, so sweep `balance − gas_needed_for_sweep`, or accept a dust remainder.

## C5 `[FIX]` Add a real kill switch

- **Today:** no emergency stop exists. Only narrow per-target rate-limit toggles (`operations/store.ts` `disableRateLimit`).
- **Change to:** an org-level and agent-level `frozen` flag checked **before every budget/policy evaluation**, plus optionally cascading to C4 sweeps.
- **Where:** earliest point in `payRuntimeX402` and the runtime routes, before any other check.

---

# SECTION D — Agent-to-agent commerce

## D1 `[FLOW-CHANGE]` Payment target can be another agent, not only a service

- **Today:** the x402 flow assumes the payee is an external service/resource.
- **Change to:** allow the payee to be another agent in the fleet (or an external agent), resolved via its wallet address.
- **Confirmed viable:** Nanopayments' only receiving-side requirement is *"an EVM wallet address where you want to receive USDC payments"* — no Circle registration or API key gates being paid.
- **Two structural constraints:** (a) the payee must expose an **HTTP endpoint** — it's request/response, not a wallet push; (b) **Nanopayments are EOA-only** (Gateway verifies signatures off-chain via `ecrecover`), so agent wallets must be EOA, not smart-contract accounts.

## D2 `[NEW]` ERC-8183 escrow job lifecycle — **use only where it earns its cost (see D2b)**

- **Add:** integration with the deployed ERC-8183 reference implementation on Arc testnet (`0x0747EEf0706327138c69792bF28Cd525089e4583` — verified proxy, impl `0xa316fd02...`).
- **Lifecycle to model:** `Open → Funded → Submitted → Completed | Rejected | Expired`. Roles: Client, Provider, **Evaluator**.
- **Map to our domain:** escrow-funded = our reservation held; `Completed` = reservation settles; `Rejected`/`Expired` = reservation releases.
- **Authorship (for accuracy):** ERC-8183 is **not a Circle standard.** Authors are Davide Crapis (Ethereum Foundation) with the **Virtuals Protocol** team. Arc is a deployment venue. Don't describe it as Circle's.
- **Known limits to design around:**
  - No arbiter/dispute role — the evaluator's decision is binary complete/reject, and the spec states *"reject/expire is final."* No appeals, no milestones, no evaluator slashing.
  - `setBudget` is callable by **client *or* provider** while `Open` (not provider-only). Because of that, always call `fund(jobId, expectedBudget)` — it reverts on mismatch, which is the spec's own front-running guard.
  - **Evaluator liveness is unhandled, and it's the sharpest trap.** If the evaluator goes silent while a job is `Submitted`, the only exit is `claimRefund` after expiry — which **refunds the client even though the work was delivered**. `Expired` behaves the same as `Rejected`, so "delivered but unevaluated" is indistinguishable from "failed." The provider structurally eats evaluator inaction.
  - The evaluator can `reject` while a job is merely `Funded` — i.e. kill it mid-work, before submission.
  - `deliverable` is `bytes32` and only **emitted in an event**, never stored on the job struct.
  - Hooks run client-supplied code in the state-change path — the spec itself flags this as a footgun with only `SHOULD`-level mitigations.
  - **No evidence of an audit** anywhere (spec, Arc docs, reference repo, discussion thread). Treat as unaudited.
- **Permit2 cannot fund it directly.** `fund()` does a plain `safeTransferFrom` and requires `_msgSender() == job.client`. Routing Permit2 in needs an adapter that *becomes* the client, which severs client identity from the real payer. The spec's sanctioned gasless path is ERC-2612/EIP-3009 + ERC-2771 instead — and Arc's USDC supports EIP-3009 natively.

## D2b `[DECISION]` When to use Permit2 vs escrow — the three-mode rule

**Why this rule exists.** Permit2 and ERC-8183 are not competitors; they solve different problems, and picking the wrong one either wastes gas or overstates safety.

**The plain-language difference:**

- **Permit2 protects the payer.** The money stays in the payer's wallet. The payer can cancel the authority instantly (`lockdown()`). The payee's risk is that the authority disappears before they collect.
- **ERC-8183 protects the provider.** The money moves into escrow *before* work starts, and the client **cannot** pull it back unilaterally. The provider can begin work knowing the funds genuinely exist.

**And the one thing Permit2 structurally cannot do:** Permit2 only understands two parties — the owner and the spender. It has no way to express *"someone who is neither the payer nor the payee decides whether the payee gets paid."* That third-party release key is ERC-8183's actual reason to exist.

### The rule

| Mode | Situation | Use | Why |
|---|---|---|---|
| **1** | Both agents are **inside our own fleet**, and the client can judge the work | **Permit2** | Trust already exists — both agents answer to the same treasury. Escrow would add ~5 on-chain transactions and per-job orchestration for **no trust gain**. One signature, many drawdowns, instant revoke. |
| **2** | Provider is **external/untrusted**, but the client can still judge the work | **ERC-8183 with `evaluator = client`** | The value here is **proof of funding before work starts** — not neutral arbitration. The provider gets certainty the money is real and can't be silently withdrawn. |
| **3** | Neither party trusts the other's **judgment** | **ERC-8183 with a genuine third-party evaluator** | The only configuration that exercises ERC-8183's real purpose. Requires an actual independent evaluator to exist. |

### Is `evaluator = client` legitimate?

**Yes — the spec explicitly sanctions it** (*"The evaluator can be the client... when there is no third-party attester"*), and it's the common case. It's correct whenever the client can genuinely judge the deliverable — a bought dataset either arrived and is usable, or it didn't. Inventing a neutral evaluator there adds a dependency and buys nothing.

**But be honest about what it degrades to.** With `evaluator = client`, ERC-8183 becomes *"a client-controlled hold with a refund timer."* The advertised provider protection largely evaporates, because the client is the one deciding whether to release. The provider's residual risk: client escrows, provider works, client rejects anyway — and there is **no dispute path**.

**Note for context:** Arc's own showcase job runs this degenerate mode — decoding `jobs(1)` on Arc testnet shows client and evaluator are the **same address**. So Arc's tutorial exercises none of the third-party attestation property. Don't treat it as a reference for trust-minimized use.

### Arc's own one-line rule, worth designing against

> *"If the transaction completes in a single HTTP round-trip, use x402. If it requires a work period, a deliverable, and an evaluation, use ERC-8183."*

### What this means for the demo

- **Intra-fleet hires → Permit2** (Mode 1). This is the demo's core path.
- **If we show ERC-8183 at all**, use it for an **external** provider in Mode 2, and describe its value accurately as *proof-of-funding before work begins* — **never** as neutral arbitration while running `evaluator = client`. That would be precisely the overclaim Section J exists to prevent.
- **Sub-cent, high-frequency payments → never escrow.** Five-plus state-changing transactions per job means orchestration and latency cost dominate the payment itself. Circle's own guidance for this tier is EIP-3009 + off-chain batching.

## D3 `[NEW]` ERC-8004 identity registration for agents

- **Add:** register each agent in Arc's IdentityRegistry (`0x8004A818BFB912233c491871b3d84c89A494BD9e`) — agent identity is an ERC-721 NFT via `register(agentURI, MetadataEntry[])`.
- **Registries:** Identity `0x8004A818...`, Reputation `0x8004B663...`, Validation `0x8004Cb1B...`.
- **Caveat:** these addresses appear only in Arc's **tutorials**, not in Arc's official contract-address reference page. Treat as testnet-tutorial-grade, and re-verify before relying on them.

## D4 `[NEW]` Payment-gated reputation — **the novel piece**

- **The gap:** ERC-8004's spec only forbids rating *yourself* (*"The feedback submitter MUST NOT be the agent owner or an approved operator"*). It does **not** require the rater to have paid or received anything. Any address can write feedback with zero proof of a real job. As shipped, the reputation number is close to meaningless.
- **Change to:** write ERC-8004 feedback **only** from an ERC-8183 `IACPHook.afterAction` hook firing on genuine `complete`. Reputation becomes earnable only by a real, settled, escrowed job.
- **Why it's defensible:** it's a property the standard lacks, no competitor implements it (Ampersand uses ERC-8004 as a read-only client and ships no reputation at all), and it's Arc-specific.

## D5 `[NEW]` Reputation → allocation feedback loop

- **Add:** agent reputation becomes an input to allocation (C1). Proven delivery history → larger allocation; failures → smaller.
- **Why:** this is the actual "real agent autonomy" claim — the fleet re-allocates its own capital from verifiable on-chain outcomes with no human touching numbers. Distinguishes the project from "an AI wrapper."

---

# SECTION E — Correctness fixes from `checker.md`, confirmed in code

These are confirmed defects, not hypotheticals. Each was verified against source.

## E1 `[FIX]` Policy must fail **closed**, not open — highest severity

- **Confirmed defect:** `decision-engine.ts:157-160` seeds the decision reduce with the literal `'allow'`. Zero matching rules → `matched` is empty → reduce never runs → **decision stays `allow`**. Reason code is `no_matching_policy`.
- **Change to:** default `deny` (or a configurable org-level default that defaults to deny), with an explicit, auditable opt-in for permissive mode.
- **Blast radius:** any action type with no authored rule is currently silently permitted. This is the single worst finding in the audit.

## E2 `[FLOW-CHANGE]` Evaluate policy **before** business checks, not after

- **Today:** in `payRuntimeX402`, rail/cap/budget/balance checks (steps 2–5) run *before* `enforceX402Policy` (step 6, `store.ts:4914`).
- **Change to:** policy first, then business rules. Rationale: policy is the authority; a denied action shouldn't be leaking budget-state information through differentiated error codes, and ordering should match the documented governing flow.
- **Note:** this is *not* the same as `checker.md`'s "egress before policy" P0 — that concern is about outbound network calls escaping before any gate. Verify separately whether any outbound fetch can occur before policy in the non-x402 runtime paths.

## E3 `[FIX]` Audit chain verification must cover the full history

- **Confirmed defect:** `audit-query.ts` `boundedLimit()` caps at **500**, defaults 100; `verifyAuditChain` only starts from genesis (`previousHash = null`) and the route (`evidence/routes.ts:93-104`) doesn't auto-paginate. For any org with >500 events, "chain valid" means "the first 500 are valid."
- **Change to:** (a) auto-paginate to cover the whole chain, and (b) add a **tail check** — verify the last event's hash matches `audit_event_heads.last_event_hash` and that event count reconciles with `last_sequence`. Without (b), deleting a suffix of rows and rewriting the head is undetectable.

## E4 `[FIX]` Approvals: separation of duties

- **Today:** `approveApproval` (`approvals/store.ts:366-432`) only requires role ≥ operator. Nothing prevents the person who triggered an action from approving it. No quorum for large amounts.
- **Change to:** (a) forbid self-approval (requester ≠ approver), (b) optional N-of-M quorum above a configurable threshold.

## E5 `[FIX]` Ledger: move from mutable counters toward append-only postings

- **Confirmed:** no `journal_entries`/ledger table exists in any of the 20 migrations. Money is tracked by `UPDATE ... SET spent_usdc = spent_usdc + $amount` on `agent_payment_accounts`, and `simulated_balance_usdc` on `payment_sources`.
- **Change to:** an append-only postings table where every economic event is a row and balances are *derived* by summation; corrections happen by appending an offsetting row, never by editing.
- **Scoping note:** full double-entry is likely out of scope pre-deadline. Minimum viable version: append-only postings with derived balances, keeping counters as a cache. State honestly which one shipped.

## E6 `[FIX]` Reservation release needs a principled rule

- **Today:** reservations are released manually/by timeout; there's no proof-based release, and no handling for an ambiguous (`unknown`) outcome.
- **Change to (Arc makes this easy):** Arc has **deterministic BFT finality, no reorgs** — *"no confirmation windows, no reorganization risk, and no probabilistic uncertainty."* So a settled payment on Arc is final the instant it's confirmed; no reorg branch needed. For genuinely ambiguous outcomes, use the death-predicate approach: an EIP-3009 authorization is **provably dead** once `block.timestamp > validBefore` AND `authorizationState(from, nonce) == false`. Release on proof, not on timeout.
- **Also:** because per-agent wallets (B) bound loss by balance, the "starvation loop" `checker.md` describes is far less dangerous — a stuck reservation can't threaten anything beyond that one agent's funded balance.

## E7 `[FIX]` Capture Circle/provider denials as first-class decisions

- **Today:** provider errors are read and dropped; a Circle `DENIED` looks like a generic adapter error.
- **Change to:** persist provider denials (with `errorReason`/`errorDetails`) as decision records in the audit trail, so evidence shows *why* nothing moved rather than "agentOps authorized" with no explanation.

## E8 `[FIX]` Bind `payTo` before signing — treat as security-critical

- **The risk:** in x402 the **server's 402 response** supplies `payTo`. A compromised/spoofed provider returns its own address and the agent signs it; after signing, amount and destination are cryptographically immutable, so the theft is irreversible.
- **Change to:** validate `payTo` against a pre-verified allowlist (marketplace-listed value, or a tenant-configured destination changed only under dual control) **before signing**. Refuse to sign on mismatch.
- **Silver lining worth stating:** post-signature, the destination fence is *cryptographic* — a stronger claim than software-only enforcement.

---

# SECTION F — Housekeeping (small, cheap, do them)

| # | Item | Type |
|---|---|---|
| F1 | Reconcile port docs: README says API on 8080, code default is 4010 (`config/env.ts:21`). | `[FIX]` |
| F2 | `packages/contracts` holds only ~45 lines of generic schemas; real payment/policy/identity wire types are hand-duplicated in web and api. Move the shared ones in, or document the drift risk. | `[FIX]` |
| F3 | Seed `circle_chain_capabilities` for Arc testnet (chain ID **5042002**, RPC `https://rpc.testnet.arc.io`, explorer `testnet.arcscan.app`). | `[NEW]` |
| F4 | Rail enum currently covers `gateway_*`/`exact_*` for base/arbitrum/polygon/optimism/avalanche. Add Arc, or scope to Arc-only per A4. | `[FLOW-CHANGE]` |
| F5 | `unknown` payment state has no worker or operator resolution flow. Add at minimum an operator-visible list of ambiguous attempts. | `[NEW]` |

---

# SECTION G — Distribution (post-architecture)

## G1 `[NEW]` Google ADK integration

- **What:** expose the existing MCP tool surface in the shape ADK expects, plus a working example agent.
- **Why cheap:** our MCP service already exposes the needed tools (`policy_check`, `payment_x402`, `approval_status`, etc.) as bearer-authenticated HTTP. This is a binding, not new architecture.
- **Honest scoping:** this is **adoption work, not architecture work.** Do not let it displace Sections B/C/E before the deadline.

## G2 `[NEW]` Agent-readable onboarding surface

- **What:** publish `llms.txt` / `skill.md` so agents can self-onboard without a human reading docs.
- **Why:** this is genuinely Ampersand's strongest distribution advantage (their `llms.txt` and `skill.md` are excellent and written *to* agents). Cheap to match.

---

# SECTION H — Build order

Ordered by dependency, then by leverage.

| Phase | Items | Outcome |
|---|---|---|
| **0** | A1–A6, **K-16, K-17** | Decisions made, assumptions verified, EOA pinned, chain ID reconciled. No feature code yet. |
| **1** | E1, C5 | **Fail-closed policy + kill switch.** Cheapest, highest-severity fixes. Do these first regardless of anything else. |
| **2** | B1, B2, B3, B4 | Per-agent wallets live. Max-loss claim becomes provable. |
| **3** | C1, C2, C3 | Fleet treasury + auto-topup + gas headroom. Makes phase 2 survivable. |
| **4** | C4 | Sweep-revocation. Best live demo moment. Tiny once phase 2 lands. |
| **5** | **K-13, K-14** | **Cross-chain via multi-chain funding (Option A).** Wallet + allocation grain becomes per-agent-per-chain. Cheap; unlocks the cross-chain demo. |
| **6** | E3, E4, E7, E8 | Audit/approval/security hardening. |
| **7** | D1, D2, D3 | Agent-to-agent escrowed payment. |
| **8** | D4, D5 | Payment-gated reputation → allocation feedback. The novel differentiator. |
| **9** | **K-15, K-18** | Just-in-time Gateway bridge (Option B) + replace the stubbed `bridgeWalletTopUp`. |
| **10** | E5, E6, F1–F5 | Ledger + reservation discipline + housekeeping. |
| **11** | E1(compliance), G1, G2 | Compliance screening, ADK, agent-readable docs. |

**Minimum coherent demo:** phases 1–4. **Add cross-chain:** phase 5 (cheap, high impact). **Minimum "agentic economy" story:** add 7–8. Phase 6 is what makes it credible to a security-minded judge.

---

# SECTION I — Hard constraints (do not violate)

Every one of these is verified from primary docs. Violating them in a submission is a credibility loss larger than the claim's gain.

1. **Arc mainnet does not exist.** Arc's docs: *"Arc is currently available on Testnet only."* No mainnet chain ID, no timeline. Circle's own skill: *"NEVER target mainnet -- Arc is testnet only."* Testnet chain ID is **5042002**.
2. **Arc Privacy Sector and post-quantum signatures are NOT live** — both documented as *"on the roadmap and not yet available."* Do not cite as capabilities.
3. **ERC-8004 and ERC-8183 are both Draft EIPs.** ERC-8183 created 2026-02-25 (~5 months old), one testnet implementation. Interfaces can change.
4. **Do not use Circle Paymaster on Arc.** Structurally redundant (USDC already *is* native gas — nothing to abstract) and 10% surcharge vs Gas Station's 5%. Circle's docs self-contradict here (Arc absent from the supported-chains table, yet live Arc addresses published) — treat as a docs bug, not clearance.
5. **Nanopayments (EOA-only) and Gas Station (SCA-required) are mutually exclusive.** Choose **EOA** — policy must run before the EIP-3009 signature anyway.
6. **No per-wallet spending-policy API exists on developer-controlled wallets.** All 29 endpoints enumerated; none is a policy/limit/allowlist endpoint. Spending policies exist only on Agent Wallets and are OTP-gated per change.
7. **No scoped-delegation primitive exists in Circle's stack.** Gateway's `addDelegate` is unscoped — blanket authority, no cap/recipient/expiry.
8. **Arc's ERC-20 USDC view truncates.** `balanceOf` returning 0 ≠ zero native balance. Also: Arc's blocklist is enforced **at runtime**, so a native transfer can revert despite sufficient balance; and per EIP-7708 every native movement emits an ERC-20 `Transfer` log (unlike standard EVM).
9. **Do not claim ERC-8004 reputation is trustworthy as-is.** It permits unearned feedback. Our contribution is gating it on settled escrow completion — describe it that way.

---

# SECTION J — Claim discipline

What may be said, and how.

| Claim | Say it like this |
|---|---|
| Max loss | "Bounded by the agent's on-chain balance — verifiable by RPC, no trust in us required." **Only true after B1–B4.** |
| Scoped delegation | **After `[K-8]`:** "The ceiling *and* the expiry are enforced on-chain by Permit2 — signed once, drawn down incrementally, revocable instantly by `lockdown()`, with unspent funds never leaving the payer's wallet." Finer-grained rules (which destinations, purpose) remain control-plane-enforced — still say so. |
| Payment scheme | "Lane 1 (external services) uses x402 `exact` via Circle's facilitator. Lane 2 (agent-to-agent) uses Permit2 ceiling+drawdown, exposed as an x402 `batch-settlement` binding." Name only these two — both are verified live on Arc. |
| vs. Ampersand | "Their limit is enforced in their server — the on-chain contract only checks that two signatures exist, not what the amount was. Ours is a balance anyone can read." |
| vs. Circle | "Circle needs a human with an email inbox for every policy change. We need nobody — and we're still more bounded, because our ceiling is the funded balance itself." |
| Fleet | "Cross-agent budget coordination with a solvency invariant." Ampersand markets swarm controls but ships none — say what we built, not what they lack. |
| Reputation | "Earned only by completing a real escrowed job — a property the standard itself does not require." |
| Escrow (if shown) | **If running `evaluator = client`:** "Escrow proves the funds exist and can't be silently withdrawn before the provider starts work." **Never** call that neutral arbitration — the client is the one deciding release. Only claim trust-minimized evaluation in Mode 3 with a genuine third party. See `[D2b]`. |
| ERC-8183 authorship | It's an Ethereum Foundation + **Virtuals Protocol** standard, not Circle's. Arc is a deployment venue. Also: Draft, and no evidence of an audit. |
| Network | Always "Arc testnet." Never imply mainnet. |
| Cross-chain | "An Arc agent can pay a Base agent autonomously — either pre-funded per chain, or bridged just-in-time by signing a burn intent on Arc and minting on Base in under a second, no human in the loop." **Never** claim a Gateway balance is spendable on any chain at payment time — Circle's own docs say *"source chain matters."* Say we *handle* the constraint, not that it doesn't exist. |
| Wallet type | Always EOA. Gateway rejects non-EOA signatures and Nanopayments is EOA-only. Don't claim gas sponsorship (needs SCA) and Nanopayments together — they're mutually exclusive. |

---

# SECTION K — The runnable fleet demo

**Purpose:** a fleet scenario a user can actually execute end-to-end on Arc testnet after the manifest above is built. Every step names the manifest items it depends on, so it doubles as an acceptance test.

## K.1 The scenario

An org runs a 5-agent fleet that produces a paid market-research report. One agent coordinates; four are specialists it must **hire and pay**. Four live on Arc; one deliberately lives on a different chain.

| Agent | Home chain | Role | Earns | Spends on |
|---|---|---|---|---|
| **Orchestrator** | Arc | Takes the job, hires specialists, assembles the report | From the end client | Paying the four specialists |
| **DataFetcher** | Arc | Sells raw data retrieval | From Orchestrator | External paid APIs (x402 services) |
| **Analyst** | Arc | Sells analysis of fetched data | From Orchestrator | Paying DataFetcher for extra data mid-task |
| **Writer** | Arc | Sells the final written report | From Orchestrator | Nothing (pure earner) |
| **SeniorReviewer** | **Base Sepolia** | Sells expert review of the finished report | From Orchestrator | Nothing (pure earner) |

**Why this shape works — three distinct payment cases in one run:**

1. **Hub → spoke** (Orchestrator paying specialists) — the basic case.
2. **Second-hop** (Analyst paying DataFetcher mid-task) — proves it's a real economy, not just a hub fanning out.
3. **Cross-chain** (Arc Orchestrator paying the Base SeniorReviewer) — the hardest case, and the one most systems can't do. See `K.1c`.

## K.1c The cross-chain case — an Arc agent paying a Base agent

**The scenario in one line:** the Orchestrator holds USDC on Arc. The SeniorReviewer runs an x402 endpoint that demands payment in **Base Sepolia** USDC. The Orchestrator's Base balance is **zero**.

### Why this is genuinely hard (and why "unified balance" doesn't save us)

The instinct is that Circle Gateway's "unified USDC balance" makes chains irrelevant. **It does not.** Circle's own guidance is explicit:

> *"Gateway does NOT do cross-chain transfers at payment time. Source chain matters."*
> *"Per source chain — no cross-chain pooling at payment time."*

So a Gateway balance deposited on Arc is an **Arc** balance. It cannot pay a Base-requesting seller in one step. Same for a plain wallet balance. **$10 on Arc + $0 on Base = $0 spendable on Base.**

Note also: dev-controlled wallets sharing a `refId` get the **same address** on every EVM chain — but the same address does *not* mean a shared balance. Balances are per-chain state. Convenient for addressing; irrelevant to spendability.

**Gateway's "unified balance" is a fast cross-chain *transfer* product, not a payment-time *abstraction* product.** Designing on the latter belief would break the architecture, so it is written down here explicitly.

### It is solvable, three ways

| Option | How it works | Latency at payment time | Cost | Verdict |
|---|---|---|---|---|
| **A — Multi-chain funding** | Give the agent a wallet on each chain it needs. Same address via `refId`; split the allocation (e.g. $7 Arc / $3 Base). | **Zero** — funds already there | Capital sits idle on the unused chain | **Simplest. Use for the demo.** |
| **B — Just-in-time bridge** | Keep float on Arc. On demand: sign a Gateway burn intent on Arc → get attestation → mint on Base. | **Sub-second mint**, after a one-time Gateway deposit | A transfer fee | **Best at scale.** Circle publishes an Arc→Base sample. |
| **C — CCTP directly** | Burn on Arc, poll Circle's attestation service, mint on Base. CCTP v2 is live on Arc (**domain 26**, TokenMessengerV2 `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`). | Slower — attestation polling | Gas both sides | Only for chains Gateway doesn't cover. |

### Option B is fully autonomous — verified, with Circle's own sample

Circle publishes a code sample titled *"burns from Arc Testnet and mints on Base Sepolia"* — **literally this scenario**. Three developer-controlled-wallet calls, **no human, no private keys, no OTP**:

1. **`signTypedData`** — Circle's MPC signs the EIP-712 `BurnIntent` on Arc. *(This confirms MPC can produce EIP-712 signatures — the thing that makes the whole path possible.)*
2. **`POST /v1/transfer`** to Gateway → returns `{attestation, signature}`
3. **`contractExecution`** — call `gatewayMint(bytes,bytes)` on Base Sepolia

Mint lands in **under 500ms**, at the same address on Base. The payment then proceeds as a normal same-chain payment.

**Prerequisite, once per wallet:** `approve` then `deposit(address,uint256)` into the Gateway contract. Circle frames this as *"wallet onboarding, not a per-call cost"* — it amortizes across all future payments. **Warning:** a plain ERC-20 transfer to the Gateway contract is **not** credited; the `deposit` function must be called.

### The recommended architecture

**A + B together.** Each agent's working float lives on its home chain (Arc). The org holds a Gateway reserve. Cross-chain bridging fires **just-in-time**, only when a seller demands a chain the agent isn't funded on. Common case costs nothing; rare case pays a fee instead of pre-fragmenting capital across five chains.

**For the demo:** use **Option A** — pre-fund the Orchestrator on both Arc and Base. Zero payment-time latency, no bridging risk, and the cross-chain *capability* is still demonstrated (an Arc-native agent paying a Base-native agent). Then show Option B's bridge as the scale story, since Circle's sample proves it works.

### Manifest deltas this introduces

| # | Item | Type | Note |
|---|---|---|---|
| **K-13** | Support per-agent wallets on **more than one chain** — same `refId` (shared address), separate per-chain balance and allocation rows | `[NEW]` | Required for Option A. Extends `[B2]`'s schema: the wallet-binding grain becomes `(agent_id, chain)`. |
| **K-14** | Allocation and top-up become **per-agent-per-chain**, not per-agent | `[FLOW-CHANGE]` | `[C1]`/`[C2]` currently assume one balance per agent. Each chain needs its own low-water mark and gas reserve. |
| **K-15** | Implement just-in-time Gateway bridge (Option B): `signTypedData` burn intent → `/v1/transfer` → `gatewayMint` via `contractExecution` | `[NEW]` | Post-demo unless time allows. Needs the one-time Gateway `deposit` per wallet first. |
| **K-16** | **Pin `accountType: 'eoa'` at wallet creation, and constrain the schema to EOA** | `[FIX]` | Gateway rejects non-EOA signatures (*"only EOA signatures are accepted… EIP-1271 signatures can't be accepted"*), and Nanopayments is EOA-only. Migration `0012` already relaxed the CHECK to permit SCA — re-tighten it for per-agent wallets so a mistake is rejected by the database, not discovered at payment time. |
| **K-17** | **Reconcile Arc's chain ID.** Manifest says `5042002` (from Arc's RPC docs); the live x402 facilitator returns `eip155:14601` for Arc | `[VERIFY]` | Two sources disagree. Confirm before hardcoding either — a wrong chain ID fails silently or signs against the wrong domain. |
| **K-18** | The dev-controlled provider's `bridgeWalletTopUp` is a **hard stub** (`developer_controlled_bridge_topup_not_supported`) | `[FIX]` | Flipping to dev-controlled wallets per `[A3]` **removes the only working cross-chain path in the codebase today** (the Agent Wallet path implements it via the CLI). Either implement `[K-15]` or explicitly accept the regression. |

## K.1d Design concerns raised in review, and how each is resolved

These came up while reviewing the per-agent-wallet approach. Each is a legitimate objection; each has a concrete answer. Recorded here so the reasoning isn't lost.

### Concern 1 — "Per-agent wallets mean managing a spend key per agent"

**Status: does not apply to developer-controlled wallets.**

With dev-controlled wallets there is **no per-agent key material at all**. One entity secret provisions up to **10 million wallets** per wallet set, and Circle's MPC performs every signature. The backend holds **one** secret whether the fleet has 1 agent or 1,000. No OTP, no per-agent credential, no key rotation per agent.

**Where the concern IS valid:** under the **Agent Wallet** model — which is what the codebase runs today — each wallet is bound to a human's email + OTP session. Per-agent wallets there would mean per-agent human logins, which is genuinely unworkable. That is a strong argument for flipping to dev-controlled per `[A3]`, not an argument against per-agent wallets.

### Concern 2 — "If Gateway pays for x402, the funds must be on the chain x402 demands"

**Status: correct, and it is the sharpest observation in the review.** Verified against Circle's own docs — see `K.1c`. Gateway does not pool across chains at payment time.

**Resolution:** Options A/B/C in `K.1c`. For the demo, Option A (multi-chain funding). At scale, A+B. This does not block per-agent wallets — it means the wallet grain is `(agent, chain)` rather than `(agent)`, which is `[K-13]`/`[K-14]`.

### Concern 3 — "With multiple payment adapters and chains, per-agent wallets don't scale"

**Status: real, and it is a genuine cost.** N agents × M chains multiplies both wallet count and idle capital. 5 agents × 5 chains = 25 wallets to fund, monitor, and top up.

**Resolution — three mitigations:**
- **Scope chains to what's actually needed.** The demo uses Arc + one foreign chain, not five. Per `[A4]`, Arc-only is the default; a second chain is added deliberately, to prove the cross-chain case.
- **Option B replaces breadth with depth** — one Gateway reserve plus just-in-time bridging beats pre-funding every agent on every chain.
- **Wallet creation is cheap and programmatic** (200 per API request), so the cost is *capital fragmentation*, not operational burden. Fragmentation is exactly what the fleet treasury `[C1]` and auto-topup `[C2]` exist to manage.

### Concern 4 — "Keep the treasury at org level, with spend policy checked in the policy database"

**Status: this is exactly what exists today, and it is the weakest available security position.**

With org-level wallets and database-only policy enforcement, **max loss equals the entire org treasury**, because there is no chain-level containment between agents. If the budget check has a bug or is bypassed, one agent can drain everything. And the safety claim is unprovable — "did this agent stay within its budget?" is answerable only as *"our database says so."* That is precisely the competitor weakness identified in Section J.

**Resolution — keep both layers, but move the ceiling:**

| Layer | Enforces | Where it lives |
|---|---|---|
| **Amount ceiling** | How much an agent can possibly spend | **The chain** — the funded wallet balance. Survives total compromise of our system. |
| **Fine-grained rules** | Which destinations, purpose, expiry, approval requirements | **The policy database** — unchanged, still necessary |

The policy DB does not go away; it stops being the *only* thing standing between an agent and the whole treasury. Org-level Gateway/exact wallets are still useful — as the **treasury and cross-chain reserve** that funds agent wallets — rather than as the wallets agents spend from directly.

## K.1b The payment scheme: Permit2 ceiling + drawdown — **this is the scoped delegation, with on-chain teeth**

### What we're using, verified live on Arc testnet (August 2026)

| Primitive | Address / endpoint | Status |
|---|---|---|
| **Permit2** — the delegation primitive | `0x000000000022D473030F116dDEE9F6B43aC78BA3` (canonical, 9152 bytes) | **CONFIRMED LIVE.** `DOMAIN_SEPARATOR()` responds; `allowance(owner,token,spender)` returns `(amount uint160, expiration uint48, nonce uint48)`. Arc docs: *"Universal contract for signature-based token approvals."* |
| **Circle facilitator** — external service payments | `https://gateway-api-testnet.circle.com/v1/x402/supported` | **`exact` scheme.** Arc = `eip155:5042002`, EIP-712 domain `GatewayWalletBatched`, verifying contract `0x0077777d7eba4688bdef3e311b846f25870a19b9`, `minValiditySeconds: 604800` (7 days — see `[K-11]`). |
| **ERC-8183** — optional escrow for delivery risk | `0x0747EEf0706327138c69792bF28Cd525089e4583` | Verified — upgradeable proxy, impl `0xa316fd02...`. Draft EIP; additive only. |

### Why Permit2 is the right choice

Permit2 is the **only** mechanism deployed on Arc today that gives a signed ceiling with incremental drawdown — and its properties map almost exactly onto the scoped-delegation requirement:

| Property | How Permit2 delivers it |
|---|---|
| **Signed ceiling** | `amount` (uint160) — a cap the human signs once |
| **Incremental drawdown** | The allowance **decrements** across many `transferFrom` calls. Not one-shot. |
| **Hard expiry** | `expiration` (uint48) — time-bounded authority, enforced on-chain |
| **Reclaim unspent** | **Trivial — funds never leave the payer's wallet.** Reclaim is `lockdown()` or re-permit. No thawing period, no capital parked elsewhere. |
| **No overdraw** | Cap is enforced on-chain; nonce ordering blocks replay |
| **Revocation** | `lockdown()` — immediate, on-chain, no OTP, no third party |

**Why this is better than escrow for our use case, not a consolation prize:** because funds stay in the payer's wallet, the **on-chain balance remains the hard ceiling** — which is exactly the chain-enforced bound from Section B. Permit2 adds *scoped, per-counterparty, expiring* delegation **on top of** that bound without moving capital anywhere. Escrow would park funds in a third-party contract and add a reclaim delay.

**The honest tradeoff:** because funds remain with the payer, the **payee carries collection risk** — the payer could spend that balance elsewhere before the payee draws. Inside a fleet whose payer spending we already gate, that is the correct place for the risk to sit. Seller-side guarantees are what escrow (`[D2]`) is for — use it only where delivery risk genuinely warrants it.

### How this maps onto x402 — we stay spec-aligned

The **`batch-settlement`** spec explicitly blesses this pattern under its **capital-backed** trust model:

> *"Delegated authorization. A client delegates spending authority to an operator against their wallet balance."*

So: implement Permit2 ceiling + our own drawdown accounting, expose it as a **`batch-settlement` binding**. That is spec-aligned rather than off-spec. Doing so obliges us to publish the **7 mandatory binding items**: commitment format, verification, storage, double-spend prevention, expiry, redemption, and trust model.

### Two-lane payment design for the demo

| Lane | Rail | Scheme | Used for |
|---|---|---|---|
| **Lane 1 — external services** | Circle Nanopayments / Gateway | `exact` (Circle's only option) | Agents buying from external paid APIs. Sub-cent capable. **EOA-only.** |
| **Lane 2 — agent-to-agent** | Permit2 on Arc + our drawdown accounting | `batch-settlement` binding | Orchestrator→specialist and Analyst→DataFetcher payments |

Lane 2 is where the differentiation lives: a human signs **one** Permit2 ceiling per agent pair, and the paying agent draws against it incrementally at machine speed, with the remainder reclaimable at any moment and a hard expiry.

### Two hard boundaries to respect

- **Circle's facilitator supports `exact` only** — live-probed across all its networks. Lane 1 has no other option; design around it rather than expecting more.
- **Nanopayments is EOA-only** (Gateway verifies signatures off-chain via `ecrecover`). Agent wallets must be EOA, not smart-contract accounts. Reconfirms constraint I.5.

### Manifest deltas this introduces

| # | Item | Type | Note |
|---|---|---|---|
| **K-8** | Add Permit2 integration: sign `PermitSingle`, track allowance state, call `transferFrom` on drawdown, `lockdown()` on revoke | `[NEW]` | This *is* the scoped-delegation implementation. Supersedes the vaguer "signed grant" in `[4.2]` — the grant becomes a real Permit2 signature with on-chain teeth. |
| **K-9** | Publish the `batch-settlement` binding doc (7 mandatory items) | `[NEW]` | Keeps us spec-aligned and is a credibility artifact for judges. |
| **K-10** | Pin x402 tooling to `x402-foundation/x402` | `[FIX]` | This is the canonical repo. `coinbase/x402` still resolves but is stale. |
| **K-11** | Handle Circle's 7-day `minValiditySeconds` on Arc `exact` authorizations | `[DECISION]` | A 7-day exposure window is long. Decide whether Lane 1 is acceptable for large amounts or should be capped to small/sub-cent payments only. |
| **K-12** | Verify agent EOA wallets can call Permit2 `approve` and that Permit2 can pull native-USDC on Arc | `[VERIFY]` | Arc's USDC is the native gas asset exposed via an ERC-20 view that **truncates** — confirm Permit2 interacts correctly with it. **Blocks Lane 2 — test this first.** |

## K.2 Prerequisites checklist

Before the demo can run, all of these must be true. Manifest item in brackets.

**Infrastructure**
- [ ] Arc testnet reachable — **chain ID reconciled** between Arc's docs (`5042002`) and the x402 facilitator (`eip155:14601`) `[F3, K-17]`
- [ ] Arc rail present in the rail enum + `circle_chain_capabilities` seeded `[F3, F4]`
- [ ] **Base Sepolia** also seeded (already in the existing chain list) — needed for the cross-chain hop `[K-13]`
- [ ] Circle dev-controlled wallets verified working on `ARC-TESTNET` end-to-end `[A2]`
- [ ] `CIRCLE_TREASURY_PROVIDER` decision made and wired into the *real* worker path `[A3]`
- [ ] **Wallets provisioned as EOA, schema constrained to EOA** `[K-16]`
- [ ] Org treasury holds testnet USDC (faucet-funded), enough for all allocations + gas reserves

**Core capability**
- [ ] Per-agent wallet provisioning on agent creation `[B1, B2]`
- [ ] Budget check reads chain balance, not only counters `[B3]`
- [ ] Settlement pays from the calling agent's own wallet `[B4]`
- [ ] Allocation records + solvency invariant enforced `[C1]`
- [ ] Auto-topup job type live in the worker loop `[C2]`
- [ ] Gas headroom reserved and treated as unspendable `[C3]`
- [ ] Sweep-revocation working, verified `[A1, C4]`
- [ ] Kill switch checked before every evaluation `[C5]`
- [ ] Policy fails **closed** `[E1]`

**Cross-chain**
- [ ] Per-agent wallets support multiple chains, same `refId`/address, separate balances `[K-13]`
- [ ] Allocation + top-up are per-agent-**per-chain** `[K-14]`
- [ ] Orchestrator funded on both Arc and Base (Option A) `[K-13]`
- [ ] *(Stretch)* Just-in-time Gateway bridge working `[K-15]`
- [ ] Aware that `bridgeWalletTopUp` is stubbed in the dev-controlled provider `[K-18]`

**Agent-to-agent**
- [ ] Payee can be another agent, resolved by wallet address `[D1]`
- [ ] Agent wallets are **EOA** (not SCA) — Nanopayments requirement `[D1, constraint I.5]`
- [ ] Each specialist agent exposes an **HTTP x402 endpoint** (see K.7 — gap) `[D1]`
- [ ] **Permit2 integration working**: sign ceiling, drawdown, `lockdown()` `[K-8]`
- [ ] **Permit2 verified against Arc's native-USDC ERC-20 view** `[K-12]`
- [ ] `batch-settlement` binding documented `[K-9]`
- [ ] x402 tooling pinned to `x402-foundation/x402` `[K-10]`
- [ ] ERC-8183 escrow job lifecycle integrated `[D2]`
- [ ] ERC-8004 identities registered for all 4 agents `[D3]`
- [ ] Reputation written only from the escrow completion hook `[D4]`
- [ ] Reputation feeds allocation `[D5]`

## K.3 Setup (one-time, human-driven)

| # | Step | What actually happens | Depends on |
|---|---|---|---|
| 1 | Operator signs in, creates org | Google OAuth → opaque session in `auth_sessions` | *exists today* |
| 2 | Operator funds org treasury with testnet USDC | Faucet → treasury wallet on Arc | `[A2, F3]` |
| 3 | Operator creates 5 agents in the console | Each gets its **own Circle dev-controlled EOA wallet**; four on Arc, SeniorReviewer on Base. Wallet id + address persisted per chain. | `[B1, B2, K-13, K-16]` |
| 3b | Orchestrator additionally gets a **Base** wallet (same address via `refId`) | Enables the cross-chain hop without bridging (Option A) | `[K-13]` |
| 4 | Operator sets allocations — e.g. Orchestrator $15 Arc + $5 Base, others $5 each | Allocation rows written **per agent per chain**; **solvency check rejects if total > treasury deposits** | `[C1, K-14]` |
| 5 | Each allocation reserves gas headroom (e.g. $0.50) | Recorded as unspendable; spendable = balance − reserve | `[C3]` |
| 6 | **Operator signs a Permit2 ceiling per paying-agent pair** (amount + expiration) | On-chain scoped allowance: cap that decrements, hard expiry, unspent stays in payer's wallet, revocable by `lockdown()` | `[K-8, K-12]` |
| 7 | Agents get registered in ERC-8004 IdentityRegistry | On-chain NFT identity per agent | `[D3]` |
| 8 | Operator issues each agent an MCP credential | Bearer credential → `connection_credentials` | *exists today* |

**Verification at end of setup:** four distinct Arc addresses each holding exactly their allocation, visible on `testnet.arcscan.app`. **This is the "provable max-loss" moment — anyone can read those balances without trusting us.**

## K.4 The run (autonomous, no human)

| # | Step | What actually happens | Depends on |
|---|---|---|---|
| 1 | End client submits a research request to Orchestrator | Job created | `[D2]` |
| 2 | Orchestrator hires DataFetcher — **draws against its Permit2 ceiling** (Lane 2) | Allowance decrements on-chain; USDC moves payer→payee directly; no escrow, no capital parked | `[K-8, D1]` |
| 3 | DataFetcher buys external data via x402 `exact` (Lane 1) from a real paid endpoint | Real testnet USDC leaves DataFetcher's own wallet via Circle's facilitator; policy evaluated first | `[B3, B4, E2]` |
| 4 | DataFetcher hits its low-water mark | Auto-topup job enqueued → worker refills from treasury, up to ceiling, respecting solvency | `[C2, C1]` |
| 5 | Orchestrator hires Analyst — second Permit2 drawdown | Allowance decrements again; running remainder visible on-chain | `[K-8]` |
| 6 | **Analyst pays DataFetcher directly** for extra data mid-task | **Second-hop agent-to-agent payment** — the key moment. Its own Permit2 ceiling, independent of the Orchestrator's. | `[K-8, D1]` |
| 7 | Orchestrator hires Writer; report delivered | Third drawdown; job complete | `[K-8]` |
| 8 | **Orchestrator hires SeniorReviewer on Base** — the cross-chain hop | SeniorReviewer's `402` demands **Base Sepolia** USDC. Orchestrator pays from its **Base** wallet (same address as its Arc one, funded separately per Option A). Payment settles on Base while the rest of the fleet runs on Arc. | `[K-13, K-14, K-16]` |
| 8b | *(Stretch — Option B instead of A)* Orchestrator's Base balance is empty, so it **bridges just-in-time** | `signTypedData` burn intent on Arc → Gateway `/v1/transfer` → `gatewayMint` on Base. Sub-second mint, then pays. **No human anywhere.** | `[K-15]` |
| 9 | *(If `[D2]` shipped)* One hire runs through **ERC-8183 escrow** instead, to show delivery-risk handling | `Open → Funded → Submitted → Completed`; escrow releases | `[D2]` |
| 10 | *(If `[D4]` shipped)* Completion hook writes ERC-8004 reputation | Reputation earned only from a settled escrow completion | `[D2, D4]` |
| 11 | Reputation/history differs across agents | Allocation loop widens budgets for reliable agents, narrows for failures | `[D5]` |

**Note the ordering change:** Permit2 drawdown (Lane 2) is now the **primary** agent-to-agent mechanism, and ERC-8183 escrow is an **additive** step for the one case where delivery risk matters. This is deliberate — Permit2 is confirmed live on Arc, whereas escrow depends on a Draft EIP and unverified funding mechanics `[K-5]`. The demo's core no longer rests on the riskiest dependency.

## K.5 The three moments that prove the architecture

Run these deliberately — each is a claim from Section J made visible.

**Moment 1 — The chain-enforced ceiling.**
Instruct an agent to spend more than its allocation. It fails. Then show *why*: the wallet balance on the block explorer. Say: *"That's not our software refusing. The money isn't there. Verify it yourself."*
→ Requires `[B1, B3]`

**Moment 2 — Revocation at machine speed, two ways.**
Mid-run, revoke one agent. Show **both** levers firing: (a) Permit2 `lockdown()` kills its delegated spending authority on-chain instantly, and (b) its wallet is **swept back to treasury**. Show the allowance go to zero and the balance drain, both on the explorer. Say: *"No OTP. No email. No Circle policy API. Two on-chain calls, and it works at 3am."*
→ Requires `[A1, C4, C5, K-8]`

**Moment 2b — The scoped ceiling, drawn down live.**
Show a Permit2 allowance decrementing across successive agent-to-agent payments, then reclaim the unspent remainder — and point out the funds never left the payer's wallet, so there's no thawing period and no capital parked in anyone's contract. Say: *"One signature authorized a ceiling. The agent drew against it at machine speed. The remainder is still ours, reclaimable right now."*
→ Requires `[K-8, K-12]`

**Moment 3 — Earned reputation changing capital allocation.**
Show one agent's reputation rose only after a **settled escrow completion**, and that its allocation grew as a result — with no human touching a number. Say: *"The standard lets anyone write reputation with no proof. Ours can only be earned by completing a real, paid job."*
→ Requires `[D2, D4, D5]`

**Moment 4 — the cross-chain hop.**
Show the Arc-native Orchestrator paying the Base-native SeniorReviewer, and show the settlement on **Base's** explorer while the rest of the fleet's activity sits on **Arc's**. Say: *"Chains are not fungible at payment time — a Gateway balance on Arc cannot pay a Base seller, whatever 'unified balance' suggests. We fund per agent per chain, and where a balance is missing we bridge just-in-time: sign a burn intent on Arc, mint on Base in under a second, no human in the loop."*
→ Requires `[K-13, K-14, K-16]` (Option A) or `[K-15]` (Option B, stronger)

**Optional Moment 5 — the Arc-specific one.**
Let an agent spend to near-zero and show the gas reserve keeping it alive. Say: *"On Arc, USDC is gas — same balance. An agent that spends to zero is bricked; it can't even be swept. We reserve gas headroom as a budget dimension. Nobody else handles this."*
→ Requires `[C3]`

## K.6 Fallback ladder (if pieces aren't ready by deadline)

Degrade in this order — each tier still demonstrates something real. **Always state which tier is running.**

| Tier | What runs | Still proves |
|---|---|---|
| **Full** | K.4 complete, all moments | Everything |
| **T1** | Drop `[D5]` reputation→allocation; reputation written but allocation manual | Escrow + earned reputation |
| **T2** | Drop `[D4]`; escrow completes, no reputation write | Escrowed agent-to-agent payment |
| **T2b** | Drop `[K-15]` JIT bridge; cross-chain via **pre-funding both chains** (Option A) | **Cross-chain agent-to-agent payment** still fully demonstrated |
| **T3** | Drop `[D2]` escrow entirely; **agent-to-agent runs purely on Permit2 drawdown** | **Scoped on-chain delegation + A2A payment + per-agent wallets + fleet treasury.** No Draft EIPs involved. |
| **T3b** | Drop the cross-chain agent; Arc-only fleet | Everything except cross-chain. Falls back to `[A4]`'s Arc-only default. |
| **T4** | Drop `[D1]` A2A; agents pay external services only via Lane 1 `exact` | Per-agent wallets, chain-enforced budgets, auto-topup, gas headroom, sweep-revocation |
| **Floor** | Phases 1–4 only | Provable max-loss + instant revocation. **Still a genuinely strong story.** |

**T3 is now the tier worth targeting, and it's a meaningful upgrade over the previous plan.** Because Permit2 is confirmed live on Arc, T3 delivers *real scoped on-chain delegation with incremental drawdown and instant revocation* — the thing originally asked for — while depending on **zero Draft EIPs and zero unverified escrow mechanics**. T4 remains the honest floor if Permit2 integration `[K-12]` hits problems.

## K.7 Gaps this demo needs that are NOT yet in the manifest

Adding these to the manifest — the demo cannot run without them.

| # | Gap | Type | Why needed |
|---|---|---|---|
| **K-1** | **Each specialist agent must run an HTTP x402 endpoint.** Nanopayments/x402 are request/response — you cannot push USDC to an idle agent's wallet and have it "receive a job." Every earning agent needs a reachable paid endpoint. | `[NEW]` | Without this, agent-to-agent payment is structurally impossible. This is real work, not config. |
| **K-2** | **Which of the three modes is each payment in?** Resolved by the rule in `[D2b]` — Mode 1 (intra-fleet → Permit2), Mode 2 (external provider, `evaluator = client` → escrow as proof-of-funding), Mode 3 (mutual distrust → third-party evaluator). Two things still to decide: whether the demo shows Mode 2 at all, and — if agentOps ever acts as evaluator — disclosing that it thereby gains quasi-custodial power over escrowed funds. | `[DECISION]` | Gates `[D2]` scope. See `[D2b]`. |
| **K-3** | **Agent runtime harness.** The demo needs 4 actual running agent processes with decision logic. Our MCP surface is the *interface*; the agents themselves don't exist. | `[NEW]` | This is the "real agent autonomy" the judging bar asks for. Do not underestimate it. |
| **K-4** | **Arc testnet USDC faucet path.** Confirm how to fund the treasury, and whether existing `requestTestnetFunds` works on Arc. | `[VERIFY]` | No funding, no demo. |
| **K-5** | **Escrow contract funding source.** ERC-8183 escrow holds real USDC — confirm whether the escrow pulls from the agent's wallet (needs approval) or requires a push, and that agent wallets can `approve` on Arc. | `[VERIFY]` | Blocks `[D2]`. |
| **K-6** | **Reputation → allocation formula.** `[D5]` says reputation widens budgets but no rule is defined. Needs a concrete, bounded, auditable function (and a floor/ceiling so it can't runaway). | `[DECISION]` | Blocks `[D5]`. An unbounded feedback loop on real money is dangerous. |
| **K-7** | **Demo reset/idempotency.** Judges may run it twice. Needs a clean-slate path (new org, fresh wallets) that doesn't collide with prior state — note the unique-seed-hash gotcha in the existing test env. | `[NEW]` | Practical necessity for a live demo. |

## K.8 Realistic effort read

The honest assessment, given the deadline:

- **K-3 (agent runtime harness) is the largest hidden cost.** Everything in Sections B–E is control-plane work on an existing codebase. K-3 is building four agents that make real decisions — a different kind of work, and the thing judges actually watch.
- **K-1 (x402 endpoints per agent) is the second.** It's not config; each earning agent becomes a small paid HTTP service.
- Sections B + C (per-agent wallets, treasury, topup, gas, sweep) are the highest-confidence items — they extend machinery that already exists (job table, worker loop, advisory locks, allocation concept).
- **`[K-8]` Permit2 integration is moderate effort and high confidence** — the contract is verified live on Arc at its canonical address, and the interface is small (`PermitSingle` signing, `transferFrom`, `lockdown`). The one real unknown is `[K-12]`: whether Permit2 interacts cleanly with Arc's native-USDC ERC-20 view, which **truncates**. Test this early; it gates Lane 2.
- Section D (escrow + reputation) carries the most external risk: two Draft EIPs, addresses published only in tutorials, and unverified escrow funding mechanics `[K-5]`.
- **Cross-chain via Option A (`[K-13]`/`[K-14]`) is cheap** — it's a schema-grain change (wallet and allocation become per-agent-per-chain) plus creating a second wallet. No new protocol work. **Option B (`[K-15]`) is a genuine build**: three-step bridge orchestration plus a one-time Gateway deposit per wallet. Do A for the demo; treat B as the scale story unless time is abundant.
- **`[K-16]` (pin EOA) and `[K-17]` (reconcile Arc's chain ID) are near-zero effort and both fail confusingly if skipped.** An SCA wallet breaks Gateway signing at payment time rather than at creation; a wrong chain ID signs against the wrong domain. Do both in phase 0.

**Recommendation (revised):** build to **T3** — per-agent wallets, fleet treasury, auto-topup, gas headroom, sweep-revocation, **plus Permit2 scoped delegation with drawdown for agent-to-agent payment**. That combination delivers the original "scoped delegation" goal with genuine on-chain teeth, needs no Draft EIPs, and carries all three strongest claims (provable max-loss, scoped revocable delegation, instant revocation). Add `[D2]` escrow → `[D4]` reputation → `[D5]` allocation feedback only as time allows.

**Verify `[K-12]` first.** If Permit2 can't handle Arc's native-USDC view, Lane 2 falls back to per-payment `exact` authorizations and the target tier drops to T4 — better to learn that on day one than on Aug 8. Decide the final tier by **Aug 7** so the video and deck describe what actually runs.
