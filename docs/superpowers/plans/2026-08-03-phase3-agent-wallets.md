# Phase 3: Per-Agent Wallets Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Read `2026-08-03-scope-and-cuts.md` first.** Only add missing functionality. Do not rewrite working flows.

**Goal:** Give every agent its own on-chain wallet, and make the agent's real chain balance — not a database counter — the authoritative ceiling on what it can spend.

**Architecture:** A new `agent_chain_wallets` table at `(agent_id, mode, chain)` grain. Wallet provisioning runs behind the existing worker/job boundary. The budget check keeps its existing counter arithmetic as a fast pre-filter and **adds** a balance check after it. Gas headroom is carved out of spendable balance because on Arc, USDC *is* gas.

**Tech Stack:** PostgreSQL, Circle developer-controlled wallets SDK, `viem` for balance reads.

**Gate:** requires Phase 2 complete, plus Phase 0 spikes **S2** (wallets on Arc) and **S6** (balance truncation).

**This phase carries the pitch's most important claim.** "Max loss is bounded by the agent's on-chain balance, verifiable by anyone via RPC" is **false until Task 4 ships**. Do not say it before then.

---

## Context you need before starting

**Today every agent in an org shares ONE wallet.** `circle_chain_wallets` is keyed `UNIQUE (org_id, mode, chain)` (`0010:103`) — one wallet per org per chain. Budgets are only Postgres numbers on `agent_payment_accounts`, keyed `UNIQUE (org_id, agent_id)` (`0009:62`), with no wallet binding and no chain column.

**The budget check as it stands** (`apps/api/src/engines/payments/store.ts:4885-4890`):

```ts
const budget = parseUsdcMicros(account.budget_usdc);
const spent = parseUsdcMicros(account.spent_usdc);
const reserved = parseUsdcMicros(account.reserved_usdc);
if (spent + reserved + quote.amountMicros > budget) {
  throw conflict('budget_exceeded', 'Payment amount exceeds the agent budget.');
}
```

**Keep this.** It is fast, it works, and it tracks intent. Task 4 **adds** a balance check after it — it does not replace it. Counters become bookkeeping; balance becomes truth.

**Why a new table rather than extending `circle_chain_wallets`:** that table's unique key is `(org_id, mode, chain)`. Per-agent needs `(agent_id, mode, chain)`. Changing the existing key would break the org treasury, which legitimately needs one wallet per org per chain. The org table stays as the **treasury**; the new table is the agents.

**Why `(agent_id, chain)` and not just `(agent_id)`:** the manifest's K-13 makes the grain per-chain so an agent can hold balances on Arc and Base independently. Building it now costs nothing extra; retrofitting a grain change later means rewriting every query. Note carefully: dev-controlled wallets sharing a `refId` get the **same address** on every EVM chain, but **balances are per-chain state**. Same address ≠ shared balance.

**Existing machinery to reuse — do not build new versions of these:**

| Asset | Location |
|---|---|
| Job table + widened `job_type` CHECK (already extended 5×) | `circle_provider_jobs`, `0010:109-123` |
| Worker poll loop, 5s default | `apps/api/src/circle-worker.ts:52` |
| Per-org advisory lock | `circle-org-lock.ts:12-53`, used at `circle-worker.ts:94` |
| Pure, DI-shaped worker logic | `circle-liquidity-worker.ts` (92 lines) |
| Redis balance cache, already wired, degrades gracefully | `balances-cache.ts`, `server.ts:19` |
| `dedicated_wallet_required` flag — stored, surfaced, **never enforced** | `0009:57` |

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/migrations/0025_agent_chain_wallets.sql` | Per-agent wallet binding | **Create** |
| `apps/api/src/engines/payments/agent-wallets.ts` | Wallet CRUD + balance reads | **Create** |
| `apps/api/src/engines/payments/store.ts` | Balance check in budget path | Modify `:4885-4890` |
| `apps/api/src/circle-worker.ts` | Handle `agent_wallet.create` job | Modify |
| `apps/api/src/engines/identity/store.ts` | Enqueue provisioning on agent create | Modify |
| `apps/api/test/payments/agent-wallets.test.ts` | Provisioning + balance tests | **Create** |

New logic goes in `agent-wallets.ts`, **not** appended to the 5,875-line `store.ts`. Only the budget-check edit touches `store.ts`.

---

## Chunk 1: M6 — Per-agent wallet schema and provisioning `[manifest B1, B2, K-13]`

### Task 1: The `agent_chain_wallets` table `[B2, K-13, K-16]`

**Files:**
- Create: `packages/db/src/migrations/0025_agent_chain_wallets.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0025_agent_chain_wallets.sql
-- Per-agent wallet binding at (agent_id, mode, chain) grain.
-- circle_chain_wallets stays as the ORG TREASURY at (org_id, mode, chain);
-- this table is the agents' own wallets.

