# Phase 0: Gates — Spikes and Decisions

> **For Claude:** REQUIRED: Use superpowers:executing-plans to work through this. Steps use checkbox (`- [ ]`) syntax.
>
> **Read `2026-08-03-scope-and-cuts.md` first.**

**Goal:** Answer every unverified assumption that downstream phases depend on, before any production code is written against it.

**Architecture:** Throwaway probe scripts under `scripts/spikes/`. Nothing here ships. Each spike answers one yes/no question with recorded evidence.

**Tech Stack:** Node 22 + `tsx`, `viem`, `@circle-fin/developer-controlled-wallets` (all already dependencies).

**Why this phase exists:** four of these can invalidate an entire downstream phase. Learning that on day one costs a script; learning it in Phase 6 costs the milestone.

---

## Rules for this phase

1. **No production code.** Nothing in `apps/` or `packages/` changes. Spikes live in `scripts/spikes/` and are deleted or archived afterwards.
2. **Evidence, not opinion.** Every answer needs a tx hash, an API response body, or an error message pasted into `docs/spike-results.md`.
3. **A failed spike is a success.** The point is to find out. Record the failure and take the documented fallback.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/spikes/s1-arc-chain-id.mjs` | Reconcile Arc's chain ID |
| `scripts/spikes/s2-arc-wallet-e2e.mjs` | Dev-controlled wallet lifecycle on Arc |
| `scripts/spikes/s3-sweep-authority.mjs` | Can the entity secret move funds out |
| `scripts/spikes/s4-permit2-arc.mjs` | Permit2 against Arc's native-USDC view |
| `scripts/spikes/s5-arc-faucet.mjs` | Testnet funding path |
| `docs/spike-results.md` | Recorded evidence (**create**) |
| `docs/decisions.md` | Recorded decisions (**create**) |

---

## Chunk 1: Blocking spikes

Run S1, S2, S4 **first** — they gate the most.

### Task 1: S1 — Reconcile Arc's chain ID `[K-17]` ✅ DONE

Two sources disagree: Arc's RPC docs say **`5042002`**; the live x402 facilitator reportedly returns **`eip155:14601`**. A wrong chain ID signs against the wrong EIP-712 domain and **fails silently** — the worst failure mode.

**Result: resolved, and the manifest's premise was wrong** — `14601` and `5042002` are two different chains, not conflicting reports of one. Arc is `eip155:5042002`, confirmed by both RPC `eth_chainId` and the facilitator's own USDC-address match. See `docs/spike-results.md` § S1.

- [x] **Step 1: Write the probe**

```js
// scripts/spikes/s1-arc-chain-id.mjs
const RPC = 'https://rpc.testnet.arc.network';
const FACILITATOR = 'https://gateway-api-testnet.circle.com/v1/x402/supported';

const rpc = await fetch(RPC, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
}).then((r) => r.json());

const chainIdHex = rpc.result;
console.log('RPC eth_chainId:', chainIdHex, '=> decimal', parseInt(chainIdHex, 16));

const supported = await fetch(FACILITATOR).then((r) => r.json());
const arcEntries = JSON.stringify(supported).match(/eip155:\d+/g) ?? [];
console.log('facilitator networks:', [...new Set(arcEntries)]);
console.log('full facilitator payload:', JSON.stringify(supported, null, 2));
```

- [x] **Step 2: Run it**

```bash
node scripts/spikes/s1-arc-chain-id.mjs
```

- [x] **Step 3: Record the answer**

Write to `docs/spike-results.md`: the decimal chain ID from RPC, the exact CAIP-2 strings the facilitator advertises, and **which one Phase 2 will hardcode**.

If they genuinely differ, the facilitator's value governs for x402 signing (that is what verifies the signature) and the RPC value governs for direct chain calls. **Say so explicitly** — Phase 2 Task 3 depends on this.

- [x] **Step 4: Commit** — `c69ff73`

```bash
git add scripts/spikes/s1-arc-chain-id.mjs docs/spike-results.md
git commit -m "chore(spike): reconcile Arc chain id"
```

---

### Task 2: S2 — Dev-controlled wallets on Arc `[A2]` ✅ PASS (funding step blocked, does not gate Phase 2/3)

**Blocks all of Phase 2 and 3.** No fallback — if dev-controlled wallets do not work on `ARC-TESTNET`, per-agent wallets are impossible and the build drops to the manifest's Floor tier.

**Result: PASS.** `ARC-TESTNET` accepted, two EOA wallets provisioned under `DEVELOPER` custody from one entity secret, no OTP. Phases 2 and 3 unblocked. See `docs/spike-results.md` § S2.

- [x] **Step 1: Write the probe**

Exercise create → read → transfer using the SDK the repo already depends on. Mirror the calls in `apps/api/src/engines/payments/circle-provider.ts:989-1184` (`createDeveloperControlledCircleTreasuryProvider`) rather than inventing a new client.

```js
// scripts/spikes/s2-arc-wallet-e2e.mjs
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

