---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [journey, runtime, tools, nonfinancial]
---

# Journey: Governed Nonfinancial Action

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/06-runtime-enforcement|Runtime enforcement]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/04-policy-and-authority|Policy and authority]]

## Outcome

An authenticated agent invokes a tool, API, browser action, or A2A operation through a certified enforcement path; AOPS authorizes before egress, injects any required credential without exposing it, returns the result, and preserves evidence.

## Flow

| Step | Owner | State/evidence |
|---|---|---|
| Authenticate connection and agent | Agent identity | Principal and tenant |
| Canonicalize target, method, arguments, body hash, data class, effect | Runtime | Durable `ActionIntent(received)` |
| Resolve mission and policy | Mission/policy | Immutable snapshots |
| Evaluate | Policy | Deny, approval required, or allow |
| Obtain/consume grant if required | Approvals | One-time grant |
| Apply egress and credential controls | Runtime | Controlled execution context |
| Create attempt and dispatch lease | Runtime | Durable `RuntimeAttempt(dispatching)` with exact request before egress |
| Invoke external service | Runtime adapter | Provider/tool response |
| Classify result | Runtime | completed, failed, or unknown |
| Seal evidence | Evidence | Journey bundle |

## Hard boundary

The outbound request, including a supposed discovery request, never precedes durable intent and policy. A denied action produces zero egress.

## Failure cases

- Policy unavailable: deny new destructive action.
- Credential broker unavailable: fail before egress.
- Target resolves to private/internal address: reject.
- DNS changes after validation: pinned lookup or revalidation rejects.
- Provider accepts request but response is lost: attempt becomes unknown; replay does not create a second side effect.
- Agent disconnects: result remains retrievable through the same idempotency key.
- Oversized or malicious response: bounded abort; credentials and internal headers stripped.
- Tool output attempts prompt injection: treated as untrusted data, not policy instruction.
- Emergency epoch changes before execution: grant rejected.

## Required assertions

- Denied `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` produce no outbound request.
- Direct provider credential is unavailable to the agent.
- Duplicate calls with the same key and payload produce one external effect.
- Same key with changed payload is rejected.
- Agent, mission, provider, and policy suspension take effect on next new action.
- Unknown remains recoverable across process restart.
- Evidence reconstructs request, authority, egress, result, and caller response without secret leakage.

## Exit criterion

At least one MCP and one direct SDK/HTTP execution profile pass the same behavior suite. Any profile where direct bypass remains possible is labeled mediated, not controlled.