CREATE TABLE IF NOT EXISTS agent_chain_wallets (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  wallet_set_id text NOT NULL REFERENCES circle_wallet_sets (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  circle_blockchain text NOT NULL,
  circle_wallet_id text NOT NULL,
  address text NOT NULL,
  -- Hard EOA constraint. No legacy rows here, so this is safe -- unlike the
  -- older tables, which migration 0012 filled with 'sca'. Gateway rejects
  -- non-EOA signatures and Nanopayments is EOA-only, so a mistake must be
  -- rejected by the database rather than discovered at payment time.
  account_type text NOT NULL DEFAULT 'eoa' CHECK (account_type = 'eoa'),
  ref_id text NOT NULL,
  status text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning', 'active', 'swept', 'disabled')),
  provisioned_at timestamptz,
  swept_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, mode, chain)
);

CREATE INDEX IF NOT EXISTS agent_chain_wallets_org_idx
  ON agent_chain_wallets (org_id, mode, chain, status);

-- Same refId => same address across chains. Balances remain per-chain.
CREATE INDEX IF NOT EXISTS agent_chain_wallets_ref_idx
  ON agent_chain_wallets (ref_id);

-- New job type for worker-side provisioning.
ALTER TABLE circle_provider_jobs DROP CONSTRAINT IF EXISTS circle_provider_jobs_job_type_check;
ALTER TABLE circle_provider_jobs
  ADD CONSTRAINT circle_provider_jobs_job_type_check
  CHECK (job_type IN (
    'wallet_set.create', 'wallet.create', 'gateway.deposit', 'gateway.transfer',
    'wallet.balance_sync', 'webhook.reconcile', 'liquidity.prepare',
    'wallet.rebalance', 'rail.verify',
    'agent_wallet.create', 'agent_wallet.topup', 'agent_wallet.sweep'
  ));
```

> **Before running:** read the current `circle_provider_jobs_job_type_check` definition — it has been widened five times (`0011, 0013, 0014, 0015, 0016`) and the list above must include every value already in use, or existing rows will violate it.

```bash
docker compose up -d
psql "$DATABASE_URL" -c "\d circle_provider_jobs" | grep job_type
```

- [ ] **Step 2: Run the migration test**

```bash
npx vitest run test/migrate.test.ts --root packages/db
```
Expected: PASS on a DB already at 0024.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/migrations/0025_agent_chain_wallets.sql
git commit -m "feat(db): add per-agent chain wallet binding"
```

---

### Task 2: Wallet provisioning module `[B1, B2]`

