# Escrow Lifecycle Engine Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive real ERC-8183 escrow jobs against the contract deployed in piece 1, and map their lifecycle onto the reservation accounting this codebase already has.

**Architecture:** A new `escrow.ts` engine mirroring the shape of `permit2.ts` — exported functions taking `(pool, provider, input)`, all on-chain calls dependency-injected through `CircleTreasuryProvider` so they can be faked in tests. `escrow_jobs` mirrors on-chain state; **the chain is authoritative** and on disagreement we trust the chain. Escrow state changes drive the existing `payment_reservations` lifecycle rather than a parallel one: `completed` settles, `rejected`/`expired` release.

**Tech Stack:** TypeScript, Postgres, vitest, viem (event decoding), the deployed ERC-8183 escrow.

**Design doc:** `docs/superpowers/specs/2026-08-05-escrow-trust-graduation-design.md`
**Piece 1 (done):** `docs/superpowers/plans/2026-08-05-escrow-contract-deploy.md`

---

## Context you need before starting

This is **piece 2 of 4**. Piece 1 deployed and proved the contract. Pieces 3 (graduation) and 4 (console) are separate plans. Do not build them here.

### The deployed contract (from `packages/onchain/deployments.json`)

| Chain | chainId | Escrow proxy | USDC |
|---|---|---|---|
| Arc testnet | 5042002 | `0x31C050d9D20504c4E11b2A894051d8181B14e0F5` | `0x3600000000000000000000000000000000000000` |
| Base Sepolia | 84532 | `0x31C050d9D20504c4E11b2A894051d8181B14e0F5` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

The addresses match by coincidence (same deployer, same nonce, plain `CREATE`). **Never write code that assumes they always will** — always look the address up per chain.

### Function signatures (verified, do not re-derive)

| Selector | Signature |
|---|---|
| `0xbaf3ede2` | `createJob(address,address,uint48,string,address,uint256)` |
| `0xf3302b89` | `setBudget(uint256,address,uint256,bytes)` |
| `0x1f989ec8` | `fund(uint256,address,uint256,bytes)` — **the guarded one; always use this** |
| `0x9e63798d` | `submit(uint256,bytes32,bytes)` |
| `0xd75bbdf3` | `complete(uint256,bytes32,bytes)` |
| `0x41dd26f5` | `reject(uint256,bytes32,bytes)` |
| `0x5b7baf64` | `claimRefund(uint256)` |
| `0xbf22c457` | `getJob(uint256)` |

`fund` reverts with `BudgetMismatch()` if `job.budget != expectedBudget` and `PaymentTokenMismatch()` if the token differs. Piece 1 proved this on-chain: tx `0x77f4c847…` reverted where S8's `0x0907ac70…` overcharged.

### Patterns to follow

- **Engine shape:** copy `apps/api/src/engines/payments/permit2.ts`. Exported functions, `withTransaction(pool, …)`, `SELECT … FOR UPDATE` to serialise, provider injected as an argument.
- **On-chain calls:** use `provider.executePermit2Transaction({ … , contractAddress: escrowAddress })`. Despite the name it is a **general contract-execution primitive** — `abiFunctionSignature`, `abiParameters`, and `contractAddress` are all caller-supplied. Renaming it is deliberately **out of scope** here; note it and move on.
- **Tests:** copy `apps/api/test/payments/permit2.test.ts` — `startPostgres()` helper plus a `fakeProvider()` built from `vi.fn()`.

### Running tests fast

These are Docker-gated and will silently skip without a database. Use a native Postgres and point `TEST_DATABASE_URL` at it — this is dramatically faster than testcontainers. **Run only the specific test file**, never the whole `test/payments` directory.

```bash
cd apps/api
TEST_DATABASE_URL=postgres://agentops:agentops@localhost:5432/agentops_pmoa_test \
  ../../node_modules/.bin/vitest run test/payments/escrow.test.ts
```

### Existing schema you must integrate with

`payment_reservations` (migration `0009`): `status IN ('reserved','settled','released','failed')`, plus `org_id`, `agent_id`, `source_id`, `amount_usdc`, `rail`, `reason_code`, `quote_hash`, `quote jsonb`, `expires_at`.

Latest migration is `0031_changelog_sync.sql`, so **the new one is `0032`**.

### Constraints carried from the design doc