const walletSet = await client.createWalletSet({ name: 'spike-arc', idempotencyKey: crypto.randomUUID() });
console.log('walletSet:', walletSet.data?.walletSet?.id);

const wallets = await client.createWallets({
  walletSetId: walletSet.data.walletSet.id,
  blockchains: ['ARC-TESTNET'],   // <-- the actual question
  accountType: 'EOA',             // <-- pin EOA, see K-16
  count: 2,
  idempotencyKey: crypto.randomUUID(),
});
console.log('wallets:', JSON.stringify(wallets.data, null, 2));
```

- [x] **Step 2: Run and record**

```bash
node scripts/spikes/s2-arc-wallet-e2e.mjs
```

Record: does `ARC-TESTNET` appear as an accepted blockchain string? What is the exact literal Circle expects? Are the returned wallets `EOA`? Do two wallets in one set get distinct addresses?

- [ ] **Step 3: Fund and transfer** — ⬜ **BLOCKED, not done.** S5's faucet returns 403 for both `ARC-TESTNET` and `BASE-SEPOLIA` (API-key scope issue, not Arc-specific — see S5 below). Two wallets exist on-chain at zero balance; fund→transfer has not been exercised. Needs faucet permission enabled on the key, or manual funding, before this step can close.
- [x] **Step 4: Commit** — `c69ff73`

```bash
git add scripts/spikes/s2-arc-wallet-e2e.mjs docs/spike-results.md
git commit -m "chore(spike): verify dev-controlled wallets on Arc testnet"
```

---

### Task 3: S4 — Permit2 against Arc's native-USDC view `[K-12]` 🟡 READ PATH DONE, write path blocked

**Highest-value spike.** Gates Lane 2 (agent-to-agent). Failure drops the target tier from **T3 → T4**. The manifest says test this first, and it is right.

The risk: Arc's USDC *is* the native gas asset, exposed through an ERC-20 view that **truncates** (6-decimal view over an 18-decimal native balance). Permit2 was written for ordinary ERC-20s.

**Result so far: read path passes.** Permit2 deployed (9152 bytes, canonical address), `DOMAIN_SEPARATOR` responds, `allowance()` returns a correct 3-tuple against Arc's native-USDC address without reverting. **T3 provisionally confirmed.** Final confirmation (a real `approve` + `transferFrom` showing the allowance decrement) needs funded wallets — blocked on the same S5 faucet issue as S2/S3. See `docs/spike-results.md` § S4.

- [x] **Step 1: Write the probe**

```js
// scripts/spikes/s4-permit2-arc.mjs
import { createPublicClient, http, parseAbi } from 'viem';

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const client = createPublicClient({ transport: http('https://rpc.testnet.arc.network') });

// 1. Is Permit2 actually deployed here?
const code = await client.getBytecode({ address: PERMIT2 });
console.log('Permit2 bytecode length:', code?.length ?? 0);

// 2. Does it respond?
const domain = await client.readContract({
  address: PERMIT2,
  abi: parseAbi(['function DOMAIN_SEPARATOR() view returns (bytes32)']),
  functionName: 'DOMAIN_SEPARATOR',
});
console.log('DOMAIN_SEPARATOR:', domain);

