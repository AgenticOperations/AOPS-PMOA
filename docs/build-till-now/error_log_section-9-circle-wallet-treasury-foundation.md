---
created: 2026-07-09
project: agentOps
ecosystem: circle
tags: [build-pmoa, section-9, errors, circle, wallets]
---

# Error Log — Section 9 Circle Wallet Treasury Foundation

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-9-circle-wallet-treasury-foundation]]

## Errors

### `tsx watch` IPC denied by sandbox

- Cause: The API dev script uses `tsx watch`, which creates an IPC pipe under `/var/folders/...`. The sandbox denied that pipe.
- Fix: Restarted the API dev server with sandbox escalation.
- Status: Resolved for local live testing.
- Prevention: Expect dev-server startup to need escalation in this environment.

### Circle SDK named import failed in dev-server runtime

- Cause: Normal Node import resolution exposed `initiateDeveloperControlledWalletsClient`, but the `tsx watch` startup path failed on the static named import.
- Fix: Switched to a namespace runtime import for `@circle-fin/developer-controlled-wallets` and kept `Blockchain` as type-only.
- Status: Resolved. API typecheck, lint, and live startup pass.
- Prevention: For SDKs with mixed CJS/ESM packaging, prefer namespace runtime imports at app startup boundaries.

### `baseUrl: undefined` rejected by strict TypeScript

- Cause: `exactOptionalPropertyTypes` rejects passing an explicit `undefined` optional property into the Circle client params.
- Fix: Added a helper that omits `baseUrl` unless it has a non-empty value.
- Status: Resolved.
- Prevention: Build optional SDK config objects by omission, not by assigning `undefined`.

### DB migration test expected list stale

- Cause: The migration test expected migrations through `0009` only.
- Fix: Added `0010_section_9_circle_treasury` to the expected migration list.
- Status: Resolved.
- Prevention: Every new migration must update migration-order assertions.

### Partial Section 9 migration could not recover

- Cause: A failed API startup partially created Section 9 tables before `schema_migrations` recorded `0010`. The next startup failed on `relation "org_payment_modes" already exists`.
- Fix: Made new Section 9 table and index creation idempotent with `IF NOT EXISTS`.
- Status: Resolved. API startup recovered and `/healthz` reports `section_9`.
- Prevention: New migrations that add standalone tables/indexes should tolerate partial local application when development startup fails mid-migration.

### Disabled button looked active

- Cause: The shared button styles had no disabled visual state.
- Fix: Added disabled styles for primary, secondary, danger, and Google buttons.
- Status: Resolved after CDP screenshot verification.
- Prevention: New action buttons must be checked in DOM state and visual state.

### Live API cookie extraction rejected

- Cause: Attempted to extract the live browser session cookie through CDP to call API routes directly.
- Fix: Stopped immediately and did not work around the policy rejection. Relied on server-rendered browser verification, API health, and automated tests instead.
- Status: Resolved without credential extraction.
- Prevention: Do not extract browser session cookies for API testing unless the user explicitly approves after risk disclosure.
