# Spike Results and Build Evidence

Evidence log for the Arc build. Every spike answer, tx hash, and acceptance artifact lands here.

**Rule:** evidence, not opinion. A YES needs a tx hash, an API response body, or an explorer link. A NO needs the exact error.

---

## Baseline — verified before any plan work

**Date:** 2026-08-03
**Branch:** `kc/a2a-imple`
**Commit:** `349b4e1`

### `npm run verify` — PASS, clean

| Workspace | Test files | Tests |
|---|---|---|
| `packages/db` | 2 | 7 |
| `apps/api` | 42 | 402 |
| `apps/mcp` | 6 | 204 |
| `apps/web` | 27 | 244 |
| **Total** | **77** | **857** |

Lint, typecheck, build, and all test suites pass. **`skipped 0`, `todo 0`** — confirmed via the bootstrap runner, so the Docker-gated server tests genuinely executed rather than skipping silently.

**Infrastructure at baseline:**
- `agentops-pmoa-postgres-1` — healthy, `:5432`
- `agentops-pmoa-redis-1` — healthy, `:6379`

**Why this matters:** Phase 1 deliberately breaks tests that encode the fail-open policy bug. A green baseline is what makes "these failures are expected, those are not" a meaningful distinction. Without it, Phase 1's blast radius is uninterpretable.

---

## Pre-spike environment findings

Read from `apps/api/.env` before running any probe. **These are configured values, not verified answers** — the spikes still need to run.

| Key | Value | Bearing on |
|---|---|---|
| `ARC_RPC_URL` | `https://rpc.testnet.arc.network` | **Corrects the plans.** The change manifest implied `rpc.testnet.arc.io`; the configured host is `.network`. All spike scripts updated to match. |
| `ARC_CHAIN_ID` | `5042002` | **S1 / K-17.** Matches Arc's RPC docs. Does **not** settle K-17 — the conflict is with what the x402 facilitator advertises (`eip155:14601`), and a `.env` value is not proof the facilitator agrees. **Still run S1.** |
| `ARC_USDC_ADDRESS` | `0x3600000000000000000000000000000000000000` | **S4 / S6.** Precompile-shaped address, consistent with USDC being the native gas asset — exactly the truncation concern C3 and K-12 describe. |
| `ARC_LIVE` | `true` | Arc is enabled in config. |
| `CIRCLE_TREASURY_PROVIDER` | `"agent_stack"` | **A3 / Phase 2 · Task 1.** Not `developer_controlled`. Correct for today's Agent Wallet path; Phase 2 flips it. |
| `CIRCLE_GATEWAY_LIVE` | `false` | Gateway not yet enabled. |
| `CIRCLE_TEST_API_KEY` | set (78 chars) | S2 can run. |
| `CIRCLE_TEST_ENTITY_SECRET` | set (64 chars) | S2/S3 can run — the entity secret is what makes dev-controlled wallets and sweep authority possible. |

> **Note on the two chain-ID sources.** If S1 confirms they differ: the **facilitator's** value governs x402 signing (it verifies the signature), and the **RPC** value governs direct chain calls. Phase 2 · Task 3 hardcodes whichever S1 records — do not assume `5042002` is correct for both.

---

## Spike results

Fill in as each runs. Do not mark a row answered without evidence.

| Spike | Question | Status | Evidence |
|---|---|---|---|
| **S1** `[K-17]` | Arc chain ID: docs `5042002` vs facilitator `eip155:14601` | ✅ **RESOLVED** | See S1 below — **manifest's premise was wrong** |
| **S2** `[A2]` | Dev-controlled EOA wallets on `ARC-TESTNET`, end to end | ✅ **PASS** | Two EOA wallets provisioned — see S2 below |
| **S3** `[A1]` | Can the entity secret sweep funds out to treasury? | ✅ **PASS** | Real sweep executed, tx `0x0cb4fe4...d252a3` — see S3 below |
| **S4** `[K-12]` | Permit2 `approve` + `transferFrom` on Arc's native-USDC view | ✅ **PASS** | Full write cycle confirmed, 3 real tx hashes — see S4 below |
| **S5** `[K-4]` | Arc testnet USDC faucet path | ❌ **BLOCKED** | Faucet 403 — **key scope, not Arc** — see S5 below |
| **S6** `[C3]` | ERC-20 `balanceOf` truncation vs native balance | ✅ **RESOLVED** | 1:1 ratio confirmed; **new RPC finding** below |
| **S7** `[A5]` | Compliance / Transaction Screening API access | ⬜ not run | |
| **S8** `[K-5]` | ERC-8183 funding mechanics + registry addresses (Phase 7) | ❌ **FALLBACK** | Full lifecycle works, but the documented front-running guard does not exist on-chain — see S8 below |

