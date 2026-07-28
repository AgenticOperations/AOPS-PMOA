---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [requirements, traceability, index, assurance]
---

# Requirement Index

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/00-corpus-governance|Corpus governance]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/assurance/05-release-certification-and-revocation|Release certification]]

## Ownership

| Prefix | Concern | Owning document |
|---|---|---|
| `AOPS-KRN` | Canonical cross-domain invariants | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/02-canonical-kernel|Canonical kernel]] |
| `AOPS-INT` | Command, event, idempotency, and error contract | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/03-interface-event-and-error-contract|Interface contract]] |
| `AOPS-SEC` | Shared trust and tenancy | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/04-trust-tenancy-and-threat-model|Trust model]] |
| `AOPS-IAM` | Human IAM and tenancy | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/01-organization-tenancy-human-iam|Human IAM]] |
| `AOPS-WID` | Workload identity and delegation | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/02-agent-workload-identity|Workload identity]] |
| `AOPS-MSN` | Mandates and missions | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/03-mandates-and-missions|Missions]] |
| `AOPS-POL` | Policy and decisions | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/04-policy-and-authority|Policy]] |
| `AOPS-APR` | Approvals, grants, and emergency controls | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/05-approvals-grants-and-emergency-controls|Approvals]] |
| `AOPS-RUN` | Runtime enforcement | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/06-runtime-enforcement|Runtime]] |
| `AOPS-PRV` | Provider and service commerce | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/07-provider-and-service-commerce|Provider commerce]] |
| `AOPS-LED` | Treasury, ledger, and reconciliation | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/08-treasury-ledger-and-reconciliation|Ledger]] |
| `AOPS-SGN` | Wallet, key, signing, and custody | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/09-wallet-key-signing-and-custody|Signing]] |
| `AOPS-ADP` | Financial execution adapters | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/10-financial-execution-and-adapters|Adapters]] |
| `AOPS-EVD` | Evidence, assurance, and privacy | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/11-evidence-assurance-and-privacy|Evidence]] |
| `AOPS-OPS` | Platform operations | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/12-platform-operations|Operations]] |
| `AOPS-UX` | Operator experience and route behavior | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/07-operator-experience-and-route-contract|Operator experience]] |
| `AOPS-CNF` | Adapter conformance | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/assurance/02-adapter-conformance-standard|Conformance]] |
| `AOPS-RTC` | Runtime execution-profile conformance | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/assurance/02a-runtime-enforcement-conformance-standard|Runtime conformance]] |
| `AOPS-MKT` | Market/tenant/use-case profile | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/assurance/03-market-tenant-and-use-case-profile|Market profile]] |
| `AOPS-TST` | Journey, chaos, and recovery proof | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/assurance/04-journey-test-chaos-and-recovery-standard|Test standard]] |
| `AOPS-REL` | Release certification and revocation | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/assurance/05-release-certification-and-revocation|Release certification]] |

## Trace record

`requirements.jsonl` contains every inline normative requirement. At architecture stage records are deliberately `definition_only`, have empty test/evidence mappings, and are not certification-eligible. Phase 0 converts each into an implementation-ready record:

```json
{
  "requirement_id": "AOPS-LED-004",
  "owner": "treasury_ledger",
  "applicability": ["universal"],
  "severity": "S0",
  "statement": "Unknown and submitted attempts retain or quarantine reservations.",
  "dependencies": ["AOPS-ADP-003", "AOPS-INT-004"],
  "tests": ["JRN-UNKNOWN-001", "LED-RES-CHAOS-003"],
  "evidence_types": ["test_run", "ledger_snapshot", "external_lookup", "evidence_bundle"],
  "freshness_days": 30
}
```

## Traceability rules

- One document owns each requirement.
- Every S0/S1 requirement has at least one negative or failure-path test.
- Every test identifies the requirements it proves.
- Every gate result identifies exact test and evidence artifacts.
- An orphan requirement blocks certification.
- An orphan test is diagnostic and cannot grant a gate.
- Evidence expires and is invalidated by material dependency changes.
- Requirement IDs are never reused after removal; retired IDs remain reserved.

## Current scope

The corpus currently defines 181 normative requirements across the core and assurance layers. They are target requirements until Phase 0 maps them to exact code, migrations, tests, operations, and evidence. The machine catalog makes that incomplete traceability visible and computable rather than implying it already exists.
