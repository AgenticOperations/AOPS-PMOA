---
created: 2026-07-06
project: agentOps
ecosystem: circle
tags: [build-pmoa, reference-map, legacy-build, architecture]
---

# BUILD Reference Map

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/README]] | [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/24-pass-3-section-build-contract-matrix]]

Old `BUILD/` is reference material. New PMOA source of truth lives in `BUILD-PMOA/`.

## Useful Donor Areas

- `BUILD/Backend/src/app.ts` - Fastify registration and dependency injection pattern.
- `BUILD/Backend/src/db/` - Postgres client and migration runner patterns.
- `BUILD/Backend/src/lib/ids.ts` - local id generation style.
- `BUILD/Backend/test/spikes/pmoa-canonical-audit-event.test.ts` - audit write path spike.
- `BUILD/Backend/test/spikes/pmoa-mcp-adapter-shape.test.ts` - MCP adapter shape spike.
- `BUILD/Backend/test/spikes/pmoa-atomic-reservation.test.ts` - atomic reservation spike.
- `BUILD/Backend/src/redis/` - Redis/Lua pattern for later finance controls.
- `BUILD/Backend/src/lib/arc/` and `BUILD/Backend/src/engines/oracle/` - x402/Circle raw material for Section 6.
- `BUILD/Frontend/src/lib/` - BFF/client conventions that can be reshaped.
- `BUILD/Frontend/src/app/` - app shell and route patterns that can be selectively reused.

## Do Not Import Blindly

- Old routes and old page information architecture.
- Old marketplace `Service` as the Section 8 canonical object.
- Old shared `agent-float` as the PMOA dedicated-wallet model.
- Old reports/admin audit as the canonical evidence layer.
- Old escrow as the Section 9 Jobs product.

Every copied pattern must be checked against the PMOA section source-of-truth map before use.
