# Phase 7: Escrow and Just-in-Time Bridge Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Read `2026-08-03-scope-and-cuts.md` first.**

**Goal:** Add ERC-8183 escrow for external providers where delivery risk is real, and replace the stubbed cross-chain bridge with Circle's just-in-time Gateway path.

**Architecture:** Escrow is **additive** — Permit2 (Phase 6) remains the primary agent-to-agent rail. Escrow applies only to Mode 2: an external, untrusted provider where the value is *proof of funding before work starts*. The bridge replaces the `bridgeWalletTopUp` stub whose regression Phase 2 deliberately accepted.

**Tech Stack:** `viem`, ERC-8183 reference implementation on Arc testnet, Circle Gateway `/v1/transfer`.

**Gate:** requires Phase 6 complete. **Task 2 is gated on spike S8** — do not build escrow before S8 answers.

**Why this phase runs after T3:** ERC-8183 is the only item in the manifest whose external dependency could move under us — a Draft EIP roughly five months old, one testnet implementation, **no evidence of an audit**, and addresses published only in Arc's tutorials rather than its contract-address reference. Building it is worthwhile; letting T3's claims rest on it is not.

---

## Context you need before starting

**The two tasks are independent.** Task 4 (bridge) does not depend on escrow and can run in parallel with Tasks 2–3, or first if S8 fails.

**ERC-8183 lifecycle:** `Open → Funded → Submitted → Completed | Rejected | Expired`. Roles: Client, Provider, **Evaluator**. Mapping onto our domain: escrow-funded = our reservation held; `Completed` = reservation settles; `Rejected`/`Expired` = reservation releases.

**Known limits to design around — all confirmed from the spec:**

| Limit | Consequence for our design |
|---|---|
| **No arbiter or dispute role.** The evaluator's decision is binary, and the spec states *"reject/expire is final."* | No appeals path exists. Do not build UI implying one. |
| **`setBudget` is callable by client *or* provider** while `Open` | **Always call `fund(jobId, expectedBudget)`** — it reverts on mismatch. That is the spec's own front-running guard. Never call the single-argument form. |
| **Evaluator liveness is unhandled — the sharpest trap.** If the evaluator goes silent while `Submitted`, the only exit is `claimRefund` after expiry, which **refunds the client even though the work was delivered.** `Expired` is indistinguishable from `Rejected`. | The provider structurally eats evaluator inaction. Surface this in the operator UI as a real risk, and monitor `Submitted` jobs approaching expiry. |
| **The evaluator can `reject` while merely `Funded`** — killing a job mid-work, before submission | Providers need to know work can be cancelled after they start. |
| **`deliverable` is `bytes32`, only emitted in an event** — never stored on the job struct | Read deliverables from logs, not from contract state. |
| **Hooks run client-supplied code in the state-change path** — the spec flags this as a footgun with only `SHOULD`-level mitigations | Our own hook (Phase 8 · Task 2) must be minimal and non-reverting. |
| **Permit2 cannot fund escrow directly.** `fund()` does a plain `safeTransferFrom` and requires `_msgSender() == job.client` | Routing Permit2 in needs an adapter that *becomes* the client, severing client identity from the real payer. Use the spec's sanctioned path instead: ERC-2612/EIP-3009 + ERC-2771. Arc's USDC supports EIP-3009 natively. |

**Mode discipline (manifest D2b).** Escrow ships for **Mode 2** only — external provider, `evaluator = client`. Be precise about what that degrades to: *"a client-controlled hold with a refund timer."* The provider gets certainty the money exists and cannot be silently withdrawn. It does **not** get neutral arbitration, because the client decides release. Arc's own showcase job runs this degenerate mode — decoding `jobs(1)` shows client and evaluator are the same address — so do not treat Arc's tutorial as a reference for trust-minimized use.

