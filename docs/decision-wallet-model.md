# Decision — developer-controlled wallets, not Circle Agent Wallets

**Date:** 2026-08-05 · **Status:** decided · **Supersedes** the reasoning in `[A3]`/`[K-16]`

## Decision

Agent wallets are **Circle developer-controlled wallets** (EOA, one entity secret). The operator's
own browser wallet holds the money and grants each agent a scoped, revocable Permit2 allowance.

Circle **Agent Wallets are not used as the wallet substrate.** They remain a candidate for OTP
step-up on dangerous operations (see "Where Agent Stack still fits").

## Why — the one reason that actually decides it

The product's core idea is a **hierarchy of authority**: the operator's wallet is the root, each
agent is a child holding a scoped grant that can be capped and revoked independently.

**Circle Agent Stack has no parent→child permission model.** `circle wallet create` produces
"agent-controlled SCA wallets on each supported EVM chain" — *one wallet per chain, per login
session*. Circle's own skill docs state they do not cover "any hierarchical permission structure
between wallets." Getting N independently-capped agents means N email logins and N OTP sessions.

Developer-controlled wallets provide the missing grain directly: **one entity secret provisions up
to 10 million wallets**, Circle's MPC signs, and there is no per-agent key material or per-agent
human login (`change-manifest.md` K.1d Concern 1).

## Corrections to earlier claims in this repo

Several arguments previously made against Agent Wallets do **not** hold. Recorded so nobody
re-derives them:

| Earlier claim | Reality |
|---|---|
| "Agent Wallets can't do cross-chain" | **False.** They do CCTP via `circle bridge transfer`, and our own `bridgeWalletTopUp` already calls it (`circle-agent-cli.ts`). |
| "Agent Wallets can't do Gateway / Nanopayments" | **False.** Circle's Agent Nanopayments product is built on Gateway Nanopayments and is documented for agent wallets. |
| "Agent Wallets are SCA, therefore Gateway rejects them" | The SCA part is **true** (`circle wallet create` → "agent-controlled SCA wallets"). The inference is **false** — SCA and Gateway Nanopayments evidently coexist. |
| `[K-16]`: *"Gateway rejects non-EOA signatures… EIP-1271 can't be accepted"* | **Uncited and now doubtful.** Re-verify before relying on it. Pinning EOA is still correct for other reasons, but this justification is not established. |

Agent Wallets are more capable than this repo previously assumed. The decision does not rest on
capability gaps.

## What Agent Wallets genuinely do better

- **CCTP bridging works today.** Our developer-controlled `bridgeWalletTopUp` is a hard stub
  (`developer_controlled_bridge_topup_not_supported`). `[K-18]` is a **real regression** we accept
  and should close via CCTP's REST API.
- **Per-wallet MPC key isolation.** Each wallet has its own 2-of-2 MPC key material. With
  developer-controlled, one entity secret controls every wallet — weaker key isolation.

## What decides it against them, and is verified

| Constraint | Evidence |
|---|---|
| Session expires every **7 days**, then all payments stop with `circle_connection_required` | `circle-connection-service.ts:15`, `:150-157` |
| Per-agent wallets ⇒ per-human logins — *"genuinely unworkable"* | `change-manifest.md` K.1d Concern 1 |
| **Sweep-on-revoke needs the entity secret.** Under Agent Wallets it needs the user's live OTP session — so the guardrail fails exactly when nobody is awake | Spike S3, tx `0x0cb4fe447ad1e00bd5ef78faf4ef9cce6fe5d222e264044182eaef5d50d252a3` |
| Circle's spending policies are **mainnet-only** and **enforced by the CLI**, not on-chain | `circlefin/skills` agent-wallet-policy |

That last row is also the product's differentiator: **our caps are enforced by the Permit2 contract
and work on testnet.** Circle's are a client-side check that cannot run in our demo environment at
all.

## Custody, stated exactly

Three wallets, three different answers. "Non-custodial" alone would be overselling it.

| Wallet | Key held by | Custody | Holds |
|---|---|---|---|
| Operator's browser wallet | **the operator** | **non-custodial** | all principal |
| Agent wallets | us (one entity secret, Circle MPC) | **custodial** | only what an agent drew or earned |
| Org treasury (wallet set) | us | custodial | nothing, after just-in-time funding |

Honest phrasing: **"your funds stay in your wallet."** Not "fully non-custodial" — we hold agent
keys, because an agent whose key needs a human isn't autonomous.

Maximum loss from a compromised platform = the sum of active delegation ceilings, not the
operator's balance.

**Revocation is two-part.** Marking a delegation revoked stops *us* immediately. Permit2's
`lockdown()` can only be called by the allowance owner, so the on-chain allowance survives until
the operator signs it. The UI says exactly this rather than reporting a full revoke.

## Why this is still a Circle build

Developer-controlled wallets are Circle's product. The stack in use: Circle developer-controlled
wallets, Circle Gateway, Circle's x402 / Nanopayments rails, Arc as home chain. The addition is a
governance layer over those primitives — on-chain-enforced, hierarchical, revocable agent
authority — which Agent Stack does not provide at any layer.

## Where Agent Stack still fits

**OTP as step-up authentication** for dangerous operations: raising a spending cap, adding a payee,
disabling a guardrail. Real second-factor value at the three moments it matters, without paying the
session-expiry cost on every payment. Not built yet.

## Consequences

1. Onboarding drops the Circle email + OTP flow. The treasury is created silently; the operator
   connects their own wallet instead.
2. `[K-18]` stands as accepted debt: no CCTP path on developer-controlled until built.
3. Key isolation is weaker than per-wallet MPC. Mitigated by agents holding almost nothing —
   principal stays with the operator, exposure is capped per delegation.
