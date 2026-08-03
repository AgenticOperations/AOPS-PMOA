---
created: 2026-08-03
project: agentOps (AOPS-PMOA)
ecosystem: [circle, arc]
source: docs/change-manifest.md
status: SUPERSEDED — see docs/superpowers/plans/2026-08-03-scope-and-cuts.md
---

> ## ⚠️ SUPERSEDED — do not execute this document
>
> This was the first-pass milestone plan. It has been replaced by executable
> phase plans with step-by-step TDD tasks:
>
> **Start here:** [`superpowers/plans/2026-08-03-scope-and-cuts.md`](superpowers/plans/2026-08-03-scope-and-cuts.md)
>
> | Phase | File |
> |---|---|
> | 0 — Gates | `superpowers/plans/2026-08-03-phase0-gates.md` |
> | 1 — Critical fixes | `superpowers/plans/2026-08-03-phase1-critical-fixes.md` |
> | 2 — Arc enablement | `superpowers/plans/2026-08-03-phase2-arc-enablement.md` |
> | 3 — Per-agent wallets | `superpowers/plans/2026-08-03-phase3-agent-wallets.md` |
> | 4 — Treasury | `superpowers/plans/2026-08-03-phase4-treasury.md` |
> | 5 — Hardening | `superpowers/plans/2026-08-03-phase5-hardening.md` |
> | 6 — Agent-to-agent | `superpowers/plans/2026-08-03-phase6-a2a.md` |
>
> **Why superseded:** this document included efficiency and refactor work that
> was deliberately cut — moving shared types into `packages/contracts`, port
> doc reconciliation, the advisory-lock mode key, Circle error granularity,
> and splitting `store.ts`. See Part 2 of the scope-and-cuts doc for each cut
> and its reasoning.
>
> **Still useful below:** Sections 0 and 1 record the manifest corrections and
> the verified codebase baseline. Those findings carry forward unchanged.

# agentOps — Implementation Plan (superseded)

**What this is:** the milestone-by-milestone build plan derived from `change-manifest.md`, with every code-level claim in that manifest re-verified against the actual codebase. Each milestone states exact files, exact insertion points, acceptance criteria, and the verification command that proves it.

**What this is not:** a restatement of the manifest. Where the manifest was wrong, this document says so and plans against reality.

**Baseline verified:** branch `kc/a2a-imple`, commit `349b4e1`, 66,345 LOC across `apps/{api,web,mcp}` + `packages/{config,contracts,db}`, 21 migrations, 79 test files.

---

# SECTION 0 — Manifest corrections (read this first)

I verified all 22 code-level claims in the manifest. **17 confirmed, 3 wrong, 2 materially overstated.** The wrong ones change the plan, so they are recorded before anything else.

## 0.1 Corrections that change the work

| # | Manifest claim | Reality | Impact on plan |
|---|---|---|---|
| **C-1** | "Migration: new file after `0020`" (B2) | **Highest migration is `0021_runtime_payment_attempts.sql`.** The stale `packages/db/dist/` build output only has 0001–0020, which is almost certainly where the manifest's number came from. | **Every new migration in this plan starts at `0022`.** A file named `0021_*` would collide and the migrator would fail or silently skip. |
| **C-2** | "the codebase already has an allocation/solvency concept to build on rather than inventing fresh" (C1) | **False — zero hits** for `allocat\|solven\|unallocated` in all `src` and all 21 migrations. The only hits are the docs asserting it about themselves. What exists is a *per-agent* budget/reservation ledger (`agent_payment_accounts.budget_usdc/spent_usdc/reserved_usdc`). Nothing sums across agents; nothing compares any sum to treasury deposits. | **M5 (C1) is greenfield, not an extension.** Its effort estimate in the manifest is understated. Two agents can today each hold a $100 budget against a $50 treasury with no check firing. |
| **C-3** | "provider errors are read and dropped; a Circle `DENIED` looks like a generic adapter error" (E7) | **Refuted.** `DENIED` is in `CIRCLE_FAILED_TRANSACTION_STATES` (`circle-provider.ts:599`), thrown at `:747-748`, and persisted via `errorReason` → `error_code` columns (`0021:24`, `0010:118`, `0018:24`). | **E7 shrinks from "build persistence" to "improve granularity."** The real defect is that the throw collapses `DENIED` into a lowercased state suffix, losing the distinction between a compliance denial and a network failure. Demoted to M11. |

## 0.2 Claims materially overstated

| # | Manifest claim | Reality | Impact |
|---|---|---|---|
| **C-4** | "no emergency stop exists" (C5) | **Partly wrong.** `agents.status` already has `'paused'` and `'suspended'` in its CHECK (`0002:112`), indexed at `0002:123`. `orgs.status` has `'active'/'disabled'` (`0001:4`). The *vocabulary* exists; the *enforcement path* does not. | C5 is **cheaper than billed** — wire up existing columns + add an org-level flag, rather than design a state model from scratch. |
| **C-5** | Dev-controlled provider "already exists but is **unreachable**" (A3-note) | **Reachable.** `createCircleTreasuryProvider()` (`circle-provider.ts:1446-1449`) branches on `CIRCLE_TREASURY_PROVIDER === 'developer_controlled'`, and is the default arg for 15 exported store functions. It is *dormant by default*, and unreachable **only from the worker path** (`circle-org-provider.ts:13` hardcodes the Agent Wallet factory with no branch). | A3 is a **narrower change than billed**: add the env branch to the org-scoped worker factory. The API-process path already works. |