**Never use escrow for sub-cent, high-frequency payments.** Five-plus state-changing transactions per job means orchestration cost dominates the payment. Circle's own guidance for that tier is EIP-3009 with off-chain batching — which is what Phase 6 built.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `scripts/spikes/s8-erc8183-funding.mjs` | Verify escrow mechanics before building | **Create** |
| `packages/db/src/migrations/0029_escrow_jobs.sql` | Escrow job lifecycle records | **Create** |
| `apps/api/src/engines/payments/escrow.ts` | ERC-8183 lifecycle client | **Create** |
| `apps/api/src/engines/payments/gateway-bridge.ts` | JIT burn → attest → mint | **Create** |
| `apps/api/src/engines/payments/circle-provider.ts` | Replace `bridgeWalletTopUp` stub | Modify `:993-1000` |
| `apps/api/test/payments/escrow.test.ts` | Lifecycle tests | **Create** |
| `apps/api/test/payments/gateway-bridge.test.ts` | Bridge tests | **Create** |

---

## Chunk 1: S8 — Verify escrow before building it

### Task 1: Spike ERC-8183 funding mechanics `[K-5]`

Same pattern as S4 gating Phase 6. One script, before any production code.

- [x] **Step 1: Write the probe**

```js
// scripts/spikes/s8-erc8183-funding.mjs
import { createPublicClient, http, parseAbi } from 'viem';

const ESCROW = '0x0747EEf0706327138c69792bF28Cd525089e4583';   // verified proxy
const client = createPublicClient({ transport: http('https://rpc.testnet.arc.network') });

// 1. Is it actually deployed, and is it the proxy we expect?
const code = await client.getBytecode({ address: ESCROW });
console.log('escrow bytecode length:', code?.length ?? 0);

// 2. Arc's own showcase job -- confirms the degenerate evaluator==client mode
const job = await client.readContract({
  address: ESCROW,
  abi: parseAbi(['function jobs(uint256) view returns (address,address,address,uint256,uint8)']),
  functionName: 'jobs',
  args: [1n],
});
console.log('jobs(1) [client, provider, evaluator, budget, state]:', job);
console.log('client === evaluator?', job[0] === job[2]);
```

- [x] **Step 2: The decisive questions**

Reading state only proves deployment. Run a **real job lifecycle** on testnet with two agent wallets from Phase 3:

1. Does the agent wallet need to `approve` the escrow contract before `fund()`? (The spec says `fund()` does `safeTransferFrom`, so yes — confirm.)
2. Does `fund(jobId, expectedBudget)` **revert on budget mismatch** as the spec claims? Deliberately pass a wrong expected budget and confirm the revert.
3. Can the agent wallet `approve` on Arc's **native-USDC ERC-20 view**? (Related to S4 — if S4 failed, this likely fails too.)
4. Walk `Open → Funded → Submitted → Completed` end to end. Record every tx hash.
5. Confirm `deliverable` appears **only in the event log**, not in `jobs()` state.
6. **Re-verify the registry addresses** — D3 needs Identity `0x8004A818...`, and these appear only in tutorials. Confirm they hold code.

- [x] **Step 3: Record the verdict**

Write to `docs/spike-results.md`. If any of 1–4 fails:

> **S8 fallback.** Escrow (D2) does not ship. Record why with the exact error. **Phase 8 · Task 1 (D3 ERC-8004 identity) still ships standalone** — identity registration does not depend on escrow. Phase 8 · Tasks 2–3 (payment-gated reputation, D4/D5) **fall with D2**, because reputation is written from the escrow completion hook and that is precisely what makes it earned. Do not ship ungated reputation as a substitute — the manifest is explicit that unearned ERC-8004 feedback is close to meaningless, and shipping it would be the overclaim Section J exists to prevent.

**Verdict recorded: FALLBACK.** Decisive question 2 fails on direct decoded on-chain evidence — the deployed `fund()` has no `expectedBudget` parameter (real selector `fund(uint256,bytes)` = `0xe25ba707`), so the front-running guard the plan assumed does not exist. Six real Arc testnet transactions confirm the mechanical lifecycle otherwise works end to end. Full evidence, tx hashes, and decoded calldata in `docs/spike-results.md`'s "S8" section. **Escrow (D2) does not ship in Phase 7 — Tasks 2 and 3 below are skipped per this step's own fallback rule.**

- [x] **Step 4: Commit**

