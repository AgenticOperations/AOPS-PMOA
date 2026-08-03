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

> **Real deviation found mid-implementation:** moving policy earlier broke the existing "approves then resumes the same idempotency key" test with `approval_context_mismatch`. Root cause: the approval's stored context binds `quote_hash`/`request_hash`, and `quoteHash` depends on `providerMode` (from the resolved payment source), which wasn't available yet at the point policy first ran. Fixed by moving payment-SOURCE resolution (not just quote/rail resolution, as the plan's sketch said) earlier too, so both are known before policy runs. Cap/budget/balance checks and the reservation write still run after policy, as intended.

- [x] **Step 1: Write the failing test** — same two scenarios as the sketch, added a third (approval_required still produces an approval, not a hard failure).

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

- [x] **Step 2: Run to verify it fails** — failed as expected (budget_exceeded leaked ahead of the policy denial).

- [x] **Step 3: Implement** — done per the corrected ordering (source resolution moved earlier alongside quote/rail, not just quote/rail as originally sketched — see deviation note above). `PaymentApprovalRequiredError` handling preserved; `approvalThreshold` still read from `account`.

- [x] **Step 4: Run to verify it passes** — one existing test broke (the approval-resume test, root-caused and fixed per the deviation note), everything else passed unchanged. Full payments suite (367 tests) confirmed green after the fix.

- [x] **Step 5: Check the separate egress concern** — grepped `engines/runtime/` for fetch/HTTP calls: none exist there. `runtime.http.request` is purely a policy **action name** that `operations/check`/`operations/record` evaluate against — no fetch is executed by this codebase for that action; it's a gate a runtime SDK/agent consults before making its own external call. The only actual outbound fetch in the payment flow is `x402-http.ts`'s price-discovery GET, which necessarily runs before policy (policy needs the quote to evaluate) but has no side effects and delivers no protected resource — the merchant-delivery fetch that returns paid content happens after policy and reservation succeed. **No unguarded egress found.**

- [x] **Step 6: Commit** — `9b4494d`.

---

### Task 2: Bind `payTo` before signing

- [x] **Step 1: Write the migration**

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

- [x] **Step 1: Write the migration** — matches the plan's sketch exactly, committed `7d63bb9`.

- [x] **Step 2: Write the failing test** — added a new file `test/payments/payto-allowlist.test.ts` (its own minimal app/merchant fixture, since the shared `x402-paid-http-flow.test.ts` merchant handler has a fixed `payTo` and modifying it for one concern would have meant restructuring that file). Same three scenarios as the sketch.

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

- [x] **Step 3: Run to verify it fails, then implement** — implemented in `preparePaidHttpPayment` (not `quoteFromAccept`, which is a pure synchronous function with no DB access and can't query the allowlist itself) — checked immediately after rail resolution, before source lookup, policy, or reservation. Lowercase-normalized on both sides via SQL `lower()`. `x402-http.ts:1218`'s non-empty-string check left untouched.

- [x] **Step 4: Verify and commit** — this is a hard new requirement on every payment, so it broke 42 existing tests across 4 files whose merchant fixtures were never allowlisted. Fixed by seeding the allowlist alongside each file's existing org/agent fixture helper. Full payments suite (370 tests) green. Committed `7d63bb9`.

---

## Chunk 2: M13 — Audit chain and approvals

Independent of everything else. Can start immediately.

### Task 3: Full-chain audit verification with a tail check

> **Real limit found in this task's own test scenario, before implementing around it:** the plan's second test has an attacker delete a chain's suffix AND rewrite `audit_event_heads` to match the truncated state consistently. This is undetectable in principle by any tail-check against `audit_event_heads` alone — if both are updated together, the remaining chain is genuinely self-consistent with its own head. Real protection against that specific coordinated-rewrite scenario needs an external checkpoint (the head hash written somewhere the same compromise can't reach), which is real new infrastructure out of scope for this task. Flagged to the user before proceeding; the fix below covers what's actually achievable: detecting a truncation when the head is NOT also rewritten (the realistic case whenever `audit_event_heads` has any separate protection at all).

- [x] **Step 1: Write the failing test** — added to the existing `test/evidence/audit-query.test.ts` (not a separate `chain-verification.test.ts` file, to reuse its existing store/fixture setup) — same three scenarios as the sketch, with the tail-check test adjusted per the limit above.

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

- [x] **Step 2: Run to verify it fails** — failed as expected (caps at 500; no tail check existed).

- [x] **Step 3: Implement** — `verifyAuditChain` now loops internally in pages of `VERIFY_PAGE_SIZE = 500`, carrying `previousHash` across page boundaries. `boundedLimit` untouched (still bounds the list endpoints). Tail check added: compares final computed hash + event count against `audit_event_heads`, with distinct `event_count_mismatch`/`tail_hash_mismatch` reasons.

- [x] **Step 4: Verify and commit** — 1200-event chain verifies in full; 800-event deep-tamper detected; realistic tail-truncation detected. Full evidence suite (21 tests) green. Committed `26a205c`.

```bash
npx vitest run test/evidence --root apps/api
git add apps/api/src/engines/evidence/audit-query.ts apps/api/test/evidence/chain-verification.test.ts
git commit -m "fix(evidence): verify the full audit chain and its tail"
```

---

### Task 4: Forbid self-approval

- [x] **Step 1: Write the failing test** — new file `test/approvals/self-approval.test.ts` (the existing `approval-expiry.test.ts` uses a single fixed operator identity for the whole app, so a per-request-configurable operator via an `x-test-actor` header was added for this test's fixture). Same four scenarios as the sketch (approve, deny, both self-forbidden and both allowed-for-a-different-operator).

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

- [x] **Step 2: Run to verify it fails, then implement** — implemented exactly per the sketch: `AND requested_by <> $3` added to both UPDATEs; `assertNotSelfApproval` re-reads on the zero-rows path and throws `self_approval_forbidden` (403) specifically, distinct from the generic `approval_not_pending` (409). Verified no regression against the existing x402 approval-resume flow: `requested_by` there is the runtime **connection ID**, not the operator's actorId, so the guard doesn't false-positive on that flow.

**Quorum skipped**, per the plan — out of scope.

- [x] **Step 3: Run the full gate and commit** — full payments + evidence + approvals suites (396 tests) green. Committed `ddc2283`.

---

## Phase 5 Done Criteria

- [x] A policy-denied payment writes **no** reservation row and leaves `reserved_usdc` unchanged
- [x] A denied caller does not learn budget state through the error code
- [x] `approval_required` still produces an approval, not a failure
- [x] The egress-before-policy question is answered and recorded — no unguarded egress found
- [x] An unlisted `payTo` is refused **before signing**; allowlisted ones proceed; matching is case-insensitive
- [x] An org with 1,200 events verifies end to end
- [x] A truncated tail is **detected** when the head is not also rewritten — **partial**: a fully coordinated attacker who rewrites both the tail AND the head consistently is a real, documented, out-of-scope gap (needs an external checkpoint); see Task 3's deviation note and `docs/spike-results.md`-style reasoning inline in the plan above
- [x] Tampering beyond event 500 is detected
- [x] A requester cannot approve or deny their own request; another operator can
- [ ] `npm run verify` — **not run as the full monorepo gate this pass** (time-constrained execution); ran the directly-affected suites instead (payments 370, evidence 21, approvals 5 = 396 tests, all green) plus targeted `tsc`/`eslint` on every touched file after each task. Recommend running the full `npm run verify` before treating Phase 5 as fully closed.