**Tier decision:** **T3 fully confirmed.** Permit2 is live on Arc at the canonical address, with a complete `approve -> permit -> transferFrom` cycle confirmed on-chain: the allowance decrements by exactly the drawn amount, and funds move. Phase 6 proceeds on the Permit2 architecture — no fallback to per-payment `exact` authorizations needed.

---

### S1 `[K-17]` — Arc chain ID — RESOLVED, and the manifest's premise was wrong

**Verdict: Arc testnet is `eip155:5042002`. There was never a conflict.**

The change manifest framed this as two sources disagreeing about *one* chain. They are **two different chains**, and the facilitator advertises both:

```
RPC eth_chainId  -> 0x4cef52 = 5042002
Facilitator networks: eip155:11155111, eip155:84532, eip155:43113, eip155:421614,
  eip155:14601, eip155:4801, eip155:1328, eip155:998, eip155:5042002,
  eip155:11155420, eip155:80002, eip155:1301
```

Decisive evidence — the USDC addresses differ:

| Network | USDC address | Is it Arc? |
|---|---|---|
| `eip155:5042002` | `0x3600000000000000000000000000000000000000` | **YES** — matches `ARC_USDC_ADDRESS` in `.env` and the precompile-shaped native-gas asset |
| `eip155:14601` | `0x0ba304580ee7c9a980cf72e55f5ed2e9fd30bc51` | No — ordinary ERC-20 on some other testnet |

**Phase 2 · Task 3 hardcodes `eip155:5042002`.** Both the RPC and the facilitator agree, so no split between signing and chain calls is needed.

**Bonus — K-11 confirmed from the same payload:** `minValiditySeconds: 604800` (7 days), `name: "GatewayWalletBatched"`, `verifyingContract: 0x0077777d7eba4688bdef3e311b846f25870a19b9`, `scheme: exact` only. The 7-day exposure window is real; the decision to cap Lane 1 amounts stands.

---

### S4 `[K-12]` — Permit2 on Arc — READ + WRITE PATH BOTH PASS

```
chainId: 5042002
Permit2 0x000000000022D473030F116dDEE9F6B43aC78BA3
  bytecode: 9152 bytes          <- exactly the canonical size
  DOMAIN_SEPARATOR: 0xe59c8d3fa907f1186bfa334839eb895f53f88b07e4cf5aafaef4af163d83ce93
  allowance(owner, ARC_USDC, spender) -> (0, 0, 0)   <- correct 3-tuple, no revert
Arc USDC 0x3600...0000
  decimals: 6, symbol: "USDC", totalSupply: 212276223415235578
```

**Permit2 accepts Arc's native-USDC address as a token argument and returns the expected `(amount uint160, expiration uint48, nonce uint48)` tuple.** That was the specific fear in K-12 — it does not revert on the native-gas asset.

**Write path confirmed live, before Phase 6 started (real infra, real funded wallets, real tx hashes):**

