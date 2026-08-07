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

### Phase 6 · Task 2 proof test — permit2.ts's real functions, not an ad-hoc script

Run after `permit2.ts` was implemented and its mocked-provider test suite (9/9) passed. This step specifically re-verified the module's own `recordSignedDelegation` / `drawDown` / `revokeDelegation` functions against real Circle API + real Arc testnet — not the raw spike script above, which only proved the underlying mechanism.

**Two real bugs found and fixed by this run, neither catchable by a mocked-provider test:**

1. `recordSignedDelegation` signed a `PermitSingle` and persisted the signature, but never actually submitted `permit()` on-chain. A signature Permit2 has never seen does nothing — `drawDown`'s `transferFrom` would fail against a real zero allowance forever. Fixed: `recordSignedDelegation` now also submits `permit()`, by the payer.
2. The delegation nonce was hardcoded to `0`. Permit2 requires a strictly increasing nonce per owner/token/spender — a stale nonce makes `permit()` silently revert, surfacing as an opaque `"API parameter invalid"` from Circle with no indication the nonce was the cause. Fixed: added `readPermit2Nonce`, reading Permit2's real `allowance()` live (same retry-with-backoff discipline as `nativeBalanceMicros`, since Arc's RPC failure rate is the same ~56% found in S6).

**A third, unrelated bug found while debugging the above:** a long `refId` (~100 characters, embedding both an org ID and a full address) makes Circle reject the entire `createContractExecutionTransaction` call with the same opaque `"API parameter invalid"` error — this initially masked the real nonce bug, since both produced an identical error message. Confirmed by isolating the variable: identical payload, only `refId` length changed, from failing (~100 chars) to succeeding (~19 chars). Fixed by shortening every Permit2 `refId` to a short prefix + UUID.

**Full proof, after both fixes:**

```
recordSignedDelegation: real EIP-712 sign + real permit() submission -> delegation status 'active'
drawDown:  transferFrom(payer, payee, 10000, ARC_USDC)
           tx 0x823255030af94a46b64e6635914b022e86cca9ed4c685794757e7bc6dae86f25
           drawn_usdc recorded: 0.010000
revokeDelegation: lockdown() -> delegation status 'revoked'
allowance() read after lockdown: (amount: 0n, ...) -- confirmed zeroed on-chain, not just locally
```

Independently verifiable: **https://testnet.arcscan.app/tx/0x823255030af94a46b64e6635914b022e86cca9ed4c685794757e7bc6dae86f25**

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

### Phase 6 · Task 7 — Base Sepolia: RESOLVED. The cause was an unregistered entity secret.

**Base Sepolia works.** Externally-sent ETH pays gas normally, no faucet and no mainnet upgrade required.

Proof — `approve(spender, 0)` (needs zero USDC, so it tests gas alone) on a wallet funded only by an external ETH transfer:

```
wallet  0x88d7cb9f7db35845efaa7ca38bd626f7de9f4cdd   (BASE-SEPOLIA, EOA)
funded  0.0001 ETH, sent externally (NOT via Circle's faucet)
tx      0x9ef42300e061e5fba6d103961dab8217745dfcdce77cf9a9a35692c73dd5462f  -> CONFIRMED
```

**Root cause:** the original developer account's **entity secret was never registered** with Circle
(`GET /v1/w3s/config/entity/publicKey` returned Circle's encryption key, which is NOT proof of
registration; attempting to use the secret returned `156016 "The entity secret has not been set yet"`).
The entity secret authorizes signing on developer-controlled wallets, so every signing operation failed.

