---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [section-11a, canonical-audit, build-history, evidence]
---

# Section 11A - Canonical Audit Foundation

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]] | [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/45-section-11a-minimal-canonical-audit-writer-implementation-plan]]

## Purpose

Build the canonical audit foundation before Section 1 starts creating accepted product mutations.

This section exists because every later product section needs evidence-grade capture: org changes, agent changes, credential changes, policy changes, approvals, payments, treasury actions, and capability decisions.

## What Was Built

- PMOA migration runner in `packages/db`.
- Initial audit migration:
  - `orgs`
  - `audit_event_heads`
  - `audit_events`
- `ON DELETE RESTRICT` audit retention boundary.
- Deterministic canonical JSON helper.
- SHA-256 hashing helper.
- Recursive redaction helper.
- Transactional `recordAuditEvent(client, input)` writer.
- Per-org sequence allocation.
- Per-org hash-chain linking.
- Idempotency behavior:
  - same org plus same key plus same canonical body returns existing event,
  - same org plus same key plus different canonical body throws `idempotency_conflict`.
- Org-fenced list/detail/verify services.
- Injected-scope evidence read routes:
  - `GET /v1/evidence/events`
  - `GET /v1/evidence/events/:eventId`
  - `GET /v1/evidence/events/:eventId/verify`
  - `GET /v1/evidence/chain/verify`
- `DATABASE_URL` as the local-first/cloud-ready database switch.

## Backend Boundary

Section 11A built backend audit foundation only.

It does not build:

- full org lifecycle,
- user/member auth,
- agents,
- connection credentials,
- policies,
- approvals,
- payments,
- treasury,
- public Evidence UI.

Evidence routes are not mounted by default. They require an injected Postgres pool and a real `resolveOrgScope`.

## Frontend Boundary

No public frontend was built in Section 11A.

Reason: a truthful Evidence UI needs Section 1 auth, org scope, and protected app shell. Building it before that would create a weak temporary UI.

## Cloud-Ready Rule

Runtime database selection uses `DATABASE_URL`.

- Local: local Postgres or copied `.env`.
- Cloud: managed Postgres or Supabase by changing env only.
- Do not point PMOA migrations at the old `BUILD` database without a compatibility plan.

## Verification

Completed on 2026-07-06:

- `npm --workspace @agentops-pmoa/db test -- test/migrate.test.ts`: PASS.
- `npm --workspace @agentops-pmoa/api test -- test/evidence/canonical-json.test.ts test/evidence/redaction.test.ts test/evidence/audit-writer.test.ts test/evidence/audit-query.test.ts test/evidence/routes.test.ts test/evidence/app-wiring.test.ts`: PASS.
- Section 11A API evidence suite: 6 files, 18 tests PASS.
- `npm run verify`: PASS.
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities.

## What Remains

Section 1 must now extend the minimal `orgs` tenant anchor and provide real auth/org scope.

Section 1 must use `recordAuditEvent` for meaningful mutations.

Full Section 11 later owns Evidence Packs, exports, webhooks, compliance views, and Arc anchoring.
