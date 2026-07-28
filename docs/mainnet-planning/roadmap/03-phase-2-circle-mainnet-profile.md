---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [roadmap, circle, mainnet, adapter]
---

# Phase 2 — Circle Mainnet Profile

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/roadmap/02-phase-1-production-core|Production Core phase]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/assurance/02-adapter-conformance-standard|Adapter conformance]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/deployment/testnet-circle-worker|Current Circle worker]]

## Objective

Certify one real-money Circle-supported mainnet profile with the smallest useful customer journey and bounded exposure.

This phase chooses one exact adapter tuple; it does not certify every Circle product or chain.

## Decision work

Before implementation, decide and record:

- Buyer use case and market profile.
- Circle product: Agent Wallet, Developer-Controlled Wallet, Gateway/Nanopayments, or another supported path.
- Network and asset.
- Wallet/custody topology.
- Provider/facilitator account.
- Funding and liquidity model.
- Signing and destination boundary.
- Transaction, daily, tenant, and aggregate limits.
- External lookup, webhook, refund, and support behavior.

Official Circle support matrices and provider terms are reverified at decision time.

## Required capabilities

- Provider account enrollment and secret/custody setup.
- Exact adapter and signer profile.
- Wallet/account funding and balance discovery.
- Quote/requirements validation.
- Reservation and double-entry posting.
- Submit, lookup, webhook, unknown resolution, and reconciliation.
- Fees/gas/FX accounting.
- Operator recovery and provider escalation.
- Low-limit tenant onboarding.

## Mainnet canary

- Internal controlled tenant.
- Minimal balance and strict per-action/period limits.
- Positive and denied payment.
- Approval-required payment.
- Duplicate/replay case.
- Lost-response/lookup case where safely injectable.
- External provider/network verification.
- Ledger and balance reconciliation.
- Evidence export and independent verification.
- Refund or documented compensating path.

## Exit gate

- Production Core gate result is valid.
- Exact Circle adapter/profile passes conformance.
- Signer/custody maximum-loss analysis is approved.
- Market/tenant profile is approved.
- Mainnet canary has one economic effect per intent and zero unexplained difference.
- Provider support/escalation and incident runbooks exist.
- Limits increase only through staged signed changes.
