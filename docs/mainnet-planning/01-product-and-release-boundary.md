---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [product, boundary, release, mainnet]
---

# Product and Release Boundary

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/creative-free/11-category-reset-and-product-kernel|Product kernel]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/PRODUCT|Current product]]

## Product definition

AOPS is the organizational authority, execution-control, treasury-accounting, and evidence layer for teams operating autonomous agents.

It gives an organization one place to answer:

- Which human or machine principal is acting?
- Under which mission and delegated authority?
- Which policy version decided the request?
- Was approval required and properly consumed?
- Was budget and liquidity reserved before execution?
- Which provider, rail, account, wallet, or tool executed it?
- What external outcome is authoritative?
- How was the economic effect posted and reconciled?
- Can an independent reviewer reconstruct the complete chain?

AOPS is broader than a wallet policy layer because it governs operational and financial actions across an agent fleet. It is narrower than a bank, custodian, merchant of record, payment network, acquiring platform, KYC/KYB provider, or universal proxy for all internet traffic.

## Primary customer

The first production customer is a technical organization operating multiple agents that invoke tools, purchase APIs or services, and initiate bounded financial actions. It needs central authority, budget control, human intervention, failure recovery, accounting, and evidence without rebuilding those controls in every agent.

The product supports:

- Organization owners and administrators.
- Developers and runtime integrators.
- Agent operators.
- Approvers.
- Treasury and finance operators.
- Security, GRC, and audit users.
- Provider operators.
- Autonomous workloads.
- Restricted AOPS support and break-glass operators.

## Stable core versus adapters

The stable core owns organization, identity, mandate, policy, approval, grant, reservation, ledger, reconciliation, evidence, incidents, and release certification.

Execution profiles translate this stable contract into one controlled external path. A financial adapter is one execution-profile subtype. Profiles may represent:

- x402.
- MPP.
- AP2 or card-network mandates.
- Circle Wallets, Gateway, CCTP, or Nanopayments.
- Bank, card, wallet, stablecoin, cloud-credit, procurement, or SaaS provider APIs.
- Nonfinancial MCP, HTTP, A2A, browser, or tool execution paths.

Execution profiles never redefine organizational authority, ledger truth, evidence semantics, or production certification. They expose their own capabilities, limitations, terminal states, idempotency windows, bypass boundaries, finality rules, dispute semantics, and external source of truth.

## Provider and custody boundary

AOPS should integrate customer-owned or appropriately licensed partner accounts rather than pooling customer funds or pretending to replace regulated providers. The product may hold execution authority over customer-configured instruments; that authority creates a real security and operational boundary even if legal custody remains elsewhere.

Therefore every production profile must state:

- Who legally holds funds.
- Who controls each private key or signing policy.
- Who can change a payment destination.
- Maximum loss for each compromised component.
- Which constraints are cryptographic, provider-enforced, or software-only.
- Which external party handles settlement, refund, dispute, sanctions, KYC/KYB, tax, or merchant obligations.

“Non-custodial” is not used as a substitute for this analysis.

## Circle and Arc boundary

Circle is the first strategic provider family, not the definition of the core. The Circle Agent Stack already provides wallets, spending policies, x402 service discovery, Nanopayments, and multichain operations. AOPS must complement those primitives with organizational missions, hierarchy, cross-provider policy, approval, reservations, accounting, reconciliation, incidents, and evidence rather than duplicating Circle’s wallet UI.

Arc Public Testnet is the Arc target while Arc mainnet is unavailable. Arc-specific work is certified as a separate financial execution profile. A Circle-supported mainnet rail can establish real-money production competence, but it cannot be presented as Arc mainnet proof.

## Release model

Production enablement requires one signed `ReleaseCertificate` that binds three independently evaluated gate results:

```text
CoreGateResult
  + ExecutionProfileGateResult
  + MarketEligibilityResult
  → ReleaseCertificate
```

The Core gate result pins:

- Release digest.
- Policy, ledger, and evidence schema versions.
- Migration digest.
- Runtime enforcement profile.
- Applicable domain requirements.

The execution-profile gate result pins common transport, deployment, credential, enforcement-strength, and conformance identity. A financial subtype additionally pins:

- Adapter and provider API versions.
- Provider account and environment.
- Rail, network, chain ID, and asset/contract addresses.
- Webhook schema and authentication method.
- Signer profile.
- Conformance run and canary evidence.

The market eligibility result pins:

- Legal entity and jurisdiction.
- Tenant and intended use case.
- Data residency and retention.
- Provider eligibility.
- Regulatory and contractual obligations.
- Approved exposure and transaction limits.

A component gate result may pass before the other two, but it never enables production on its own. The machine schema in `assurance/release-certificate-template.json` is intentionally the composite enabling artifact; it embeds the exact three results, evidence, approvals, scope, epoch, expiry, and revocation conditions in one enforceable certificate.

## Explicit non-goals for the Production Core

- Supporting every rail at first release.
- Becoming a general ledger for the customer’s entire business.
- Becoming merchant of record.
- Inferring legal compliance automatically.
- Treating an LLM recommendation as authorization.
- Allowing native provider credentials to bypass AOPS while claiming full enforcement.
- Claiming semantic task completion from a payment receipt alone.
- Claiming exactly-once execution across external networks.
- Putting personal data, secrets, prompts, or response bodies onchain.

## Success criterion

A production tenant can enroll people and agents, define a mission and authority, mediate a real action through a certified runtime profile, reserve and execute a bounded payment through one certified financial mainnet profile, recover from ambiguous external failure without duplication, reconcile internal and external truth, export independently verifiable evidence, and stop new authority during an incident.
