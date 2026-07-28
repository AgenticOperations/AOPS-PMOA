---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [domain, approvals, grants, kill-switch, emergency]
---

# Approvals, Grants, and Emergency Controls

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/04-policy-and-authority|Policy and authority]] | [[10-Projects/Web3-Builds/agentOps/creative-free/07-secure-execution-notifications-incidents|Prior incident design]]

## Scope and ownership

This domain owns approval requests, approval routing, quorum, delegation of approval responsibility, decisions, execution grants, consumption, revocation, emergency epochs, kill switches, and safe reopen authorization.

Approval establishes that the required human or quorum accepted the exact request. An execution grant is the machine-consumable, short-lived authority derived from policy and approval.

## Required product capabilities

- Create approval requests from deterministic policy obligations.
- Bind requests to action, mission, policy epoch, amount, asset, provider, destination, adapter, and expiry.
- Route by organization, team, risk, amount, provider, and action type.
- Support single approver, quorum, ordered approval, and dual control.
- Prevent requester self-approval where separation is required.
- Escalate, remind, delegate temporarily, cancel, deny, and expire.
- Show material context and structured risk without exposing secrets.
- Resume the same durable action after approval.
- Issue one-time execution grants.
- Atomically consume a grant with creation of its referenced financial attempt and held reservation; this is the first irreversible local step.
- Revoke grants by action, agent, mission, policy epoch, adapter, provider, signer, tenant, or release.
- Kill new actions at scoped or global level.
- Distinguish emergency stop, quarantine, and controlled reopen.

## Approval lifecycle

```text
ApprovalRequest:
pending → approved → grant_issued → closed
        ↘ denied
        ↘ expired
        ↘ cancelled

ExecutionGrant:
issued → active → consumed
                ↘ revoked
                ↘ expired
```

An approval cannot be edited. A changed action creates a new request.

The approval record includes:

- Requester and acting agent.
- Required approver set and quorum.
- Full canonical action hash.
- Human-readable summary generated from canonical data.
- Mission and policy versions.
- Reservation requirement and maximum amount.
- Provider/destination/adapter profile.
- Decision, signer, timestamp, reason, and authentication assurance.
- Expiry and consumption reference.

An `Approval` is the immutable approve/deny outcome attached to the request. Consumption belongs to `ExecutionGrant`, not to the approval request.

## Execution grant

A grant contains:

- Grant ID and organization.
- Authenticated subject and acting agent.
- Exact action hash and allowed operation.
- Mission, policy epoch, and approval references.
- Amount, asset, payee, destination, provider, rail, and network.
- Required reservation ID or reservation obligation.
- Signer profile.
- Issued-at, not-before, expiry, and nonce.
- Emergency epoch.

It is signed or otherwise integrity-protected, audience-bound, short-lived, and consumable once.

For financial execution, the orchestrator preallocates the `PaymentAttempt` ID. Grant consumption, reservation creation, and prepared payment-attempt creation occur in one atomic transaction. A consumed grant therefore always resolves to a durable attempt and reservation; none of the three is visible to signer or adapter before commit.

## Emergency model

Emergency controls include:

- Organization stop.
- Agent/subtree stop.
- Connection/credential stop.
- Mission stop.
- Provider/service stop.
- Adapter/network stop.
- Wallet/signer stop.
- Global release stop.

Activating a stop increments a monotonic epoch and blocks new grants before success is returned. Already submitted attempts remain visible and enter reconciliation. Unconsumed grants become invalid. A reservation for an unsigned, undispatched attempt releases only after no-valid-authorization proof. A reservation for `authorization_ready`, `dispatching`, submitted, or unknown work remains held or quarantined until authoritative invalidation, expiry beyond every acceptance window, or reconciliation.

Reopen requires root-cause resolution, fresh health and reconciliation checks, evidence integrity, approver authorization, and staged limits.

## Failure behavior

- Approval service unavailable: action waits or denies according to expiry; it never auto-approves.
- Approver loses membership: pending authority is recalculated.
- Request changed after approval: grant hash mismatch rejects.
- Two consumers race: atomic consumption permits one.
- Atomic grant/reservation/attempt transaction fails: all three remain uncommitted and unusable.
- Commit succeeds but response is lost: replay returns the same grant consumption, reservation, and payment-attempt identity.
- Emergency propagation delayed: production gate fails and affected scope stays money-disabled.
- Stop after signing or during submission: new dispatch halts where possible; authorization-ready, dispatching, and submitted work retains exposure and reconciles.
- Reopen evidence missing: remain stopped.

## Requirements

- `AOPS-APR-001` (`S0`): Approval MUST bind to the exact immutable action and authority context.
- `AOPS-APR-002` (`S0`): One grant MUST be consumed at most once.
- `AOPS-APR-003` (`S0`): Material action changes MUST invalidate approval and grant.
- `AOPS-APR-004` (`S0`): Required maker/checker or quorum MUST use distinct eligible principals.
- `AOPS-APR-005` (`S0`): Emergency stop MUST synchronously deny new grants in scope.
- `AOPS-APR-006` (`S0`): Authorization-ready, dispatching, submitted, and unknown work MUST retain its exposure record and remain reconcilable after stop.
- `AOPS-APR-007` (`S1`): Approval routing, escalation, delegation, and expiry MUST be deterministic and evidenced.
- `AOPS-APR-008` (`S0`): Safe reopen MUST require reconciliation and evidence integrity.
- `AOPS-APR-009` (`S0`): Financial grant consumption MUST atomically create its held reservation and durable payment attempt.

## Verification and exit gate

- Changed amount/payee/request/mission/policy substitution suite.
- Self-approval and ineligible-approver negative tests.
- Quorum race and duplicate callback tests.
- Atomic one-time grant consumption under concurrency.
- Grant expiry and clock-skew tests.
- Kill-switch propagation trace across MCP, SDK, proxy, workers, signers, and adapters.
- Stop during each execution state.
- Restore with consumed grant and incomplete attempt.
- Safe-reopen exercise with staged canary.
- Independent evidence reconstruction from request through consumption.
