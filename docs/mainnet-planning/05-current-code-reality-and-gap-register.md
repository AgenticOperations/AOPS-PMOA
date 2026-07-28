---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [code-audit, gaps, baseline, current-state]
---

# Current Code Reality and Gap Register

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/qa/2026-07-12-testnet-release-evidence|Testnet evidence]] | [[10-Projects/Web3-Builds/agentOps/HANDOFF|Current handoff]] | [[10-Projects/Web3-Builds/agentOps/research/agent-economic-orchestration/raw/aops-current-product-baseline|Prior product baseline]]

## Evidence boundary

This register separates exact source inspection from execution evidence.

- `main`: `ef4e42e3a2bb2072d03917459974d59183708692`
- Paid-HTTP candidate: `a0556e69a0ab03d5fa4153b654d30746766c3ef2`
- The paid-HTTP candidate is pushed but not merged into `main`.
- Prior checkpoint verification reported lint, typecheck, production builds, and `878/878` tests on the candidate.
- Candidate design and proof are commit-pinned at `a0556e6:docs/superpowers/specs/2026-07-13-x402-paid-http-design.md` and `a0556e6:docs/qa/2026-07-13-x402-paid-http-evidence.md`; they are branch artifacts, not files on `main`.
- Checkpoint packaging is commit-pinned at `a0556e6:docs/superpowers/specs/2026-07-26-pmoa-checkpoint-2-submission-design.md` and `a0556e6:submission/pmoa-checkpoint-2/README.md`.
- No public HTTPS production deployment, mainnet proof, or Arc settlement proof is claimed here.
- The source audit underlying this register was read-only; it did not rerun the suite.

## Domain status

| Domain | Status | Current capability | Production blocker |
|---|---|---|---|
| Organization and human IAM | Partial | OAuth, users, organizations, memberships, rank roles | Add-member activates immediately; no invitation acceptance, MFA, SSO/SCIM, permission matrix, separation of duties, or session administration |
| Agent identity | Partial | Agents, hierarchy pointer, credentials, connections, rotate/revoke | Hierarchy does not implement attenuated delegation; no workload federation, sponsor lifecycle, or external credential broker |
| Missions | Absent | Optional ungoverned purpose context | No mission object, budget, scope, expiry, lifecycle, or completion |
| Policy | Built but unproven | Draft/version/simulation/binding/decision lifecycle | Default no-match is `allow`; limited conditions; no mission, data, obligation, or approver semantics |
| Approvals and grants | Partial | Context-bound expiring one-time approval | Any operator can approve; no maker/checker, quorum, durable grant, global kill switch, or escalation |
| Runtime enforcement | Partial | HTTP check, x402 authorization, tool checks, MCP mediation | Direct use is advisory and bypassable; check and record are separable; not all execution paths are mediated |
| Provider commerce | Absent/partial candidate | Tool metadata; paid x402 merchant flow on candidate | No provider identity, offer, destination-change process, delivery, refund, dispute, or service lifecycle |
| Treasury and ledger | Partial | Sources, balances, budgets, reservations/events, wallet/liquidity jobs | Counter accounting rather than double entry; no accounting reconciliation, correction, period close, or budget windows |
| Signing and execution | QA/partial candidate | Testnet Circle worker and retained paid-HTTP attempts | Static environment secret boundary; no KMS/HSM rotation, operator reconciliation, or bounded production signer profile |
| Evidence and operations | Partial | Application hash chain, query/verify, readiness improvements on candidate | Prefix-only verification, no independent seal/export/retention executor; no HA, restore, SLO, on-call, or DR proof |

## P0 blockers

### Pre-policy external request

The paid-HTTP candidate performs the outbound discovery request before payment policy evaluation and durable attempt creation. Because supported methods include `POST`, `PUT`, `PATCH`, and `DELETE`, a nonconforming provider can cause an external side effect before AOPS authorizes it.

Required correction:

1. Persist the action intent and canonical request hash.
2. Apply target/method/data policy before any egress.
3. Create an idempotency fact for discovery.
4. Permit the outbound request.
5. If a payment requirement is returned, bind quote, destination, amount, and adapter profile to a second payment decision and reservation.
6. Record direct non-402 outcomes as external execution, not as an untracked probe.

### Fail-open policy

The current policy reduction starts from `allow`. Production policy must default deny for governed destructive and financial operations, with explicit migration and simulation because changing this behavior can break existing agents.

### Ambiguous payment and reconciliation

The candidate persists `reserved`, `submitting`, `settled`, `failed`, and `unknown`, which is a real improvement. It still lacks the complete worker and operator workflow needed to resolve `submitting` and `unknown`, inspect provider truth, retain or release reservations, post the ledger, and close incidents.

### Accounting

Current budgets use counters rather than an append-only double-entry journal. Mainnet execution requires balanced postings for reservation, settlement, fee, release, refund, reversal, dispute, and correction.

### Evidence integrity

Current chain verification checks a bounded prefix and does not compare the verified tail against the canonical head. Tail deletion can therefore evade the check. Evidence is also application-admin mutable and lacks signed export, independent anchoring, legal hold, retention execution, and privacy deletion workflows.

### Recovery platform

The repository lacks verified production HA, PITR, isolated restore, queue recovery, leader election, SLOs, alerts, on-call, incident runbooks, and safe money reopen after restore.

## Material claim contradictions

- Landing copy says “fail closed” while no-match policy permits `allow`.
- Hierarchy copy implies inherited authority while `parent_agent_id` is only a structural pointer.
- Budget copy implies daily/monthly windows while stored budgets are cumulative.
- “Canonical audit chain” may be mistaken for independent immutable proof.
- Live/mainnet configuration concepts exist while runtime remains testnet constrained.
- Older architecture diagrams may release a reservation after a generic response; the newer target correctly keeps submitted uncertainty held until reconciliation.

These claims must be corrected or feature-flagged before external production marketing.

## Current strengths to preserve

- Real organization/team/agent/connection structure.
- Immutable policy versions and simulation.
- Context-bound approval consumption.
- Testnet Circle worker separation.
- Encrypted Circle session material and paid-response retention.
- Candidate request hashing and idempotency identity.
- Candidate SSRF, DNS, redirect, timeout, and body-size controls.
- Candidate reservation before provider payment.
- Broad automated integration coverage.
- Existing console, MCP, and API product surfaces.

## Exit from baseline status

This register becomes historical when:

1. Each domain has a code mapping and passing requirement evidence.
2. The branch strategy is resolved and an exact production candidate is pinned.
3. P0 corrections pass fault-injected cross-domain journeys.
4. A first Core gate result is produced and then bound into an appropriately scoped composite release certificate before any production enablement.
5. One mainnet adapter and one tenant/use-case profile pass canary and reconciliation.
