# ERC-8183 Escrow Contract Deployment Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the current ERC-8183 reference implementation — the one carrying the front-running guard — to Arc testnet and Base Sepolia, and prove on-chain that it blocks the exact attack that succeeded against Arc's stale deployment in spike S8.

**Architecture:** We author **no** payment logic. The MIT-licensed reference implementation is vendored as a pinned Foundry dependency, compiled locally, tested against the S8 attack scenario, then deployed as UUPS implementation + ERC-1967 proxy on both chains. The acceptance test is not "it compiles" — it is a real transaction on a real testnet that **reverts** where S8's equivalent transaction succeeded in overcharging.

**Tech Stack:** Foundry (already installed at `~/.foundry/bin`), Solidity `^0.8.28`, OpenZeppelin upgradeable contracts (transitively via the reference repo), viem for post-deploy verification scripts.

**Design doc:** `docs/superpowers/specs/2026-08-05-escrow-trust-graduation-design.md`

---

## Context you need before starting

**Read the design doc first.** This plan builds only **piece 1** of four. Pieces 2–4 (lifecycle engine, graduation, console) are separate plans.

### Why we are deploying rather than writing

Spike S8 demonstrated a real overcharge against Arc's deployed escrow: the provider raised the budget from 0.02 to 0.04 USDC after quoting, and the client's `fund()` silently paid the higher amount. Real transactions:

| What | Tx |
|---|---|
| Provider front-runs `setBudget(jobId, 40000, 0x)` | `0x1caff24388f1797ef3631c88f391bdd3bf0f79148abd232289f029c1ac63af9e` |
| Client `fund(jobId, 0x)` pays 40000, not 20000 | `0x0907ac70b8b542a780b8f42630da30e5e8a00c9b510c7c7d3ba06db5d2f2e2a2` |

That was **not** a flaw in the standard. Arc's deployment (`0x0747EEf0706327138c69792bF28Cd525089e4583`) is a **stale build** exposing `fund(uint256,bytes)` (`0xe25ba707`). The current reference implementation exposes:

```solidity
function fund(
    uint256 jobId,
    address expectedToken,
    uint256 expectedBudget,
    bytes calldata optParams
) external whenNotPaused nonReentrant
```

with, inside `_fund`:

```solidity
if (job.paymentToken != expectedToken) revert PaymentTokenMismatch();
if (job.budget != expectedBudget) revert BudgetMismatch();
```

It guards the **token** as well as the budget — stronger than the EIP prose requires.

### Pinned facts (verified 2026-08-05, do not re-derive)

| Fact | Value |
|---|---|
| Reference repo | `github.com/erc-8183/base-contracts`, **MIT** |
| Pinned commit | `142e669c1fd318486a4628395b629f033654dd06` (2026-06-30) |
| Build tool of that repo | Foundry (`foundry.toml`, `lib/` submodules, own `test/`) |
| Solidity | `pragma ^0.8.28` |
| Contract base | `Initializable, AccessControlUpgradeable, PausableUpgradeable, ReentrancyGuardTransient, UUPSUpgradeable, EIP712Upgradeable` |
| Arc testnet | chainId **5042002** (`0x4cef52`), RPC `https://rpc.testnet.arc.network` |
| Arc USDC | `0x3600000000000000000000000000000000000000` — **Arc's gas token is USDC**, no separate native asset |
| Base Sepolia | chainId **84532** (`0x14a34`), RPC `https://sepolia.base.org` |
| Base Sepolia USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| EIP-170 deployed-bytecode limit | **24576 bytes** |

### Selectors (computed and cross-checked against S8's independently derived values)

| Selector | Signature | Note |
|---|---|---|
| `0x1f989ec8` | `fund(uint256,address,uint256,bytes)` | **guarded — what we must see in our deployment** |
| `0xe25ba707` | `fund(uint256,bytes)` | unguarded — what Arc's stale build has |
| `0xf3302b89` | `setBudget(uint256,address,uint256,bytes)` | |
| `0xbaf3ede2` | `createJob(address,address,uint48,string,address,uint256)` | |
| `0x9e63798d` | `submit(uint256,bytes32,bytes)` | |
| `0xd75bbdf3` | `complete(uint256,bytes32,bytes)` | |
| `0xbf22c457` | `getJob(uint256)` | |

### Naming

`packages/contracts` is **already taken** by a TypeScript/zod package. The Foundry project goes in **`packages/onchain`**.

### Honest framing to preserve

