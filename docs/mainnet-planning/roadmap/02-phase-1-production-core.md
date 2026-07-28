---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [roadmap, phase-1, production-core, domains]
---

# Phase 1 — Production Core

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/roadmap/00-build-sequence|Build sequence]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/assurance/01-production-core-gates|Production Core gates]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/02-canonical-kernel|Canonical kernel]]

## Objective

Implement and verify the provider-neutral authority, execution, treasury, evidence, and operations core without assuming that any one financial adapter or mainnet is safe.

## Delivery slices

### Slice 1 — Canonical state and evidence

- Shared IDs, state machines, command/event envelope, outbox, correlation, and error taxonomy.
- Typed evidence events, complete-chain verification, bundle/export, access control, retention model.

### Slice 2 — Organization and workload authority

- Invitation lifecycle, permission matrix, privileged MFA, separation of duties, access reviews.
- Workload identities, sponsors, credential rotation, attenuated delegation, agent/connection revoke.

### Slice 3 — Missions, policy, approvals, and runtime

- Mission object and lifecycle.
- Default-deny structured policy and simulation.
- Quorum/maker-checker approval and one-time grants.
- MCP/SDK/HTTP profiles with pre-egress mediation and credential broker.
- Scoped emergency epochs.
- Minimal buyer-side provider references, immutable offer snapshots, verified destinations, and delivery receipts.

### Slice 4 — Ledger and signing boundary

- Begin only after the Phase 0 custody, signer, ledger, evidence, runtime-bypass, and tenant-isolation ADR spikes are approved.
- Chart of accounts and double-entry journal.
- Budget windows, holds, corrections, refunds/reversals/disputes.
- Reconciliation cases and operator console.
- Versioned KMS/custody signer profile with maximum-loss analysis.

### Slice 5 — Operations and assurance

- Release provenance, secrets/vulnerability gates.
- SLOs, alerts, incident handling, capacity.
- Backup/PITR, isolated restore, safe reopen.
- Requirement/test/evidence manifest and automatic certificate revocation.

## Product UX required

- Guided organization and agent enrollment.
- Mission and policy composer with impact preview.
- Approval inbox with immutable action context.
- Agent/mission/provider/adapter kill controls.
- Treasury balances, reservations, journal, and reconciliation.
- Unknown-attempt recovery console.
- Evidence search, export, retention, and privacy cases.
- Release/profile status and why production is blocked.

## Exit gate

- Every universal S0/S1 requirement has fresh evidence.
- All cross-domain journeys pass their `CORE` assertions with provider execution mocked or sandboxed where necessary.
- Double-entry, unknown, evidence, tenant, and restore invariants pass.
- Independent security and architecture review closes blockers.
- Core gate result is machine-readable, sealed, independently reproducible, and invalidatable; it cannot enable production without a composite release certificate.
- No financial adapter is production-enabled solely by this phase.
