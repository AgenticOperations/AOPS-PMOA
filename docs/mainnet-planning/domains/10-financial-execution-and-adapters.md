---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [domain, payments, adapters, x402, mpp, circle]
---

# Financial Execution and Adapters

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/09-wallet-key-signing-and-custody|Wallet and signing]] | [[10-Projects/Web3-Builds/agentOps/creative-free/12-unified-rail-architecture-and-contracts|Unified rail contracts]]

## Scope and ownership

This domain owns financial execution attempts, adapter profiles, rail capability declarations, quote normalization, canonical payment intents, submission, external-state lookup, webhook ingestion, terminal-state mapping, and adapter conformance.

It does not own organizational authority, provider offers, ledger truth, signing keys, or market/legal eligibility.

## Adapter principle

The core does not impose one universal payment lifecycle. Each adapter implements a versioned contract while preserving rail-specific semantics:

- Supported operations.
- Quote/request model.
- Idempotency scope and retention window.
- Authorization and signing mechanism.
- Submit, lookup, cancel, refund, and reverse behavior.
- Webhook authentication, deduplication, and ordering.
- Pending, unknown, terminal, finality, reorg, dispute, and expiry semantics.
- Fees, FX, rounding, limits, and minimums.
- Provider account, network, asset, and contract identity.
- External source of truth.

Unsupported capabilities are explicit; they are never simulated through unsafe substitutions.

## Required product capabilities

- Adapter registration, configuration, health, disablement, and versioning.
- Capability discovery and compatibility validation.
- Quote/requirements parsing and canonicalization.
- Destination, provider, network, asset, amount, fee, and expiry binding.
- Durable attempt before submission.
- Same-intent retry and changed-payload rejection.
- Authenticated webhook ingestion.
- Polling/lookup reconciliation.
- Refund, reversal, dispute, cancellation, and partial result handling where supported.
- Network finality and reorg handling.
- Adapter-specific operator console.
- Sandbox, testnet, mainnet canary, and production profiles.
- No silent provider, rail, wallet, network, asset, or destination substitution.

## Attempt lifecycle

```text
prepared → authorization_ready → dispatching → submitted → pending → confirmed → settled
        └──────────────────────→ dispatching
                                      ↘ unknown → pending/confirmed/settled/failed
                                      ↘ failed
settled → refund_pending → refunded
        ↘ reversed
        ↘ disputed
```

`authorization_ready` is required when externally executable material exists before dispatch. Its validity and revocation identity are durable, and its reservation cannot be released merely because dispatch has not begun. The dispatcher persists its lease and exact request identity before I/O. `failed` requires authoritative proof that the economic effect did not occur or was terminally rejected. A timeout after possible request emission becomes `unknown`.

## Protocol families

### x402

The adapter supports the current x402 version explicitly. It treats the first HTTP request as a governed external action, parses the `402` payment requirements, binds the exact quote and destination, reserves and signs, resubmits with the correct payment header, returns the provider resource, and reconciles settlement. Non-402 responses remain recorded attempts.

### MPP

MPP is a separate adapter family supporting machine payment challenges and potentially microtransaction, recurring, session, streaming, stablecoin, card, or Stripe-backed methods depending on the exact provider profile. Its capabilities are discovered and certified rather than assumed equivalent to x402.

### AP2 and card networks

AP2, Visa Intelligent Commerce, Mastercard Agent Pay, shared payment tokens, or related systems produce mandate/token/instruction artifacts that bind user intent and purchase/payment details. These artifacts map to AOPS missions, grants, provider offers, attempts, and receipts. Card authorization, capture, refund, dispute, and network-token lifecycles remain adapter-specific.

### Circle

Circle Wallets, Gateway, CCTP, Nanopayments, and Agent Stack capabilities are represented as separate provider/rail profiles. Gateway unified balance, wallet policy, nanopayment, bridge, and standard wallet transaction semantics are not collapsed into one “Circle payment.”

## Failure behavior

- Timeout before request leaves host: retry same attempt.
- Timeout after request may be accepted: mark unknown and lookup.
- Webhook duplicate/reordered: store, deduplicate, and apply only valid transition.
- Provider 429/5xx: bounded same-attempt retry if acceptance is known impossible; otherwise unknown.
- Quote expired or changed: new authorization/reservation required.
- Signed/tokenized/mandated but undispatched: block new dispatch where possible and retain or quarantine exposure until the authorization is authoritatively invalid or expired.
- Reorg after confirmation: transition through adapter-specific reorg/reversal and correcting ledger entry.
- Provider lookup unavailable: keep unknown and alert.
- Refund initiated but not settled: refund remains pending.
- Adapter contract/API changes: revoke certificate until conformance reruns.

## Requirements

- `AOPS-ADP-001` (`S0`): Every external submission MUST have a durable unique attempt.
- `AOPS-ADP-002` (`S0`): Same key with changed payload MUST be rejected.
- `AOPS-ADP-003` (`S0`): Post-submit timeout MUST become `unknown`.
- `AOPS-ADP-004` (`S0`): Unknown attempts MUST use authoritative lookup and MUST NOT be blindly resubmitted.
- `AOPS-ADP-005` (`S0`): Webhooks MUST be authenticated, deduplicated, and disorder-tolerant.
- `AOPS-ADP-006` (`S0`): Adapter state MUST map without discarding rail-specific uncertainty or finality.
- `AOPS-ADP-007` (`S0`): Adapter/network/provider changes MUST invalidate certification.
- `AOPS-ADP-008` (`S1`): Refund, reversal, dispute, and cancellation capabilities MUST be explicitly declared.
- `AOPS-ADP-009` (`S0`): Silent provider, rail, network, asset, or destination substitution MUST be prohibited.
- `AOPS-ADP-010` (`S0`): Adapter I/O MUST begin only from a durable `dispatching` lease with exact request and provider identity.

## Verification and exit gate

- Adapter contract and capability-schema validation.
- Provider sandbox and testnet suites.
- Duplicate submit and changed-payload same-key tests.
- Timeouts before, during, and after provider acceptance.
- Webhook spoof, replay, duplicate, reorder, and delay.
- 429/5xx, stale quote, expired authorization, and provider outage.
- Partial capture/delivery, refund, reversal, and dispute where applicable.
- Chain finality and reorg where applicable.
- Provider credential rotation.
- Low-limit mainnet canary and external reconciliation.
- Sealed, expiring financial execution-profile gate result and a dependent composite release certificate for production enablement.
