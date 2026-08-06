# Phase 9: Ledger, Discipline, and Distribution Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Read `2026-08-03-scope-and-cuts.md` first.**

**Goal:** Make money movement reconstructable from an append-only record, release reservations on proof rather than timeout, publish the `batch-settlement` binding, add approval quorum, and make the platform adoptable by other agents.

**Architecture:** Six independent tasks. The ledger runs **alongside** the existing counters rather than replacing them — counters become a cache, balances become derivable. Everything else is additive.

**Tech Stack:** PostgreSQL, existing engines, Markdown for the published artifacts.

**Gate:** requires Phase 6 (T3) complete. **Every task here is independent of every other and of Phases 7–8** — this phase can run in parallel with Phase 7 if two people are working.

---

## Context you need before starting

**Why the ledger comes after T3, not before.** The manifest itself scopes it out pre-deadline: *"full double-entry is likely out of scope."* Phase 4 · Task 4 already closed the concrete leak (stranded `reserved_usdc`) that made the missing ledger urgent. Building it now means it records T3's real transaction history rather than being retrofitted onto a moving target.

**What exists today:** money is tracked by destructive in-place arithmetic — `UPDATE agent_payment_accounts SET reserved_usdc = reserved_usdc - $3, spent_usdc = spent_usdc + $3` (`store.ts:5147-5162`) and `simulated_balance_usdc` on `payment_sources`. There is a compensating release path, but it is a **second in-place mutation, not a reversing entry** — no immutable record of the transition survives, so balances cannot be reconstructed or audited from history. Verified: **zero** `journal_entries` or ledger tables across all migrations.

**Scoping note from the manifest, worth honouring:** *"Minimum viable version: append-only postings with derived balances, keeping counters as a cache. State honestly which one shipped."* That is exactly what Task 1 builds. Do not attempt full double-entry.

**E6 is partly done.** Phase 4 · Task 4 handles the `unknown` case. What remains is the death-predicate: an EIP-3009 authorization is **provably dead** once `block.timestamp > validBefore` AND `authorizationState(from, nonce) == false`. Release on proof, not on timeout. Arc makes the rest easy — deterministic BFT finality, no reorgs, so a settled payment is final the instant it confirms.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/migrations/0034_ledger_postings.sql` | Append-only postings | **Create** |
| `apps/api/src/engines/payments/ledger.ts` | Posting writer + balance derivation | **Create** |
| `apps/api/src/engines/payments/x402-attempt-store.ts` | Death-predicate release | Modify |
| `apps/api/src/engines/approvals/store.ts` | N-of-M quorum | Modify |
| `docs/batch-settlement-binding.md` | K-9 spec artifact | **Create** |
| `docs/llms.txt`, `docs/skill.md` | Agent-readable onboarding | **Create** |
| `apps/mcp/` | ADK-shaped tool surface | Modify |

---

## Chunk 1: M21 — Append-only ledger `[manifest E5]`

### Task 1: Postings table with derived balances `[E5]`

- [x] **Step 1: Write the migration**

```sql
-- 0034_ledger_postings.sql
-- Append-only postings. Every economic event is a row; balances are
-- DERIVED by summation. Corrections happen by appending an offsetting
-- row, NEVER by editing. The existing counters on agent_payment_accounts
-- stay as a cache -- this is the manifest's "minimum viable version",
-- not full double-entry. Say so honestly.

