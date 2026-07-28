---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [mainnet, production, architecture, assurance, planning]
---

# AOPS Mainnet Planning

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/PRODUCT|Current product]] | [[10-Projects/Web3-Builds/agentOps/creative-free/README|Beyond-MVP research]] | [[10-Projects/Web3-Builds/agentOps/HANDOFF|Current handoff]]

This corpus is the normative design and assurance plan for turning the current AOPS testnet product into a production-grade control plane for autonomous agent actions and payments. It deliberately separates stable product domains, provider-specific adapters, market-specific obligations, and cross-domain journeys so that no single document becomes an unreviewable system description.

The governing flow is:

```text
principal → workload → mandate → policy → approval/grant
→ reservation → execution attempt → external outcome
→ ledger posting → reconciliation → evidence
```

AOPS is production-enabled only for an explicitly certified tuple:

```text
CORE/<release>
× EXECUTION_PROFILE/<runtime-or-financial>/<identity>/<version>/<environment>
× MARKET/<legal-entity>/<jurisdiction>/<tenant>/<use-case>
```

A passing core does not certify an adapter, mainnet, provider account, jurisdiction, or tenant use case. Testnet proof never implies mainnet proof.

## Authority and status

The corpus uses five claim classes:

| Class | Meaning |
|---|---|
| `CURRENT-SOURCE` | Behavior confirmed by exact source at a pinned commit. |
| `CURRENT-EVIDENCE` | Behavior demonstrated by a reproducible run tied to a commit and environment. |
| `TARGET` | Approved target behavior not yet implemented or verified. |
| `RESEARCH` | Externally sourced fact that may change and has a retrieval date. |
| `DECISION-REQUIRED` | An unresolved architectural, legal, provider, or product choice. |

Documents also carry one lifecycle status:

```text
draft → target → implemented → verified → production-certified
                                      ↘ revoked
```

Only a signed release certificate can grant `production-certified`. Prose, screenshots, test counts, a deployment URL, or an onchain transaction cannot grant that status.

The architecture design is complete enough for review, but empirical validation is intentionally blocked pending the three spikes in the [architecture validation gate](reference/architecture-validation-gate.md). No implementation-readiness claim is made.

## Foundations

1. [Corpus governance](00-corpus-governance.md)
2. [Product and release boundary](01-product-and-release-boundary.md)
3. [Canonical kernel](02-canonical-kernel.md)
4. [Interface, event, and error contract](03-interface-event-and-error-contract.md)
5. [Trust, tenancy, and threat model](04-trust-tenancy-and-threat-model.md)
6. [Current code reality and gap register](05-current-code-reality-and-gap-register.md)
7. [Dependency and ownership map](06-dependency-and-ownership-map.md)
8. [Operator experience and route contract](07-operator-experience-and-route-contract.md)

## Domain specifications

1. [Organization, tenancy, and human IAM](domains/01-organization-tenancy-human-iam.md)
2. [Agent and workload identity](domains/02-agent-workload-identity.md)
3. [Mandates and missions](domains/03-mandates-and-missions.md)
4. [Policy and authority](domains/04-policy-and-authority.md)
5. [Approvals, grants, and emergency controls](domains/05-approvals-grants-and-emergency-controls.md)
6. [Runtime enforcement](domains/06-runtime-enforcement.md)
7. [Provider and service commerce](domains/07-provider-and-service-commerce.md)
8. [Treasury, ledger, and reconciliation](domains/08-treasury-ledger-and-reconciliation.md)
9. [Wallet, key, signing, and custody](domains/09-wallet-key-signing-and-custody.md)
10. [Financial execution and adapters](domains/10-financial-execution-and-adapters.md)
11. [Evidence, assurance, and privacy](domains/11-evidence-assurance-and-privacy.md)
12. [Platform operations](domains/12-platform-operations.md)

## Cross-domain journeys

1. [Organization and agent onboarding](journeys/01-organization-and-agent-onboarding.md)
2. [Governed nonfinancial action](journeys/02-governed-nonfinancial-action.md)
3. [Governed paid-service purchase](journeys/03-governed-paid-service-purchase.md)
4. [Unknown outcome and recovery](journeys/04-unknown-outcome-and-recovery.md)
5. [Provider, refund, reversal, and dispute](journeys/05-provider-refund-reversal-and-dispute.md)
6. [Emergency containment](journeys/06-emergency-containment.md)
7. [Audit export, retention, and DSAR](journeys/07-audit-export-retention-and-dsar.md)

## Assurance and release

1. [Production Core gates](assurance/01-production-core-gates.md)
2. [Financial-adapter conformance standard](assurance/02-adapter-conformance-standard.md)
3. [Runtime enforcement conformance standard](assurance/02a-runtime-enforcement-conformance-standard.md)
4. [Market, tenant, and use-case profile](assurance/03-market-tenant-and-use-case-profile.md)
5. [Journey test, chaos, and recovery standard](assurance/04-journey-test-chaos-and-recovery-standard.md)
6. [Release certification and revocation](assurance/05-release-certification-and-revocation.md)

## Roadmap

1. [Build sequence](roadmap/00-build-sequence.md)
2. [Phase 0 — safety correction](roadmap/01-phase-0-safety-correction.md)
3. [Phase 1 — Production Core](roadmap/02-phase-1-production-core.md)
4. [Phase 2 — Circle mainnet profile](roadmap/03-phase-2-circle-mainnet-profile.md)
5. [Phase 3 — Arc Testnet profile](roadmap/04-phase-3-arc-testnet-profile.md)
6. [Phase 4 — provider and rail expansion](roadmap/05-phase-4-provider-and-rail-expansion.md)

## References and traceability

- [Requirement index](reference/requirement-index.md)
- `reference/requirements.jsonl` — generated catalog of all target requirements and their current traceability status.
- [Decision register](reference/decision-register.md)
- [Architecture validation gate](reference/architecture-validation-gate.md)
- [Source bibliography](reference/source-bibliography.md)
- [Research synthesis](reference/research-synthesis.md)
- `corpus-manifest.yaml` — machine-readable corpus membership, authority order, and invalidation triggers.
- `assurance/release-certificate-template.json` — schema for an enforceable core × execution-profile × market certificate.
- `research/sources.jsonl` — stable source identities.
- `research/evidence.jsonl` — append-only evidence spans.
- `research/claims.jsonl` — atomic claim-support ledger.
- `research/run_manifest.json` — research scope and run identity.

## Non-negotiable invariants

1. No external side effect occurs before a durable intent and applicable authorization.
2. No financial authorization is executable before the required budget and liquidity are reserved.
3. A post-submit timeout is `UNKNOWN`, never automatically `FAILED`.
4. Unknown attempts are neither blindly retried nor released.
5. Economic history is append-only and double-entry; correction happens through new postings.
6. A descendant agent may narrow inherited authority but cannot widen it.
7. Tenant identity derives from authenticated context, never caller-supplied object fields.
8. Credentials and private keys never enter model context, prompts, tool output, or general logs.
9. Every certified path is structurally mediated or explicitly excluded and disabled.
10. Every production claim is pinned to fresh, independently inspectable evidence.

## Current boundary

The current `BUILD-PMOA` release remains testnet-oriented. `main` at `ef4e42e` and the paid-HTTP candidate at `a0556e6` are recorded separately in the gap register. Arc Public Testnet is an explicit conformance target; this corpus does not represent Arc mainnet as currently available.
