# Phase 8: Payment-Gated Reputation Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Read `2026-08-03-scope-and-cuts.md` first.**

**Goal:** Register agents in ERC-8004's on-chain identity registry, make reputation writable **only** from a settled escrow completion, and feed that earned reputation back into capital allocation.

**Architecture:** Three layers, strictly ordered. Identity (D3) is a standalone NFT registration. Reputation (D4) is written from an ERC-8183 `IACPHook.afterAction` hook firing on genuine `complete` — never from an API call. Allocation feedback (D5) makes reputation adjust Phase 4's allocation within hard bounds.

**Tech Stack:** `viem`, ERC-8004 registries on Arc testnet, the Phase 7 escrow hook.

**Gate:** Task 1 requires Phase 7 · S8 address re-verification. **Tasks 2–3 require Phase 7 · Chunk 2 (escrow) to have shipped.**

**This phase is the novel contribution.** D4 is a property the standard itself lacks, no competitor implements, and is Arc-specific. It is also the most downstream item in the manifest — which is why it is last.

---

## Context you need before starting

**The gap D4 closes.** ERC-8004's spec forbids only rating *yourself*: *"The feedback submitter MUST NOT be the agent owner or an approved operator."* It does **not** require the rater to have paid or received anything. **Any address can write feedback with zero proof of a real job.** As shipped, the reputation number is close to meaningless.

**Our contribution:** write feedback **only** from an escrow completion hook, so reputation becomes earnable exclusively by a real, settled, escrowed job. Describe it exactly that way — never claim ERC-8004 reputation is trustworthy as-is.

**Registry addresses — re-verify before use.** Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663...`, Validation `0x8004Cb1B...`. These appear only in Arc's **tutorials**, not in its official contract-address reference page. Treat as testnet-tutorial-grade. Phase 7 · S8 Step 2.6 re-verifies them; if that check was skipped, do it now before writing any code against them.

**If Phase 7's S8 failed:** Task 1 (identity) still ships — registration does not depend on escrow. Tasks 2–3 **do not ship**. Do not substitute an ungated reputation write to keep the feature visible; that would be exactly the overclaim the manifest's Section J exists to prevent, and it would ship the very weakness we criticise competitors for.

**Resolved:** the S8 spike's "FALLBACK" verdict was against a stale/original escrow deployment whose tutorial ABI didn't match the deployed struct (wrong `fund()` selector, garbage decoded values). Escrow was later deployed correctly with the real guarded signature (`docs/superpowers/plans/2026-08-05-escrow-contract-deploy.md`) and proven end-to-end (`docs/spike-results.md`'s escrow lifecycle and trust-graduation sections). Escrow ships, so Tasks 2–3 proceeded — this is not the ungated-fallback path the paragraph above warns against.

**The hook is a footgun.** ERC-8183's spec flags that hooks run client-supplied code inside the state-change path, with only `SHOULD`-level mitigations. Our hook must be **minimal, non-reverting, and side-effect-free on the escrow's own state**. If reputation writing fails, the escrow completion must still succeed.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/migrations/0033_agent_identity_reputation.sql` | Identity + reputation records | **Create** |
| `apps/api/src/engines/identity/erc8004.ts` | Registry client | **Create** |
| `apps/api/src/engines/payments/reputation-hook.ts` | Escrow-gated feedback writer | **Create** |
| `apps/api/src/engines/payments/allocations.ts` | Reputation → allocation | Modify (Phase 4 file) |
| `apps/api/test/identity/erc8004.test.ts` | Registration tests | **Create** |
| `apps/api/test/payments/reputation-hook.test.ts` | Gating tests | **Create** |

---

## Chunk 1: M18 — ERC-8004 identity `[manifest D3]`

Ships regardless of S8's escrow verdict.

### Task 1: Register agents in the IdentityRegistry `[D3]`

- [x] **Step 1: Write the migration**

```sql
-- 0033_agent_identity_reputation.sql
-- ERC-8004 identity is an ERC-721 NFT per agent.
-- Registry addresses appear only in Arc's TUTORIALS, not its official
-- contract reference -- treat as testnet-tutorial-grade and re-verify.

CREATE TABLE IF NOT EXISTS agent_onchain_identities (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  registry_address text NOT NULL,
  token_id numeric(78, 0),
  agent_uri text NOT NULL,
  register_tx_hash text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'registered', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, mode, chain)
);

-- Every reputation write, with the escrow job that earned it.
-- escrow_job_id is NOT NULL BY DESIGN: reputation cannot exist without
-- a settled escrow job. This is the entire contribution -- the standard
-- permits unearned feedback; the schema here forbids it.
CREATE TABLE IF NOT EXISTS agent_reputation_events (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  escrow_job_id text NOT NULL REFERENCES escrow_jobs (id) ON DELETE RESTRICT,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  feedback_tx_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (escrow_job_id)
);

CREATE INDEX IF NOT EXISTS agent_reputation_events_agent_idx
  ON agent_reputation_events (agent_id, created_at DESC);
```

> `UNIQUE (escrow_job_id)` prevents one completed job being milked for repeated feedback. `NOT NULL` on the FK is what makes "earned only" a database guarantee rather than a code convention.

