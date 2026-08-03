# Phase 5: Security Hardening Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Read `2026-08-03-scope-and-cuts.md` first.**

**Goal:** Stop money being reserved before policy authorizes it, refuse to sign payments to unverified destinations, make audit-chain verification cover the whole chain, and forbid self-approval.

**Architecture:** Four surgical changes to existing code paths. Each closes a functional gap — none is a rewrite for elegance.

**Tech Stack:** TypeScript, PostgreSQL, Vitest.

**Gate:** M12 requires Phase 1 (M1). M13 is fully independent — it can run at any time, including in parallel with Phase 0.

**⚠️ Sequencing:** M12 edits `preparePaidHttpPayment`, the same function Phase 3's Task 4 edits. **Do not run Phase 3 and this chunk in parallel.** Land Phase 3 first.

---

## Why each of these is functionality, not polish

You asked me to cut "make the working thing better" work. Here is why all four items survive that cut:

| Item | Why it is not an efficiency change |
|---|---|
| **E2 policy ordering** | Today a **denied** action still mutates `reserved_usdc` and inserts a `payment_reservations` row before being denied. That is a state-corruption defect, not a slow path. |
| **E8 `payTo` binding** | There is **no** destination validation at all. A spoofed 402 response names any address and it gets signed — and post-signature the theft is cryptographically irreversible. Missing control, not a weak one. |
| **E3 audit pagination** | An org with >500 events **cannot be fully verified today**. The capability is absent, not slow. |
| **E4 self-approval** | Nothing prevents a requester approving their own request. Missing control. |

---

## Context you need before starting

**The current order inside `preparePaidHttpPayment`** (`apps/api/src/engines/payments/store.ts:4842`):

