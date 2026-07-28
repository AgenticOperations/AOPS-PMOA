---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [domain, iam, tenancy, rbac, enterprise]
---

# Organization, Tenancy, and Human IAM

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/04-trust-tenancy-and-threat-model|Trust and tenancy model]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/PRODUCT|Current product]]

## Scope and ownership

This domain owns organizations, environments, human principals, invitations, memberships, groups, roles, permission assignments, sessions, privileged access, and human access reviews.

It does not own agent credentials, missions, policy decisions, approvals, signing keys, or payment-provider identities.

## Required product capabilities

- Organization creation, verification, suspension, closure, and recovery.
- Distinct sandbox, testnet, and production environments.
- Email/domain invitation with expiry, acceptance, cancellation, and resend.
- Enterprise OIDC/SAML federation and optional SCIM provisioning.
- Phishing-resistant MFA for privileged roles.
- Explicit permission matrix instead of rank-only role comparison.
- Custom roles constrained by nondelegable platform permissions.
- Group and team assignment.
- Session inventory, device/session revocation, and step-up authentication.
- Joiner, mover, and leaver automation.
- Access reviews and orphan-owner detection.
- Break-glass accounts with bounded scope, dual approval, notification, and expiry.
- Support-access request and impersonation evidence.

## Canonical roles

The initial role system separates:

- `organization_owner`
- `organization_admin`
- `developer_integrator`
- `agent_operator`
- `policy_author`
- `approver`
- `treasury_operator`
- `security_auditor`
- `billing_admin`
- `read_only`
- `support_break_glass`

Roles are permission bundles, not authority shortcuts. A role may propose a policy without being allowed to activate it. A treasury operator may reconcile without changing signer policy. An approver may approve an action without changing its amount or destination.

## Lifecycle

```text
Organization:
provisioning → active → suspended → active
                         ↘ closing → closed

Invitation:
created → sent → accepted
              ↘ expired
              ↘ cancelled

Membership:
pending → active → suspended → active
                   ↘ revoked

Session:
issued → active → stepped_up
                ↘ expired
                ↘ revoked
```

Organization closure first disables new authority, then resolves submitted financial work, exports required records, applies retention/legal hold, revokes provider and workload access, and finally closes.

## Permission and separation rules

- The final organization owner cannot be removed without transferring ownership.
- A principal cannot approve its own production access, key/destination change, policy widening, or limit increase.
- Production release, treasury movement, signing policy, provider destination, and emergency reopen require maker/checker separation.
- Support access never grants raw key, credential, or unrestricted tenant database access.
- Break-glass access is not a standing role.
- Privileged sessions require recent phishing-resistant authentication.

## Tenant boundary

The authenticated session resolves organization and environment. API payloads cannot select another organization. Every membership, role, session, invitation, group, and access-review record is organization-scoped.

Isolation proof covers database constraints, Redis session keys, queues, email jobs, exports, logs, support tooling, backups, and identity-provider metadata.

## Data and privacy

Human identity data is classified personal data. The domain records processing purpose, access, retention, residency, identity-provider source, and deletion behavior. Immutable audit records contain stable pseudonymous identifiers and hashes; erasable profile payload remains offchain and outside immutable evidence.

Account closure or a valid deletion request removes eligible profile data while retaining legally required security and financial evidence in minimized form.

## Failure behavior

- Identity provider unavailable: existing bounded sessions may continue according to risk policy; new privileged sessions fail closed.
- Invitation email lost: resend uses the same pending membership and revokes prior token.
- SCIM disorder: version and event identity prevent reactivating a newer revoked membership.
- Termination event delayed: emergency manual revoke is available and measured.
- Last owner disabled: platform blocks the transition or activates controlled recovery.
- Cross-tenant membership reference: database and service reject it.
- Evidence failure during a privileged change: the change does not activate.

## Requirements

- `AOPS-IAM-001` (`S0`): Every privileged human MUST have a unique account and phishing-resistant MFA.
- `AOPS-IAM-002` (`S0`): Tenant MUST derive from authenticated context.
- `AOPS-IAM-003` (`S0`): Money, key, destination, and policy-widening changes MUST use two distinct principals.
- `AOPS-IAM-004` (`S1`): Invitations MUST require explicit acceptance and expire.
- `AOPS-IAM-005` (`S1`): Joiner/mover/leaver changes MUST propagate to all sessions and dependent grants.
- `AOPS-IAM-006` (`S1`): Access reviews MUST identify dormant, privileged, and orphaned accounts.
- `AOPS-IAM-007` (`S0`): Emergency revocation MUST deny the next new action before returning success.
- `AOPS-IAM-008` (`S1`): Break-glass access MUST be time-bound, notified, and fully evidenced.

## Verification and exit gate

Production exit requires:

- Role/permission truth table and negative tests.
- Two-tenant adversarial suite.
- Invitation acceptance, expiry, and replay tests.
- OIDC/SAML and SCIM conformance for enterprise profile.
- MFA and step-up tests.
- Maker/checker tests for every privileged mutation.
- Termination-to-denial propagation trace.
- Session revoke and stolen-cookie replay tests.
- Break-glass drill.
- Signed access review with zero unexplained privileged accounts.
