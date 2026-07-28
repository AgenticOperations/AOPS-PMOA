---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [journey, provider, refund, reversal, dispute]
---

# Journey: Provider, Refund, Reversal, and Dispute

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/07-provider-and-service-commerce|Provider commerce]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/08-treasury-ledger-and-reconciliation|Treasury and ledger]]

## Outcome

AOPS resolves the post-payment lifecycle when a service is not delivered, is rejected, is refunded, is reversed by a rail, or becomes disputed.

## Flow

1. Delivery remains pending after payment settlement or fails acceptance.
2. Provider commerce opens a delivery exception with offer and acceptance evidence.
3. Policy determines automatic retry, alternate delivery, refund request, or human escalation. It never silently chooses a different paid provider.
4. Provider/adapter submits refund, reversal, or dispute action using the original purchase references.
5. Treasury posts any pending receivable/liability representation.
6. Adapter tracks external state through terminal refund/reversal/dispute outcome.
7. Ledger appends correcting entries; original settlement remains unchanged.
8. Reconciliation compares provider/network and internal balances.
9. Evidence seals the original purchase and post-purchase resolution together.

## State combinations

| Payment | Delivery | Product state |
|---|---|---|
| Settled | Accepted | Completed |
| Settled | Pending | Delivery pending |
| Settled | Rejected | Refund/dispute eligible |
| Refunded | Rejected | Resolved after correction |
| Reversed | Previously accepted | Financial reversal incident |
| Unknown | Unknown | Reconciliation, no completion claim |

## Failure behavior

- Provider claims delivery but evidence is missing: remain disputed/pending.
- Refund request accepted but funds not returned: refund pending and reservation/accounting treatment stays explicit.
- Partial refund: append exact partial correction.
- Rail reverses after delivery: record receivable/loss/dispute according to market profile.
- Provider account suspended during dispute: preserve read/lookup and evidence access.
- Refund webhook duplicates or reorders: idempotent transition.
- Legal/contractual dispute period expires: operator and customer notification before expiry.

## Required assertions

- Payment and delivery states remain independent.
- Original ledger entries are immutable.
- Full and partial refunds balance.
- Reversal after settlement balances and opens correct incident.
- Duplicate events do not duplicate corrections.
- Provider destination/identity history remains available.
- Evidence bundle contains offer, purchase, delivery, acceptance, communications, refund/dispute, ledger, and external truth.

## Exit criterion

Every production adapter declares whether refund, reversal, cancellation, partial capture/refund, and dispute are supported. Applicable paths pass sandbox/testnet fixtures and at least one provider-verified canary before unrestricted production.
