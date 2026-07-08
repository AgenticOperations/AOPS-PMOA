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
