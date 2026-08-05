# `packages/onchain` — ERC-8183 reference escrow (vendored, not authored)

This package deploys the current [ERC-8183](https://eips.ethereum.org/EIPS/eip-8183) reference
implementation to testnets. **We write no payment logic here.** The escrow contract itself is
vendored from the upstream reference repository at a pinned commit and compiled, tested, and
deployed as-is. `src/` is intentionally empty.

See `docs/spike-results.md` (section **S9**) for the full on-chain proof, and
`docs/superpowers/specs/2026-08-05-escrow-trust-graduation-design.md` for how this piece fits into
the larger escrow → Permit2 trust-graduation design.

## Why deploy someone else's contract instead of writing one

Spike S8 found that Arc's *already-deployed* escrow was a stale build of ERC-8183 whose `fund()`
took no expected-budget argument, so a provider could raise the price after quoting and the
client's funding transaction would silently pay the higher amount — a real, on-chain,
proof-of-attack overcharge. That was a flaw in a specific stale deployment, not in the standard:
ERC-8183's prose *mandates* the guard that Arc's build omitted, and the reference implementation's
current `main` branch has it. So instead of integrating Arc's deployment, or writing our own escrow
from scratch, we vendor and deploy the reference implementation at a commit that has the guard, and
prove on real testnet transactions that it blocks the exact attack that succeeded before.

## What's vendored

| Fact | Value |
|---|---|
| Source | [`github.com/erc-8183/base-contracts`](https://github.com/erc-8183/base-contracts) |
| Licence | MIT |
| Pinned commit | `142e669c1fd318486a4628395b629f033654dd06` (2026-06-30) |
| Location | `lib/base-contracts/` (git submodule, via `forge install`) |

The guard lives in `_fund`:

```solidity
if (job.paymentToken != expectedToken) revert PaymentTokenMismatch();
if (job.budget != expectedBudget) revert BudgetMismatch();
```

Do not bump the pin without re-running `forge test` and re-checking for those two reverts — a
vendored copy without them is the stale build all over again.

## Build / test / deploy

```bash
# Build (via_ir = true; the reference implementation is ~45KB of source)
forge build

# Measure against EIP-170's 24576-byte deployed-bytecode limit
forge build --sizes | grep -i erc8183

# Run the full test suite, including the S8 front-run must-revert test
forge test -vv

# Dry run (simulation only, no broadcast)
forge script script/DeployEscrow.s.sol --rpc-url arc
forge script script/DeployEscrow.s.sol --rpc-url base_sepolia

# Deploy for real (needs DEPLOYER_PRIVATE_KEY in .env -- see below)
forge script script/DeployEscrow.s.sol --rpc-url arc --broadcast
forge script script/DeployEscrow.s.sol --rpc-url base_sepolia --broadcast
```

Deployed addresses are recorded in `deployments.json` (committed; this is public information once
deployed). The deploy script also allow-lists the chain's native USDC as a valid payment token via
`setPaymentTokenAllowed`, since the reference contract otherwise rejects `setBudget` for any token
that hasn't been explicitly allowed.

## The deployer key

`.env` (gitignored, **never commit it**) holds `DEPLOYER_PRIVATE_KEY` for a throwaway testnet key,
generated with `cast wallet new`. This key:

- Is funded with testnet USDC (Arc — Arc's gas token *is* USDC) and testnet ETH (Base Sepolia) only.
- Holds `DEFAULT_ADMIN_ROLE` and `ADMIN_ROLE` on both deployments (it's the `admin_` and `treasury_`
  passed to `initialize`). **A real (non-testnet) deployment would move this off the deployer key**
  — e.g. to a multisig — immediately after deployment. We deliberately did not do that here; it is
  out of scope for this plan and listed as such below.
- Should never be reused for anything holding real value.

## Honest framing — read this before claiming anything about this contract

- **ERC-8183 is a Draft EIP**, roughly five months old at the time this was written. Draft status
  means the interface can still change.
- **We could not verify any audit.** A search result claiming audits by Cyfrin, Nethermind, and EF
  Security did not survive checking the cited source. Treat this contract as **unaudited**.
- **Testnet only.** Nothing here is deployed, or should be deployed, to mainnet under this plan.
- **Never claim neutral arbitration while `evaluator == client`.** The contract allows the client to
  also be the job's evaluator (Mode 2, in this codebase's terminology) — in that mode, "evaluator
  approval" is just the client approving their own job, not third-party attestation. Say so
  explicitly whenever this contract's `complete()` step is described.
- **Escrow protects post-funding, not pre-funding, in the stale build; the current implementation
  fixes this.** Do not repeat the S8-era claim that ERC-8183 "protects the client from being
  overcharged after quoting" without qualifying it with *which* deployment you mean — S9 is the
  evidence that the current reference implementation, correctly deployed, does provide that
  protection.

## Explicitly out of scope for this package

- The `escrow_jobs` migration and any lifecycle engine that reads/writes this contract from the API
  (piece 2 of the trust-graduation design).
- Graduation to Permit2 (piece 3).
- Any console/UI (piece 4).
- Mainnet deployment of anything in this package.
- Moving upgrade/admin authority off the deployer key.
