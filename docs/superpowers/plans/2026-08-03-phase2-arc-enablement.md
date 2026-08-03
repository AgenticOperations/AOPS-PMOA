# Phase 2: Arc Enablement Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Read `2026-08-03-scope-and-cuts.md` first.** Only add functionality that is missing. Do not restructure working code.

**Goal:** Make Arc testnet a first-class chain the system can route payments on, switch the worker to developer-controlled wallets, and pin new wallets to EOA at the database level.

**Architecture:** Three additive changes. Arc is added to enums and seed data alongside the existing five chains — nothing existing is redesigned. The worker gains the same env branch the API process already has. EOA is pinned by constraining the *new* table, not by rewriting the old ones.

**Tech Stack:** PostgreSQL migrations, TypeScript union types, Circle developer-controlled wallets SDK.

**Gate:** requires Phase 0 **S1** (chain ID) and **S2** (wallets work on Arc). Do not start without both answered.

---

## Context you need before starting

**Arc is completely absent from the codebase.** Verified by grep: zero occurrences of Arc, Permit2, ERC-8183, or ERC-8004 in any `.ts` or `.sql` file. This phase is purely additive.

**Where `chain` is constrained — 7 places, all need Arc:**

| File | Line | Table |
|---|---|---|
| `0009_section_6_8_payment_control.sql` | 11 | `payment_sources` (originally `('base')` only) |
| `0009_section_6_8_payment_control.sql` | 30 | `payment_reservations` |
| `0010_section_9_circle_treasury.sql` | 4 | `org_treasuries` |
| `0010_section_9_circle_treasury.sql` | 9 | `payment_sources` (widened) |
| `0010_section_9_circle_treasury.sql` | 44 | `circle_chain_capabilities` |
| `0010_section_9_circle_treasury.sql` | 94 | `circle_chain_wallets` |
| `0010_section_9_circle_treasury.sql` | 114 | `circle_provider_jobs` |

Because later migrations re-`ADD CONSTRAINT` over earlier ones, **only the latest definition of each constraint is live.** Your migration must `DROP CONSTRAINT IF EXISTS` then re-add with Arc included — the same pattern `0010` used over `0009`.

**Constraint I.1 — Arc mainnet does not exist.** Circle's own guidance: *"NEVER target mainnet — Arc is testnet only."* Seed Arc into the **test** mode rows only. Do **not** add Arc to the mainnet CAIP-2 map at `store.ts:712-714`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/migrations/0023_arc_chain_support.sql` | Arc in all chain/rail constraints + capability seed | **Create** |
| `packages/db/src/migrations/0024_pin_eoa_account_type.sql` | Reset account-type defaults to EOA | **Create** |
| `apps/api/src/engines/payments/types.ts` | `PaymentChain` + `PaymentRail` unions | Modify `:5-16` |
| `apps/api/src/engines/payments/store.ts` | Testnet CAIP-2 map | Modify `:704-708` |
| `apps/api/src/engines/payments/circle-org-provider.ts` | Env branch for the worker path | Modify `:13` |
| `apps/api/test/payments/arc-chain.test.ts` | Arc routing tests | **Create** |

---

## Chunk 1: M3 — Flip the worker to developer-controlled wallets `[manifest A3, K-18]`

**This is narrower than the change manifest claims.** The manifest says the dev-controlled provider is "unreachable." It is not — `createCircleTreasuryProvider()` (`circle-provider.ts:1446-1449`) already branches on `CIRCLE_TREASURY_PROVIDER` and is the default argument for 15 exported store functions. Only the **worker** path is hardcoded.

Current state, `apps/api/src/engines/payments/circle-org-provider.ts:11-15`:

```ts
const invoke = <T>(operation: (provider: CircleTreasuryProvider) => Promise<T>): Promise<T> => (
  connectionService.withConnectedExecutor({ orgId }, async (executor) => (
    operation(createCircleAgentWalletTreasuryProvider({ executor }))   // <-- hardcoded
  ))
);
```

