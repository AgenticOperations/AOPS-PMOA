---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [domain, providers, services, offers, delivery, disputes]
---

# Provider and Service Commerce

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/06-runtime-enforcement|Runtime enforcement]] | [[10-Projects/Web3-Builds/agentOps/creative-free/13-buyer-and-seller-product-flows|Buyer and seller flows]]

## Scope and ownership

This domain owns provider identity, service listings, offers, invocation contracts, endpoint and destination verification, delivery records, acceptance, entitlements, refunds, disputes, and provider suspension.

It does not own organizational policy, payment execution, financial ledger postings, or external credential custody.

## Required product capabilities

### Buyer side

- Register or discover a provider and service.
- Verify domain, endpoint, provider account, and payment destination.
- Pin offer version, price, asset, billing unit, invocation schema, SLA, refund terms, and delivery contract.
- Approve provider and service scope per tenant.
- Detect offer, destination, endpoint, or ownership change.
- Record delivery and apply deterministic acceptance criteria.
- Request refund, open dispute, and preserve evidence.
- Suspend a compromised or unreliable provider.

### Provider side

- Provider enrollment and responsible operator.
- Service and version management.
- Machine-readable invocation and pricing.
- Supported protocols, networks, assets, and facilitators.
- Signed or integrity-protected offer and receipts where supported.
- Destination-control verification.
- Delivery and status callbacks.
- Refund and dispute response.
- Provider analytics that exclude other tenants’ data.

## Provider lifecycle

```text
submitted → identity_verified → destination_verified → active
                                               ↘ suspended → active
                                               ↘ revoked

Offer:
draft → active → superseded
              ↘ withdrawn

Delivery:
pending → delivered → accepted
                    ↘ rejected → disputed
                    ↘ unknown
```

An offer is immutable once referenced by an action. Changes create a new version. Destination changes suspend payment until control is reverified and an authorized tenant operator accepts the change.

## Offer contract

An offer defines:

- Provider and service version.
- Endpoint and authenticated invocation method.
- Input/output schema and side-effect classification.
- Price, unit, asset, tax/fee treatment, and expiry.
- Payment protocols and supported adapter profiles.
- Payee and destination.
- Idempotency and duplicate-delivery behavior.
- Delivery acceptance evidence.
- Refund, reversal, cancellation, and dispute terms.
- Data processing and retention disclosures.
- Availability and rate limits.

Provider metadata is untrusted until verified. Catalog search and reputation never widen a tenant’s static provider allowlist during the hot path.

## Delivery versus payment

The following are separate:

- Provider accepted payment.
- Network settled payment.
- Provider returned bytes.
- Returned bytes match the agreed schema.
- Service output satisfies deterministic acceptance.
- Business mission succeeded.

A receipt or transaction hash proves only its own scoped fact. AOPS records these stages and permits refund/dispute escalation when payment and delivery diverge.

## Protocol positioning

x402 and MPP can express machine-addressable payment requests. AP2 and card-network systems can express user instructions, mandates, tokens, and receipts. AOPS maps each protocol to the stable provider, offer, mission, grant, delivery, and dispute objects rather than forcing all protocols into one native format.

## Failure behavior

- Provider identity incomplete: sandbox-only or reject.
- Destination changes: suspend payment and require re-verification.
- Quote expires: reevaluate and obtain a new grant.
- Provider returns success without required payment: record delivery; do not invent a payment.
- Payment settles but delivery fails: open delivery exception/refund path.
- Provider self-asserts acceptance: apply independent or tenant-defined checks.
- Provider endpoint becomes private/internal address: SSRF control rejects.
- Provider compromised: suspend offers and revoke related unsubmitted grants.
- Refund promised but not received: reconciliation case remains open.

## Requirements

- `AOPS-PRV-001` (`S0`): Provider endpoint and payment destination MUST be verified before production payment.
- `AOPS-PRV-002` (`S0`): Destination change MUST suspend affected offers and invalidate grants.
- `AOPS-PRV-003` (`S1`): Every invocation MUST pin an immutable offer version.
- `AOPS-PRV-004` (`S0`): Payment settlement MUST NOT be treated as delivery or mission proof.
- `AOPS-PRV-005` (`S1`): Refund, dispute, and non-delivery processes MUST be defined per offer/adapter.
- `AOPS-PRV-006` (`S0`): Provider metadata MUST be treated as untrusted input.
- `AOPS-PRV-007` (`S1`): Provider suspension MUST deny new grants while preserving in-flight reconciliation.

## Verification and exit gate

- Domain, endpoint, account, and destination-control verification.
- Destination substitution and ownership-change tests.
- Offer version and stale-quote tests.
- Catalog poisoning, schema injection, and SSRF suite.
- Duplicate invocation and delivery tests.
- Payment-settled/delivery-failed journey.
- Refund and dispute tabletop with aging.
- Provider compromise and suspension drill.
- Independent reconstruction of offer, payment, delivery, acceptance, and dispute evidence.
