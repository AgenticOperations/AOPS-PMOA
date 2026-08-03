# agentOps Arc Build — Scope, Cuts, and Phase Index

> **For Claude:** This is the index document. Each phase has its own executable plan file. Read this first for the scope rules, then execute the phase files in order using superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Build per-agent chain-enforced budgets, scoped on-chain delegation, and agent-to-agent payment on Arc testnet — reaching tier T3 of the change manifest.

**Baseline:** branch `kc/a2a-imple`, commit `349b4e1`. 66,345 LOC, 21 migrations, 79 test files.

---

# PART 1 — The scope rule (read before writing any code)

**The rule:** *Only change existing code when a required functionality is missing or wrong. Never rewrite a working flow because a better approach exists.*

Concretely, that means:

| Do | Don't |
|---|---|
| Add a check that doesn't exist | Rewrite a check that works |
| Add a column/table for new functionality | Normalize a schema that functions |
| Extend an enum to admit Arc | Redesign the enum |
| Give dead code a call site | Refactor live code around it |
| Reuse Postgres/Redis machinery already wired | Introduce new infrastructure "because it scales" |

**On infrastructure specifically:** if it works in Postgres today, it stays in Postgres. Do not add caching layers, queues, or new services as part of this build. Performance work is a later, separate concern — and premature optimization here costs deadline time and adds failure modes to paths that currently work.

---

# PART 2 — What I CUT from the previous plan (and why)

These were in `docs/implementation-plan.md`. Each is efficiency/refactor work, not functionality. **All are removed.**

## CUT-1 — "Move shared wire types into `packages/contracts`" (was M20 / manifest F2)

**Was:** F2 said contracts holds only 45 lines of generic schemas while real payment/policy/identity types are hand-duplicated in web and api; move the shared ones in.

**Verified:** `packages/contracts/src/index.ts` is exactly 45 lines. It is imported by **exactly one file** — `apps/api/src/app.ts:3` (`healthResponseSchema`). **`apps/web` does not import it at all.**

**Why cut:** this is a pure restructuring of code that works. Nothing is broken; types are merely duplicated. Moving them touches both apps, risks type drift during the change, and delivers zero new functionality. The drift risk F2 worries about is real but *latent* — it has not caused a defect.

**Verdict: CUT.** If you want the drift documented, that is a one-line comment, not a milestone.

## CUT-2 — "Reconcile the port docs" (was M20 / manifest F1)

**Was:** README says API on 8080 in four places; `env.ts:199` defaults `PORT` to 4010; `env.ts:200` defaults `publicApiBaseUrl` to `http://localhost:8080`.

**Verified:** all true.