- **Refuse sub-cent amounts.** Five-plus state-changing transactions per job means orchestration cost dominates the payment. Error: `escrow_uneconomic_for_amount`.
- **Always approve the exact budget** — never a margin, never max. This is the second line of defence behind the contract guard (D-6).
- **`expired` is recorded distinctly from `rejected`**, even though the chain refunds both identically. "Delivered but never evaluated" is not the same failure as "rejected," and our evidence must be able to tell them apart when the chain cannot.
- **Never claim neutral arbitration** while `evaluator == client`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/migrations/0032_escrow_jobs.sql` | Escrow job lifecycle records | **Create** |
| `apps/api/src/engines/payments/escrow-contract.ts` | Pure encoding/decoding: ABI signatures, `JobCreated` log parsing, chain→address lookup. No DB, no network | **Create** |
| `apps/api/src/engines/payments/escrow.ts` | The engine: create, fund, submit, complete, reject, expire, liveness | **Create** |
| `apps/api/test/payments/escrow-contract.test.ts` | Unit tests for encoding/decoding — no DB needed | **Create** |
| `apps/api/test/payments/escrow.test.ts` | Engine tests against Postgres + fake provider | **Create** |
| `packages/db/test/migrate.test.ts` | Add `escrow_jobs` to the expected-tables assertion | Modify |

**Why two source files:** `escrow-contract.ts` is pure and independently testable without a database, which keeps the fast feedback loop fast. `escrow.ts` owns state and transactions. Splitting them means the ABI details can be verified in milliseconds.

---

## Chunk 1: Schema

### Task 1: The `escrow_jobs` migration

**Files:**
- Create: `packages/db/src/migrations/0032_escrow_jobs.sql`
- Modify: `packages/db/test/migrate.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- 0032_escrow_jobs.sql
-- ERC-8183 escrow lifecycle. Mirrors on-chain state so the control plane
-- can reason without an RPC per decision. The CHAIN is authoritative --
-- on disagreement, trust the chain and reconcile.

CREATE TABLE IF NOT EXISTS escrow_jobs (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  client_agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  provider_address text NOT NULL,
  evaluator_address text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  escrow_address text NOT NULL,
  token_address text NOT NULL,
  -- Assigned by the chain, read from the JobCreated event. NULL until the
  -- createJob receipt is parsed.
  onchain_job_id numeric(78, 0),
  budget_usdc numeric(20, 6) NOT NULL CHECK (budget_usdc > 0),
  reservation_id text REFERENCES payment_reservations (id) ON DELETE RESTRICT,
  -- Mirrors the ERC-8183 lifecycle exactly. 'expired' is a DISTINCT row
  -- from 'rejected' even though the contract refunds both identically --
  -- we need to tell "delivered but unevaluated" apart from "failed" in our
  -- own evidence, even though the chain cannot.
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'funded', 'submitted', 'completed', 'rejected', 'expired')),
  -- Mode 2 means evaluator == client. Recorded explicitly so claim
  -- discipline can be enforced from data rather than memory.
  escrow_mode integer NOT NULL CHECK (escrow_mode IN (2, 3)),
  deliverable_hash text,
  expires_at timestamptz NOT NULL,
  create_tx_hash text,
  fund_tx_hash text,
  submit_tx_hash text,
  terminal_tx_hash text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One row per on-chain job per chain. Guards against double-recording a
  -- job if a create is retried after the receipt was already parsed.
  UNIQUE (chain, escrow_address, onchain_job_id)
);

CREATE INDEX IF NOT EXISTS escrow_jobs_org_state_idx
  ON escrow_jobs (org_id, mode, state, expires_at);

-- Evaluator-liveness watch: Submitted jobs approaching expiry are the trap
-- case -- the provider delivered and will be refunded against.
CREATE INDEX IF NOT EXISTS escrow_jobs_liveness_idx
  ON escrow_jobs (state, expires_at) WHERE state = 'submitted';

CREATE INDEX IF NOT EXISTS escrow_jobs_provider_idx
  ON escrow_jobs (org_id, provider_address, state);
```

The `provider_address` index exists because piece 3 (graduation) will ask "show me every settled job for this provider" — that is the evidence a human reviews before granting the checkmark.

- [ ] **Step 2: Add `escrow_jobs` to the migration test's expected tables**

Read `packages/db/test/migrate.test.ts` first and follow whatever assertion style is already there.

- [ ] **Step 3: Run the migration test**

```bash
cd packages/db
TEST_DATABASE_URL=postgres://agentops:agentops@localhost:5432/agentops_pmoa_test \
  ../../node_modules/.bin/vitest run test/migrate.test.ts
