---
created: 2026-07-26
project: agentOps
ecosystem: circle
tags: [pmoa, checkpoint-2, arc, circle, submission]
---

# AOPS — PMOA Checkpoint 2

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/README]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/superpowers/specs/2026-07-26-pmoa-checkpoint-2-submission-design]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/qa/2026-07-13-x402-paid-http-evidence]]

## Submission

- **Track:** Agentic Economy
- **Repository:** `https://github.com/AgenticOperations/AOPS-PMOA`
- **Latest working branch:** `feat/mcp-paid-http`
- **Tested code checkpoint:** `add41aa`
- **Verification:** lint, typecheck, production builds, and `878/878` tests
- **Presentation:** [AOPS-PMOA-Checkpoint-2.pptx](AOPS-PMOA-Checkpoint-2.pptx)

## Progress Summary

AOPS is a working Circle-native authority layer for teams operating autonomous
agents. Organizations can define versioned policies and role assignments, issue
scoped agent credentials, enforce spend and rate limits, require one-time human
approval, execute paid HTTP requests through hosted MCP, and preserve
hash-chained evidence. The current feature branch proves a real MCP-only agent
settling `0.001 USDC` through Circle Gateway, receiving the paid resource, and
replaying the same request without a duplicate settlement. The next milestone
is to make Arc the native USDC execution environment and harden this foundation
into a resilient company product.

## What Works Now

- Google organization onboarding and tenant-isolated access.
- Organization, team, role, and managed-agent control surfaces.
- Versioned policies, simulation, activation, assignment, and inheritance.
- Spend limits, rate limits, service scope, rail constraints, and approval
  thresholds.
- Hosted Streamable HTTP MCP and local stdio MCP with one eight-tool contract.
- Credential issue, rotation, revocation, pause, and deactivation controls.
- Organization-scoped Circle Agent Wallet connection and Gateway execution.
- Real MCP-only policy outcomes: allow, observe, deny, needs-more-information,
  rate limit, approval, budget, and payment-access boundaries.
- Paid HTTP/x402 execution with exact merchant-response return.
- Atomic budget reservation, explicit reconciliation, and replay-safe recovery.
- Classified, tenant-fenced, hash-chained evidence.

## Proof Index

| Claim | Evidence |
|---|---|
| Complete verification gate | [`docs/qa/2026-07-13-x402-paid-http-evidence.md`](../../docs/qa/2026-07-13-x402-paid-http-evidence.md), fresh `npm run verify` on 2026-07-26 |
| Real MCP-only paid request | Same release evidence: Claude Haiku called `agentops.payment_x402` |
| `0.001 USDC` Gateway settlement | Payment event and Gateway transaction recorded in the release evidence |
| Paid resource returned | Merchant response `HTTP 200`, resource `gateway-weather` |
| Replay did not repay | Same payment, attempt, transaction, and response returned on replay |
| Credential lifecycle | Browser-issued credential rotation and revocation tested with real MCP-only agents |
| Failure-safe holds and recovery | Adversarial recovery matrix covering concurrency, crashes, lost responses, redirects, and unsafe destinations |
| Broader product E2E | [`docs/qa/2026-07-12-testnet-release-evidence.md`](../../docs/qa/2026-07-12-testnet-release-evidence.md) |

## Circle and Arc Direction

The current product proves its control architecture through Circle Agent
Wallet, Gateway, x402, and Circle-supported test rails. Base, Arbitrum, Polygon,
Optimism, and Avalanche are compatibility evidence rather than the product
identity.

The next milestone focuses on:

1. Arc Testnet USDC settlement.
2. Arc-aware wallet and Gateway execution.
3. A governed paid-service workflow settling on Arc.
4. Production resilience, observability, and recovery hardening.
5. Mission, provider, and outcome-oriented product UX.

## Honest Boundary

- Arc-native settlement is next; it is not claimed as current proof.
- The current evidence is testnet-only and locally verified.
- No public production deployment is claimed or required for Checkpoint 2.
- The paid HTTP feature remains unmerged on `feat/mcp-paid-http`.
- Circle wallet connection is organization-scoped, not per-agent wallet
  provisioning.
- Scheduled autonomous liquidity rebalancing is not active.

## Thesis

> Programmable money needs programmable authority.