```bash
git add scripts/spikes/s8-erc8183-funding.mjs docs/spike-results.md
git commit -m "chore(spike): verify ERC-8183 escrow funding mechanics on Arc"
```

---

## Chunk 2: M16 — ERC-8183 escrow `[manifest D2]`

**Gate:** S8 passed. If it did not, skip to Chunk 3.

**S8 did not pass (see above) — Tasks 2 and 3 below are skipped per the plan's own fallback rule.** Neither the migration nor the lifecycle client ship. Left unchecked below for the record.

### Task 2: Escrow job records `[D2]` — **SKIPPED, S8 fallback**

- [ ] **Step 1: Write the migration**

```sql
-- 0029_escrow_jobs.sql
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
  onchain_job_id numeric(78, 0),
  budget_usdc numeric(20, 6) NOT NULL CHECK (budget_usdc > 0),
  reservation_id text REFERENCES payment_reservations (id) ON DELETE RESTRICT,
  -- Mirrors the ERC-8183 lifecycle exactly. Note 'expired' is a DISTINCT
  -- row from 'rejected' even though the contract treats them identically
  -- on refund -- we need to tell "delivered but unevaluated" apart from
  -- "failed" in our own evidence, even though the chain cannot.
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'funded', 'submitted', 'completed', 'rejected', 'expired')),
  -- Mode 2 means evaluator == client. Recorded explicitly so claim
  -- discipline can be enforced from data rather than memory.
  escrow_mode integer NOT NULL CHECK (escrow_mode IN (2, 3)),
  deliverable_hash text,
  expires_at timestamptz NOT NULL,
  fund_tx_hash text,
  complete_tx_hash text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS escrow_jobs_org_state_idx
  ON escrow_jobs (org_id, mode, state, expires_at);

-- Evaluator-liveness watch: Submitted jobs approaching expiry are the
-- trap case -- the provider delivered and will be refunded against.
CREATE INDEX IF NOT EXISTS escrow_jobs_liveness_idx
  ON escrow_jobs (state, expires_at) WHERE state = 'submitted';
```

- [ ] **Step 2: Verify and commit**

```bash
docker compose up -d
npx vitest run test/migrate.test.ts --root packages/db
git add packages/db/src/migrations/0029_escrow_jobs.sql
git commit -m "feat(db): add ERC-8183 escrow job records"
```

---

### Task 3: Escrow lifecycle client `[D2, K-5]` — **SKIPPED, S8 fallback**

- [ ] **Step 1: Write the failing test**

```ts
describe('ERC-8183 escrow lifecycle', () => {
  it('always funds with an expected budget to guard against front-running', async () => {
    const calls: unknown[] = [];
    await fundEscrowJob(pool, { jobId: 'esc_1' }, { call: (...a) => { calls.push(a); } });

    // setBudget is callable by client OR provider while Open, so the
    // single-argument fund() is unsafe. The two-argument form reverts
    // on mismatch -- that is the spec's own guard.
    expect(calls[0]).toMatchObject({ functionName: 'fund' });
    expect((calls[0] as any).args).toHaveLength(2);
  });

  it('settles the reservation on complete', async () => {
    const { jobId, reservationId, pool } = await setupFundedEscrow({ budgetUsdc: '5.00' });
    await applyEscrowStateChange(pool, { jobId, state: 'completed', txHash: '0xabc' });

    const res = await pool.query('SELECT status FROM payment_reservations WHERE id = $1', [reservationId]);
    expect(res.rows[0].status).toBe('settled');
  });

  it('releases the reservation on reject', async () => {
    const { jobId, reservationId, pool } = await setupFundedEscrow({ budgetUsdc: '5.00' });
    await applyEscrowStateChange(pool, { jobId, state: 'rejected' });
    const res = await pool.query('SELECT status FROM payment_reservations WHERE id = $1', [reservationId]);
    expect(res.rows[0].status).toBe('released');
  });

  it('releases on expiry but records it distinctly from reject', async () => {
    const { jobId, pool } = await setupFundedEscrow({ budgetUsdc: '5.00' });
    await applyEscrowStateChange(pool, { jobId, state: 'expired' });

    // The contract refunds identically, but our evidence must distinguish
    // "delivered but unevaluated" from "failed".
    const row = await pool.query('SELECT state FROM escrow_jobs WHERE id = $1', [jobId]);
    expect(row.rows[0].state).toBe('expired');
  });

  it('flags submitted jobs approaching expiry', async () => {
    // The evaluator-liveness trap: provider delivered, evaluator silent,
    // and claimRefund will refund the CLIENT anyway.
    const { pool } = await setupSubmittedEscrow({ expiresInHours: 2 });
    const atRisk = await listEscrowLivenessRisks(pool, { withinHours: 6 });
    expect(atRisk).toHaveLength(1);
  });

  it('rejects escrow for sub-cent payments', async () => {
    // Five-plus state-changing txs per job -- orchestration cost dominates.
    await expect(createEscrowJob(pool, { budgetUsdc: '0.005' }))
      .rejects.toThrow(/escrow_uneconomic_for_amount/);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement `escrow.ts`**

Implement `createEscrowJob`, `fundEscrowJob` (**always** two-argument `fund`), `applyEscrowStateChange`, and `listEscrowLivenessRisks`. Map state changes onto the existing reservation lifecycle rather than inventing a parallel one — `completed` settles, `rejected`/`expired` release.

Add a minimum-amount guard so escrow cannot be used for the sub-cent tier.

- [ ] **Step 3: Verify on Arc testnet**

Run a full Mode 2 job end to end with a real external-style provider. Record every tx hash and the final state.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/engines/payments/escrow.ts apps/api/test/payments/escrow.test.ts docs/spike-results.md
git commit -m "feat(payments): add ERC-8183 escrow lifecycle for external providers"
```

