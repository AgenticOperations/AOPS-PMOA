---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [journey, emergency, incident, kill-switch]
---

# Journey: Emergency Containment

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/05-approvals-grants-and-emergency-controls|Emergency controls]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/12-platform-operations|Platform operations]]

## Outcome

An authorized responder stops new dangerous authority within the certified propagation time while preserving in-flight financial truth, evidence, and a controlled path to recovery.

## Trigger examples

- Stolen human or agent credential.
- Cross-tenant access.
- Policy bypass.
- Signer or provider credential compromise.
- Ledger imbalance.
- Duplicate execution.
- Unknown backlog beyond SLO.
- Evidence integrity failure.
- Critical vulnerability.
- Provider/network behavior change.
- Failed restore or isolation control.

## Flow

1. Alert or human report opens an incident.
2. Responder selects scope: connection, agent, subtree, mission, provider, adapter, signer, tenant, release, or global.
3. Emergency control increments epoch and disables new grants.
4. Runtime, workers, signers, and adapters acknowledge the epoch.
5. Unsubmitted grants revoke and safe holds release.
6. Submitted and unknown attempts remain held and enter reconciliation.
7. Evidence captures initiator, reason, scope, acknowledgements, affected assets, and time.
8. Responders rotate credentials/keys, contain egress, investigate, and reconcile.
9. Recovery checks domain invariants, evidence, and external truth.
10. Independent approver authorizes staged reopen.

## Failure behavior

- One service does not acknowledge stop: profile remains blocked and alerts escalate.
- Control plane unavailable: out-of-band provider/signer/network stop procedures apply.
- Responder lacks exact scope: broader safe stop is allowed but fully evidenced.
- Stop races with submission: attempt is submitted/unknown and reconciled; no false cancellation.
- Evidence store unavailable: emergency stop still executes through independent minimal channel, and a signed incident record is backfilled.
- Reopen attempted before reconciliation: deny.

## Required assertions

- Next new action is denied before stop call reports success.
- Stop reaches MCP, SDK, proxy, workers, signer, and adapters.
- Submitted work remains visible and financially reserved.
- Unsubmitted one-time grants cannot be replayed.
- Out-of-band signer/provider stop works during control-plane outage.
- Two-person reopen and staged canary are enforced.
- Incident evidence allows minute-by-minute reconstruction.

## Exit criterion

Quarterly drills demonstrate propagation, alternate communications, provider/signer containment, unknown reconciliation, and staged reopen within the profile’s approved RTO and exposure bound.
