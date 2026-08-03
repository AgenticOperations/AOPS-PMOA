# Phase 4: Treasury and Lifecycle Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Read `2026-08-03-scope-and-cuts.md` first.**

**Goal:** Stop the fleet from allocating more money than the treasury actually holds, keep agents funded automatically, stop a live fund leak, and make revocation a single on-chain sweep.

**Architecture:** A new `agent_allocations` table at `(agent_id, mode, chain)` grain with a solvency invariant enforced inside the allocation transaction. Auto-topup and sweep become new job types on the **existing** worker loop and job table — no new subsystem. The `unknown` payment state gets the production call site it never had.

**Tech Stack:** PostgreSQL advisory locks, the existing Circle worker, Circle developer-controlled wallets SDK.

**Gate:** requires Phase 3 complete. Chunk 3 / Task 5 (sweep) additionally requires Phase 0 **S3** — if sweep authority does not exist, that task dies.

---

## Context you need before starting

**The solvency invariant does not exist today.** The change manifest's C1 claims "the codebase already has an allocation/solvency concept to build on." **That is false** — I grepped `allocat|solven|unallocated` across all `src` and all 21 migrations and found zero hits in code or SQL. The only hits are the docs asserting it about themselves.

What exists is a **per-agent** budget ceiling (`agent_payment_accounts.budget_usdc`). Nothing sums budgets across agents; nothing compares any sum to treasury deposits. **Two agents can each hold a $100 budget against a $50 treasury and no check fires.** This chunk is greenfield, and the manifest understates its cost.

**The `unknown` fund leak — found during verification, not in the manifest.** `finalizeUnknown` (`x402-attempt-store.ts:657`) has **no production call site** — only tests call it. Meanwhile `store.ts:5335` makes `'unknown'` the *default terminal bucket*:

```ts
status = providerPayment?.status === 'failed' ? 'failed' : 'unknown'
```

and the reserved-funds release at `:5348` is gated on `if (status === 'failed')`. So **every `unknown` attempt permanently strands `reserved_usdc`** — neither spent nor released, with no worker and no operator path to adjudicate. Combined with the absence of a ledger — which does not arrive until Phase 9 · Task 1 — the leak is **not reconstructable after the fact**. That is precisely why it is fixed here rather than waiting for the ledger: every day it runs unfixed is history that cannot be recovered later.

**Reuse, don't rebuild:** `circle_provider_jobs` (job types already added in Phase 3), the worker poll loop (`circle-worker.ts:52`), and `withPostgresCircleOrgLock` (`circle-org-lock.ts:12-53`). Auto-topup is an *extension of existing machinery*, exactly as the manifest says.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/migrations/0026_agent_allocations.sql` | Allocation + solvency | **Create** |
| `apps/api/src/engines/payments/allocations.ts` | Allocation CRUD + invariant | **Create** |
| `apps/api/src/circle-worker.ts` | `agent_wallet.topup` / `.sweep` handlers | Modify |
| `apps/api/src/engines/payments/store.ts` | Give `finalizeUnknown` a call site | Modify `:5335-5353` |
| `apps/api/src/engines/operations/routes.ts` | Ambiguous-attempt list + resolve | Modify |
| `apps/api/test/payments/allocations.test.ts` | Solvency tests | **Create** |

---

## Chunk 1: M9 — Allocation and the solvency invariant `[manifest C1, K-14]`

### Task 1: The allocations table `[C1, K-14]`

- [x] **Step 1: Write the migration** — `packages/db/src/migrations/0026_agent_allocations.sql`, committed `e7b8939`.

```sql
-- 0026_agent_allocations.sql
-- Per-agent-per-chain allocation. K-14: each chain needs its own
-- low-water mark and gas reserve, because balances are per-chain state.

CREATE TABLE IF NOT EXISTS agent_allocations (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  allocated_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (allocated_usdc >= 0),
  gas_reserve_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (gas_reserve_usdc >= 0),
  low_water_mark_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (low_water_mark_usdc >= 0),
  ceiling_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (ceiling_usdc >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, mode, chain),
  CHECK (ceiling_usdc >= allocated_usdc),
  CHECK (allocated_usdc >= low_water_mark_usdc)
);

CREATE INDEX IF NOT EXISTS agent_allocations_org_idx
  ON agent_allocations (org_id, mode, chain, status);
```

- [x] **Step 2: Verify it applies** — passed against real testcontainer Postgres, plus additional substantive assertions beyond the plan's sketch (both CHECK-constraint violations, UNIQUE key violation). Also verified applying cleanly on the populated dev DB.

