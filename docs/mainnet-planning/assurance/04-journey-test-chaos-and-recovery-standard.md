---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [assurance, tests, chaos, recovery, evidence]
---

# Journey Test, Chaos, and Recovery Standard

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/journeys/04-unknown-outcome-and-recovery|Unknown recovery journey]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/12-platform-operations|Platform operations]]

## Test hierarchy

Production evidence combines:

1. Schema and unit tests.
2. State-machine/model tests.
3. Property and mutation tests.
4. Domain integration tests.
5. Cross-domain journey tests.
6. Adapter conformance.
7. Security and tenant-isolation tests.
8. Load, soak, and capacity tests.
9. Fault injection and chaos.
10. Backup/restore and region/provider outage exercises.
11. Low-limit mainnet canary.
12. Independent evidence verification.

Passing unit and integration tests cannot substitute for the later layers.

## Mandatory journey suite

- Organization/human/agent onboarding.
- Human termination and emergency revoke.
- Governed nonfinancial action.
- Governed paid-service purchase.
- Approval substitution and race.
- Concurrent sibling agents under shared budget.
- Unknown outcome, restart, lookup, and reconciliation.
- Duplicate/out-of-order webhook.
- Refund, reversal, dispute, and partial financial result.
- Provider/network outage with no silent substitution.
- Signer/proxy compromise and certified loss bound.
- Cross-tenant attack across every layer.
- Privacy deletion with preserved nonpersonal proof.
- Backup restore with unknowns and holds.
- Adapter/network upgrade and certificate invalidation.
- External evidence verification.

## Fault-injection points

Inject crash, timeout, partition, duplicate, disorder, corruption, or denial:

- Before and after action-intent persistence.
- Before and after policy decision.
- Before and after approval/grant consumption.
- Before and after reservation.
- Before and after attempt creation.
- Before signature and after possible signature.
- Before submission and after possible provider acceptance.
- Before external outcome persistence.
- Before and after ledger posting.
- Before and after delivery return.
- Before evidence event and bundle sealing.
- During webhook and reconciliation.
- During backup and restore.

## Monetary assertions

Every relevant run asserts:

- Balanced postings.
- No duplicate economic effect.
- Holds included in limits.
- Unknown hold retained.
- Correct fee/refund/reversal/dispute entries.
- External and internal truth reconciled.
- Zero unexplained difference.

## Evidence for each run

Every run records:

- Run ID and deterministic seed.
- Source commit, build/image, migrations, policy and schema digests.
- Domain requirement versions.
- Core/adapter/market profile.
- Tenant and fixtures without secret payload.
- Actor, mission, decision, approval, grant, reservation, attempt, and ledger IDs.
- Ordered transitions and timestamps.
- External identifiers and lookup.
- Assertion result.
- Evidence-bundle digest and verifier version.
- Capture time and expiry.

## Recovery standard

Quarterly isolated restore must:

- Meet signed RTO/RPO.
- Recover original idempotency identities.
- Rebuild ledger balances.
- Restore reservations and unknown attempts.
- Verify evidence integrity.
- Reconcile external truth.
- Apply deletion tombstones.
- Keep money disabled until post-restore canary passes.

## Requirements

- `AOPS-TST-001` (`S0`): Every S0 requirement MUST have negative and failure-path proof.
- `AOPS-TST-002` (`S0`): Money journeys MUST be fault-injected at every ambiguity boundary.
- `AOPS-TST-003` (`S0`): Cross-tenant coverage MUST include every data and execution layer.
- `AOPS-TST-004` (`S0`): Restore MUST prove financial and evidence continuity.
- `AOPS-TST-005` (`S1`): Test evidence MUST pin exact release/profile and expire.
- `AOPS-TST-006` (`S0`, `FINANCIAL_MAINNET`): A financial mainnet profile canary MUST externally reconcile before that profile's limit increases.

## Exit criterion

No applicable S0/S1 requirement is accepted based only on source inspection or happy-path tests. The exact scope passes its applicable gates: Core requires domain, `CORE` journey, chaos, restore, and evidence-verifier proof; runtime profiles additionally require runtime conformance; financial profiles additionally require adapter conformance and, for mainnet, an externally reconciled canary; market scope additionally requires market/tenant eligibility.