```

Expected: PASS, with `escrow_jobs` present.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/migrations/0032_escrow_jobs.sql packages/db/test/migrate.test.ts
git commit -m "feat(db): add ERC-8183 escrow job records"
```

---

## Chunk 2: Contract encoding

### Task 2: Chain → escrow address lookup

**Files:**
- Create: `apps/api/src/engines/payments/escrow-contract.ts`
- Create: `apps/api/test/payments/escrow-contract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { escrowAddressFor, ESCROW_FUND_SIGNATURE } from '../../src/engines/payments/escrow-contract.js';

describe('escrow contract config', () => {
  it('resolves the deployed escrow per chain', () => {
    expect(escrowAddressFor('arc')).toBe('0x31C050d9D20504c4E11b2A894051d8181B14e0F5');
    expect(escrowAddressFor('base')).toBe('0x31C050d9D20504c4E11b2A894051d8181B14e0F5');
  });

  it('refuses chains where no escrow is deployed', () => {
    // Only Arc and Base Sepolia were deployed in piece 1. Anything else must
    // fail loudly rather than default to a same-looking address.
    expect(() => escrowAddressFor('polygon')).toThrow(/escrow_not_deployed_on_chain/);
  });

  it('always uses the guarded fund signature, never the stale one', () => {
    expect(ESCROW_FUND_SIGNATURE).toBe('fund(uint256,address,uint256,bytes)');
    expect(ESCROW_FUND_SIGNATURE).not.toBe('fund(uint256,bytes)');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd apps/api && ../../node_modules/.bin/vitest run test/payments/escrow-contract.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the lookup**

Addresses are per-chain and looked up explicitly. Do **not** collapse them into one constant just because they currently match.

- [ ] **Step 4: Run until green, then commit**

```bash
git add apps/api/src/engines/payments/escrow-contract.ts apps/api/test/payments/escrow-contract.test.ts
git commit -m "feat(payments): add ERC-8183 escrow contract config"
```

---

### Task 3: Parse the on-chain job id out of the `createJob` receipt

`createJob` returns `uint256` on-chain, but the provider gives us only a tx hash — so the id must come from the **`JobCreated` event**. Without this the DB row can never be linked to the chain.

**Files:**
- Modify: `apps/api/src/engines/payments/escrow-contract.ts`
- Modify: `apps/api/test/payments/escrow-contract.test.ts`

- [ ] **Step 1: Read the real event signature from the vendored source**

```bash
grep -n "event JobCreated" packages/onchain/lib/base-contracts/contracts/ERC8183.sol
```

Record which parameters are `indexed` — that decides whether the job id is in `topics` or `data`. **Do not guess this.**

- [ ] **Step 2: Write the failing test**

Build a fixture log from the real `JobCreated` event shape found in Step 1 and assert `parseJobCreated(logs, escrowAddress)` returns the expected job id as a `bigint`. Add a negative case: logs from a **different** contract address must be ignored, returning `undefined` rather than a wrong id.

- [ ] **Step 3: Run, confirm failure, implement with viem's `decodeEventLog`**

- [ ] **Step 4: Run until green, then commit**

```bash
git commit -m "feat(payments): parse on-chain job id from JobCreated logs"
```

---

## Chunk 3: The engine

### Task 4: Create an escrow job, with the sub-cent guard

**Files:**
- Create: `apps/api/src/engines/payments/escrow.ts`
- Create: `apps/api/test/payments/escrow.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses escrow for sub-cent payments', async () => {
  // Five-plus state-changing txs per job -- orchestration cost dominates.
  await expect(createEscrowJob(pool, provider, {
    orgId, clientAgentId, providerAddress, chain: 'arc', mode: 'test',
    budgetUsdc: '0.005', expiresAt, createdBy: 'user_1',
  })).rejects.toThrow(/escrow_uneconomic_for_amount/);
});

it('records escrow_mode 2 when evaluator equals client', async () => {
  const job = await createEscrowJob(pool, provider, { /* evaluator omitted -> client */ });
  expect(job.escrowMode).toBe(2);
});

