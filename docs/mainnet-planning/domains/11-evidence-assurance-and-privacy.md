---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [domain, evidence, audit, privacy, retention]
---

# Evidence, Assurance, and Privacy

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/00-corpus-governance|Corpus governance]] | [[10-Projects/Web3-Builds/agentOps/creative-free/10-objective-completion-audit|Prior audit design]]

## Scope and ownership

This domain owns typed evidence events, ordering, integrity, evidence bundles, export, independent verification, anchoring, retention, legal hold, deletion/DSAR execution, evidence access, and control evidence.

It does not own the underlying business state. Every source domain remains responsible for producing complete and correct facts.

## Evidence objective

For any governed journey, an authorized independent reviewer must reconstruct:

```text
principal → delegation → mission → policy decision
→ approval/grant → reservation → signer → adapter attempt
→ external outcome → delivery → ledger posting
→ reconciliation → incident/exception → final disposition
```

Evidence proves provenance, authority, process, and recorded external truth. It does not automatically prove that an AI-generated answer was factually correct or that a business objective succeeded.

## Required product capabilities

- Canonical typed event ingestion from every domain.
- Per-aggregate sequence and organization-wide checkpoint.
- Hash/integrity chain with deletion and tail-truncation detection.
- Signed release/service identity on evidence.
- Time synchronization and clock-skew monitoring.
- Evidence completeness rules per journey.
- Encrypted sensitive payload store separated from immutable metadata.
- Evidence bundle creation and detached signature.
- External verifier and judge/auditor proof package.
- SIEM, webhook, and bulk export.
- Role- and purpose-based evidence access.
- Retention schedules, legal hold, deletion, backup expiry, and DSAR.
- Optional onchain commitment of nonpersonal digests.
- Control-evidence freshness and certificate invalidation.

## Evidence record

An event includes:

- Event and aggregate identity.
- Tenant, actor, subject, sponsor, and delegation chain.
- Mission and policy version.
- Command, request hash, correlation, and causation.
- Previous and resulting state.
- Grant, reservation, attempt, journal, provider, and external identifiers.
- Producer release, schema, environment, and time.
- Data classification and retention class.
- Canonical body hash, previous hash, event hash, and signature/checkpoint.

Sensitive payload is separately encrypted and referenced. General logs contain only minimized metadata.

## Integrity model

Production integrity must detect:

- Content modification.
- Event insertion.
- Missing middle event.
- Tail truncation.
- Head replacement.
- Sequence fork.
- Cross-tenant event substitution.
- Producer identity forgery.

An application database administrator must not be able to rewrite both evidence and its independent proof without detection. Options include signed checkpoints, independent append-only/WORM storage, external transparency log, or nonpersonal onchain commitment.

## Privacy model

Evidence metadata and erasable payload are separated.

The system never writes these onchain or into irreversible public proof:

- Names, email addresses, IP addresses, or customer identifiers.
- Prompts, model responses, purchased content, or provider payloads.
- Private keys, credentials, tokens, or signatures that enable replay.
- Raw payment metadata beyond what is already necessarily public.

Deletion covers primary database, search, object store, cache, analytics, exports, replicas, and backup expiry. Legal hold is explicit, authorized, scoped, and evidenced.

After eligible payload deletion, integrity proof may use tenant-scoped keyed pseudonyms and digests only after a field-level reidentification analysis. Low-entropy identifiers are never hashed directly. Derivation uses a versioned tenant-specific HMAC/key or high-entropy random mapping, domain separation, rotation, access isolation, and a documented mapping-key destruction procedure. Destroyed mappings and expired keys propagate through replicas, exports, and backup-expiry evidence. A digest that remains reasonably linkable or dictionary-recoverable is still treated as personal data.

## Evidence bundle

Every bundle pins:

- Bundle and journey ID.
- Core/adapter/market profile.
- Code, image, migration, policy, and schema digests.
- Ordered event manifest.
- External references and lookup snapshots.
- Ledger and reconciliation proof.
- Redaction and data-classification manifest.
- Verifier version.
- Capture time, expiry, and detached signature.

## Failure behavior

- Evidence write fails before high-risk action: action does not execute.
- External action succeeds but evidence persistence fails: open `EVIDENCE_INCOMPLETE` incident, preserve attempt and external truth, block certification.
- Integrity verification fails: revoke affected certificate and preserve forensic copy.
- Retention job fails: alert and block compliance claim.
- Deletion conflicts with legal hold: retain only authorized scope and notify requester.
- Onchain anchor unavailable: local signed evidence may continue if profile permits; anchoring claim pauses.
- Clock skew exceeds bound: evidence confidence degrades and high-risk profile stops.

## Requirements

- `AOPS-EVD-001` (`S0`): Every financial journey MUST be reconstructable end to end.
- `AOPS-EVD-002` (`S0`): Integrity verification MUST detect modification, gaps, forks, and tail deletion.
- `AOPS-EVD-003` (`S0`): Evidence MUST bind to exact release, schema, environment, and adapter profile.
- `AOPS-EVD-004` (`S0`): Secrets and personal payload MUST NOT be placed onchain or in immutable public proof.
- `AOPS-EVD-005` (`S0`): Retention, legal hold, deletion, and DSAR MUST be executable and tested for every certified market profile.
- `AOPS-EVD-006` (`S0`): Missing required evidence MUST block or revoke certification.
- `AOPS-EVD-007` (`S1`): Evidence access and export MUST be role-, purpose-, and tenant-scoped.
- `AOPS-EVD-008` (`S1`): An independent verifier MUST validate exported bundles without production database access.
- `AOPS-EVD-009` (`S0`): Pseudonymous proof identifiers MUST use a reviewed keyed/random derivation and MUST NOT expose directly hashable low-entropy personal identifiers.

## Verification and exit gate

- Event schema and producer-contract tests.
- Mutation, insertion, gap, fork, and tail-deletion suite.
- Cross-tenant evidence-access tests.
- Clock-skew and producer-identity tests.
- Complete journey reconstruction samples.
- Signed export and independent verifier run.
- SIEM delivery and retry tests.
- Retention and legal-hold jobs.
- DSAR/deletion across all stores and backup expiry.
- Proof that onchain commitments contain no personal or secret payload.
- Evidence-loss incident and certificate-revocation drill.
