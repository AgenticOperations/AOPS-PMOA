---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [domain, runtime, mcp, proxy, sdk, enforcement]
---

# Runtime Enforcement

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/05-approvals-grants-and-emergency-controls|Approvals and grants]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/superpowers/specs/2026-07-12-hosted-mcp-design|Hosted MCP design]]

## Scope and ownership

This domain owns the action gateway, MCP service, SDK enforcement hooks, HTTP/data proxy, A2A entry, tool gateway, runtime action intents, mediation, credential injection boundary, action result, and runtime enforcement profile.

It does not decide policy, hold money, sign financial payloads, define provider offers, or own external settlement truth.

## Enforcement profiles

| Profile | Enforcement claim |
|---|---|
| `advisory` | AOPS evaluates a reported action; caller may ignore it. Never marketed as enforced. |
| `mediated` | Action uses AOPS gateway, but direct provider credentials or egress may exist. |
| `controlled` | AOPS owns the only usable credential/signing/egress path for the scoped action. |
| `network-enforced` | Runtime or network structurally prevents direct bypass for the certified destination class. |

Production certificates list which paths and action classes are controlled. Uncontrolled paths are explicitly excluded and disabled for financial claims.

## Required product capabilities

- Hosted MCP endpoint with secure discovery and authentication.
- SDK for canonical action construction and deterministic response handling.
- HTTP/data gateway for governed external calls.
- A2A and tool-call mediation.
- Runtime connection enrollment, rotation, and revocation.
- Action intent persistence before egress.
- Policy, mission, approval, grant, and emergency-epoch enforcement.
- Safe provider credential injection after authorization.
- SSRF, DNS, redirect, method, content-type, body-size, response-size, and timeout controls.
- Streaming/bounded result return without storing unnecessary payload.
- Request and response content classification.
- Direct-bypass prevention or detection.
- Structured denial, approval-required, unknown, and recovery responses.
- Runtime telemetry and evidence correlation.

## Governed action flow

1. Authenticate connection and workload.
2. Derive tenant and environment.
3. Canonicalize method, target, tool, arguments, body hash, data classification, and intended effect.
4. Persist `ActionIntent` and idempotency binding.
5. Resolve mission and effective policy.
6. Deny, request approval, or issue/consume a grant.
7. Apply egress, credential, provider, and network controls.
8. Create the durable `RuntimeAttempt` with exact request and provider/idempotency identity.
9. Acquire a dispatch lease and persist `RuntimeAttempt(dispatching)`.
10. Invoke externally.
11. Bound and classify the result.
12. Record completed, authoritatively failed, or unknown outcome.
13. Return result and evidence reference to the agent.

The first external request is part of the governed action. “Discovery” is not exempt from policy merely because no payment has yet been presented.

## MCP security

- Access tokens are issued for the AOPS MCP resource and validated for audience.
- Upstream token passthrough is forbidden.
- OAuth authorization-server metadata and resource indicators are supported for hosted MCP.
- Redirect URIs, consent, dynamic client registration, and state/PKCE behavior follow the applicable MCP/OAuth profile.
- Tool descriptions do not contain secrets or untrusted remote instructions.
- Tool output is treated as untrusted data.
- MCP methods have per-connection rate, concurrency, and payload limits.

## Credential broker

Provider credentials live in a secret manager or provider/custody system. The runtime supplies a one-time execution reference. A trusted gateway or worker retrieves the credential for the exact approved provider, operation, tenant, and expiry. It injects the credential downstream and strips it from results, logs, traces, and evidence.

## Failure behavior

- Policy unavailable: deny new destructive actions.
- Evidence unavailable: do not execute high-risk action.
- DNS or target changes: reject and require re-evaluation.
- External timeout before acceptance: retry same attempt if proven safe.
- Timeout during/after acceptance: mark unknown.
- Oversized response: abort safely and retain bounded metadata.
- Provider returns non-payment success during paid discovery: record it as an external action; do not discard the attempt.
- Runtime bypass detected: alert, revoke enforcement claim, and optionally suspend connection.
- Agent disconnects after execution: retain result and support replay by idempotency key.

## Requirements

- `AOPS-RUN-001` (`S0`): Every certified external effect MUST have a durable pre-egress action intent.
- `AOPS-RUN-002` (`S0`): Controlled paths MUST prevent usable direct credentials and bypass.
- `AOPS-RUN-003` (`S0`): MCP tokens MUST be audience-valid and MUST NOT be passed through.
- `AOPS-RUN-004` (`S0`): Credentials MUST remain outside agent-visible context and evidence payloads.
- `AOPS-RUN-005` (`S0`): SSRF and unbounded request/response behavior MUST be blocked.
- `AOPS-RUN-006` (`S0`): Post-submit uncertainty MUST return `EXTERNAL_UNKNOWN`.
- `AOPS-RUN-007` (`S1`): Enforcement profiles MUST be explicit per path and action class.
- `AOPS-RUN-008` (`S1`): Replaying an idempotency key MUST return the existing result or state.

## Verification and exit gate

- MCP OAuth and audience-conformance suite.
- Direct-provider bypass and egress-denial tests.
- SSRF, DNS rebinding, IPv4/IPv6, redirect, and hop-header suite.
- Method/body/data pre-policy tests, including zero egress after denial.
- Prompt/tool injection red-team.
- Credential leak scans across logs, traces, errors, results, and evidence.
- Concurrency and replay tests.
- Crash after external acceptance and before response persistence.
- Response loss and agent reconnect.
- Load, backpressure, timeout, and dependency-chaos results.
