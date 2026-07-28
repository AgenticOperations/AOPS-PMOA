---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [roadmap, sequencing, production, mainnet]
---

# Build Sequence

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/05-current-code-reality-and-gap-register|Gap register]] | [[10-Projects/Web3-Builds/agentOps/HANDOFF|Current handoff]]

## Sequencing principle

The build advances by certified vertical capability, not screen count or isolated domain completion. Shared state/evidence contracts are implemented first; then each domain; then cross-domain journeys; then execution and market profiles.

No later phase may compensate for an unmet earlier S0 gate.

## Current proof lane

The active hackathon/checkpoint work is a parallel, explicitly non-production lane. It may proceed while long-term production phases are designed, but it cannot waive their gates.

Immediate proof work:

1. Resolve the paid-HTTP candidate branch against `main` and pin the resulting commit.
2. Deploy public HTTPS staging for the exact candidate.
3. Run browser onboarding/credential creation and a real-agent MCP/paid-HTTP smoke path.
4. Complete the Arc Public Testnet settlement profile and explorer/evidence proof required by the event.
5. Record every artifact as testnet/current evidence, never mainnet certification.

This lane explains why Arc Testnet proof may occur before the long-term Circle mainnet production phase. The production roadmap remains Phase 0 → Core → first financial mainnet profile; hackathon order does not change safety dependencies.

## Roadmap

| Phase | Purpose | Exit |
|---|---|---|
| 0 | Retire current P0 contradictions and make the candidate safe to extend | Denied action causes zero egress; default-deny migration designed; unknown and audit gaps have tested fixes |
| 1 | Build provider-neutral Production Core | Core gate result passes with money disabled or tightly sandboxed |
| 2 | Certify one Circle-supported mainnet payment profile | Low-limit canary externally reconciles with complete evidence |
| 3 | Certify Arc Public Testnet profile and hackathon proof | Real Arc testnet settlement and Arc-specific evidence; no mainnet claim |
| 4 | Add provider commerce and further rail adapters | Each adapter independently certified; no core redesign |

## Workstream dependencies

```text
canonical kernel + evidence envelope
    ↓
IAM + workload identity + mission
    ↓
policy + approval/grant + runtime mediation
    ↓
ledger/reservation + signer boundary
    ↓
adapter attempt + reconciliation
    ↓
journey/chaos/restore proof
    ↓
Core gate result
    ↓
adapter mainnet canary
    ↓
market/tenant enablement
```

The minimal buyer-side provider model—`ProviderReference`, immutable `OfferSnapshot`, verified destination, and `DeliveryReceipt`—is part of the Core/first financial profile because the paid-service journey depends on it. Self-service seller onboarding, public catalog, reputation, discovery marketplace, and broad refund/dispute operations follow the first reliable buyer execution path.

## Definition of phase completion

A phase completes only when:

- Source and migrations are merged.
- Requirement IDs map to tests and evidence.
- Cross-domain journeys pass.
- Documentation reflects exact implemented behavior.
- No current/target claim drift remains.
- Operational runbooks and UI exist for failure states.
- Fresh independent review finds no open S0/S1 issue.
- Applicable certificate or explicit non-production status is recorded.

## What not to do

- Build every payment adapter before the stable ledger and unknown-state model.
- Split into many microservices before domain contracts and operational ownership are proven.
- Implement audit as a late logging feature.
- Add per-agent wallets without a custody/reconciliation/loss-bound decision.
- Present Arc testnet as Arc mainnet.
- Increase limits because a happy-path transaction succeeded.
- redesign UI ahead of the authoritative operator lifecycle for unknowns, reconciliation, incidents, and evidence.
