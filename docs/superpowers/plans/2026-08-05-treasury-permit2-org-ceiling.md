# Treasury-Funded Permit2 Delegations with an Org-Wide Ceiling — Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the org treasury the single Permit2 payer, so every agent draws from one shared pool against its own on-chain capped allowance, bounded by an org-wide ceiling.

**Architecture:** The operator funds the org treasury wallet (a Circle developer-controlled wallet) from their own MetaMask. The treasury becomes the Permit2 *owner*; each agent's wallet is a Permit2 *spender* holding almost nothing. Per-agent isolation comes from `allowance[treasury][USDC][agentAddress]`, which Permit2 keys by spender address. The org-wide ceiling is enforced in two places: a configured per-org+mode+chain cap checked before any delegation is issued, and the treasury's ERC-20 approval to Permit2, which is maintained at the *sum* of outstanding delegation headroom.

**Tech Stack:** TypeScript, Fastify, Postgres (raw SQL, node-pg), viem, Circle developer-controlled wallets SDK, Next.js App Router, wagmi, Vitest + Testcontainers.

---

## Context You Need Before Starting

Read these first. The plan assumes you know them.

- `docs/decision-wallet-model.md` — why developer-controlled wallets, and the exact custody wording this feature must not overstate.
- `apps/api/src/engines/payments/permit2.ts` — the whole delegation lifecycle lives here.
- `apps/api/src/engines/payments/agent-funding.ts` — just-in-time funding, 82 lines, read all of it.

### Permit2 facts that drive every decision

