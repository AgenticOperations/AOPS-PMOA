# Trust Graduation Implementation Plan (Piece 3)

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human review an external agent's on-chain escrow record and, if they judge the work good, promote it to the cheaper Permit2 rail — writing the allowlist entry and opening the delegation in one deliberate act.

**Architecture:** A `trust.ts` engine plus routes. Graduation is a **row transition, not new infrastructure**: both destination tables already exist and already carry `approved_by`. The engine assembles evidence from `escrow_jobs`, then on a human's decision writes a `payment_destination_allowlist` row (`source = 'marketplace'`) and calls the existing `recordSignedDelegation`. Revocation reverses both, including on-chain.

**Tech Stack:** TypeScript, Postgres, Fastify routes, vitest, the existing `permit2.ts` engine.

**Design doc:** `docs/superpowers/specs/2026-08-05-escrow-trust-graduation-design.md`
**Depends on:** piece 2 (`docs/superpowers/plans/2026-08-06-escrow-lifecycle-engine.md`) — `escrow_jobs` must exist and be populated.

---

## Context you need before starting

This is **piece 3 of 4**. Piece 1 deployed the ERC-8183 escrow; piece 2 built the lifecycle engine. Piece 4 is the console. Do not build piece 4 here.

### The single most important rule in this plan

**Promotion is always a human act. There is no automatic graduation, no threshold, no "N clean jobs" rule.**

The system *presents evidence*; a person looks at the work and decides. This is a deliberate product decision (design doc D-2/D-3), and it is also why `approved_by` must be a real user id here. Writing `'system'` into `approved_by` on a graduation would defeat the entire point.

Contrast with `agent-payee.ts:55`, which legitimately writes `source = 'agent_wallet'` and `created_by = 'system'` — that is a *fleet* agent whose wallet the platform already controls, so no trust decision is involved. An external marketplace agent is the opposite case.

### What already exists — read these before writing anything

| Thing | Where | Why it matters |
|---|---|---|
| `payment_destination_allowlist` | `packages/db/src/migrations/0027_payto_allowlist.sql` | **This table is the checkmark.** Has `source IN ('marketplace','tenant_configured','agent_wallet')`, `status IN ('active','revoked')`, `approved_by`, `UNIQUE (org_id, chain, address)` |
| Insert pattern for it | `apps/api/src/engines/payments/agent-payee.ts:55` | Copy the `ON CONFLICT … DO NOTHING` shape |
| `agent_delegations` | migrations `0028`, `0029`, `0030` | `payee_agent_id` is **nullable**, `payee_address` is required — so an external agent can already be a payee by address |
| `recordSignedDelegation` | `apps/api/src/engines/payments/permit2.ts:317` | Already takes `payeeAddress`, `ceilingUsdc`, `approvedBy`, and a `payerTreasury` option. **Reuse it — do not write a second delegation path** |
| `revokeDelegation` | `apps/api/src/engines/payments/permit2.ts:619` | Revocation must go through this so the on-chain permit is actually revoked |
| `payer_kind` | migration `0030` | `'user' | 'agent' | 'treasury'` — a graduation delegation is normally `treasury` |
| Route patterns | `apps/api/src/engines/payments/routes.ts:527+` | All routes are `/v1/orgs/:orgId/payments/…` |

### Running tests fast

Docker-gated; they skip silently without a database. Use native Postgres via `TEST_DATABASE_URL`, and **run only the specific file** — never the whole `test/payments` directory.

```bash
cd apps/api
TEST_DATABASE_URL=postgres://agentops:agentops@localhost:5432/agentops_pmoa_test \
  ../../node_modules/.bin/vitest run test/payments/trust.test.ts
```

### Deployed escrow (for reference)

Proxy `0x31C050d9D20504c4E11b2A894051d8181B14e0F5` on both Arc testnet (chainId 5042002) and Base Sepolia (chainId 84532). Addresses match by coincidence — always look up per chain.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `apps/api/src/engines/payments/trust.ts` | Evidence assembly + promote + revoke | **Create** |
| `apps/api/test/payments/trust.test.ts` | Engine tests | **Create** |
| `apps/api/src/engines/payments/routes.ts` | Three new routes | Modify |
| `apps/api/test/payments/trust-routes.test.ts` | Route-level tests | **Create** |

No migration. Both destination tables already exist — that is the point.

---

## Chunk 1: Evidence

### Task 1: Assemble an external agent's escrow track record

