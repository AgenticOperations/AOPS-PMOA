# Phase 1: Critical Fixes Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Read `2026-08-03-scope-and-cuts.md` first.** The scope rule: only change existing code when required functionality is missing or wrong. Never rewrite a working flow because a better approach exists.

**Goal:** Make policy fail closed instead of open, and add an emergency stop that halts an org or agent before any other check runs.

**Architecture:** Two independent changes. (1) The policy decision engine currently returns `allow` when zero rules match — we branch on the empty-match case and consult a new org-level default. (2) There is no emergency stop; we add an org `frozen` flag and enforce it at the single choke point every payment already passes through.

**Tech Stack:** TypeScript, Fastify, PostgreSQL (raw `pg`), Vitest.

**Why this phase is first:** both are hours of work against the two worst findings in the audit, and neither depends on Arc, wallets, or any spike result. Start immediately, in parallel with Phase 0.

---

## Context you need before starting

**The fail-open defect.** `evaluatePolicyDecision` folds matched statements with a max-severity reduce:

```ts
// apps/api/src/engines/policy/decision-engine.ts:157-160 (current)
const decision = matched.reduce<PolicyDecisionValue>(
  (current, match) => (decisionRank[match.decision] > decisionRank[current] ? match.decision : current),
  'allow',
);
```

`decisionRank` is `{allow: 0, observe: 1, approval_required: 2, deny: 3}` (`:19-24`). When `matched` is empty the reduce returns its seed — `allow`. So **any action type with no authored rule is silently permitted.**

**⚠️ THE TRAP — read this twice.** Do **not** fix this by changing the seed to `'deny'`. Because the fold takes the *highest rank*, a `'deny'` seed would beat every matching `allow` rule and **deny every request in the system**. The fix is to branch on `matched.length === 0` *before* the fold and leave the seed exactly as it is. Task 1 tests this explicitly.

**Two call sites, both in `apps/api/src/engines/policy/store.ts`:**
- `:1709` in `checkPolicyDecision` — the **real enforcement path**
- `:1438` in policy draft **simulation** (dry-run)

Both must get the same default, or simulation will lie about what enforcement does.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/migrations/0022_fail_closed_policy_and_freeze.sql` | Org policy default + freeze columns | **Create** |
| `apps/api/src/engines/policy/decision-engine.ts` | Pure decision fold; add empty-match branch | Modify `:141-169` |
| `apps/api/src/engines/policy/types.ts` | `PolicyDecisionValue` already fits; add default type | Modify |
| `apps/api/src/engines/policy/store.ts` | Pass org default into both call sites | Modify `:1438`, `:1709` |
| `apps/api/src/engines/payments/store.ts` | Enforce freeze in `activePaymentAccount` | Modify `:4672-4686` |
| `apps/api/src/engines/operations/store.ts` | Freeze/unfreeze operations | Modify |
| `apps/api/src/engines/operations/routes.ts` | Freeze/unfreeze endpoints | Modify |
| `apps/api/test/policy/decision-engine.test.ts` | Fail-closed unit tests | Modify `:12` |
| `apps/api/test/operations/freeze.test.ts` | Kill-switch integration tests | **Create** |

**Migration numbering:** highest existing is `0021_runtime_payment_attempts.sql`. This one is **0022**. Do not number it 0021 — it will collide.

---

## Chunk 1: M1 — Policy fails closed `[manifest E1]`

### Task 1: Empty-match branch in the decision engine `[E1]`

**Files:**
- Modify: `apps/api/src/engines/policy/decision-engine.ts:141-169`
- Test: `apps/api/test/policy/decision-engine.test.ts`

- [ ] **Step 1: Write the failing tests**

The existing test at `apps/api/test/policy/decision-engine.test.ts:12` asserts the *old* fail-open behavior — it is now wrong and must be inverted. Replace it, and add the trap-guard tests:

```ts
describe('Section 2 policy decision engine', () => {
  it('denies requests when no active policy statement matches', () => {
    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'user', id: 'usr_owner', role: 'owner' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: 'agt_1' },
        context: {},
      },
      policies: [],
    });

    expect(result).toEqual({
      decision: 'deny',
      enforceability: 'enforceable',
      reasonCode: 'no_matching_policy_denied',
      explanation: 'No policy authorizes this request.',
      matched: [],
    });
  });

  it('allows when the org default is permissive and nothing matches', () => {
    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'user', id: 'usr_owner', role: 'owner' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: 'agt_1' },
        context: {},
      },
      policies: [],
      defaultEffect: 'allow',
    });

    expect(result.decision).toBe('allow');
    expect(result.reasonCode).toBe('no_matching_policy');
  });

  // TRAP GUARD: a matching allow rule must still win. If someone "fixes"
  // the fail-open bug by seeding the reduce with 'deny', this test fails.
  it('still allows when a matching statement says allow', () => {
    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'user', id: 'usr_owner', role: 'owner' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: 'agt_1' },
        context: {},
      },
      policies: [{
        policyId: 'pol_1',
        version: 1,
        name: 'allow-issue',
        statements: [{ ...baseStatement, decision: 'allow' }],
      }],
    });

    expect(result.decision).toBe('allow');
    expect(result.matched).toHaveLength(1);
  });

  // TRAP GUARD: the max-rank fold must be intact.
  it('prefers deny over allow when both match', () => {
    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'user', id: 'usr_owner', role: 'owner' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: 'agt_1' },
        context: {},
      },
      policies: [{
        policyId: 'pol_1',
        version: 1,
        name: 'mixed',
        statements: [
          { ...baseStatement, id: 'stmt_a', decision: 'allow' },
          { ...baseStatement, id: 'stmt_b', decision: 'deny' },
        ],
      }],
    });

    expect(result.decision).toBe('deny');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/policy/decision-engine.test.ts --root apps/api
