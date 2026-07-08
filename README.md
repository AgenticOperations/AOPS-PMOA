---
created: 2026-07-06
project: agentOps
ecosystem: circle
tags: [build-pmoa, scaffold, implementation, circle, arc]
---

# BUILD-PMOA

Backlinks: [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/00-README]] | [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/40-final-implementation-readiness-and-build-sequence]]

This is the clean PMOA rebuild of agentOps.

The old `BUILD/` folder remains reference-only. Do not extend old product flows by default. Pull proven code patterns from `BUILD/` only when they fit the PMOA architecture.

## Structure

```text
BUILD-PMOA/
  apps/
    api/    Fastify API, workers, backend engines
    mcp/    Standalone stdio MCP server for agent/client integration
    web/    Next operator console
  packages/
    contracts/ shared product contracts and wire schemas
    config/    shared configuration helpers
    db/        database migration and query ownership
  docs/
    env-inventory.md
    reference-map.md
    build-till-now/
```

## Build Order

1. Section 0 new baseline: install, lint, typecheck, build, and tests.
2. Section 11A minimal canonical audit writer.
3. Section 1 core product spine.
4. Continue using `PMOA-EVENT-PRD/40-final-implementation-readiness-and-build-sequence.md`.

## Build History Rule

Every completed section must update `BUILD-PMOA/docs/build-till-now/`.

Required files per section:

- `section-<section-id>-<slug>.md`
- `error_log_section-<section-id>-<slug>.md`

These files explain what was built, why it was built, what tests prove it, and which errors or implementation issues were found. They are required before moving to the next section.

## Environment Files

Existing env files from old `BUILD/` are copied into matching new app folders:

- `BUILD/Backend/.env` -> `BUILD-PMOA/apps/api/.env`
- `BUILD/Backend/.env.example` -> `BUILD-PMOA/apps/api/.env.example`
- `BUILD/Frontend/.env.local` -> `BUILD-PMOA/apps/web/.env.local`
- `BUILD/Frontend/.env.example` -> `BUILD-PMOA/apps/web/.env.example`
- `BUILD-PMOA/apps/mcp/.env.example` documents the independent MCP service env keys.

Do not commit local env files. They are ignored by `BUILD-PMOA/.gitignore`.

## First Implementation Gate

Before Section 11A starts, the scaffold must have:

- API lint/typecheck/test passing.
- Web lint/typecheck/test passing.
- Root workspace scripts working.
- Env inventory reviewed without exposing secret values.

## Section 0 Baseline Result

Completed: 2026-07-06.

- Install: PASS. `npm install` completed after network escalation and created `package-lock.json`.
- Dependency audit: PASS. `npm audit --audit-level=moderate` reports 0 vulnerabilities after PostCSS override and dedupe.
- Lint: PASS with `npm run lint`.
- Typecheck: PASS with `npm run typecheck`.
- Build: PASS with `npm run build`.
- Tests: PASS with `npm test` across 5 test files and 5 tests.
- Full verification: PASS with `npm run verify`.
- Clean-output verification: PASS after removing generated artifacts and rerunning `npm run verify`.
- Env hygiene: PASS. Local env files remain ignored; env inventory lists key names only; no raw secret logging found in scaffold source.

Section 11A can now start with architecture discussion and a fresh section implementation plan.

## Section 11A Result

Completed: 2026-07-06.

Section 11A built the canonical audit foundation:

- PMOA SQL migration runner in `packages/db`.
- Initial PMOA audit schema:
  - `orgs`
  - `audit_event_heads`
  - `audit_events`
- Evidence retention boundary: canonical audit tables reference `orgs(id) ON DELETE RESTRICT`.
- Deterministic canonical JSON hashing.
- Nested audit redaction for bearer tokens, cookies, API keys, private keys, signatures, x402 payment material, provider credentials, and session material.
- Transactional `recordAuditEvent(client, input)` writer.
- Per-org sequence allocation and hash-chain linking.
- Idempotency behavior:
  - same org plus same key plus same canonical body returns the existing event,
  - same org plus same key plus different canonical body throws `idempotency_conflict`.
- Org-fenced audit list/detail/verify services.
- Injected-scope evidence routes:
  - `GET /v1/evidence/events`
  - `GET /v1/evidence/events/:eventId`
  - `GET /v1/evidence/events/:eventId/verify`
  - `GET /v1/evidence/chain/verify`

Evidence routes are not mounted by default. They mount only when the app receives both a Postgres pool and a real `resolveOrgScope` dependency. This avoids temporary `x-org-id` auth and keeps Section 1 responsible for the real authenticated tenant boundary.

## Local-First, Cloud-Ready Database

The build uses one database switch: `DATABASE_URL`.

- Local development can use the default local Postgres URL or the copied local `.env`.
- Cloud deployment can point `DATABASE_URL` at managed Postgres or Supabase without code changes.
- Section 11A tests use Docker-backed Postgres through core `testcontainers`.
- New PMOA migrations are independent from the old `BUILD/Backend` cascade-delete schema.

Do not point PMOA migrations at the old `BUILD` database until there is an explicit compatibility/migration plan.

## Section 11A Verification

- `npm --workspace @agentops-pmoa/db test -- test/migrate.test.ts`: PASS.
- `npm --workspace @agentops-pmoa/api test -- test/evidence/...`: PASS, 6 files and 18 tests.
- `npm run verify`: PASS.
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities.
