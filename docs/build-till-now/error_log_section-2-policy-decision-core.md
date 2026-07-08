---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [section-2, error-log, policy, controls]
---

# Error Log - Section 2 Policy Decision Core

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-2-policy-decision-core]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]]

| Issue | Cause | Fix | Status | Prevention |
|---|---|---|---|---|
| Testcontainers could not find Docker in sandbox | Docker socket is not available inside the managed sandbox | Reran DB/API Testcontainers tests with Docker escalation | Fixed | Any Testcontainers verification needs Docker access |
| API policy tests returned `relation "policy_drafts" does not exist` | API tests import compiled `@agentops-pmoa/db`, and the new migration had not been copied into `dist` yet | Ran `npm --workspace @agentops-pmoa/db run build` before rerunning API tests | Fixed | Run `npm run build:packages` or db build before targeted API tests after adding migrations |
| Fastify warned about overriding error handlers | Identity and policy route registrars both installed an app-scope error handler | Added `installErrorHandler` to policy route deps and only install it when policy routes are mounted without identity routes | Fixed | Route modules should not blindly override shared app handlers |
| Typecheck failed on exact optional fields | Zod optional outputs and audit inputs can produce explicit `undefined`, which strict optional types reject | Updated policy statement optional types and added conditional audit object fields | Fixed | Avoid passing optional keys with `undefined`; spread only when values exist |
| Lint failed on async validator with no await | Policy statement validation was synchronous but declared `async` | Removed the unnecessary async declaration | Fixed | Keep validators synchronous unless they perform I/O |
| Shell reads failed for `[orgSlug]` route paths | zsh treated bracketed Next route segments as glob patterns | Retried path reads with quotes | Fixed | Quote App Router paths containing square brackets |
| First web tests failed for missing Controls route and component | RED tests were written before implementation | Added `ControlsLibrary`, Controls route, and sidebar nav item | Fixed | Expected TDD failure |
| Policy builder allowed mixed action condition groups | One form exposed resource, payment, and tool fields for every action | Added action-aware draft builder and backend condition compatibility validation | Fixed | Policy creation must mirror runtime action contracts |
| Comma-separated fields became one literal value | The web policy client wrapped raw strings in one-item arrays | Split comma-separated category/domain/asset/tool fields before creating statements | Fixed | UI list inputs must serialize to real arrays |
| Bindings could target nonexistent IDs | Binding creation validated active policy version but not target existence | Added backend target existence checks for org, team, agent, and credential bindings | Fixed | Any attachment must validate the referenced product object |
