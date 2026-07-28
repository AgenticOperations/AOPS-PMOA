---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [journey, onboarding, organization, agents]
---

# Journey: Organization and Agent Onboarding

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/01-organization-tenancy-human-iam|Human IAM]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/02-agent-workload-identity|Agent identity]]

## Outcome

An accountable organization enrolls people and an agent, defines mission-bound authority, activates a runtime connection, and proves that the agent cannot act outside the resulting boundary.

## Preconditions

- AOPS release is valid for the selected environment.
- Identity provider and email/SCIM path are healthy.
- No production financial adapter is enabled during onboarding unless its certificates also pass.

## Flow and ownership

| Step | Command | Owner | Durable result |
|---|---|---|---|
| 1 | Create organization | Human IAM | `Organization(provisioning)` and owner membership |
| 2 | Configure environment/security | Human IAM/operations | Environment and required MFA/SSO profile |
| 3 | Invite members | Human IAM | Expiring invitations |
| 4 | Accept invitation and MFA | Human IAM | Active membership and session |
| 5 | Create team and role assignments | Human IAM | Permission bindings |
| 6 | Register agent and sponsor | Agent identity | `Agent(draft)` with sponsor |
| 7 | Define delegation/hierarchy | Agent identity | Attenuated delegation |
| 8 | Create and approve mission | Missions | Active immutable mission version |
| 9 | Bind and activate policy | Policy | Active policy version and epoch |
| 10 | Issue runtime connection | Agent identity | Active connection and short-lived credential |
| 11 | Run negative and positive checks | Runtime/policy | Deny outside scope; authorize inside scope |
| 12 | Seal onboarding evidence | Evidence | Onboarding bundle |

## Failure and compensation

- Invitation accepted twice: one active membership; second use rejected.
- Owner drops connection mid-provisioning: idempotent resume.
- Sponsor leaves before activation: agent remains draft/orphaned.
- Mission or policy activation fails: no active connection authority.
- Credential issuance succeeds but response is lost: replay returns same credential only if securely recoverable; otherwise revoke and issue a new revision.
- Evidence incomplete: organization may remain sandbox-active but production enablement is blocked.
- Cross-tenant object reference at any step: reject and raise security signal.

## Required journey assertions

- Two distinct organizations cannot read or bind each other’s people, agents, missions, policies, or credentials.
- The child agent cannot exceed parent delegation.
- An expired invitation and credential are rejected.
- A paused agent or mission is denied on the next new action.
- A valid in-scope dry action succeeds.
- A provider, tool, amount, or purpose outside scope is denied.
- Every transition has actor, causation, previous state, resulting state, and release identity.

## Evidence bundle

The bundle contains organization/environment identity, invitation and acceptance, MFA assurance, role bindings, sponsor, agent/delegation graph, mission/policy versions, credential revision, positive/negative decisions, timestamps, test fixture, release digest, and verifier result.

## Exit criterion

This journey passes only when onboarding, termination/revocation, cross-tenant isolation, hierarchy attenuation, and evidence reconstruction pass in the same release candidate.