- [x] **Step 2: Write the failing test**

```ts
describe('ERC-8004 identity registration', () => {
  it('registers an agent and records its token id', async () => {
    const { orgId, agentId, pool } = await setupAgentFixture();
    await registerAgentIdentity(pool, { orgId, agentId, mode: 'test', chain: 'arc' }, fakeRegistry);

    const row = await pool.query(
      'SELECT status, token_id FROM agent_onchain_identities WHERE agent_id = $1', [agentId],
    );
    expect(row.rows[0].status).toBe('registered');
    expect(row.rows[0].token_id).not.toBeNull();
  });

  it('is idempotent - re-registering does not mint a second identity', async () => {
    const { orgId, agentId, pool } = await setupAgentFixture();
    await registerAgentIdentity(pool, { orgId, agentId, mode: 'test', chain: 'arc' }, fakeRegistry);
    await registerAgentIdentity(pool, { orgId, agentId, mode: 'test', chain: 'arc' }, fakeRegistry);

    const rows = await pool.query('SELECT 1 FROM agent_onchain_identities WHERE agent_id = $1', [agentId]);
    expect(rows.rowCount).toBe(1);
  });
});
```

- [x] **Step 3: Re-verify the registry address, then implement**

```bash
node scripts/spikes/s8-erc8183-funding.mjs   # includes registry address checks
```

If the Identity registry has no code at the tutorial address, **stop** and record it — do not guess an alternative.

Implement `register(agentURI, MetadataEntry[])` in `erc8004.ts`. Registration is an NFT mint, so make it idempotent against the `UNIQUE (agent_id, mode, chain)` constraint.

- [x] **Step 4: Verify on testnet and commit**

Register a real agent; record the token id and tx hash.

```bash
git add packages/db/src/migrations/0033_agent_identity_reputation.sql apps/api/src/engines/identity/erc8004.ts apps/api/test/identity/erc8004.test.ts
git commit -m "feat(identity): register agents in the ERC-8004 identity registry"
```

---

## Chunk 2: M19 — Payment-gated reputation `[manifest D4]`

**Gate:** requires Phase 7 escrow. If S8 failed, stop here.

### Task 2: Write reputation only from an escrow completion hook `[D4]`

- [x] **Step 1: Write the failing test**

The gating tests are the point of this task — they encode the contribution.

```ts
describe('payment-gated reputation', () => {
  it('writes feedback when an escrow job genuinely completes', async () => {
    const { orgId, agentId, jobId, pool } = await setupCompletedEscrow({ providerAgentId: 'agt_p' });

    await onEscrowCompleted(pool, { jobId }, fakeReputationRegistry);

    const events = await pool.query(
      'SELECT escrow_job_id FROM agent_reputation_events WHERE agent_id = $1', ['agt_p'],
    );
    expect(events.rowCount).toBe(1);
    expect(events.rows[0].escrow_job_id).toBe(jobId);
  });

  it('refuses to write feedback with no escrow job', async () => {
    // THE contribution. ERC-8004 permits any address to write feedback
    // with zero proof of a real job. We forbid it at the schema level.
    await expect(writeReputation(pool, { agentId: 'agt_p', score: 100, escrowJobId: null }))
      .rejects.toThrow();
  });

  it('refuses to write feedback for a job that was rejected', async () => {
    const { jobId, pool } = await setupEscrowInState('rejected');
    await expect(onEscrowCompleted(pool, { jobId }, fakeReputationRegistry))
      .rejects.toThrow(/not_completed/);
  });

  it('refuses to write feedback for a job that merely expired', async () => {
    // Expired means "delivered but unevaluated" -- NOT a proven completion.
    const { jobId, pool } = await setupEscrowInState('expired');
    await expect(onEscrowCompleted(pool, { jobId }, fakeReputationRegistry))
      .rejects.toThrow(/not_completed/);
  });

  it('writes at most one feedback per job', async () => {
    const { jobId, pool } = await setupCompletedEscrow({ providerAgentId: 'agt_p' });
    await onEscrowCompleted(pool, { jobId }, fakeReputationRegistry);
    await onEscrowCompleted(pool, { jobId }, fakeReputationRegistry);

    const events = await pool.query('SELECT 1 FROM agent_reputation_events WHERE escrow_job_id = $1', [jobId]);
    expect(events.rowCount).toBe(1);
  });

  it('does not fail the escrow completion when the reputation write fails', async () => {
    // The spec flags hooks as a footgun -- they run in the state-change
    // path. A reputation failure must never revert a settled payment.
    const { jobId, pool } = await setupCompletedEscrow({ providerAgentId: 'agt_p' });
    const failing = { writeFeedback: async () => { throw new Error('registry down'); } };

    await expect(onEscrowCompleted(pool, { jobId }, failing)).resolves.not.toThrow();
  });
});
```

- [x] **Step 2: Run to verify it fails, then implement `reputation-hook.ts`**

Bind to the ERC-8183 `IACPHook.afterAction` hook, firing only on `complete`. Re-read the job's on-chain state before writing — do not trust the hook's payload alone.