ERC-8183 is a **Draft** EIP, roughly five months old. **We could not verify any audit** — a search result claiming audits by Cyfrin/Nethermind/EF Security did not survive checking the cited source. Testnet only. Never claim neutral arbitration while `evaluator == client`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/onchain/foundry.toml` | Foundry config: solc version, optimizer, remappings, RPC endpoints | **Create** |
| `packages/onchain/.gitignore` | Ignore `out/`, `cache/`, `broadcast/`, `.env` | **Create** |
| `packages/onchain/lib/erc8183/` | Vendored reference impl, pinned submodule | **Create** (via `forge install`) |
| `packages/onchain/test/FrontRunGuard.t.sol` | The S8 attack, as a must-revert test | **Create** |
| `packages/onchain/test/Lifecycle.t.sol` | Happy path `Open → Funded → Submitted → Completed` | **Create** |
| `packages/onchain/script/DeployEscrow.s.sol` | UUPS impl + proxy + initialize | **Create** |
| `packages/onchain/deployments.json` | Recorded addresses per chain | **Create** |
| `packages/onchain/README.md` | What this is, how to build/test/deploy, honest caveats | **Create** |
| `scripts/spikes/s9-escrow-guard-proof.mjs` | Post-deploy on-chain proof the attack reverts | **Create** |
| `docs/spike-results.md` | Record the S9 proof | Modify |

---

## Chunk 1: Foundry workspace and vendored reference

### Task 1: Scaffold the Foundry project

**Files:**
- Create: `packages/onchain/foundry.toml`
- Create: `packages/onchain/.gitignore`

- [ ] **Step 1: Create the directory and initialise Foundry without a template**

```bash
cd /Users/kaushalchaudhari/Desktop/web3/AgentOps-build/AOPS-PMOA
mkdir -p packages/onchain
cd packages/onchain
forge init --no-git --no-commit --force .
```

Expected: creates `src/`, `test/`, `script/`, `lib/forge-std`.

- [ ] **Step 2: Remove the scaffold's placeholder contract and tests**

```bash
rm -f src/Counter.sol test/Counter.t.sol script/Counter.s.sol
```

We ship no contracts of our own — `src/` stays empty by design.

- [ ] **Step 3: Write `foundry.toml`**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"
solc = "0.8.28"
optimizer = true
optimizer_runs = 200
via_ir = true
# EIP-170. Fail the build rather than discover this at deploy time.
bytecode_hash = "none"

[profile.default.rpc_endpoints]
arc = "https://rpc.testnet.arc.network"
base_sepolia = "https://sepolia.base.org"
```

`via_ir = true` is deliberate: the reference implementation is ~45KB of source and may not fit under EIP-170 without it. Task 3 measures this.

- [ ] **Step 4: Write `.gitignore`**

```
out/
cache/
broadcast/
.env
```

- [ ] **Step 5: Commit**

```bash
cd /Users/kaushalchaudhari/Desktop/web3/AgentOps-build/AOPS-PMOA
git add packages/onchain/foundry.toml packages/onchain/.gitignore packages/onchain/lib/forge-std
git commit -m "chore(onchain): scaffold Foundry workspace for ERC-8183 deployment"
```

---

### Task 2: Vendor the reference implementation at a pinned commit

**Files:**
- Create: `packages/onchain/lib/erc8183/` (submodule)

- [ ] **Step 1: Install the reference repo pinned to the exact commit**

```bash
cd /Users/kaushalchaudhari/Desktop/web3/AgentOps-build/AOPS-PMOA/packages/onchain
forge install erc-8183/base-contracts@142e669c1fd318486a4628395b629f033654dd06 --no-commit
```

Expected: `lib/base-contracts/` appears containing `contracts/ERC8183.sol`.

- [ ] **Step 2: Verify the pin took, and that the guard is present in the source**

```bash
cd packages/onchain/lib/base-contracts && git rev-parse HEAD
```

Expected exactly: `142e669c1fd318486a4628395b629f033654dd06`

```bash
grep -n "BudgetMismatch\|PaymentTokenMismatch" contracts/ERC8183.sol
```

Expected: at least one `revert BudgetMismatch();` and one `revert PaymentTokenMismatch();`

**STOP if either check fails.** A vendored copy without those reverts is the stale build and must not be deployed.

- [ ] **Step 3: Confirm the licence is MIT**

```bash
head -5 contracts/ERC8183.sol && head -3 LICENSE
```

Expected: `// SPDX-License-Identifier: MIT`

- [ ] **Step 4: Add remappings so the reference's own imports resolve**

