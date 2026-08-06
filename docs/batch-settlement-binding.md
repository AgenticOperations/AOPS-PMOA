# `batch-settlement` Binding — Permit2 Ceiling + Drawdown

**Status: shipped.** This documents what Phase 6 actually implemented and what has been driven live on Arc testnet since (see `docs/spike-results.md`'s Phase 6, treasury/org-ceiling, and escrow-trust-graduation sections for real transaction hashes) — not a design intent. Where the implementation differs from a naive reading of the `batch-settlement` idea, that difference is called out explicitly rather than smoothed over.

**Where it lives:** `apps/api/src/engines/payments/permit2.ts`. Permit2 itself is Uniswap's canonical, already-deployed, already-audited contract — this binding does not deploy or modify Permit2; it signs and submits against the existing one at `0x000000000022D473030F116dDEE9F6B43aC78BA3` on every supported chain (`packages/onchain` deploys nothing for this rail).

---

## 1. Commitment format

The commitment is a single **`PermitSingle`** struct, signed once per payer→payee pair, built by `buildPermitSingle` (`permit2.ts:126`):

```solidity
struct PermitDetails {
  address token;       // the USDC contract on that chain
  uint160 amount;      // the CEILING, not a per-payment amount
  uint48  expiration;  // unix seconds
  uint48  nonce;       // Permit2's own per-(owner,token,spender) sequence
}
struct PermitSingle {
  PermitDetails details;
  address spender;      // the payee's wallet address
  uint256 sigDeadline;  // signature validity deadline (== expiration here)
}
```

Signed as EIP-712 typed data under Permit2's own domain (`name: "Permit2"`, the real `chainId`, `verifyingContract` = the Permit2 address) — not a bespoke domain this codebase invented.

**One commitment authorizes many payments, not one.** `amount` is the ceiling the payee may draw against over the delegation's lifetime, not the size of a single transfer. Each individual payment is a separate, later, unsigned `transferFrom` call (item 6) that decrements the on-chain allowance — this is what makes it "batch" settlement: one signature, many redemptions, until the ceiling or expiry is hit.

## 2. Verification

Verification is Permit2's own, not reimplemented here. `permit()` recovers the signer from the EIP-712 signature and checks it against the token owner — this codebase never verifies the signature itself; it only *submits* it. Two consequences that follow directly from that:

- **Anyone may submit `permit()`.** The signature is self-authenticating, so the platform can submit a user-owned payer's permit on their behalf without holding their key (`resolvePermitSubmitter`, `permit2.ts:275`) — submission and authorization are deliberately decoupled.
- **Nothing here re-derives the signer address to sanity-check it client-side.** Trust is entirely in Permit2's `ecrecover`, on-chain, at `permit()` time.

## 3. Storage

**The chain is the sole source of truth.** Permit2's own storage (`allowance[owner][token][spender]`) is the actual live allowance — nothing else authorizes a `transferFrom`.

`agent_delegations` (migrations `0028`–`0030`) is a **mirror**, not a second authority: `ceiling_usdc`, `drawn_usdc`, `expires_at`, `status`. It exists so the control plane can answer "how much headroom does this payee have" without an RPC round-trip on every request, and so the org-level ceiling and treasury solvency checks (`delegation-ceiling.ts`) have something local to sum. If the mirror and the chain ever disagree, the chain wins — nothing in this codebase writes the mirror without immediately having just caused the on-chain state it records.

## 4. Double-spend prevention

Two independent layers, not one:

- **On-chain: Permit2's own nonce.** `details.nonce` must be strictly increasing per `(owner, token, spender)` — `permit()` reverts on a stale or reused nonce. This codebase reads the *real* current nonce immediately before signing (`readPermit2Nonce`) rather than assuming a locally-tracked counter, specifically because a stale local nonce was confirmed live to produce an opaque "API parameter invalid" error from Circle rather than a clear revert reason (`permit2.ts`'s own comment on this).
- **Off-chain: a Postgres row lock.** Every drawdown (`drawDown`, `permit2.ts:596`) does `SELECT * FROM agent_delegations WHERE id = $1 FOR UPDATE` before checking `drawnMicros + amountMicros > ceilingMicros` and writing the new `drawn_usdc`. This is what prevents two concurrent drawdown requests against the *same delegation* from both reading a stale `drawn_usdc` and both passing the ceiling check.

