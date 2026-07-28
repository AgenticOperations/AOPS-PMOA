---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [assurance, runtime, mcp, http, sdk, conformance]
---

# Runtime Enforcement Conformance Standard

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/06-runtime-enforcement|Runtime enforcement]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/assurance/05-release-certification-and-revocation|Release certification]]

## Purpose

This standard certifies nonfinancial MCP, HTTP, SDK, A2A, browser, and tool paths. It is separate from financial-adapter conformance because these paths do not necessarily have a rail, asset, signer, settlement, refund, or mainnet lifecycle.

## Profile identity

Every runtime profile pins:

```text
profile kind + version
transport and protocol version
deployment and environment
credential-broker profile
network/egress boundary
TLS and DNS policy
schema/canonicalization version
enforcement strength
supported actions and excluded bypass paths
```

Enforcement strength is one of:

- `advisory` — AOPS reports but cannot prevent bypass.
- `mediated` — calls through AOPS are controlled, but standing native credentials may bypass.
- `controlled` — the certified runtime path holds the only usable credential or network/signing authority for the declared action.

Product claims use the exact strength and scope.

## Mandatory contract

The runtime profile declares:

- Authentication, audience, tenant, agent, and connection binding.
- Target/method/action canonicalization.
- Pre-egress intent and policy behavior.
- Approval/grant behavior.
- Credential injection and redaction.
- SSRF, DNS rebinding, redirect, private-network, port, and response-size policy.
- Durable runtime-attempt and dispatch-lease behavior.
- Idempotency, timeout, cancellation, unknown, and replay semantics.
- Request/response data classification and retention.
- Emergency epoch and certificate-epoch enforcement.
- Direct-bypass inventory and exclusion.

## Conformance suite

1. Denied `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` produce zero egress.
2. Same key/same request produces one effect; changed payload is rejected.
3. Crash before and after dispatch-lease acquisition preserves the correct state.
4. Lost response after possible acceptance becomes unknown.
5. Direct provider credentials are absent from agent/model context and tool output.
6. Wrong-audience, token-passthrough, expired, and revoked credentials are rejected.
7. Private/internal target, DNS rebinding, redirect escape, disallowed port, and oversized response are rejected.
8. Prompt-injection content cannot alter authority or credential behavior.
9. Agent, mission, policy, emergency, and certificate revocation stop the next new action within SLO.
10. Tenant-crossing attempts fail across gateway, cache, queue, credential broker, telemetry, and evidence.
11. Restart/restore recovers runtime attempts and evidence without duplicate side effects.
12. Independent evidence verifier reconstructs the complete governed action.

## Requirements

- `AOPS-RTC-001` (`S0`): A runtime execution-profile gate result MUST pin the complete controlled-path identity and enforcement strength.
- `AOPS-RTC-002` (`S0`): A denied action MUST produce zero external egress.
- `AOPS-RTC-003` (`S0`): Credentials MUST remain audience-, tenant-, and action-scoped and outside model context.
- `AOPS-RTC-004` (`S0`): Ambiguous post-dispatch outcomes MUST remain unknown and idempotently recoverable.
- `AOPS-RTC-005` (`S0`): Bypassable paths MUST be excluded or labeled advisory/mediated.
- `AOPS-RTC-006` (`S0`): Revoked authority or certificate epochs MUST be rejected at egress.
- `AOPS-RTC-007` (`S1`): Runtime profiles MUST pass SSRF, DNS, redirect, response, and prompt-injection abuse suites.

## Exit criterion

A runtime profile is eligible for inclusion only for its exact transport, deployment, credential, network, and enforcement tuple after conformance, tenant-isolation, restore, evidence, security, and operations approval. Production enablement still requires a composite release certificate containing valid Core, runtime-profile, and market results.