Append to `packages/onchain/foundry.toml` under `[profile.default]`:

```toml
remappings = [
  "erc8183/=lib/base-contracts/contracts/",
  "forge-std/=lib/forge-std/src/",
]
```

The reference repo has its own `lib/` submodules for OpenZeppelin. If `forge build` reports unresolved OZ imports in Task 3, run `git submodule update --init --recursive` inside `lib/base-contracts` and add the matching remapping rather than installing a second copy of OpenZeppelin.

- [ ] **Step 5: Commit**

```bash
cd /Users/kaushalchaudhari/Desktop/web3/AgentOps-build/AOPS-PMOA
git add packages/onchain/.gitmodules packages/onchain/lib packages/onchain/foundry.toml
git commit -m "chore(onchain): vendor ERC-8183 reference implementation at 142e669c"
```

---

### Task 3: Build and measure against EIP-170

**Files:** none created — this is a gate.

- [ ] **Step 1: Build**

```bash
cd packages/onchain && forge build
```

Expected: compiles clean. If OZ imports fail, apply the submodule fix from Task 2 Step 4.

- [ ] **Step 2: Measure deployed bytecode size**

```bash
forge build --sizes | grep -i erc8183
```

Expected: the `ERC8183` runtime size is reported and is **under 24576 bytes**.

- [ ] **Step 3: If it exceeds 24576 bytes, escalate before continuing**

Do **not** silently start deleting features from the reference implementation — that would forfeit the whole reason we are deploying it. Options, in order of preference: raise `optimizer_runs` down to `1` (optimises for size), confirm `via_ir = true` is active, then report to the user. Record the measured size either way.

- [ ] **Step 4: Commit if config changed**

```bash
git add packages/onchain/foundry.toml
git commit -m "chore(onchain): tune optimizer to fit ERC-8183 under EIP-170"
```

---

## Chunk 2: Prove the guard locally

### Task 4: The S8 attack, as a must-revert test

This is the most important test in the plan. It replays exactly what succeeded against Arc and asserts it now fails.

**Files:**
- Create: `packages/onchain/test/FrontRunGuard.t.sol`

- [ ] **Step 1: Read the vendored source and record the real initializer and roles**

```bash
cd packages/onchain/lib/base-contracts
grep -n "function initialize" contracts/ERC8183.sol
grep -n "bytes32 public constant.*ROLE" contracts/ERC8183.sol
grep -n "struct Job\b" -A 16 contracts/ERC8183.sol
```

Write down the exact `initialize(...)` signature, any required roles, and the `Job` field order. **Do not guess these** — the deploy script and tests both depend on them, and the plan deliberately does not hardcode a signature it has not read.

- [ ] **Step 2: Write the failing test**

