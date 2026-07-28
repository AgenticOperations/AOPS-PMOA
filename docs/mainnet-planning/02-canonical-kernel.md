---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [kernel, domain-model, state-machines, invariants]
---

# Canonical Kernel

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/creative-free/12-unified-rail-architecture-and-contracts|Unified rail contracts]] | [[10-Projects/Web3-Builds/agentOps/architecture/product-architecture-FINAL|Historical architecture]]

## Ownership rule

This document defines shared vocabulary and state families. Domain documents own the detailed records and transitions named below. No other document may redefine these terms.

## Canonical identities

| Object | Owner | Meaning |
|---|---|---|
| `Organization` | Organization IAM | Tenant and accountability boundary. |
| `HumanPrincipal` | Organization IAM | Authenticated person with organization membership. |
| `WorkloadPrincipal` | Agent identity | Nonhuman runtime identity acting for a sponsor. |
| `Agent` | Agent identity | Governed machine actor with hierarchy and lifecycle. |
| `Delegation` | Agent identity | Attenuated authority from one principal to another. |
| `Connection` | Agent identity | Runtime integration endpoint and credential relationship. |

Tenant identity always comes from the authenticated principal and connection. Request payload fields can narrow scope but cannot select another tenant.

## Canonical authority objects

| Object | Owner | Meaning |
|---|---|---|
| `Mission` | Mandates and missions | Purpose, sponsor, permitted outcomes, resources, providers, budget, expiry, and completion rules. |
| `PolicyVersion` | Policy and authority | Immutable structured rules evaluated for an action. |
| `Decision` | Policy and authority | Deterministic outcome pinned to inputs and policy version. |
| `ApprovalRequest` | Approvals and grants | Human or quorum decision request bound to an immutable action. |
| `Approval` | Approvals and grants | Signed approve or deny outcome. |
| `ExecutionGrant` | Approvals and grants | Short-lived, one-time authority for an exact action hash and policy epoch. |
| `EmergencyEpoch` | Approvals and grants | Monotonic revocation boundary invalidating older unsubmitted grants. |

An agent, reusable workflow, skill, catalog entry, or natural-language instruction may request capabilities. It cannot grant itself authority.

## Canonical execution objects

| Object | Owner | Meaning |
|---|---|---|
| `ActionIntent` | Runtime enforcement | Durable canonical request before external side effects. |
| `RuntimeAttempt` | Runtime enforcement | One idempotent nonfinancial or discovery interaction with an external system. |
| `PaymentAttempt` | Financial execution | One idempotent financial interaction with an external rail. |
| `ProviderOffer` | Provider commerce | Versioned terms, price, invocation, destination, and fulfillment contract. |
| `Delivery` | Provider commerce | Provider result and acceptance state, distinct from payment settlement. |
| `ExternalOutcome` | Owning execution profile | Authoritative provider, network, chain, or tool state linked to a runtime or payment attempt. |

## Canonical financial objects

| Object | Owner | Meaning |
|---|---|---|
| `Budget` | Treasury and ledger | Authorized ceiling over an asset, window, subject, and purpose. |
| `Reservation` | Treasury and ledger | Held capacity preventing concurrent overspend. |
| `LedgerAccount` | Treasury and ledger | Typed balance bucket for one tenant, asset, and purpose. |
| `Posting` | Treasury and ledger | Immutable debit or credit. |
| `JournalEntry` | Treasury and ledger | Balanced group of postings for one economic event. |
| `ReconciliationCase` | Treasury and ledger | Difference between internal and authoritative external truth. |

Settled consumption plus outstanding reservations counts against a budget. Monetary history is corrected by new postings, never by rewriting prior entries.

## Canonical assurance objects

| Object | Owner | Meaning |
|---|---|---|
| `EvidenceEvent` | Evidence and assurance | Typed, ordered, tamper-evident fact. |
| `EvidenceBundle` | Evidence and assurance | Exportable reconstruction of a journey. |
| `Incident` | Platform operations | Operational or security condition requiring response. |
| `GateResult` | Assurance | Result for one requirement and evidence set. |
| `ReleaseCertificate` | Assurance | Signed core × execution-profile × market authorization. |

## State families

### Organization and membership

```text
Organization: provisioning → active → suspended → closing → closed
                         ↘ active
Invitation: created → sent → accepted
                  ↘ expired
                  ↘ cancelled
Membership: pending → active → suspended → active
                              ↘ revoked
```

Closing prevents new authority but preserves required reconciliation, export, retention, and legal-hold operations.

### Agent and credential

```text
Agent: draft → active → suspended → deactivated
Credential: issued → active → rotating → revoked
                              ↘ expired
```

A revoked credential cannot create a new action. Existing submitted financial attempts remain visible and reconcile normally.

### Mission and policy

```text
Mission: draft → validated → approved → active → paused → active
                                        ↘ completed
                                        ↘ cancelled
                                        ↘ expired

PolicyVersion: draft → validated → staged → approved → active → superseded → archived
                                      ↘ rejected
```

Missions and policies are immutable once active. Changes create new versions.

### Approval and grant

```text
ApprovalRequest: pending → approved → grant_issued → closed
                         ↘ denied
                         ↘ expired
                         ↘ cancelled

ExecutionGrant: issued → active → consumed
                       ↘ revoked
                       ↘ expired
```

Approval is not execution. A grant is bound to the exact action, mission, policy epoch, amount, destination, adapter, and expiry.

### Action and execution

```text
ActionIntent: received → evaluating → awaiting_approval → authorized
                                  ↘ denied
authorized → executing → completed
                       ↘ failed
                       ↘ unknown
```