```
Expected: FAIL — the first test gets `decision: 'allow'`, and `defaultEffect` is not a known property.

- [ ] **Step 3: Implement the branch**

In `apps/api/src/engines/policy/decision-engine.ts`, add the reason/explanation entries near the existing maps (`:26-37`):

```ts
const NO_MATCH_DENY_REASON = 'no_matching_policy_denied';
const NO_MATCH_DENY_EXPLANATION = 'No policy authorizes this request.';
```

Then replace `evaluatePolicyDecision` (`:141-169`):

```ts
export function evaluatePolicyDecision(input: {
  readonly request: PolicyDecisionRequest;
  readonly policies: readonly EffectivePolicy[];
  readonly defaultEffect?: PolicyDefaultEffect;
}): PolicyDecisionResult {
  const matched = input.policies.flatMap((policy) =>
    policy.statements
      .filter((statement) => matchesStatement(statement, input.request))
      .map((statement) => ({
        policyId: policy.policyId,
        policyVersion: policy.version,
        policyName: policy.name,
        statementId: statement.id,
        decision: statement.decision,
      })),
  );

  // Fail closed: with no authored rule the request is not authorized.
  // NOTE: do not express this by seeding the reduce below with 'deny' —
  // the fold takes the highest rank, so a 'deny' seed would beat every
  // matching allow and deny everything.
  if (matched.length === 0) {
    const permissive = input.defaultEffect === 'allow';
    return {
      decision: permissive ? 'allow' : 'deny',
      enforceability: 'enforceable',
      reasonCode: permissive ? reasonCode.allow : NO_MATCH_DENY_REASON,
      explanation: permissive ? explanation.allow : NO_MATCH_DENY_EXPLANATION,
      matched: [],
    };
  }

  const decision = matched.reduce<PolicyDecisionValue>(
    (current, match) => (decisionRank[match.decision] > decisionRank[current] ? match.decision : current),
    'allow',
  );

  return {
    decision,
    enforceability: 'enforceable',
    reasonCode: reasonCode[decision],
    explanation: explanation[decision],
    matched,
  };
}
```

Add to `apps/api/src/engines/policy/types.ts`:

```ts
export type PolicyDefaultEffect = 'deny' | 'allow';
```

and export it from `decision-engine.ts`'s existing type re-export block (`:1-8`).

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/policy/decision-engine.test.ts --root apps/api
```
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/engines/policy/decision-engine.ts apps/api/src/engines/policy/types.ts apps/api/test/policy/decision-engine.test.ts
git commit -m "fix(policy): deny requests with no matching statement"
```

---

### Task 2: Org-level policy default `[E1]`

**Files:**
- Create: `packages/db/src/migrations/0022_fail_closed_policy_and_freeze.sql`
- Modify: `apps/api/src/engines/policy/store.ts:1438`, `:1709`
- Test: `packages/db/test/migrate.test.ts` (existing), `apps/api/test/policy/policy-routes.test.ts`

- [ ] **Step 1: Write the migration**

This migration covers **both** M1 and M2 — one file, since both add org columns.

```sql
-- 0022_fail_closed_policy_and_freeze.sql

-- M1: org-level policy default. Defaults to 'deny' (fail closed).
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS default_policy_effect text NOT NULL DEFAULT 'deny'
    CHECK (default_policy_effect IN ('deny', 'allow'));

