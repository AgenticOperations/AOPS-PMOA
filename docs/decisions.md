# Build Decisions

Decisions made during the Arc build, per `docs/superpowers/plans/2026-08-03-phase0-gates.md`. Each records the reasoning, not just the verdict.

---

## A3 — Flip to developer-controlled wallets

**Decision: yes.** Per-agent wallets are impossible under Agent Wallets (each is bound to a human's email + OTP). Keep the Agent Wallet path intact behind the existing `CIRCLE_TREASURY_PROVIDER` env flag for fallback.

**Confirmed by spike S2:** `ARC-TESTNET` accepted as a blockchain literal, EOA wallets provisioned under `DEVELOPER` custody from one entity secret, no OTP. See `docs/spike-results.md`.

## A4 — Chain scope

**Decision: Arc testnet + Base Sepolia only.** Base is needed solely for the cross-chain hop in the demo scenario. Every additional chain multiplies wallets to fund, monitor, and top up (per manifest K.1d Concern 3).

## A6 / K-2 — Escrow scope

**Decision: none in T3 (Phases 0-6); sequenced into Phase 7, gated on spike S8.** ERC-8183 is a Draft EIP (~5 months old), unaudited, with an unhandled evaluator-liveness trap. Building it is worthwhile but T3's claims must not depend on it. If it ships, use Mode 2 (`evaluator = client`) per manifest D2b, and describe it as *proof-of-funding before work begins* — never neutral arbitration.

## K-6 — Reputation → allocation formula

**Not needed for T3.** Required before Phase 8 · Task 3 starts. Must be bounded with a hard floor, a hard ceiling, and a bounded per-job step size — an unbounded feedback loop on real money is dangerous. Formula to be recorded here before that task begins.

## K-11 — 7-day `minValiditySeconds` exposure window

**Decision: cap Lane 1 (external-service x402 payments) to small amounts.** Confirmed via spike S1: the Circle facilitator publishes `minValiditySeconds: 604800` (7 days) for Arc's `exact` scheme. A 7-day signed authorization window is long; keeping per-payment amounts low bounds the worst case.

## K-18 — `bridgeWalletTopUp` regression, accepted

**Decision: accept the regression deliberately.** Flipping to developer-controlled wallets (Phase 2 · Task 1) removes the only working `bridgeWalletTopUp` implementation — the Agent Wallet CLI path (`circle-provider.ts:1245`). The developer-controlled provider's version is a stub that returns `success: false` with `errorReason: 'developer_controlled_bridge_topup_not_supported'` (`circle-provider.ts:993-1000`).

**Consequence:** cross-chain funding uses **pre-funding per chain (Option A)** — an agent gets a separate wallet on each chain it needs, funded independently — not just-in-time bridging, until Phase 7 · Task 4 implements the real Gateway bridge (K-15).

**Verified in Phase 2 · Task 1:** with `CIRCLE_TREASURY_PROVIDER=developer_controlled`, `bridgeWalletTopUp` returns the stub result exactly as described. Test: `apps/api/test/payments/circle-org-provider.test.ts`.

**RESOLVED in Phase 7 · Task 4.** `bridgeWalletTopUp` is implemented via the Gateway just-in-time path (`gateway-bridge.ts`): sign a burn intent on Arc, get an attestation from Circle Gateway, mint on the destination chain. Cross-chain no longer depends solely on Option A pre-funding.

Verified end to end with a real Arc → Base Sepolia bridge of 0.05 USDC through the production code path, both sides independently confirmed on-chain:

```
mint tx   0x3c71a8a2be8fa01f75211c07526382ea42bf93c6281e953c986957225ef02058
receipt   status 0x1 (success), block 45089806, gas used 132,532
to        0x0022222ABE238Cc2C7Bb1f21003F0a260052475B   (Gateway Minter)
log       USDC Transfer 0x000...000 -> 0xD7E0...d551, 0.05 USDC   (a real mint)
arc side  gateway balance 32.000000 -> 31.946500  (0.05 burn + 0.0035 fee)
```

Both halves reconcile exactly: 0.0535 USDC left the Arc Gateway balance, 0.05 USDC was minted from the zero address on Base, and the 0.0035 difference matches Circle's documented fee. See `docs/spike-results.md`'s "Phase 7 · Task 4 — mint verified" section for the earlier failed attempts and their real root cause.
