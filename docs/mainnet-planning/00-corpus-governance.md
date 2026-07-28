---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [documentation, governance, traceability, assurance]
---

# Corpus Governance

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/creative-free/README|Prior research package]] | [[10-Projects/Web3-Builds/agentOps/decision-log|Decision log]]

## Purpose

This document defines how the mainnet-planning corpus remains authoritative, reviewable, and internally consistent. It exists because locally correct domain documents can still produce a globally unsafe product when they disagree about identities, authorization, idempotency, reservations, finality, evidence, or terminal states.

The corpus is normative for future production design. It does not overwrite current code reality. Current code claims must point to the exact commit and evidence run recorded in [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/05-current-code-reality-and-gap-register|the gap register]].

## Document authority

Each document's entry in `corpus-manifest.yaml` must declare, either directly or through explicit corpus defaults:

- `document_id` and owning domain.
- Product owner, engineering owner, security owner, and required approvers.
- Lifecycle status.
- Effective date and mandatory review date.
- Exact source commit and deployed release when describing implemented behavior.
- Dependencies and dependents.
- Superseded and superseding documents.
- Applicable core, execution-profile, market, tenant, and use-case profiles.

The manifest is the machine-readable metadata authority. Markdown frontmatter supplies vault discovery metadata and must not override manifest ownership or status.

Definitions, state machines, and invariants have one owner. Other documents reference their stable IDs and may add stricter local constraints, but may not redefine them.

## Mandatory document contract

Every domain document directly contains its scope/non-ownership, product capabilities, domain objects and lifecycle, domain-specific failure behavior, normative requirement IDs, and verification/exit gate.

Cross-cutting contracts are inherited by reference rather than copied into every file:

- Actors, canonical objects, state ownership, and shared invariants: `02-canonical-kernel.md`.
- Interfaces, idempotency, ordering, replay, timeout, cancellation, and serialization: `03-interface-event-and-error-contract.md`.
- Trust boundaries, tenant isolation, abuse, privacy, and maximum-loss method: `04-trust-tenancy-and-threat-model.md`.
- Operations, SLOs, incident, recovery, and safe reopen: `domains/12-platform-operations.md`.
- Evidence, retention, deletion, legal hold, and freshness: `domains/11-evidence-assurance-and-privacy.md`.
- Dependencies, invalidation, tests, and certification: `06-dependency-and-ownership-map.md` and `assurance/`.

A domain document states only its stricter or domain-specific constraints. Silence does not waive an inherited requirement. This inheritance model prevents duplicated definitions while retaining the full contract.

The phrase “production ready” is invalid unless all applicable sections have passing evidence.

## Requirement identifiers

Requirements use:

```text
AOPS-<DOMAIN>-<NNN>
```

Examples:

- `AOPS-IAM-<NNN>`
- `AOPS-MSN-<NNN>`
- `AOPS-POL-<NNN>`
- `AOPS-LED-<NNN>`
- `AOPS-ADP-<NNN>`
- `AOPS-EVD-<NNN>`

Each implementation-ready requirement record declares:

- `MUST`, `MUST NOT`, `SHOULD`, or `MAY`.
- Applicability: universal, adapter, market, tenant, or use-case.
- Severity: `S0`, `S1`, or `S2`.
- Owning document.
- Test IDs.
- Evidence artifact types.
- Evidence validity period.
- Dependent requirements.

An orphan requirement without a test and evidence definition blocks certification. An orphan test without an owning requirement is diagnostic only.

During architecture definition, an inline requirement may be registered as `definition_only`. Phase 0 must assign its applicability, test IDs, evidence types, freshness, and dependencies before implementation begins. `definition_only` requirements are never certification-eligible.

## Claim classes

Every material statement must be identifiable as:

- `CURRENT-SOURCE`
- `CURRENT-EVIDENCE`
- `TARGET`
- `RESEARCH`
- `DECISION-REQUIRED`

Research claims must cite the official source and retrieval date. Current evidence must pin commit, build digest, migration digest, environment, adapter profile, fixture, verifier, timestamp, and expiry.

## Change and invalidation

A material change invalidates affected evidence and certificates. Material changes include:

- Identity, delegation, mandate, policy, approval, grant, or kill-switch semantics.
- Ledger schema, posting rules, reservation lifecycle, or reconciliation logic.
- Signer, KMS, custody, wallet topology, or maximum-loss boundary.
- Adapter code, provider API, webhook schema, facilitator, network, chain ID, asset address, or contract.
- Tenant-isolation, encryption, retention, deletion, or evidence behavior.
- Deployment topology, queue semantics, database failover, backup, or restore process.

Changes must identify dependent documents using [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/06-dependency-and-ownership-map|the dependency map]]. Certificates remain revoked until affected tests and evidence are regenerated.

## Mechanical quality gates

The corpus must pass:

- YAML/frontmatter and mandatory-section validation.
- Broken-link and orphan-file checks.
- Unfinished-marker and incomplete-table scan.
- Duplicate canonical-object and invariant detection.
- Requirement-to-test-to-evidence traceability.
- State transition consistency and unreachable-state review.
- Claim hygiene for “production,” “mainnet,” “compliant,” “non-custodial,” “exactly once,” and “zero loss.”
- Freshness validation for provider and ecosystem facts.
- Current-source line verification at pinned commits.
- Dependency invalidation checks.

Circular reading dependencies are permitted only for context. Circular normative ownership is forbidden.

## Compliance language

Internal control mapping does not constitute SOC 2 attestation, ISO certification, PCI attestation, regulatory approval, or legal advice. Every compliance mapping must identify the exact system boundary, control owner, evidence, collection frequency, retention, and external assessor where applicable.

## Review cadence

- Domain specifications: every 90 days or after material change.
- Policy, ledger, evidence, and adapter requirements: every 30 days.
- Daily monetary reconciliation evidence: one day.
- Provider/network facts: before each adapter release.
- Market and legal profiles: before onboarding a new market or regulated use case.
- Incident and restore evidence: after each exercise and at least quarterly.