-- M2: emergency stop. Agents already have 'paused'/'suspended' in
-- agents.status (migration 0002:112); orgs have no equivalent.
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS frozen boolean NOT NULL DEFAULT false;
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS frozen_reason text;
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz;
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS frozen_by text;
```

> **Deliberate default choice:** existing orgs get `'deny'`, same as new ones. This is a **behavior change for live data** — orgs with no authored rules stop permitting unmatched actions. That is the entire point of the fix. If an existing org needs the old behavior temporarily, set its `default_policy_effect` to `'allow'` explicitly and audit it.

- [ ] **Step 2: Run migration test to verify it applies**

```bash
docker compose up -d
npx vitest run test/migrate.test.ts --root packages/db
```
Expected: PASS. Must apply cleanly **on a database already at 0021**, not only from scratch.

- [ ] **Step 3: Thread the default into both call sites**

In `apps/api/src/engines/policy/store.ts`, add a helper near the other query helpers:

```ts
async function orgDefaultPolicyEffect(client: Db, orgId: string): Promise<PolicyDefaultEffect> {
  const result = await client.query<{ readonly default_policy_effect: PolicyDefaultEffect }>(
    'SELECT default_policy_effect FROM orgs WHERE id = $1',
    [orgId],
  );
  return result.rows[0]?.default_policy_effect ?? 'deny';
}
```

At the **enforcement** call site (`:1709`, in `checkPolicyDecision`):

```ts
    const result = evaluatePolicyDecision({
      request,
      policies: await effectivePoliciesForRequest(client, orgId, request),
      defaultEffect: await orgDefaultPolicyEffect(client, orgId),
    });
```

At the **simulation** call site (`:1438`) — apply the same default, or a dry-run will disagree with real enforcement:

```ts
    const result = evaluatePolicyDecision({
      request,
      policies: [
        {
          policyId: draft.id,
          version: 0,
          name: draft.name,
          statements: statementsFromJson(draft.statements),
        },
      ],
      defaultEffect: await orgDefaultPolicyEffect(client, orgId),
    });
```

- [ ] **Step 4: Run the policy suite**

```bash
npx vitest run test/policy --root apps/api
```

**Expect failures here — this is the known blast radius.** `policy-routes.test.ts` (1043 lines) and `runtime-integration.test.ts` contain tests that rely on implicit allow. For each failure decide deliberately:
- Test asserts an unmatched action succeeds → **the test was encoding the bug.** Update it to expect `deny`, or give the test org an authored allow rule.
- Test needs permissive behavior to exercise something unrelated → set that org's `default_policy_effect = 'allow'` in the fixture.

Do **not** blanket-set fixtures to `'allow'` to make the suite green — that would silently restore the defect in test coverage.

- [ ] **Step 5: Run the full API suite**

```bash
npm test --workspace @agentops-pmoa/api
```
Expected: PASS. Confirm the test *count* is unchanged or higher — a lower count means tests silently skipped.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/0022_fail_closed_policy_and_freeze.sql apps/api/src/engines/policy/store.ts apps/api/test
git commit -m "feat(policy): add org-level default policy effect"
```

---

## Chunk 2: M2 — Kill switch `[manifest C5]`

The columns land in migration 0022 (Task 2, Step 1). This chunk is enforcement plus operator controls.

**Why `activePaymentAccount` is the right insertion point:** it is the **first** call in `preparePaidHttpPayment` (`store.ts:4852`), it already runs `SELECT ... FOR UPDATE`, and it already throws on `status`/`payment_access`. Adding the freeze check there means it runs before rail, cap, budget, source, reservation, and policy — with row locking for free. No new machinery.

### Task 3: Enforce freeze in the payment path `[C5]`

