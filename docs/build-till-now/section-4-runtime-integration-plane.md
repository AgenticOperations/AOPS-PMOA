---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [section-4, runtime, api, mcp, policy-check, build-history]
---

# Section 4 - Runtime Integration Plane

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-3-approval-activity-spine]]

## What Was Built

Section 4 adds the first agent-facing runtime surface.

Backend:

- Added `agent.onboard()` through `POST /v1/runtime/onboard`.
- Added `agent.check(...)` through `POST /v1/runtime/check`.
- Added a runtime action contract with:
  - `runtime.http.request`
  - `payment.x402.authorize`
  - `tool.call`
- Added deterministic normalization from structured input.
- Added limited intent normalization for common cases such as weather requests and x402 payment language.
- Added `needs_more_info` when a request cannot be normalized safely.
- Added connection credential authentication for runtime calls.
- Added approval-status and approval-consume runtime endpoints.
- Added `POST /v1/runtime/activity` so the standalone MCP service can write real agent activity without DB access.

MCP service:

- Added `apps/mcp` as an independent stdio MCP server.
- Uses the official TypeScript MCP SDK.
- Authenticates to the backend with `AGENTOPS_MCP_CREDENTIAL`.
- Delegates every decision/action to backend runtime endpoints; it owns no policy logic and has no database access.
- Added MCP tools:
  - `agentops.onboard`
  - `agentops.policy_check`
  - `agentops.approval_status`
  - `agentops.approval_consume`
  - `agentops.activity_record`

Frontend:

- Added runtime action choices to Controls through the action-aware policy builder.
- Added action-specific condition fields:
  - HTTP/API request policies use resource conditions.
  - x402 authorization policies use resource and payment conditions.
  - tool call policies use tool conditions.
- Added Approvals navigation because runtime checks can now generate real approvals.

## Why It Was Built This Way

The agent does not receive policy internals. It receives the runtime contract from onboard, then sends structured facts to check. The policy engine decides from backend-owned policy objects.

The natural-language path is intentionally narrow. It is a convenience normalizer, not the authority. If required facts are missing, the result is `needs_more_info` instead of allow.

Direct API and MCP have parity, but they are separate services. The backend owns runtime decisions. The MCP process is the agent/client-facing protocol adapter that Claude Desktop, Claude CLI, and other MCP hosts can launch.

## Backend Boundary

Built now:

- `POST /v1/runtime/onboard`
- `POST /v1/runtime/check`
- `POST /v1/runtime/activity`
- `GET /v1/runtime/approvals/:approvalId`
- `POST /v1/runtime/approvals/:approvalId/consume`

MCP service built now:

- `npm --workspace @agentops-pmoa/mcp run dev`
- stdio transport for MCP hosts.
- tool handlers for onboard, policy check, approval status, approval consume, and activity record.

Deferred:

- Hosted MCP HTTP/SSE transport.
- SDK wrappers.
- Payment signing.
- Tool proxy enforcement.
- Marketplace/x402 execution.
- Rate limit enforcement from `connection_rate_limits`.

## Frontend Boundary

Built now:

- Controls can create policies against runtime action contracts.
- Controls can attach those policies to real workspace/team/agent/credential targets.
- Approvals can review runtime approval requests.

Deferred:

- Agent integration copy drawer.
- Runtime request explorer.
- MCP configuration screen.
- Live agent stream.

## Verification

Commands passed:

- `npm --workspace @agentops-pmoa/api test -- test/runtime/runtime-integration.test.ts`
- `npm --workspace @agentops-pmoa/api test`
- `npm --workspace @agentops-pmoa/db test`
- `npm --workspace @agentops-pmoa/web test`
- `npm --workspace @agentops-pmoa/mcp test`
- `npm --workspace @agentops-pmoa/api run typecheck`
- `npm --workspace @agentops-pmoa/web run typecheck`
- `npm --workspace @agentops-pmoa/mcp run typecheck`
- `npm run verify`

The runtime integration tests act as multiple agents by using issued agent credentials. They verify direct API denial, approval-required x402 flow with one-time consumption, backend runtime activity ingestion, and that MCP is no longer exposed as a backend route. The MCP package tests verify service-level policy-check delegation and credential-safe API error behavior.

Final verification result:

- Full workspace verify: PASS.
- API tests: 16 files, 45 tests passed.
- MCP tests: 2 files, 5 tests passed.
- Web tests: 8 files, 25 tests passed.
- DB tests: 2 files, 6 tests passed.
- Config tests: 1 file, 1 test passed.
- Contracts tests: 1 file, 1 test passed.

## What Remains For Later Sections

Section 4 is the control checkpoint layer, not the final enforcement layer for every external action. It becomes hard enforcement when later sections route payments, MCP tools, or managed execution through agentOps-controlled surfaces.
