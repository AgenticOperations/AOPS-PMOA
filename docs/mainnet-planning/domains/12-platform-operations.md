---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [domain, sre, operations, recovery, deployment]
---

# Platform Operations

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/11-evidence-assurance-and-privacy|Evidence and assurance]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/deployment/hosted-mcp|Current deployment guidance]]

## Scope and ownership

This domain owns release engineering, deployment topology, configuration, migrations, service identities, observability, SLOs, capacity, queues, backups, restoration, failover, incidents, on-call, change management, vulnerability management, supply-chain provenance, and safe reopen.

It does not own domain business decisions, but it can stop any production profile whose operating envelope is no longer safe.

## Required product capabilities

- Reproducible signed builds and immutable image digests.
- SBOM, dependency inventory, provenance, secret scanning, and vulnerability gates.
- Environment-specific configuration and secret versioning.
- Migration locks, forward/backward compatibility, rollback, and balance proof.
- Multi-availability-zone database, queue, cache, and object storage as required by approved RTO/RPO.
- Worker idempotency, leader election, leases, dead-letter handling, and replay tooling.
- Health, readiness, dependency, and money-readiness endpoints.
- Metrics, logs, traces, profiles, audit events, and cost/capacity telemetry.
- Product-journey SLOs and error budgets.
- Alert routing, escalation, status communication, and incident command.
- Backup, PITR, isolated restore, region-loss recovery, and safe money reopen.
- Feature flags and progressive limits.
- Provider/network outage controls.
- Customer support tooling with restricted access.

## Product SLOs

API uptime alone is insufficient. Production tracks:

- Correct authorization-decision rate.
- Policy evaluation latency.
- Emergency revocation propagation.
- Reservation and ledger availability.
- Duplicate-free economic execution.
- Unknown-attempt resolution latency.
- Reconciliation freshness.
- Evidence completeness and export availability.
- Approval notification and operator response.
- Paid-service end-to-end success and delivery.

SLO targets are chosen from a business-impact analysis and certified profile. Error-budget exhaustion automatically pauses limit increases and may revoke money traffic.

### Minimum measurable SLO contract

These are initial internal floors; an adapter or market profile may be stricter. Each measurement excludes only predeclared maintenance or test fixtures and records the exclusion as evidence.

| SLI | Numerator / denominator and window | Stop or revoke action |
|---|---|---|
| Correct authorization | Correct deterministic decisions / all evaluated production actions, continuously and over 30 days | Any confirmed unauthorized allow is an immediate S0 revocation |
| Revocation propagation | Revoked epochs rejected by every runtime, signer, and adapter boundary; p99 measured over each drill and rolling 30 days | Any acceptance after the certified maximum staleness immediately stops the affected scope |
| Reservation/ledger availability | Successful invariant-preserving hold/post operations / valid requests over 30 days | Failure is fail-closed; sustained miss exhausts error budget and pauses money traffic |
| Duplicate-free execution | Intents with at most one economic effect / all submitted intents, continuously | Any confirmed duplicate is immediate S0 revocation |
| Unknown resolution | Unknown attempts resolved within adapter-certified threshold / all unknown attempts over 7 and 30 days | Breach pauses new submissions for the affected adapter/tenant until backlog and cause are controlled |
| Reconciliation freshness | Certified external accounts reconciled by declared cutoff / all accounts due each day | Missed cutoff blocks limit increases; two consecutive misses or unexplained difference stop the profile |
| Evidence completeness | Journeys with complete required evidence / all governed journeys, continuously | Missing required evidence blocks or revokes affected certification |
| Restore readiness | Isolated restore drills meeting approved RTO/RPO / scheduled quarterly drills | Failed or stale drill revokes the affected production certificate |

Each profile must record exact numeric targets, observation source, aggregation, maximum cache age, alert threshold, multi-window burn rate, owner, and runbook. “May revoke” is not used for S0 conditions: an S0 breach automatically stops or revokes the affected scope.

## Deployment and data

The initial modular-monolith deployment may retain shared infrastructure, but every domain has explicit schema ownership, service identity, queue contract, and resource limit. Separation into microservices occurs only when scaling, isolation, ownership, or regulatory needs justify the operational cost.

Production data stores require:

- Encryption in transit and at rest.
- Tenant-aware access paths.
- PITR and immutable backup policy.
- Tested restore.
- Migration and ledger balance validation.
- Regional and retention profile.
- Capacity and vacuum/maintenance plan.

## Incident lifecycle

```text
detected → triaged → contained → eradicated → recovered → reviewed → closed
```

Incidents preserve evidence integrity and affected profile identity. Containment distinguishes new authority from in-flight financial resolution.

Incident classes include:

- Unauthorized access or cross-tenant exposure.
- Key/signer/provider credential compromise.
- Policy bypass or wrong decision.
- Ledger imbalance or unexplained reconciliation difference.
- Duplicate or unknown payment backlog.
- Evidence integrity or retention failure.
- Provider/network behavior change.
- Restore/failover failure.
- Critical supply-chain vulnerability.

## Recovery and safe reopen

Restore procedure:

1. Restore data and service configuration in isolation.
2. Verify migration and release digests.
3. Rebuild ledger projections and check balance invariants.
4. Recover reservations, idempotency records, attempts, grants, and evidence links.
5. Reconcile submitted and unknown external work.
6. Verify tenant isolation and signer configuration.
7. Run smoke and canary journeys with money disabled or strictly capped.
8. Obtain reopen approval and increase limits in stages.

Traffic never resumes merely because processes are healthy.

## Failure behavior

- Queue duplicates: consumers are idempotent.
- Queue loss or poison message: dead-letter and reconcile source records.
- Database failover: no split-brain posting or grant consumption.
- Cache loss: no widening of authority.
- Region loss: restore within approved RTO/RPO and reconcile before reopen.
- Dependency outage: stop affected path; no silent provider substitution.
- Critical vulnerability: revoke affected certificate and patch through signed release.
- Telemetry outage: high-risk money profile degrades or stops according to explicit policy.

## Requirements

- `AOPS-OPS-001` (`S0`): Production artifacts MUST be reproducible, signed, and provenance-linked.
- `AOPS-OPS-002` (`S0`): No known exploitable Critical or High issue MAY remain on a money path at release.
- `AOPS-OPS-003` (`S0`): Backup and isolated restore MUST meet approved RTO/RPO.
- `AOPS-OPS-004` (`S0`): Restore MUST recover reservations, attempts, idempotency, ledger, and evidence before reopen.
- `AOPS-OPS-005` (`S1`): Product-journey SLOs and error budgets MUST govern rollout.
- `AOPS-OPS-006` (`S0`): Incidents MUST preserve in-flight reconciliation while stopping new authority.
- `AOPS-OPS-007` (`S1`): Queues and workers MUST tolerate duplicates, disorder, crashes, and replay.
- `AOPS-OPS-008` (`S0`): Material provider, network, signer, or release change MUST invalidate certification.
- `AOPS-OPS-009` (`S0`): Every production SLI MUST define numerator, denominator, window, exclusions, threshold, burn-rate action, owner, and runbook.

## Verification and exit gate

- Signed build, SBOM, provenance, and migration digest.
- Secret/dependency/image scans and penetration-test closure.
- Load, soak, backpressure, and capacity tests.
- Database/queue/cache/object-store failover.
- Worker crash and duplicate/reorder suite.
- Quarterly isolated restore against approved RTO/RPO.
- Region/provider outage tabletop.
- On-call page and escalation evidence.
- Kill-switch and alternate-communication drill.
- Staged mainnet canary and rollback.
- Post-incident review with tracked remediation.
