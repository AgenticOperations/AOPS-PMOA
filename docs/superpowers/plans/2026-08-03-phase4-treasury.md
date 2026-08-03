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

- [ ] **Step 1: Write the migration**

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

- [ ] **Step 2: Verify it applies**

```bash
docker compose up -d
npx vitest run test/migrate.test.ts --root packages/db
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/migrations/0026_agent_allocations.sql
git commit -m "feat(db): add per-agent-per-chain allocations"
```

---

### Task 2: Enforce the solvency invariant `[C1]`

**The invariant:** `sum(allocated across all agents for an org+mode+chain) <= real treasury deposits for that org+mode+chain`.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/payments/allocations.test.ts --root apps/api
```

- [ ] **Step 3: Implement `allocations.ts`**

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

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
npx vitest run test/payments/allocations.test.ts --root apps/api
git add apps/api/src/engines/payments/allocations.ts apps/api/test/payments/allocations.test.ts
git commit -m "feat(payments): enforce fleet solvency invariant on allocations"
```

---

## Chunk 2: M10 — Auto top-up and the `unknown` leak `[manifest C2, F5, K-14]`

### Task 3: Auto-topup job `[C2, K-14]`

Circle has **no** built-in low-balance webhook or auto-rebalance — confirmed absent from Gateway, Wallets API, and webhooks. We build it, as an extension of the existing worker.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run, then implement**

Trigger on **spendable** balance (raw − gas reserve), never raw. Fund from treasury up to `ceiling_usdc`, and re-check the M9 solvency invariant before moving money. Add the `agent_wallet.topup` branch to the worker dispatch, inside the existing advisory lock.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run test/payments/allocations.test.ts --root apps/api
git add apps/api/src/circle-worker.ts apps/api/src/engines/payments/allocations.ts apps/api/test
git commit -m "feat(payments): auto top-up agent wallets from treasury"
```

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

- [ ] **Step 2: Run to verify it fails** — the first assertion documents the current leak.

- [ ] **Step 3: Implement**

Give `finalizeUnknown` a production call site, and add an operator resolution path that releases (or settles) the stranded `reserved_usdc`. Resolution must be **audit-evented** — an operator moving money by hand is exactly what the evidence trail is for.

Keep it minimal: a list endpoint and a resolve action. Do not build a reconciliation subsystem.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run test/payments --root apps/api
git add apps/api/src/engines/payments/store.ts apps/api/src/engines/operations apps/api/test
git commit -m "fix(payments): release reservations stranded by unknown attempts"
```

---

## Chunk 3: M11 — Sweep-revocation `[manifest C4, A1]`

**Gate:** if spike S3 found no sweep authority, **skip this chunk entirely** and record that revocation reduces to Permit2 `lockdown()` (Phase 6). Do not fake it.

### Task 5: Sweep on revoke `[C4]`

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run, then implement**

Revoke does three things in one transaction: mark the allocation `revoked`, enqueue an `agent_wallet.sweep` job, and write an audit event. The worker performs the sweep under the org lock, then marks the wallet `swept`.

Cascade from Phase 1's freeze so an operator can freeze then sweep.

- [ ] **Step 3: Verify on real Arc testnet**

Revoke a funded agent. Confirm on `testnet.arcscan.app` that the balance drains to treasury. **Record the tx hash** — this is the demo's strongest moment and needs an explorer artifact.

- [ ] **Step 4: Run the full gate and commit**

```bash
npm run verify
git add apps/api/src apps/api/test docs/spike-results.md
git commit -m "feat(payments): sweep agent wallets to treasury on revoke"
```

---

## Phase 4 Done Criteria

- [ ] Allocations exceeding treasury deposits are **rejected**
- [ ] Concurrent allocation writers serialize — exactly one wins when both cannot fit
- [ ] Per-chain allocations are independent
- [ ] Top-up triggers on **spendable** (not raw) balance, respects ceiling and solvency
- [ ] An `unknown` attempt no longer strands `reserved_usdc`; operators can list and resolve them
- [ ] Resolution is audit-evented
- [ ] (If S3 passed) Revoke sweeps the wallet, leaves gas, marks `swept`, writes an audit event — **with an explorer link recorded**
- [ ] (If S3 failed) The skip is recorded in `docs/decisions.md`
- [ ] `npm run verify` passes with Docker up
