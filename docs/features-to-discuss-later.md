---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [build-pmoa, later-features, credentials, policy]
---

# Features To Discuss Later

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-1-core-product-spine]] | [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/40-final-implementation-readiness-and-build-sequence]]

This file keeps useful product ideas that should not leak into the active build before their section is ready.

## Credential-Level Gating

Current Section 1 decision:

- Every agent can receive a single neutral `agent_credential`.
- The credential authenticates which configured agent is calling agentOps.
- The credential does not currently decide what the agent is allowed to do.
- During early product tests, one credential can exercise all currently built Section 1 workflows for that agent.

Why this is deferred:

- Credential scoping is authorization, not identity.
- Authorization belongs beside the policy engine, approval spine, MCP/runtime integration, and financial controls.
- Adding credential tiers now would create fake product semantics before we know which calls need credential-specific restrictions.

Future questions:

- Should credentials carry coarse scopes such as read-only, telemetry write, policy check, payment request, or admin agent?
- Should credential scopes compile into the Section 2 policy engine or remain a pre-policy authentication guard?
- Should the same agent have multiple credentials for different runtimes, environments, or deployment surfaces?
- How should rotation work when one credential is bound to a production runtime and another to local development?
- What minimum credential model is needed for an external auditor agent that can inspect an org but cannot mutate it?

Product boundary:

- Credentials answer "which configured agent is this?"
- Policies answer "what is this agent allowed to do now?"
- Approvals answer "does this specific action need a human decision?"
- Audit answers "what happened, under which identity and decision context?"

## Autonomous Treasury Liquidity Management

Current product boundary:

- Payment requests already select an exact-wallet or Gateway x402 rail.
- A request with insufficient destination liquidity can create a `liquidity.prepare` job.
- The existing Circle liquidity worker executes and reconciles cross-chain wallet top-ups and Gateway deposits.
- Operators can inspect balances, liquidity jobs, route recommendations, and initiate a manual rebalance.
- Payment access, budgets, transaction caps, approval thresholds, policies, and supported rails remain enforced before funds move.

Why full automation is deferred:

- The current recommendation model is exact-wallet-only and based on a 24-hour demand window.
- Request-triggered preparation is reactive; it does not proactively maintain Gateway hot balances before a payment arrives.
- Autonomous execution needs reservations, in-flight balance accounting, deficit-aware transfer amounts, duplicate-job prevention, cooldowns, and organization-level movement limits before it can safely run unattended.
- A fixed cron over the existing recommendations would magnify overfunding and concurrent-job risks rather than create a reliable treasury controller.

Future architecture:

1. Add a treasury planner above the existing provider-job and worker system.
2. Run planning periodically and after material payment, balance, or job events.
3. Maintain low, target, and high watermarks for every enabled exact-wallet and Gateway bucket.
4. Calculate deficits using available, reserved, and incoming liquidity rather than gross balances.
5. Reserve source funds and deduplicate destination jobs before creating existing `liquidity.prepare` jobs.
6. Prefer unified Gateway treasury transfers when the Agent Stack signing path is verified, while retaining the current bridge path as a fallback.
7. Preserve the existing API, MCP, policy, approval, payment, job, audit, and worker contracts.

Admin configuration surface:

- Place `Treasury automation` under Payments rather than adding another top-level console section.
- Expose automatic liquidity management on/off, minimum treasury reserve, maximum movement per action, daily movement limit, approval threshold, and allowed networks.
- Keep scheduler frequency internal; administrators configure financial risk, not worker timing.
- Put per-chain exact-wallet and Gateway watermarks, maximum hot liquidity, and cooldowns in an Advanced section.
- Show current automation state, pending movements, reserved liquidity, last planner run, recent automated movements, and blocked or failed preparations.

Safe rollout:

1. Correct deficit calculations and concurrency handling.
2. Run the planner in observation-only mode and compare recommendations with actual demand.
3. Enable capped exact-wallet automation on testnet.
4. Enable capped Gateway hot-bucket preparation on verified testnet rails.
5. Retain manual rebalance as an emergency operator override.
