---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [section-4, error-log, runtime, mcp]
---

# Error Log - Section 4 Runtime Integration Plane

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-4-runtime-integration-plane]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]]

| Issue | Cause | Fix | Status | Prevention |
|---|---|---|---|---|
| API tests could not see the new migration | API imports compiled `@agentops-pmoa/db`, and the new migration was only in `src` | Rebuilt the DB package so migrations were copied into `dist` | Fixed | Run `npm --workspace @agentops-pmoa/db run build` after migration changes before API integration tests |
| New migration failed on composite foreign keys | Existing Section 1 tables have global primary keys and do not define composite `(org_id, id)` uniqueness | Replaced composite FKs with single-column FKs to `agents(id)` and `connections(id)` | Fixed | Match migrations to the real schema instead of assuming tenant composite keys |
| Runtime integration setup cleanup crashed after sandbox Docker failure | The test cleanup ran after setup failed before `pool` existed | Guarded cleanup for failed setup paths | Fixed | Integration tests should tolerate failed environment bootstrap |
| Health test expected the old section marker | API health payload moved from Section 2 to Section 4 after runtime/MCP registration | Updated the expected section to `section_4` | Fixed | Health tests should be updated whenever the active build marker changes |
| MCP was initially mounted as a backend route | The first Section 4 pass used `POST /v1/mcp`, which is not a real stdio MCP server for clients like Claude Desktop | Built `apps/mcp` as a separate stdio MCP service and removed backend `/v1/mcp` registration | Fixed | Protocol adapters should live at the integration boundary, while the backend exposes runtime APIs only |
| MCP SDK registration caused excessive TypeScript type instantiation | Dynamic registration over a tool array made the SDK's generic `registerTool` type expand too deeply | Added a narrow local registrar type at the SDK boundary while keeping tool schemas/handlers strongly typed and tested | Fixed | Keep SDK adapter code thin; test internal tool definitions separately |
| MCP test lint failed on async mocks and matcher typing | Test mocks used async bodies without await, and asymmetric matchers produced unsafe `any` assignments | Replaced mocks with `Promise.resolve` and asserted text content after explicit content-type narrowing | Fixed | Strict lint rules apply to tests; avoid matcher objects where they degrade typing |
