# Escrow → Permit2 Trust Graduation — Design

**Date:** 2026-08-05
**Status:** Approved, not yet planned
**Supersedes:** the Phase 7 S8 fallback decision that dropped `[D2]` escrow entirely

---

## Goal

Let an operator hire an **untrusted external agent** — one from another
marketplace, on Arc or Base — safely, build a real on-chain track record with
it, and then **promote it by hand** to the cheap Permit2 rail once the work has
proven itself.

Escrow is the probation lane. Permit2 is what an agent earns by graduating.

## Why this is a better frame than Phase 7's

The change manifest repeatedly flags that Mode 2 escrow (`evaluator = client`)
"degrades to a client-controlled hold with a refund timer," and that calling it
neutral arbitration would be an overclaim (`[D2b]`, Section J).

That degradation only matters if we were claiming arbitration. We are not. We
claim escrow is **what you use before you trust a counterparty** — proof the
money exists and cannot be silently withdrawn while work is underway. That is
precisely what Mode 2 delivers. The weak claim becomes the correct claim.

## What changed since the S8 fallback

Three findings, all verified 2026-08-05, that reopen `[D2]`:

**1. The front-running guard is mandated by the standard — the reference
implementation just omits it.** ERC-8183's prose specifies:

> `fund(jobId, expectedBudget, optParams?)` — SHALL revert if … `job.budget != expectedBudget` (front-running protection)

The reference implementation ships `fund(uint256 jobId, bytes optParams)` and
validates against stored `job.budget` instead. S8's demonstrated overcharge was
therefore not an Arc quirk but a spec/implementation gap in ERC-8183 itself. A
contract we write can be **more** conformant than the reference.

**2. S8's "unreadable state" finding was our error, not the contract's.** The
plan called `jobs(uint256)`, taken from Arc's tutorials. The EIP defines
`getJob(uint256) returns (Job)`. Called correctly against the real S8 job, it
decodes cleanly:

```
jobId      166059
client     0x216c05b8...367e
provider   0xecf29492...b48f
evaluator  0x216c05b8...367e     <- == client, confirms Mode 2
budget     40000                 <- 0.04 USDC, the FRONT-RUN amount
expiredAt  1785860226
state      3
metadata   "AgentOps S8 escrow spike"   (24 bytes, exact)
```

Every field is internally consistent, and `budget` independently confirms the
front-run overcharge from a different angle than the event logs. The `288` S8
reported as a corrupt `state` is word [5] — the string offset `0x120` — misread
because `jobs()` returns without the leading struct-offset word, shifting every
slot by one.

**3. There is no usable ERC-8183 escrow on Base Sepolia.** Checked directly:

| Contract | Base Sepolia | Verdict |
|---|---|---|
| Arc reference `0x0747EEf0…` | no code | Arc-only |
| `ClawTrustAC` `0x1933D67C…` ("ERC-8183 agentic commerce") | 6,969 bytes | **none of the ERC-8183 selectors present** |
| `ClawTrustEscrow` `0x6B676744…` | 6,823 bytes | same |

Selector computation was sanity-checked against S8's independently derived
values (`fund(uint256,bytes)` = `0xe25ba707`, `setBudget(uint256,uint256,bytes)`
= `0xdd4ae9d4`) before trusting these absences. Virtuals Protocol's real
deployments are Base **mainnet** and Arbitrum, not Base Sepolia.

**Consequence:** native Base-side escrow requires deploying our own contract.

---

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D-1 | **Deploy our own ERC-8183-conformant escrow** to Arc testnet and Base Sepolia | Only way to get Base-side escrow; lets us ship the guarded `fund` the standard mandates |
| D-2 | **Promotion is always a human act.** No automatic graduation, ever | The system presents evidence; a person judges the work. Keeps `approved_by` a real person, matching every other authority table in this codebase |
| D-3 | **No trust thresholds.** No "N clean jobs" rule | If a human decides, there is no magic number to defend. History informs the decision; it does not trigger it |
| D-4 | External agents are **address + label** for now | ERC-8004 identity resolution does not change what the demo proves and pulls Phase 8 `[D3]` scope in. Noted as a follow-on |
| D-5 | Escrow state is **driven by our own transactions**, confirmed from receipts and events; `getJob` is the reconciliation check, not the primary source | We initiate every transition, so events are authoritative for our own writes. `getJob` catches third-party changes (`setBudget`, `reject`) |
| D-6 | Client always approves the **exact** budget | Belt and braces: even if the contract guard were bypassed, a front-run reverts on allowance rather than silently overpaying |

---

## The demo, as an on-chain ledger

One external agent throughout. What changes is its trust tier.

