---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [architecture, validation, spikes, blockers, anti-hallucination]
---

# Architecture Validation Gate

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/reference/decision-register|Decision register]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/roadmap/01-phase-0-safety-correction|Phase 0]]

## Gate status

```text
ARCHITECTURE DESIGN: REVIEWED
EMPIRICAL VALIDATION: BLOCKED
IMPLEMENTATION PLAN AUTHORITY: NOT GRANTED
```

The design corpus defines what must be true. It does not prove that the selected database, Circle/provider profile, signer boundary, or deployment can satisfy those requirements. Implementation planning starts only after the three spikes below pass and the remaining prerequisite ADRs consume their evidence.

## Assumption 1 — atomic financial control boundary

**Assumption:** The chosen persistence design can atomically consume one grant, create one held reservation, and create one prepared payment attempt, then durably enter `dispatching` before external I/O without making a duplicate economic effect possible across crash/retry windows.

**Risk:** A crash can leave a consumed grant without an attempt, an orphan hold, or an externally submitted request whose durable state still appears safe to retry.

**Spike plan:** In a disposable database, implement the minimal grant/reservation/payment-attempt/outbox schema and a 20–50 line harness. Inject process termination before commit, after commit, after dispatch-lease acquisition, immediately before write, immediately after write, and before acknowledgement persistence. Run repeated same-key and changed-payload cases. Prove one visible tuple before I/O, `unknown` after ambiguous emission, no new-key retry, and balanced reservation disposition.

**Required evidence:** Schema/migration digest, spike source, deterministic seeds, crash-point matrix, database rows before/after, adapter request count, and exact output.

## Assumption 2 — first Circle financial profile can enforce the required boundary

**Assumption:** One currently available Circle-supported mainnet product/profile can provide the chosen tenant/wallet/signer isolation, exact destination/amount binding, idempotent submission, authoritative lookup, finality, fee accounting, credential rotation, and recovery behavior needed by the financial-adapter contract.

**Risk:** The product may expose wallet policy or payment primitives without the signer isolation, lookup semantics, refund path, provider access, or loss bound that AOPS certification requires. The Phase 2 product would then be architecturally impossible or need a different custody/profile model.

**Spike plan:** After `ADR-MP-P01` through `P03` select one candidate, use a dedicated sandbox/testnet account and minimal funded wallet. Execute create/configure, sign/submit, duplicate same-key, changed-payload rejection, lost-response lookup, pending/finality, credential rotation/revoke, and refund/compensating-path checks. Capture actual provider responses and supported/unsupported capabilities; do not infer mainnet behavior from testnet.

**Required evidence:** Official support snapshot, account/profile IDs with secrets removed, SDK/API versions, complete requests/responses, provider/network transaction IDs, lookup results, observed idempotency window, signer maximum-loss analysis, and unresolved capability gaps.

## Assumption 3 — revocation and tenant isolation remain enforceable across boundaries

**Assumption:** The selected runtime, signer, adapter worker, cache, queue, credential broker, and assurance-store topology can reject stale certificate/emergency epochs within the target SLO while preserving tenant isolation and in-flight reconciliation during cache loss, partition, restart, and delayed invalidation.

**Risk:** A cached certificate or shared signer/provider credential may continue executing after revocation or allow one tenant's authority to cross into another tenant.

**Spike plan:** Build a minimal multi-process harness for assurance registry, runtime, signer, adapter dispatcher, cache, and queue. Issue two tenant profiles, revoke one epoch, then inject stale cache, dropped push, registry outage, worker restart, queued old command, and cross-tenant identity substitution. Prove old epochs fail closed at grant/sign/dispatch, the other tenant remains isolated, and already submitted work remains reconcilable.

**Required evidence:** Topology/config digest, epoch/acknowledgement trace, maximum observed staleness, denial results at each enforcement point, cross-tenant negative results, outage behavior, and reconciliation continuity.

## Pass/fail rule

- Every spike runs multiple times with positive and negative cases.
- A spike passes only on observed evidence; documentation or provider marketing is not execution proof.
- Any failure returns the affected ADR and dependent documents to design.
- No implementation plan or production claim is permitted while this gate remains blocked.
- Spike artifacts live under `validation/` and are linked here without embedding secrets.
