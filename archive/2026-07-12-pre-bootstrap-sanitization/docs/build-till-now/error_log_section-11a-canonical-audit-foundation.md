---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [section-11a, error-log, canonical-audit, testcontainers]
---

# Error Log - Section 11A Canonical Audit Foundation

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-11a-canonical-audit-foundation]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]]

## Errors And Fixes

| Issue | Cause | Fix | Status |
|---|---|---|---|
| `@testcontainers/postgresql` introduced audit vulnerabilities | Initial 10.x package pulled vulnerable transitive dependencies | Upgraded away from vulnerable line | Fixed |
| Newer `@testcontainers/postgresql` pulled incompatible `undici@8.7.0` | Package floated core `testcontainers` to a version requiring Node >=22.19 while local Node was 22.15 | Removed `@testcontainers/postgresql`; used core `testcontainers@12.0.0` with `undici@7.28.0` override | Fixed |
| Testcontainers could not find Docker | Docker Desktop daemon was not running | Started Docker Desktop and confirmed `docker info` | Fixed |
| Postgres test failed with `read ECONNRESET` | Wait strategy matched the first ready log before Postgres init restart completed | Required the ready log twice with `Wait.forLogMessage(..., 2)` | Fixed |
| API typecheck failed on exact optional property types | Routes passed explicit `undefined` optional fields | Built params objects only with defined values | Fixed |
| API lint failed on unused imports and async resolvers | Strict lint rules rejected unused code and async functions without await | Removed unused import, changed resolvers to `Promise.resolve`, used test variable in assertion | Fixed |
| Chain verification test expected link error but got event hash error | Mutating `previous_hash` also changed recomputed event hash | Adjusted verifier order to report canonical hash issues first, then previous-hash link mismatch, then event-hash mismatch | Fixed |

## Prevention Notes

- Prefer core `testcontainers` unless a module package is proven audit-clean and runtime-compatible.
- Always run `npm audit --audit-level=moderate` after adding dependencies.
- For Postgres Testcontainers, wait for the ready log twice.
- Keep evidence route scope injected; never use temporary header-based org auth.
- Run `npm run verify` before section closeout.