## 0.3 Line-number drift (cosmetic, but don't chase ghosts)

| Manifest ref | Actual location |
|---|---|
| `store.ts:4839-4858` budget check "in `payRuntimeX402`" | **`store.ts:4885-4890`, in `preparePaidHttpPayment`** (declared `:4842`). `payRuntimeX402` is at `:5675`. |
| `enforceX402Policy` "step 6, `store.ts:4914`" | **`store.ts:4976`**. Definition at `:980`. No numbered step comments exist in the code; the "step 2–5 / step 6" numbering is manifest-invented. |
| `circle-provider.ts:565-823` dev-controlled impl | **`circle-provider.ts:989-1184`**. 565–823 is unrelated helpers. |
| `config/env.ts:21` port default | **`apps/api/src/config/env.ts:199`**. |
| `decision-engine.ts:157-160` fail-open | **Exact — verified verbatim.** |
| `approvals/store.ts:366-432` | **Exact.** |
| `evidence/routes.ts:93-104` | **Exact.** |
| `audit-query.ts` boundedLimit | **`:160-162`.** |

## 0.4 Two traps the manifest does not mention

**Trap 1 — E1 cannot be fixed by swapping the seed.**
`decisionRank` is `allow:0, observe:1, approval_required:2, deny:3` (`decision-engine.ts:19-24`) and the reduce is a **max-rank fold**. Seeding it with `'deny'` would make `deny` win over every matching `allow` rule — every request denied, always. The fix must branch on `matched.length === 0` **before** the fold, leaving the fold's seed alone. Getting this wrong turns a fail-open bug into a total outage.

**Trap 2 — K-16 is a data migration, not a CHECK swap.**
Migration `0012` did three things to each of `circle_chain_capabilities`, `circle_wallet_sets`, `circle_chain_wallets`: dropped the CHECK, **set the column DEFAULT to `'sca'`**, re-added a widened CHECK, and then **`UPDATE`d every existing `'eoa'` row to `'sca'`** (`0012:8-11, 20-23, 32-35`), plus a `payment_sources` backfill (`:37-41`). So re-tightening to EOA must reset defaults and back the data out, or the new constraint fails on existing rows. And critically: **new per-agent wallets would today default to `'sca'` silently**, which breaks Gateway signing at payment time rather than at creation.

---

# SECTION 1 — What actually exists (the real baseline)

Verified facts the plan builds on.

## 1.1 The payment path

The governing function is **`preparePaidHttpPayment`** (`apps/api/src/engines/payments/store.ts:4842`), and its real order is:

| Order | Line | What |
|---|---|---|
| 1 | `4852` | `activePaymentAccount()` — `SELECT ... FOR UPDATE`, checks `status='active'` + `payment_access` |
| 2 | `4866-4880` | rail resolution → `unsupported_payment_rail` / `payment_rail_not_allowed` |
| 3 | `4881-4884` | per-request cap |
| 4 | **`4885-4890`** | **budget check** — `spent + reserved + amount > budget` |
| 5 | `4892-4910` | payment source + simulated balance |
| 6 | `4935-4954` | **`INSERT INTO payment_reservations`** |
| 7 | `4955-4961` | **`UPDATE agent_payment_accounts SET reserved_usdc = reserved_usdc + ...`** |
| 8 | **`4976`** | **`enforceX402Policy`** ← policy runs *last* |

**Money is reserved at steps 6–7 before policy is consulted at step 8.** That is E2, and it is slightly worse than the manifest describes.

`activePaymentAccount` (`:4672-4686`) is the ideal kill-switch insertion point: it is the first call, and it already holds a `FOR UPDATE` row lock.

## 1.2 Schema grain

- `agent_payment_accounts` — `UNIQUE (org_id, agent_id)` (`0009:62`). Numeric counters only. **No wallet binding, no chain column.**
- `circle_chain_wallets` — `UNIQUE (org_id, mode, chain)` (`0010:103`). One wallet per org per chain. Correct as the *treasury*; wrong grain for per-agent.
- `chain` CHECK constraints are enumerated in **7 places** (`0009:11,30`; `0010:4,9,44,94,114`) — all need Arc.
- `payment_sources_rail_check` — 10 values, no Arc (`0010:14-26`).
- `PaymentChain` / `PaymentRail` TS unions — `types.ts:5-16`, no Arc.
- Chain → CAIP-2 map — **`store.ts:704-708`** (testnet), `:712-714` (mainnet). This is where K-17's chain ID lands.

## 1.3 Existing machinery worth reusing