**Why cut:** this is a **documentation** inconsistency. Deployments set `PORT` explicitly (the README's own runbook does). Nothing functionally breaks. Fixing the README is fine as a 2-minute chore whenever someone is already in that file — it is not a milestone and it does not need TDD steps.

**Verdict: CUT from the build plan.** Fix opportunistically.

## CUT-3 — "Fix the advisory lock key hardcoding `test` mode"

**Was:** M10 noted `circle-org-lock.ts:18` builds `circle:test:${orgId}`, so live-mode jobs would share the test-mode lock.

**Verified:** true.

**Why cut:** the entire build targets **Arc testnet**, and manifest constraint I.1 forbids targeting mainnet at all ("Arc is currently available on Testnet only"). In test mode this lock is *correct*. It is a latent issue for a two-mode deployment that this project will not have before the deadline.

**Verdict: CUT.** Record it as a known limitation. Fixing it now is changing working code for a scenario that cannot occur.

## CUT-4 — "Improve Circle DENIED error granularity" (manifest E7)

**Was:** manifest claimed provider denials are read and dropped. My verification **refuted** that — `DENIED` is thrown (`circle-provider.ts:747-748`) and persisted via `errorReason` → `error_code` columns. I had demoted it to "improve granularity."

**Why cut:** "improve granularity" is precisely the category you asked me to remove. Denials **are** captured and **are** auditable today. Making the error string structured is a nicety.

**Verdict: CUT entirely.** The manifest item was based on a false premise.

## CUT-5 — "Split `store.ts`" (implied by the risk register)

**Was:** flagged that `store.ts` is 5,875 lines and is the highest-churn file.

**Why cut:** the skill's file-structure guidance says *"if the codebase uses large files, don't unilaterally restructure."* Splitting a 5,875-line file that works, mid-deadline, on the critical path, is the highest-risk-lowest-reward change available.

**Verdict: CUT the split.** Keep the *sequencing* mitigation (M7 and M12 edit the same function — don't parallelize them). That costs nothing.

## CUT-6 — Redis caching as "new work" in M7

**Was:** M7 said "cache balance reads with a short TTL; a hot path cannot do an RPC round-trip per check."

**Verified:** Redis is **already wired** — `apps/api/src/server.ts:19` constructs it, `balances-cache.ts` implements `read/write/invalidateCachedBalances` with a 25s TTL, and it degrades gracefully when Redis is absent (`if (redis === undefined) return null`).

**Why this is NOT cut, but must be reframed:** using the existing cache is *reuse of wired infrastructure*, not new infrastructure. But M7 must not **build** anything cache-shaped. If the existing helper fits, call it. If it does not fit the per-agent grain, **read the balance directly** and move on — do not build a new cache.

**Verdict: KEPT, reframed.** Explicitly forbidden from adding cache infrastructure.

---

## Things I deliberately did NOT cut (they look like refactors but are functionality)

| Item | Why it stays |
|---|---|
| **E2 — policy before business checks** (M12) | Not a reordering for elegance. Today money is **reserved** (`store.ts:4935-4961`) before policy is consulted (`:4976`). A denied action mutates `reserved_usdc` before being denied. That is a functional defect. |
| **E1 — fail-closed policy** (M1) | Changes behavior: unauthored action types are silently permitted today. |
| **E3 — audit chain pagination** (M13) | Not "make verification faster." An org with >500 events **cannot be fully verified today** — the capability is absent. |
| **F5 — `unknown` resolution** (M10) | `finalizeUnknown` has no production call site; `unknown` attempts **permanently strand** `reserved_usdc`. A live fund leak. |
| **M7 — balance-backed budget** | The core claim. Counters stay; the balance check is *added* alongside. |

---

# PART 2b — Manifest traceability matrix

Every one of the change manifest's 47 items, and where it went. **Nothing is dropped and nothing is deferred indefinitely** — each item is either BUILT (Phases 0–6, the T3 target) or SEQUENCED (Phases 7–9, built immediately after T3 lands). Only 3 items are CUT, each for the reasons in Part 2.

**Status key:**
- **BUILT** — in Phases 0–6. This is the T3 tier the manifest recommends.
- **SEQUENCED** — in Phases 7–9. Same TDD rigour, same acceptance criteria; they run after T3 because they depend on it or carry external risk.
- **CUT** — removed as efficiency/refactor work. Three items only.

## Section A — Pre-work

| Item | Status | Where |
|---|---|---|
| A1 sweep authority | BUILT | Phase 0 · S3 |
| A2 dev-controlled on Arc | BUILT | Phase 0 · S2 |
| A3 flip to dev-controlled | BUILT | Phase 0 decision + Phase 2 · Task 1 |
| A4 Arc-only vs multi-chain | BUILT | Phase 0 decision (Arc + Base Sepolia) |
| A5 compliance screening | BUILT | Phase 0 · S7 (drop if denied) |
| A6 escrow scope | BUILT | Phase 0 decision (→ none in T3) |

## Section B — Per-agent wallets

| Item | Status | Where |
|---|---|---|
| B1 agent creation provisions a wallet | BUILT | Phase 3 · Tasks 2, 3 |
| B2 schema: per-agent wallet binding | BUILT | Phase 3 · Task 1 (`agent_chain_wallets`, migration 0025) |
| B3 budget reads chain balance | BUILT | Phase 3 · Task 4 |
| B4 settlement pays from agent's wallet | BUILT | Phase 3 · Task 4 (wallet resolved per agent via `findAgentWallet`) |

## Section C — Treasury, top-up, revocation

| Item | Status | Where |
|---|---|---|
| C1 allocation + solvency | BUILT | Phase 4 · Tasks 1, 2 |
| C2 auto top-up loop | BUILT | Phase 4 · Task 3 |
| C3 gas headroom | BUILT | Phase 0 · S6 + Phase 3 · Tasks 4, 5 |
| C4 revocation = sweep | BUILT | Phase 4 · Task 5 (gated on S3) |
| C5 kill switch | BUILT | Phase 1 · Tasks 3, 4, 5 |

## Section D — Agent-to-agent

| Item | Status | Where |
|---|---|---|
| D1 payee can be another agent | BUILT | Phase 6 · Task 3 |
| D2b three-mode rule | BUILT | Phase 6 context (Mode 1 → Permit2) |
| D2 ERC-8183 escrow | **SEQUENCED** | Phase 7 · Tasks 2, 3 (gated on spike S8) |
| D3 ERC-8004 identity | **SEQUENCED** | Phase 8 · Task 1 |
| D4 payment-gated reputation | **SEQUENCED** | Phase 8 · Task 2 — **the novel differentiator** |
| D5 reputation → allocation | **SEQUENCED** | Phase 8 · Task 3 |

## Section E — Correctness fixes

| Item | Status | Where |
|---|---|---|
| E1 policy fails closed | BUILT | Phase 1 · Tasks 1, 2 |
| E2 policy before business checks | BUILT | Phase 5 · Task 1 |
| E3 audit chain full coverage | BUILT | Phase 5 · Task 3 |
| E4 separation of duties | BUILT + **SEQUENCED** | Phase 5 · Task 4 (self-approval); quorum in Phase 9 · Task 6 |
| E5 append-only ledger | **SEQUENCED** | Phase 9 · Task 1 |
| E6 reservation release rule | **SEQUENCED** (partly BUILT) | Phase 4 · Task 4 closes the `unknown` leak; death-predicate in Phase 9 · Task 2 |
| E7 capture provider denials | **CUT** | §0.1 C-3 — premise refuted; already persisted |
| E8 bind `payTo` before signing | BUILT | Phase 5 · Task 2 |

## Section F — Housekeeping

| Item | Status | Where |
|---|---|---|
| F1 port docs | **CUT** | CUT-2 |
| F2 contracts package | **CUT** | CUT-1 |
| F3 seed Arc capabilities | BUILT | Phase 2 · Task 2 |
| F4 rail enum + Arc | BUILT | Phase 2 · Task 2 |
| F5 `unknown` resolution | BUILT | Phase 4 · Task 4 (**promoted** — live fund leak) |

## Section G — Distribution

| Item | Status | Where |
|---|---|---|
| G1 Google ADK integration | **SEQUENCED** | Phase 9 · Task 4 |
| G2 `llms.txt` / `skill.md` | **SEQUENCED** | Phase 9 · Task 5 |

## Section K — Demo deltas

| Item | Status | Where |
|---|---|---|
| K-1 x402 endpoint per agent | BUILT | Phase 6 · Tasks 5, 6 |
| K-2 which mode per payment | BUILT | Phase 0 decision |
| K-3 agent runtime harness | BUILT | Phase 6 · Tasks 5, 6 |
| K-4 Arc faucet | BUILT | Phase 0 · S5 |
| K-5 escrow funding source | **SEQUENCED** | Phase 7 · Task 1 (spike S8) |
| K-6 reputation formula | BUILT (decision) | Phase 0 decision — bounded, or not shipped |
| K-7 demo reset | BUILT | Phase 6 · Task 7 |
| K-8 Permit2 integration | BUILT | Phase 6 · Tasks 1, 2 |
| K-9 `batch-settlement` binding doc | **SEQUENCED** | Phase 9 · Task 3 |
| K-10 pin x402 tooling | BUILT | Phase 6 · Task 4 |
| K-11 7-day validity window | BUILT (decision) | Phase 0 decision — cap Lane 1 amounts |
| K-12 Permit2 × Arc native USDC | BUILT | Phase 0 · S4 (**gates Phase 6**) |
| K-13 multi-chain per-agent wallets | BUILT | Phase 3 · Task 1 (grain is `(agent_id, mode, chain)`) |
| K-14 per-chain allocation + top-up | BUILT | Phase 4 · Tasks 1, 3 |
| K-15 JIT Gateway bridge | **SEQUENCED** | Phase 7 · Task 4 |
| K-16 pin EOA | BUILT | Phase 2 · Task 4 + Phase 3 · Task 1 CHECK |
| K-17 reconcile Arc chain ID | BUILT | Phase 0 · S1 |
| K-18 `bridgeWalletTopUp` stub | BUILT (accepted) | Phase 2 · Task 1 Step 5 — regression recorded |

---

## Sequenced items — why they come after T3, not instead of it

These **are being built**. They sit in Phases 7–9 because each either depends on T3 or carries external risk that T3 does not. Nothing here is optional work.

| Item | Phase | Why it runs after T3 |
|---|---|---|
| **D2 · K-5** ERC-8183 escrow | **7** | Draft EIP ~5 months old, **no evidence of an audit**, one testnet implementation, addresses published only in Arc's tutorials rather than its contract reference. Carries an unhandled evaluator-liveness trap. It is real work with real value — but it is the only item whose *external* dependency could move under us, so T3's claims must not rest on it. **Gated on spike S8.** |
| **D3 · D4 · D5** ERC-8004 + reputation | **8** | D4 is the manifest's most novel idea, and it **requires D2** — reputation is written from an escrow `complete` hook, which is exactly what makes it earned rather than self-asserted. Strict chain: D2 → D3 → D4 → D5. D3 (identity) can ship standalone if S8 kills D2. |
| **K-15** JIT Gateway bridge | **7** | Cross-chain works in T3 via Option A (pre-funding). K-15 replaces the K-18 stub regression with the real bridge and is the scale story. Independent of escrow — can run in parallel with Task 2. |
| **E5** append-only ledger | **9** | The manifest scopes it out pre-deadline. Phase 4 · Task 4 already closes the concrete leak that made it urgent. Building it after T3 means it can record T3's real transaction history rather than being retrofitted. |
| **E6** death-predicate release | **9** | Partly built already (Phase 4 · Task 4 handles `unknown`). The EIP-3009 death-predicate refinement is the remaining piece. |
| **K-9** `batch-settlement` binding | **9** | Documents what Phase 6 built. Cannot be written accurately until Permit2 drawdown is actually running. |
| **E4** N-of-M quorum | **9** | Self-approval — the actual control gap — ships in Phase 5. Quorum is the additive second layer. |
| **G1 · G2** ADK, `llms.txt` | **9** | The manifest is explicit: *"adoption work, not architecture work. Do not let it displace Sections B/C/E."* Sequenced last for exactly that reason — not dropped. |

**The dependency that governs Phase 7–8 ordering:** D4 is the differentiator, but it is downstream of the riskiest item in the whole manifest. That is why Phase 7 opens with spike **S8** — if ERC-8183's funding mechanics or addresses do not check out, we learn it in one script rather than mid-phase, and D3 still ships on its own.

---

# PART 3 — Phase index

Execute in order. Each file is independently executable.

| Phase | File | Contains | Gate |
|---|---|---|---|
| **0** | `2026-08-03-phase0-gates.md` | Spikes S1–S7, decisions. No production code. | Blocks everything |
| **1** | `2026-08-03-phase1-critical-fixes.md` | M1 fail-closed policy, M2 kill switch | None — start now |
| **2** | `2026-08-03-phase2-arc-enablement.md` | M3 dev-controlled flip, M4 Arc chain, M5 pin EOA | S1, S2 |
| **3** | `2026-08-03-phase3-agent-wallets.md` | M6 per-agent wallets, M7 balance budget, M8 gas headroom | Phase 2 |
| **4** | `2026-08-03-phase4-treasury.md` | M9 allocation/solvency, M10 top-up + unknown, M11 sweep | Phase 3, S3 |
| **5** | `2026-08-03-phase5-hardening.md` | M12 policy order + payTo, M13 audit + approvals | M1 |
| **6** | `2026-08-03-phase6-a2a.md` | M14 Permit2, M15 agent harness | Phase 3, S4 |
| **7** | `2026-08-03-phase7-escrow-bridge.md` | S8 spike, M16 ERC-8183 escrow, M17 JIT bridge | Phase 6 · **S8 gates M16** |
| **8** | `2026-08-03-phase8-reputation.md` | M18 ERC-8004 identity, M19 payment-gated reputation, M20 reputation→allocation | Phase 7 (D4 needs D2) |
| **9** | `2026-08-03-phase9-ledger-distribution.md` | M21 ledger, M22 death-predicate, M23 binding doc, M24 quorum, M25 ADK, M26 `llms.txt` | Phase 6 |

**Critical path:** `Phase 0 → 2 → 3 → 6 → 7 → 8`. Phases 1 and 5's M13 are independent — start Phase 1 immediately, in parallel with Phase 0's spikes.

**T3 is the tier that must land first** (Phases 0–6). It carries the three strongest claims and depends on zero Draft EIPs. Phases 7–9 build everything else the manifest specifies, in dependency order, immediately afterwards.

**Phase 9 is parallelizable.** Its six tasks are independent of each other and of Phases 7–8 — if two people are working, Phase 9 can run alongside Phase 7.

---

# PART 4 — Conventions for every phase

**Migration numbering:** the highest existing migration is **`0021_runtime_payment_attempts.sql`**. New migrations start at **`0022`**. (The stale `packages/db/dist/` only has 0001–0020 — ignore it; the change manifest's "after 0020" is wrong.)

**Test commands:**
```bash
# Single test file
npx vitest run test/policy/decision-engine.test.ts --root apps/api

# API suite
npm test --workspace @agentops-pmoa/api

# Full gate before calling a milestone done
npm run verify
```

**Docker gate:** server tests need Postgres and **skip silently** without it. A green run with Docker down proves nothing.
```bash
docker compose up -d    # from AOPS-PMOA/
```
Always confirm tests actually *ran* — check the count, not just the color.

**Commit style:** matches existing history (`feat(payments):`, `fix(policy):`, `test(payments):`).

**Claim discipline:** never state a claim before its milestone lands. "Max loss bounded by on-chain balance" is **false until M7 ships**. Always say "Arc testnet" — Arc mainnet does not exist.
