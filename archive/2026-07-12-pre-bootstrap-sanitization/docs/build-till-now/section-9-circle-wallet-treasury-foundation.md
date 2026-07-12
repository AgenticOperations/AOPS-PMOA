---
created: 2026-07-09
project: agentOps
ecosystem: circle
tags: [build-pmoa, section-9, circle, wallets, treasury]
---

# Section 9 — Circle Wallet Treasury Foundation

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-6-8-base-gateway-payment-control]]

## What Was Built

Section 9 adds the production-facing Circle treasury foundation on top of the Section 6-8 payment controls.

- Workspace provider mode: `test` or `live`.
- Circle provider health endpoint that checks server-side Circle credentials.
- Top-five chain capability registry:
  - Base
  - Arbitrum
  - Polygon
  - Optimism
  - Avalanche
- Org-maintained Circle wallet-set model.
- One Circle EOA wallet per supported chain.
- Wallet-backed treasury/source rows created when the wallet set is provisioned.
- Payments UI section for provider mode, Circle wallet readiness, chain coverage, and blocked setup state.

## Backend Boundary

Added migration `0010_section_9_circle_treasury.sql` with:

- `org_payment_modes`
- `circle_chain_capabilities`
- `circle_wallet_sets`
- `circle_chain_wallets`
- `circle_provider_jobs`
- expanded payment chains and rails
- `payment_events.provider_mode` expanded to `simulation | test | live`

Added Circle provider module:

- `health(mode)`
- `createWalletSet(input)`
- `createWallet(input)`

Circle Developer Controlled Wallet creation requires an API key and entity secret. A Circle client key alone is not a server signer secret. Source: `@circle-fin/developer-controlled-wallets` package README, setup and client initialization sections.

## Frontend Boundary

The Payments page now renders:

- provider mode status and mode switch
- Circle configuration state
- five chain wallet deployment cards
- disabled Create org treasury action when the server lacks the required entity secret
- existing Gateway/source/access controls from Section 6-8

The app deliberately does not ask an organization admin to paste a Circle API key. Circle credentials remain server-side.

## Verification

Automated checks passed:

- `npm --workspace @agentops-pmoa/api run typecheck`
- `npm --workspace @agentops-pmoa/api run lint`
- `npm --workspace @agentops-pmoa/api test -- test/health.test.ts test/payments/circle-provider.test.ts test/payments/section-6-8-payment-control.test.ts test/payments/section-9-circle-treasury.test.ts`
- `npm --workspace @agentops-pmoa/web run typecheck`
- `npm --workspace @agentops-pmoa/web run lint`
- `npm --workspace @agentops-pmoa/web test -- tests/payments/payments-workbench.test.tsx`
- `npm --workspace @agentops-pmoa/db test -- test/migrate.test.ts`
- `git -C BUILD-PMOA diff --check`

Live browser check passed on Chrome CDP `9223` against `localhost:3005`:

- Payments page loaded for `Test Organisation 1`.
- API `/healthz` returned `section_9`.
- Provider mode showed `Test mode`.
- Chain wallet status showed `0/5`.
- Supported testnet chains rendered: Base Sepolia, Arbitrum Sepolia, Polygon Amoy, OP Sepolia, Avalanche Fuji.
- Circle setup showed missing `CIRCLE_TEST_ENTITY_SECRET`.
- `Create org treasury` was disabled in DOM and visually disabled.
- Browser console had no app errors; only the standard React DevTools info message.

## Remaining Work

Live Circle wallet deployment cannot be executed until the workspace has the correct server-side entity secret configured:

- `CIRCLE_TEST_ENTITY_SECRET` for test mode
- `CIRCLE_LIVE_ENTITY_SECRET` for live mode

Gateway live settlement, x402 facilitator payment submission, webhook reconciliation, automatic wallet funding, and cross-chain rebalance orchestration remain future Section 9 follow-up work after Circle wallet signing is fully configured and tested.
