---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [interfaces, events, errors, idempotency]
---

# Interface, Event, and Error Contract

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/02-canonical-kernel|Canonical kernel]] | [[10-Projects/Web3-Builds/agentOps/creative-free/12-unified-rail-architecture-and-contracts|Prior target contracts]]

## Purpose

Domain ownership prevents ambiguous writes only if domains communicate through stable, authenticated, replay-safe contracts. This document defines the shared envelope. Domain documents define their payload schemas.

## Command envelopes

Every state-changing command carries the control-plane base:

```text
command_id
idempotency_key
request_hash
scope_type
scope_id
authenticated_principal_id
acting_principal_id
correlation_id
causation_id
issued_at
expires_at
schema_version
payload
```

The gateway derives authenticated principal and applicable scope from verified credentials and server-side routing. For an existing tenant, `scope_type=tenant` and `scope_id=organization_id`; callers cannot override either in the payload. Organization creation uses platform scope and a server-preallocated organization ID that becomes the resulting tenant scope.

Governed-execution commands additionally require:

```text
delegation_chain_id
mission_id + version
policy_epoch
action_intent_id
execution_profile_id
```

Organization creation, invitation, membership, identity enrollment, and mission creation use the control-plane base because their lifecycle precedes a mission. Commands declare an applicability class; conditionally required fields are rejected when absent and rejected as extraneous where they do not apply.

The idempotency record binds key, authenticated subject, operation, canonical payload hash, and validity window. Reusing a key with a different payload is rejected. Retrying an unresolved external operation uses the original command and attempt identity.

## Event envelope

Every accepted transition emits:

```text
event_id
event_type
aggregate_type
aggregate_id
aggregate_version
scope_type
scope_id
organization_id_if_tenant_scoped
actor
subject
previous_state
resulting_state
command_id
correlation_id
causation_id
occurred_at
recorded_at
producer_release
schema_version
data_classification
retention_class
canonical_body_hash
previous_event_hash
event_hash
```

Events are written with the canonical state change or through a transactional outbox. Publishing may be at least once; consumers must be idempotent.

An event is evidence of what AOPS recorded, not automatically proof of an external economic outcome. External outcome events require authoritative provider identifiers and subsequent verification or reconciliation.

## Cross-domain workflow rule

Cross-domain journeys use durable orchestration and compensating transitions, not distributed assumptions.

For a payment:

1. Runtime persists the action intent.
2. Policy produces a decision.
3. Approval produces an action-bound grant.
4. The orchestrator preallocates the `PaymentAttempt` identity.
5. One atomic transaction consumes the grant, creates the held reservation referencing that attempt, and creates the prepared payment attempt with canonical request, provider identity, idempotency identity, and signed-payload hash.
6. The signer validates the committed grant/reservation/attempt tuple.
7. The dispatcher atomically acquires a lease and transitions the payment attempt to `dispatching`.
8. Only then may the financial adapter perform irreversible external I/O.
9. Adapter outcome updates the payment attempt to submitted, pending, unknown, authoritatively failed, or settled.
10. Treasury consumes, releases, or quarantines the reservation.
11. Ledger posts the economic result.
12. Reconciliation compares external and internal truth.
13. Evidence seals the journey.

A crash between steps leaves a recoverable durable state. An expired `dispatching` lease is treated as externally uncertain unless authoritative evidence proves that the adapter never emitted the request. Recovery workers identify orphan reservations, orphan attempts, missing postings, missing reconciliation, and missing evidence.

In a modular monolith, step 5 is one database transaction plus outbox. A future service split must preserve the same visible invariant through a durable orchestration protocol: no grant is consumed without a recoverable payment-attempt identity, no reservation exists without that identity, and no signer/adapter observes the attempt until all three records are committed.

## Error taxonomy

