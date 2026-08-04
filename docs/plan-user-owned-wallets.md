# Plan — user-owned wallets (non-custodial delegation)

## The goal

The user's own browser wallet (MetaMask / any WalletConnect wallet) holds the money. Agents never
hold user principal — they draw against a Permit2 delegation the user signed, bounded by a ceiling
the user can revoke at any time.

**User does exactly two on-chain transactions:**

| Action | When | Why the user must send it |
|---|---|---|
| `approve(Permit2, ceiling)` | once per chain | ERC-20 approvals must come from the token owner |
| `lockdown()` | on revoke | the safety property — only the owner can kill a delegation |

Everything between is a **gasless off-chain EIP-712 signature**.

## Why this is mostly already built

`drawDown` ([permit2.ts:412](../apps/api/src/engines/payments/permit2.ts#L412)) already submits
`transferFrom` from `delegation.payee_address` — **the agent submits and pays gas, not the payer.**
The payer only ever produced a signature. So the payer's key never needs to be reachable by the
platform for payments to work.

What blocks it today:

1. `recordSignedDelegation` always obtains the signature via `provider.signPermit2Delegation`
   (Circle). There's no way to supply a signature produced elsewhere.
2. `approve()` and `permit()` are both submitted from the payer's address — impossible when the
   payer is a user wallet we don't control.
3. Delegations have **no HTTP routes at all**. They're only created internally by `intra-fleet.ts`.
4. The web app has **no wallet integration** — no wagmi, viem, or WalletConnect.

## Chains

| Chain | Chain ID | Gas asset | USDC |
|---|---|---|---|
| Arc testnet | `5042002` | **USDC is native** | `0x3600…0000` |
| Base Sepolia | `84532` | ETH | `0x036CbD53…` |

---

## Phase 1 — API foundation

No frontend needed; fully unit-testable.

### 1.1 Resolve who submits `permit()`

Today `senderAddress: payerRow.address`. Permit2 recovers the owner from the signature, so **anyone
can submit**. Replace with a resolver that picks the first address the platform actually controls:

```
payer (if it's an agent wallet) -> payee (if it's an agent wallet) -> org treasury
```

This is what makes a user-owned payer possible. Keeps agent→agent working unchanged.

### 1.2 Accept externally-produced signatures

`recordSignedDelegation` gains an optional `signature` + `ownerAddress`. When present, skip
`provider.signPermit2Delegation` and skip the platform-submitted `approve()` (the user does that in
the browser). When absent, behave exactly as today.

### 1.3 Routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/orgs/:orgId/payments/delegations/typed-data` | build the EIP-712 payload for the user to sign (reads the live Permit2 nonce) |
| `POST` | `/v1/orgs/:orgId/payments/delegations` | record a user-signed delegation |
| `GET` | `/v1/orgs/:orgId/payments/delegations` | list, for the UI |
| `POST` | `/v1/orgs/:orgId/payments/delegations/:id/revoke` | revoke |

### 1.4 Tests

- typed-data reads the real nonce (a stale nonce silently reverts on-chain — already a known trap)
- a user-signed delegation records without calling `signPermit2Delegation`
- `permit()` submitter falls through payer → payee → treasury
- agent→agent path unchanged

---

## Phase 2 — Browser wallet

### 2.1 Dependencies
`wagmi`, `viem`, `@tanstack/react-query` in `apps/web`.

### 2.2 Chain config
Arc (`5042002`, custom RPC) + Base Sepolia (`84532`). Arc's native gas asset is USDC, which is
unusual — wallets may render the symbol oddly. Cosmetic, not blocking.

### 2.3 Connect + approve
"Connect Wallet" button. Then a one-time `approve(Permit2, ceiling)` per chain, sent by the user.
Show current allowance so it isn't repeated needlessly.

### 2.4 Delegate to an agent
Fetch typed data → `signTypedData` in the wallet → POST the signature. No gas, no transaction.

### 2.5 Delegations page
List active delegations: agent, chain, ceiling, drawn, remaining, expiry, revoke button.

---

## Phase 3 — Make the treasury optional ✅

`fundAgentFromUserDelegation` ([agent-funding.ts](../apps/api/src/engines/payments/agent-funding.ts))
tops an agent up **at the moment it spends**, drawing only the shortfall from a delegation the
operator signed with their own wallet. It runs on the same path as the custodial flow and is a
no-op when the agent already holds enough, so both funding models coexist.

That removes allocations, treasury top-ups, and the Gateway deposit from the critical path. The
treasury (Circle wallet set) is still needed to *provision* agent wallets — it just no longer needs
to hold money.

Guards that matter, each covered by a test:
- only `payer_agent_id IS NULL` delegations count — an agent-owned one would have the agent paying
  itself, funding nothing and burning its own headroom
- never draws past the ceiling; a partial top-up would leave the agent unable to pay anyway
- returns a reason rather than throwing, so an org still on the custodial path is unaffected

**Still open: agents pay their own gas.** On Base that's ETH, and nothing supplies it (Arc hides
this because its gas asset is USDC). A gas-only top-up path is the one piece of funding that must
remain, and it is not built.

---

## Order

1. Phase 1 — foundation ✅
2. Phase 2 — browser wallet ✅
3. Phase 3 — treasury no longer on the critical path ✅

## Not yet proven

Every test uses a fake provider. **No real wallet has signed anything yet.** The path that matters
— MetaMask producing a signature Permit2's `permit()` accepts on Arc — is untested end to end.
Spike S4 proved the payload shape via Circle's signer and EIP-712 is EIP-712, so it should hold,
but "should" is not "does". That live run is the next real milestone.

## Explicitly out of scope

- Migrating existing custodial orgs. Both models coexist: a delegation whose payer is an agent
  wallet works exactly as it does now.
- Mainnet. Everything here is testnet.
