---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [assurance, adapters, conformance, mainnet]
---

# Adapter Conformance Standard

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/10-financial-execution-and-adapters|Financial adapters]] | [[10-Projects/Web3-Builds/agentOps/creative-free/12-unified-rail-architecture-and-contracts|Prior adapter contract]]

## Financial execution-profile gate identity

Every financial execution-profile gate result pins:

```text
adapter version
× provider API version
× provider account
× environment
× rail/protocol
× network/chain ID
× asset and contract addresses
× facilitator/processor
× webhook schema
× signer/custody profile
```

Changing any element makes the certificate stale. Testnet and sandbox evidence never certify mainnet.

## Mandatory adapter contract

The adapter declares:

- Operations: quote, authorize, sign, submit, lookup, cancel, capture, refund, reverse, dispute.
- Request and response schemas.
- Provider and network authentication.
- Idempotency key scope, payload binding, and retention window.
- Retryable-before-submit boundary.
- States and terminality.
- Pending, unknown, expiry, finality, and reorg semantics.
- Webhook authentication, duplicate, ordering, and replay behavior.
- Fee, FX, rounding, minimum, maximum, and rate limits.
- Destination and asset verification.
- External source of truth.
- Provider support and escalation.
- Data and retention behavior.

An unsupported capability returns `unsupported`; it is not emulated through a different rail without new authority.

## Conformance suite

Every adapter passes:

1. Happy-path submission and authoritative lookup.
2. Duplicate same-key same-payload request.
3. Same-key changed-payload rejection.
4. Timeout before provider acceptance.
5. Timeout after possible provider acceptance.
6. Process crash before and after submit.
7. Lost response.
8. Authenticated duplicate webhook.
9. Out-of-order and delayed webhook.
10. Spoofed or invalid webhook.
11. Provider 429 and 5xx.
12. Stale/changed quote.
13. Wrong payee, asset, network, or contract.
14. Credential rotation and revocation.
15. Refund, reversal, cancellation, partial result, and dispute where supported.
16. Chain finality/reorg where applicable.
17. Provider/account outage.
18. External reconciliation and one-economic-effect proof.

## Mainnet canary

After sandbox/testnet conformance:

1. Enable exact adapter profile for an internal controlled tenant.
2. Apply minimal wallet/provider balance and per-action/period limits.
3. Execute representative positive and negative journeys.
4. Verify external state directly.
5. Reconcile ledger and provider/network balance.
6. Verify delivery and evidence.
7. Exercise refund or safe compensating path when applicable.
8. Review fees, latency, webhook behavior, and provider limits.
9. Approve and seal the financial execution-profile gate result.
10. Raise limits only through staged approved changes.

## Continuous invalidation and revocation

The execution-profile gate result becomes invalid and any composite release certificate containing it automatically pauses when:

- Unknown backlog breaches SLO.
- Reconciliation has unexplained difference.
- Provider API/webhook behavior changes.
- Credential or signer is compromised.
- Network/contract/asset behavior changes.
- Certificate evidence expires.
- Provider incident invalidates stated assumptions.
- Required lookup or refund path becomes unavailable.

In-flight work remains in controlled resolution.

## Requirements

- `AOPS-CNF-001` (`S0`): Certificate MUST identify the complete adapter tuple.
- `AOPS-CNF-002` (`S0`): Adapter MUST pass post-submit ambiguity and duplicate-effect tests.
- `AOPS-CNF-003` (`S0`): External truth and internal ledger MUST reconcile.
- `AOPS-CNF-004` (`S0`): Mainnet MUST have its own low-limit canary.
- `AOPS-CNF-005` (`S0`): Material provider/network change MUST revoke certificate.
- `AOPS-CNF-006` (`S1`): Unsupported operations MUST be explicit.
- `AOPS-CNF-007` (`S1`): Operational and escalation owner MUST be named.

## Exit criterion

An adapter is eligible for inclusion only when the exact profile has fresh conformance, canary, reconciliation, evidence, security, signer, and operations approval. Production enablement still requires a composite release certificate containing passing Core, execution-profile, and market results.