`unknown` means an external effect may have occurred and authoritative truth is not yet available. It is nonterminal.

### Reservation and ledger

```text
Reservation: proposed → held → consumed
                         ↘ released
                         ↘ expired
                         ↘ quarantined
quarantined → consumed
            ↘ released
```

A reservation for an attempt with still-valid externally executable authorization, or an attempt that is `dispatching`, submitted, or unknown, remains held or quarantined. It cannot expire merely because the local worker timed out. A quarantined reservation resolves only to consumed or released after authoritative external truth determines the economic outcome.

### Provider and delivery

```text
Provider: submitted → identity_verified → destination_verified → active
                                                   ↘ suspended → active
                                                   ↘ revoked
Offer: draft → active → superseded → withdrawn
Delivery: pending → delivered → accepted
                    ↘ rejected
                    ↘ disputed
                    ↘ unknown
```

Payment settlement and delivery acceptance are separate facts.

### Payment attempt

```text
prepared → authorization_ready → dispatching → submitted → pending → confirmed → settled
        └──────────────────────→ dispatching
                                      ↘ unknown
                                      ↘ failed
unknown → pending → confirmed → settled
        ↘ failed
settled → reversed
        ↘ disputed
        ↘ refund_pending → refunded
```

`authorization_ready` is conditional: it exists when a signature, token, mandate, debit instruction, or other externally executable authorization is produced before dispatch. An attempt in this state is financially exposed even though it is not yet submitted. Its reservation remains held or quarantined until the authorization is authoritatively revoked, expires beyond every acceptance window, or the attempt reconciles.

Before entering `dispatching`, AOPS durably stores the exact canonical request, provider identity, idempotency identity, signed-byte or signed-payload hash, and dispatch lease. Entering `dispatching` occurs before irreversible I/O. Recovery treats an expired `dispatching` lease as `unknown` unless authoritative local or provider evidence proves that no send occurred.

An adapter may add rail-specific substates but may not collapse uncertainty into failure.

## Critical transition registry

Detailed machine schemas are generated before implementation. These cross-domain transitions already have stable IDs because they guard the money and revocation boundaries:

| Transition ID | From → to | Owner | Guard |
|---|---|---|---|
| `TR-GRT-001` | grant active → consumed | Approvals | Same atomic commit creates held reservation and prepared payment attempt |
| `TR-RSV-001` | reservation proposed → held | Treasury | Budget includes outstanding holds; exact attempt ID and fee envelope exist |
| `TR-RSV-002` | held/quarantined → released or held → expired | Treasury | Authoritative proof that no external effect or valid authorization can occur |
| `TR-RSV-003` | held → quarantined | Treasury | Submitted/dispatching/unknown exposure requires isolation |
| `TR-RSV-004` | held/quarantined → consumed | Treasury | Authoritative economic effect is linked to an idempotent settlement posting |
| `TR-PAY-000` | payment attempt prepared → authorization_ready | Financial execution | Externally executable authorization and its validity/revocation identity are durable; reservation remains unavailable |
| `TR-PAY-001` | payment attempt prepared/authorization_ready → dispatching | Financial execution | Exact request/provider/idempotency/authorization identity and lease are durable |
| `TR-PAY-002` | dispatching → submitted | Financial execution | Provider acknowledgement or verifiable send receipt exists |
| `TR-PAY-003` | dispatching/submitted/pending → unknown | Financial execution | Acceptance/economic effect may have occurred and authoritative truth is unavailable |
| `TR-PAY-004` | unknown → failed | Financial execution | Authoritative external evidence proves no economic effect can occur |
| `TR-PAY-005` | pending/confirmed/unknown → settled | Financial execution | Authoritative settlement proof exists; ledger and reservation disposition are idempotently linked |
| `TR-CERT-001` | certificate valid → revoked | Assurance | Higher monotonic scope epoch is committed to authoritative registry |
| `TR-ACT-001` | action authorized → executing | Runtime | Grant and current emergency/certificate epochs pass at dispatch |

Any change to a transition's guard is a breaking state-machine change and invalidates dependent evidence and certificates.

### Evidence and certification

```text
EvidenceBundle: open → sealed → exported
                         ↘ anchored
                         ↘ retention_deleted

Certificate: not_assessed → blocked → pass → expired
                                      ↘ revoked
```

## Universal invariants

- `AOPS-KRN-001`: Every canonical record declares one scope type: `platform`, `provider`, `tenant`, or `tenant_provider_binding`; every tenant-scoped record belongs to exactly one organization.
- `AOPS-KRN-002`: Every state transition has one owning domain and one idempotent command identity.
- `AOPS-KRN-003`: External side effects require a durable `ActionIntent`.
- `AOPS-KRN-004`: Destructive actions require a decision for the exact action hash.
- `AOPS-KRN-005`: Financial submission requires an active grant and held reservation.
- `AOPS-KRN-006`: One grant can be consumed at most once.
- `AOPS-KRN-007`: Submitted uncertainty remains `unknown` until authoritative reconciliation.
- `AOPS-KRN-008`: Every economic event maps to a balanced journal entry.
- `AOPS-KRN-009`: Every terminal journey has a sealed evidence bundle or a blocking evidence incident.
- `AOPS-KRN-010`: A material dependency change revokes affected certificates.
- `AOPS-KRN-011`: Irreversible external I/O requires a durable runtime or payment attempt in `dispatching` containing the exact request and recovery identity.
- `AOPS-KRN-012`: Grant consumption, financial-attempt creation, and reservation creation MUST share one atomic commit boundary before signing or dispatch.
