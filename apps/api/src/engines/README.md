---
created: 2026-07-06
project: agentOps
ecosystem: circle
tags: [build-pmoa, backend, engines, architecture]
---

# Backend Engines

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/README]] | [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/40-final-implementation-readiness-and-build-sequence]]

PMOA backend engines will be added here in build order:

1. `evidence` for Section 11A.
2. `identity` for Section 1.
3. `policy` and `approvals` for Sections 2 and 3.
4. `runtime` for Section 4 backend runtime checks and activity ingestion.
5. `operations`, `finance`, `treasury`, and `capabilities` for later waves.

MCP is not a backend engine. The real MCP server lives in `BUILD-PMOA/apps/mcp` and calls backend runtime endpoints.

Do not port old `BUILD/Backend/src/engines/*` directly. Recreate each engine around the PMOA source-of-truth map.
