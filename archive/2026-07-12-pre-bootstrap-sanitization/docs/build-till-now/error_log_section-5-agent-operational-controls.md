---
created: 2026-07-08
project: agentOps
ecosystem: circle
tags: [section-5, error-log, operations, mcp, ui]
---

# Error Log - Section 5 Agent Operational Controls

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-5-agent-operational-controls]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]]

| Issue | Cause | Fix | Status | Prevention |
|---|---|---|---|---|
| API integration tests initially failed with 404 for Section 5 routes | The RED tests were written before operation routes were registered | Added the operations engine, route registration, and server dependency wiring | Fixed | Keep Section tests route-first so missing API surfaces fail visibly |
| MCP tests failed after adding expected Section 5 tools | The standalone MCP adapter did not yet expose operation check/record tools | Added `agentops.operation_check` and `agentops.operation_record`, delegating to backend runtime endpoints | Fixed | MCP remains protocol adapter only; add tool tests when runtime endpoints grow |
| Web Section 5 tests failed because Operations navigation and component did not exist | The UI shell only exposed sections through Section 4 | Added Operations nav, route, workbench component, server client, and server actions | Fixed | Add shell navigation tests when a section becomes user-facing |
| Agent detail test could not find operational access | Agent detail showed policies and activity, but not the Section 5 allowed-action and blocked-operation read models | Added `Operational access` with effective action rows and recent blocks | Fixed | Agent detail should surface the active controls that affect that exact agent |
| Agent detail test found duplicate exact `browser.search` text | The same tool label appeared in both allowed actions and recent blocks, making exact-text testing ambiguous | Prefixed blocked rows with `Blocked ...` while keeping the allowed action label exact | Fixed | Repeated operational labels should include context in secondary lists |
| API typecheck failed on target candidate typing | Array inference widened target `type` to `string` before filtering | Annotated the target candidate array before filtering | Fixed | Preserve literal unions before array filters |
| API lint failed on unused helper and unnecessary decision cast | Implementation left an unused helper and a no-op type assertion after type refinement | Removed the helper, removed the cast, and dropped the unused import | Fixed | Run lint after typecheck on new engines |
| API lint failed in existing policy route test | `expect.objectContaining` produced unsafe `any` in a typed object assertion | Rewrote the assertion into explicit property checks | Fixed | Prefer explicit assertions in strict TypeScript tests when asymmetric matchers degrade typing |
| Full verify failed in DB migration test | The migration test listed expected migrations only through Section 4 | Added `0008_section_5_operational_controls` to the applied migration expectations | Fixed | Update migration-list assertions whenever a section adds a migration |
| API health still reported Section 4 after Section 5 closeout | Health payload and test marker were hardcoded to `section_4` | Updated `/healthz` and its test to `section_5` | Fixed | Update health markers as part of section closeout before final verify |
