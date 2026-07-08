---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [section-0, build-pmoa, baseline, build-history]
---

# Section 0 - BUILD-PMOA Baseline

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]] | [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/43-section-0-build-pmoa-baseline-implementation-plan]]

## Purpose

Create a clean implementation root for PMOA so the product is not built on top of the old `BUILD/` architecture.

Old `BUILD/` remains reference-only. `BUILD-PMOA/` is the active build root.

## What Was Built

- Root npm workspace.
- `apps/api` Fastify scaffold.
- `apps/web` Next scaffold.
- `packages/contracts`.
- `packages/config`.
- `packages/db`.
- Env files copied from old `BUILD` into matching new app folders without printing secret values.
- Root scripts for lint, typecheck, build, test, and verify.
- Lockfile and dependency baseline.
- Basic API health route.
- Basic web landing page.
- Env inventory and reference map docs.

## Backend Boundary

Section 0 only created the backend scaffold:

- no product DB schema,
- no PMOA audit tables,
- no auth,
- no agents,
- no policies,
- no payments,
- no provider calls.

## Frontend Boundary

Section 0 only created the web scaffold:

- no product dashboard,
- no fake agent rows,
- no fake policy or payment screens.

## Why This Shape

The project uses a production monorepo layout:

```text
BUILD-PMOA/
  apps/api
  apps/web
  packages/contracts
  packages/config
  packages/db
```

This keeps backend and frontend clearly separated while preserving shared packages for contracts, config, and database ownership.

## Verification

Completed on 2026-07-06:

- `npm install`: PASS.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `npm test`: PASS.
- `npm run verify`: PASS.
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities.

## What Remains

Section 0 does not make a product usable. It only makes the clean build root installable, testable, and safe enough for product sections.

Next dependency satisfied: Section 11A could build the canonical audit foundation.