**Files:**
- Create: `apps/api/src/engines/payments/agent-wallets.ts`
- Test: `apps/api/test/payments/agent-wallets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { enqueueAgentWalletProvisioning, recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';

describe('agent wallet provisioning', () => {
  it('enqueues one job per requested chain', async () => {
    const { orgId, agentId, pool } = await setupAgentFixture();

    await enqueueAgentWalletProvisioning(pool, {
      orgId, agentId, mode: 'test', chains: ['arc', 'base'], createdBy: 'usr_1',
    });

    const jobs = await pool.query(
      `SELECT chain FROM circle_provider_jobs
        WHERE org_id = $1 AND job_type = 'agent_wallet.create' ORDER BY chain`,
      [orgId],
    );
    expect(jobs.rows.map((r) => r.chain)).toEqual(['arc', 'base']);
  });

  it('binds distinct agents to distinct wallets', async () => {
    const { orgId, agentId, siblingAgentId, pool } = await setupAgentFixture();

    await recordProvisionedWallet(pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_1', address: '0xaaa', refId: 'ref_a',
      walletSetId: 'ws_1', circleBlockchain: 'ARC-TESTNET',
    });
    await recordProvisionedWallet(pool, {
      orgId, agentId: siblingAgentId, mode: 'test', chain: 'arc',
      circleWalletId: 'w_2', address: '0xbbb', refId: 'ref_b',
      walletSetId: 'ws_1', circleBlockchain: 'ARC-TESTNET',
    });

    const rows = await pool.query(
      'SELECT agent_id, address FROM agent_chain_wallets WHERE org_id = $1 ORDER BY agent_id',
      [orgId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].address).not.toBe(rows.rows[1].address);
  });

  it('allows the same agent on two chains sharing one address', async () => {
    const { orgId, agentId, pool } = await setupAgentFixture();

    for (const chain of ['arc', 'base'] as const) {
      await recordProvisionedWallet(pool, {
        orgId, agentId, mode: 'test', chain,
        circleWalletId: `w_${chain}`, address: '0xsame', refId: 'ref_a',
        walletSetId: 'ws_1', circleBlockchain: chain === 'arc' ? 'ARC-TESTNET' : 'BASE-SEPOLIA',
      });
    }

    const rows = await pool.query(
      'SELECT chain, address FROM agent_chain_wallets WHERE agent_id = $1 ORDER BY chain',
      [agentId],
    );
    expect(rows.rows).toHaveLength(2);
    // Same refId => same address; balances are still per-chain state.
    expect(rows.rows[0].address).toBe(rows.rows[1].address);
  });

  it('rejects a non-EOA account type at the database level', async () => {
    const { orgId, agentId, pool } = await setupAgentFixture();
    await expect(pool.query(
      `INSERT INTO agent_chain_wallets
         (id, org_id, agent_id, wallet_set_id, mode, chain, circle_blockchain,
          circle_wallet_id, address, account_type, ref_id)
       VALUES ('acw_bad', $1, $2, 'ws_1', 'test', 'arc', 'ARC-TESTNET',
               'w_x', '0xccc', 'sca', 'ref_x')`,
      [orgId, agentId],
    )).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/payments/agent-wallets.test.ts --root apps/api
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `agent-wallets.ts`**

```ts
import type pg from 'pg';
import type { PaymentChain, PaymentMode } from './types.js';
import { prefixedId } from '../identity/ids.js';   // match the existing id helper

export type AgentChainWalletRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly chain: PaymentChain;
  readonly circle_wallet_id: string;
  readonly address: string;
  readonly status: string;
};

export async function enqueueAgentWalletProvisioning(
  db: pg.Pool,
  input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly mode: PaymentMode;
    readonly chains: readonly PaymentChain[];
    readonly createdBy: string;
  },
): Promise<void> {
  for (const chain of input.chains) {
    await db.query(
      `INSERT INTO circle_provider_jobs
         (id, org_id, mode, job_type, chain, status, metadata, created_by)
       VALUES ($1, $2, $3, 'agent_wallet.create', $4, 'queued', $5::jsonb, $6)`,
      [
        prefixedId('cjob'),
        input.orgId,
        input.mode,
        chain,
        JSON.stringify({ agent_id: input.agentId }),
        input.createdBy,
      ],
    );
  }
}

