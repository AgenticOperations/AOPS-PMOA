---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [domain, agents, workload-identity, delegation, credentials]
---

# Agent and Workload Identity

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/01-organization-tenancy-human-iam|Human IAM]] | [[10-Projects/Web3-Builds/agentOps/creative-free/03-policy-hierarchy-and-workflows|Prior hierarchy design]]

## Scope and ownership

This domain owns agents, workload principals, human sponsors, agent hierarchy, delegation records, runtime connections, workload credentials, credential rotation, and workload attestations.

It does not own the mission, effective policy, provider secret, wallet private key, approval, execution grant, or financial budget.

## Required product capabilities

- Register and classify an agent or non-agent workload.
- Assign accountable human and team sponsors.
- Bind the workload to one organization and environment.
- Represent parent/child and workflow relationships.
- Delegate only attenuated capabilities, budgets, resources, providers, duration, and child-creation rights.
- Issue short-lived audience-specific runtime credentials.
- Support credential rotation with overlap and explicit completion.
- Revoke credential, connection, agent, subtree, or environment.
- Inventory active, dormant, orphaned, and overprivileged workloads.
- Bind runtime attestations or deployment identities where available.
- Represent MCP, SDK, HTTP proxy, A2A, browser, worker, and webhook-triggered connections.
- Broker provider credentials without exposing them to the model or agent process.

## Identity hierarchy

```text
Organization
  → Environment
    → Team
      → Workflow/persona
        → Parent agent
          → Child agent
            → Connection
              → Runtime session
```

Hierarchy describes accountability. Delegation separately describes authority. A `parent_agent_id` alone does not imply inherited tools, provider access, budgets, or signing rights.

## Delegation record

A delegation pins:

- Delegator and delegate.
- Human sponsor.
- Parent authority source.
- Allowed action classes.
- Resource, provider, destination, and network scope.
- Budget allocation and concurrency limits.
- Permitted child delegation depth.
- Mission scope.
- Start, expiry, and revocation epoch.
- Evidence and approval requirements.

Effective authority is the intersection of organization, environment, team, mission, parent delegation, direct agent policy, active connection, and current emergency epoch. Descendants may narrow but never widen this intersection.

## Lifecycle

```text
Agent:
draft → active → suspended → active
                 ↘ deactivated

Connection:
pending → active → suspended → active
                     ↘ revoked

Credential:
issued → active → rotating → revoked
                ↘ expired

Delegation:
proposed → active → narrowed
                   ↘ revoked
                   ↘ expired
```

Suspension denies new actions. Submitted financial attempts continue into reconciliation. Deactivation requires revoking connections, credentials, delegations, and unconsumed grants while preserving evidence.

## Credential model

The production model prefers:

- Workload federation or signed workload identity over long-lived bearer secrets.
- Tokens no longer than 15 minutes unless an adapter requires shorter.
- Explicit audience, issuer, organization, subject, connection, scope, issued-at, expiry, and token ID.
- Sender-constrained credentials where supported.
- Hash-only or external-secret-manager storage for authenticators.
- Per-organization or per-environment key material.

Provider credentials and wallet keys are referenced, not returned. Runtime sessions receive one-time execution grants rather than general signing credentials.

## Failure behavior

- Sponsor leaves: affected agents become orphaned and new authority pauses until reassigned.
- Parent revoked: descendant effective authority is recomputed and relevant grants are revoked.
- Token replay: token ID and sender binding reject reuse outside the intended connection.
- Wrong audience: resource server rejects the token.
- Rotation interrupted: old credential remains bounded until overlap expires; rotation state is recoverable.
- Agent suspended while payment submitted: no new work; submitted attempt reconciles.
- Connection compromised: revoke connection without deleting agent history.
- Attestation unavailable: high-risk profiles fail closed; lower-risk profile behavior is explicit.

## Requirements

- `AOPS-WID-001` (`S0`): Every workload MUST have one organization, environment, sponsor, and stable identity.
- `AOPS-WID-002` (`S0`): Credentials MUST NOT be reusable across tenants.
- `AOPS-WID-003` (`S0`): Delegation MUST be attenuating and reconstructable.
- `AOPS-WID-004` (`S0`): Workload tokens MUST be audience-restricted and short-lived.
- `AOPS-WID-005` (`S0`): Credentials and provider secrets MUST NOT enter model-visible context.
- `AOPS-WID-006` (`S1`): Rotation and revocation MUST have tested propagation bounds.
- `AOPS-WID-007` (`S0`): Revoking a parent or emergency epoch MUST invalidate dependent unsubmitted grants.
- `AOPS-WID-008` (`S1`): Orphaned agents MUST be detected and prevented from receiving new authority.

## Verification and exit gate

- Workload and sponsor inventory.
- Cross-tenant credential denial tests.
- Token audience, issuer, expiry, and replay suite.
- Credential rotation and emergency revoke drill.
- Delegation property tests proving no widening.
- Parent/subtree revocation test.
- Agent deactivation with submitted-attempt recovery.
- Provider credential leak scan.
- Attestation success and failure paths for applicable runtime profiles.
- Independent reconstruction of actor and delegation chain from evidence.