| Class | Meaning | Retry behavior |
|---|---|---|
| `INVALID` | Schema or semantic request error. | Correct request; do not retry unchanged. |
| `UNAUTHENTICATED` | No valid principal. | Reauthenticate. |
| `UNAUTHORIZED` | Principal lacks authority. | Do not retry unless authority changes. |
| `POLICY_DENIED` | Deterministic policy denial. | Do not retry same epoch and input. |
| `APPROVAL_REQUIRED` | Human or quorum action required. | Resume the same intent after approval. |
| `CONFLICT` | State or idempotency conflict. | Read canonical state; do not invent a new key. |
| `RATE_LIMITED` | Local or provider capacity limit. | Retry according to bounded policy. |
| `DEPENDENCY_UNAVAILABLE` | Failure known before external acceptance. | Retry safely if no side effect is possible. |
| `EXTERNAL_REJECTED` | Provider authoritatively rejected. | Follow adapter rules. |
| `EXTERNAL_UNKNOWN` | External acceptance may have happened. | Reconcile; do not release or resubmit blindly. |
| `EVIDENCE_INCOMPLETE` | Required proof is missing or corrupt. | Block certification and open incident. |
| `INTERNAL_INVARIANT` | Ledger, tenant, policy, or state invariant failed. | Stop affected scope and escalate. |

HTTP status is transport metadata; the structured error code controls behavior.

## Timeout boundaries

- Before any external submission: timeout may be safely retryable if the durable command is unchanged.
- During submission: timeout becomes `EXTERNAL_UNKNOWN`.
- After authoritative rejection: attempt becomes failed.
- After authoritative acceptance but before finality: attempt remains pending.
- After settlement: delivery may still remain pending or disputed.

Cancellation means “request cancellation,” not proof of reversal. Each adapter declares whether cancellation is supported and how its outcome is verified.

## Ordering and concurrency

- Aggregate versions enforce optimistic concurrency.
- Policy and emergency epochs prevent stale authority from widening access.
- Budget checks include outstanding reservations within a serializable or equivalently safe boundary.
- Duplicate and out-of-order webhooks are stored, authenticated, deduplicated, and applied only when the resulting transition is valid.
- Nonmonotonic external systems are represented through reversal or reorg events, not history mutation.

## Compatibility

Interfaces use explicit semantic versions. Backward-compatible additions do not change existing meaning. A breaking change creates a new version and invalidates affected adapter and release certificates.

## Shared requirements

- `AOPS-INT-001`: State-changing commands MUST be idempotently addressable.
- `AOPS-INT-002`: Organization identity MUST derive from authenticated context.
- `AOPS-INT-003`: External submission MUST occur only after intent, authorization, reservation, and attempt are durable.
- `AOPS-INT-004`: `EXTERNAL_UNKNOWN` MUST NOT be mapped to failure.
- `AOPS-INT-005`: Event publication MUST tolerate duplicates and disorder.
- `AOPS-INT-006`: Every state transition MUST emit sufficient evidence to reconstruct causality.
- `AOPS-INT-007`: Breaking interface changes MUST revoke dependent certificates.
- `AOPS-INT-008`: The exact external request and recovery identity MUST be durable before an attempt enters `dispatching`.
- `AOPS-INT-009`: An expired `dispatching` lease MUST become `EXTERNAL_UNKNOWN` unless authoritative evidence proves no send occurred.
- `AOPS-INT-010`: Control-plane commands MUST NOT require mission/delegation fields before those objects exist.
- `AOPS-INT-011`: Grant consumption, reservation creation, and payment-attempt creation MUST commit atomically or remain invisible and non-executable.

## Schema and canonicalization gate

Before feature implementation, the command envelope, event envelope, state-transition records, adapter interface, evidence manifest, and certificate interface must exist as versioned JSON Schema, OpenAPI, or Protobuf artifacts with generated validators.

Canonical hashing uses a named serialization version, deterministic field order, normalized integer/string encodings, explicit omission rules, and domain separation. Unknown fields, number coercion, Unicode normalization, and duplicate keys are rejected at signed or hashed boundaries. Compatibility tests prove that every supported producer and consumer computes the same bytes and hash.
