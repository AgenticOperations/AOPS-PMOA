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
| **S1** `[K-17]` | Arc chain ID: docs `5042002` vs facilitator `eip155:14601` | ⬜ not run | |
| **S2** `[A2]` | Dev-controlled EOA wallets on `ARC-TESTNET`, end to end | ⬜ not run | |
| **S3** `[A1]` | Can the entity secret sweep funds out to treasury? | ⬜ not run | |
| **S4** `[K-12]` | Permit2 `approve` + `transferFrom` on Arc's native-USDC view | ⬜ not run | |
| **S5** `[K-4]` | Arc testnet USDC faucet path | ⬜ not run | |
| **S6** `[C3]` | ERC-20 `balanceOf` truncation vs native balance | ⬜ not run | |
| **S7** `[A5]` | Compliance / Transaction Screening API access | ⬜ not run | |
| **S8** `[K-5]` | ERC-8183 funding mechanics + registry addresses (Phase 7) | ⬜ not run | |

**Tier decision:** pending **S4**. Passes → **T3**. Fails → **T4**, Lane 2 falls back to per-payment `exact`, and the scoped-delegation claim comes out of the deck.

---

## Acceptance artifacts

On-chain milestones need explorer links, not just passing tests. A claim whose entire value is third-party verifiability cannot be evidenced by our own test suite.

| Milestone | Artifact | Status |
|---|---|---|
| Phase 3 · Task 4 — provable max-loss | Fund $1.00, attempt $2.00, show rejection + explorer balance | ⬜ |
| Phase 3 · Task 3 — distinct agent wallets | Two agent addresses on `testnet.arcscan.app` | ⬜ |
| Phase 4 · Task 5 — sweep-revocation | Balance drains to treasury, tx hash | ⬜ |
| Phase 6 · Task 2 — Permit2 drawdown | Allowance decrementing across 3 payments, then `lockdown()` | ⬜ |
| Phase 6 · Task 6 — cross-chain hop | Settlement on Base's explorer while fleet runs on Arc | ⬜ |