| Asset | Location | Reuse for |
|---|---|---|
| `circle_provider_jobs` + job-type CHECK (already widened 5×: `0011,0013,0014,0015,0016`) | `0010:109-123` | C2 top-up job type (M6) |
| Worker poll loop, 5s default, env-overridable | `circle-worker.ts:52` | C2 handler (M6) |
| Per-org advisory lock `pg_try_advisory_lock` | `circle-org-lock.ts:12-53`, used at `circle-worker.ts:94` | C2/C4 serialization |
| Pure worker logic, DI-shaped, no SQL | `circle-liquidity-worker.ts` (92 lines) | Trivially unit-testable extension point |
| `dedicated_wallet_required` flag — stored & surfaced, **never enforced** | `0009:57`, `store.ts:177,438,1298` | B1 trigger for provisioning |
| `agents.status` incl. `paused`/`suspended` | `0002:112` | C5 kill switch (M2) |
| `approval_requests.requested_by` | `0007:13` | E4 self-approval check is a **one-line comparison** (M9) |
| `audit_event_heads.last_sequence` / `last_event_hash` | `0001:9-14` | E3 tail check (M9) |
| Dev-controlled provider, working | `circle-provider.ts:989-1184` | A3 flip (M3) |
| `viem`, `@circle-fin/developer-controlled-wallets`, `@circle-fin/x402-batching` already deps | `apps/api/package.json` | Permit2 (M12) — **no new deps needed** |

**Greenfield (zero existing code):** Arc, Permit2, ERC-8183, ERC-8004, allocation/solvency, per-agent wallets, agent runtime harness. Confirmed by grep returning nothing.

## 1.4 Known latent defect found during verification (not in the manifest)

**`finalizeUnknown` is production-dead code.** `x402-attempt-store.ts:657` is called only from tests — no `src` call site. Meanwhile `store.ts:5335` makes `'unknown'` the *default terminal bucket* (`status = providerPayment?.status === 'failed' ? 'failed' : 'unknown'`), and the reserved-funds release at `:5348` is gated on `if (status === 'failed')`.

**Consequence: every `unknown` attempt permanently strands `reserved_usdc`.** Funds are neither spent nor released, with no worker and no operator endpoint to adjudicate. Combined with the absence of a ledger (E5), the leak is not reconstructable after the fact. This makes F5 more urgent than its "housekeeping" billing — it is scheduled in **M10**.

---

# SECTION 2 — Milestone plan

## Ordering rationale

The manifest's Section H is dependency-correct, and I follow its spine. Three deviations, each justified:

1. **M1 (E1 fail-closed) and M2 (C5 kill switch) come before everything** — as the manifest says. They are hours of work against the two worst findings.
2. **K-12 (Permit2 × Arc native-USDC) is pulled into M0**, not M12. The manifest itself says "test this first — it gates Lane 2" and "better to learn that on day one." Discovering it on the day Lane 2 is built wastes the whole milestone.
3. **F5 is promoted from housekeeping to M10** because of §1.4 — it is a live fund-stranding bug, not cosmetics.

**Effort key:** S = <½ day · M = ½–1 day · L = 1–2 days · XL = 2+ days

---

## PHASE 0 — Gates (nothing downstream is safe until these land)

### M0 — Verification spikes and decisions
**Manifest:** A1–A6, K-4, K-12, K-17, K-5, K-2, K-6 · **Effort:** L · **Depends on:** nothing

Throwaway scripts under `scripts/spikes/`. **No production code.** Every downstream milestone assumes an answer here.

| Spike | Question | Kills / changes if it fails |
|---|---|---|
| **S1** `[K-17]` | Arc chain ID: docs say `5042002`, x402 facilitator returns `eip155:14601`. Probe the facilitator's `/supported` and Arc RPC `eth_chainId`. | A wrong ID signs against the wrong EIP-712 domain and **fails silently**. Blocks M4. |
| **S2** `[A2]` | Circle dev-controlled wallets on `ARC-TESTNET` end to end: create → fund → transfer. | Blocks all of Phase 2. No fallback. |
| **S3** `[A1]` | Can the entity secret sweep funds *out* of a created wallet back to treasury? | **The entire C4 revocation story.** If no, M7 dies and the demo loses its best moment. |
| **S4** `[K-12]` | Can an agent EOA `approve` Permit2, and can Permit2 `transferFrom` Arc's **native-USDC ERC-20 view** (which truncates)? | **Blocks Lane 2 / M12.** Failure ⇒ target tier drops T3 → T4. Highest-value spike. |
| **S5** `[K-4]` | Arc testnet USDC faucet path; does existing `requestTestnetFunds` work on Arc? | No funding, no demo. |
| **S6** `[C3]` | Confirm Arc's ERC-20 `balanceOf` truncation vs native balance; establish which RPC call gas decisions must use. | Wrong read ⇒ agents brick. Shapes M6. |
| **S7** `[A5]` | Compliance/Transaction Screening API access (sales-gated). | If denied, **drop it** rather than fake it. |

**Decisions to record in `docs/decisions.md`:** A3 (flip to dev-controlled — recommend yes), A4 (Arc-only + Base Sepolia for the cross-chain hop), A6/K-2 (escrow scope), K-6 (reputation→allocation formula, **must be bounded with a floor and ceiling** — an unbounded feedback loop on real money is dangerous), K-11 (7-day `minValiditySeconds` exposure window).

**Acceptance:** every row above has a written YES/NO with evidence (tx hash, API response, or error) committed to `docs/spike-results.md`. **No production code merged in this milestone.**

---

## PHASE 1 — Highest-severity fixes (independent of everything else)

### M1 — Policy fails closed
**Manifest:** E1 · **Effort:** S · **Depends on:** none · **Risk if skipped: CRITICAL**

Any action type with no authored rule is currently silently permitted.