it('stores the on-chain job id parsed from the receipt', async () => {
  const job = await createEscrowJob(pool, provider, { /* ... */ });
  expect(job.onchainJobId).toBe('42');
  expect(job.state).toBe('open');
});
```

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement `createEscrowJob`**

Calls `createJob` via the provider, parses the receipt for the job id, inserts the `escrow_jobs` row in state `open`. Rejects budgets under `0.01`.

- [ ] **Step 4: Run until green, then commit**

```bash
git commit -m "feat(payments): create ERC-8183 escrow jobs"
```

---

### Task 5: Fund with exact allowance and the guarded call

This is where piece 1's security property is actually consumed. Get it wrong and the deployed guard is pointless.

**Files:**
- Modify: `apps/api/src/engines/payments/escrow.ts`
- Modify: `apps/api/test/payments/escrow.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('approves the EXACT budget, never a margin', async () => {
  await fundEscrowJob(pool, provider, { escrowJobId });
  const approve = provider.executePermit2Transaction.mock.calls
    .find(([c]) => c.abiFunctionSignature.startsWith('approve'));
  // S8's overcharge was only possible because the client approved MORE
  // than it was quoted. Exact approval makes a front-run revert.
  expect(approve[0].abiParameters[1]).toBe('20000');
});

it('always funds through the guarded signature', async () => {
  await fundEscrowJob(pool, provider, { escrowJobId });
  const fund = provider.executePermit2Transaction.mock.calls
    .find(([c]) => c.abiFunctionSignature.startsWith('fund'));
  expect(fund[0].abiFunctionSignature).toBe('fund(uint256,address,uint256,bytes)');
  // expectedBudget must be passed, and must equal the quoted budget
  expect(fund[0].abiParameters[2]).toBe('20000');
});

it('reserves against the payment reservation when funded', async () => {
  const job = await fundEscrowJob(pool, provider, { escrowJobId });
  expect(job.state).toBe('funded');
  const res = await pool.query('SELECT status FROM payment_reservations WHERE id = $1', [job.reservationId]);
  expect(res.rows[0].status).toBe('reserved');
});
```

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement `fundEscrowJob`**

Locks the row `FOR UPDATE`, refuses if state is not `open`, issues `approve(escrow, exactBudget)` on the token then the guarded `fund`, records both tx hashes, moves to `funded`, and creates/attaches the reservation.

- [ ] **Step 4: Run until green, then commit**

```bash
git commit -m "feat(payments): fund escrow with exact allowance and the guarded call"
```

---

### Task 6: Terminal transitions map onto reservations

**Files:**
- Modify: `apps/api/src/engines/payments/escrow.ts`
- Modify: `apps/api/test/payments/escrow.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('settles the reservation on complete', async () => {
  await applyEscrowStateChange(pool, provider, { escrowJobId, next: 'completed', txHash: '0xabc' });
  expect(await reservationStatus()).toBe('settled');
});

it('releases the reservation on reject', async () => {
  await applyEscrowStateChange(pool, provider, { escrowJobId, next: 'rejected' });
  expect(await reservationStatus()).toBe('released');
});

it('releases on expiry but records it distinctly from reject', async () => {
  await applyEscrowStateChange(pool, provider, { escrowJobId, next: 'expired' });
  expect(await reservationStatus()).toBe('released');
  // The contract refunds identically, but our evidence must distinguish
  // "delivered but unevaluated" from "failed".
  const row = await pool.query('SELECT state FROM escrow_jobs WHERE id = $1', [escrowJobId]);
  expect(row.rows[0].state).toBe('expired');
});