Keep the hook **minimal and non-reverting**: catch every error from the registry write, log it, and return successfully. A failed reputation write is an operational problem; a reverted escrow completion is a money problem.

- [x] **Step 3: Verify on testnet and commit**

Complete a real escrow job; confirm feedback appears on-chain and that no path exists to write it otherwise.

```bash
git add apps/api/src/engines/payments/reputation-hook.ts apps/api/test/payments/reputation-hook.test.ts
git commit -m "feat(payments): gate ERC-8004 reputation on settled escrow completion"
```

---

## Chunk 3: M20 — Reputation feeds allocation `[manifest D5, K-6]`

### Task 3: Bounded reputation → allocation feedback `[D5, K-6]`

**Decision required before starting (K-6).** The formula must be written down in `docs/decisions.md` first. **An unbounded feedback loop on real money is dangerous** — this is the one place in the build where a bug compounds automatically rather than failing once.

Non-negotiable properties:
- A **hard floor** — reputation can never drive allocation to zero and strand an agent.
- A **hard ceiling** — no amount of reputation exceeds the operator-set `ceiling_usdc`.
- **Bounded step size** — one job cannot move allocation more than a fixed fraction.
- **The Phase 4 solvency invariant still binds.** Reputation adjusts allocation *within* treasury deposits, never around them.

- [x] **Step 1: Write the failing test**

```ts
describe('reputation-driven allocation', () => {
  it('never drops allocation below the floor', async () => {
    const next = nextAllocation({
      current: 5_000_000n, floor: 2_000_000n, ceiling: 20_000_000n,
      reputation: 0, maxStepBps: 1000,
    });
    expect(next).toBeGreaterThanOrEqual(2_000_000n);
  });

  it('never raises allocation above the operator ceiling', async () => {
    const next = nextAllocation({
      current: 19_500_000n, floor: 2_000_000n, ceiling: 20_000_000n,
      reputation: 100, maxStepBps: 1000,
    });
    expect(next).toBeLessThanOrEqual(20_000_000n);
  });

  it('bounds how far a single job can move allocation', async () => {
    const next = nextAllocation({
      current: 10_000_000n, floor: 1_000_000n, ceiling: 100_000_000n,
      reputation: 100, maxStepBps: 1000,   // 10% max step
    });
    expect(next).toBeLessThanOrEqual(11_000_000n);
  });

  it('still refuses to breach the treasury solvency invariant', async () => {
    // Reputation adjusts allocation WITHIN deposits, never around them.
    const { orgId, agentId, pool } = await setupTreasuryFixture({ depositsUsdc: '50.00' });
    await setAllocation(pool, { orgId, agentId, chain: 'arc', allocatedUsdc: '50.00' });

    await expect(applyReputationAdjustment(pool, { orgId, agentId, chain: 'arc', reputation: 100 }))
      .resolves.toMatchObject({ allocatedUsdc: '50.000000' });   // capped, not raised
  });

  it('converges rather than oscillating across repeated adjustments', async () => {
    let current = 10_000_000n;
    for (let i = 0; i < 50; i += 1) {
      current = nextAllocation({
        current, floor: 1_000_000n, ceiling: 20_000_000n,
        reputation: 100, maxStepBps: 1000,
      });
    }
    expect(current).toBe(20_000_000n);   // settles at the ceiling, no runaway
  });
});
```

- [x] **Step 2: Record the formula, then implement**

Write the exact function into `docs/decisions.md` as decision K-6 before coding it. Implement `nextAllocation` as a **pure function** so it is exhaustively testable without a database, and call it from an `applyReputationAdjustment` that reuses Phase 4's `setAllocation` — which already enforces solvency under the org advisory lock. Do not bypass it.

- [x] **Step 3: Run the full gate and commit**

```bash
npm run verify
git add apps/api/src/engines/payments/allocations.ts apps/api/test docs/decisions.md
git commit -m "feat(payments): adjust allocation from earned reputation within bounds"
```

---

## Phase 8 Done Criteria

- [x] Registry addresses were **re-verified** before any code was written against them
- [x] Agents register in the IdentityRegistry; registration is idempotent
- [x] (If escrow shipped) Reputation is written **only** from a genuine escrow `complete`
- [x] Feedback with no escrow job is rejected **at the database level**
- [x] `rejected` and `expired` jobs write no reputation
- [x] At most one feedback per job
- [x] A failing reputation write **does not** revert the escrow completion
- [x] Allocation adjustment respects floor, ceiling, and max step size
- [x] Allocation adjustment still obeys the Phase 4 solvency invariant
- [x] Repeated adjustments converge; no oscillation or runaway
- [x] The K-6 formula is recorded in `docs/decisions.md`
- [x] `npm run verify` passes with Docker up

**Claim discipline:**
- ✅ *"Reputation is earned only by completing a real escrowed job — a property the standard itself does not require."*
- ❌ **Never** claim ERC-8004 reputation is trustworthy as-is. It permits unearned feedback; our contribution is gating it.
- ✅ *"The fleet re-allocates its own capital from verifiable on-chain outcomes, with no human touching a number."* True only once Task 3 ships, and only within the bounds above — say the bounds exist.