**Change** — `apps/api/src/engines/policy/decision-engine.ts:141-169`:
- Branch on `matched.length === 0` **before** the reduce (see §0.4 Trap 1 — do **not** touch the seed).
- Return `deny` with a new reason code `no_matching_policy_denied`, distinct from today's `no_matching_policy`.
- Add org-level `default_policy_effect` (`'deny'` default, `'allow'` opt-in) — new migration **`0022`**, column on `orgs` or a policy-settings table.
- Permissive mode must be **explicit and auditable**: writing `'allow'` emits an audit event.
- Keep `enforceability` honest: a no-rule deny should be distinguishable downstream from an affirmatively-evaluated deny.

**Blast radius:** every caller of `evaluatePolicyDecision`. Existing orgs with no authored rules will start denying — that is the point, but it will break tests that rely on implicit allow. Expect to update `apps/api/test/policy/policy-routes.test.ts` (1043 lines) and `apps/api/test/runtime/runtime-integration.test.ts`.

**Acceptance:**
- Unit: zero rules → `deny` + `no_matching_policy_denied`.
- Unit: one matching `allow` rule → **`allow`** (proves Trap 1 avoided).
- Unit: matching `allow` + matching `deny` → `deny` (max-rank fold intact).
- Unit: org with `default_policy_effect='allow'` + zero rules → `allow` + audit event written.
- `npm test --workspace @agentops-pmoa/api`

### M2 — Kill switch
**Manifest:** C5 · **Effort:** S–M · **Depends on:** none

Cheaper than the manifest bills (§0.2 C-4) — the state vocabulary exists.

**Change:**
- Migration **`0022`** (same file as M1): add `orgs.frozen boolean NOT NULL DEFAULT false` + `frozen_reason text` + `frozen_at`. Agents reuse existing `agents.status IN ('paused','suspended')`.
- Enforce in **`activePaymentAccount` (`store.ts:4672-4686`)** — the first call in the payment path, already holding `FOR UPDATE`. Join `orgs` and `agents`; throw `org_frozen` / `agent_frozen` **before** the existing `payment_access` check.
- Also enforce at the earliest point of the runtime routes (`engines/runtime/`) so non-payment actions are covered.
- Operator endpoints: freeze/unfreeze org and agent, operator role required, audit-evented.

**Acceptance:**
- Frozen org → every payment + runtime action rejected with `org_frozen`, **before** any policy or budget evaluation.
- Frozen agent → only that agent blocked; siblings unaffected.
- Freeze/unfreeze emits audit events.
- Integration test proving freeze beats an otherwise-valid payment.

---

## PHASE 2 — Arc enablement

### M3 — Flip to developer-controlled wallets
**Manifest:** A3, K-18 · **Effort:** M · **Depends on:** M0/S2

Narrower than billed (§0.2 C-5) — only the worker path is hardcoded.

