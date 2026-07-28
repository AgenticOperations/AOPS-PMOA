---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [domain, missions, mandates, purpose, lifecycle]
---

# Mandates and Missions

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/02-agent-workload-identity|Agent identity]] | [[10-Projects/Web3-Builds/agentOps/creative-free/13-buyer-and-seller-product-flows|Prior product flows]]

## Scope and ownership

This domain owns the organization’s durable statement of what an agent is trying to accomplish and the bounds under which it may act.

A mission is not a prompt, policy rule, approval, payment mandate, or workflow template. A prompt explains desired work to a model. A mission is the immutable organizational authority context against which deterministic controls operate.

## Required product capabilities

- Draft a mission from structured fields or assisted natural language.
- Require blocking clarification for ambiguous material terms.
- Assign sponsor, owner, team, agents, and beneficiaries.
- Define objective, allowed actions, tools, services, providers, destinations, networks, and data classes.
- Define total budget, per-action limits, asset, windows, concurrency, and transaction count.
- Define start, expiry, pause, cancellation, and completion rules.
- Define approval and evidence obligations.
- Define permitted child-agent delegation.
- Version, compare, approve, activate, pause, cancel, complete, and expire.
- Fork a reusable template without inheriting active authority.
- Link every action and payment to one mission version or an explicit narrowly defined operational exception.

## Mission record

A mission version includes:

- `mission_id` and immutable version.
- Organization and environment.
- Human sponsor and accountable owner.
- Assigned agents/workflows.
- Purpose and measurable completion criteria.
- Allowed action classes and resources.
- Provider/service allowlist or selection rule.
- Data sensitivity ceiling.
- Budget allocation and timing.
- Human approval rules.
- Evidence requirements.
- Allowed delegation depth and child budget.
- Start and expiry.
- Cancellation treatment for unstarted, held-unsigned, authorization-ready, dispatching, submitted, irreversible, and delivered work.

Natural-language source text, structured interpretation, blocking questions, human confirmation, and final canonical form are retained separately.

## Lifecycle

```text
draft → validated → approved → active
                               ↘ paused → active
                               ↘ completed
                               ↘ cancelled
                               ↘ expired
```

An approved or active mission is immutable. Changes produce a new version requiring impact simulation and approval. Outstanding grants retain the version they reference and are revoked when the new version narrows authority or the mission is paused.

## Completion model

Completion is evidence-driven. It may require:

- Required deliverables accepted.
- Required paid services delivered.
- No unresolved execution attempts.
- No outstanding reservations.
- Ledger and external sources reconciled.
- Evidence bundle sealed.
- Sponsor or automated deterministic acceptance rule satisfied.

A payment receipt is not proof that the mission outcome was correct.

## Cancellation model

- Unstarted intent: cancel.
- Awaiting approval: cancel approval request.
- Authorized but unsigned and undispatched: revoke the grant; release the hold only after proving no valid external authorization or effect exists.
- Authorization-ready, dispatching, submitted, or unknown: prevent new dispatch where possible, retain or quarantine the reservation, and reconcile or prove the authorization can no longer be accepted before release.
- Settled but undelivered: open delivery/refund/dispute workflow.
- Irreversible action: record that cancellation cannot reverse it and contain subsequent work.

## External mandate protocols

AP2, Visa payment instructions, card-network tokens, and rail-specific mandates are adapter artifacts derived from an AOPS mission and grant. They do not replace the organization mission. The adapter must bind external mandate identifiers and receipts back to the mission version and action hash.

## Failure behavior

- Ambiguous objective: block activation.
- Expired mission during unsubmitted action: deny and revoke grant.
- Expired mission after submission: reconcile submitted work and deny new work.
- Agent attempts to widen provider or budget: deny.
- Sponsor leaves: pause unless an approved successor exists.
- Completion assertion conflicts with unresolved payment: keep mission closing.
- Policy changes: simulate active missions and revoke incompatible grants.
- Provider disappears: pause affected actions; do not silently substitute.

## Requirements

- `AOPS-MSN-001` (`S0`): Every destructive or financial action MUST reference an active immutable mission or explicit emergency operation.
- `AOPS-MSN-002` (`S0`): Agents MUST NOT widen their mission.
- `AOPS-MSN-003` (`S1`): Mission versions MUST include sponsor, purpose, scope, budget, expiry, approval, and evidence requirements.
- `AOPS-MSN-004` (`S0`): Cancellation MUST distinguish unsigned, authorization-ready, dispatching, submitted, unknown, settled, and irreversible work and MUST NOT release exposed capacity without authoritative no-effect proof.
- `AOPS-MSN-005` (`S1`): Completion MUST require all declared deterministic acceptance conditions.
- `AOPS-MSN-006` (`S0`): External mandate artifacts MUST bind to the exact mission and action.
- `AOPS-MSN-007` (`S1`): Material mission changes MUST run impact simulation before activation.

## Verification and exit gate

- Canonical schema and version migration tests.
- Ambiguity and unsupported-clause tests.
- Scope, budget, provider, expiry, and data-class escape tests.
- Agent self-widening property tests.
- Pause/cancel at every execution state.
- Sponsor termination flow.
- Mission-policy compatibility simulation.
- Completion with unsettled, unknown, disputed, and missing-evidence cases.
- AP2 or other external mandate binding tests when an applicable adapter is certified.
