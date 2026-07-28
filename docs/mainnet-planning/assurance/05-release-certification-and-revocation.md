---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [assurance, release, certification, revocation]
---

# Release Certification and Revocation

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/assurance/01-production-core-gates|Production Core gates]] | [[10-Projects/Web3-Builds/agentOps/decision-log|Decision log]]

## Certificate tuple

Money or destructive production authority is enabled only by one valid composite `ReleaseCertificate` whose three embedded gate results are simultaneously valid:

```text
CORE/<release-digest>
EXECUTION_PROFILE/<runtime-or-financial>/<identity>/<version>/<environment>
MARKET/<entity>/<jurisdiction>/<tenant>/<use-case>
```

The runtime checks the composite certificate identity and status, not a prose document, standalone gate result, or manual environment flag. `CoreGateResult`, `ExecutionProfileGateResult`, and `MarketEligibilityResult` can be assessed independently for delivery sequencing, but none is independently production-enabling.

## Authoritative status and epoch protocol

The assurance service owns an append-only certificate registry. Every issued certificate has a scope, signed immutable body, monotonic `certificate_epoch`, and status version. Revocation writes a higher epoch for the affected scope; an older certificate can never become valid again.

Every runtime, grant issuer, signer, adapter dispatcher, and production-configuration controller must:

1. Authenticate the assurance service and verify the certificate signature.
2. Bind the exact certificate ID, scope, epoch, and expiry into its decision or request.
3. Check authoritative status at every high-risk grant, sign, and dispatch boundary.
4. Reject a certificate whose epoch is lower than the latest observed scope epoch.
5. Fail closed when status is unavailable beyond the profile's maximum staleness.
6. Persist its accepted epoch and revocation acknowledgement as evidence.

Push invalidation accelerates propagation but is not the source of truth. Each profile declares its maximum cache age; live-money signing and dispatch default to an online or strongly consistent status check. Revocation is complete only when the authoritative registry is updated, new grants are denied, signer/adapter boundaries reject the old epoch, and required enforcement components acknowledge the new epoch. A missing acknowledgement within the SLO keeps the scope stopped and opens an incident.

## Certificate fields

The JSON schema requires all functional approval roles. A certificate issuer additionally enforces the separation-of-duties matrix across principal IDs; JSON Schema presence checks alone cannot prove that the people are distinct.

```text
certificate_id
status
certificate_epoch
scope_type + scope_id
core_release_digest
core_gate_result_id + digest
policy_engine/schema version
ledger/evidence schema version
migration digest
runtime enforcement profile
signer/custody profile and key IDs
execution-profile kind/identity/version/environment/enforcement strength
execution-profile gate_result_id + digest
financial profile: adapter/provider/API/account/rail/network/chain/asset/contracts
market/entity/jurisdiction/tenant/use-case
market eligibility result_id + digest
applicable requirements and gate results
excluded paths
open S2 risks
evidence manifest digest
approvals
issued_at
expires_at
revocation conditions
signature
```

## Issue process

1. Build immutable release artifact.
2. Produce SBOM, provenance, scans, and migrations.
3. Run universal, domain, journey, security, chaos, restore, and evidence suites.
4. Produce the applicable runtime or financial execution-profile gate result.
5. For a financial mainnet profile, run a low-limit canary and reconcile it against external truth.
6. For a runtime profile, verify its exact controlled-path/bypass boundary in the target deployment.
7. Produce the market/tenant eligibility result.
8. Obtain distinct engineering, security, treasury, adapter, privacy/legal, and operations approvals.
9. Bind the three exact gate results into, sign, and publish the composite release certificate.
10. Enable minimal limits and observe.

## Automatic revocation triggers

- Authorization bypass or cross-tenant access.
- Signer/key/provider credential compromise.
- Exposure above certified loss bound.
- Unbalanced posting or unexplained reconciliation difference.
- Duplicate economic execution.
- Unknown backlog outside SLO.
- Evidence integrity or required-retention failure.
- Failed backup/restore or kill-switch drill.
- Critical exploitable vulnerability.
- Exhausted money-journey error budget.
- Material provider API, network, chain, contract, asset, facilitator, signer, policy, ledger, evidence, or deployment change.
- Invalid legal basis, provider eligibility, or tenant use case.
- Expired evidence or approvals.

Revocation pauses new authority for the affected scope. It does not delete or blindly cancel in-flight work.

## Scope of revocation

Prefer narrow safe scope:

- One connection or agent.
- One tenant.
- One provider/service.
- One financial adapter/network/asset or one runtime execution profile.
- One signer profile.
- One release.
- Global core.

Broader stop is used when the affected boundary is uncertain.

## Reissue

Reissue requires:

- Root cause and affected scope.
- Corrective change and regression test.
- Fresh dependent evidence.
- Reconciliation of all affected external work.
- Evidence integrity.
- Updated risk/loss analysis.
- Fresh approvals.
- Staged canary and limit increase.

## Requirements

- `AOPS-REL-001` (`S0`): Production enablement MUST require a valid core × execution-profile × market tuple.
- `AOPS-REL-002` (`S0`): Certificate MUST pin exact artifact, schemas, execution profile, applicable network/signer, market, and evidence.
- `AOPS-REL-003` (`S0`): Material change or S0 trigger MUST automatically revoke affected scope.
- `AOPS-REL-004` (`S0`): Revocation MUST stop new authority while preserving reconciliation.
- `AOPS-REL-005` (`S1`): Certificate and evidence MUST expire on defined schedules.
- `AOPS-REL-006` (`S0`): Reissue MUST require fresh proof and staged canary.
- `AOPS-REL-007` (`S0`): Every certificate scope MUST have a monotonic authoritative revocation epoch.
- `AOPS-REL-008` (`S0`): Grant, signer, and adapter-dispatch boundaries MUST reject stale, expired, revoked, or unverifiable certificate epochs.
- `AOPS-REL-009` (`S0`): Revocation propagation MUST be measured through component acknowledgements and fail closed beyond certified staleness.
- `AOPS-REL-010` (`S0`): Push notification or cached status MUST NOT be the sole revocation authority.
- `AOPS-REL-011` (`S0`): Certificate issuance MUST enforce required distinct principals across the approval separation-of-duties matrix.

## Exit criterion

The first production certificate is valid only when its machine-readable manifest is enforced by runtime configuration, all linked evidence is retrievable and independently verifiable, and an automatic revocation drill demonstrates that stale or failed evidence disables the profile.