Use the reference repo's own ERC-20 mock if one exists under `lib/base-contracts/contracts/mocks/`; otherwise use `forge-std`'s. Adjust the `initialize` call to match what Step 1 found.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC8183} from "erc8183/ERC8183.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract FrontRunGuardTest is Test {
    ERC8183 escrow;
    MockUSDC usdc;

    address client   = address(0xC1);
    address provider = address(0xB0);

    uint256 constant QUOTED    = 20_000; // 0.02 USDC, as in S8
    uint256 constant FRONT_RUN = 40_000; // 0.04 USDC, as in S8

    function setUp() public {
        usdc = new MockUSDC();
        ERC8183 impl = new ERC8183();
        // NOTE: replace with the real initialize signature found in Task 4 Step 1
        bytes memory init = abi.encodeCall(ERC8183.initialize, (address(this)));
        escrow = ERC8183(address(new ERC1967Proxy(address(impl), init)));
        usdc.mint(client, 1_000_000);
    }

    /// The exact S8 scenario. On Arc's stale build this SUCCEEDED and
    /// overcharged the client by 0.02 USDC. Here it must revert.
    function test_frontRunBudgetRaise_reverts() public {
        vm.prank(client);
        uint256 jobId = escrow.createJob(
            provider, client, uint48(block.timestamp + 1 days), "guard proof", address(0), 0
        );

        vm.prank(client);
        escrow.setBudget(jobId, address(usdc), QUOTED, "");

        // Client approves ONLY the quoted amount -- belt and braces (D-6).
        vm.prank(client);
        usdc.approve(address(escrow), QUOTED);

        // Provider front-runs, raising the budget while still Open.
        vm.prank(provider);
        escrow.setBudget(jobId, address(usdc), FRONT_RUN, "");

        // Client funds believing the price is still QUOTED.
        vm.prank(client);
        vm.expectRevert(); // BudgetMismatch()
        escrow.fund(jobId, address(usdc), QUOTED, "");

        // And nothing moved.
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow must hold nothing");
        assertEq(usdc.balanceOf(client), 1_000_000, "client must be untouched");
    }

    /// Second line of defence: even funding AT the raised budget fails,
    /// because the client only ever approved the quoted amount.
    function test_exactAllowanceBlocksRaisedBudget() public {
        vm.prank(client);
        uint256 jobId = escrow.createJob(
            provider, client, uint48(block.timestamp + 1 days), "allowance proof", address(0), 0
        );
        vm.prank(client);
        escrow.setBudget(jobId, address(usdc), QUOTED, "");
        vm.prank(client);
        usdc.approve(address(escrow), QUOTED);

        vm.prank(provider);
        escrow.setBudget(jobId, address(usdc), FRONT_RUN, "");

        vm.prank(client);
        vm.expectRevert(); // ERC20 insufficient allowance
        escrow.fund(jobId, address(usdc), FRONT_RUN, "");
    }
}
```

- [ ] **Step 3: Run it and verify it fails for the right reason first**

```bash
cd packages/onchain && forge test --match-contract FrontRunGuardTest -vv
```

Expected initially: compile errors or a signature mismatch. Fix against the real ABI from Step 1 — **not** by loosening the assertions.

- [ ] **Step 4: Run until green**

```bash
forge test --match-contract FrontRunGuardTest -vvv
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/onchain/test/FrontRunGuard.t.sol
git commit -m "test(onchain): prove ERC-8183 guard blocks the S8 front-run"
```

---

### Task 5: Happy-path lifecycle test

**Files:**
- Create: `packages/onchain/test/Lifecycle.t.sol`

- [ ] **Step 1: Write the test**

Walk `createJob → setBudget → approve(exact) → fund → submit → complete`, asserting: escrow holds the budget after `fund`; the provider receives it after `complete`; and `getJob(jobId)` reports the expected terminal status.

- [ ] **Step 2: Run**

```bash
forge test --match-contract LifecycleTest -vv
```

Expected: PASS.

- [ ] **Step 3: Run the whole suite**

```bash
forge test -vv
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/onchain/test/Lifecycle.t.sol
git commit -m "test(onchain): cover the ERC-8183 happy path lifecycle"
```

---

## Chunk 3: Deploy

### Task 6: Deployer key and funding

**This task needs a human.** Do not attempt to work around it.

- [ ] **Step 1: Generate a throwaway testnet deployer**

```bash
cast wallet new
```

Record the address; put the private key in `packages/onchain/.env` as `DEPLOYER_PRIVATE_KEY=0x...`. `.env` is gitignored — **never commit it**, and never reuse this key for anything holding real value.

- [ ] **Step 2: Fund it on both chains**

| Chain | Needs | Why |
|---|---|---|
| Arc testnet | **USDC** | Arc's gas token *is* USDC |
| Base Sepolia | **ETH** | standard gas |

Existing Circle wallets can fund it — `0xD7E0B42A09399E29b2e84fbEa02382ba2715d551` holds USDC on both chains and a $31.94 Arc Gateway balance. Deploying a ~24KB contract is far more gas than the 132,532 used by the Gateway mint, so fund generously: aim for ≥0.01 ETH on Base Sepolia and ≥5 USDC on Arc.

- [ ] **Step 3: Confirm funding landed before proceeding**

```bash
cast balance <DEPLOYER> --rpc-url base_sepolia
cast call 0x3600000000000000000000000000000000000000 "balanceOf(address)(uint256)" <DEPLOYER> --rpc-url arc
```

**STOP and report to the user if either is zero.**

---

### Task 7: Deployment script

**Files:**
- Create: `packages/onchain/script/DeployEscrow.s.sol`

- [ ] **Step 1: Write the script**

Deploy implementation, then `ERC1967Proxy` with the initializer found in Task 4 Step 1, then log both addresses. Keep the admin/upgrade authority on the deployer for testnet, and note in the README that a real deployment would move it.

- [ ] **Step 2: Dry run against a local fork of Arc**

```bash
cd packages/onchain
forge script script/DeployEscrow.s.sol --rpc-url arc --sender <DEPLOYER>
```

Expected: simulation succeeds and prints a gas estimate. No broadcast yet.

- [ ] **Step 3: Deploy to Arc testnet**

```bash
forge script script/DeployEscrow.s.sol --rpc-url arc --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