export async function recordProvisionedWallet(
  db: pg.Pool,
  input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly mode: PaymentMode;
    readonly chain: PaymentChain;
    readonly circleWalletId: string;
    readonly address: string;
    readonly refId: string;
    readonly walletSetId: string;
    readonly circleBlockchain: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO agent_chain_wallets
       (id, org_id, agent_id, wallet_set_id, mode, chain, circle_blockchain,
        circle_wallet_id, address, ref_id, status, provisioned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', now())
     ON CONFLICT (agent_id, mode, chain) DO NOTHING`,
    [
      prefixedId('acw'), input.orgId, input.agentId, input.walletSetId,
      input.mode, input.chain, input.circleBlockchain,
      input.circleWalletId, input.address, input.refId,
    ],
  );
}

export async function findAgentWallet(
  db: pg.Pool | pg.PoolClient,
  agentId: string,
  mode: PaymentMode,
  chain: PaymentChain,
): Promise<AgentChainWalletRow | null> {
  const result = await db.query<AgentChainWalletRow>(
    `SELECT * FROM agent_chain_wallets
      WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'`,
    [agentId, mode, chain],
  );
  return result.rows[0] ?? null;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/payments/agent-wallets.test.ts --root apps/api
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/engines/payments/agent-wallets.ts apps/api/test/payments/agent-wallets.test.ts
git commit -m "feat(payments): add per-agent wallet provisioning records"
```

---

### Task 3: Worker handler and agent-creation trigger `[B1]`

**Files:**
- Modify: `apps/api/src/circle-worker.ts`
- Modify: `apps/api/src/engines/identity/store.ts`

Provisioning belongs behind the **worker boundary**, not in the public API process — creating a wallet is a slow external call that must not block an HTTP request, and the worker already holds the per-org advisory lock.

- [ ] **Step 1: Write the failing test**

```ts
it('provisions a wallet when the worker processes the job', async () => {
  const { orgId, agentId, pool } = await setupAgentFixture();
  await enqueueAgentWalletProvisioning(pool, {
    orgId, agentId, mode: 'test', chains: ['arc'], createdBy: 'usr_1',
  });

  await runWorkerPassWithFakeProvider(pool, {
    createWallet: async () => ({ walletId: 'w_1', address: '0xabc', accountType: 'EOA' }),
  });

  const wallet = await findAgentWallet(pool, agentId, 'test', 'arc');
  expect(wallet?.address).toBe('0xabc');
  expect(wallet?.status).toBe('active');

  const job = await pool.query(
    "SELECT status FROM circle_provider_jobs WHERE job_type = 'agent_wallet.create'",
  );
  expect(job.rows[0].status).toBe('complete');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/payments/agent-wallets.test.ts --root apps/api
```

- [ ] **Step 3: Implement**

In `apps/api/src/circle-worker.ts`, extend the existing job dispatch (around `:94`, inside `withPostgresCircleOrgLock`) with an `agent_wallet.create` branch. Follow the shape of the existing handlers — call the provider's `createWallet`, then `recordProvisionedWallet`, then mark the job `complete`; on error, set `status='failed'` with `error_code`, exactly as siblings do.

Pin `accountType: 'EOA'` in the provider call. The DB CHECK will reject anything else, but failing at the call site gives a clearer error.

In `apps/api/src/engines/identity/store.ts`, at the end of the agent-creation transaction, call `enqueueAgentWalletProvisioning` when the agent's payment account has `dedicated_wallet_required = true`. That flag already exists (`0009:57`) and is currently stored but never acted on — this gives it its meaning.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/payments/agent-wallets.test.ts --root apps/api
npm test --workspace @agentops-pmoa/api
```

- [ ] **Step 5: Verify against real Arc testnet**

```bash
CIRCLE_TREASURY_PROVIDER=developer_controlled npm run dev:circle-worker
```
Create an agent with `dedicated_wallet_required = true`. Confirm a real wallet appears, and **open its address on `testnet.arcscan.app`**.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/circle-worker.ts apps/api/src/engines/identity/store.ts apps/api/test
git commit -m "feat(payments): provision agent wallets from the Circle worker"
```

---

## Chunk 2: M7 + M8 — Balance-backed budgets with gas headroom `[manifest B3, B4, C3]`

M7 and M8 are combined: spendable balance is meaningless without the gas carve-out, and shipping M7 alone would let an agent brick itself.

**⚠️ Sequencing:** Phase 5's M12 edits the **same function** (`preparePaidHttpPayment`). Do not run these two phases in parallel.

### Task 4: Balance check in the budget path `[B3, B4, C3]`

**Files:**
- Modify: `apps/api/src/engines/payments/store.ts:4885-4890`
- Modify: `apps/api/src/engines/payments/agent-wallets.ts` (add balance read)
- Test: `apps/api/test/payments/agent-wallets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('balance-backed budget ceiling', () => {
  it('rejects when the wallet holds less than the counters allow', async () => {
    const { agentId, request } = await setupFundedAgent({
      budgetUsdc: '10.00',      // counters say $10 is fine
      walletBalanceUsdc: '2.00', // the chain says otherwise
      gasReserveUsdc: '0.50',
    });

    const response = await request.paidHttp({ agentId, amountUsdc: '5.00' });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('insufficient_agent_wallet_balance');
  });

  it('still rejects on counters when the wallet is rich', async () => {
    const { agentId, request } = await setupFundedAgent({
      budgetUsdc: '1.00',
      walletBalanceUsdc: '100.00',
      gasReserveUsdc: '0.50',
    });

    const response = await request.paidHttp({ agentId, amountUsdc: '5.00' });

    // The counter pre-filter must still fire, with its own distinct code.
    expect(response.json().code).toBe('budget_exceeded');
  });

  it('treats the gas reserve as unspendable', async () => {
    const { agentId, request } = await setupFundedAgent({
      budgetUsdc: '10.00',
      walletBalanceUsdc: '1.00',
      gasReserveUsdc: '0.50',
    });

    // $1.00 balance minus $0.50 reserve => only $0.50 spendable.
    const response = await request.paidHttp({ agentId, amountUsdc: '0.75' });

    expect(response.json().code).toBe('insufficient_agent_wallet_balance');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/payments/agent-wallets.test.ts --root apps/api
```
Expected: FAIL — payment succeeds; only counters are consulted.

- [ ] **Step 3: Add the balance read**

Append to `agent-wallets.ts`. **Use S6's answer** for which RPC call is authoritative:

```ts
/**
 * Spendable balance for budget decisions.
 *
 * On Arc, USDC IS the native gas asset -- the ERC-20 view and the native
 * balance are the same pool, and the ERC-20 view TRUNCATES (constraint I.8).
 * A balanceOf of 0 does NOT mean zero native balance. Gas decisions must
 * therefore read the native balance. See docs/spike-results.md (S6).
 *
 * Spendable = balance - gasReserve. Never compare against the raw balance:
 * an agent that spends to zero on Arc cannot transact at all, cannot be
 * swept, and is bricked.
 */
export async function readSpendableMicros(
  wallet: AgentChainWalletRow,
  gasReserveMicros: bigint,
  deps: { readonly nativeBalanceMicros: (address: string, chain: PaymentChain) => Promise<bigint> },
): Promise<bigint> {
  const balance = await deps.nativeBalanceMicros(wallet.address, wallet.chain);
  const spendable = balance - gasReserveMicros;
  return spendable > 0n ? spendable : 0n;
}
```

> **Do not build a cache here.** `balances-cache.ts` already exists and is wired to Redis in `server.ts:19`, degrading gracefully when Redis is down. If it fits the per-agent grain, call it. If it does not, read directly. Adding new caching infrastructure is out of scope for this build.

- [ ] **Step 4: Wire it into the budget check**

In `store.ts`, immediately **after** the existing counter check at `:4885-4890` — keep that block exactly as it is:

```ts
    const budget = parseUsdcMicros(account.budget_usdc);
    const spent = parseUsdcMicros(account.spent_usdc);
    const reserved = parseUsdcMicros(account.reserved_usdc);
    if (spent + reserved + quote.amountMicros > budget) {
      throw conflict('budget_exceeded', 'Payment amount exceeds the agent budget.');
    }

    // Authoritative ceiling: the agent's own on-chain balance. The counters
    // above are a fast pre-filter and an intent record; this is the bound
    // that survives a total compromise of this system, because anyone can
    // verify it by RPC without trusting us.
    const agentWallet = await findAgentWallet(client, auth.agent_id, mode, quote.chain);
    if (agentWallet !== null) {
      const spendable = await readSpendableMicros(agentWallet, gasReserveMicros, balanceDeps);
      if (quote.amountMicros > spendable) {
        throw conflict(
          'insufficient_agent_wallet_balance',
          'Payment amount exceeds the agent wallet spendable balance.',
        );
      }
    }
```

> **`agentWallet === null` is deliberately permissive** — orgs that have not adopted per-agent wallets keep working on the shared org wallet. Once an agent *has* a wallet, the balance binds. Do not make a missing wallet a hard failure; that would break every existing org on upgrade.

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run test/payments/agent-wallets.test.ts --root apps/api
npm test --workspace @agentops-pmoa/api
```

- [ ] **Step 6: The proof test — run it against real Arc testnet**

This is the acceptance artifact for the pitch's central claim. A passing unit test is **not** sufficient for a claim whose whole value is third-party verifiability.

1. Fund an agent wallet with exactly **$1.00** on Arc testnet.
2. Attempt a **$2.00** payment. Confirm rejection with `insufficient_agent_wallet_balance`.
3. Open the wallet address on `testnet.arcscan.app` and confirm the balance independently.
4. Paste the address and tx links into `docs/spike-results.md`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/engines/payments/store.ts apps/api/src/engines/payments/agent-wallets.ts apps/api/test docs/spike-results.md
git commit -m "feat(payments): bound agent spending by on-chain wallet balance"
```

---

### Task 5: Gas headroom edge cases `[C3]`

**Files:**
- Test: `apps/api/test/payments/agent-wallets.test.ts`

The truncation trap deserves its own tests — this is the Arc-specific differentiator and the failure is silent.

- [ ] **Step 1: Write the tests**

```ts
describe('Arc gas headroom', () => {
  it('reports zero spendable rather than negative when balance is below the reserve', async () => {
    const spendable = await readSpendableMicros(
      { address: '0xabc', chain: 'arc' } as AgentChainWalletRow,
      500_000n,                                   // $0.50 reserve
      { nativeBalanceMicros: async () => 200_000n }, // $0.20 held
    );
    expect(spendable).toBe(0n);   // must clamp, never go negative
  });

  it('does not treat a truncated ERC-20 zero as an empty wallet', async () => {
    // Arc's ERC-20 view truncates: balanceOf can read 0 while native is
    // non-zero. Gas decisions must use the native read.
    const spendable = await readSpendableMicros(
      { address: '0xabc', chain: 'arc' } as AgentChainWalletRow,
      0n,
      { nativeBalanceMicros: async () => 1n },   // sub-cent, non-zero
    );
    expect(spendable).toBe(1n);
  });
});
```

- [ ] **Step 2: Run, implement if needed, verify**

```bash
npx vitest run test/payments/agent-wallets.test.ts --root apps/api
```

- [ ] **Step 3: Run the full gate**

```bash
npm run verify
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/payments/agent-wallets.test.ts
git commit -m "test(payments): cover Arc gas reserve edge cases"
```

---

## Phase 3 Done Criteria

- [ ] Migration 0025 applies cleanly on a DB already at 0024
- [ ] `circle_provider_jobs_job_type_check` still admits every previously-used job type
- [ ] Creating an agent with `dedicated_wallet_required` enqueues one job per chain
- [ ] The worker provisions a real Arc EOA wallet and writes an `active` row
- [ ] Distinct agents get **distinct addresses**, visible on `testnet.arcscan.app`
- [ ] One agent can hold Arc + Base rows sharing an address, with independent balances
- [ ] Inserting a `'sca'` row is rejected **by the database**
- [ ] A payment above the wallet's spendable balance is rejected with `insufficient_agent_wallet_balance`
- [ ] The counter pre-filter still fires, with its own distinct code
- [ ] The gas reserve is unspendable and clamps at zero
- [ ] Agents **without** a per-agent wallet still transact on the org wallet
- [ ] **The proof test is recorded with an explorer link**

**Only after every box is ticked** may you claim: *"Max loss is bounded by the agent's on-chain balance — verifiable by RPC, no trust in us required."* Before that, the claim is false.
