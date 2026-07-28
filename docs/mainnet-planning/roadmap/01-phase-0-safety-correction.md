---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [roadmap, phase-0, safety, remediation]
---

# Phase 0 — Safety Correction

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/roadmap/00-build-sequence|Build sequence]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/05-current-code-reality-and-gap-register|Gap register]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/journeys/04-unknown-outcome-and-recovery|Unknown recovery]]

## Objective

Make the current candidate a safe foundation for production work. This phase does not enable mainnet.

## Required corrections

### Pre-policy egress

- Persist action intent before every outbound request.
- Apply target/method/data/effect policy before discovery.
- Create discovery idempotency record.
- Record non-402 outcomes as actual external outcomes.
- Prove policy denial causes zero egress for every method.

### Default allow

- Inventory current implicit allows.
- Add shadow default-deny mode.
- Generate explicit allow policy migration report.
- Update product claims and UI.
- Keep production profiles money-disabled until default deny is active.

### Unknown resolution

- Add durable `dispatching` lease before irreversible I/O and operator/worker reconciliation for `dispatching`, submitted, and `unknown`.
- Persist exact canonical request, provider identity, idempotency identity, signing receipt or signed-payload hash before dispatch.
- Preserve original attempt/idempotency.
- Add provider lookup and webhook evidence.
- Retain/quarantine reservation.
- Add safe manual disposition with dual approval.

### Architecture and assurance prerequisites

Before implementing the Production Core:

- Resolve `ADR-MP-P02` through `ADR-MP-P07` with empirical spikes for custody, signer isolation, ledger invariants, evidence integrity, runtime bypass, and tenant isolation.
- Publish versioned machine schemas for command/event envelopes, adapter requests/outcomes, evidence manifests, and release certificates.
- Define canonical serialization and hashing rules with cross-language fixtures.
- Generate the full requirement catalog and assign test/evidence IDs before feature code begins.
- Define the authoritative certificate registry, monotonic epoch protocol, cache-staleness bound, and enforcement acknowledgements.
- Prove the `prepared → dispatching → unknown/submitted` crash windows through a disposable adapter spike.

### Audit integrity

- Verify complete chain through canonical head.
- Detect tail deletion and sequence gaps.
- Bind verification to organization and release.
- Add evidence-completeness incident.

### Claim and environment hygiene

- Gate all QA/test fixtures.
- Remove or qualify “fail closed,” inherited authority, period-budget, immutable audit, live, and mainnet claims.
- Pin every evidence artifact to exact commit/environment.

## Required tests

- Zero egress on policy denial for `GET/POST/PUT/PATCH/DELETE`.
- Concurrent same-key discovery.
- Non-402 side-effect response.
- Crash before/after intent, policy, reservation, attempt, dispatch-lease acquisition, request emission, submit acknowledgement, and result persistence.
- Unknown lookup and manual resolution.
- Audit content mutation, missing event, fork, and tail deletion.
- Current testnet MCP/browser journey.

## Exit gate

- All existing tests plus new P0 regression and fault-injection tests pass.
- No known P0 remains on the candidate path.
- Source claims match implementation.
- Unknown attempts have an operator surface and runbook.
- Evidence verification covers the full chain.
- Release remains explicitly testnet/non-production.
- Architecture validation has no unresolved P0 and all prerequisite spikes have evidence.