**Files:**
- Create: `apps/api/src/engines/payments/trust.ts`
- Create: `apps/api/test/payments/trust.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('escrow evidence for an external agent', () => {
  it('summarises settled work per provider address', async () => {
    await seedEscrowJob({ providerAddress: PROVIDER, state: 'completed', budgetUsdc: '5.00' });
    await seedEscrowJob({ providerAddress: PROVIDER, state: 'completed', budgetUsdc: '7.00' });
    await seedEscrowJob({ providerAddress: PROVIDER, state: 'rejected',  budgetUsdc: '3.00' });

    const ev = await getTrustEvidence(pool, { orgId, chain: 'arc', address: PROVIDER, mode: 'test' });

    expect(ev.completedCount).toBe(2);
    expect(ev.settledUsdc).toBe('12.00');
    expect(ev.rejectedCount).toBe(1);
    expect(ev.trusted).toBe(false);
  });

  it('counts expired separately from rejected', async () => {
    // The chain refunds both identically, but "delivered but never
    // evaluated" is not the same signal to a human as "rejected".
    await seedEscrowJob({ providerAddress: PROVIDER, state: 'expired', budgetUsdc: '2.00' });
    const ev = await getTrustEvidence(pool, { orgId, chain: 'arc', address: PROVIDER, mode: 'test' });
    expect(ev.expiredCount).toBe(1);
    expect(ev.rejectedCount).toBe(0);
  });

  it('reports trusted once an active allowlist row exists', async () => {
    await seedAllowlist({ orgId, chain: 'arc', address: PROVIDER, status: 'active' });
    const ev = await getTrustEvidence(pool, { orgId, chain: 'arc', address: PROVIDER, mode: 'test' });
    expect(ev.trusted).toBe(true);
  });

  it('is scoped to the org -- one org trusting an agent tells another nothing', async () => {
    await seedAllowlist({ orgId: OTHER_ORG, chain: 'arc', address: PROVIDER, status: 'active' });
    const ev = await getTrustEvidence(pool, { orgId, chain: 'arc', address: PROVIDER, mode: 'test' });
    expect(ev.trusted).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement `getTrustEvidence`**

One query grouping `escrow_jobs` by state for `(org_id, chain, provider_address, mode)`, plus a lookup of the allowlist row. Use the `escrow_jobs_provider_idx` index piece 2 created for exactly this.

Return the individual job rows too — the human is reviewing *work*, not a score, so the console needs the list.

- [ ] **Step 4: Run until green, then commit**

```bash
git add apps/api/src/engines/payments/trust.ts apps/api/test/payments/trust.test.ts
git commit -m "feat(payments): assemble escrow trust evidence per external agent"
```

---

## Chunk 2: Promotion

### Task 2: Promote an agent — the human act

**Files:**
- Modify: `apps/api/src/engines/payments/trust.ts`
- Modify: `apps/api/test/payments/trust.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('promoting an external agent', () => {
  it('records the real approver, never the system', async () => {
    await seedEscrowJob({ providerAddress: PROVIDER, state: 'completed', budgetUsdc: '5.00' });
    await trustExternalAgent(pool, provider, {
      orgId, chain: 'arc', mode: 'test', address: PROVIDER,
      label: 'Marketplace agent A', ceilingUsdc: '10.00',
      expiresAt: inThirtyDays, approvedBy: 'user_42',
    });

    const row = await allowlistRow(PROVIDER);
    expect(row.source).toBe('marketplace');
    expect(row.status).toBe('active');
    // The whole point of the design: a person decided this.
    expect(row.approved_by).toBe('user_42');
    expect(row.approved_by).not.toBe('system');
  });

  it('opens a Permit2 delegation naming the external address as payee', async () => {
    const result = await trustExternalAgent(pool, provider, { /* ... */ });
    const del = await delegationRow(result.delegationId);
    expect(del.payee_address.toLowerCase()).toBe(PROVIDER.toLowerCase());
    expect(del.payee_agent_id).toBeNull();   // external: not one of our agents
    expect(del.ceiling_usdc).toBe('10.000000');
  });

  it('refuses to promote an agent with no settled escrow history', async () => {
    // Evidence is what makes this a judgement rather than a guess. Without
    // any completed job there is nothing for a human to have reviewed.
    await expect(trustExternalAgent(pool, provider, {
      orgId, chain: 'arc', mode: 'test', address: UNKNOWN_PROVIDER,
      label: 'Nobody', ceilingUsdc: '10.00', expiresAt: inThirtyDays, approvedBy: 'user_42',
    })).rejects.toThrow(/trust_requires_escrow_history/);
  });

  it('is idempotent -- promoting twice does not double-delegate', async () => {
    await trustExternalAgent(pool, provider, BASE_INPUT);
    await expect(trustExternalAgent(pool, provider, BASE_INPUT))
      .rejects.toThrow(/agent_already_trusted/);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement `trustExternalAgent`**

In one `withTransaction`:
1. Re-read evidence; throw `trust_requires_escrow_history` if `completedCount === 0`
2. Throw `agent_already_trusted` if an active allowlist row exists
3. Insert the allowlist row with `source = 'marketplace'` and `approved_by = input.approvedBy`
4. Call `recordSignedDelegation` with `payeeAddress`, the chosen `ceilingUsdc`, and the same `approvedBy`

If the delegation fails, the allowlist insert must roll back with it — a checkmark with no delegation behind it is a lie the console would display.

- [ ] **Step 4: Run until green, then commit**

```bash
git commit -m "feat(payments): promote external agents to the Permit2 rail"
```

---

### Task 3: Revoke trust — both halves, including on-chain

**Files:**
- Modify: `apps/api/src/engines/payments/trust.ts`
- Modify: `apps/api/test/payments/trust.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('revokes the allowlist entry and the on-chain permit together', async () => {
  const { delegationId } = await trustExternalAgent(pool, provider, BASE_INPUT);
  await revokeTrust(pool, provider, { orgId, chain: 'arc', mode: 'test', address: PROVIDER, revokedBy: 'user_42' });

  expect((await allowlistRow(PROVIDER)).status).toBe('revoked');
  expect((await delegationRow(delegationId)).status).toBe('revoked');
  // Revoking locally while the on-chain allowance survives would leave real
  // spending authority in place. The permit must actually be revoked.
  expect(provider.executePermit2Transaction).toHaveBeenCalled();
});

it('leaves completed escrow history intact after revocation', async () => {
  await revokeTrust(pool, provider, { /* ... */ });
  const ev = await getTrustEvidence(pool, { orgId, chain: 'arc', address: PROVIDER, mode: 'test' });
  expect(ev.completedCount).toBe(1);   // history is evidence, not a grant
  expect(ev.trusted).toBe(false);
});
```

- [ ] **Step 2: Run, confirm failure, implement `revokeTrust`**

Set the allowlist row to `revoked` and call the existing `revokeDelegation` for every active delegation naming that payee on that chain. Never delete escrow history.

- [ ] **Step 3: Run until green, then commit**

```bash
git commit -m "feat(payments): revoke external agent trust on-chain and locally"
```

---

## Chunk 3: Routes

### Task 4: Expose evidence, promote, and revoke

**Files:**
- Modify: `apps/api/src/engines/payments/routes.ts`
- Create: `apps/api/test/payments/trust-routes.test.ts`

- [ ] **Step 1: Read the surrounding route style first**

```bash
sed -n '520,600p' apps/api/src/engines/payments/routes.ts
```

Match the existing auth, org-scoping, error mapping, and reply conventions exactly.

- [ ] **Step 2: Write the failing route tests**

```ts
it('GET returns evidence for an external address', async () => { /* 200, shape */ });

it('POST trust requires an authenticated user and records them as approver', async () => {
  // approvedBy must come from the SESSION, never the request body -- a
  // client-supplied approver would make the audit trail forgeable.
});

it('POST trust maps trust_requires_escrow_history to 409, not 500', async () => { /* ... */ });

it('POST revoke returns 409 when the agent is not currently trusted', async () => { /* ... */ });
```

- [ ] **Step 3: Add the routes**

```
GET  /v1/orgs/:orgId/payments/trust/:chain/:address     -> evidence
POST /v1/orgs/:orgId/payments/trust/:chain/:address     -> promote  { label, ceilingUsdc, expiresAt }
POST /v1/orgs/:orgId/payments/trust/:chain/:address/revoke
```

**`approvedBy` is taken from the authenticated session, never the body.**

- [ ] **Step 4: Run until green**

```bash
cd apps/api
TEST_DATABASE_URL=... ../../node_modules/.bin/vitest run test/payments/trust.test.ts test/payments/trust-routes.test.ts
```

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git commit -m "feat(api): expose trust evidence, promotion, and revocation routes"
```

---

## Done Criteria

- [ ] Evidence groups completed / rejected / **expired** counts separately, scoped per org
- [ ] `trusted` reflects an active allowlist row for **that org only**
- [ ] Promotion writes `source = 'marketplace'` and a **real user id** in `approved_by`
- [ ] Promotion opens a delegation with `payee_address` set and `payee_agent_id` NULL
- [ ] Promotion refuses with `trust_requires_escrow_history` when nothing has settled
- [ ] Promoting an already-trusted agent fails with `agent_already_trusted`
- [ ] A failed delegation rolls the allowlist insert back
- [ ] Revocation revokes the allowlist row **and** the on-chain permit
- [ ] Escrow history survives revocation
- [ ] `approvedBy` comes from the session, never the request body
- [ ] `pnpm typecheck` and `pnpm lint` clean

## Explicitly out of scope

- Console UI (piece 4)
- Any automatic promotion, threshold, or score — deliberately excluded
- ERC-8004 identity resolution for external agents
- Cross-org shared trust
