---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [roadmap, arc, testnet, pmoa]
---

# Phase 3 — Arc Testnet Profile

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/roadmap/03-phase-2-circle-mainnet-profile|Circle mainnet phase]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/assurance/02-adapter-conformance-standard|Adapter conformance]] | [[10-Projects/Web3-Builds/agentOps/HANDOFF|PMOA handoff]]

## Objective

Demonstrate a real Arc Public Testnet settlement path that uses the same Production Core authority, reservation, adapter, reconciliation, and evidence model.

Arc Public Testnet is the currently documented active Arc network. This phase must not claim Arc mainnet readiness.

## Arc profile

Pin and reverify:

- Arc network and chain/domain identifiers.
- Testnet USDC and relevant contract addresses.
- Circle Wallet/Gateway/Nanopayment support.
- Wallet and signer behavior.
- Gas and finality behavior.
- Facilitator/provider endpoints.
- Explorer and authoritative lookup.
- Contract or evidence-anchor deployment if used.

## Demonstration journey

1. Organization creates an Arc testnet mission and budget.
2. Agent authenticates through hosted MCP.
3. Agent requests a paid Arc-compatible service or explicit Arc action.
4. AOPS evaluates mission/policy and approval.
5. Treasury reserves testnet USDC.
6. Certified testnet adapter signs and submits.
7. External Arc state is verified.
8. Ledger records settlement.
9. Delivery/result is returned.
10. Evidence bundle links authority, payment, Arc transaction, result, and reconciliation.
11. A malicious/out-of-policy request is denied before signing.
12. A failure case shows safe hold/recovery.

## Evidence anchor

If an Arc contract anchors evidence, only a nonpersonal digest and schema/version reference are written onchain. Source evidence remains access-controlled and erasable where required. Anchoring supplements rather than replaces complete evidence.

## Exit gate

- Exact Arc testnet adapter profile passes conformance.
- At least one real Arc transaction externally verifies.
- Positive, denial, approval, and failure-safe journeys pass.
- Ledger reconciles to Arc testnet truth.
- Evidence independently verifies.
- Submission copy clearly labels testnet and separates future mainnet work.