CREATE TABLE IF NOT EXISTS ledger_postings (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text REFERENCES agents (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  -- What happened. Signed amounts: reserve is negative available,
  -- release is positive, settle moves reserved to spent.
  entry_type text NOT NULL CHECK (entry_type IN (
    'reserve', 'release', 'settle', 'topup', 'sweep', 'deposit', 'correction'
  )),
  amount_usdc numeric(20, 6) NOT NULL,
  -- What caused it. At least one must be present.
  reservation_id text REFERENCES payment_reservations (id) ON DELETE RESTRICT,
  attempt_id text,
  job_id text,
  -- Corrections reference the posting they offset. Never edit a posting.
  corrects_posting_id text REFERENCES ledger_postings (id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    reservation_id IS NOT NULL OR attempt_id IS NOT NULL
    OR job_id IS NOT NULL OR corrects_posting_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS ledger_postings_agent_idx
  ON ledger_postings (org_id, agent_id, mode, chain, created_at);
CREATE INDEX IF NOT EXISTS ledger_postings_reservation_idx
  ON ledger_postings (reservation_id);

-- No UPDATE, no DELETE. Enforce it rather than trusting convention.
CREATE OR REPLACE FUNCTION ledger_postings_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_postings is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_postings_no_update
  BEFORE UPDATE OR DELETE ON ledger_postings
  FOR EACH ROW EXECUTE FUNCTION ledger_postings_immutable();
```

> The trigger is what makes "append-only" a guarantee rather than a naming convention. Without it, the first person in a hurry does an `UPDATE`.

- [x] **Step 2: Write the failing test**

```ts
describe('append-only ledger', () => {
  it('derives the same balance the counters report', async () => {
    const { orgId, agentId, pool } = await setupAgentWithPaymentHistory();

    const derived = await deriveSpentUsdc(pool, { orgId, agentId, mode: 'test' });
    const counter = await pool.query(
      'SELECT spent_usdc FROM agent_payment_accounts WHERE org_id = $1 AND agent_id = $2',
      [orgId, agentId],
    );
    expect(derived).toBe(counter.rows[0].spent_usdc);
  });

  it('rejects UPDATE on a posting', async () => {
    const { postingId, pool } = await setupPosting();
    await expect(pool.query(
      'UPDATE ledger_postings SET amount_usdc = 999 WHERE id = $1', [postingId],
    )).rejects.toThrow(/append-only/);
  });

  it('rejects DELETE on a posting', async () => {
    const { postingId, pool } = await setupPosting();
    await expect(pool.query('DELETE FROM ledger_postings WHERE id = $1', [postingId]))
      .rejects.toThrow(/append-only/);
  });

  it('corrects by appending an offsetting row', async () => {
    const { postingId, pool } = await setupPosting({ amountUsdc: '5.00' });
    await correctPosting(pool, { postingId, reasonCode: 'operator_adjustment' });

    const rows = await pool.query(
      'SELECT amount_usdc FROM ledger_postings WHERE corrects_posting_id = $1', [postingId],
    );
    expect(Number(rows.rows[0].amount_usdc)).toBe(-5);
  });
});
```

- [x] **Step 3: Implement**

Write a posting at each existing money-movement point — reserve (`store.ts:4955`), settle (`:5147`), release (`:5348`), plus topup and sweep from Phase 4. **Do not remove the counter updates.** They stay as the cache; the postings become the truth. The parity test above is what proves they agree.

- [x] **Step 4: Verify and commit**

```bash
npx vitest run test/payments --root apps/api
git add packages/db/src/migrations/0034_ledger_postings.sql apps/api/src/engines/payments/ledger.ts apps/api/test
git commit -m "feat(payments): add append-only ledger postings with derived balances"
```

---

## Chunk 2: M22 — Proof-based reservation release `[manifest E6]`

### Task 2: Death-predicate release `[E6]`

- [x] **Step 1: Write the failing test**

```ts
describe('proof-based reservation release', () => {
  it('releases when the authorization is provably dead', async () => {
    // Provably dead: past validBefore AND never used on-chain.
    const { reservationId, pool } = await setupExpiredAuthorization({
      validBefore: Math.floor(Date.now() / 1000) - 60,
      authorizationUsed: false,
    });

    await releaseOnProof(pool, { reservationId }, fakeChainReader);

    const row = await pool.query('SELECT status FROM payment_reservations WHERE id = $1', [reservationId]);
    expect(row.rows[0].status).toBe('released');
  });

  it('does NOT release while the authorization could still be used', async () => {
    const { reservationId, pool } = await setupExpiredAuthorization({
      validBefore: Math.floor(Date.now() / 1000) + 3600,   // still valid
      authorizationUsed: false,
    });
    await expect(releaseOnProof(pool, { reservationId }, fakeChainReader))
      .rejects.toThrow(/not_provably_dead/);
  });

  it('does NOT release when the authorization was already used', async () => {
    // Past validBefore but USED means it settled -- releasing would
    // double-count the money.
    const { reservationId, pool } = await setupExpiredAuthorization({
      validBefore: Math.floor(Date.now() / 1000) - 60,
      authorizationUsed: true,
    });
    await expect(releaseOnProof(pool, { reservationId }, fakeChainReader))
      .rejects.toThrow(/not_provably_dead/);
  });
});
```

- [x] **Step 2: Implement**

Both conditions must hold: `block.timestamp > validBefore` **AND** `authorizationState(from, nonce) == false`. Either alone is insufficient — that is the whole point of a death predicate versus a timeout.

No reorg branch is needed: Arc has deterministic BFT finality, *"no confirmation windows, no reorganization risk, and no probabilistic uncertainty."*

- [x] **Step 3: Verify and commit**

```bash
git add apps/api/src/engines/payments/x402-attempt-store.ts apps/api/test
git commit -m "feat(payments): release reservations on proof of dead authorization"
```

---

## Chunk 3: M23 — `batch-settlement` binding doc `[manifest K-9]`

### Task 3: Publish the binding `[K-9]`

Phase 6 implemented Permit2 ceiling + drawdown and exposed it as a `batch-settlement` binding. The spec obliges us to publish **7 mandatory items**. This is a credibility artifact for judges, and it can only be written accurately now that the implementation exists.

- [x] **Step 1: Write `docs/batch-settlement-binding.md`** covering all seven:

| # | Item | What to document |
|---|---|---|
| 1 | Commitment format | The `PermitSingle` structure actually signed |
| 2 | Verification | How a verifier confirms the commitment |
| 3 | Storage | Where allowance state lives (chain = authority; `agent_delegations` = mirror) |
| 4 | Double-spend prevention | Permit2 nonce ordering + our row lock |
| 5 | Expiry | `expiration` uint48, enforced on-chain |
| 6 | Redemption | `transferFrom` drawdown flow |
| 7 | Trust model | **Capital-backed.** Be explicit that the payee carries collection risk — funds stay in the payer's wallet. |

Document what shipped, not what was designed. If Phase 6 fell back to T4 (per-payment `exact`), say so and drop the binding claim.

- [x] **Step 2: Commit**

```bash
git add docs/batch-settlement-binding.md
git commit -m "docs: publish x402 batch-settlement binding"
```

---

## Chunk 4: M24 — Approval quorum `[manifest E4]`

### Task 4: N-of-M above a threshold `[E4]`

Phase 5 · Task 4 shipped the self-approval guard — the actual control gap. This adds the second layer.

- [x] **Step 1: Write the failing test**

```ts
describe('approval quorum', () => {
  it('requires two approvers above the configured threshold', async () => {
    const { orgId, approvalId, pool, firstOperator, secondOperator } =
      await setupPendingApproval({ amountUsdc: '500.00', quorumThresholdUsdc: '100.00', quorum: 2 });

    const first = await firstOperator.post(`/orgs/${orgId}/approvals/${approvalId}/approve`, {});
    expect(first.json().status).toBe('pending');   // not yet approved

    const second = await secondOperator.post(`/orgs/${orgId}/approvals/${approvalId}/approve`, {});
    expect(second.json().status).toBe('approved');
  });

  it('still forbids the same operator approving twice toward quorum', async () => {
    const { orgId, approvalId, firstOperator } =
      await setupPendingApproval({ amountUsdc: '500.00', quorumThresholdUsdc: '100.00', quorum: 2 });

    await firstOperator.post(`/orgs/${orgId}/approvals/${approvalId}/approve`, {});
    const again = await firstOperator.post(`/orgs/${orgId}/approvals/${approvalId}/approve`, {});
    expect(again.statusCode).toBe(409);
  });

  it('requires only one approver below the threshold', async () => {
    const { orgId, approvalId, firstOperator } =
      await setupPendingApproval({ amountUsdc: '10.00', quorumThresholdUsdc: '100.00', quorum: 2 });
    const response = await firstOperator.post(`/orgs/${orgId}/approvals/${approvalId}/approve`, {});
    expect(response.json().status).toBe('approved');
  });
});
```

- [x] **Step 2: Implement**

Needs an `approval_votes` table (one row per approver per approval, unique on the pair) so the second test passes structurally rather than by convention. Keep Phase 5's `requested_by <> approver` guard applying to **every** vote.

- [x] **Step 3: Verify and commit**

```bash
git add packages/db/src/migrations apps/api/src/engines/approvals apps/api/test
git commit -m "feat(approvals): add N-of-M quorum above a configurable threshold"
```

---

## Chunk 5: M25/M26 — Distribution `[manifest G1, G2]`

**The manifest's own warning, honoured by placing this last:** *"this is adoption work, not architecture work. Do not let it displace Sections B/C/E."*

### Task 5: Google ADK binding `[G1]`

- [x] **Step 1:** Expose the existing MCP tool surface in the shape ADK expects. Our MCP service already serves `policy_check`, `payment_x402`, `approval_status` etc. as bearer-authenticated HTTP — **this is a binding, not new architecture.**
- [x] **Step 2:** Write one working example agent that uses it.
- [x] **Step 3:** Test that the example actually runs end to end, then commit.

### Task 6: Agent-readable onboarding `[G2]`

- [x] **Step 1:** Publish `llms.txt` and `skill.md` so agents can self-onboard without a human reading docs. Write them **to agents**, not to humans — that is what makes Ampersand's version effective.
- [x] **Step 2:** Verify by having an agent onboard from them cold, with no other context.
- [x] **Step 3:** Commit.

---

## Phase 9 Done Criteria

- [x] Derived ledger balances match the existing counters exactly
- [x] `UPDATE` and `DELETE` on postings are **rejected by the database**
- [x] Corrections append an offsetting row rather than editing
- [x] The docs state honestly that this is append-only postings with derived balances, **not** full double-entry
- [x] Reservations release only when **both** death-predicate conditions hold
- [x] A used authorization past `validBefore` does **not** release
- [x] All 7 `batch-settlement` binding items are documented, describing what shipped
- [x] Quorum requires N distinct approvers above threshold; one below
- [x] The same operator cannot vote twice toward quorum
- [x] The ADK example agent runs end to end
- [x] An agent can onboard from `llms.txt` / `skill.md` with no other context
- [x] `npm run verify` passes with Docker up