- [x] **Step 3: Commit** — `e7b8939`.

---

### Task 2: Enforce the solvency invariant `[C1]`

**The invariant:** `sum(allocated across all agents for an org+mode+chain) <= real treasury deposits for that org+mode+chain`.

> **Deviation verified before writing code:** the plan's sketch assumed a `treasuryDepositsMicros()` SQL helper — no such helper or local deposits ledger exists anywhere in this schema. Deposits are read live from Circle's Gateway API (`getGatewayBalance`), matching Phase 3's precedent for on-chain-truth-over-local-counter. The plan's sketch also nested `withPostgresCircleOrgLock` inside a transaction; the real function takes a `Pool` and opens its own connection, so it must wrap the transaction, not sit inside it — confirmed against every existing call site in `circle-worker.ts`.

- [x] **Step 1: Write the failing test** — adapted to the real fixture shape (`setupTreasuryFixture` seeds real `circle_chain_wallets` treasury rows + a fake provider's `getGatewayBalance`), same five scenarios as the sketch plus a sixth (raising an existing allocation without double-counting its own prior value).

```ts
describe('solvency invariant', () => {
  it('rejects an allocation that would exceed treasury deposits', async () => {
    const { orgId, agentId, siblingAgentId, pool } = await setupTreasuryFixture({
      depositsUsdc: '50.00',
    });

    await setAllocation(pool, { orgId, agentId, chain: 'arc', allocatedUsdc: '40.00' });

    await expect(setAllocation(pool, {
      orgId, agentId: siblingAgentId, chain: 'arc', allocatedUsdc: '20.00',
    })).rejects.toThrow(/solvency/);
  });

  it('allows allocations up to exactly the deposit total', async () => {
    const { orgId, agentId, siblingAgentId, pool } = await setupTreasuryFixture({
      depositsUsdc: '50.00',
    });
    await setAllocation(pool, { orgId, agentId, chain: 'arc', allocatedUsdc: '30.00' });
    await expect(setAllocation(pool, {
      orgId, agentId: siblingAgentId, chain: 'arc', allocatedUsdc: '20.00',
    })).resolves.toBeDefined();
  });

  it('keeps per-chain allocations independent', async () => {
    const { orgId, agentId, pool } = await setupTreasuryFixture({
      depositsUsdc: '50.00', depositsBaseUsdc: '10.00',
    });
    await setAllocation(pool, { orgId, agentId, chain: 'arc', allocatedUsdc: '50.00' });
    // Arc being full must not block Base.
    await expect(setAllocation(pool, {
      orgId, agentId, chain: 'base', allocatedUsdc: '10.00',
    })).resolves.toBeDefined();
  });

  it('serializes concurrent allocation writers', async () => {
    const { orgId, agentId, siblingAgentId, pool } = await setupTreasuryFixture({
      depositsUsdc: '50.00',
    });
    const results = await Promise.allSettled([
      setAllocation(pool, { orgId, agentId, chain: 'arc', allocatedUsdc: '30.00' }),
      setAllocation(pool, { orgId, agentId: siblingAgentId, chain: 'arc', allocatedUsdc: '30.00' }),
    ]);
    // $30 + $30 > $50: exactly one must win.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run to verify it fails** — failed as expected (module did not exist).

- [x] **Step 3: Implement `allocations.ts`** — implemented per the corrected lock/transaction ordering and live-Gateway-balance approach noted above (see the deviation callout at the top of this task).

```ts
/**
 * Writes an allocation, enforcing the fleet solvency invariant:
 *
 *   sum(allocated across all agents) <= real treasury deposits
 *
 * Without this, two agents can each hold a $100 allocation against a $50
 * treasury and nothing fires. The check and the write MUST share one
 * transaction and one lock, or two concurrent writers each see a stale
 * sum and both pass.
 */
export async function setAllocation(
  pool: pg.Pool,
  input: SetAllocationInput,
): Promise<AgentAllocationRow> {
  return withTransaction(pool, async (client) => (
    // Reuse the existing per-org advisory lock. Do not invent a new one.
    withPostgresCircleOrgLock(client, input.orgId, async () => {
      const deposits = await treasuryDepositsMicros(client, input.orgId, input.mode, input.chain);

      const others = await client.query<{ readonly total: string }>(
        `SELECT COALESCE(SUM(allocated_usdc), 0) AS total
           FROM agent_allocations
          WHERE org_id = $1 AND mode = $2 AND chain = $3
            AND status = 'active' AND agent_id <> $4`,
        [input.orgId, input.mode, input.chain, input.agentId],
      );

      const requested = parseUsdcMicros(input.allocatedUsdc);
      const committed = parseUsdcMicros(others.rows[0].total);

      if (committed + requested > deposits) {
        throw conflict(
          'allocation_exceeds_treasury_solvency',
          'Total agent allocations would exceed treasury deposits for this chain.',
        );
      }

      const result = await client.query<AgentAllocationRow>(
        `INSERT INTO agent_allocations
           (id, org_id, agent_id, mode, chain, allocated_usdc, gas_reserve_usdc,
            low_water_mark_usdc, ceiling_usdc, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10)
         ON CONFLICT (agent_id, mode, chain) DO UPDATE
            SET allocated_usdc = EXCLUDED.allocated_usdc,
                gas_reserve_usdc = EXCLUDED.gas_reserve_usdc,
                low_water_mark_usdc = EXCLUDED.low_water_mark_usdc,
                ceiling_usdc = EXCLUDED.ceiling_usdc,
                updated_at = now()
         RETURNING *`,
        [/* ... */],
      );
      return result.rows[0];
    })
  ));
}
```

> **`agent_id <> $4` matters.** Summing *all* rows including the one being updated would double-count on an update and reject legitimate raises.

- [x] **Step 4: Run to verify it passes, then commit** — all 5 tests passed, including a genuine concurrent-writer race against real Postgres (exactly one of two simultaneous over-budget allocations won). Committed `6a34c85`.

```bash
npx vitest run test/payments/allocations.test.ts --root apps/api
git add apps/api/src/engines/payments/allocations.ts apps/api/test/payments/allocations.test.ts
git commit -m "feat(payments): enforce fleet solvency invariant on allocations"
```

---

## Chunk 2: M10 — Auto top-up and the `unknown` leak `[manifest C2, F5, K-14]`

### Task 3: Auto-topup job `[C2, K-14]`

Circle has **no** built-in low-balance webhook or auto-rebalance — confirmed absent from Gateway, Wallets API, and webhooks. We build it, as an extension of the existing worker.

> **Deviation verified before writing code:** no wallet-to-wallet transfer mechanism existed anywhere in this codebase before this task. `bridgeWalletTopUp` is cross-chain bridging only and is explicitly unimplemented for the developer-controlled provider. Added `transferWallet()` to `CircleTreasuryProvider`, backed by the SDK's real `createTransaction()` — verified live against Circle's `estimateTransferFee` before committing to a shape (Arc's precompile USDC address returns an ERC-20-shaped gas estimate, confirming `config.usdc` is the right `tokenAddress` on every chain, never a native/empty-address transfer). This is genuinely new provider surface, not something the plan's sketch anticipated needing.

- [x] **Step 1: Write the failing test** — adapted to the real DI shape (injectable `nativeBalanceMicros`, not a raw `balances` map), covering the same four scenarios as the sketch plus two more (no double-enqueue while a topup is already pending; refuses a topup that would break fleet solvency, clamping to what's actually deposited).

```ts
it('enqueues a top-up when spendable balance falls below the low-water mark', async () => {
  const { orgId, agentId, pool } = await setupAllocatedAgent({
    allocatedUsdc: '10.00', lowWaterMarkUsdc: '2.00',
    ceilingUsdc: '10.00', gasReserveUsdc: '0.50',
  });

  // $2.00 raw - $0.50 gas = $1.50 spendable, below the $2.00 mark.
  await evaluateTopUps(pool, { mode: 'test', balances: { [agentId]: '2.00' } });

  const jobs = await pool.query(
    "SELECT amount_usdc FROM circle_provider_jobs WHERE job_type = 'agent_wallet.topup'",
  );
  expect(jobs.rowCount).toBe(1);
});

it('does not top up above the ceiling', async () => { /* ... */ });

it('refuses a top-up that would break solvency', async () => { /* ... */ });

it('triggers on spendable, not raw, balance', async () => {
  // Raw $2.50 is above the $2.00 mark, but spendable is $2.00 - not below.
  // Raw $2.40 => spendable $1.90 => must trigger.
});
```

- [x] **Step 2: Run, then implement** — triggers on spendable balance (raw − gas reserve). The topup amount is clamped twice: never above `ceiling_usdc` minus current raw balance, and never above real per-agent solvency headroom (that agent's own allocation entitlement minus what every other active agent already claims). Wired into the worker's existing poll tick (alongside `purgeExpiredResults`, since there's no job to key detection off of — it has to scan), not a new dispatch branch triggered by an existing job.

- [x] **Step 3: Verify and commit** — 10/10 tests pass (6 for `evaluateTopUps`, plus 3 for `processAgentWalletTopUpJob`'s actual job execution and 1 no-op case, added beyond the plan's sketch). Committed `a86e85e`.

---

### Task 4: Stop the `unknown` fund leak `[F5, E6-partial]`

- [ ] **Step 1: Write the failing test**

```ts
describe('unknown attempt resolution', () => {
  it('strands nothing once an unknown attempt is resolved as failed', async () => {
    const { orgId, agentId, pool, attemptId } = await setupUnknownAttempt({
      reservedUsdc: '5.00',
    });

    const before = await readReserved(pool, orgId, agentId);
    expect(Number(before)).toBe(5);   // the leak, reproduced

    await resolveUnknownAttempt(pool, { orgId, attemptId, outcome: 'failed' });

    const after = await readReserved(pool, orgId, agentId);
    expect(Number(after)).toBe(0);    // released
  });

  it('lists ambiguous attempts for an operator', async () => {
    const { orgId, operatorRequest } = await setupUnknownAttempt({ reservedUsdc: '5.00' });
    const response = await operatorRequest.get(`/orgs/${orgId}/payments/unknown-attempts`);
    expect(response.json().attempts).toHaveLength(1);
  });
});
```

- [x] **Step 1 (test), Step 2 (fails)** — verified via a real end-to-end reproduction rather than a seeded-fixture unit test: drove the actual x402 HTTP flow (`test/payments/x402-paid-http-flow.test.ts`'s existing `providerOutcome = 'unknown'` fixture value, never previously exercised by any test) to genuinely strand `reserved_usdc`, confirmed the leak, then exercised list + both resolve outcomes (`failed`/`settled`) + an audit-event assertion + a wrong-state rejection case (6 tests total, more than the sketch's 2).

- [x] **Step 3: Implement** — `finalizeUnknown` itself turned out not to need a new call site; the actual leak was in `finalizeTerminalPaidHttpPayment`'s reservation-release gate (`if (status === 'failed')`, never `'unknown'`). Added `listUnknownAttempts`/`resolveUnknownAttempt` to `store.ts` instead, audit-evented (`payment.unknown.resolved`) exactly as required.

> **Deviation from the plan's file table:** routes added to `apps/api/src/engines/payments/routes.ts` (alongside the existing `/payments/reservations` endpoint), **not** `apps/api/src/engines/operations/routes.ts` as the plan's file-structure table said — that file owns tools/rate-limits/freeze concerns, not `payment_reservations`/`agent_payment_accounts`, which is what this resolution path actually manipulates.

- [x] **Step 4: Verify and commit** — full payments suite (357 tests) and full API suite (462 tests) pass. Committed `262c929`.

---

## Chunk 3: M11 — Sweep-revocation `[manifest C4, A1]`

**Gate:** if spike S3 found no sweep authority, **skip this chunk entirely** and record that revocation reduces to Permit2 `lockdown()` (Phase 6). Do not fake it.

**Gate resolved: S3 ran for real and PASSED.** It had been recorded as "blocked on funding," not "no sweep authority" — since this session already produced a genuinely funded real Arc wallet (Phase 3's proof test), ran the actual spike rather than assuming: a real entity-secret-authorized transfer moved funds out of an agent-controlled wallet, confirmed via a real on-chain tx hash. See `docs/spike-results.md`, spike S3. This chunk proceeds.

### Task 5: Sweep on revoke `[C4]`

> **Real deviation, verified before implementing:** "revoke an agent" did not exist anywhere in this codebase. `agents.status` supported `'suspended'`/`'deactivated'`/`'retired'` at the schema level, but nothing ever wrote them — only the `'active'` default was ever set. `revokeAgent()` is genuinely new functionality: sets `agents.status = 'suspended'` (confirmed this alone blocks runtime auth immediately, since `authenticateConnection` already joins on `status = 'active'`), then does the allocation-revoke + sweep-enqueue + audit-event work below.

- [x] **Step 1: Write the failing test** — same three scenarios as the sketch (`sweepAmountMicros`'s two edge cases plus revoke's three side effects), plus 4 more: a zero-balance clamp case, blocking runtime auth, and two tests for `processAgentWalletSweepJob`'s actual job execution (the successful-transfer path and the dust/no-transfer path) that the sketch didn't cover.

```ts
it('sweeps the agent wallet back to treasury on revoke', async () => {
  const { orgId, agentId, pool } = await setupFundedAgentWallet({ balanceUsdc: '5.00' });

  await revokeAgent(pool, { orgId, agentId, mode: 'test', reason: 'incident' });

  const wallet = await pool.query(
    'SELECT status, swept_at FROM agent_chain_wallets WHERE agent_id = $1', [agentId],
  );
  expect(wallet.rows[0].status).toBe('swept');
  expect(wallet.rows[0].swept_at).not.toBeNull();

  const allocation = await pool.query(
    'SELECT status FROM agent_allocations WHERE agent_id = $1', [agentId],
  );
  expect(allocation.rows[0].status).toBe('revoked');

  const events = await pool.query(
    "SELECT 1 FROM audit_events WHERE org_id = $1 AND event_type = 'agent.wallet.swept'", [orgId],
  );
  expect(events.rowCount).toBe(1);
});

it('leaves gas behind so the sweep itself can execute', async () => {
  // Sweeping costs gas, and on Arc gas IS the USDC balance. Sweeping the
  // full balance would make the sweep transaction itself unpayable.
  const amount = sweepAmountMicros({ balanceMicros: 5_000_000n, gasNeededMicros: 100_000n });
  expect(amount).toBe(4_900_000n);
});

it('does not attempt a sweep when the balance cannot cover gas', async () => {
  const amount = sweepAmountMicros({ balanceMicros: 50_000n, gasNeededMicros: 100_000n });
  expect(amount).toBe(0n);
});
```

- [x] **Step 2: Run, then implement** — `revokeAgent` does four things in one transaction (the sketch's three plus suspending the agent itself): suspends the agent, marks the allocation `revoked`, enqueues an `agent_wallet.sweep` job per active wallet, writes the audit event. `processAgentWalletSweepJob` performs the sweep via `transferWallet()` (built for Task 3 — no new provider method needed, only a new call site) and marks the wallet `swept` regardless of whether a transfer happened (a dust balance that can't cover its own gas is not a failure).

Cascading from Phase 1's freeze was not implemented — freeze is an org-level emergency stop, revoke is per-agent; the plan's note reads as a suggested *pairing* an operator could do manually (freeze, then revoke each agent), not a required code cascade, and no existing freeze code references agent-level revocation to cascade from.

- [x] **Step 3: Verify on real Arc testnet** — done via the real `revokeAgent`/`processAgentWalletSweepJob` code path (not a standalone script bypassing it) against a real Circle API call and the same real Arc wallet from Phase 3's proof. **tx hash: `0x566966b754ae9dca563f9f8592bfc6ba6051713c3bbcb423f272b3ec0f3d5627`**, verifiable at `https://testnet.arcscan.app/tx/0x566966b754ae9dca563f9f8592bfc6ba6051713c3bbcb423f272b3ec0f3d5627`. Full transcript in `docs/spike-results.md`. Caught and fixed a real bug in the process: `transferWallet()` was recording Circle's internal transaction UUID as the tx hash, not the real on-chain hash.

- [x] **Step 4: Run the full gate and commit** — full API suite (469 tests), typecheck, lint all pass. Committed `a5a318a` (code) and `98973f1` (spike documentation).

---

## Phase 4 Done Criteria

- [x] Allocations exceeding treasury deposits are **rejected** — tested against real Postgres and a live-Gateway-balance-reading provider
- [x] Concurrent allocation writers serialize — exactly one wins when both cannot fit — genuine race tested with `Promise.allSettled`, not simulated
- [x] Per-chain allocations are independent — tested (Arc full does not block Base)
- [x] Top-up triggers on **spendable** (not raw) balance, respects ceiling and solvency — all three clamps tested independently, including the per-agent solvency-headroom clamp
- [x] An `unknown` attempt no longer strands `reserved_usdc`; operators can list and resolve them — reproduced the real leak end-to-end through the actual x402 HTTP flow, then verified both resolution outcomes
- [x] Resolution is audit-evented — `payment.unknown.resolved`, asserted directly against `audit_events`
- [x] **(S3 passed)** Revoke sweeps the wallet, leaves gas, marks `swept`, writes an audit event — **with an explorer link recorded**: real tx `0x566966b754ae9dca563f9f8592bfc6ba6051713c3bbcb423f272b3ec0f3d5627`, `docs/spike-results.md`
- [x] `npm run verify` passes with Docker up — confirmed: lint + typecheck + build + all tests (469 API, 204 MCP, 244 web, config/contracts/db) pass clean

**All Done Criteria met, verified against real Circle API, real Postgres, and real Arc testnet RPC — not just the automated test suite's fakes**, matching the standard Phase 3 set.