---

## Chunk 3: M17 — Just-in-time Gateway bridge `[manifest K-15, K-18]`

Independent of escrow — runs regardless of S8's verdict.

### Task 4: Replace the `bridgeWalletTopUp` stub `[K-15, K-18]`

Phase 2 · Task 1 accepted a deliberate regression: flipping to developer-controlled wallets removed the only working bridge, leaving `circle-provider.ts:993-1000` returning `success: false`. This task pays that debt.

Circle publishes a sample titled *"burns from Arc Testnet and mints on Base Sepolia"* — literally our scenario. Three calls, **no human, no private keys, no OTP**.

- [x] **Step 1: Write the failing test**

```ts
describe('just-in-time Gateway bridge', () => {
  it('burns on the source chain, attests, and mints on the destination', async () => {
    const calls: string[] = [];
    const result = await bridgeWalletTopUp({
      amount: '5.00', fromChain: 'arc', toChain: 'base', mode: 'test',
    }, {
      signTypedData: async () => { calls.push('signTypedData'); return '0xsig'; },
      postTransfer: async () => { calls.push('transfer'); return { attestation: '0xa', signature: '0xs' }; },
      contractExecution: async () => { calls.push('gatewayMint'); return { txHash: '0xmint' }; },
    });

    expect(calls).toEqual(['signTypedData', 'transfer', 'gatewayMint']);
    expect(result.success).toBe(true);
  });

  it('fails clearly when the wallet was never deposited into Gateway', async () => {
    // A plain ERC-20 transfer to the Gateway contract is NOT credited --
    // the deposit() function must be called. This is a one-time
    // per-wallet onboarding step, not a per-call cost.
    await expect(bridgeWalletTopUp(
      { amount: '5.00', fromChain: 'arc', toChain: 'base', mode: 'test' },
      { ...deps, gatewayBalance: async () => 0n },
    )).resolves.toMatchObject({ success: false, errorReason: 'gateway_wallet_not_deposited' });
  });

  it('no longer returns the not-supported stub', async () => {
    const result = await bridgeWalletTopUp({ /* ... */ }, deps);
    expect(result.errorReason).not.toBe('developer_controlled_bridge_topup_not_supported');
  });
});
```

- [x] **Step 2: Run to verify it fails, then implement `gateway-bridge.ts`**

Three steps, per Circle's sample:
1. **`signTypedData`** — Circle's MPC signs the EIP-712 `BurnIntent` on Arc. (This is also what proves MPC can produce EIP-712 signatures at all.)
2. **`POST /v1/transfer`** to Gateway → returns `{attestation, signature}`.
3. **`contractExecution`** — call `gatewayMint(bytes,bytes)` on Base Sepolia.