**Change** — `apps/api/src/engines/payments/circle-org-provider.ts:13`:
- Replace the hardcoded `createCircleAgentWalletTreasuryProvider({ executor })` with the same `CIRCLE_TREASURY_PROVIDER` env branch already used at `circle-provider.ts:1446-1449`.
- Keep the Agent Wallet path intact behind the flag (manifest's explicit fallback requirement).
- **`[K-18]` regression to accept explicitly:** flipping removes the only working `bridgeWalletTopUp` (the Agent Wallet CLI path at `circle-provider.ts:1245`). The dev-controlled one is a stub returning `success:false` (`:993-1000`). Either implement K-15 (M14) or **document the regression in `docs/decisions.md`** — do not let it be discovered at demo time.

**Acceptance:** worker provisions a wallet via dev-controlled path on Arc testnet with `CIRCLE_TREASURY_PROVIDER=developer_controlled`; Agent Wallet path still passes its existing tests with the flag unset.

### M4 — Arc as a first-class chain
**Manifest:** F3, F4, K-17 · **Effort:** M · **Depends on:** M0/S1 (chain ID **must** be settled)

**Change:**
- Migration **`0023`**: extend `chain` CHECK in **all 7 sites** (`0009:11,30`; `0010:4,9,44,94,114`) to include `'arc'`. Extend `payment_sources_rail_check` with `gateway_arc` + `exact_arc`. Seed `circle_chain_capabilities` for Arc test mode (`circle_blockchain: 'ARC-TESTNET'`, gateway domain from S1).
- TS unions: `types.ts:5` (`PaymentChain`) and `:6-16` (`PaymentRail`).
- **CAIP-2 map `store.ts:704-708`** — add Arc with the S1-verified ID. Per constraint I.1, add **testnet only**; do not add an Arc entry to the mainnet map at `:712-714`.
- Base Sepolia already seeded (`cap_test_base`) — needed for the cross-chain hop, no work.

**Acceptance:** migration applies clean on a DB already at 0021 (`packages/db/test/migrate.test.ts`); an Arc-rail payment source can be created and resolved; a request for an Arc quote returns the correct CAIP-2 network string.

### M5 — Pin EOA
**Manifest:** K-16 · **Effort:** S · **Depends on:** M4 · **Do not skip — fails confusingly**

**Change** — migration **`0024`**, carefully (§0.4 Trap 2):
- Reset `DEFAULT` to `'eoa'` on `circle_chain_capabilities.wallet_account_type`, `circle_wallet_sets.account_type`, `circle_chain_wallets.account_type` (0012 set all three to `'sca'`).
- For the **new per-agent wallet table only** (M6), constrain `account_type` to `CHECK (account_type = 'eoa')` — a mistake is then rejected by the database, not discovered at payment time.
- Leave existing `'sca'` rows alone (Agent Wallet fallback still needs them). Do **not** blanket-re-tighten the legacy tables or the migration fails on existing data.
- Pin `accountType: 'eoa'` explicitly at wallet creation in the provider call.

**Acceptance:** inserting an `'sca'` per-agent wallet row is rejected by the DB; a provisioned Arc wallet reports EOA; existing SCA rows survive the migration.

---

## PHASE 3 — Per-agent wallets (the foundation)

### M6 — Per-agent wallet schema + provisioning
**Manifest:** B1, B2, K-13 · **Effort:** L · **Depends on:** M3, M4, M5

Grain is **`(agent_id, chain)`** from the start — K-13 folded in here rather than retrofitted in phase 5, because retrofitting a grain change costs more than building it right once.

**Change:**
- Migration **`0025`**: new table `agent_chain_wallets` — `agent_id`, `org_id`, `mode`, `chain`, `circle_wallet_id`, `address`, `wallet_set_id`, `account_type CHECK = 'eoa'`, `ref_id`, `provisioned_at`, `swept_at`, `status`. `UNIQUE (agent_id, mode, chain)`. Do **not** reuse `circle_chain_wallets` — its `UNIQUE (org_id, mode, chain)` is the wrong grain, and it stays as the **org treasury**.
- Provisioning behind the **worker boundary**, not the public API process (manifest B1 is explicit). New `circle_provider_jobs` job type `agent_wallet.create` — the CHECK has already been widened 5× so this is a well-worn path.
- Trigger from agent creation (`engines/identity/routes.ts`, `store.ts`), gated on the existing-but-unenforced `dedicated_wallet_required` flag.
- Same `refId` across chains ⇒ same address (manifest K.1c) — but **balances are per-chain state**; the plan must never treat the shared address as a shared balance.

**Acceptance:** creating an agent enqueues a job; worker provisions an Arc EOA wallet; `agent_chain_wallets` row written with address + wallet id; a second row for Base Sepolia can be provisioned for the same agent at the same address; distinct agents get distinct addresses, verifiable on `testnet.arcscan.app`.

### M7 — Budget check reads chain balance
**Manifest:** B3 · **Effort:** M · **Depends on:** M6 · **This is the load-bearing claim**

Without this, "provable max-loss" — the single most important claim in the pitch — is false.

**Change** — `store.ts:4885-4890`:
- **Keep** the counter check as a fast pre-filter (it gives cheap rejection and intent tracking).
- **Add** the authoritative check after it: does the agent's own wallet hold enough? Counters become bookkeeping; **balance becomes truth**.
- **Spendable = balance − gas_reserve** (C3, folded in — see M8). Never compare against raw balance.
- **Read native balance, not the ERC-20 view** (constraint I.8: Arc's `balanceOf` truncates; `0` there does *not* mean zero native).
- Cache balance reads (`balances-cache.ts` exists) with a short TTL; a hot path cannot do an RPC round-trip per check. Cache staleness is acceptable *because* the chain is the real ceiling — a stale cache can only cause a spurious reject, never an overspend.

**Acceptance:**
- Agent with counters saying $10 but wallet holding $2 → rejected.
- Agent with wallet holding $10 but counters exhausted → rejected (pre-filter still works).
- Balance-based rejection emits a distinct reason code from counter-based.
- **The proof test:** fund a wallet with exactly $X, attempt $X+ε, observe rejection, verify the balance on-chain independently.

### M8 — Gas headroom as a budget dimension
**Manifest:** C3 · **Effort:** M · **Depends on:** M6, M7 · **Arc-specific, genuine differentiator**

On Arc, USDC *is* native gas — same underlying balance, 18-decimal native view vs 6-decimal ERC-20 view. **An agent that spends to zero cannot transact at all — it cannot even be swept. Bricked.**

**Change:**
- `gas_reserve_usdc` on the allocation record (M9), treated as **unspendable** by M7's check.
- Top-up (M10) triggers on **spendable**, not raw, balance.
- All gas decisions read **native** balance (S6's answer).

**Acceptance:** an agent spending to its floor retains gas reserve and remains able to transact (prove by sweeping it afterwards); spendable-balance arithmetic is unit-tested against the truncation edge case (`balanceOf` reporting 0 with non-zero native).

---

## PHASE 4 — Treasury and lifecycle

### M9 — Allocation + solvency invariant
**Manifest:** C1, K-14 · **Effort:** L · **Depends on:** M6 · **Greenfield (§0.1 C-2)**

**Change:**
- Migration **`0026`**: `agent_allocations` — `(agent_id, mode, chain)` grain per K-14, with `allocated_usdc`, `gas_reserve_usdc`, `low_water_mark`, `ceiling`.
- **Enforce the invariant:** `sum(allocated across all agents) <= real org treasury deposits`. Today two agents can each hold $100 against a $50 treasury with nothing firing. Enforce in the same transaction that writes an allocation, using the existing per-org advisory lock to serialize.
- Per-chain: each chain needs its **own** low-water mark and gas reserve.

**Acceptance:** allocating beyond treasury deposits is rejected with a solvency error; concurrent allocation attempts serialize correctly (integration test with two parallel writers); per-chain allocations are independent.

### M10 — Auto top-up + `unknown` resolution
**Manifest:** C2, F5 · **Effort:** L · **Depends on:** M9

F5 is promoted here from housekeeping because of §1.4 — it is stranding funds today.

**Change:**
- **C2:** new job type `agent_wallet.topup` in `circle_provider_jobs`; handler in the existing worker loop (`circle-worker.ts` + pure logic in `circle-liquidity-worker.ts`). Trigger on **spendable** balance < low-water mark; fund from treasury up to ceiling; respect the M9 solvency check. Circle has **no** built-in low-balance webhook or auto-rebalance — confirmed absent; we build this. Reuse `withPostgresCircleOrgLock`.
  - **Note the lock-key bug** found during verification: `circle-org-lock.ts:18` hardcodes `circle:test:${orgId}`, so live-mode jobs would share the test lock. Fix while here, or scope it — it is a latent correctness issue for any two-mode deployment.
- **F5:** give `finalizeUnknown` (`x402-attempt-store.ts:657`) a production call site, and add an operator-visible list of ambiguous attempts plus a resolution action that releases or settles the stranded `reserved_usdc`.

**Acceptance:** agent draining below low-water mark is auto-refilled within one poll cycle without human action; top-up respects ceiling and solvency; an `unknown` attempt appears in the operator list and can be resolved, releasing its reservation.

### M11 — Sweep-revocation
**Manifest:** C4 · **Effort:** M · **Depends on:** M6, M0/S3 · **Best demo moment**

**Change:** a revoke action that (a) marks the grant revoked, (b) **sweeps the wallet back to treasury**, (c) writes an audit event. Cascade from M2's freeze.
**Sweep must leave gas** — paradoxically, sweeping costs gas, so sweep `balance − gas_needed`, or accept a dust remainder. Record `swept_at` on `agent_chain_wallets`.

**Acceptance:** revoking an agent drains its wallet to treasury in one transaction with no OTP and no human; balance drop is visible on `testnet.arcscan.app`; a bricked (zero-gas) agent proves the M8 reserve was necessary.

**Gate:** if S3 said sweep authority does not exist, this milestone dies and the demo's strongest moment is lost — which is exactly why S3 is in M0.

---

## PHASE 5 — Security hardening

### M12 — Policy-before-business + payTo binding
**Manifest:** E2, E8 · **Effort:** M · **Depends on:** M1

**E2** — reorder `preparePaidHttpPayment`: move `enforceX402Policy` (`:4976`) to run **before** the rail/cap/budget/source checks (`:4866-4910`) and **before** the reservation write (`:4935-4961`). Today money is reserved before policy is consulted. Rationale: policy is the authority, and a denied action should not leak budget-state through differentiated error codes.
- Separately verify (manifest E2 note) whether any **outbound fetch** can occur before policy in the non-x402 runtime paths — that is `checker.md`'s distinct "egress before policy" concern.

**E8** — bind `payTo` before signing. Today `x402-http.ts:1218` checks only `isNonemptyString(requirements.payTo)`, and it flows verbatim into the signed requirements (`store.ts:878, 913`). A compromised or spoofed provider names any address and it gets signed — and **post-signature the theft is cryptographically irreversible**. Validate against a pre-verified allowlist (marketplace-listed value or tenant-configured destination changed only under dual control); refuse to sign on mismatch.
- Note the existing asymmetry: the **asset** address *is* canonicalized against a known-good list (`store.ts:875`) while the **destination** is not. Fix the asymmetry.

**Acceptance:** a denied policy short-circuits before any reservation row is written (assert zero rows + unchanged `reserved_usdc`); a 402 response with an unlisted `payTo` is refused before signing; the allowlist change path requires dual control.

### M13 — Audit chain + approvals
**Manifest:** E3, E4 · **Effort:** M · **Depends on:** none

**E3** — `audit-query.ts`: auto-paginate `verifyAuditChain` (`:248-263`) past the 500 cap (`:160-162`), **and** add a tail check comparing the final hash to `audit_event_heads.last_event_hash` and reconciling count against `last_sequence` (`0001:9-14`). Without the tail check, deleting a suffix of rows and rewriting the head is undetectable. Today an org with >500 events can never have its chain fully verified.

**E4** — `approvals/store.ts:366-432`: forbid self-approval. The requester column **already exists** (`approval_requests.requested_by`, `0007:13`) — this is a one-line `AND requested_by <> $3` added to the existing UPDATE's WHERE clause. Add optional N-of-M quorum above a configurable threshold. Apply the same to `denyApproval`.

**Acceptance:** an org with 1,200 events verifies end-to-end; truncating the tail and rewriting the head is **detected**; a requester cannot approve their own request; quorum blocks single-approver release above threshold.

---

## PHASE 6 — Agent-to-agent (the differentiator)

### M14 — Permit2 scoped delegation (Lane 2)
**Manifest:** K-8, K-10, D1 · **Effort:** XL · **Depends on:** M6, M0/S4 · **Gated by S4**

This *is* the scoped-delegation implementation — the manifest's recommended **T3** target and the strongest honest claim in the deck.

**Change:**
- Permit2 at canonical `0x000000000022D473030F116dDEE9F6B43aC78BA3` (confirmed live on Arc). Sign `PermitSingle`, track allowance state, `transferFrom` on drawdown, `lockdown()` on revoke. `viem` is already a dependency.
- **D1:** payee may be another agent, resolved by wallet address. Two structural constraints: the payee must expose an **HTTP endpoint** (x402 is request/response, not a wallet push), and wallets must be **EOA** (Gateway verifies via `ecrecover`) — already enforced by M5.
- **K-10:** pin x402 tooling to `x402-foundation/x402` (canonical; `coinbase/x402` is stale).

**Acceptance:** operator signs one ceiling; agent draws it down across ≥3 payments with the allowance decrementing on-chain; `lockdown()` revokes instantly; unspent funds never left the payer's wallet.

**Gate:** if S4 failed, Lane 2 falls back to per-payment `exact` authorizations and the target tier drops **T3 → T4**.

### M15 — Agent runtime harness + x402 endpoints
**Manifest:** K-1, K-3 · **Effort:** XL · **Depends on:** M14 · **Largest hidden cost**

The manifest is emphatic and correct: this is the biggest hidden cost and the thing judges actually watch. Sections B–E are control-plane work on an existing codebase; **this is building agents that make real decisions**, plus turning each earning agent into a small paid HTTP service. Our MCP surface is the *interface* — the agents do not exist.

**Change:** 5 agent processes per K.1 (Orchestrator, DataFetcher, Analyst, Writer on Arc; SeniorReviewer on Base Sepolia), each earning agent exposing an HTTP x402 endpoint. Plus **K-7** demo reset/idempotency — judges may run it twice; needs a clean-slate path that respects the known unique-seed-hash gotcha.

**Acceptance:** the K.4 run completes end to end with no human: hub→spoke, second-hop (Analyst→DataFetcher), and the cross-chain hop, twice in a row from clean state.

---

## PHASE 7 — Optional / stretch (only as time allows)

| Milestone | Manifest | Effort | Note |
|---|---|---|---|
| **M16** — Ledger + reservation discipline | E5, E6 | L | Append-only postings, balances derived by summation, corrections by offsetting row. Full double-entry is out of scope; **state honestly which shipped**. E6 gets easier on Arc: deterministic BFT finality, no reorgs. |
| **M17** — ERC-8183 escrow | D2, K-5, K-9 | XL | **Highest external risk.** Draft EIP, unaudited, evaluator-liveness trap, Permit2 cannot fund it directly. Only in Mode 2 per D2b, and describe it as *proof-of-funding*, **never** neutral arbitration while running `evaluator = client`. |
| **M18** — ERC-8004 + payment-gated reputation | D3, D4, D5, K-6 | XL | The novel piece: write feedback **only** from an escrow `complete` hook. Requires M17. Reputation→allocation formula must be bounded (K-6). |
| **M19** — JIT Gateway bridge | K-15, K-18 | L | Replaces the M3 stub regression. `signTypedData` → `/v1/transfer` → `gatewayMint`. Needs one-time Gateway `deposit` per wallet — a plain ERC-20 transfer is **not** credited. |
| **M20** — Housekeeping | F1, F2 | S | F1: README says 8080 (4 places), `env.ts:199` defaults 4010, and `env.ts:200` advertises 8080 in `publicApiBaseUrl` — reconcile all. F2: `packages/contracts` is exactly 45 lines of generic schemas with no payment/policy/identity wire types; move shared ones in or document the drift. |
| **M21** — Distribution | G1, G2, E1-compliance | M | ADK binding, `llms.txt`/`skill.md`. **Adoption work, not architecture** — must not displace B/C/E. |

---

# SECTION 3 — Dependency graph

```
M0 (spikes) ─────────────────────────────────────────────┐
                                                          │
M1 (fail-closed) ──┬──────────────────────► M12 (policy order + payTo)
M2 (kill switch) ──┘
                                                          │
M0/S2 ──► M3 (dev-controlled) ──┐                        │
M0/S1 ──► M4 (Arc chain) ───────┼──► M5 (EOA) ──► M6 (per-agent wallets)
                                 │                        │
                                 │        ┌───────────────┼──────────────┐
                                 │        ▼               ▼              ▼
                                 │   M7 (balance)    M9 (allocation)  M11 (sweep) ◄── M0/S3
                                 │        │               │
                                 │        ▼               ▼
                                 │   M8 (gas)  ────► M10 (topup + unknown)
                                 │                        │
M0/S4 ──────────────────────────────────► M14 (Permit2) ──► M15 (harness)
                                                          │
M13 (audit/approvals) — independent, any time ────────────┘
```

**Critical path:** `M0 → M3/M4 → M5 → M6 → M7 → M14 → M15`.
**Parallelizable now:** M1, M2, M13 depend on nothing.
**Single points of failure:** S3 kills M11; S4 downgrades M14 (T3→T4); S2 kills all of Phase 2+.

---

# SECTION 4 — Tier mapping

Per the manifest's fallback ladder, with milestones attached.

| Tier | Milestones | Proves |
|---|---|---|
| **Floor** | M1, M2, M3–M8, M11 | Provable max-loss + instant revocation. Still genuinely strong. |
| **T4** | + M9, M10, M12, M13 | Per-agent wallets, chain-enforced budgets, auto-topup, gas headroom, sweep-revocation, hardening |
| **T3 ← target** | + M14, M15 | **Real scoped on-chain delegation with drawdown and instant revocation. Zero Draft EIPs.** |
| **T2/T1** | + M17, M18 | Escrow, then earned reputation |
| **Full** | + M19, M16 | JIT bridge + ledger |

**Recommendation: build to T3**, matching the manifest. It delivers the original scoped-delegation goal with on-chain teeth, needs no Draft EIPs, and carries all three strongest claims. **Verify S4 first** — if Permit2 cannot handle Arc's native-USDC view, learn it on day one, not on Aug 8.

---

# SECTION 5 — Claim discipline checkpoints

Claims may only be made once their milestone lands. Re-check before the deck and video.

| Claim | Unlocked by | Guard |
|---|---|---|
| "Max loss bounded by on-chain balance, verifiable by RPC" | **M6+M7** | **False until M7 ships.** The single most important claim — do not make it early. |
| "Scoped delegation, ceiling + expiry enforced on-chain, revocable by `lockdown()`" | **M14** | Say finer-grained rules (destination, purpose) remain control-plane-enforced. |
| "Revocation at machine speed, no OTP" | **M11 + M14** | Both levers: `lockdown()` **and** sweep. |
| "Cross-chain: Arc agent pays Base agent" | **M6 (multi-chain) or M19** | **Never** claim a Gateway balance is spendable on any chain at payment time. Say we *handle* the constraint. |
| "Reputation earned only via settled escrow" | **M18** | Do **not** claim ERC-8004 reputation is trustworthy as-is. |
| "Escrow" | **M17** | With `evaluator = client`, say *proof-of-funding before work begins* — **never** neutral arbitration. |
| Network | always | **Always "Arc testnet."** Arc mainnet does not exist. |
| Wallet type | **M5** | Always EOA. Never claim gas sponsorship (needs SCA) + Nanopayments together. |
| ERC-8183 authorship | — | Ethereum Foundation + **Virtuals Protocol**, not Circle. Draft, unaudited. |

---

# SECTION 6 — Verification protocol

Per milestone, in order:

1. `npm run typecheck` — builds packages first, so schema/type drift surfaces immediately.
2. `npm test --workspace @agentops-pmoa/api` — the 79-file suite.
3. Migration tests — `packages/db/test/migrate.test.ts` must apply cleanly **on a DB already at 0021**, not just from scratch.
4. `npm run verify` — full lint + typecheck + build + test, before any milestone is called done.
5. **On-chain milestones (M6–M11, M14): an explorer link is the acceptance artifact.** "The test passes" is not sufficient for a claim whose entire value is third-party verifiability. If the claim is "anyone can verify this without trusting us," then the acceptance evidence must itself be independently verifiable.

**Docker note:** server tests are Docker-gated and **skip silently** without Postgres running. A green run with Docker down proves nothing — bring the stack up first and confirm tests actually executed.

---

# SECTION 7 — Risk register

| Risk | Severity | Trigger | Mitigation |
|---|---|---|---|
| **S4 fails — Permit2 ≠ Arc native-USDC** | HIGH | M0 | Tier drops T3→T4; Lane 2 → per-payment `exact`. **Test day one.** |
| **S3 fails — no sweep authority** | HIGH | M0 | M11 dies; demo loses its best moment. No known fallback. |
| **M1 breaks existing tests** | MED | M1 | Expected — implicit-allow tests must be rewritten. Budget for it. |
| **Trap 1: seeding reduce with `deny`** | **HIGH** | M1 | Would deny *everything*. Branch on `matched.length === 0` instead. Test explicitly. |
| **Trap 2: K-16 data migration** | MED | M5 | 0012 mutated rows to `'sca'` and changed defaults. Reset defaults, constrain only the new table. |
| **Migration numbered 0021** | MED | any | **Collides with `0021_runtime_payment_attempts.sql`.** Start at 0022. |
| **`store.ts` is 5,875 lines** | MED | M7, M12 | Highest-churn file; M7 and M12 both edit the same function. **Sequence them, don't parallelize.** |
| **M15 underestimated** | **HIGH** | M15 | The manifest says twice it is the largest hidden cost. Start it as early as M14 allows. |
| **Advisory lock hardcodes `test` mode** | LOW-MED | M10 | `circle-org-lock.ts:18`. Latent for two-mode deploys; fix while in M10. |
| **`unknown` strands `reserved_usdc`** | MED | M10 | Live bug today (§1.4). Not reconstructable without a ledger (M16). |
| **Draft EIP churn** | MED | M17, M18 | ERC-8183 is ~5 months old, one testnet impl, unaudited; addresses only in tutorials. Re-verify before relying. |

---

# SECTION 8 — Immediate next actions

1. **Run M0 spikes S1, S2, S4 first** — they gate the most and are the cheapest to learn from. S4 in particular decides the target tier.
2. **Start M1 + M2 in parallel** — they depend on nothing, are hours of work, and close the two worst findings.
3. **Record A3/A4/A6/K-2/K-6/K-11 decisions** in `docs/decisions.md` before any Phase 2 code.
4. **Confirm the target tier by Aug 7** so the video and deck describe what actually runs.

**Open decisions requiring a human call:** A3 (flip to dev-controlled — recommend **yes**), A4 (recommend **Arc-only + Base Sepolia** for the hop), A6/K-2 (escrow scope — recommend **defer to M17, stretch only**), K-6 (bounded reputation formula), K-11 (7-day exposure window — recommend **cap Lane 1 to small amounts**).
