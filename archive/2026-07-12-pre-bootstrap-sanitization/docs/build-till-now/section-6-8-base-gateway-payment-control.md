---
created: 2026-07-08
project: agentOps
ecosystem: circle
tags: [section-6, section-7, section-8, payments, gateway, x402, build-history]
---

# Sections 6-8 - Base Gateway Payment Control

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-5-agent-operational-controls]]

## What Was Built

Sections 6-8 add the first payment-control spine for x402 and agent spending.

Backend:

- Added org Gateway treasury records for Base.
- Added payment sources for Base rails.
- Added per-agent payment access accounts.
- Payment access is disabled by default for every agent.
- Added payment reservations and payment events.
- Added payment route observations so rejected and accepted rails are visible later.
- Added human-authenticated payment setup endpoints:
  - `GET /v1/orgs/:orgId/payments/treasury`
  - `POST /v1/orgs/:orgId/payments/treasury`
  - `GET /v1/orgs/:orgId/payments/sources`
  - `POST /v1/orgs/:orgId/payments/sources`
  - `GET /v1/orgs/:orgId/agents/:agentId/payments`
  - `POST /v1/orgs/:orgId/agents/:agentId/payment-access`
- Added runtime-authenticated x402 payment endpoint:
  - `POST /v1/runtime/payments/x402`
- The runtime payment endpoint enforces:
  - valid agent connection credential,
  - payment access enabled,
  - allowed rail,
  - Base-only chain support,
  - Gateway-compatible x402 accept shape,
  - per-request cap,
  - agent budget,
  - active source availability,
  - simulated source balance.
  - active `payment.x402.authorize` policies before submission,
  - one-time approval proof when policy requires approval.

MCP:

- Added `agentops.payment_x402`.
- Preserved backend approval metadata in MCP tool errors so agents receive `approvalId` and `decisionId`.
- MCP remains a standalone stdio service and delegates payment execution to the backend runtime endpoint.

Frontend:

- Added `Payments` to the app sidebar.
- Added `/app/[orgSlug]/payments`.
- Built a payments workbench with:
  - treasury state,
  - source state,
  - agent payment access state,
  - Gateway treasury setup form,
  - Base Gateway source setup form,
  - agent payment access form.

## Why It Was Built This Way

The payment surface is intentionally Base-first and payment-access-off by default.

Circle Gateway can provide a unified USDC balance, but x402 sellers/facilitators may require a specific payment method and exact verification path. The product therefore does not assume that every x402 `exact` request can be paid through Gateway. The runtime endpoint accepts only Gateway-compatible x402 requests for the first implemented rail.

The backend owns the spend decision and payment ledger. MCP and future SDKs are only adapters. This prevents agents from treating local prompt instructions as the source of authority.

The provider boundary is explicit:

- Built now: local `simulation` provider mode over real payment-access, budget, reservation, event, and activity tables.
- Deferred: live Circle Gateway client signing/broadcasting and Circle wallet creation.

## Backend Boundary

Built now:

- Base Gateway treasury/source data model.
- Agent payment access account model.
- Budget and per-request cap enforcement.
- Policy gating for `payment.x402.authorize` before payment event insertion.
- Approval-required flow for x402 payment submission with context-hash matching.
- Runtime x402 payment submission endpoint.
- Payment reservations and payment events.
- Payment activity and audit events.
- Route observations for rejected/accepted payment rail requests.

Deferred:

- Live Circle Gateway client integration.
- Circle developer-controlled wallet creation.
- Dedicated wallet funding/rebalancing automation.
- Direct exact Base payments from agent wallets.
- Cross-chain Gateway payouts beyond Base.
- Settlement webhook reconciliation.
- UI for disabling/removing sources or payment accounts.
- Rich payment approval UX beyond the existing approvals inbox.

## Frontend Boundary

Built now:

- Payments page in the authenticated app shell.
- Real forms for treasury/source/access setup.
- Real display of configured sources and per-agent access.

Deferred:

- Dedicated wallet creation UI.
- Live settlement status drilldown.
- Rebalance recommendations.
- Payment event detail drawer.
- Disable/archive controls for treasury/source/account records.

## Files Changed

Backend:

- `packages/db/src/migrations/0009_section_6_8_payment_control.sql`
- `packages/db/test/migrate.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/api/src/engines/approvals/types.ts`
- `apps/api/src/engines/payments/routes.ts`
- `apps/api/src/engines/payments/store.ts`
- `apps/api/src/engines/payments/types.ts`
- `apps/api/test/payments/section-6-8-payment-control.test.ts`

MCP:

- `apps/mcp/src/runtime-client.ts`
- `apps/mcp/src/tools.ts`
- `apps/mcp/test/tools.test.ts`

Frontend:

- `apps/web/src/app/actions/payments.ts`
- `apps/web/src/app/app/[orgSlug]/payments/page.tsx`
- `apps/web/src/components/ConsoleShell.tsx`
- `apps/web/src/components/payments/PaymentsWorkbench.tsx`
- `apps/web/src/lib/payments-types.ts`
- `apps/web/src/lib/server/payments-client.ts`
- `apps/web/src/app/globals.css`

## Verification

Commands run so far:

- `npm --workspace @agentops-pmoa/db run build`
- `TEST_DATABASE_URL=postgres://agentops:agentops@127.0.0.1:55432/agentops_pmoa_test npm --workspace @agentops-pmoa/api test -- test/payments/section-6-8-payment-control.test.ts`
- `npm --workspace @agentops-pmoa/api test -- test/health.test.ts`
- `npm --workspace @agentops-pmoa/api run typecheck`
- `npm --workspace @agentops-pmoa/mcp run typecheck`
- `npm --workspace @agentops-pmoa/mcp test`
- `npm --workspace @agentops-pmoa/web run typecheck`
- `npm --workspace @agentops-pmoa/web test -- tests/console-shell.test.tsx tests/payments/payments-workbench.test.tsx`
- `npm --workspace @agentops-pmoa/api run lint`
- `npm --workspace @agentops-pmoa/mcp run lint`
- `npm --workspace @agentops-pmoa/web run lint`
- `npm --workspace @agentops-pmoa/db run typecheck`

Focused verification result:

- API Section 6-8 payment test: 1 file, 2 tests passed.
- API health test: 1 file, 1 test passed.
- MCP tests: 2 files, 10 tests passed.
- Web shell/payments tests: 2 files, 2 tests passed.
- API, MCP, and web lint passed.
- API, MCP, web, and DB typecheck/build checks passed.

Verification note:

- Testcontainers could not auto-detect the local Docker runtime in this shell. The payment integration was verified through the existing `TEST_DATABASE_URL` test helper path against a disposable local Postgres container.

## What Remains For Later Sections

Sections 6-8 now define the product and backend control plane for payment access. Live money movement is still blocked until a real Circle Gateway provider is wired and tested with real credentials and a supported x402 facilitator path.