**Files:**
- Modify: `apps/api/src/engines/payments/store.ts:4672-4686`
- Test: `apps/api/test/operations/freeze.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
// Follow the harness used by apps/api/test/payments/section-6-8-payment-control.test.ts
// for org/agent/account fixtures and the paid-HTTP request helper.

describe('emergency freeze', () => {
  it('rejects payment for a frozen org before any other check', async () => {
    const { orgId, agentId, pool, request } = await setupPaymentFixture();
    await pool.query('UPDATE orgs SET frozen = true, frozen_reason = $2 WHERE id = $1', [orgId, 'incident']);

    const response = await request.paidHttp({ agentId, amountUsdc: '0.01' });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('org_frozen');

    // Nothing may be reserved when frozen.
    const reservations = await pool.query('SELECT 1 FROM payment_reservations WHERE org_id = $1', [orgId]);
    expect(reservations.rowCount).toBe(0);
    const account = await pool.query(
      'SELECT reserved_usdc FROM agent_payment_accounts WHERE org_id = $1 AND agent_id = $2',
      [orgId, agentId],
    );
    expect(Number(account.rows[0].reserved_usdc)).toBe(0);
  });

  it('rejects payment for a frozen agent but not its siblings', async () => {
    const { orgId, agentId, siblingAgentId, pool, request } = await setupPaymentFixture();
    await pool.query("UPDATE agents SET status = 'suspended' WHERE id = $1", [agentId]);

    const blocked = await request.paidHttp({ agentId, amountUsdc: '0.01' });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('agent_frozen');

    const allowed = await request.paidHttp({ agentId: siblingAgentId, amountUsdc: '0.01' });
    expect(allowed.statusCode).not.toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/operations/freeze.test.ts --root apps/api
```
Expected: FAIL — payment succeeds despite the frozen org.

- [ ] **Step 3: Implement the check**

Replace `activePaymentAccount` in `apps/api/src/engines/payments/store.ts:4672-4686`. The join keeps this a **single** query — no extra round trip:

```ts
type AgentPaymentAccountGuardRow = AgentPaymentAccountRow & {
  readonly org_frozen: boolean;
  readonly agent_status: string;
};

async function activePaymentAccount(db: Db, auth: ConnectionAuthResult): Promise<AgentPaymentAccountRow> {
  const result = await db.query<AgentPaymentAccountGuardRow>(
    `SELECT apa.*, o.frozen AS org_frozen, a.status AS agent_status
       FROM agent_payment_accounts apa
       JOIN orgs o ON o.id = apa.org_id
       JOIN agents a ON a.id = apa.agent_id
      WHERE apa.org_id = $1
        AND apa.agent_id = $2
      FOR UPDATE OF apa`,
    [auth.org_id, auth.agent_id],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new IdentityError('payment_access_disabled', 403, 'Payment access is disabled for this agent.');
  }
  // Emergency stop runs before every other check.
  if (row.org_frozen) {
    throw new IdentityError('org_frozen', 403, 'This workspace is frozen. No actions can proceed.');
  }
  if (row.agent_status === 'paused' || row.agent_status === 'suspended') {
    throw new IdentityError('agent_frozen', 403, 'This agent is frozen. No actions can proceed.');
  }
  if (row.status !== 'active' || !row.payment_access) {
    throw new IdentityError('payment_access_disabled', 403, 'Payment access is disabled for this agent.');
  }
  return row;
}
```

