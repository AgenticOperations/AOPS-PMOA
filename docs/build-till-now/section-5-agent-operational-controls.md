---
created: 2026-07-08
project: agentOps
ecosystem: circle
tags: [section-5, operations, tools, runtime, mcp, build-history]
---

# Section 5 - Agent Operational Controls

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-4-runtime-integration-plane]]

## What Was Built

Section 5 adds the operational control layer between policy checks and later financial/payment execution.

Backend:

- Added `tool_catalog` so each workspace can register managed tool/action surfaces.
- Added `operational_decisions` as a durable record of operation checks.
- Added `operational_rate_limits` and `operational_rate_counters` for repeated-operation throttling.
- Added operation check and record endpoints:
  - `GET /v1/orgs/:orgId/tools`
  - `POST /v1/orgs/:orgId/tools/import`
  - `POST /v1/orgs/:orgId/operations/check`
  - `POST /v1/orgs/:orgId/operations/record`
  - `GET /v1/orgs/:orgId/operations/blocked`
  - `POST /v1/orgs/:orgId/operations/rate-limits`
  - `GET /v1/orgs/:orgId/agents/:agentId/allowed-actions`
  - `POST /v1/runtime/operations/check`
  - `POST /v1/runtime/operations/record`
- Operation checks support:
  - `runtime.http.request`
  - `tool.call`
- Operation checks call the existing policy engine and approval engine. They do not duplicate policy logic.
- Denied and rate-limited operation checks are queryable from the blocked operations feed.
- Agent-level allowed actions are derived from active policy bindings across workspace, team, and direct agent scope.

MCP service:

- Added `agentops.operation_check`.
- Added `agentops.operation_record`.
- MCP continues to be a standalone stdio adapter and delegates every operation to backend runtime endpoints.

Frontend:

- Added `Operations` to the app sidebar.
- Added `/app/[orgSlug]/operations`.
- Built an Operations workbench with:
  - real tool catalog list,
  - tool import form,
  - recent blocked actions list,
  - request limit creation form.
- Added an `Operational access` section to agent detail:
  - effective operational actions derived from bound policies,
  - recent blocks for that agent.

## Why It Was Built This Way

Section 5 is not a payment or wallet section. It controls operational surfaces: external HTTP/API checks and named tool calls.

The backend owns operation decisions because runtime clients and MCP hosts are not trusted policy evaluators. MCP is only a protocol adapter. The web UI reads the same backend state that runtime checks write, so users can see what is actually active and what was actually blocked.

The UI intentionally avoids fake wallet, treasury, marketplace, or finance cards. Those belong to later sections.

## Backend Boundary

Built now:

- Workspace tool catalog.
- Operation check and operation record APIs for humans and runtime credentials.
- Blocked operation feed.
- Per-agent allowed action read model.
- Basic operation rate limit enforcement for credential-backed checks.
- Activity/audit records for operation checks and operation records.

Deferred:

- Tool proxy execution.
- Hosted MCP transport.
- SDK install/copy snippets.
- Advanced rate-limit editor and remove/disable actions.
- Payment and x402 execution.
- Wallet/treasury control.

## Frontend Boundary

Built now:

- Operations page in the authenticated app shell.
- Tool catalog import and display.
- Blocked operation display.
- Agent request-limit creation.
- Agent detail operational access/read-model display.

Deferred:

- Operation decision drilldown drawer.
- Bulk tool import from MCP manifests.
- Disable/archive tool and rate-limit controls.
- Live operation inspector.
- Payment/wallet operational views.

## Files Changed

Backend:

- `packages/db/src/migrations/0008_section_5_operational_controls.sql`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/api/src/engines/approvals/types.ts`
- `apps/api/src/engines/operations/routes.ts`
- `apps/api/src/engines/operations/store.ts`
- `apps/api/src/engines/operations/types.ts`
- `apps/api/test/operations/section-5-operational-controls.test.ts`

MCP:

- `apps/mcp/src/runtime-client.ts`
- `apps/mcp/src/tools.ts`
- `apps/mcp/test/runtime-client.test.ts`
- `apps/mcp/test/tools.test.ts`

Frontend:

- `apps/web/src/app/actions/operations.ts`
- `apps/web/src/app/app/[orgSlug]/operations/page.tsx`
- `apps/web/src/app/app/[orgSlug]/agents/[agentId]/page.tsx`
- `apps/web/src/components/ConsoleShell.tsx`
- `apps/web/src/components/agents/AgentDetailShell.tsx`
- `apps/web/src/components/operations/OperationsWorkbench.tsx`
- `apps/web/src/lib/operations-types.ts`
- `apps/web/src/lib/server/operations-client.ts`
- `apps/web/src/app/globals.css`
- `apps/web/tests/console-shell.test.tsx`
- `apps/web/tests/operations/operations-workbench.test.tsx`
- `apps/web/tests/agents/agent-detail-shell.test.tsx`

## Verification

Commands passed:

- `npm --workspace @agentops-pmoa/db run build`
- `npm --workspace @agentops-pmoa/api run test -- test/operations/section-5-operational-controls.test.ts`
- `npm --workspace @agentops-pmoa/api run test -- test/operations/section-5-operational-controls.test.ts test/policy/policy-routes.test.ts`
- `npm --workspace @agentops-pmoa/mcp run test`
- `npm --workspace @agentops-pmoa/web run test -- tests/console-shell.test.tsx tests/operations/operations-workbench.test.tsx tests/agents/agent-detail-shell.test.tsx`
- `npm --workspace @agentops-pmoa/api run typecheck`
- `npm --workspace @agentops-pmoa/mcp run typecheck`
- `npm --workspace @agentops-pmoa/web run typecheck`
- `npm --workspace @agentops-pmoa/api run lint`
- `npm --workspace @agentops-pmoa/mcp run lint`
- `npm --workspace @agentops-pmoa/web run lint`
- `npm --workspace @agentops-pmoa/db run test`
- `npm run verify`

Focused verification result:

- API Section 5 tests: 1 file, 3 tests passed.
- API Section 5 plus policy route regression tests: 2 files, 9 tests passed.
- MCP tests: 2 files, 7 tests passed.
- Web focused tests: 3 files, 5 tests passed.
- Full workspace verify: PASS.
- Config tests: 1 file, 1 test passed.
- Contracts tests: 1 file, 1 test passed.
- DB tests: 2 files, 6 tests passed.
- API tests: 17 files, 51 tests passed.
- MCP tests: 2 files, 7 tests passed.
- Web tests: 9 files, 30 tests passed.

## What Remains For Later Sections

Section 5 makes operational checks visible and enforceable when an agent uses the runtime API or MCP. It does not yet force every external action through agentOps. Hard enforcement for browser/API/tool execution requires later controlled tool proxy or managed execution surfaces.