Record the **proxy** address — that is the escrow address the rest of the system uses.

- [ ] **Step 4: Deploy to Base Sepolia**

```bash
forge script script/DeployEscrow.s.sol --rpc-url base_sepolia --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

- [ ] **Step 5: Record both addresses**

Write `packages/onchain/deployments.json`:

```json
{
  "arc-testnet":  { "chainId": 5042002, "proxy": "0x...", "implementation": "0x...", "usdc": "0x3600000000000000000000000000000000000000" },
  "base-sepolia": { "chainId": 84532,   "proxy": "0x...", "implementation": "0x...", "usdc": "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/onchain/script/DeployEscrow.s.sol packages/onchain/deployments.json
git commit -m "feat(onchain): deploy ERC-8183 reference escrow to Arc and Base Sepolia"
```

---

## Chunk 4: Prove it on-chain

### Task 8: S9 — the guard proof against the real deployment

Local tests prove our compile. This proves the **deployment**. It is the artifact that closes S8.

**Files:**
- Create: `scripts/spikes/s9-escrow-guard-proof.mjs`

- [ ] **Step 1: Verify the deployed bytecode exposes the guarded selector**

```bash
cast code <ARC_PROXY> --rpc-url arc | grep -c 1f989ec8
```

Since this is a UUPS proxy, the selector lives in the **implementation**, so check that address. Expected: the guarded `fund` selector `0x1f989ec8` is **present**, and the stale `0xe25ba707` is **absent**.

- [ ] **Step 2: Write the spike script**

Mirror the S8 scenario against our Arc deployment with two real funded wallets: create a job, set budget 20000, approve exactly 20000, front-run `setBudget` to 40000 from the provider, then call `fund(jobId, usdc, 20000, "0x")` from the client and **expect the transaction to revert**.

Record every tx hash, including the reverted one.

- [ ] **Step 3: Run it**

```bash
cd /Users/kaushalchaudhari/Desktop/web3/AgentOps-build/AOPS-PMOA/apps/api
node --env-file=.env ../../node_modules/.bin/tsx ../../scripts/spikes/s9-escrow-guard-proof.mjs
```

Expected: the `fund` transaction **reverts**, and the client's USDC balance is unchanged.

- [ ] **Step 4: Verify the balances independently**

Do not trust the script's own return value — read balances from the RPC before and after, exactly as the Gateway mint proof did.

- [ ] **Step 5: Commit**

```bash
git add scripts/spikes/s9-escrow-guard-proof.mjs
git commit -m "chore(spike): prove the deployed escrow reverts the S8 front-run"
```

---

### Task 9: Record the result

**Files:**
- Modify: `docs/spike-results.md`
- Create: `packages/onchain/README.md`

- [ ] **Step 1: Add an S9 section to `docs/spike-results.md`**

Include: both deployment addresses, the pinned commit, the measured bytecode size, the reverted `fund` tx hash, and a direct before/after against S8's `0x0907ac70…` which succeeded in overcharging. State plainly that S8's failure was a stale deployment, not a flaw in the standard.

- [ ] **Step 2: Write `packages/onchain/README.md`**

Cover: what this package is, that we author no contracts, the pinned commit and licence, build/test/deploy commands, the deployer-key caveat, and the honest framing — **Draft EIP, no verified audit, testnet only, never claim neutral arbitration while `evaluator == client`**.

- [ ] **Step 3: Commit**

```bash
git add docs/spike-results.md packages/onchain/README.md
git commit -m "docs: record S9 escrow guard proof and onchain package README"
```

---

## Done Criteria

- [ ] `forge test` passes, including the S8 front-run must-revert test
- [ ] Deployed bytecode measured and confirmed under EIP-170's 24576 bytes
- [ ] Vendored source pinned to `142e669c…` and confirmed to contain `BudgetMismatch` / `PaymentTokenMismatch`
- [ ] Escrow proxy deployed and recorded on **both** Arc testnet and Base Sepolia
- [ ] The implementation exposes `0x1f989ec8` (guarded `fund`) and **not** `0xe25ba707`
- [ ] A real on-chain transaction reverts the exact attack that S8's `0x0907ac70…` completed successfully
- [ ] `deployments.json` committed; `.env` **not** committed

## Explicitly out of scope

- The `escrow_jobs` migration and lifecycle engine (piece 2)
- Graduation to Permit2 (piece 3)
- Console UI (piece 4)
- Mainnet deployment of anything
- Moving upgrade authority off the deployer key
