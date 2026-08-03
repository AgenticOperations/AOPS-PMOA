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

### Task 1: S1 — Reconcile Arc's chain ID `[K-17]`

Two sources disagree: Arc's RPC docs say **`5042002`**; the live x402 facilitator reportedly returns **`eip155:14601`**. A wrong chain ID signs against the wrong EIP-712 domain and **fails silently** — the worst failure mode.

- [ ] **Step 1: Write the probe**

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

- [ ] **Step 2: Run it**

```bash
node scripts/spikes/s1-arc-chain-id.mjs
```

- [ ] **Step 3: Record the answer**

Write to `docs/spike-results.md`: the decimal chain ID from RPC, the exact CAIP-2 strings the facilitator advertises, and **which one Phase 2 will hardcode**.

If they genuinely differ, the facilitator's value governs for x402 signing (that is what verifies the signature) and the RPC value governs for direct chain calls. **Say so explicitly** — Phase 2 Task 3 depends on this.

- [ ] **Step 4: Commit**

```bash
git add scripts/spikes/s1-arc-chain-id.mjs docs/spike-results.md
git commit -m "chore(spike): reconcile Arc chain id"
```

---

### Task 2: S2 — Dev-controlled wallets on Arc `[A2]`

**Blocks all of Phase 2 and 3.** No fallback — if dev-controlled wallets do not work on `ARC-TESTNET`, per-agent wallets are impossible and the build drops to the manifest's Floor tier.

- [ ] **Step 1: Write the probe**

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

- [ ] **Step 2: Run and record**

```bash
node scripts/spikes/s2-arc-wallet-e2e.mjs
```

Record: does `ARC-TESTNET` appear as an accepted blockchain string? What is the exact literal Circle expects? Are the returned wallets `EOA`? Do two wallets in one set get distinct addresses?

- [ ] **Step 3: Fund and transfer**

Using S5's faucet answer, fund one wallet and transfer to the other. Record both tx hashes and confirm them on `testnet.arcscan.app`.

- [ ] **Step 4: Commit**

```bash
git add scripts/spikes/s2-arc-wallet-e2e.mjs docs/spike-results.md
git commit -m "chore(spike): verify dev-controlled wallets on Arc testnet"
```

---

### Task 3: S4 — Permit2 against Arc's native-USDC view `[K-12]`

**Highest-value spike.** Gates Lane 2 (agent-to-agent). Failure drops the target tier from **T3 → T4**. The manifest says test this first, and it is right.

The risk: Arc's USDC *is* the native gas asset, exposed through an ERC-20 view that **truncates** (6-decimal view over an 18-decimal native balance). Permit2 was written for ordinary ERC-20s.

- [ ] **Step 1: Write the probe**

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

- [ ] **Step 2: The decisive test — a real approve + transferFrom**

Reading `DOMAIN_SEPARATOR` only proves deployment. The actual question is whether an agent EOA can `approve` Permit2 on Arc's USDC **and** whether Permit2 can then `transferFrom` it. Using two wallets from S2:

1. Wallet A `approve`s Permit2 as spender on the Arc USDC contract.
2. Sign a `PermitSingle` from A naming B's address as spender, with a small `amount`.
3. Call `transferFrom` and confirm value moved.
4. Read `allowance` again and confirm it **decremented** — this is the drawdown property the whole Lane 2 claim rests on.

- [ ] **Step 3: Record the verdict**

Record in `docs/spike-results.md`, with tx hashes:
- Did `approve` succeed against the native-USDC ERC-20 view?
- Did `transferFrom` move value?
- Did the allowance decrement by exactly the drawn amount, or did truncation distort it?

**If any step fails:** record it plainly and mark **Lane 2 → per-payment `exact` authorizations, target tier T4**. Phase 6's plan says the same. This is a legitimate outcome, not a failure of the build.

- [ ] **Step 4: Commit**

```bash
git add scripts/spikes/s4-permit2-arc.mjs docs/spike-results.md
git commit -m "chore(spike): verify Permit2 against Arc native USDC"
```

---

## Chunk 2: Supporting spikes

### Task 4: S3 — Sweep authority `[A1]`

Gates M11 (sweep-revocation) — the manifest's best demo moment. The question: can the entity secret that created a wallet move funds **out** of it, back to treasury, with no per-wallet credential?

- [ ] **Step 1: Probe** — using S2's funded wallet, initiate a transfer from the agent wallet back to the treasury address, authorized only by the entity secret.
- [ ] **Step 2: Record** the tx hash, or the exact error.
- [ ] **Step 3:** If it fails, **M11 dies.** Record that the revocation story reduces to Permit2 `lockdown()` alone (Phase 6), and tell the demo narrative to drop the sweep moment.
- [ ] **Step 4: Commit**

---

### Task 5: S5 — Arc faucet path `[K-4]`

No funding, no demo.

- [ ] **Step 1: Probe** whether the existing `requestTestnetFunds` (in the Circle provider) supports Arc, and what the manual faucet path is.
- [ ] **Step 2: Record** the working funding route and how long it takes.
- [ ] **Step 3: Commit**

---

### Task 6: S6 — Arc balance truncation `[C3]`

Shapes M7 and M8. Constraint I.8 says Arc's ERC-20 `balanceOf` **truncates**, so `0` there does not mean zero native balance — an agent could read as empty while still holding gas, or vice versa.

- [ ] **Step 1: Probe** — on a wallet holding a small amount, read both `balanceOf` (ERC-20 view, 6dp) and `eth_getBalance` (native, 18dp). Compare.
- [ ] **Step 2: Record** the exact relationship and **which call gas decisions must use**. Phase 3 hardcodes this answer.
- [ ] **Step 3: Commit**

---

### Task 7: S7 — Compliance screening access `[A5]`

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

- [ ] **Step 1:** Write `docs/decisions.md` with all six, each with its reasoning and its date.
- [ ] **Step 2: Commit**

```bash
git add docs/decisions.md
git commit -m "docs: record Arc build decisions"
```

---

## Phase 0 Done Criteria

- [ ] `docs/spike-results.md` has a YES/NO **with evidence** for S1–S7
- [ ] The Arc chain ID that Phase 2 will hardcode is written down unambiguously
- [ ] S2 confirmed (or refuted) dev-controlled EOA wallets on `ARC-TESTNET`, with tx hashes
- [ ] S4's verdict states the target tier: **T3** if Permit2 works, **T4** if not
- [ ] S3's verdict states whether M11 (sweep) is alive
- [ ] S6 states which balance call gas decisions use
- [ ] `docs/decisions.md` records all six decisions
- [ ] **No production code changed** — `git diff` touches only `scripts/spikes/` and `docs/`

**Gate:** do not start Phase 2 until S1 and S2 are answered. Do not start Phase 6 until S4 is answered.