1. Payer (`0xecf29492264424ae73fc1434a30a66d2f6a9b48f`) calls `approve(Permit2, maxUint160)` on Arc's USDC address — tx `0xff5410c60a4a697427b232afcd349a68761babe7f673290d1172daa2f35c1aaa`.
2. Payer signs a real EIP-712 `PermitSingle` (domain `{name: "Permit2", chainId: 5042002, verifyingContract: Permit2}`) via Circle's `signTypedData` — spender = `0x216c05b8d3409d2fd2b82375334d4b87e789367e`, amount = 20000 (0.02 USDC), nonce read live from `allowance()`.
3. Spender submits `permit()` with that signature — tx `0x96f050c234137c33c2069650ac10fed9e4728d2fabfebcbb46e6612c306a5d45`. `allowance()` read after: `(20000, expiration, nonce+1)` — **the signed permit was recorded on-chain.**
4. Spender calls `transferFrom(payer, spender, 10000, ARC_USDC)` — tx `0x5161d370609fcb7ee4e574b2ae9f71bcf3523c1b3448285f9e783d0a722679e8`. `allowance()` read after: `20000 -> 10000` — **decremented by exactly the drawn amount.**
5. Real balances confirmed the transfer via raw `eth_getBalance`: payer's balance dropped, spender's balance rose by the drawn amount (net of each side's own gas).

**Answer: yes, unconditionally.** Permit2's full `approve → permit → transferFrom` cycle works against Arc's native-USDC ERC-20 view, with the allowance decrementing exactly as expected. **Lane 2 / T3's scoped-delegation claim is fully cleared — no fallback to per-payment `exact` authorizations is needed.**

> **Tooling note:** viem's `readContract` reported "RPC Request failed" for `allowance` and `symbol` while raw `eth_call` returned correct data for both. The contracts are fine — see the RPC reliability finding below. The write-path proof above used `viem.encodeFunctionData` for ABI encoding (works reliably) combined with raw `eth_call`/`eth_getBalance` for reads and Circle's `createContractExecutionTransaction`/`signTypedData` for signing and submission.

---

### S6 `[C3]` — Balance truncation — RESOLVED, plus a more dangerous finding

**Truncation confirmed, and it is exactly 1:1.** Sampled live accounts:

| native (18dp wei) | native / 1e12 | `balanceOf` (6dp) |
|---|---|---|
| 46038082844867901798 | 46038082 | 46038082 |
| 216258215585000000000000 | 216258215585 | 216258215585 |
| 395096159078467122 | 395096 | 395096 |
| 12804402399763984694 | 12804402 | 12804402 |

`balanceOf == floor(native / 1e12)` in every case. The ERC-20 view is the native balance truncated to 6dp — same pool, as the manifest says.

**Phase 3 rule: read `eth_getBalance` (native) for gas decisions.** Sub-1e12-wei dust is invisible to `balanceOf` but still real, and that dust is what keeps a wallet able to transact.

#### ⚠️ NEW FINDING — Arc's public RPC is unreliable, and this affects the hot path

25 identical `balanceOf` calls to a known-funded account:

```
ok    : 11
error : 14      <- ~56% failure rate
```

My first probe silently coerced failures to `0` (`|| '0x0'`), which made two funded accounts appear to hold **zero**. The contract was never wrong — the read was.

**This is a live hazard for Phase 3 · Task 4 and Phase 4 · Task 3**, both of which read balances on the payment hot path:

1. **Never coerce a failed balance read to zero.** A failed read must raise, not return `0n`. Coerced-to-zero would reject valid payments and could trigger spurious top-ups toward the ceiling.
2. **Retry with backoff**, and treat exhausted retries as an explicit `balance_unavailable` error distinct from `insufficient_agent_wallet_balance`.
3. **This is a correctness requirement, not a performance optimisation** — it is exactly the kind of failure the plan's Redis cache would otherwise paper over. Reuse the existing `balances-cache.ts`; do not build new infrastructure.
4. **Consider a dedicated RPC endpoint** for the demo rather than the public one.

A 6-attempt retry loop with 400ms backoff read both new Arc wallets reliably, so retry is a sufficient mitigation.

---

### S2 `[A2]` — Dev-controlled wallets on Arc — PASS

**`ARC-TESTNET` is accepted. Per-agent wallets are viable, so Phases 2 and 3 are unblocked.**

```
walletSet: 1d55d037-9b08-5b61-917a-f126b079447e   (custodyType: DEVELOPER)

id      9edacecb-f69d-5dab-9622-e94779ea18e0
address 0x00ca790a06002bb6ace2488633bfea71dc2023df
chain   ARC-TESTNET   accountType EOA   state LIVE

id      ad2d357b-0a5a-581e-a53b-9ee99032611b
address 0x1b302d79710c21135efa9ea10d2b9171a399c467
chain   ARC-TESTNET   accountType EOA   state LIVE
```

Confirmed properties:
- **Circle's literal is `ARC-TESTNET`** — use this exact string in Phase 2's `circle_chain_capabilities` seed.
- **`accountType: 'EOA'` is honoured** — satisfies K-16 at creation. Gateway needs EOA; Nanopayments is EOA-only.
- **Distinct addresses per wallet**, both readable on-chain at zero balance.
- **No OTP, no human, no per-wallet key** — one entity secret provisioned both. This is the concrete evidence for A3 (flip to developer-controlled).

**Pre-existing account state** (useful for Phase 2/3): 11 wallets already exist across `AVAX-FUJI`, `OP-SEPOLIA`, `MATIC-AMOY`, `ARB-SEPOLIA`, `BASE-SEPOLIA` — **all `accountType: EOA`**, all `DEVELOPER` custody. `BASE-SEPOLIA` already present, which the cross-chain hop needs.

**Not yet done at the time:** fund → transfer between the two wallets. Blocked on S5. Resolved later in Phase 4 -- see S3 below.

---

### S3 `[A1]` — Sweep authority — PASS

Run after S5 was worked around (see S5 below) and one of S2's wallets was manually funded with 20 USDC on Arc testnet. Question: can the entity secret authorize a transfer OUT of an agent-controlled wallet with no separate signer -- the exact mechanism Phase 4 Task 5's sweep-on-revoke needs.

```
client.createTransaction({
  amount: ['1.00'],
  destinationAddress: '0x216c05b8d3409d2fd2b82375334d4b87e789367e',
  tokenAddress: '0x3600000000000000000000000000000000000000',  // Arc's USDC precompile address
  blockchain: 'ARC-TESTNET',
  walletAddress: '0xecf29492264424ae73fc1434a30a66d2f6a9b48f',   // agent A's wallet -- the source
  fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
})
-> { id: '58362f35-ee83-59d2-9503-d719ffaca6d2', state: 'INITIATED' }
-> polled to state: 'COMPLETE', txHash: '0x0cb4fe447ad1e00bd5ef78faf4ef9cce6fe5d222e264044182eaef5d50d252a3'
```

**Balances confirmed on-chain before/after via raw `eth_getBalance`:** agent A went from $20.00 to $19.00 (the $1.00 sent, minus its own gas -- Arc's native-gas model, same as every other Arc finding in this doc); agent B received exactly $1.00.

**Answer: yes.** The entity secret alone -- no OTP, no separate signer, no per-wallet key -- can move funds out of any wallet it controls. This is the same mechanism `transferWallet()` (built for Task 3's auto-topup) already implements, so Task 5's sweep needs no new provider method, only a new call site.

Independently verifiable: `https://testnet.arcscan.app/tx/0x0cb4fe447ad1e00bd5ef78faf4ef9cce6fe5d222e264044182eaef5d50d252a3`

---

### S5 `[K-4]` — Faucet — BLOCKED, but not by Arc

```
POST /v1/faucet/drips  { blockchain: 'ARC-TESTNET',  usdc: true } -> 403 {"code":3,"message":"Forbidden"}
POST /v1/faucet/drips  { blockchain: 'BASE-SEPOLIA', usdc: true } -> 403 {"code":3,"message":"Forbidden"}
```

**Base Sepolia fails identically, so this is an API-key scope/permission issue — not an Arc limitation.** The same key succeeds on `/v1/w3s/*` (wallet sets, wallets, entity public key) and successfully created wallets, so the key is valid; it simply lacks faucet entitlement.

**Options, in order of preference:**
1. **Enable faucet permission** on the Circle console for this API key, or use a key that has it.
2. **Use Arc's public testnet faucet** directly for `0x00ca790a06002bb6ace2488633bfea71dc2023df`.
3. **Transfer from an existing funded wallet** if any of the 11 pre-existing wallets holds testnet USDC.

**What this blocked, and current status now that funding was worked around:**

| Blocked | Why | Status |
|---|---|---|
| **S4 write path** — `approve` + `transferFrom`, allowance decrement | Needs a funded wallet. **This is the final T3 confirmation.** | still open |
| **S3** — sweep authority `[A1]` | Cannot sweep an empty wallet. Gates Phase 4 · Task 5. | ✅ resolved — see S3 above |
| **S2 completion** — fund → transfer | Needs funding. | ✅ resolved — see S3 above (the sweep tx *is* the fund→transfer) |

**Not blocked:** Phases 1, 2, 3, and 5 can all proceed. Phase 3's acceptance artifact (fund $1.00, attempt $2.00, observe rejection) needs funding, but the code and unit tests do not.

**Update — S5 resolved via manual funding.** The Circle API key still lacks faucet entitlement (confirmed again during Phase 3 Task 4's proof test: `POST /v1/faucet/drips` now returns `429 API rate limit error` rather than `403 Forbidden`, but the effect is the same — no funds land via the SDK). Circle console access to fix the key's entitlement was not available in this environment. Worked around per option 2 above: the user manually funded `0xecf29492264424ae73fc1434a30a66d2f6a9b48f` via Arc's public testnet faucet. See Phase 3 Task 4 below for the resulting proof.

---

### Phase 3 · Task 4 proof test — real infrastructure, real rejection

Run against **real** Circle developer-controlled-wallets API (test mode), **real** Postgres, and **real** Arc testnet RPC — not the automated test suite's fakes/stubs. `CIRCLE_TREASURY_PROVIDER=developer_controlled`.

**Real wallets created via the Circle SDK this session** (`client.createWallets` / `client.deriveWallet`, no `--type agent` CLI fallback):

| Wallet | Address | Chain |
|---|---|---|
| Agent A (independent create) | `0xecf29492264424ae73fc1434a30a66d2f6a9b48f` | ARC-TESTNET |
| Agent A (derived, same address — proves K-13) | `0xecf29492264424ae73fc1434a30a66d2f6a9b48f` | BASE-SEPOLIA |
| Agent B (independent create, distinct address) | `0x216c05b8d3409d2fd2b82375334d4b87e789367e` | ARC-TESTNET |

`deriveWallet` produced the **exact same address** as the independent create for the same agent; Agent B's independent create produced a **genuinely distinct** address — both confirmed by reading the SDK response directly, not asserted from a mock.

**Funding:** user manually sent testnet USDC to `0xecf29492264424ae73fc1434a30a66d2f6a9b48f` via Arc's public faucet. Confirmed on-chain via raw `eth_getBalance` against `$ARC_RPC_URL`:

```
0xecf29492264424ae73fc1434a30a66d2f6a9b48f -> 20000000000000000000 wei = 20.00 USDC
```

Independently verifiable: **https://testnet.arcscan.app/address/0xecf29492264424ae73fc1434a30a66d2f6a9b48f**

**Proof run** — a real org/agent were created via the live HTTP API (`buildApp`, real Postgres), the agent was bound to the wallet above via `recordProvisionedWallet`, granted a deliberately generous counter budget ($1,000, to isolate the wallet-balance ceiling as the actual gate), and two real x402 payment attempts were made through `POST /v1/runtime/payments/x402`:

| Attempt | Amount | Result |
|---|---|---|
| Over the real $20.00 balance | $25.00 | `409 insufficient_agent_wallet_balance` |
| Within the real $20.00 balance | $5.00 | `200`, settled |

The rejection was driven by `nativeBalanceMicros` reading the wallet's live balance over RPC in the same request — not a stub, not a counter. This is the acceptance artifact Task 4 required: **"max loss is bounded by the agent's on-chain balance"** is now true and demonstrated against real infrastructure.

---

### Phase 4 · Task 5 proof test — real revoke, real sweep, real tx hash

Run against the same real infrastructure as Phase 3's proof: real Circle developer-controlled-wallets API (test mode), real Postgres, real Arc testnet RPC. Reused `0xecf2...9b48f` (re-funded to $0.55 via a small internal transfer for this run, after spike S3 had already swept $1.00 out of it).

A real org/agent were created, bound to that wallet via `recordProvisionedWallet`, and revoked through the actual `revokeAgent()` code path — not a mock, the same function the HTTP route calls:

```
agents.status: active -> suspended
agent_chain_wallets: agent_wallet.sweep job enqueued for chain 'arc'
```

`processAgentWalletSweepJob` was then run against the real provider:

```
sweep job result: { status: 'complete',
  provider_ref: '0x566966b754ae9dca563f9f8592bfc6ba6051713c3bbcb423f272b3ec0f3d5627',
  amount_usdc: '0.497281' }
agent wallet row after sweep: { status: 'swept', swept_at: '2026-08-03T14:15:01.693Z' }
```

**Balances confirmed on-chain before/after via raw `eth_getBalance`:**

| | Before | After |
|---|---|---|
| Agent wallet | $0.55 | $0.05 (dust — gas reserve left behind, by design) |
| Treasury wallet | $18.95 | $19.44 |

$0.497281 moved, matching the job's recorded `amount_usdc` exactly.

Independently verifiable: **https://testnet.arcscan.app/tx/0x566966b754ae9dca563f9f8592bfc6ba6051713c3bbcb423f272b3ec0f3d5627**

**Bug found and fixed during this proof:** the first run recorded `provider_ref` as Circle's internal transaction UUID (`e881e85d-2310-...`), not a real on-chain hash — confirmed via `getTransaction` that the real `txHash` field is a distinct value. `transferWallet()` (shared with Task 3's auto-topup) now fetches and returns the real hash. This matters for every future sweep, topup, and any other artifact this codebase claims is "verifiable on-chain."

---

### S8 `[K-5]` — ERC-8183 escrow funding mechanics — **FALLBACK: the front-running guard does not exist**

**Verdict: the escrow lifecycle mechanically works end to end — Open → Funded → Submitted → Completed, six real transactions, all `status: success` on Arc testnet. But decisive question 2 fails on hard evidence: the deployed `fund()` function has no `expectedBudget` parameter, so the plan's assumed front-running guard (`fund(jobId, expectedBudget)` "reverts on mismatch") does not exist on this contract. Per this plan's own pre-committed fallback rule ("if any of 1–4 fails, escrow (D2) does not ship"), D2 does not ship in Phase 7.**

**Setup:** two agent wallets already funded from Phase 3/6 (Circle developer-controlled wallets, test mode, Arc testnet): Agent B `0x216c05b8d3409d2fd2b82375334d4b87e789367e` acting as client+evaluator (Mode 2), Agent A `0xecf29492264424ae73fc1434a30a66d2f6a9b48f` acting as provider. Escrow proxy `0x0747EEf0706327138c69792bF28Cd525089e4583` (confirmed deployed, 213 bytes of proxy bytecode).

**Question 1 — does the wallet need to `approve` before `fund()`?** ✅ **YES, confirmed.** `fund()`'s internal `Transfer` event on Arc's native-USDC ERC-20 view (`0x3600...0000`) shows funds moving from the client to the escrow contract via `transferFrom`, which requires a prior `approve`. Real `approve(escrow, 50000)` tx: `0xb87ea8aad554fb25b863fbe4c48f5d312c312c315103796b9a7be438a8958a5b`.

**Question 2 — does `fund(jobId, expectedBudget)` revert on budget mismatch?** ❌ **NO — that function does not exist.** Decoded the actual calldata of the real, successful `fund()` transaction:

```
fund tx input: 0xe25ba707 00000...0288ab 00000...0040 00000...0000
selector 0xe25ba707 == keccak256("fund(uint256,bytes)")[:4]   <- confirmed by direct selector computation
args: jobId=166059 (0x288ab), then an offset to an EMPTY bytes hookData (length 0)
```

There is no `uint256 expectedBudget` argument anywhere in this function's ABI — the real signature is `fund(uint256 jobId, bytes hookData)`. To prove this is exploitable, not just an ABI curiosity, we ran the exact scenario the plan worried about:

1. Client approves the escrow for a safety margin above the quoted price: `approve(escrow, 50000)` (0.05 USDC) — quoted budget was 20000 (0.02 USDC).
2. **Provider front-runs**: while the job is still `Open`, the provider calls `setBudget(jobId, 40000, 0x)` — raising the budget to 0.04 USDC, still under the client's approval ceiling. Tx `0x1caff24388f1797ef3631c88f391bdd3bf0f79148abd232289f029c1ac63af9e` (selector `0xdd4ae9d4` == `setBudget(uint256,uint256,bytes)`) — **succeeded**, confirming the plan's own note that `setBudget` is callable by provider, not just client.
3. Client calls `fund(jobId, 0x)` believing the budget is still 20000. Tx `0x0907ac70b8b542a780b8f42630da30e5e8a00c9b510c7c7d3ba06db5d2f2e2a2` — **succeeded**, and the `Transfer` event confirms **40000 (0.04 USDC) was pulled — the front-run amount, not the originally quoted 20000.**

`fund()` does not take, and therefore cannot check, an expected budget. It unconditionally escrows whatever budget is currently set at call time, gated only by the client's own ERC-20 approval ceiling. **A provider can raise the price after quoting and before funding, and the client's transaction will not revert** — it will simply pay more, silently, up to whatever margin the client happened to approve. This is the exact failure mode decisive question 2 was written to rule out.

**Question 3 — can the wallet `approve` on Arc's native-USDC ERC-20 view?** ✅ **YES**, same evidence as question 1 (and consistent with S4).

**Question 4 — full lifecycle walked end to end, every tx hash recorded?** ✅ **YES**, mechanically. All six real transactions, all `status: success`:

| Step | Function (real, decoded selector) | Caller | Tx hash |
|---|---|---|---|
| Create job | `createJob(address,address,uint256,uint256,bytes)` (`0x41528812`) — provider=A, evaluator=B (=client, confirming **Mode 2**), deadline, budget=0, metadata="AgentOps S8 escrow spike" | Agent B (client) | `0xed70e00094da7fd7cae38853c2c2361cbbbe6e2ad0ba667aaa77fd90d742365c` |
| Approve | `approve(address,uint256)` (`0x095ea7b3`) — escrow, 50000 | Agent B (client) | `0xb87ea8aad554fb25b863fbe4c48f5d312c312c315103796b9a7be438a8958a5b` |
| setBudget (front-run) | `setBudget(uint256,uint256,bytes)` (`0xdd4ae9d4`) — jobId, 40000, `0x` | Agent A (provider) | `0x1caff24388f1797ef3631c88f391bdd3bf0f79148abd232289f029c1ac63af9e` |
| Fund | `fund(uint256,bytes)` (`0xe25ba707`) — jobId, `0x` | Agent B (client) | `0x0907ac70b8b542a780b8f42630da30e5e8a00c9b510c7c7d3ba06db5d2f2e2a2` |
| Submit | `submit(uint256,bytes32,bytes)` (`0x9e63798d`) — jobId, deliverable hash, `0x` | Agent A (provider) | `0x79e0bd0d2ec875fb6e8415d353c075fab6c2945d01c775b695e0e240afb5af5a` |
| Complete | `complete(uint256,bytes32,bytes)` (`0xd75bbdf3`) — jobId, reason hash, `0x` | Agent B (evaluator) | `0x3d25ff048f6f0ff2fc6acc226a75bec3dd788dc70b8cfefffa99b60f361baa6e` |

Job ID `166059`. Independently verifiable: **https://testnet.arcscan.app/address/0x0747EEf0706327138c69792bF28Cd525089e4583**

**Question 5 — does `deliverable` appear only in the event log, not in `jobs()` state?** **Partially confirmed.** The deliverable hash (`0x063c548e...`) and the completion reason hash (`0x2ad4a5e2...`) both appear in the `submit`/`complete` transaction calldata and in the escrow's own emitted event logs. We could **not** independently confirm their absence from `jobs()` state, because the plan's assumed `jobs()` getter signature — `function jobs(uint256) view returns (address,address,address,uint256,uint8)` — **does not match this contract either**: calling it against both job `1` (Arc's own showcase job) and job `166059` returns internally-inconsistent, garbage-looking tuples (an invalid short address in the first slot, an absurd `uint256` in the budget slot, `state` decoding to `288`). This is the same class of finding as question 2 — **the plan's assumed ABI, sourced from Arc's tutorials, does not match the deployed bytecode.** We did not reverse-engineer the correct `jobs()` struct layout; it wasn't needed once question 2 had already failed.

**Question 6 — registry addresses for D3 (ERC-8004 identity), re-verified.** Identity registry `0x8004A818BFB912233c491871b3d84c89A494BD9e` **holds code** (129 bytes, proxy-shaped) on Arc testnet — confirmed via `eth_getCode`. This is prep evidence for Phase 8 · Task 1 only; it does not depend on or get affected by S8's fallback verdict.

**Applying the plan's fallback rule.** Section 3 of Phase 7's plan states: *"If any of 1–4 fails: S8 fallback. Escrow (D2) does not ship."* Question 2 fails on direct, decoded, on-chain evidence — not a flaky read, not an RPC hiccup, but the actual successful transaction calldata proving the guarded function does not exist and the unguarded one silently pays whatever the current budget is.

- **D2 (ERC-8183 escrow) does not ship in Phase 7.** Phase 7 · Tasks 2–3 (escrow job records migration, escrow lifecycle client) do not proceed.
- **Phase 7 · Task 4 (JIT Gateway bridge) is unaffected** — it does not depend on escrow and proceeds independently.
- **Phase 8 · Task 1 (D3 ERC-8004 identity) still ships standalone** — identity registration does not depend on escrow, and question 6 above confirms the registry is live.
- **Phase 8 · Tasks 2–3 (D4 payment-gated reputation, D5 reputation → allocation) fall with D2**, per the plan: reputation is written from the escrow completion hook, and that dependency is exactly what makes it earned rather than self-asserted. Shipping ungated reputation instead would be the overclaim the manifest explicitly warns against.

**Claim discipline going forward:** never state that ERC-8183 escrow "protects the client from being overcharged after quoting" — the opposite was just demonstrated on real testnet transactions. If escrow's mechanical lifecycle is ever referenced (e.g. in a writeup of this spike), the accurate claim is: *"funds are held in a third-party contract rather than the client's wallet once funded, and cannot be withdrawn by the provider directly"* — proof-of-funding-once-funded, not price protection before funding.

---

### Phase 7 · Task 4 proof test — real Gateway deposit and burn-intent signing; mint blocked on wallet funding

Run against real infrastructure: real Circle developer-controlled-wallets API (test mode), real Arc testnet RPC, real Circle Gateway API (`https://gateway-api-testnet.circle.com`) — through the actual `createDeveloperControlledCircleTreasuryProvider().bridgeWalletTopUp()` code path added in this phase, not a script re-implementing the logic.

**Step 1 — real Gateway deposit.** `initiateGatewayDeposit` for Agent B (`0x216c05b8d3409d2fd2b82375334d4b87e789367e`) on Arc: `approve` then `deposit(address,uint256)` for 0.20 USDC, both real transactions via the Circle SDK. Confirmed via the public Gateway balances API:

```
POST /v1/balances { sources: [{ depositor: "0x216c...367e", domain: 26 }] }
-> { balance: "0.200000" }
```

**Step 2 — real burn-intent signing and attestation.** `bridgeWalletTopUp({ amount: '0.10', fromChain: 'arc', toChain: 'base', mode: 'test' })` through the real code path: Circle's MPC `signTypedData` produced a real EIP-712 signature over the `BurnIntent` (domain `{name: "GatewayWallet", version: "1"}`, distinct from the `GatewayWalletBatched` x402 domain), and `POST /v1/transfer` returned a real attestation:

```
POST https://gateway-api-testnet.circle.com/v1/transfer -> 201
{
  attestation: "0xff6fb334...",       <- real, ~230-byte encoded attestation
  signature: "0x7f41070d...",         <- Circle operator's signature
  fees: { total: "0.0035", perIntent: [{ domain: 26, baseFee: "0.0035" }] },
  expirationBlock: "45005267"
}
```

This is independent confirmation the MPC wallet can produce a valid EIP-712 signature Circle's Gateway operator accepts, and that the real fee (0.0035 USDC on a 0.02 USDC transfer here — consistent with the documented 0.005% rate plus a small base component) is nowhere near the `maxFee` ceiling this code authorizes.

**Step 3 — mint on Base Sepolia blocked on wallet funding, not on this code.** `contractExecution`'s `gatewayMint(bytes,bytes)` call failed with Circle's own structured error:

```
POST https://api.circle.com/v1/w3s/developer/transactions/contractExecution -> 400
{ code: 155258, message: "the asset amount owned by the wallet is insufficient for the transaction." }
```

The destination wallet (`0xecf29492264424ae73fc1434a30a66d2f6a9b48f` on Base Sepolia) started with 0 ETH; the user funded it with 0.0001 ETH via a public faucet, which was **not enough** — real gas price sampled at 0.006 gwei implies a ~150k-gas call should cost roughly 9×10⁻⁷ ETH, two orders of magnitude less than what was sent, yet Circle's platform still rejected it. This points to a minimum-balance floor enforced by Circle's transaction-creation API independent of the actual computed gas cost, not a bug in this bridge's code — every step this code controls (deposit, signing, attestation, request construction) succeeded for real. Re-verify with a larger funding amount (0.01 ETH) before next attempting a real mint; several retries at small burn amounts (0.10, then 0.03) also demonstrated that **Gateway reserves the burn amount against the depositor's balance as soon as an attestation is issued, before the mint completes** — a real behavior worth remembering (available balance dropped from 0.200000 to 0.039500 across three attestation attempts whose mints never landed).

**Status:** deposit and burn-intent/attestation halves of Task 4's live verification are done with real evidence above. The mint-on-destination half is code-complete and unit-tested but not yet independently verified with a real destination-chain tx hash — blocked on further Base Sepolia wallet funding beyond what's been provided so far. `docs/decisions.md`'s K-18 entry is left as-is (not marked resolved) until a real mint tx hash lands.

---

## Acceptance artifacts

On-chain milestones need explorer links, not just passing tests. A claim whose entire value is third-party verifiability cannot be evidenced by our own test suite.

| Milestone | Artifact | Status |
|---|---|---|
| Phase 3 · Task 4 — provable max-loss | Funded $20.00, attempted $25.00 → `409 insufficient_agent_wallet_balance`; attempted $5.00 → `200` settled. See "Phase 3 · Task 4 proof test" above. | ✅ |
| Phase 3 · Task 3 — distinct agent wallets | Two real addresses via Circle SDK: `0xecf2...9b48f` (Agent A) vs `0x216c...9367e` (Agent B) — see above | ✅ |
| Phase 4 · Task 5 — sweep-revocation | Balance drains to treasury, tx hash | ✅ tx `0x566966b...f3d5627` — see "Phase 4 · Task 5 proof test" above |
| Phase 6 · Task 2 — Permit2 drawdown | Allowance decrementing across 3 payments, then `lockdown()` | ⬜ |
| Phase 6 · Task 6 — cross-chain hop | Settlement on Base's explorer while fleet runs on Arc | ⬜ |