Mint lands in **under 500ms** at the same address. Then wire it into `circle-provider.ts:993-1000`, replacing the stub.

**One-time prerequisite per wallet:** `approve` then `deposit(address,uint256)` into the Gateway contract. Circle frames this as *"wallet onboarding, not a per-call cost."* Implement it as a separate provisioning step, and make the missing-deposit case fail with a clear error rather than a confusing one.

- [ ] **Step 3: Verify on testnet, update the decision record** — **PARTIAL, in progress**

Run a real Arc→Base bridge. Record tx hashes both sides. Then amend the K-18 entry in `docs/decisions.md`:

> **K-18 regression resolved** in Phase 7 · Task 4. `bridgeWalletTopUp` is implemented via the Gateway JIT path. Cross-chain no longer depends solely on Option A pre-funding.

**Real evidence so far:** a real `approve` + `deposit(address,uint256)` into Gateway succeeded on Arc testnet from a funded agent wallet (Circle developer-controlled wallets, test mode) — confirmed via the public Gateway balances API showing the deposited amount. The burn-intent signing and Gateway `/v1/transfer` attestation round-trip also ran for real against this deposit. **Blocked on the final step:** the `gatewayMint` call on Base Sepolia needs Base Sepolia ETH for gas in the destination wallet, which has none — Circle's testnet faucet returns `403 Forbidden` for native gas too (same root cause as spike S5's USDC faucet block). Waiting on manual funding of `0xecf29492264424ae73fc1434a30a66d2f6a9b48f` on Base Sepolia; both tx hashes will be recorded and this step + the `docs/decisions.md` K-18 amendment completed once unblocked.

- [x] **Step 4: Run the full gate and commit**

```bash
npm run verify
git add apps/api/src/engines/payments/gateway-bridge.ts apps/api/src/engines/payments/circle-provider.ts apps/api/test docs/decisions.md
git commit -m "feat(payments): implement just-in-time Gateway bridge"
```

---

## Phase 7 Done Criteria

- [x] S8's verdict is recorded with evidence, and states whether D2 ships — **FALLBACK, D2 does not ship**
- [ ] ~~(If S8 passed) `fund()` is **always** called with an expected budget; a mismatch reverts~~ — N/A, S8 fallback
- [ ] ~~Escrow `completed` settles the reservation; `rejected`/`expired` release it~~ — N/A, S8 fallback
- [ ] ~~`expired` is recorded distinctly from `rejected`, despite identical on-chain refund behavior~~ — N/A, S8 fallback
- [ ] ~~Submitted jobs approaching expiry are surfaced as evaluator-liveness risks~~ — N/A, S8 fallback
- [ ] ~~Escrow refuses sub-cent amounts~~ — N/A, S8 fallback
- [x] A full Mode 2 job ran on Arc testnet with recorded tx hashes — ran for S8's own verification (6 real txs); not shipped as production code since D2 doesn't ship
- [ ] The bridge burns on Arc, attests, and mints on Base — verified with tx hashes both sides — **in progress**, blocked on Base Sepolia gas funding
- [x] A wallet never deposited into Gateway fails with `gateway_wallet_not_deposited`, not a confusing error
- [ ] The K-18 regression entry in `docs/decisions.md` is marked resolved — pending the live mint tx hash above
- [x] `npm run verify` passes with Docker up

**Claim discipline:**
- ✅ *"Escrow proves the funds exist and can't be silently withdrawn before the provider starts work."*
- ❌ **Never** call `evaluator = client` neutral arbitration — the client decides release. Only Mode 3 with a genuine third party earns that claim.
- ✅ ERC-8183 is an **Ethereum Foundation + Virtuals Protocol** standard, not Circle's. Arc is a deployment venue. Draft, and **no evidence of an audit**.
- ✅ *"An Arc agent pays a Base agent — sign a burn intent on Arc, mint on Base in under a second, no human in the loop."*
- ❌ Never claim a Gateway balance is spendable on any chain at payment time.
