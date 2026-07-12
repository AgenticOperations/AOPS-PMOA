---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [section-1, core-product-spine, identity, connections, build-history]
---

# Section 1 - Core Product Spine

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]] | [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/archive/27-section-1-core-product-spine-implementation-plan]]

## What Was Built

Section 1 turns `BUILD-PMOA` from a scaffold plus audit writer into the first usable agentOps product spine.

Backend:

- Added PMOA migration `0004_section_1_auth_onboarding.sql`.
- Added Google OAuth account mapping, hashed session-token storage, session expiry, and logout/revoke support.
- Added flexible org onboarding state keyed by `flow_key`, starting with `section_1_foundation`.
- Replaced the app-path local operator with session-derived user and membership roles.
- Added slug-scoped workspace lookup guarded by active membership.
- Added backend-owned Google authorization URL construction so OAuth provider config is not duplicated in the web app.
- Added PMOA migration `0002_section_1_core_spine.sql`.
- Extended `orgs` with `slug`, `default_team_id`, and `settings`.
- Added `users`, `memberships`, `teams`, `agents`, `connections`, `connection_credentials`, and `wallet_refs`.
- Added a transactional identity store for org/team/agent/connection/wallet-reference mutations.
- Added org default-team creation on org create.
- Added generic agent identity with free-form labels, optional parent, optional default environment, metadata, lifecycle status, and same-org parent/team validation.
- Added parent-cycle prevention.
- Added connection credentials with one-time secret reveal, SHA-256 hash storage, rotate, revoke, test, and auth-check resolution.
- Added neutral `agent_credential` support so Section 1 credentials authenticate the agent without pretending to define authorization tiers.
- Added wallet reference attach/detach backend support without payment execution. This is reserved for later wallet sections and is not exposed in the Section 1 UI.
- Added canonical Section 11A audit events for Section 1 mutations.
- Added PMOA migration `0005_audit_event_classification.sql`.
- Added audit event classification and relations: event domain, category, severity, tags, related agent/team/connection/wallet/policy IDs.
- Updated Section 1 identity and credential mutations so agent detail history includes related credential events, not only direct agent lifecycle events.
- Wired the API server to `DATABASE_URL`, migration runner, identity routes, and evidence routes.

Frontend:

- Added Impeccable context files: `PRODUCT.md` and `DESIGN.md`.
- Added public `/` landing page with a single auth entry point.
- Added `/auth` as the hybrid sign-in / account-choice / workspace-picker page. Signed-in users now still see an explicit choice: continue with the current account/workspace or continue with Google.
- Added `/onboarding` for org-only first workspace setup after Google sign-in, now reduced to organization name only because domain and primary-use-case did not drive any Section 1 behavior.
- Added workspace routes under `/app/[orgSlug]/overview`, `/app/[orgSlug]/agents`, and `/app/[orgSlug]/agents/[agentId]`.
- Added a collapsible console shell with only real Section 1 routes: Overview and Agents.
- Added server API client and Server Actions for Section 1 workflows.
- Converted legacy `/agents` routes into redirects back to auth.
- Added agent roster, agent detail shell, and connection panel.
- Added a configuration-history panel on agent detail, backed by canonical audit events and showing setup/credential history with event domain/category/outcome/time.
- Reduced agent registration to the only required backend field in Section 1: agent name. Description, labels, and environment remain backend-supported metadata but are not shown until they drive real product behavior.
- Added clean premium light-theme product styling with restrained colors, tables, forms, accessible focus states, and responsive layout.
- Simplified the connection UI into an access-credential flow. Credential-level gating is intentionally deferred in `../features-to-discuss-later.md`.

## Why It Was Built This Way

Section 1 is identity before authority. Agents do not get power from type labels. Authority comes later from policies, approvals, integrations, and financial controls.

Connections are the credential boundary. A registered agent can exist without a connection or wallet, and each runtime can receive a separately rotatable credential.

Credentials are authentication material only in Section 1. Read-only/admin/payment-request credential tiers are not built here because they are policy and authorization semantics, not identity semantics.

Wallet references are metadata only in this section. No funding, signing, top-up, or payment execution was added.

Human auth is real for the app path. Google sign-in creates a backend session whose raw token is only held by the browser cookie, while the database stores the SHA-256 hash. The API still keeps an injectable operator resolver for older low-level tests, but app routes use session and membership resolution.

Organization slugs are globally unique routing handles, not authority. Authority comes from the user's membership row in the resolved org. A guessed slug returns not found for non-members.

## Backend Boundary

Built now:

- `GET /v1/auth/google/authorize-url`
- `POST /v1/auth/google/exchange`
- `GET /v1/auth/me`
- `POST /v1/auth/logout`
- `POST /v1/orgs`
- `GET /v1/orgs`
- `GET /v1/orgs/by-slug/:slug`
- `GET /v1/orgs/:orgId`
- `GET /v1/orgs/:orgId/teams`
- `POST /v1/orgs/:orgId/teams`
- `PATCH /v1/orgs/:orgId/teams/:teamId`
- `POST /v1/orgs/:orgId/teams/:teamId/archive`
- `GET /v1/orgs/:orgId/agents`
- `POST /v1/orgs/:orgId/agents`
- `GET /v1/orgs/:orgId/agents/:agentId`
- `PATCH /v1/orgs/:orgId/agents/:agentId`
- `POST /v1/orgs/:orgId/agents/:agentId/pause`
- `POST /v1/orgs/:orgId/agents/:agentId/activate`
- `POST /v1/orgs/:orgId/agents/:agentId/deactivate`
- `GET /v1/orgs/:orgId/agents/:agentId/connections`
- `POST /v1/orgs/:orgId/agents/:agentId/connections`
- `POST /v1/orgs/:orgId/connections/:connectionId/test`
- `POST /v1/orgs/:orgId/connections/:connectionId/rotate`
- `POST /v1/orgs/:orgId/connections/:connectionId/revoke`
- `POST /v1/connections/auth/check`
- `GET /v1/orgs/:orgId/agents/:agentId/wallet-refs`
- `POST /v1/orgs/:orgId/agents/:agentId/wallet-refs`
- `DELETE /v1/orgs/:orgId/agents/:agentId/wallet-refs/:walletRefId`