Neither layer substitutes for the other: the row lock prevents a race *within this control plane's own drawdown path*; Permit2's nonce is what prevents a *duplicate signed permit* itself from being replayed, independent of whether this codebase's row lock exists at all.

## 5. Expiry

Two separate expiries, both enforced, both real:

- `PermitDetails.expiration` (`uint48`) — enforced **on-chain** by Permit2 itself. Past this, `permit()` reverts regardless of anything this codebase does.
- `sigDeadline` — also on-chain, also Permit2-enforced, set equal to `expiration` here (this binding does not use a separate, shorter signature deadline).
- `agent_delegations.expires_at` — the **off-chain mirror** of the same value, checked by `drawDown` (`delegation.expires_at.getTime() <= Date.now()`) so an expired delegation is refused locally before ever reaching the chain. This is a fast-fail convenience, not the actual authority — the on-chain `expiration` is what actually matters if this check were ever bypassed.

## 6. Redemption

One `transferFrom` per payment, sent by the **payee**, not the payer:

```solidity
transferFrom(address from, address to, uint160 amount, address token)
```
called on **Permit2 itself** (not the token), with `from` = the delegation's `payer_address`, `to`/sender = `payee_address` (`drawDown`, `permit2.ts:640`). Permit2 recognizes the allowance only after `permit()` has landed on-chain — the signature alone authorizes nothing until that submission step (item 1) has actually recorded it in Permit2's storage.

Each drawdown decrements the ceiling by exactly its own amount (`drawn_usdc` accumulates; `drawDown` refuses once `drawn + requested > ceiling`) — there is no separate "spend" step beyond this single call. A drawdown is inserted as `'submitted'` before the provider call and the whole function runs in one DB transaction, so a mid-call crash rolls the attempt back rather than leaving a half-recorded draw.

**Revocation** (`revokeDelegation`, `permit2.ts:681`) calls Permit2's `lockdown((address,address)[])`, zeroing the allowance for that `(token, spender)` pair — but only when the platform holds the payer's key (an agent wallet or the org treasury). For a **user-owned payer**, the platform cannot submit `lockdown()` at all — only the allowance owner can — so revocation there stops *this control plane* from issuing further drawdowns (the row is marked `revoked`) while the **on-chain allowance stays live** until the user signs the revocation themselves in their own wallet. `onChainRevoked` in the response tells the caller which case it got; the UI must prompt for a signature when it's `false`. This asymmetry is a direct, unavoidable consequence of the non-custodial design (see `docs/decisions.md`'s delegation-UX entry) and is not smoothed over here.

## 7. Trust model

**Capital-backed, not escrowed.** Funds never leave the payer's wallet (or the treasury's) until the payee actually calls `transferFrom` — nothing is locked up front the way ERC-8183 escrow locks a job's budget.

**The payee carries collection risk, stated plainly:** because funds remain with the payer, the payer could spend that balance elsewhere between signing the permit and the payee drawing against it. Permit2's allowance is a *ceiling*, not a *reservation* — it does not lock the underlying tokens. Inside this platform's own fleet, where payer spending is already gated by this same control plane, that is the correct place for the risk to sit (per the D2b rule recorded in `docs/superpowers/plans/2026-08-03-scope-and-cuts.md`). For a counterparty outside the fleet, this is exactly why `trust.ts`'s graduation flow (`docs/spike-results.md`'s trust-graduation section) requires a settled escrow track record *before* this cheaper, capital-backed rail is opened for them — escrow's locked capital is what earns the right to the collection risk this rail accepts instead.

**Never claim this is escrow, insurance, or a payment guarantee.** It is a signed, revocable spending ceiling against real funds that stay with their owner until drawn.