| Order | Line | What |
|---|---|---|
| 1 | `4852` | `activePaymentAccount()` (+ Phase 1's freeze check) |
| 2 | `4866-4880` | rail resolution |
| 3 | `4881-4884` | per-request cap |
| 4 | `4885-4890` | budget counters (+ Phase 3's balance check) |
| 5 | `4892-4910` | payment source |
| 6 | `4935-4954` | **`INSERT INTO payment_reservations`** |
| 7 | `4955-4961` | **`UPDATE ... reserved_usdc = reserved_usdc + ...`** |
| 8 | `4976` | **`enforceX402Policy`** ← authority runs last |

**`payTo` today** — `x402-http.ts:1218` validates only that it is a non-empty string:

```ts
!isNonemptyString(requirements.payTo) ||
```

It then flows verbatim into the signed requirements (`store.ts:878`, `:913`). Note the asymmetry worth fixing: the **asset** address *is* canonicalized against a known-good list (`store.ts:875`); the **destination** is not.

**Audit verification** — `boundedLimit` caps at 500 / defaults 100 (`audit-query.ts:160-162`); `verifyAuditChain` (`:248-263`) always walks from genesis with `previousHash = null` and takes no cursor; the route (`evidence/routes.ts:93-104`) does not paginate. `audit_event_heads` already carries `last_sequence` and `last_event_hash` (`0001:9-14`) — and verification never consults them, so truncating the tail and rewriting the head is undetectable.

**Approvals** — `approveApproval` (`approvals/store.ts:366-432`) guards only org, id, `pending`, and expiry. The requester column **already exists**: `approval_requests.requested_by` (`0007:13`). The check is a one-line addition.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/migrations/0027_payto_allowlist.sql` | Verified payee destinations | **Create** |
| `apps/api/src/engines/payments/store.ts` | Policy ordering | Modify `:4866-4976` |
| `apps/api/src/engines/payments/x402-http.ts` | `payTo` validation | Modify `:1218` |
| `apps/api/src/engines/evidence/audit-query.ts` | Full-chain walk + tail check | Modify `:160-162`, `:248-263` |
| `apps/api/src/engines/approvals/store.ts` | Self-approval guard | Modify `:366-432` |
| `apps/api/test/payments/policy-ordering.test.ts` | E2 tests | **Create** |
| `apps/api/test/evidence/chain-verification.test.ts` | E3 tests | **Create** |

---

## Chunk 1: M12 — Policy before business checks, and `payTo` binding

### Task 1: Move policy evaluation ahead of the reservation

- [ ] **Step 1: Write the failing test**

```ts
describe('policy evaluation ordering', () => {
  it('writes no reservation when policy denies', async () => {
    const { orgId, agentId, pool, request } = await setupPaymentFixture();
    await authorPolicy(pool, { orgId, action: 'runtime.payment.x402', decision: 'deny' });

    const response = await request.paidHttp({ agentId, amountUsdc: '0.01' });
    expect(response.statusCode).toBe(403);

    // The defect: today the row exists and reserved_usdc moved before the deny.
    const reservations = await pool.query(
      'SELECT 1 FROM payment_reservations WHERE org_id = $1', [orgId],
    );
    expect(reservations.rowCount).toBe(0);

    const account = await pool.query(
      'SELECT reserved_usdc FROM agent_payment_accounts WHERE org_id = $1 AND agent_id = $2',
      [orgId, agentId],
    );
    expect(Number(account.rows[0].reserved_usdc)).toBe(0);
  });

  it('does not leak budget state through error codes when policy denies', async () => {
    const { orgId, agentId, pool, request } = await setupPaymentFixture({ budgetUsdc: '0.00' });
    await authorPolicy(pool, { orgId, action: 'runtime.payment.x402', decision: 'deny' });

    const response = await request.paidHttp({ agentId, amountUsdc: '99.00' });

    // Policy is the authority: a denied caller must not learn the budget
    // was also exceeded.
    expect(response.json().code).not.toBe('budget_exceeded');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/payments/policy-ordering.test.ts --root apps/api
```

- [ ] **Step 3: Implement**

In `preparePaidHttpPayment`, move the `enforceX402Policy` block (currently `:4974-4988`) to run **immediately after** the rail quote is resolved (it needs `quote` and `resource`) and **before** the cap/budget/source checks and the reservation write.

Order after the change:

1. `activePaymentAccount` (+ freeze)
2. rail resolution → `quote`
3. **`enforceX402Policy`** ← moved here
4. per-request cap
5. budget counters + balance
6. payment source
7. `INSERT INTO payment_reservations`
8. `reserved_usdc` increment

Keep the existing `PaymentApprovalRequiredError` handling intact — `approval_required` must still produce an approval rather than a hard failure. The `approvalThreshold` argument is read from `account`, which step 1 already loaded, so it remains available.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/payments/policy-ordering.test.ts --root apps/api
npm test --workspace @agentops-pmoa/api
```

Expect some existing payment tests to shift error codes — a request that used to fail with `budget_exceeded` may now fail with a policy code. Update assertions where the new code is correct; investigate any test that now *passes* where it used to fail.

- [ ] **Step 5: Check the separate egress concern**

The manifest's E2 note flags a distinct issue: whether any **outbound fetch** can occur before policy in the non-x402 runtime paths. Grep `engines/runtime/` for fetch/HTTP calls and confirm each is gated. Record the finding — if an unguarded egress exists, it is a new task, not a silent fix.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/engines/payments/store.ts apps/api/test/payments/policy-ordering.test.ts
git commit -m "fix(payments): evaluate policy before reserving funds"
```

---

### Task 2: Bind `payTo` before signing

- [ ] **Step 1: Write the migration**

```sql
-- 0027_payto_allowlist.sql
-- Verified payment destinations. In x402 the SERVER's 402 response supplies
-- payTo; a spoofed or compromised provider can name its own address. After
-- signing, amount and destination are cryptographically immutable, so the
-- theft is irreversible. Validate before signing.

CREATE TABLE IF NOT EXISTS payment_destination_allowlist (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  address text NOT NULL,
  label text NOT NULL,
  source text NOT NULL CHECK (source IN ('marketplace', 'tenant_configured', 'agent_wallet')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by text NOT NULL,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, chain, address)
);

CREATE INDEX IF NOT EXISTS payment_destination_allowlist_lookup_idx
  ON payment_destination_allowlist (org_id, chain, address, status);
```

> `source = 'agent_wallet'` matters for Phase 6: intra-fleet payees are agent wallets this system provisioned, so they can be auto-allowlisted — their addresses come from our own database, not from a 402 response.

- [ ] **Step 2: Write the failing test**

```ts
describe('payTo binding', () => {
  it('refuses to sign for an unlisted destination', async () => {
    const { agentId, request } = await setupPaymentFixture();
    const response = await request.paidHttp({
      agentId, amountUsdc: '0.01', serverPayTo: '0xattacker',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('payment_destination_not_allowed');
  });

  it('signs for an allowlisted destination', async () => {
    const { orgId, agentId, pool, request } = await setupPaymentFixture();
    await allowDestination(pool, { orgId, chain: 'arc', address: '0xmerchant', source: 'marketplace' });
    const response = await request.paidHttp({
      agentId, amountUsdc: '0.01', serverPayTo: '0xmerchant',
    });
    expect(response.statusCode).not.toBe(409);
  });

  it('matches addresses case-insensitively', async () => {
    // EVM addresses vary in checksum casing between providers.
    const { orgId, agentId, pool, request } = await setupPaymentFixture();
    await allowDestination(pool, { orgId, chain: 'arc', address: '0xABCdef', source: 'marketplace' });
    const response = await request.paidHttp({
      agentId, amountUsdc: '0.01', serverPayTo: '0xabcdef',
    });
    expect(response.statusCode).not.toBe(409);
  });
});
```

- [ ] **Step 3: Run to verify it fails, then implement**

Add the check where the quote is built from the 402 response (`store.ts:878`, near the existing asset canonicalization at `:875`) — **before** anything is signed. Normalize both sides to lowercase before comparing.

Keep the existing non-empty-string check at `x402-http.ts:1218`; add the allowlist lookup alongside it rather than replacing it.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run test/payments --root apps/api
git add packages/db/src/migrations/0027_payto_allowlist.sql apps/api/src/engines/payments apps/api/test
git commit -m "fix(payments): validate payTo against an allowlist before signing"
```

---

## Chunk 2: M13 — Audit chain and approvals

Independent of everything else. Can start immediately.

### Task 3: Full-chain audit verification with a tail check

- [ ] **Step 1: Write the failing test**

```ts
describe('audit chain verification', () => {
  it('verifies a chain longer than the 500-event page cap', async () => {
    const { orgId, pool } = await setupOrgWithAuditEvents({ count: 1200 });
    const result = await verifyAuditChain(pool, orgId, {});
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(1200);   // today this caps at 500
  });

  it('detects a truncated tail even when the head is rewritten', async () => {
    const { orgId, pool } = await setupOrgWithAuditEvents({ count: 100 });

    // Attacker deletes the last 10 events and rewrites the head pointer
    // so the visible chain looks internally consistent.
    await pool.query(
      'DELETE FROM audit_events WHERE org_id = $1 AND sequence > 90', [orgId],
    );
    const survivor = await pool.query(
      'SELECT event_hash FROM audit_events WHERE org_id = $1 AND sequence = 90', [orgId],
    );
    await pool.query(
      'UPDATE audit_event_heads SET last_sequence = 90, last_event_hash = $2 WHERE org_id = $1',
      [orgId, survivor.rows[0].event_hash],
    );

    const result = await verifyAuditChain(pool, orgId, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('event_count_mismatch');
  });

  it('detects a tampered event in the second page', async () => {
    const { orgId, pool } = await setupOrgWithAuditEvents({ count: 800 });
    await tamperEvent(pool, orgId, 600);   // beyond the old 500 cap
    const result = await verifyAuditChain(pool, orgId, {});
    expect(result.valid).toBe(false);
  });
});
```

> The second test is the important one. Without a tail check, deleting a suffix and rewriting the head is **undetectable** — the remaining chain verifies perfectly.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/evidence/chain-verification.test.ts --root apps/api
```

- [ ] **Step 3: Implement**

In `audit-query.ts`:

- Make `verifyAuditChain` loop internally, fetching pages of 500 and carrying `previousHash` across page boundaries until exhausted. **Leave `boundedLimit` alone** — it correctly bounds the *list* endpoints; verification simply stops using it as a total.
- After the walk, add the tail check: compare the final computed hash to `audit_event_heads.last_event_hash`, and the counted events to `last_sequence`. Report a specific `reason` on mismatch.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run test/evidence --root apps/api
git add apps/api/src/engines/evidence/audit-query.ts apps/api/test/evidence/chain-verification.test.ts
git commit -m "fix(evidence): verify the full audit chain and its tail"
```

---

### Task 4: Forbid self-approval

- [ ] **Step 1: Write the failing test**

```ts
describe('separation of duties', () => {
  it('forbids the requester from approving their own request', async () => {
    const { orgId, approvalId, requesterRequest } = await setupPendingApproval({
      requestedBy: 'usr_alice',
    });
    const response = await requesterRequest.post(
      `/orgs/${orgId}/approvals/${approvalId}/approve`, {},   // as usr_alice
    );
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('self_approval_forbidden');
  });

  it('allows a different operator to approve', async () => {
    const { orgId, approvalId, otherOperatorRequest } = await setupPendingApproval({
      requestedBy: 'usr_alice',
    });
    const response = await otherOperatorRequest.post(
      `/orgs/${orgId}/approvals/${approvalId}/approve`, {},   // as usr_bob
    );
    expect(response.statusCode).toBe(200);
  });

  it('forbids self-denial too', async () => { /* same guard on denyApproval */ });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

In `approvals/store.ts:366-432`, add `AND requested_by <> $3` to the existing UPDATE's WHERE clause. Because the UPDATE then affects zero rows, distinguish the causes before returning a generic "not found": re-read the row and throw `self_approval_forbidden` when `requested_by` matches the approver. Apply the same to `denyApproval`.

**Quorum is out of scope for T3.** The manifest offers it as optional ("optional N-of-M quorum"); self-approval is the actual control gap. Skip quorum unless time remains after Phase 6.

- [ ] **Step 3: Run the full gate and commit**

```bash
npm run verify
git add apps/api/src/engines/approvals/store.ts apps/api/test/approvals
git commit -m "fix(approvals): forbid self-approval and self-denial"
```

---

## Phase 5 Done Criteria

- [ ] A policy-denied payment writes **no** reservation row and leaves `reserved_usdc` unchanged
- [ ] A denied caller does not learn budget state through the error code
- [ ] `approval_required` still produces an approval, not a failure
- [ ] The egress-before-policy question is answered and recorded
- [ ] An unlisted `payTo` is refused **before signing**; allowlisted ones proceed; matching is case-insensitive
- [ ] An org with 1,200 events verifies end to end
- [ ] A truncated tail with a rewritten head is **detected**
- [ ] Tampering beyond event 500 is detected
- [ ] A requester cannot approve or deny their own request; another operator can
- [ ] `npm run verify` passes with Docker up