1. **Allowances are keyed `allowance[owner][token][spender]`.** Isolation is *by spender address*. Two agents sharing one address share one allowance and have zero isolation. This is why each agent keeps its own wallet even though the money lives in the treasury.
2. **`transferFrom` requires `msg.sender == spender`.** `drawDown` already submits with `senderAddress: delegation.payee_address` ([permit2.ts:510](../../../apps/api/src/engines/payments/permit2.ts#L510)). The agent submits its own drawdown, so **every agent wallet needs gas**.
3. **The nonce is per `(owner, token, spender)` triple.** Different agents never collide. `readPermit2Nonce` already reads it live — do not assume 0.
4. **ERC-20 `approve` SETS, it does not add.** This is the critical bug — see Task 3.

### Custody, stated honestly

The treasury is **custodial** — the platform holds the entity secret that signs for it. The Permit2 ceiling constrains what a **compromised or misbehaving agent** can take; it is not protection against a compromised platform, which holds the treasury key directly. Say it that way in UI copy. `docs/decision-wallet-model.md` was careful about this and this feature must not quietly undo it.

### Multichain reality

- Backend knows 6 chains (`PERMIT2_DOMAIN_CHAIN_ID`, permit2.ts:237). Frontend wallet layer knows **2**: `arc` and `base` (`SupportedChainKey`, `apps/web/src/lib/wallet-chains.ts`).
- **Permit2 allowances are per-chain.** Therefore the org ceiling is **per org + mode + chain**, never one global number. Do not design a single global cap.
- Agent wallets share one address across chains (Circle `deriveWallet`, K-13). **Treasury wallets do not** — `ensureCircleTreasury` creates each independently, so treasury addresses differ per chain.
- **Gas:** on Arc, USDC *is* the native gas asset, so one USDC transfer bootstraps both gas and float. On Base an agent needs ETH, which the provider exposes no method to send. **Arc is the tested target.** Base delegations will work only if the agent wallet already has ETH; surface that rather than pretending otherwise (`FundingHierarchy` already tells the user this).

### Running things

```bash
# API tests (needs Docker for Testcontainers)
npm run test --workspace @agentops-pmoa/api
# One file
cd apps/api && npx vitest run test/payments/permit2.test.ts
# Typecheck / lint / build
npm run build:packages && npm run typecheck --workspace @agentops-pmoa/api
npm run lint
```

Migrations are plain SQL in `packages/db/src/migrations/NNNN_name.sql`, applied in filename order. The highest existing is `0029_delegation_payer_address.sql`.

---

## File Structure

**Create:**
- `packages/db/src/migrations/0030_treasury_payer_and_org_ceiling.sql` — `payer_kind` discriminator + `org_delegation_ceilings` table.
- `apps/api/src/engines/payments/delegation-ceiling.ts` — outstanding-headroom sum, org ceiling read/write, solvency check. One responsibility: *how much more may this org delegate on this chain?*
- `apps/api/test/payments/delegation-ceiling.test.ts`
- `apps/web/src/components/payments/OrgCeilingForm.tsx` — set the per-chain org ceiling.
- `apps/web/src/components/payments/DelegateFromTreasury.tsx` — replaces the MetaMask signing flow with a plain form.

**Modify:**
- `apps/api/src/engines/payments/permit2.ts` — treasury payer branch, summed approve, ceiling enforcement, `payer_kind` write.
- `apps/api/src/engines/payments/agent-funding.ts` — find treasury delegations, gas floor bootstrap.
- `apps/api/src/engines/payments/routes.ts` — treasury delegation route, org ceiling routes.
- `apps/web/src/app/app/[orgSlug]/payments/delegations/page.tsx` — swap in the new components.
- `apps/web/src/lib/server/payments-client.ts` — client fns for the new routes.

**Deliberately unchanged:** `DelegateToAgent.tsx` and the `userSigned` path in `recordSignedDelegation` stay in the repo. They are the reference implementation if a fully non-custodial mode is wanted later. They just stop being reachable from the console.

---

## Chunk 1: Data model and the treasury payer

### Task 1: Migration — `payer_kind` and the org ceiling table

**Why `payer_kind`:** today a treasury payer and a MetaMask payer would *both* have `payer_agent_id IS NULL`, so they are indistinguishable. `agent-funding.ts:67` keys off exactly that column, and would happily draw against the wrong kind of delegation. A discriminator is required, not cosmetic.

**Files:**
- Create: `packages/db/src/migrations/0030_treasury_payer_and_org_ceiling.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0030_treasury_payer_and_org_ceiling.sql
-- Treasury-funded delegations plus the org-wide ceiling that bounds them.
--
-- payer_kind exists because payer_agent_id IS NULL was doing double duty:
-- it marked a user-owned wallet, and a treasury payer would look identical.
-- agent-funding.ts selects on exactly that predicate, so without a real
-- discriminator just-in-time funding would draw against the wrong payer.

ALTER TABLE agent_delegations
  ADD COLUMN payer_kind text NOT NULL DEFAULT 'user'
    CHECK (payer_kind IN ('user', 'agent', 'treasury'));

-- Existing rows: a non-null payer_agent_id always meant an agent wallet the
-- platform controls. Everything else was the operator's own wallet.
UPDATE agent_delegations SET payer_kind = 'agent' WHERE payer_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_delegations_payer_kind_idx
  ON agent_delegations (org_id, payer_kind, mode, chain, status);

-- The org-wide ceiling. Per chain, NOT global: a Permit2 allowance lives on
-- one chain, so a single cross-chain number could never be enforced on-chain
-- and would be a comforting lie.
CREATE TABLE IF NOT EXISTS org_delegation_ceilings (
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL
    CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  ceiling_usdc numeric(20, 6) NOT NULL CHECK (ceiling_usdc >= 0),
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, mode, chain)
);
```

- [ ] **Step 2: Verify it applies**

Run: `npm run build --workspace @agentops-pmoa/db && cd apps/api && npx vitest run test/payments/permit2.test.ts`
Expected: PASS. The existing suite bootstraps a fresh Postgres and applies every migration; a syntax error surfaces here.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/migrations/0030_treasury_payer_and_org_ceiling.sql
git commit -m "feat(db): add payer_kind discriminator and per-chain org delegation ceiling"
```

---

### Task 2: Treasury as a Permit2 payer

**Files:**
- Modify: `apps/api/src/engines/payments/permit2.ts:203-230` (input type), `:301-330` (payer resolution), `:426-444` (insert)
- Test: `apps/api/test/payments/permit2.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/payments/permit2.test.ts`. Follow the existing `fakeProvider` helper and Testcontainers setup already in that file.

```ts
it('resolves the org treasury wallet as payer when payerTreasury is set', async () => {
  const suffix = 'treasurypayer';
  // Seed org + treasury wallet in circle_chain_wallets (NOT agent_chain_wallets).
  // Reuse whatever org/agent seeding helper the surrounding tests already use.
  const { orgId, payeeAgentId, payeeAddress } = await seedOrgWithAgent(suffix);
  await store.pool.query(
    `INSERT INTO circle_chain_wallets
       (id, org_id, wallet_set_id, mode, chain, circle_blockchain,
        circle_wallet_id, address, account_type, metadata)
     VALUES ($1, $2, $3, 'test', 'arc', 'ARC-TESTNET', $4, $5, 'sca', '{}'::jsonb)`,
    [`cwallet_${suffix}`, orgId, `cws_${suffix}`, `circlewallet_${suffix}`, '0xTREASURY'],
  );

  const provider = fakeProvider();
  const delegation = await recordSignedDelegation(store.pool, provider, {
    orgId,
    payeeAgentId,
    payeeAddress,
    mode: 'test',
    chain: 'arc',
    ceilingUsdc: '10.00',
    expiresAt: new Date(Date.now() + 86_400_000),
    approvedBy: 'actor_test',
    payerTreasury: true,
  });

  expect(delegation.payer_address).toBe('0xTREASURY');
  expect(delegation.payer_kind).toBe('treasury');
  expect(delegation.payer_agent_id).toBeNull();
  // The platform signs for the treasury; it is not a user-signed delegation.
  expect(provider.signPermit2Delegation).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/api && npx vitest run test/payments/permit2.test.ts -t 'treasury wallet as payer'`
Expected: FAIL — `payerTreasury` is not a known property.

- [ ] **Step 3: Add `payerTreasury` to the input type**

In `RecordSignedDelegationInput` (permit2.ts ~:203):

```ts
  // Draws from the ORG TREASURY rather than an agent or a user wallet.
  // Mutually exclusive with userSigned and payerAgentId: the treasury is a
  // platform-controlled wallet, so the platform signs the permit itself.
  readonly payerTreasury?: boolean | undefined;
```

- [ ] **Step 4: Add the payer resolution branch**

Replace the payer resolution block at permit2.ts:309-323:

```ts
    // Three payer kinds, resolved to one address. Everything downstream
    // works off payerAddress alone; payerKind is recorded so just-in-time
    // funding can tell a treasury delegation from a user-owned one --
    // payer_agent_id IS NULL is true for BOTH and cannot discriminate.
    let payerAddress: string;
    let payerKind: 'user' | 'agent' | 'treasury';
    if (input.userSigned !== undefined) {
      payerAddress = input.userSigned.payerAddress;
      payerKind = 'user';
    } else if (input.payerTreasury === true) {
      const treasury = await client.query<{ address: string }>(
        `SELECT address FROM circle_chain_wallets
          WHERE org_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
          LIMIT 1`,
        [input.orgId, input.mode, input.chain],
      );
      const treasuryRow = treasury.rows[0];
      if (treasuryRow === undefined) throw new Error('org_treasury_wallet_not_found');
      payerAddress = treasuryRow.address;
      payerKind = 'treasury';
    } else {
      if (input.payerAgentId === undefined) throw new Error('delegation_payer_required');
      const payer = await client.query<{ address: string }>(
        `SELECT address FROM agent_chain_wallets
          WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
          LIMIT 1`,
        [input.payerAgentId, input.mode, input.chain],
      );
      const payerRow = payer.rows[0];
      if (payerRow === undefined) throw new Error('agent_wallet_not_found');
      payerAddress = payerRow.address;
      payerKind = 'agent';
    }
```

- [ ] **Step 5: Persist `payer_kind`**

Add `payer_kind` to the INSERT column list and values at permit2.ts:426-440, and add `readonly payer_kind: 'user' | 'agent' | 'treasury';` to `AgentDelegationRow` (~:183).

- [ ] **Step 6: Run the test**

Run: `cd apps/api && npx vitest run test/payments/permit2.test.ts`
Expected: PASS, and every pre-existing test in the file still passes.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/engines/payments/permit2.ts apps/api/test/payments/permit2.test.ts
git commit -m "feat(permit2): allow the org treasury to be a delegation payer"
```

---

## Chunk 2: The approve bug and the org ceiling

### Task 3: Fix ERC-20 approve stomping

**This is the bug that makes the whole feature fail silently.** `approve(spender, amount)` **sets** the allowance. Today each payer is a different agent, so approvals never collide. With one treasury paying N agents, issuing delegation #2 resets the token allowance to *its own ceiling*, and agent #1's next drawdown reverts with `TRANSFER_FROM_FAILED` — the same failure mode spike S4 documented, but appearing later and looking unrelated.

The fix and the feature are the same thing: **approve the sum of outstanding delegation headroom.** That sum *is* the org's real on-chain exposure.

**Files:**
- Create: `apps/api/src/engines/payments/delegation-ceiling.ts`
- Create: `apps/api/test/payments/delegation-ceiling.test.ts`
- Modify: `apps/api/src/engines/payments/permit2.ts:377-385`

- [ ] **Step 1: Write the failing test**

`apps/api/test/payments/delegation-ceiling.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { outstandingHeadroomMicros } from '../../src/engines/payments/delegation-ceiling.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

describe('outstandingHeadroomMicros', () => {
  let store: PostgresTestStore;
  beforeAll(async () => { store = await startPostgres(); }, 90_000);
  afterAll(async () => { if (store !== undefined) await store.stop(); });

  it('sums remaining headroom across every active delegation for one payer', async () => {
    // Seed two active delegations from the same payer address:
    //   A: ceiling 10, drawn 4  -> 6 remaining
    //   B: ceiling 5,  drawn 0  -> 5 remaining
    // plus one revoked (ceiling 100) that must be ignored.
    const { orgId } = await seedTwoActiveAndOneRevoked(store.pool);
    const total = await outstandingHeadroomMicros(store.pool, {
      orgId, payerAddress: '0xTREASURY', mode: 'test', chain: 'arc',
      tokenAddress: '0x3600000000000000000000000000000000000000',
    });
    expect(total).toBe(11_000_000n);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/api && npx vitest run test/payments/delegation-ceiling.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `delegation-ceiling.ts`**

```ts
import type pg from 'pg';
import { parseUsdcMicros } from './permit2.js';
import type { PaymentChain, PaymentMode } from './types.js';

type Db = pg.Pool | pg.PoolClient;

export type PayerScope = {
  readonly orgId: string;
  readonly payerAddress: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly tokenAddress: string;
};

/**
 * Total UNDRAWN headroom across every live delegation from one payer.
 *
 * This is the number the payer's ERC-20 approval to Permit2 must cover.
 * ERC-20 approve SETS rather than adds, so approving only the newest
 * delegation's ceiling silently strips every earlier agent's ability to
 * draw -- they revert with TRANSFER_FROM_FAILED, far from the cause.
 *
 * Expired rows are excluded by expires_at rather than trusting status:
 * nothing sweeps 'active' rows to 'expired' on a timer, so status alone
 * would over-report headroom and over-approve.
 */
export async function outstandingHeadroomMicros(db: Db, scope: PayerScope): Promise<bigint> {
  const result = await db.query<{ outstanding: string }>(
    `SELECT COALESCE(SUM(ceiling_usdc - drawn_usdc), 0)::text AS outstanding
       FROM agent_delegations
      WHERE org_id = $1 AND payer_address = $2 AND mode = $3 AND chain = $4
        AND token_address = $5 AND status = 'active' AND expires_at > now()`,
    [scope.orgId, scope.payerAddress, scope.mode, scope.chain, scope.tokenAddress],
  );
  return parseUsdcMicros(result.rows[0]?.outstanding ?? '0');
}

/** The configured org-wide cap, or null when the org has not set one. */
export async function orgCeilingMicros(
  db: Db,
  input: { readonly orgId: string; readonly mode: PaymentMode; readonly chain: PaymentChain },
): Promise<bigint | null> {
  const result = await db.query<{ ceiling_usdc: string }>(
    `SELECT ceiling_usdc::text FROM org_delegation_ceilings
      WHERE org_id = $1 AND mode = $2 AND chain = $3`,
    [input.orgId, input.mode, input.chain],
  );
  const row = result.rows[0];
  return row === undefined ? null : parseUsdcMicros(row.ceiling_usdc);
}
```

- [ ] **Step 4: Run the test**

Run: `cd apps/api && npx vitest run test/payments/delegation-ceiling.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the summed approve**

In `apps/api/test/payments/permit2.test.ts`:

```ts
it('approves Permit2 for total outstanding headroom, not just the new ceiling', async () => {
  // An existing active treasury delegation of 10.00 USDC, undrawn.
  // Issuing a second for 5.00 must approve 15.00, never 5.00 -- approving
  // 5.00 would strip the first agent's ability to draw.
  const { orgId, payeeAgentId, payeeAddress } = await seedTreasuryWithExistingDelegation('sum', '10.00');
  const provider = fakeProvider();

  await recordSignedDelegation(store.pool, provider, {
    orgId, payeeAgentId, payeeAddress, mode: 'test', chain: 'arc',
    ceilingUsdc: '5.00',
    expiresAt: new Date(Date.now() + 86_400_000),
    approvedBy: 'actor_test',
    payerTreasury: true,
  });

  const approveCall = vi.mocked(provider.executePermit2Transaction).mock.calls
    .map(([arg]) => arg)
    .find((arg) => arg.abiFunctionSignature === 'approve(address,uint256)');
  expect(approveCall?.abiParameters[1]).toBe('15000000');
});
```

- [ ] **Step 6: Run it and confirm it fails**

Expected: FAIL — receives `'5000000'`.

- [ ] **Step 7: Fix the approve call**

In `recordSignedDelegation`, before the `approve` at permit2.ts:377, compute the total and use it. Replace the `abiParameters` line and extend the existing comment:

```ts
      // Permit2 moves funds via the TOKEN's own transferFrom, so the token
      // must first allow Permit2 to spend the payer's balance. Without this
      // the whole flow still signs and permits cleanly, then reverts at
      // drawDown with `TRANSFER_FROM_FAILED`. Spike S4 proved this ordering
      // on Arc: approve(Permit2) -> permit() -> transferFrom().
      //
      // Approved at TOTAL OUTSTANDING HEADROOM, not this delegation's
      // ceiling. ERC-20 approve SETS rather than adds, so with one treasury
      // paying many agents, approving just this ceiling would silently strip
      // every earlier agent's allowance. Still bounded rather than
      // maxUint160: a Permit2 compromise can never exceed what the org has
      // actually delegated.
      const approvalMicros = await outstandingHeadroomMicros(client, {
        orgId: input.orgId,
        payerAddress,
        mode: input.mode,
        chain: input.chain,
        tokenAddress,
      }) + ceilingMicros;

      await provider.executePermit2Transaction({
        mode: input.mode,
        chain: input.chain,
        senderAddress: payerAddress,
        abiFunctionSignature: 'approve(address,uint256)',
        abiParameters: [PERMIT2_ADDRESS, approvalMicros.toString()],
        contractAddress: tokenAddress,
        refId: `agentops-p2-approve-${crypto.randomUUID()}`,
      });
```

- [ ] **Step 8: Run the full permit2 suite**

Run: `cd apps/api && npx vitest run test/payments/permit2.test.ts`
Expected: PASS. Existing single-payer tests are unaffected because their outstanding headroom is 0.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/engines/payments/delegation-ceiling.ts \
        apps/api/test/payments/delegation-ceiling.test.ts \
        apps/api/src/engines/payments/permit2.ts \
        apps/api/test/payments/permit2.test.ts
git commit -m "fix(permit2): approve total outstanding headroom so one treasury can pay many agents"
```

---

### Task 4: Enforce the org-wide ceiling

Two independent bounds, both required:

1. **Policy** — configured `org_delegation_ceilings.ceiling_usdc`. What the operator *intends* to risk.
2. **Solvency** — the treasury's real on-chain balance. What actually exists. A ceiling above the balance is a promise the chain will refuse to keep, and the failure would land at drawdown time on whichever agent drew last.

**Files:**
- Modify: `apps/api/src/engines/payments/delegation-ceiling.ts`, `apps/api/src/engines/payments/permit2.ts`
- Test: `apps/api/test/payments/delegation-ceiling.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('rejects a delegation that would push total headroom past the org ceiling', async () => {
  // Org ceiling 12.00, existing outstanding 10.00 -> a 5.00 delegation must fail.
  await expect(recordSignedDelegation(store.pool, fakeProvider(), {
    /* ...treasury payer, ceilingUsdc: '5.00'... */
  })).rejects.toThrow(/org_delegation_ceiling_exceeded/);
});

it('rejects a delegation the treasury cannot actually cover', async () => {
  // Treasury balance 3.00, no org ceiling configured -> a 5.00 delegation fails.
  await expect(recordSignedDelegation(store.pool, fakeProvider(), {
    /* ...treasury payer, ceilingUsdc: '5.00', balance reader stubbed to 3_000_000n... */
  })).rejects.toThrow(/treasury_insufficient_for_ceiling/);
});
```

- [ ] **Step 2: Run and confirm both fail**

Run: `cd apps/api && npx vitest run test/payments/delegation-ceiling.test.ts`

- [ ] **Step 3: Add the guard to `delegation-ceiling.ts`**

```ts
/**
 * Bounds a proposed new delegation. Called before any on-chain write.
 *
 * balanceMicros is injected rather than read here: Arc's public RPC was
 * measured failing ~56% of identical calls (spike S6), so the caller owns
 * the retry policy, and tests can stub it without a live chain.
 */
export async function assertDelegationWithinCeilings(
  db: Db,
  scope: PayerScope,
  newCeilingMicros: bigint,
  balanceMicros: bigint,
): Promise<void> {
  const outstanding = await outstandingHeadroomMicros(db, scope);
  const total = outstanding + newCeilingMicros;

  const configured = await orgCeilingMicros(db, {
    orgId: scope.orgId, mode: scope.mode, chain: scope.chain,
  });
  if (configured !== null && total > configured) {
    throw conflict(
      'org_delegation_ceiling_exceeded',
      `This delegation would bring total delegated spend to ${formatUsdc(total)} USDC, above the org ceiling of ${formatUsdc(configured)} USDC.`,
    );
  }

  // Solvency. A ceiling the treasury cannot cover is not a cap, it is a
  // deferred failure that lands on whichever agent happens to draw last.
  if (total > balanceMicros) {
    throw conflict(
      'treasury_insufficient_for_ceiling',
      `The treasury holds ${formatUsdc(balanceMicros)} USDC but ${formatUsdc(total)} USDC would be delegated. Fund the treasury first.`,
    );
  }
}
```

Import `conflict` and `formatUsdc` from wherever `permit2.ts` already imports them.

- [ ] **Step 4: Call it from `recordSignedDelegation`**

Immediately after `payerAddress`/`payerKind` resolution and before the nonce read, for treasury and agent payers only (a user-owned payer's balance is not ours to gate on, and its approve is done in the browser):

```ts
    if (payerKind !== 'user') {
      await assertDelegationWithinCeilings(
        client,
        { orgId: input.orgId, payerAddress, mode: input.mode, chain: input.chain, tokenAddress },
        ceilingMicros,
        await input.readPayerBalanceMicros(payerAddress, input.chain, input.mode),
      );
    }
```

Add `readPayerBalanceMicros` to the input type, defaulting to `nativeBalanceMicros` from `agent-wallets.ts` at the call sites in `routes.ts`. Note `nativeBalanceMicros` already handles both cases correctly — native read on Arc, ERC-20 `balanceOf` elsewhere.

- [ ] **Step 5: Run the tests**

Run: `cd apps/api && npx vitest run test/payments/`
Expected: PASS across the whole payments suite.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/engines/payments/delegation-ceiling.ts \
        apps/api/test/payments/delegation-ceiling.test.ts \
        apps/api/src/engines/payments/permit2.ts
git commit -m "feat(payments): bound delegations by the org ceiling and real treasury solvency"
```

---

## Chunk 3: Just-in-time funding from the treasury

### Task 5: Point JIT funding at treasury delegations

`agent-funding.ts:67` filters `payer_agent_id IS NULL`, which now matches **both** user and treasury delegations. Left alone it would draw against whichever it found first.

**Files:**
- Modify: `apps/api/src/engines/payments/agent-funding.ts:61-71`
- Test: `apps/api/test/payments/agent-funding.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('draws from a treasury delegation and ignores a user-owned one', async () => {
  // Seed BOTH kinds for the same agent/chain. The treasury one must win.
  const { orgId, agentId } = await seedBothPayerKinds('mixed');
  const result = await fundAgentFromUserDelegation(store.pool, provider, stubBalance(0n), {
    orgId, agentId, mode: 'test', chain: 'arc', neededMicros: 1_000_000n,
  });
  expect(result.funded).toBe(true);
  const drawn = await store.pool.query(
    `SELECT d.payer_kind FROM agent_delegation_drawdowns dd
       JOIN agent_delegations d ON d.id = dd.delegation_id`,
  );
  expect(drawn.rows[0]?.payer_kind).toBe('treasury');
});
```

- [ ] **Step 2: Run and confirm it fails**

- [ ] **Step 3: Change the predicate**

```ts
  // payer_kind = 'treasury' selects the org's shared pool. Deliberately NOT
  // `payer_agent_id IS NULL`, which since migration 0030 matches BOTH a
  // treasury payer and a user-owned wallet -- drawing against the wrong one
  // would bypass the org ceiling entirely.
  const delegations = await pool.query<{ id: string; ceiling_usdc: string; drawn_usdc: string }>(
    `SELECT id, ceiling_usdc, drawn_usdc FROM agent_delegations
      WHERE org_id = $1 AND payee_agent_id = $2 AND payer_kind = 'treasury'
        AND mode = $3 AND chain = $4 AND status = 'active' AND expires_at > now()
      ORDER BY created_at DESC`,
    [input.orgId, input.agentId, input.mode, input.chain],
  );
```

Rename the function to `fundAgentFromTreasuryDelegation` and update its two call sites (`intra-fleet.ts:4`, and the `store.ts` payment path). Update the stale `no_user_delegation` reason string to `no_treasury_delegation`.

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx vitest run test/payments/`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/engines/payments/agent-funding.ts \
        apps/api/src/engines/payments/intra-fleet.ts \
        apps/api/src/engines/payments/store.ts \
        apps/api/test/payments/agent-funding.test.ts
git commit -m "feat(payments): fund agents just-in-time from the org treasury delegation"
```

---

### Task 6: Gas floor bootstrap

**The chicken-and-egg:** an agent submits its own `transferFrom` to get funded, which costs gas — but a fresh agent wallet has nothing. On Arc, USDC *is* gas, so a direct treasury→agent transfer solves both at once. The treasury is platform-controlled, so this is an ordinary `transferWallet`, not a Permit2 draw.

**Why a direct transfer is acceptable here:** the Permit2 ceiling constrains *agents*, and this transfer is the platform funding its own infrastructure, capped at a tiny fixed floor. It does not widen what an agent can take. Keep the floor small and fixed — it is not a second, uncapped funding channel.

**Files:**
- Modify: `apps/api/src/engines/payments/agent-funding.ts`
- Test: `apps/api/test/payments/agent-funding.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('tops the agent up to the gas floor from the treasury before drawing', async () => {
  // Agent balance 0 on Arc. Before any Permit2 draw, the treasury must have
  // sent AGENT_GAS_FLOOR_MICROS directly.
  const provider = fakeProvider();
  await fundAgentFromTreasuryDelegation(store.pool, provider, stubBalance(0n), {
    orgId, agentId, mode: 'test', chain: 'arc', neededMicros: 1_000_000n,
  });
  expect(provider.transferWallet).toHaveBeenCalledWith(
    expect.objectContaining({ destinationAddress: agentAddress, chain: 'arc' }),
  );
});

it('does not re-send gas when the agent is already above the floor', async () => {
  const provider = fakeProvider();
  await fundAgentFromTreasuryDelegation(store.pool, provider, stubBalance(5_000_000n), {
    orgId, agentId, mode: 'test', chain: 'arc', neededMicros: 1_000_000n,
  });
  expect(provider.transferWallet).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and confirm both fail**

- [ ] **Step 3: Implement `ensureAgentGasFloor`**

```ts
// Enough to submit a handful of transferFrom calls, no more. On Arc this is
// literally gas, because USDC is the native gas asset there.
const AGENT_GAS_FLOOR_MICROS = 100_000n; // 0.10 USDC

/**
 * Bootstraps an agent wallet so it can submit its OWN Permit2 drawdown.
 *
 * Permit2 requires msg.sender == spender, so the agent -- not the treasury
 * -- submits transferFrom, and pays gas for it. A freshly provisioned agent
 * wallet holds nothing, so without this the very first drawdown can never
 * be sent and the agent is stuck.
 *
 * A DIRECT treasury transfer, not a Permit2 draw: the treasury is
 * platform-controlled, and this is the platform funding its own plumbing.
 * Bounded to a small fixed floor so it never becomes a second uncapped
 * funding path that sidesteps the delegation ceiling.
 *
 * Base and the other ERC-20 chains need NATIVE gas (ETH), which the Circle
 * provider exposes no method to send -- there, an agent wallet must be
 * funded with gas out of band. Returns false so the caller can surface that
 * rather than failing opaquely at submit time.
 */
async function ensureAgentGasFloor(/* ... */): Promise<boolean> {
  if (chain !== 'arc') return false;
  const balance = await nativeBalanceMicros(agentAddress, chain, mode);
  if (balance >= AGENT_GAS_FLOOR_MICROS) return true;
  await provider.transferWallet({
    amountMicros: AGENT_GAS_FLOOR_MICROS - balance,
    chain,
    destinationAddress: agentAddress,
    mode,
    refId: `agentops-gas-${crypto.randomUUID()}`,
    sourceAddress: treasuryAddress,
  });
  return true;
}
```

Call it at the top of `fundAgentFromTreasuryDelegation`, before the delegation lookup.

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx vitest run test/payments/agent-funding.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/engines/payments/agent-funding.ts apps/api/test/payments/agent-funding.test.ts
git commit -m "feat(payments): bootstrap agent wallets to a gas floor from the treasury"
```

---

## Chunk 4: Routes and console

### Task 7: API routes

**Files:**
- Modify: `apps/api/src/engines/payments/routes.ts:892-915`
- Test: `apps/api/test/payments/delegation-routes.test.ts`

- [ ] **Step 1: Write failing route tests** for:
  - `POST /v1/orgs/:orgId/payments/delegations/treasury` → 201, no signature in the body
  - `PUT /v1/orgs/:orgId/payments/delegations/ceiling` → 200, upserts `org_delegation_ceilings`
  - `GET /v1/orgs/:orgId/payments/delegations/ceiling` → returns configured ceiling, outstanding headroom, and treasury balance per chain

- [ ] **Step 2: Run and confirm they fail (404)**

- [ ] **Step 3: Add the routes.** Follow the existing shape exactly: `requireOrgOperator(request, deps, params.orgId, 'admin')` for writes, `'viewer'` for reads, `parseBody(schema, request)`, `providerForOrg(params.orgId)`. The treasury route takes `{ chain, ceiling_usdc, expires_at, payee_agent_id }` — **no `payer_address`, no `signature`, no `nonce`**, because the platform signs.

- [ ] **Step 4: Run tests.** `cd apps/api && npx vitest run test/payments/delegation-routes.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/engines/payments/routes.ts apps/api/test/payments/delegation-routes.test.ts
git commit -m "feat(api): routes for treasury delegations and the org ceiling"
```

---

### Task 8: Console UI

The delegation flow loses its wallet dependency entirely — no connect, no `approve`, no signature, no chain switching. It becomes a plain form. That is the visible payoff of the treasury model and the UI should look like it.

**Files:**
- Create: `apps/web/src/components/payments/DelegateFromTreasury.tsx`, `apps/web/src/components/payments/OrgCeilingForm.tsx`
- Modify: `apps/web/src/app/app/[orgSlug]/payments/delegations/page.tsx`, `apps/web/src/lib/server/payments-client.ts`

- [ ] **Step 1: Add client functions** to `payments-client.ts` mirroring the three routes, following the existing `apiFetch` pattern.

- [ ] **Step 2: Build `OrgCeilingForm`** — per-chain (`arc`, `base`) ceiling input showing configured ceiling, current outstanding headroom, and treasury balance. Chain keys come from `SupportedChainKey`; labels from `CHAIN_LABELS`.

- [ ] **Step 3: Build `DelegateFromTreasury`** — agent select, chain select, cap input, submit. No `WalletProvider`, no wagmi hooks. Surface `org_delegation_ceiling_exceeded` and `treasury_insufficient_for_ceiling` as readable messages, since both are expected states rather than faults.

- [ ] **Step 4: Rewire the page.** Drop `WalletProvider` and `DelegateToAgent`; render `OrgCeilingForm` + `DelegateFromTreasury` + the existing `DelegationList`. Update the header copy — "Your wallet holds the funds" is no longer true. Something like: *"Agents draw from the org treasury, each capped at what you set here, all bounded by the org ceiling."*

- [ ] **Step 5: Update `FundingHierarchy` copy.** Tier 2 says "Topped up from the treasury against each agent's allocation" — it is now against each agent's **delegation ceiling**. Also fix tier 1's "One address, shared across chains", which is wrong: agent wallets derive to one shared address, treasury wallets are created independently per chain and differ.

- [ ] **Step 6: Verify the build**

Run: `npm run build --workspace @agentops-pmoa/web && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): delegate from the org treasury and set the org-wide ceiling"
```

---

### Task 9: End-to-end verification on Arc

- [ ] **Step 1: Full suite.** `npm run test` — everything green.
- [ ] **Step 2: Live Arc run.** Fund the treasury, set an org ceiling, delegate to two agents, confirm on-chain that:
  - the treasury's Permit2 allowance equals the **sum** of both ceilings (this is the Task 3 regression — check it on-chain, not just in tests)
  - each agent's `allowance[treasury][USDC][agent]` equals its own ceiling
  - a delegation exceeding the org ceiling is refused
  - an agent draws, spends, and the org ceiling headroom drops accordingly
- [ ] **Step 3: Update `demo/reset.mjs`** to seed treasury delegations instead of user-signed ones.
- [ ] **Step 4: Commit.**

---

## Known Gaps After This Plan

State these plainly rather than letting them be discovered later.

1. **Non-Arc gas.** Agent wallets on Base need ETH, funded out of band. The provider has no native-transfer method. `ensureAgentGasFloor` returns false there by design.
2. **Treasury is custodial.** The platform holds the entity secret. The Permit2 ceiling bounds agents, not a compromised platform. UI copy must not claim otherwise.
3. **Revocation is still two-part.** Only the allowance owner may call Permit2 `lockdown()`. The treasury *is* platform-controlled, so unlike the user-wallet case the platform **can** fully revoke on-chain — an improvement worth verifying in `revokeDelegation` and reflecting in the UI.
4. **No sweep-back.** USDC drawn into an agent wallet and left unspent stays there. Recovering it needs a sweep the treasury cannot perform, because it does not hold the agent wallet's key — the *platform* does, via the same entity secret, so a sweep is buildable but is not in this plan.
5. **`org_delegation_ceilings` has no default.** An org with no configured row is bounded only by treasury solvency. Decide whether onboarding should write a conservative default.

6. **Solvency measures the treasury WALLET, not Circle Gateway — they are different pools.** Found while wiring Task 9. `assertDelegationWithinCeilings` reads `nativeBalanceMicros(treasuryAddress)`, i.e. the treasury's own on-chain balance. But the existing allocation path funds agents out of **Circle Gateway**, and `demo/reset.mjs` deposits nearly the whole treasury balance into Gateway (`TREASURY_ARC_DEPOSIT_USDC = '8.00'` against a `TREASURY_ARC_MIN_MICROS = 8_000_000` wallet floor) — and, as its own comment says, *"every USDC deposited to Gateway leaves the wallet for good."*

   So an org funded the Gateway way has a near-empty treasury wallet and every treasury delegation is refused with `treasury_insufficient_for_ceiling`, even though the org demonstrably has funds. The two funding models do not compose today. Deciding which pool the ceiling is *supposed* to measure is a design question, not a bug fix — hence untouched here. This is why `demo/reset.mjs` was deliberately **not** updated to seed treasury delegations: doing so would have made the demo fail on a live run.
