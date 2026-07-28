---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [domain, policy, authorization, compiler, simulation]
---

# Policy and Authority

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/03-mandates-and-missions|Mandates and missions]] | [[10-Projects/Web3-Builds/agentOps/architecture/policy-engine-FINAL|Historical policy design]]

## Scope and ownership

This domain owns policy definitions, typed policy IR, validation, versioning, activation, binding, deterministic evaluation, conflict resolution, obligations, simulation, policy epochs, and decisions.

It does not own identity facts, mission facts, human approvals, financial reservations, external execution, or evidence storage.

## Required product capabilities

- Create structured policies directly or from assisted natural-language extraction.
- Preserve source spans and blocking questions.
- Validate types, references, units, time zones, providers, assets, and unsupported clauses.
- Compile to a deterministic typed representation.
- Version, diff, simulate, stage, approve, activate, supersede, archive, and roll back.
- Bind policies to organization, environment, team, workflow, agent, mission, tool, provider, action, and adapter profile.
- Evaluate action, payment, allocation, data-access, tool, provider, and emergency policies.
- Produce `allow`, `deny`, `approval_required`, or `needs_more_info`.
- Return obligations such as reservation, approval group, step-up, evidence level, rate limit, or provider verification.
- Explain every decision from deterministic matched clauses.
- Simulate impact on historical and active mission fixtures.
- Propagate revocation and emergency epochs.

## Effective authority

Effective authority is the intersection of:

- Organization hard limits and denials.
- Environment restrictions.
- Human and workload permissions.
- Delegation chain.
- Active mission version.
- Team/workflow/agent policy bindings.
- Provider and adapter capability.
- Budget including outstanding reservations.
- Emergency epoch.

Deny dominates. A lower scope may narrow but cannot override a higher-scope denial or hard ceiling.

## Policy lifecycle

```text
draft → validated → staged → approved → active → superseded → archived
                     ↘ rejected
active → rollback creates a new active version referencing prior content
```

Active versions are immutable. Rollback is a new controlled activation, not database mutation.

## Decision contract

A decision pins:

- Decision ID and time.
- Organization and environment.
- Authenticated and acting principal.
- Delegation chain.
- Mission ID/version.
- Canonical action hash.
- Applicable policy IDs/versions and policy epoch.
- External provider/offer/adapter facts used.
- Budget and reservation snapshot used.
- Decision, reason code, matched clauses, and obligations.
- Evaluation engine/version.
- Expiry and evidence level.

The LLM may draft or explain policy. It never returns the authoritative decision.

## Default behavior and migration

Production governed actions default deny when no applicable allow exists. Unknown or invalid material facts return `needs_more_info` or deny according to explicit policy; they do not silently widen access.

The current implementation defaults no-match to allow. Migration requires:

1. Inventory existing calls and implicit dependencies.
2. Shadow-evaluate with default deny.
3. Generate required explicit allow policies.
4. Review behavior differences.
5. Activate per environment.
6. Retain a time-bounded compatibility profile only for non-destructive sandbox actions.

No mainnet money profile may use default allow.

## Financial policy

Financial evaluation includes:

- Mission budget and asset.
- Organization and agent limits.
- Settled spending plus outstanding holds.
- Amount and fee ceiling.
- Time window and rate.
- Payee, provider, destination, network, and contract.
- Risk labels and data sensitivity.
- Required approval and signer profile.
- Prohibition on silent rail/provider substitution.

## Failure behavior

- Policy service unavailable: new destructive actions deny; submitted attempts reconcile.
- Cache stale: policy epoch mismatch rejects stale decision/grant.
- Conflicting statements: deterministic precedence with deny dominance.
- Missing budget snapshot: financial decision fails closed.
- Provider facts change after decision: grant becomes invalid.
- Policy changed during approval: resume reevaluates and rebinds.
- Simulator differs from runtime: block activation and open incident.
- Unsupported natural-language term: block compilation.

## Requirements

- `AOPS-POL-001` (`S0`): Mainnet destructive and financial policy MUST deny by default.
- `AOPS-POL-002` (`S0`): Every decision MUST pin exact input hash, policy versions, and epoch.
- `AOPS-POL-003` (`S0`): Deny and hard ceilings MUST dominate narrower rules.
- `AOPS-POL-004` (`S0`): Financial limits MUST include outstanding reservations.
- `AOPS-POL-005` (`S0`): Stale policy cache or epoch MUST NOT widen authority.
- `AOPS-POL-006` (`S1`): Simulator and runtime evaluator MUST be equivalent.
- `AOPS-POL-007` (`S1`): Natural-language drafting MUST preserve source, questions, and human confirmation.
- `AOPS-POL-008` (`S0`): Policy widening and mainnet activation MUST use separation of duties.
- `AOPS-POL-009` (`S0`): Changed amount, destination, provider, request, mission, or epoch MUST invalidate the decision/grant.

## Verification and exit gate

- Policy truth-table corpus.
- Property and mutation tests.
- Default-deny negative suite.
- Conflict-precedence tests.
- Hold-inclusive concurrent-spend tests.
- Shadow migration from current default allow.
- Simulator/runtime equivalence report.
- Cache-staleness and partition tests.
- Policy change during approval/execution.
- Revocation propagation and kill-switch trace.
- Signed policy diff, activation evidence, and rollback proof.
