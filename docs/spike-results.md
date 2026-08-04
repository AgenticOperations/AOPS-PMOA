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
| **S8** `[K-5]` | ERC-8183 funding mechanics + registry addresses (Phase 7) | ⬜ not run | |

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
- *"Circle can't index externally-sent ETH"* — false. It spends it fine once the entity secret is registered.
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

## Acceptance artifacts

On-chain milestones need explorer links, not just passing tests. A claim whose entire value is third-party verifiability cannot be evidenced by our own test suite.

| Milestone | Artifact | Status |
|---|---|---|
| Phase 3 · Task 4 — provable max-loss | Funded $20.00, attempted $25.00 → `409 insufficient_agent_wallet_balance`; attempted $5.00 → `200` settled. See "Phase 3 · Task 4 proof test" above. | ✅ |
| Phase 3 · Task 3 — distinct agent wallets | Two real addresses via Circle SDK: `0xecf2...9b48f` (Agent A) vs `0x216c...9367e` (Agent B) — see above | ✅ |
| Phase 4 · Task 5 — sweep-revocation | Balance drains to treasury, tx hash | ✅ tx `0x566966b...f3d5627` — see "Phase 4 · Task 5 proof test" above |
| Phase 6 · Task 2 — Permit2 drawdown | Real drawdown + `lockdown()` via `permit2.ts`'s actual functions, tx `0x8232550...dae86f25`, allowance confirmed `0n` after lockdown. See "Phase 6 · Task 2 proof test" above. | ✅ |
| Phase 6 · Task 6 — cross-chain hop | Settlement on Base's explorer while fleet runs on Arc | ⬜ |