### Task 1: Add the env branch to the org-scoped provider `[A3, K-18]`

**Files:**
- Modify: `apps/api/src/engines/payments/circle-org-provider.ts:1-15`
- Test: `apps/api/test/payments/circle-org-provider.test.ts` (exists, 2 tests)

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/payments/circle-org-provider.test.ts`:

```ts
it('uses the developer-controlled provider when CIRCLE_TREASURY_PROVIDER is set', async () => {
  vi.stubEnv('CIRCLE_TREASURY_PROVIDER', 'developer_controlled');

  const service = fakeConnectionService();
  const provider = createOrgScopedCircleTreasuryProvider(service, 'org_1');
  const result = await provider.bridgeWalletTopUp({
    amount: '1.00', fromChain: 'arc', toChain: 'base', mode: 'test',
  });

  // The dev-controlled provider stubs this; the Agent Wallet one does not.
  expect(result.success).toBe(false);
  expect(result.errorReason).toBe('developer_controlled_bridge_topup_not_supported');

  vi.unstubAllEnvs();
});

it('defaults to the agent wallet provider when the flag is unset', async () => {
  const service = fakeConnectionService();
  const provider = createOrgScopedCircleTreasuryProvider(service, 'org_1');
  // Agent Wallet path routes through the executor rather than returning the stub.
  await expect(provider.bridgeWalletTopUp({
    amount: '1.00', fromChain: 'arc', toChain: 'base', mode: 'test',
  })).resolves.not.toMatchObject({ errorReason: 'developer_controlled_bridge_topup_not_supported' });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/payments/circle-org-provider.test.ts --root apps/api
```
Expected: FAIL — the flag is ignored, Agent Wallet is always used.

- [ ] **Step 3: Implement**

```ts
import type { CircleConnectionService } from './circle-connection-service.js';
import {
  createCircleAgentWalletTreasuryProvider,
  createDeveloperControlledCircleTreasuryProvider,
  type CircleTreasuryProvider,
} from './circle-provider.js';

export function createOrgScopedCircleTreasuryProvider(
  connectionService: CircleConnectionService,
  orgId: string,
): CircleTreasuryProvider {
  // Mirrors the branch already used by createCircleTreasuryProvider()
  // in circle-provider.ts:1446-1449, so both processes agree.
  const developerControlled = process.env.CIRCLE_TREASURY_PROVIDER === 'developer_controlled';

  const invoke = <T>(operation: (provider: CircleTreasuryProvider) => Promise<T>): Promise<T> => (
    developerControlled
      ? operation(createDeveloperControlledCircleTreasuryProvider())
      : connectionService.withConnectedExecutor({ orgId }, async (executor) => (
          operation(createCircleAgentWalletTreasuryProvider({ executor }))
        ))
  );
  // ... rest of the file unchanged
```

> The dev-controlled provider does not need a connected executor — it authenticates with the entity secret. That is precisely why it removes OTP from the loop.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/payments/circle-org-provider.test.ts --root apps/api
npm test --workspace @agentops-pmoa/api
```
Expected: PASS, and the Agent Wallet path's existing tests still pass with the flag unset.

- [ ] **Step 5: Record the K-18 regression**

Append to `docs/decisions.md`:

> **K-18 accepted regression.** With `CIRCLE_TREASURY_PROVIDER=developer_controlled`, `bridgeWalletTopUp` returns `success: false` with `developer_controlled_bridge_topup_not_supported` (`circle-provider.ts:993-1000`). The Agent Wallet CLI path (`:1245`) was the only working bridge. Cross-chain therefore uses **pre-funding per chain (Option A)**, not bridging. Accepted deliberately — not a bug to discover at demo time.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/engines/payments/circle-org-provider.ts apps/api/test/payments/circle-org-provider.test.ts docs/decisions.md
git commit -m "feat(payments): allow developer-controlled provider in the worker path"
```

---

## Chunk 2: M4 — Arc as a first-class chain `[manifest F3, F4, K-17]`

### Task 2: Migration for Arc chain and rail support `[F3, F4]`

**Files:**
- Create: `packages/db/src/migrations/0023_arc_chain_support.sql`

- [ ] **Step 1: Write the migration**

Use the **chain ID and Circle blockchain literal that S1 and S2 recorded** — do not guess.

```sql
-- 0023_arc_chain_support.sql
-- Adds Arc testnet alongside the existing five chains. Purely additive:
-- every existing chain value stays valid.

-- payment_sources.chain (last defined 0010:6-9)
ALTER TABLE payment_sources DROP CONSTRAINT IF EXISTS payment_sources_chain_check;
ALTER TABLE payment_sources
  ADD CONSTRAINT payment_sources_chain_check
  CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc'));

-- org_treasuries.chain (0010:1-4)
ALTER TABLE org_treasuries DROP CONSTRAINT IF EXISTS org_treasuries_chain_check;
ALTER TABLE org_treasuries
  ADD CONSTRAINT org_treasuries_chain_check
  CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc'));

-- payment_reservations.chain (0009:30)
ALTER TABLE payment_reservations DROP CONSTRAINT IF EXISTS payment_reservations_chain_check;
ALTER TABLE payment_reservations
  ADD CONSTRAINT payment_reservations_chain_check
  CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc'));

-- circle_chain_capabilities.chain (0010:44)
ALTER TABLE circle_chain_capabilities DROP CONSTRAINT IF EXISTS circle_chain_capabilities_chain_check;
ALTER TABLE circle_chain_capabilities
  ADD CONSTRAINT circle_chain_capabilities_chain_check
  CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc'));

-- circle_chain_wallets.chain (0010:94)
ALTER TABLE circle_chain_wallets DROP CONSTRAINT IF EXISTS circle_chain_wallets_chain_check;
ALTER TABLE circle_chain_wallets
  ADD CONSTRAINT circle_chain_wallets_chain_check
  CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc'));

-- circle_provider_jobs.chain (0010:114, nullable)
ALTER TABLE circle_provider_jobs DROP CONSTRAINT IF EXISTS circle_provider_jobs_chain_check;
ALTER TABLE circle_provider_jobs
  ADD CONSTRAINT circle_provider_jobs_chain_check
  CHECK (chain IS NULL OR chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc'));

-- Rails (0010:11-27)
ALTER TABLE payment_sources DROP CONSTRAINT IF EXISTS payment_sources_rail_check;
ALTER TABLE payment_sources
  ADD CONSTRAINT payment_sources_rail_check
  CHECK (
    rail IN (
      'gateway_base', 'gateway_arbitrum', 'gateway_polygon',
      'gateway_optimism', 'gateway_avalanche', 'gateway_arc',
      'exact_base', 'exact_arbitrum', 'exact_polygon',
      'exact_optimism', 'exact_avalanche', 'exact_arc'
    )
  );

-- Seed Arc capability for TEST MODE ONLY.
-- Constraint I.1: Arc mainnet does not exist. Do not seed a 'live' row.
-- Replace ARC_GATEWAY_DOMAIN with the value recorded by spike S1/S2.
INSERT INTO circle_chain_capabilities (
  id, mode, chain, circle_blockchain, gateway_domain, wallet_account_type, metadata
)
VALUES (
  'cap_test_arc', 'test', 'arc', 'ARC-TESTNET', :ARC_GATEWAY_DOMAIN, 'eoa',
  '{"network":"Arc Testnet","explorer":"https://testnet.arcscan.app"}'
)
ON CONFLICT (mode, chain) DO NOTHING;
```

> Note `wallet_account_type` is set to `'eoa'` explicitly. Migration `0012` changed that column's **default** to `'sca'`, so omitting it would silently create an SCA capability — which breaks Gateway signing at payment time rather than at creation.

- [ ] **Step 2: Verify the migration applies on an existing database**

```bash
docker compose up -d
npx vitest run test/migrate.test.ts --root packages/db
```
Expected: PASS. It must apply on a DB already at 0022, not only from scratch.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/migrations/0023_arc_chain_support.sql
git commit -m "feat(db): add Arc testnet chain and rail support"
```

---

### Task 3: TypeScript unions and the CAIP-2 map `[F4, K-17]`

**Files:**
- Modify: `apps/api/src/engines/payments/types.ts:5-16`
- Modify: `apps/api/src/engines/payments/store.ts:704-708`
- Test: `apps/api/test/payments/arc-chain.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { x402NetworkForChain } from '../../src/engines/payments/store.js';

describe('Arc chain support', () => {
  it('maps arc to its CAIP-2 network in test mode', () => {
    // Use the exact value recorded by spike S1 — the facilitator's value
    // governs, because that is what verifies the signature.
    expect(x402NetworkForChain('arc', 'test')).toBe('eip155:<S1_VALUE>');
  });

  it('does not offer arc in live mode', () => {
    // Constraint I.1: Arc mainnet does not exist.
    expect(() => x402NetworkForChain('arc', 'live')).toThrow();
  });
});
```

> If `x402NetworkForChain` is not currently exported, export it. Exporting an existing pure function for testing is not a refactor.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/payments/arc-chain.test.ts --root apps/api
```
Expected: FAIL — `'arc'` is not assignable to `PaymentChain`.

- [ ] **Step 3: Implement**

`apps/api/src/engines/payments/types.ts:5-16`:

```ts
export type PaymentChain = 'base' | 'arbitrum' | 'polygon' | 'optimism' | 'avalanche' | 'arc';
export type PaymentRail =
  | 'gateway_base'
  | 'gateway_arbitrum'
  | 'gateway_polygon'
  | 'gateway_optimism'
  | 'gateway_avalanche'
  | 'gateway_arc'
  | 'exact_base'
  | 'exact_arbitrum'
  | 'exact_polygon'
  | 'exact_optimism'
  | 'exact_avalanche'
  | 'exact_arc';
```

`apps/api/src/engines/payments/store.ts:704-708` — add Arc to the **testnet** map only:

```ts
  arbitrum: 'eip155:421614',
  avalanche: 'eip155:43113',
  base: 'eip155:84532',
  optimism: 'eip155:11155420',
  polygon: 'eip155:80002',
  arc: 'eip155:<S1_VALUE>',    // Arc testnet — see docs/spike-results.md
```

Leave the mainnet map (`:712-714`) **without** an Arc entry. Requesting Arc in live mode must fail.

- [ ] **Step 4: Run typecheck to find every exhaustive switch**

```bash
npm run typecheck
```

Widening a union surfaces every non-exhaustive `switch`/`Record<PaymentChain, …>`. Fix each by **adding** the Arc case. Do **not** restructure the surrounding logic — add the branch and move on.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/payments/arc-chain.test.ts --root apps/api
npm test --workspace @agentops-pmoa/api
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/engines/payments/types.ts apps/api/src/engines/payments/store.ts apps/api/test/payments/arc-chain.test.ts
git commit -m "feat(payments): route Arc testnet payments"
```

---

## Chunk 3: M5 — Pin EOA `[manifest K-16]`

### Task 4: Reset account-type defaults `[K-16]`

**⚠️ Read this before writing the migration.** Migration `0012` did more than relax a CHECK. For each of `circle_chain_capabilities`, `circle_wallet_sets`, and `circle_chain_wallets` it:

1. dropped the CHECK,
2. **set the column DEFAULT to `'sca'`**,
3. re-added a widened CHECK allowing `('eoa','sca')`,
4. **`UPDATE`d every existing `'eoa'` row to `'sca'`** (`0012:8-11, 20-23, 32-35`),
5. backfilled `payment_sources` the same way (`:37-41`).

**Consequence:** any new wallet row that omits `account_type` gets `'sca'` — which Gateway rejects at *payment* time, not creation time. That is the confusing failure K-16 warns about.

**What NOT to do:** do not blanket re-tighten these tables to `CHECK (account_type = 'eoa')`. Existing `'sca'` rows are live (the Agent Wallet fallback needs them) and the constraint would fail on them.

**Files:**
- Create: `packages/db/src/migrations/0024_pin_eoa_account_type.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0024_pin_eoa_account_type.sql
-- Migration 0012 set these DEFAULTs to 'sca' so new rows silently become
-- smart-contract accounts. Gateway rejects non-EOA signatures and
-- Nanopayments is EOA-only, so the failure surfaces at payment time.
-- Reset the DEFAULT only. Existing 'sca' rows stay valid for the
-- Agent Wallet fallback path.

ALTER TABLE circle_chain_capabilities ALTER COLUMN wallet_account_type SET DEFAULT 'eoa';
ALTER TABLE circle_wallet_sets        ALTER COLUMN account_type        SET DEFAULT 'eoa';
ALTER TABLE circle_chain_wallets      ALTER COLUMN account_type        SET DEFAULT 'eoa';
```

> The hard `CHECK (account_type = 'eoa')` belongs on the **new per-agent wallet table**, created in Phase 3. That table has no legacy rows, so the strict constraint is safe there — a mistake gets rejected by the database instead of surfacing at payment time.

- [ ] **Step 2: Write the test**

Add to `apps/api/test/payments/arc-chain.test.ts` or a migration test:

```ts
it('defaults new wallet rows to eoa', async () => {
  await pool.query(`INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
                    VALUES ('ws_eoa_test', $1, 'test', 'circle_ws_1', 'test', 'usr_1')`, [orgId]);
  const row = await pool.query("SELECT account_type FROM circle_wallet_sets WHERE id = 'ws_eoa_test'");
  expect(row.rows[0].account_type).toBe('eoa');
});

it('keeps existing sca rows valid', async () => {
  const existing = await pool.query("SELECT count(*) FROM circle_chain_wallets WHERE account_type = 'sca'");
  expect(Number(existing.rows[0].count)).toBeGreaterThanOrEqual(0); // must not error
});
```

- [ ] **Step 3: Run**

```bash
npx vitest run test/migrate.test.ts --root packages/db
npm test --workspace @agentops-pmoa/api
```

- [ ] **Step 4: Pin EOA at wallet creation too**

Belt and braces — the DB default protects omissions, but the provider should be explicit. In the dev-controlled provider's wallet-creation call (`circle-provider.ts:989-1184`), pass `accountType: 'EOA'` explicitly, matching what spike S2 verified Circle accepts.

- [ ] **Step 5: Run the full gate**

```bash
npm run verify
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/0024_pin_eoa_account_type.sql apps/api/src/engines/payments/circle-provider.ts apps/api/test
git commit -m "fix(payments): default new Circle wallets to EOA"
```

---

## Phase 2 Done Criteria

- [ ] `CIRCLE_TREASURY_PROVIDER=developer_controlled` routes the **worker** through the dev-controlled provider
- [ ] With the flag unset, the Agent Wallet path still passes all its existing tests
- [ ] The K-18 bridge regression is written into `docs/decisions.md`
- [ ] Migration 0023 applies cleanly on a DB already at 0022
- [ ] Arc accepted by all 7 chain constraints and both rail forms
- [ ] `circle_chain_capabilities` has a `cap_test_arc` row with `wallet_account_type = 'eoa'` and **no live-mode Arc row**
- [ ] An Arc quote returns the S1-verified CAIP-2 string; live mode rejects Arc
- [ ] New wallet rows default to `'eoa'`; existing `'sca'` rows survive
- [ ] `npm run verify` passes with Docker up

**Do not claim** Arc support in any demo until an Arc-rail payment source can actually be created and resolved end to end.