it('refuses transitions that the lifecycle does not allow', async () => {
  // open -> completed skips funding entirely; the chain would reject it and
  // so must we, rather than writing a state the chain does not agree with.
  await expect(applyEscrowStateChange(pool, provider, { escrowJobId: openJob, next: 'completed' }))
    .rejects.toThrow(/escrow_invalid_transition/);
});
```

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement `applyEscrowStateChange`**

Validate the transition against the ERC-8183 lifecycle, perform the on-chain call where one is needed (`complete`/`reject`), then settle or release the reservation **in the same database transaction** so the two can never disagree.

- [ ] **Step 4: Run until green, then commit**

```bash
git commit -m "feat(payments): map escrow terminal states onto reservations"
```

---

### Task 7: Evaluator-liveness risks

The sharpest trap in ERC-8183: if the evaluator goes silent after `submit`, `claimRefund` refunds the **client** even though work was delivered.

**Files:**
- Modify: `apps/api/src/engines/payments/escrow.ts`
- Modify: `apps/api/test/payments/escrow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('flags submitted jobs approaching expiry', async () => {
  await setupSubmittedEscrow({ expiresInHours: 2 });
  await setupSubmittedEscrow({ expiresInHours: 40 });   // not at risk
  await setupFundedEscrow({ expiresInHours: 1 });        // not submitted, not the trap
  const atRisk = await listEscrowLivenessRisks(pool, { orgId, withinHours: 6 });
  expect(atRisk).toHaveLength(1);
});
```

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement `listEscrowLivenessRisks`** using the partial index from Task 1

- [ ] **Step 4: Run until green, then commit**

```bash
git commit -m "feat(payments): surface evaluator-liveness risks"
```

---

### Task 8: Reconcile against the chain

Local rows are a mirror, not the truth. Anything a third party changes on-chain (`setBudget`, `reject` by the evaluator) is invisible to us until we look.

**Files:**
- Modify: `apps/api/src/engines/payments/escrow.ts`
- Modify: `apps/api/test/payments/escrow.test.ts`

- [ ] **Step 1: Write the failing test**

Fake a `getJob` response whose `state` disagrees with the local row, and assert `reconcileEscrowJob` updates the local row to match the chain and reports the drift — never the other way round.

- [ ] **Step 2: Run, confirm failure, implement**

Read `getJob(uint256)` (`0xbf22c457`), decode the `Job` struct using the field order recorded in piece 1, compare, and correct the local row.

- [ ] **Step 3: Run the full escrow suite**

```bash
cd apps/api
TEST_DATABASE_URL=postgres://agentops:agentops@localhost:5432/agentops_pmoa_test \
  ../../node_modules/.bin/vitest run test/payments/escrow.test.ts test/payments/escrow-contract.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(payments): reconcile escrow jobs against on-chain state"
```

---

## Chunk 4: Verify

### Task 9: Typecheck, lint, and a real end-to-end run

- [ ] **Step 1: Typecheck and lint**

```bash
cd apps/api && pnpm typecheck && pnpm lint
```

- [ ] **Step 2: Run the touched suites**

Run only `escrow.test.ts`, `escrow-contract.test.ts`, `permit2.test.ts`, and `packages/db`'s `migrate.test.ts`. Do **not** run the whole `test/payments` directory.

- [ ] **Step 3: Drive one real job end to end on Arc testnet**

Using the engine (not a script that re-implements it), walk `create → fund → submit → complete` against `0x31C050d9…` with real funded wallets. Record every tx hash.

Confirm from the chain, not from return values: the escrow holds the budget after `fund`, and the provider's balance rises by exactly the budget after `complete`.

- [ ] **Step 4: Record the evidence in `docs/spike-results.md`**

Add a "Piece 2 — escrow lifecycle engine, live proof" section with all four tx hashes and the before/after balances.

- [ ] **Step 5: Commit**

```bash
git add docs/spike-results.md
git commit -m "docs: record the live escrow lifecycle proof"
```

---

## Done Criteria

- [ ] `escrow_jobs` migration applied; `migrate.test.ts` green
- [ ] Sub-cent budgets rejected with `escrow_uneconomic_for_amount`
- [ ] Funding approves the **exact** budget — asserted in a test, not just intended
- [ ] Funding always uses `fund(uint256,address,uint256,bytes)`; the stale signature appears nowhere in the codebase
- [ ] `completed` settles the reservation; `rejected` and `expired` release it
- [ ] `expired` is stored distinctly from `rejected`
- [ ] Invalid lifecycle transitions rejected with `escrow_invalid_transition`
- [ ] Submitted jobs near expiry surfaced by `listEscrowLivenessRisks`
- [ ] `reconcileEscrowJob` trusts the chain over the local row
- [ ] One real Arc job walked `create → fund → submit → complete`, tx hashes recorded, balances independently verified
- [ ] `pnpm typecheck` and `pnpm lint` clean

## Explicitly out of scope

- Graduation to Permit2 and the trusted checkmark (piece 3)
- Console UI (piece 4)
- Renaming `executePermit2Transaction` to something honest now that it has a second caller — noted, deliberately deferred
- `claimRefund` automation — the refund path exists on-chain; automating it is piece 3 or later
- Mainnet anything
