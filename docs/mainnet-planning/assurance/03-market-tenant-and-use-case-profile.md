---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [assurance, market, tenant, compliance, use-case]
---

# Market, Tenant, and Use-Case Profile

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/01-product-and-release-boundary|Product boundary]] | [[10-Projects/Web3-Builds/agentOps/PARTNER-ONBOARDING|Partner onboarding]]

## Purpose

Technical readiness does not establish that a legal entity may offer a provider/rail/use case to a tenant in a jurisdiction. This profile records the exact commercial, contractual, data, and regulatory boundary.

It is a structured readiness decision, not automated legal advice or a substitute for qualified counsel.

## Profile identity

The profile pins:

- AOPS legal entity.
- Tenant legal entity.
- Customer type and intended operators.
- Countries/jurisdictions.
- Environment.
- Use case and prohibited uses.
- Assets, currencies, networks, and providers.
- Custody/signing responsibility.
- Provider contracts and account eligibility.
- Data categories, processing purposes, residency, subprocessors, and retention.
- Transaction and exposure limits.
- KYC/KYB/sanctions/fraud responsibility where applicable.
- Tax, invoice, refund, dispute, and reporting responsibility.
- Support, incident, breach, and complaint process.
- Required customer terms and disclosures.

## Use-case examples

Each is certified independently:

- Agent purchases low-value API/data service.
- Agent pays another agent/provider.
- Agent initiates stablecoin transfer.
- Agent creates a bridge or swap instruction.
- Agent uses a card-network token for merchant checkout.
- Agent manages provider credits.
- Agent triggers nonfinancial high-risk tool action.

An API purchase profile does not authorize payroll, consumer remittance, investment management, lending, custody, or unrestricted trade execution.

## Responsibility matrix

For each profile, record who owns:

- Customer and provider onboarding.
- Wallet/account and funds.
- Signing and transaction authorization.
- Screening and fraud controls.
- Payment settlement.
- Service delivery.
- Refund, reversal, dispute, and chargeback.
- Accounting and tax documentation.
- Data-controller/processor obligations.
- Incident and breach notification.
- Support and complaints.

Outsourcing does not erase AOPS responsibilities for controls it operates or systems it can affect.

## Tenant readiness

Before enablement, the tenant must:

- Complete organization, privileged identity, and sponsor setup.
- Accept applicable terms and provider agreements.
- Connect eligible provider/wallet/custody accounts.
- Configure policy, missions, approvals, limits, and emergency contacts.
- Complete data and retention choices.
- Pass onboarding and emergency journeys.
- Receive operator training.
- Accept current exclusions and maximum exposure.

## Compliance mapping

Every mapped control identifies:

- Control/requirement ID.
- Scoped system and data.
- Control owner.
- Test and evidence.
- Collection frequency and retention.
- Exception process.
- External assessor or counsel where required.

The product may say “designed to support” or “mapped to” a framework. It cannot claim SOC 2, ISO, PCI, GDPR, licensing, or regulatory compliance without the applicable assessment and legal basis.

## Requirements

- `AOPS-MKT-001` (`S0`): Every production tenant MUST have an approved legal-entity/jurisdiction/use-case profile.
- `AOPS-MKT-002` (`S0`): Provider and customer eligibility MUST be verified for the exact profile.
- `AOPS-MKT-003` (`S0`): Custody, authorization, screening, settlement, refund, and data responsibilities MUST be explicit.
- `AOPS-MKT-004` (`S1`): Customer terms MUST describe enforcement boundaries, exclusions, and failure handling.
- `AOPS-MKT-005` (`S0`): A material legal/provider/data change MUST revoke or re-review the profile.
- `AOPS-MKT-006` (`S1`): Production limits MUST match the approved maximum exposure.

## Exit criterion

Privacy/legal/compliance, security, treasury, provider, and product owners approve the profile; tenant onboarding and emergency tests pass; every required external contract is active; and there is no unresolved prohibited-use or responsibility gap.