> `FOR UPDATE OF apa` locks only the payment-account row. A bare `FOR UPDATE` would try to lock the joined `orgs` and `agents` rows too, which would serialize every agent in the org against each other.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/operations/freeze.test.ts --root apps/api
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/engines/payments/store.ts apps/api/test/operations/freeze.test.ts
git commit -m "feat(payments): halt frozen orgs and agents before budget checks"
```

---

### Task 4: Enforce freeze on non-payment runtime actions `[C5]`

**Files:**
- Modify: `apps/api/src/engines/runtime/` (route pre-handler)
- Test: `apps/api/test/operations/freeze.test.ts`

A freeze that only stops payments is not an emergency stop. Runtime actions must halt too.

- [ ] **Step 1: Write the failing test**

```ts
it('rejects runtime actions for a frozen org', async () => {
  const { orgId, pool, request } = await setupRuntimeFixture();
  await pool.query('UPDATE orgs SET frozen = true WHERE id = $1', [orgId]);

  const response = await request.runtimeAction({ action: 'management.connection.issue' });

  expect(response.statusCode).toBe(403);
  expect(response.json().code).toBe('org_frozen');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/operations/freeze.test.ts --root apps/api
```

- [ ] **Step 3: Implement**

Read `apps/api/src/engines/runtime/routes.ts` and find where connection auth resolves. Add a shared guard — export it from the payments store or a small new module so both paths use one implementation (DRY):

```ts
export async function assertNotFrozen(db: Db, orgId: string, agentId: string | null): Promise<void> {
  const result = await db.query<{ readonly org_frozen: boolean; readonly agent_status: string | null }>(
    `SELECT o.frozen AS org_frozen,
            (SELECT a.status FROM agents a WHERE a.id = $2) AS agent_status
       FROM orgs o
      WHERE o.id = $1`,
    [orgId, agentId],
  );
  const row = result.rows[0];
  if (row === undefined) return;
  if (row.org_frozen) {
    throw new IdentityError('org_frozen', 403, 'This workspace is frozen. No actions can proceed.');
  }
  if (row.agent_status === 'paused' || row.agent_status === 'suspended') {
    throw new IdentityError('agent_frozen', 403, 'This agent is frozen. No actions can proceed.');
  }
}
```

Call it immediately after auth resolves, before any policy evaluation or outbound work.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/operations/freeze.test.ts --root apps/api
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/engines/runtime apps/api/test/operations/freeze.test.ts
git commit -m "feat(runtime): halt frozen orgs and agents on runtime actions"
```

---

### Task 5: Freeze/unfreeze operator endpoints `[C5]`

**Files:**
- Modify: `apps/api/src/engines/operations/store.ts`, `apps/api/src/engines/operations/routes.ts`
- Test: `apps/api/test/operations/freeze.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('freezes and unfreezes an org with an audit trail', async () => {
  const { orgId, pool, operatorRequest } = await setupOperationsFixture();

  const frozen = await operatorRequest.post(`/orgs/${orgId}/freeze`, { reason: 'incident-1234' });
  expect(frozen.statusCode).toBe(200);
  expect(frozen.json().frozen).toBe(true);

  const row = await pool.query('SELECT frozen, frozen_reason, frozen_by FROM orgs WHERE id = $1', [orgId]);
  expect(row.rows[0].frozen).toBe(true);
  expect(row.rows[0].frozen_reason).toBe('incident-1234');
  expect(row.rows[0].frozen_by).not.toBeNull();

  const events = await pool.query(
    "SELECT 1 FROM audit_events WHERE org_id = $1 AND event_type = 'org.freeze.enabled'",
    [orgId],
  );
  expect(events.rowCount).toBe(1);

  const unfrozen = await operatorRequest.post(`/orgs/${orgId}/unfreeze`, {});
  expect(unfrozen.json().frozen).toBe(false);
});

it('rejects freeze from a non-operator', async () => {
  const { orgId, viewerRequest } = await setupOperationsFixture();
  const response = await viewerRequest.post(`/orgs/${orgId}/freeze`, { reason: 'nope' });
  expect(response.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/operations/freeze.test.ts --root apps/api
```
Expected: FAIL — 404, routes do not exist.

- [ ] **Step 3: Implement**

Follow the existing patterns in `operations/store.ts` and `operations/routes.ts` — use `requireOrgOperator(request, deps, orgId, 'operator')` for authorization and `recordAuditEvent` for the trail, exactly as the neighbouring rate-limit operations do. Add:

- `freezeOrg(pool, operator, orgId, reason)` → sets `frozen = true`, `frozen_reason`, `frozen_at = now()`, `frozen_by = operator.actorId`; emits `org.freeze.enabled`.
- `unfreezeOrg(pool, operator, orgId)` → clears them; emits `org.freeze.disabled`.
- `freezeAgent` / `unfreezeAgent` → set `agents.status` to `'suspended'` / `'active'`; emit `agent.freeze.enabled` / `.disabled`.
- Routes: `POST /orgs/:orgId/freeze`, `/unfreeze`, `/agents/:agentId/freeze`, `/unfreeze`.

Freeze must stay usable during an incident — do not gate the unfreeze route behind anything that a frozen org would itself block.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/operations/freeze.test.ts --root apps/api
```

- [ ] **Step 5: Run the full gate**

```bash
npm run verify
```
Expected: lint, typecheck, build, and tests all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/engines/operations apps/api/test/operations/freeze.test.ts
git commit -m "feat(operations): add org and agent emergency freeze controls"
```

---

## Phase 1 Done Criteria

- [ ] An action type with no authored rule is **denied**, with reason `no_matching_policy_denied`
- [ ] A matching `allow` rule still allows (trap guard passes)
- [ ] `deny` still beats `allow` when both match (fold intact)
- [ ] An org with `default_policy_effect = 'allow'` still permits unmatched actions, and that setting is auditable
- [ ] Simulation and enforcement agree on the default
- [ ] A frozen org blocks payments **and** runtime actions, before any budget or policy evaluation
- [ ] A frozen agent blocks only itself
- [ ] Freeze leaves `payment_reservations` empty and `reserved_usdc` unchanged
- [ ] Freeze/unfreeze emit audit events and require operator role
- [ ] `npm run verify` passes with Docker up, and the test count did not drop

**Do not claim** "policy fails closed" or "we have a kill switch" in any deck or demo until every box above is ticked.