**Circle's error message was misleading.** An unregistered entity secret surfaced as
`155258 "the asset amount owned by the wallet is insufficient for the transaction."` — an undocumented
code (Circle's public error list skips 155257–155263) that points at balances rather than credentials.

**Wrong turns this caused, recorded so they aren't repeated:**
- *"Circle can't index externally-sent ETH"* — false **for a wallet Circle already tracks a native
  balance for**. It spends it fine once the entity secret is registered. ⚠️ **Narrowed 2026-08-07:** this
  bullet was over-generalised. For a *newly created* Base Sepolia wallet Circle may never index an
  externally-sent native balance at all, and then rejects with this same `155258`. See "Circle native-balance
  indexing misses externally-received ETH" below before reusing this conclusion.
- *"The faucet API is required"* — false. The demo funds via manual USDC transfer + `gateway-deposits`;
  the faucet is never called. (Its `403` is real — Circle's OpenAPI states `/v1/faucet/drips` requires a
  mainnet-upgraded account — but it is irrelevant to this flow.)
- *"Gas Station / SCA is the fix"* — would have broken both payment rails: Gateway rejects non-EOA
  signatures and Nanopayments is EOA-only (`change-manifest.md:300`, migration `0025`'s
  `CHECK (account_type = 'eoa')`).
- *`maxFee` being validated instead of actual cost* — disproved; an explicit absolute fee whose worst
  case was 0.000005 ETH against a 0.0019 ETH balance still failed.

**Correct setup for a fresh Circle developer account** (this is the real prerequisite):
1. Create an API key in the Circle Console. It MUST carry the full `TEST_API_KEY:<id>:<secret>` prefix form.
2. Generate a 32-byte entity secret **locally** and register it via `registerEntitySecretCiphertext`
   (it is not a value copied from the console). Store the recovery file securely — `recovery/` and
   `*.dat` are gitignored; Circle cannot recover it for you.
3. Fund treasury wallets by direct transfer: USDC on both chains, plus native ETH on Base for gas.
   Arc needs no separate gas asset because its gas token *is* USDC.
---

### S8 `[K-5]` — ERC-8183 escrow funding mechanics — **FALLBACK: the front-running guard does not exist**

**Verdict: the escrow lifecycle mechanically works end to end — Open → Funded → Submitted → Completed, six real transactions, all `status: success` on Arc testnet. But decisive question 2 fails on hard evidence: the deployed `fund()` function has no `expectedBudget` parameter, so the plan's assumed front-running guard (`fund(jobId, expectedBudget)` "reverts on mismatch") does not exist on this contract. Per this plan's own pre-committed fallback rule ("if any of 1–4 fails, escrow (D2) does not ship"), D2 does not ship in Phase 7.**

> **REOPENED (2026-08-05).** The fallback verdict above stands *for the deployed reference contract*, but `[D2]` is no longer dead. Two later findings changed the picture: ERC-8183's prose **mandates** the `fund(jobId, expectedBudget, …)` guard that its own reference implementation omits, so the flaw is in the reference code rather than the standard; and the state getter works fine once called by its real name (see the correction on question 5). The new plan deploys our own conformant escrow rather than integrating this one. See `docs/superpowers/specs/2026-08-05-escrow-trust-graduation-design.md`.

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

> **CORRECTION (2026-08-05).** Question 5's conclusion below is **wrong** and is kept only as the record. The state getter is not broken — we called the wrong function. The plan used `jobs(uint256)` from Arc's tutorials; the EIP defines **`getJob(uint256) returns (Job)`**. Called correctly against this same job `166059`, it decodes cleanly and consistently:
>
> ```
> jobId      166059
> client     0x216c05b8...367e
> provider   0xecf29492...b48f
> evaluator  0x216c05b8...367e     <- == client, confirms Mode 2
> budget     40000                 <- 0.04 USDC, the FRONT-RUN amount
> expiredAt  1785860226
> state      3
> metadata   "AgentOps S8 escrow spike"   (24 bytes, exact)
> ```
>
> The `288` reported below as a corrupt `state` is word [5] — the string offset `0x120` — misread because `jobs()` returns without the leading struct-offset word, shifting every slot by one. Note `budget` reads **40000**, independently confirming the front-run overcharge from a different angle than the event logs. So the deployed contract's state **is** readable, and question 5's real answer is that the deliverable is not in `getJob`'s struct — only in the logs, as the spec says. The ABI mismatch is real for `createJob` and `fund`, but not for the state getter.

**Question 5 — does `deliverable` appear only in the event log, not in `jobs()` state?** **Partially confirmed.** The deliverable hash (`0x063c548e...`) and the completion reason hash (`0x2ad4a5e2...`) both appear in the `submit`/`complete` transaction calldata and in the escrow's own emitted event logs. We could **not** independently confirm their absence from `jobs()` state, because the plan's assumed `jobs()` getter signature — `function jobs(uint256) view returns (address,address,address,uint256,uint8)` — **does not match this contract either**: calling it against both job `1` (Arc's own showcase job) and job `166059` returns internally-inconsistent, garbage-looking tuples (an invalid short address in the first slot, an absurd `uint256` in the budget slot, `state` decoding to `288`). This is the same class of finding as question 2 — **the plan's assumed ABI, sourced from Arc's tutorials, does not match the deployed bytecode.** We did not reverse-engineer the correct `jobs()` struct layout; it wasn't needed once question 2 had already failed.

**Question 6 — registry addresses for D3 (ERC-8004 identity), re-verified.** Identity registry `0x8004A818BFB912233c491871b3d84c89A494BD9e` **holds code** (129 bytes, proxy-shaped) on Arc testnet — confirmed via `eth_getCode`. This is prep evidence for Phase 8 · Task 1 only; it does not depend on or get affected by S8's fallback verdict.

**Applying the plan's fallback rule.** Section 3 of Phase 7's plan states: *"If any of 1–4 fails: S8 fallback. Escrow (D2) does not ship."* Question 2 fails on direct, decoded, on-chain evidence — not a flaky read, not an RPC hiccup, but the actual successful transaction calldata proving the guarded function does not exist and the unguarded one silently pays whatever the current budget is.

- **D2 (ERC-8183 escrow) does not ship in Phase 7.** Phase 7 · Tasks 2–3 (escrow job records migration, escrow lifecycle client) do not proceed.
- **Phase 7 · Task 4 (JIT Gateway bridge) is unaffected** — it does not depend on escrow and proceeds independently.
- **Phase 8 · Task 1 (D3 ERC-8004 identity) still ships standalone** — identity registration does not depend on escrow, and question 6 above confirms the registry is live.
- **Phase 8 · Tasks 2–3 (D4 payment-gated reputation, D5 reputation → allocation) fall with D2**, per the plan: reputation is written from the escrow completion hook, and that dependency is exactly what makes it earned rather than self-asserted. Shipping ungated reputation instead would be the overclaim the manifest explicitly warns against.

**Claim discipline going forward:** never state that ERC-8183 escrow "protects the client from being overcharged after quoting" — the opposite was just demonstrated on real testnet transactions. If escrow's mechanical lifecycle is ever referenced (e.g. in a writeup of this spike), the accurate claim is: *"funds are held in a third-party contract rather than the client's wallet once funded, and cannot be withdrawn by the provider directly"* — proof-of-funding-once-funded, not price protection before funding.

---

### S9 — the ERC-8183 guard proof against the deployed escrow — **PASS: the S8 front-run is blocked**

Closes S8's fallback. Deploys **our own** vendored copy of the current ERC-8183 reference implementation — not Arc's stale build that S8 tested — and replays the exact S8 attack against it, on-chain, with real transactions.

**Pinned source:** `github.com/erc-8183/base-contracts` at commit `142e669c1fd318486a4628395b629f033654dd06`, MIT licensed. Vendored under `packages/onchain/lib/base-contracts`. Confirmed present in the vendored source before building: `revert BudgetMismatch();` and `revert PaymentTokenMismatch();` (S8's stale build had neither).

**Build:** `via_ir = true`, `optimizer_runs = 200`. Deployed runtime bytecode size: **19,954 bytes** — under EIP-170's 24,576-byte limit with a 4,622-byte margin. No optimizer tuning was needed.

**Local tests (compile-time proof):** `forge test` — 3/3 passing, including the exact S8 scenario reproduced with `vm.expectRevert`. See `packages/onchain/test/FrontRunGuard.t.sol`.

**Deployed addresses:**

| Chain | chainId | Proxy (ERC-1967) | Implementation |
|---|---|---|---|
| Arc testnet | `5042002` | `0x31C050d9D20504c4E11b2A894051d8181B14e0F5` | `0x22F24Fa7161d00e6Bd2529548A7508414Ac9A760` |
| Base Sepolia | `84532` | `0x31C050d9D20504c4E11b2A894051d8181B14e0F5` | `0x22F24Fa7161d00e6Bd2529548A7508414Ac9A760` |

(Same addresses on both chains — same deployer, same nonce sequence, both CREATE not CREATE2; coincidence of the deploy order, not a cross-chain feature.) Full record including tx hashes for every deployment transaction: `packages/onchain/deployments.json`.

**Selector check on the deployed implementation bytecode** (not the proxy — selectors live in the implementation for a UUPS proxy), on both chains:

```
PUSH4 + 1f989ec8 (guarded fund(uint256,address,uint256,bytes))  -> present, count 1
PUSH4 + e25ba707 (stale   fund(uint256,bytes))                  -> absent, count 0
```

**The on-chain proof (Arc testnet, `scripts/spikes/s9-escrow-guard-proof.mjs`), mirroring S8's real scenario with two real funded wallets:**

| Step | Function | Caller | Tx hash |
|---|---|---|---|
| Create job | `createJob(...)` | client | `0x7d914e096d9f886bd2a5bfda8e802f0ffb7d9a96ebf521ab074f0d9b55ddfc57` |
| Quote | `setBudget(jobId, usdc, 20000, "")` | provider | `0xbff543a961003b4d70740ef492e0d97504876a78e522d3feeab2291e4191846a` |
| Approve (exact) | `approve(escrow, 20000)` | client | `0x9ac1f92916dfda0cfc0f5ae6bedde58e6b15e2cdd98be5c23cb2e0f8687eceb8` |
| **Front-run** | `setBudget(jobId, usdc, 40000, "")` | provider | `0xda69a6789a16093c9a3e39adad1cf3834542b116d5475e07db2e2b4b46143afe` |
| **Fund (attack replay)** | `fund(jobId, usdc, 20000, "")` | client | `0x77f4c847adeadc3f962710d7a8e11548340c83d9c144ce7169718d3c4657e382` — **status: reverted** |

**Direct before/after against S8.** On Arc's stale deployment (S8), the equivalent `fund` tx `0x0907ac70b8b542a780b8f42630da30e5e8a00c9b510c7c7d3ba06db5d2f2e2a2` **succeeded**, and the escrow ended up holding **40000** (0.04 USDC) — the front-run amount, overcharging the client by 0.02 USDC. Against this deployment, the equivalent `fund` tx **reverted**, and the escrow's USDC balance was independently read from the RPC before and after: **`0` before, `0` after.** No funds moved.

(The client's own USDC balance did drop slightly across the whole run — but that is gas, not the attack: on Arc, the gas token and this USDC ERC-20 view are the same underlying balance, so every transaction the client sends costs a sliver of it regardless of outcome. The decisive number is the escrow's balance, which stayed exactly zero.)

**Honest framing, preserved from the design doc:** ERC-8183 is a Draft EIP, roughly five months old at time of writing. We could not verify any audit — a search result claiming audits by Cyfrin/Nethermind/EF Security did not survive checking the cited source. This deployment is testnet only. The contract's neutral-evaluator design is only as neutral as whoever is set as `evaluator`; this proof never calls `complete()` and makes no claim about evaluator behavior.

**S8's failure was a stale deployment, not a flaw in the standard.** ERC-8183's prose mandates the guard; Arc's specific deployed build simply predated it. S9 deploys the current reference implementation and demonstrates the guard working exactly as the standard requires.

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

**Status (superseded — see the next section).** The "minimum-balance floor" hypothesis above is **wrong**, and the funding advice with it. Kept verbatim as the record of a wrong turn.

---

### Phase 7 · Task 4 — mint verified. The blocker was never gas; it was the wrong Circle account.

**The bridge works end to end.** Real Arc → Base Sepolia transfer of 0.05 USDC through the production `bridgeWalletTopUp()` code path, no human in the loop:

```
mint tx   0x3c71a8a2be8fa01f75211c07526382ea42bf93c6281e953c986957225ef02058
receipt   status 0x1 (success), block 45089806, gas used 132,532
to        0x0022222ABE238Cc2C7Bb1f21003F0a260052475B   (Gateway Minter)
log       USDC Transfer 0x000...000 -> 0xD7E0...d551, 0.05 USDC   (minted, not transferred)
arc side  gateway balance 32.000000 -> 31.946500
wallet    0xD7E0B42A09399E29b2e84fbEa02382ba2715d551, same address both chains
```

**Both sides reconcile exactly.** 0.0535 USDC left the Arc Gateway balance; 0.05 USDC was minted from the zero address on Base; the 0.0035 difference is Circle's fee, matching the rate the attestation response quoted earlier.

**Real root cause of the earlier failures — two distinct problems, neither of them gas:**

1. **The original `155258` was an unregistered entity secret,** not a balance shortfall. See the Phase 6 · Task 7 section above, which proved this independently: Circle surfaces an unregistered entity secret as a *balance* error. Every "fund the wallet with more ETH" inference drawn from it was chasing the wrong signal.
2. **The old proof wallets were on a different Circle account.** `0x216c...367e` (Arc depositor) and `0xecf2...b48f` (Base recipient) do not exist under the current credentials at all — re-running the bridge against them now fails with `Cannot find target wallet in the system`, and the wallet listing confirms their absence across all 114 wallet rows / 44 distinct addresses. The $0.20 Gateway deposit at `0x216c...367e` is stranded on the old account and cannot be signed for.

**The gas theory is disproven on direct evidence.** The successful mint used 132,532 gas on a wallet holding **0.0000367 ETH** — *less* than the 0.0001 ETH that the note above called "not enough." There is no minimum-balance floor. At Base Sepolia's sampled 0.006 gwei, the mint cost roughly 8×10⁻⁷ ETH, which is what the original arithmetic predicted; the arithmetic was right and the conclusion drawn from it was wrong.

**Operational lesson worth keeping:** when Circle credentials are rotated or a new developer account is created, every wallet address recorded in prior evidence becomes invalid, and Gateway deposits held by those wallets become unreachable. Verify wallet ownership against the *current* API key before trusting any address in an older proof.

---

### Piece 4 · Task 6 proof — the escrow-to-Permit2 graduation demo

**Verdict: the full narrative works end to end on real infrastructure — real Postgres, real Circle developer-controlled-wallets API (test mode), real Arc testnet RPC, the real deployed ERC-8183 escrow (`0x31C0...4e0F5`). Two escrow jobs completed (6 real transactions each), a human-equivalent promotion call opened a Permit2 delegation (2 transactions), and one drawdown against it settled in a single transaction — the exact 6-vs-1 contrast the console UI (piece 4) exists to make legible.**

Run via `validation/spike-escrow-console-demo.mts`, calling piece 2's and piece 3's engine functions directly (`createEscrowJob`, `fundEscrowJob`, `applyEscrowStateChange`, `getTrustEvidence`, `trustExternalAgent`, `drawDown`) — not mocks, the same functions any future route or the console itself would call. No route or UI calls the escrow lifecycle functions today; piece 2 is exercised only by mocked unit tests, so this is the first live run of that code against real infrastructure.

**Setup:** a fresh demo org, two agents (`Client agent (demo)`, `Marketplace provider agent (demo)`), each provisioned a real Circle wallet on Arc testnet, plus the org's own treasury wallet — all via the same `ensureCircleTreasury` / `enqueueAgentWalletProvisioning` code paths the console's onboarding flow uses.

**Funding hit a known blocker again:** Circle's testnet faucet (`POST /v1/faucet/drips`) returned a real `403`, the same finding already recorded above under Phase 6 · Task 7 (`/v1/faucet/drips` requires a mainnet-upgraded account). Funded manually instead — a plain signed `transfer()` from the same funded EOA prior spikes reused (`0x5448...96ee4`, ~$61 USDC on Arc), 0.30 USDC to each of the client wallet, provider wallet, and treasury wallet:

```
client wallet   0x788c43660bdd43f4fa965313547b4d3fb4d7a318   funded 0x52edbdea...258e6b
provider wallet 0x20355dbc2d92beccdf97e08a2ad4a4e8a0b72a0c   funded 0x13905e57...34865
treasury wallet 0x5fd645cc0071571750e25871ccbeaeef38a35b8f   funded 0x4c27ba88...e70ddb
```

**Two escrow jobs, funded and completed** (self-evaluated, escrow mode 2 — the client is its own evaluator, and this is stated as-is, not as neutral arbitration):

| Job | Create (`createJob`) | Fund (`setBudget`+`approve`+`fund`, last hash) | Submit | Complete |
|---|---|---|---|---|
| 1 (onchain id 5) | `0xfae75449...54eb251` | `0x46f8df69...1de47901` | `0x992e494b...f86d61e10` | `0x024117ba...f0936b1f462a6f` |
| 2 (onchain id 6) | `0x715b2fe6...0efc2244b4` | `0x9346826e...9f90c274d48` | `0x050c21b2...9b1ce27c874eb4b` | `0x54409bf5...90da1d5282` |

Both `complete` hashes confirmed `status: success` on-chain via `eth_getTransactionReceipt` (spot-checked, along with the create and drawdown hashes below). Each job is 6 transactions here specifically because this org holds the keys for **both** client and provider (a demo convenience) — `fundEscrowJob` auto-sends `setBudget` when the provider wallet is fleet-held, which a genuinely external provider would instead set out of band. The console's own claim ("Escrow: 5 transactions per job") describes that external-provider case; this run's honest count is 6, not 5, and that difference is recorded here rather than silently rounded off.

**Trust evidence, read before promotion** (`getTrustEvidence`): `completedCount: 2, settledUsdc: "0.040000", trusted: false` — exactly the two jobs above, nothing more.

**Promotion** (`trustExternalAgent`, `approvedBy` = the demo org's real owner user id, never `'system'`): opened a treasury-funded Permit2 delegation, ceiling `0.10` USDC, 90-day expiry — `allowlistId payto_a1bf0001...`, `delegationId dele_486e5494...`. Two transactions (ERC-20 `approve` then Permit2 `permit`), matching `recordSignedDelegation`'s documented shape. `getTrustEvidence` read again immediately after: `trusted: true`.

**Drawdown** (`drawDown`, one job's worth — 0.02 USDC, well under the 0.10 ceiling): **one transaction**, `0xef084b9e...93640722e04` (`transferFrom`, sent from the provider's own wallet as payee) — confirmed `status: success`, block `0x34fcebc`. Nothing was locked beforehand; nothing but this one call moved.

**The contrast, as run:** 6 transactions and locked capital to complete one escrow job under the untrusted rail, vs. 1 transaction and nothing locked for the same-sized payment once trusted — the trust decision itself (2 transactions, one time) is the only added cost, amortized across every future job with that counterparty.

Independently verifiable on Arc's testnet explorer, e.g. **https://testnet.arcscan.app/tx/0xef084b9e1dff76fafed5a28715e07f0f6bcced77349aeba964b0a93640722e04**.

---

## Phase 8 · Task 1 — ERC-8004 identity registration, live proof

Re-verification before writing any code (per the task's own gate, and the same discipline S8 already forced on escrow): the tutorial-documented Identity Registry address (`0x8004A818BFB912233c491871b3d84c89A494BD9e`) was confirmed live via `eth_getCode` on Arc testnet (262 bytes, a delegatecall proxy) rather than trusted on the tutorial's word. The real `register()`/`Registered` event ABI was pulled from the canonical `erc-8004/erc-8004-contracts` source, not re-derived from the tutorial. The Reputation Registry address (`0x8004B663056A597Dffe9eCcC1965A193B7388713`, needed for Task 2) was independently probed the same way and returns **byte-identical bytecode** to the Identity Registry — both delegatecall proxies from the same factory.

**Registration run**, via `registerAgentIdentity` (the actual application function, run against the live dev database and the running circle-worker — not a parallel script):

- Agent: `agt_a0eca188-7728-4c61-a639-59cdbf6c635a` ("research", org `kaushalya`)
- Submitter: the agent's own wallet, `0x29de452040e7df6ca31e28fd8d768a6a7d6e6d85` (ERC-8004 gives the token owner control of the entry, and the Reputation Registry's self-feedback guard later checks ownership of exactly this identity)
- tx `0x7fc58f442eb853787c25ac20c9988d465154a2bcf5858245119f7df34ebaa539`, minted **token id `863468`**

Confirmed independently via `eth_getTransactionReceipt` (not from the function's return value alone): `status: 0x1`, `to` matches the registry address, `from` matches the agent's wallet, and the `Registered` log's topic0 (`0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a`) matches the independently-computed `keccak256("Registered(uint256,string,address)")` — with `topics[1] = 0x...d2cec` decoding to `863468` and the log `data` decoding to the exact `agentURI` string that was sent. Idempotency (re-registering the same agent mints nothing further) is covered by `test/identity/erc8004.test.ts`, not re-proven live here.

---

## Phase 9 · Task 5 — Google ADK binding, live proof

Ran the real three-process setup documented in `apps/mcp/examples/README.md`:
a real api instance (`apps/api/scripts/adk-example-fixture.ts`), agentOps'
real unmodified `apps/mcp/src/http.ts` entrypoint pointed at it via plain
env vars (no code changes), and `apps/mcp/examples/adk_agent_example.py`
using the actual `google-adk` package (`google-adk[mcp]==2.6.2`, pinned to
`mcp>=1.24,<2` per its own `pyproject` constraint — the latest `mcp` 2.0.0
is NOT compatible with this ADK release, confirmed by a real `ImportError`
before pinning down).

A real `McpToolset` with `StreamableHTTPConnectionParams` (bearer auth)
completed the MCP handshake and listed agentOps' real tool surface:

```
Connected. 8 tools exposed by agentOps' MCP server:
  - agentops.activity_record
  - agentops.approval_consume
  - agentops.approval_status
  - agentops.onboard
  - agentops.operation_check
  - agentops.operation_record
  - agentops.payment_x402
  - agentops.policy_check
```

Then called `agentops.onboard` for real (not just listed it) against a real
throwaway org/agent/connection, and got back the actual runtime contract —
enforcement modes, the full action catalog (`runtime.http.request`,
`payment.x402.authorize`, `tool.call`) with required/optional fields and
examples, `isError: false`. No code changed in `apps/mcp/` to make this
work — confirming the manifest's framing: **a binding, not new
architecture**.

Not attempted: a full `LlmAgent` reasoning loop over this toolset, which
needs a live Gemini API key. See `adk_agent_example.py`'s docstring for why
that line isn't claimed here.

---

## Phase 9 · Task 6 — `llms.txt` / `skill.md` cold-onboarding proof

Verified per the plan's own bar: "have an agent onboard from them cold,
with no other context." A fresh subagent was given ONLY the text of
`docs/llms.txt` and `docs/skill.md` — no filesystem access, no other tools,
no other knowledge of agentOps — and asked to derive (a) the exact tool
call sequence before doing anything else, (b) the full branch (allow/deny/
approval-required) for a free external request, (c) the full approval-then-
retry sequence for a paid x402 request including a `pending` poll, and (d)
two explicit "do not" rules and why they matter.

It answered all four correctly with the right tool names and argument
shapes, and — more usefully — surfaced two real gaps instead of guessing
past them: no stated preference between `agentops.policy_check` and
`agentops.operation_check` for the same action types, and no concrete
polling backoff interval for `agentops.approval_status`. Both docs were
fixed in response (operation_check preferred for `runtime.http.request`/
`tool.call`; poll backoff of "at least 2s, doubling to a ~30s cap"
specified). This is the loop the plan's verification step is for: a real
cold read finding real ambiguity, not a self-check that could only confirm
what was already assumed correct.

---

## Circle native-balance indexing misses externally-received ETH — Base Sepolia (2026-08-07)

**Verdict: a Circle-side defect, not ours. Circle's transaction-creation pre-flight validates against its own
*indexed* native balance, not chain state. A plain inbound ETH transfer emits no event log, so for a newly
created BASE-SEPOLIA wallet that balance stays invisible and every transaction is rejected as "insufficient" —
including zero-value ones. Reported to Circle; the workaround is to fund Base gas from another Circle wallet
rather than from an external EOA.**

**Symptom.** `POST /v1/w3s/developer/transactions/contractExecution` on wallet
`d6843b9d-dcc4-53f4-b676-b008ac8f0aca` (`0x3aaa56cf…c158`, BASE-SEPOLIA, EOA) failed on every attempt over
~45 minutes with `155258 "the asset amount owned by the wallet is insufficient for the transaction."` — the
same undocumented code Phase 6 · Task 7 already flagged as misleading. It surfaced through the product as
`gateway.deposit` → `circle_gateway_deposit_failed`, blocking the demo's Base leg.

**How it was isolated.** Each row rules out one hypothesis:

| Probe | Result | Rules out |
|---|---|---|
| `eth_getBalance` on public Base Sepolia RPC | **0.0029 ETH present on-chain** | wallet genuinely unfunded |
| `POST /transactions/contractExecution/estimateFee` | needs **0.00000054 ETH** (`l1Fee` 7.5e-9 — negligible) | gas cost / OP-stack L1 data fee too high |
| zero-value `approve(spender, 0)` | same failure | token amount / USDC shortfall |
| explicit `gasLimit` override instead of `feeLevel` | same failure | fee-estimation path |
| `GET /wallets/{id}/balances?includeAll=true` | **no native entry at all**, USDC only | — (this is the finding) |
| identical call on ARC-TESTNET wallet, same wallet set + entity secret | **succeeds, `INITIATED`** | entity secret, API key, account-level block |
| 5 other BASE-SEPOLIA wallets on the same account | **do** have indexed native ETH (2.3e-5 – 1.3e-4) and work | Base-Sepolia disabled for this account |
| send 0.00004 ETH from a donor holding 0.0000395 | correctly rejected as insufficient | — confirms the gate works *when* a balance is indexed |

Note the sixth row: Arc passes only because Arc's native gas asset **is** USDC, which Circle already indexes as
an ERC-20. Arc's success was therefore never evidence that signing worked in general — it masked the defect.

**What confirmed the cause.** A Circle-*originated* native transfer of 0.00005 ETH into the same wallet
(tx `0xb2e85f4064fa6933b59e99bf44c99e8b76a9dde2ae6869c8f320ccbaf4167333`, `CONFIRMED`) made
`/balances` immediately report **0.00295 ETH** — the 0.00005 Circle sent *plus* the 0.0029 sent externally
that it had been unable to see. One Circle-mediated transaction forces a rescan that surfaces the whole
balance. The next `contractExecution` succeeded.

Native token id for BASE-SEPOLIA ETH, needed for that transfer: `f2ab11ae-53fa-5373-86e5-8b38447b65fb`
("Base Ethereum-Sepolia", `isNative: true`).

**Honest limit of the claim.** We observed non-indexing across ~45 minutes and ~6 retries; Circle publishes no
indexing SLA, so "never indexed" is not proven — "not indexed within 45 minutes, then indexed instantly on
Circle-originated activity" is. That is enough to make external funding unusable for a scripted demo either way.

**Product consequence.** This is the concrete mechanism behind `change-manifest.md` L.5's "Base gas
provisioning is manual". `ensureAgentGasFloor` is already a deliberate no-op off Arc (`agent-funding.ts`); the
path to closing that gap is a **Circle-originated** native top-up, since that is the only funding route Circle
reliably sees. Funding Base gas by external transfer will appear to work on-chain and still fail at submit time.

**Claim discipline.** Do not describe Base gas as "fund the wallet and it works". The accurate statement is:
*a Base agent wallet must be funded with native ETH from another Circle wallet; an externally-funded wallet can
hold ETH on-chain and still be rejected as insufficient.*

---

## Manifest §K.4 fleet demo — full five-agent run, re-verified end to end (2026-08-07)

**Verdict: manifest steps K.4 1–8 run end to end on real testnets, with every payment independently confirmed
from chain state (receipt status + decoded `Transfer` logs), not from the runner's own return values.**
Org `org_9add7cd3-03eb-471f-85db-7024a9a0a5bd`, treasury `0xd7e0b42a…d551`, via `demo/reset.mjs` +
`demo/run.mjs` against a live `dev:api` and `dev:circle-worker`.

| # | Payment | Chain | Amount | Tx | Receipt |
|---|---|---|---|---|---|
| 1 | Orchestrator → DataFetcher | Arc | 0.01 | `0x68c135624c3909b754a1a66246925f032906d62308c027e4611682d3ad9565ee` | success, block 55712050 |
| 2 | Orchestrator → Analyst | Arc | 0.05 | `0x96867c7c5493d250fdc0daeff05c6d91f457fd4f75e4de26ee282dd1bce9ceb0` | success, block 55712095 |
| 3 | **Analyst → DataFetcher (second hop)** | Arc | 0.01 | `0x576be257d15dfeddcab8801ef0187115076dde6e346c0388ca52adaceae6abfa` | success, block 55712143 |
| 4 | Orchestrator → Writer | Arc | 0.02 | `0x9939df2b2c5d694802e1c53cccd5bb933cc01c01965bcb4b4f0ec548e2275822` | success, block 55712181 |
| 5 | **Orchestrator → SeniorReviewer (cross-chain)** | **Base** | 0.03 | `0x738e4229f6a35e953e647cca23ed102399abe871704461423aefa4e05594716e` | success, block 45152242 |

Amounts match Section L's original run exactly. Verified beyond the hashes: payment 3's decoded `Transfer`
originates from the **Analyst's** wallet (`0x663a7dbb…1026` → `0x51b9fe84…16e5`), so the second hop is a real
agent acting as both seller and buyer — not the hub paying a leaf. Payment 5 settles on Base while 1–4 sit on
Arc, from the same Orchestrator address (`0x182c8643…430d`) funded separately per chain.

**Reading Arc receipts.** Each Arc tx carries **two** `Transfer` logs for one payment — Arc's native (18-dec)
and ERC-20 (6-dec) views of the same USDC (`1e16` == `0.01`). This is Arc's dual-view behaviour, not a double
transfer; a naive log count will double-report every Arc amount.

**Not covered by this run:** K.4 steps 9–11 (escrow hire → reputation → allocation feedback). Those engines
exist and are tested, but no route or agent triggers them, so they remain outside the runnable demo — the same
gap `validation/spike-escrow-console-demo.mts` states in its own header.

---

## Acceptance artifacts

On-chain milestones need explorer links, not just passing tests. A claim whose entire value is third-party verifiability cannot be evidenced by our own test suite.

| Milestone | Artifact | Status |
|---|---|---|
| Phase 3 · Task 4 — provable max-loss | Funded $20.00, attempted $25.00 → `409 insufficient_agent_wallet_balance`; attempted $5.00 → `200` settled. See "Phase 3 · Task 4 proof test" above. | ✅ |
| Phase 3 · Task 3 — distinct agent wallets | Two real addresses via Circle SDK: `0xecf2...9b48f` (Agent A) vs `0x216c...9367e` (Agent B) — see above | ✅ |
| Phase 4 · Task 5 — sweep-revocation | Balance drains to treasury, tx hash | ✅ tx `0x566966b...f3d5627` — see "Phase 4 · Task 5 proof test" above |
| Phase 6 · Task 2 — Permit2 drawdown | Real drawdown + `lockdown()` via `permit2.ts`'s actual functions, tx `0x8232550...dae86f25`, allowance confirmed `0n` after lockdown. See "Phase 6 · Task 2 proof test" above. | ✅ |
| Phase 6 · Task 6 — cross-chain hop | Settlement on Base's explorer while fleet runs on Arc. Re-verified from chain state 2026-08-07 — see "Manifest §K.4 fleet demo" above | ✅ base tx `0x738e4229...4e05594716e` |
| Manifest §K.4 — five-agent fleet, steps 1–8 | 5 payments (4 Arc + 1 Base), all receipts `status: success`, `Transfer` logs decoded to confirm payer/payee. Second hop originates from the Analyst's own wallet. See "Manifest §K.4 fleet demo" above | ✅ |
| Circle native-balance indexing defect (Base Sepolia) | Isolated to Circle's indexed-balance pre-flight; Circle-originated transfer forces a rescan. See "Circle native-balance indexing misses externally-received ETH" above | ✅ reported upstream · tx `0xb2e85f40...af4167333` |
| Piece 4 · Task 6 — escrow-to-Permit2 graduation demo | 2 completed escrow jobs (6 tx each), promotion (2 tx), 1-tx drawdown. See "Piece 4 · Task 6 proof" above | ✅ tx `0xef084b9e...93640722e04` |
| Phase 8 · Task 1 — ERC-8004 identity registration | Real agent registered via `registerAgentIdentity`, token id `863468`. See "Phase 8 · Task 1" above | ✅ tx `0x7fc58f44...34ebaa539` |
| Phase 9 · Task 5 — Google ADK binding | Real `google-adk` `McpToolset` connected to our real MCP server, listed 8 real tools, called `agentops.onboard` end to end. See "Phase 9 · Task 5" below | ✅ |