| Beat | Action | On-chain |
|---|---|---|
| 1 | Hire an unknown agent from another marketplace. No trust, no delegation | — |
| 2 | `createJob(provider, evaluator, expiredAt, …)` | tx |
| 3 | `approve(escrow, exactBudget)` → `fund(jobId, expectedBudget, …)`; funds genuinely locked and independently verifiable by the provider | 2 tx |
| 4 | Provider delivers → `submit(jobId, deliverableHash, …)` | tx |
| 5 | Operator judges the work → `complete(jobId, …)`; escrow releases to provider | tx |
| 6 | Repeat once or twice — a track record now exists on-chain, verifiable by tx hash by anyone | |
| 7 | Operator reviews the history and clicks **Trust this agent** — writes the allowlist row *and* signs a scoped, expiring on-chain Permit2 delegation | tx |
| 8 | Next job: **no escrow.** One `transferFrom` drawdown against the ceiling | 1 tx |

**The payoff is the contrast, measurable live.** Beats 3–5 cost five
transactions and lock capital for the duration of the work. Beat 8 costs one
transaction and locks nothing. Same counterparty; the difference is trust, and
the trust was earned on-chain and granted by a human who looked at the work.

---

## Architecture

Four pieces, each independently buildable and testable.

### Piece 1 — Escrow contract `[new capability]`

ERC-8183-conformant Solidity, deployed to Arc testnet and Base Sepolia. This
repo has **no Solidity toolchain today** — no `contracts/`, no `.sol`, no
Hardhat or Foundry — so this piece adds one.

Two deliberate deviations from the reference implementation, both *toward* the
spec:

- `fund(uint256 jobId, uint256 expectedBudget, bytes optParams)` — selector
  `0xd2e13f50` — reverts on budget mismatch. The unguarded `fund(uint256,bytes)`
  is kept for interface conformance but **our client never calls it**.
- A correct `getJob(uint256) returns (Job)`.

Smallest surface that supports the lifecycle. Testnet only.

### Piece 2 — Escrow lifecycle engine

`escrow_jobs` migration plus the engine driving
`Open → Funded → Submitted → Completed | Rejected | Expired`.

Maps onto the **existing reservation lifecycle** rather than inventing a
parallel one: `completed` settles the reservation, `rejected` / `expired`
release it. `expired` is recorded **distinctly** from `rejected` — "delivered
but never evaluated" is not the same failure as "rejected," even though the
chain refunds both identically and cannot tell them apart.

Refuses sub-cent amounts: five-plus state-changing transactions per job means
orchestration cost dominates the payment.

### Piece 3 — Graduation

Deliberately small, because the destination already exists:

- `payment_destination_allowlist` ([0027](../../../packages/db/src/migrations/0027_payto_allowlist.sql))
  already has `source IN ('marketplace', …)`, `status IN ('active','revoked')`,
  and `approved_by`. **That table is the checkmark.**
- `agent_delegations` ([0028](../../../packages/db/src/migrations/0028_permit2_delegations.sql))
  already has a nullable `payee_agent_id` and a required `payee_address` — so the
  Permit2 rail can already pay an external agent by address.

Graduation is therefore a row transition plus an on-chain permit, not new
infrastructure: write the allowlist row (`source = 'marketplace'`, `approved_by`
= the operator), open the delegation with the ceiling the operator chooses, sign
the permit. Revocation pulls both back and revokes the on-chain permit.

### Piece 4 — Console

Escrow history per agent, the trust action, the checkmark, the delegation view.
Lives alongside the existing payments components in
`apps/web/src/components/payments/`.

Must surface `submitted` jobs approaching expiry — see the liveness trap below.

---

## Risks

**We are writing a payments contract.** This is the real exposure and the only
piece that is new capability for this repo. Mitigations: keep the contract
small; make the front-run scenario an explicit test that *must* revert; testnet
only; exact-allowance funding as a second line of defence independent of the
contract guard.

**The evaluator-liveness trap is inherent to ERC-8183 and does not go away.** If
the evaluator goes silent after `submit`, `claimRefund` refunds the **client**
even though the work was delivered — the provider absorbs it, and `expired` is
indistinguishable from `rejected` on-chain. In this design the operator *is* the
evaluator, so it is their own risk to manage rather than a stranger's, but the
console must surface at-risk jobs rather than pretend the trap is absent.

**No dispute path exists.** Reject and expire are final; the standard has no
arbiter role. Do not build UI implying an appeal.

---

## Claim discipline

- ✅ "Escrow proves the funds exist and cannot be silently withdrawn before the provider starts work."
- ✅ "Trust was earned on-chain and granted by a human who reviewed the work."
- ❌ **Never** "neutral arbitration" while `evaluator = client` — the client decides release.
- ❌ Never claim the front-run guard protects clients on the *reference* contract. It does not; ours adds it.
- ✅ ERC-8183 is an Ethereum Foundation + Virtuals Protocol standard, not Circle's. Draft, and no evidence of an audit.

## Out of scope

- ERC-8004 identity resolution for external agents (`[D3]`) — follow-on
- On-chain reputation writes from the completion hook (`[D4]`, `[D5]`)
- Mainnet deployment of the escrow contract
- Mode 3 (genuine third-party evaluator) — requires an independent evaluator to exist
