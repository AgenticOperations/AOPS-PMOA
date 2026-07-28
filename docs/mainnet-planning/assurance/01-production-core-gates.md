---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [assurance, production-core, gates, audit]
---

# Production Core Gates

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/00-corpus-governance|Corpus governance]] | [[10-Projects/Web3-Builds/agentOps/PHASE-1-NFR-CHECKLIST|Historical NFR checklist]]

## Production definition

The Production Core is the provider-neutral AOPS control system. Passing it proves that the exact release preserves identity, authority, accounting, evidence, and recovery invariants. It does not authorize a financial adapter, mainnet, jurisdiction, or tenant by itself.

## Gate severity

- `S0 — stop/revoke`: plausible unauthorized execution, duplicate money movement, ledger corruption, cross-tenant compromise, missing intervention, unrecoverable evidence, or unlawful processing. No production waiver.
- `S1 — release blocker`: required control or proof missing.
- `S2 — remediation`: bounded weakness with owner, deadline, compensating control, and risk acceptance.

Gate lifecycle:

```text
not_assessed → blocked → pass → expired
                         ↘ revoked
```

## Universal core gates

| Gate | Exit condition |
|---|---|
| Identity | Unique principals, phishing-resistant privileged MFA, tenant isolation, short-lived workload identity, sponsor and delegation proof |
| Authority | Active mission, deterministic default-deny policy, exact decisions, action-bound approvals/grants, effective kill switch |
| Runtime | Every certified path mediated, pre-policy intent, no secret exposure, SSRF/egress control, explicit bypass boundary |
| Treasury | Hold-inclusive budgets, append-only double entry, concurrent-spend safety, balanced rebuild |
| Signing | Exact grant/reservation/intent binding, isolated key profile, rotation, maximum-loss bound |
| Execution | Durable attempt and `dispatching` lease before irreversible I/O, explicit unknown, same-intent retry, no silent substitution |
| Evidence/privacy | Full journey reconstruction, tamper/gap/tail detection, export, retention, legal hold, deletion, no sensitive onchain payload |
| Operations | Signed build/provenance, vulnerability closure, SLOs, capacity, backup/restore, incident response, on-call |

## Hard blockers

- Shared live signer capable of moving unbounded aggregate customer funds.
- Mainnet default-allow policy.
- External egress before durable intent and policy.
- Spend limits that ignore outstanding reservations.
- Releasing an unknown reservation.
- Retrying unknown external work under a new key.
- Mutable or unbalanced monetary history.
- Direct provider credentials that bypass a claimed controlled path.
- Token passthrough or wrong-audience MCP access.
- Cross-tenant access in any store, queue, signer, provider, evidence, support, or backup path.
- Evidence verification that cannot detect deletion.
- Missing restore and reconciliation before reopen.
- Personal data or secrets in immutable public/onchain proof.
- Unsupported compliance or certification claims.

## Required evidence set

The Core gate evidence manifest contains:

- Source commit and signed artifact/image digest.
- Dependency lock and SBOM.
- Migration digest and balance proof.
- Policy, mission, grant, ledger, interface, and evidence schema versions.
- Runtime enforcement profile.
- Generic signer-boundary contract tests. Concrete custody/signer identity and maximum-loss analysis belong to the execution-profile gate result.
- Test and chaos run IDs.
- Two-tenant adversarial results.
- Ledger invariant and rebuild results.
- Restore, incident, and kill-switch exercises.
- Evidence-bundle independent-verifier result.
- Approvals from engineering, security, treasury, privacy, and operations.
- Issue and expiry times.

## Proposed internal thresholds

These are AOPS product requirements, not claims that an external standard mandates the exact numbers:

- Privileged roles use phishing-resistant MFA.
- Treasury, key, provider-destination, policy-widening, and production-limit changes require two people.
- Workload token lifetime is at most 15 minutes unless stricter.
- Emergency revoke denies the next new action before success returns.
- Zero known exploitable Critical or High vulnerability on a money path at release.
- Zero unbalanced postings.
- Zero unexplained monetary difference at certified daily reconciliation cutoff.
- Quarterly isolated restore meets approved RTO/RPO.
- Core evidence expires no later than 90 days and immediately after material change.

## Approval and independence

Engineering prepares evidence. Security approves identity/runtime/supply-chain controls. Treasury approves ledger/reconciliation. Privacy/legal approves data and market scope. Operations approves recovery/SLOs. No person approves their own material change.

This is an internal production authorization, not an external attestation.

## Exit criterion

The Core gate passes only when every applicable core-level `S0` and `S1` requirement has fresh evidence, every cross-domain journey passes its `CORE` assertions on the exact release candidate using deterministic mocks or approved sandboxes, no excluded path can reach production money, and independent reviewers can reproduce the evidence manifest.

The Core gate result intentionally excludes adapter-mainnet assertions. Adapter conformance, market eligibility, and the mainnet canary are separate profile gates and cannot be prerequisites for passing the provider-neutral Core gate. Production still requires the later composite release certificate.