Deferred:

- Member invite UX and member management screens.
- Policy bindings and decisions.
- MCP tool server.
- Payment intents and wallet execution.
- Full Evidence Pack UI.

## Frontend Boundary

Built now:

- Public landing route at `/`.
- Google sign-in route at `/auth`.
- Org onboarding route at `/onboarding`.
- Workspace overview at `/app/[orgSlug]/overview`.
- Agents page with create-agent form and roster at `/app/[orgSlug]/agents`.
- Agent detail page with overview, lifecycle actions, connections, and configuration history at `/app/[orgSlug]/agents/[agentId]`.
- Logout through the BFF route.
- One-time connection secret reveal after create/rotate.
- Wallet reference UI is intentionally not exposed in Section 1 because wallet creation, treasury, funding, and payment execution are not built yet.
- A simplified access credential form with no premature channel/type dropdown.
- Product-wide light/dark theme support for auth, onboarding, and authenticated workspace pages, with the public landing intentionally left without a toggle.
- Auth/onboarding entry shell uses the shared video-led layout with local `AuthVideo.mp4`, a single bottom-left product line, no fake setup checklist, and a real Google provider mark in Google actions.
- Fixed credential test/rotate/revoke/lifecycle actions so empty-body server calls no longer send a JSON content type and therefore do not fail API body parsing.
- Fixed agent detail route refresh to use `/app/[orgSlug]/agents/[agentId]` instead of stale legacy `/agents/[agentId]` paths after mutations.
- Replaced the animated placeholder-heavy sidebar with a CSS-only workspace rail that exposes only real Section 1 navigation: Overview, Agents, workspace switch, theme toggle, and logout.
- Removed stale environment, parent, and label display from agent detail and roster surfaces because those fields do not drive any Section 1 behavior.
- Fixed credential action behavior so revoked credentials become display-only rows and rotation shows the full newly issued secret in a visible one-time reveal block.
- Added a visible credential test success state so users see `Credential test passed.` on the row instead of needing to inspect the Next.js Server Action transport payload.
- Removed the wallet reference panel and wallet-reference metric from agent detail. Backend wallet-reference support remains reserved for later wallet/treasury sections.
- Replaced the flat activity list with configuration history. It now shows agent and credential audit events, including credential created, rotated, and revoked actions.
- Refined configuration history so credential test checks are not stored or shown as audit history. Testing a credential only updates operational health fields.
- Credential history rows now show the credential display name and safe ending metadata where available. Raw `conn_...` internal IDs are kept out of the agent-detail activity DTO and UI.

Deferred:

- Rich members/settings UI.
- Connection health live stream.
- Credential-level gating and credential scopes.
- Policy and approval flows.
- Payment and treasury panels.

## Verification

Commands passed:

- `npm --workspace @agentops-pmoa/api run typecheck`
- `TEST_DATABASE_URL=postgres://agentops:agentops@localhost:5432/agentops_pmoa_test npm --workspace @agentops-pmoa/api test`
- `npm --workspace @agentops-pmoa/web test`
- `npm --workspace @agentops-pmoa/web run typecheck`
- `npm --workspace @agentops-pmoa/web run lint`
- `npm --workspace @agentops-pmoa/web run build`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `TEST_DATABASE_URL=postgres://agentops:agentops@localhost:5432/agentops_pmoa_test npm test`
- `TEST_DATABASE_URL=postgres://agentops:agentops@localhost:5432/agentops_pmoa_test npm run verify`

Final verification result:

- Full workspace verify: PASS.
- API tests: 11 files, 31 tests passed.
- Web tests: 7 files, 22 tests passed.
- DB tests: 2 files, 4 tests passed.
- Config tests: 1 file, 1 test passed.
- Contracts tests: 1 file, 1 test passed.

Runtime smoke checks passed:

- `GET http://localhost:8080/healthz` returned Section 1 health.
- `GET http://localhost:3005/` returned the public landing.
- `GET http://localhost:3005/auth` returned the Google sign-in page without a session.
- `GET http://localhost:3005/auth` includes `/AuthVideo.mp4`, the strict control harness line, the light/dark theme toggle, and Google SVG mark.
- `GET http://localhost:3005/auth` does not include the removed `Join agentOps`, setup-step, fake quote, password, or generic sign-in copy.
- `GET http://localhost:8080/v1/orgs` returned 401 without a session.
- `GET http://localhost:3005/api/auth/google/start` returned a 307 Google OAuth redirect with the `localhost:3005` callback.

## Local Run Notes

Current local runtime:

- Local Postgres database: `agentops`
- API: `http://localhost:8080`
- Web: `http://localhost:3005`

The local PMOA dev database was reset before this handoff and has migrations `0001` through `0005` applied. The API uses the documented `DATABASE_URL` and runs migrations on boot. In the managed sandbox, both `tsx watch` and Next dev need sandbox escalation because they bind local IPC/ports.

## What Remains For Later Sections

Section 2 can now bind policies to real org/team/agent/connection identities.

Section 3 can use Section 1 actors and Section 11A audit events for approvals/activity.

Section 4 can authenticate agent runtimes through `connection_credentials`.

Section 6 can attach managed wallets to agents without redefining identity.