// 3. The real question: allowance() shape against Arc's USDC
const allowance = await client.readContract({
  address: PERMIT2,
  abi: parseAbi([
    'function allowance(address,address,address) view returns (uint160,uint48,uint48)',
  ]),
  functionName: 'allowance',
  args: [TEST_OWNER, ARC_USDC, TEST_SPENDER],
});
console.log('allowance (amount, expiration, nonce):', allowance);
```

- [ ] **Step 2: The decisive test — a real approve + transferFrom** — ⬜ **BLOCKED, not done.** Needs funded wallets from S2, which needs S5's faucet fixed first.

Reading `DOMAIN_SEPARATOR` only proves deployment. The actual question is whether an agent EOA can `approve` Permit2 on Arc's USDC **and** whether Permit2 can then `transferFrom` it. Using two wallets from S2:

1. Wallet A `approve`s Permit2 as spender on the Arc USDC contract.
2. Sign a `PermitSingle` from A naming B's address as spender, with a small `amount`.
3. Call `transferFrom` and confirm value moved.
4. Read `allowance` again and confirm it **decremented** — this is the drawdown property the whole Lane 2 claim rests on.

- [x] **Step 3: Record the verdict** — recorded as partial (read-path only) in `docs/spike-results.md` § S4

Record in `docs/spike-results.md`, with tx hashes:
- Did `approve` succeed against the native-USDC ERC-20 view?
- Did `transferFrom` move value?
- Did the allowance decrement by exactly the drawn amount, or did truncation distort it?

**If any step fails:** record it plainly and mark **Lane 2 → per-payment `exact` authorizations, target tier T4**. Phase 6's plan says the same. This is a legitimate outcome, not a failure of the build.

- [x] **Step 4: Commit** — `c69ff73`

```bash
git add scripts/spikes/s4-permit2-arc.mjs docs/spike-results.md
git commit -m "chore(spike): verify Permit2 against Arc native USDC"
```

---

## Chunk 2: Supporting spikes

### Task 4: S3 — Sweep authority `[A1]` ⬜ NOT DONE — blocked on S5

Gates M11 (sweep-revocation) — the manifest's best demo moment. The question: can the entity secret that created a wallet move funds **out** of it, back to treasury, with no per-wallet credential?

**Status:** cannot run — needs a funded wallet, and S5's faucet is blocked (403). No sweep has been attempted yet. Phase 4 · Task 5 (sweep-revocation) cannot proceed until this closes.

- [ ] **Step 1: Probe** — using S2's funded wallet, initiate a transfer from the agent wallet back to the treasury address, authorized only by the entity secret.
- [ ] **Step 2: Record** the tx hash, or the exact error.
- [ ] **Step 3:** If it fails, **M11 dies.** Record that the revocation story reduces to Permit2 `lockdown()` alone (Phase 6), and tell the demo narrative to drop the sweep moment.
- [ ] **Step 4: Commit**

---

### Task 5: S5 — Arc faucet path `[K-4]` ❌ BLOCKED — this is the root blocker for S3 and S4 Step 2

No funding, no demo.

**Status:** faucet returns `403 Forbidden` for both `ARC-TESTNET` and `BASE-SEPOLIA` with the current API key — confirmed to be a key-scope/permission issue, not an Arc limitation (identical failure on both chains; the same key successfully creates wallets and 3 pre-existing wallets already hold testnet USDC from before). **Needs a human to either enable faucet permission on this key in the Circle console, or fund the recorded Arc address manually.** See `docs/spike-results.md` § S5 for the exact address and reproduction.

- [x] **Step 1: Probe** whether the existing `requestTestnetFunds` (in the Circle provider) supports Arc, and what the manual faucet path is. — probed directly via `/v1/faucet/drips`; result is the 403 above.
- [x] **Step 2: Record** the working funding route and how long it takes. — recorded that there is currently **no working route**; the block and its cause are documented.
- [x] **Step 3: Commit** — `c69ff73`

---

### Task 6: S6 — Arc balance truncation `[C3]` ✅ DONE

Shapes M7 and M8. Constraint I.8 says Arc's ERC-20 `balanceOf` **truncates**, so `0` there does not mean zero native balance — an agent could read as empty while still holding gas, or vice versa.

**Result: truncation confirmed exactly 1:1** (`balanceOf == floor(native / 1e12)`). **New finding beyond the plan's ask:** Arc's public RPC failed 14 of 25 identical `balanceOf` calls (~56%) — a failed read must never be coerced to zero (would reject valid payments / trigger spurious top-ups); retry with backoff and treat exhaustion as a distinct `balance_unavailable` error. See `docs/spike-results.md` § S6.

- [x] **Step 1: Probe** — on a wallet holding a small amount, read both `balanceOf` (ERC-20 view, 6dp) and `eth_getBalance` (native, 18dp). Compare.
- [x] **Step 2: Record** the exact relationship and **which call gas decisions must use**. Phase 3 hardcodes this answer.
- [x] **Step 3: Commit** — `c69ff73`

---

### Task 7: S7 — Compliance screening access `[A5]` ⬜ NOT RUN

- [ ] **Step 1:** Determine whether Transaction Screening API access is granted (it is sales-gated).
- [ ] **Step 2:** If denied, **drop it** — do not fake or stub a compliance claim. Record the decision.

---

## Chunk 3: Decisions

Record each in `docs/decisions.md` with the reasoning, not just the verdict.

| # | Decision | Recommendation |
|---|---|---|
| **A3** | Flip to developer-controlled wallets? | **Yes.** Per-agent wallets are impossible under Agent Wallets (each is bound to a human's email + OTP). Keep the Agent Wallet path behind the existing env flag as fallback. |
| **A4** | Arc-only, or Arc + more chains? | **Arc testnet + Base Sepolia only.** Base is needed solely for the cross-chain hop. Every extra chain multiplies wallets to fund and monitor. |
| **A6 / K-2** | How much escrow ships, and in which mode? | **None in T3; built in Phase 7**, gated on spike S8. When it ships, use **Mode 2** (external provider, `evaluator = client`) per D2b and describe it as *proof-of-funding before work begins* — **never** as neutral arbitration. If agentOps ever acts as evaluator itself, that must be disclosed: it would confer quasi-custodial power over escrowed funds. |
| **K-6** | Reputation → allocation formula | Needed for Phase 8 · Task 3. It **must** be bounded with a hard floor and ceiling — an unbounded feedback loop on real money is dangerous. Decide the exact function before Phase 8 starts; Phase 8 · Task 3 will not proceed without it. |
| **K-11** | Circle's 7-day `minValiditySeconds` on Arc `exact` | **Cap Lane 1 to small amounts.** A 7-day signed exposure window is long; keep per-payment values low so the worst case stays small. |
| **K-18** | Accept the `bridgeWalletTopUp` regression? | **Yes, explicitly.** Flipping to dev-controlled removes the only working bridge (the stub returns `success: false`). Cross-chain uses pre-funding (Option A). Record it so it is not discovered at demo time. |

- [x] **Step 1:** Write `docs/decisions.md` with all six, each with its reasoning and its date. — done, all six present
- [x] **Step 2: Commit** — `4947db2` (folded into the Phase 2 Task 1 commit, which is where K-18 was actually confirmed)

```bash
git add docs/decisions.md
git commit -m "docs: record Arc build decisions"
```

---

## Phase 0 Done Criteria

**Status: Phase 0 is PARTIALLY complete.** Enough was resolved to safely start Phase 2 (done) and Phase 3, but S3, S5, and S7 remain open, and S4's final confirmation is blocked on the same root cause as S3.

- [ ] `docs/spike-results.md` has a YES/NO **with evidence** for S1–S7 — **6 of 7 have a verdict; S7 not run.**
- [x] The Arc chain ID that Phase 2 will hardcode is written down unambiguously — `eip155:5042002`, used in Phase 2
- [x] S2 confirmed (or refuted) dev-controlled EOA wallets on `ARC-TESTNET`, with tx hashes — confirmed; wallet addresses recorded, fund/transfer tx hashes still pending (blocked on S5)
- [ ] S4's verdict states the target tier: **T3** if Permit2 works, **T4** if not — **provisional T3** from the read path; final confirmation (the write-path decrement) blocked on S5
- [ ] S3's verdict states whether M11 (sweep) is alive — **not answered**, blocked on S5
- [x] S6 states which balance call gas decisions use — native `eth_getBalance`, not `balanceOf`
- [x] `docs/decisions.md` records all six decisions
- [x] **No production code changed** — confirmed; Phase 0's own commit (`c69ff73`) touches only `scripts/spikes/` and `docs/`

**Outstanding before Phase 0 can be called fully done:**
1. **Fix S5** — get faucet permission on the API key, or fund `0x00ca790a06002bb6ace2488633bfea71dc2023df` manually (see `docs/spike-results.md` § S5 for the exact address).
2. **Re-run S3** once funded — this decides whether Phase 4 · Task 5 (sweep-revocation) is buildable at all.
3. **Finish S4 Step 2** once funded — the real `approve`/`transferFrom`/decrement test, which turns "provisional T3" into a confirmed tier before Phase 6 starts.
4. **Run S7** — compliance screening access; low urgency, does not block Phases 2-6.

**Gate:** do not start Phase 2 until S1 and S2 are answered. Do not start Phase 6 until S4 is answered. *(Both satisfied enough to proceed — Phase 2 is done; Phase 6 still needs S4's write-path confirmation first.)*
