---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [roadmap, adapters, providers, expansion]
---

# Phase 4 — Provider and Rail Expansion

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/roadmap/00-build-sequence|Build sequence]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/07-provider-and-service-commerce|Provider commerce]] | [[10-Projects/Web3-Builds/agentOps/creative-free/15-agentic-finance-market-and-product-reset|Market reset]]

## Objective

Expand from one proven Circle mainnet profile and one Arc testnet profile into a provider-neutral control platform without weakening the stable core.

## Expansion families

- Additional x402 networks, facilitators, and wallet providers.
- Circle Nanopayments and other Agent Stack profiles.
- MPP through Stripe, Tempo, or another supported provider.
- AP2 mandate verification and mapping.
- Visa/other card-network agent token or instruction adapters as access becomes available.
- Wallet transfer, CCTP/bridge, swap, and contract-action profiles.
- Cloud/provider credits and standard SaaS APIs.
- Self-service provider seller onboarding, public offer catalog, reputation/discovery, and broad delivery/refund/dispute operations beyond the minimal buyer-side model.
- Nonfinancial controlled tools and browser/egress integrations.

## Admission criteria

A new adapter enters implementation only when:

- A real customer/provider journey requires it.
- Official documentation and access exist.
- Custody, signing, settlement, refund, dispute, and data responsibilities are understood.
- The adapter can preserve AOPS authority and evidence bindings.
- External lookup and reconciliation are possible.
- Market profile can be approved.
- Engineering and operational cost is justified.

## Adapter factory

The platform provides:

- Capability schema.
- Adapter SDK/interface.
- Shared idempotency and attempt store.
- Webhook authentication framework.
- State-mapping and property-test harness.
- Reconciliation worker framework.
- Evidence and operator UI components.
- Conformance and certificate tooling.

Shared tooling cannot erase provider-specific semantics.

## Marketplace sequencing

Provider discovery follows:

1. Verified provider identity.
2. Verified endpoint/destination.
3. Versioned offer.
4. Governed buyer execution.
5. Delivery and acceptance evidence.
6. Refund/dispute operations.
7. Reliability history.

A directory without these controls is not a trusted marketplace.

## Exit gate

Each new financial profile earns its own execution-profile gate result, completes its own mainnet canary, and is bound with the applicable market result into a separately scoped composite release certificate that can be independently revoked. Runtime profiles pass their separate controlled-path conformance gate. Core changes are permitted only when a genuinely stable cross-provider requirement emerges and dependent release certificates are reissued.
