---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [journey, unknown, reconciliation, recovery]
---

# Journey: Unknown Outcome and Recovery

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/10-financial-execution-and-adapters|Financial adapters]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/12-platform-operations|Platform operations]]

## Outcome

When an external system may have accepted a request but AOPS lacks authoritative outcome, the product preserves authority, money, idempotency, and evidence until the original attempt is resolved without duplicate execution.

## Entry conditions

An attempt enters `unknown` when:

- Network timeout occurs during or after submission.
- Provider accepts but response is lost.
- Signer/submission worker crashes at an ambiguous boundary.
- A `dispatching` lease expires without authoritative proof that no request was emitted.
- Webhook is missing or unverifiable.
- Chain/provider state is temporarily unavailable.
- Local state conflicts with external evidence.

## Recovery flow

1. Persist the exact request, provider/idempotency identity, signing receipt or payload hash, dispatch lease, and last known send boundary.
2. Atomically mark the original attempt `unknown`; an expired `dispatching` lease follows this path unless no-send proof exists.
3. Retain or quarantine its reservation.
4. Deny a new or replacement attempt for the same economic intent.
5. Schedule adapter lookup using the original provider identity and idempotency key.
6. Authenticate and store webhooks without trusting order.
7. Compare provider/network truth with signer receipt and local attempt.
8. If settled, post the original economic event and resolve the held/quarantined reservation to consumed.
9. If authoritatively failed before economic effect and no external authorization remains valid, resolve the held/quarantined reservation to released.
10. If reversed/refunded, append correcting postings.
11. If still unknown beyond SLO, escalate a reconciliation incident and pause new submissions for the affected scope.
12. Seal resolution evidence and notify operator/agent.

## Operator experience

The console shows:

- What is known and unknown.
- Original action, mission, policy, approval, reservation, signer, provider, and attempt.
- Last lookup and next scheduled lookup.
- External references.
- Financial exposure.
- Permitted operator actions.
- Why release, retry, or manual settlement is currently unsafe.

Manual resolution can classify, escalate, attach evidence, or provision additional separately authorized capacity. Humans cannot declare an unresolved external effect nonexistent, release its hold, or authorize a replacement attempt. Monetary release requires authoritative provider/network evidence that the original attempt cannot still create an economic effect.

## Disaster recovery

After restore:

1. Rebuild ledger balances and reservation projections.
2. Enumerate submitted and unknown attempts.
3. Reestablish original idempotency identities.
4. Reconcile with provider/network truth.
5. Verify evidence links.
6. Keep the affected money profile disabled until every unresolved attempt remains fully held/quarantined, no replacement attempt is possible, and reopen criteria for unaffected work are explicitly approved. A held amount never counts as reusable capacity merely because aggregate exposure remains below a limit.

## Prohibited behavior

- Mapping timeout to failed.
- Releasing reservation on local TTL while external authorization remains valid.
- Retrying with a new idempotency key.
- Creating a replacement approval to bypass an unknown.
- Manually overriding external uncertainty or reusing quarantined capacity.
- Marking settled based only on model/provider response text.
- Hiding unknown attempts from users or financial reports.

## Required assertions

- Timeout immediately before submit is distinguished from timeout after possible acceptance.
- Crash after provider acceptance produces one external effect.
- Lost response, lost webhook, duplicate webhook, and reordered webhook resolve correctly.
- Provider lookup outage retains the hold.
- Process and region restart recover original attempt identity.
- Manual resolution cannot be self-approved.
- Reconciliation creates balanced postings and complete evidence.
- Unknown-resolution SLO breach revokes or degrades the adapter profile.

## Exit criterion

The exact adapter passes fault injection at every ambiguity window, a restore exercise, and an external reconciliation check with zero duplicate economic effects and zero unexplained monetary difference.
