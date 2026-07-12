---
created: 2026-07-11
project: agentOps
ecosystem: circle
tags: [implementation, testnet, circle, multitenancy, treasury]
---

# Testnet Circle Multitenancy Implementation Plan

Backlinks: [[10-Projects/Web3-Builds/agentOps/HANDOFF]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-9-circle-wallet-treasury-foundation]]

## Objective

Turn the existing machine-global Circle Agent Wallet CLI integration into a deployed, testnet-only, organization-scoped product flow. Organization creation must continue into optional Circle authentication, OTP completion, automatic treasury synchronization, optional faucet funding, and then the normal console. Every Circle command must execute with the selected organization's encrypted session.

## Invariants

- Testnet is the only selectable and executable product mode.
- One active Circle email may back at most one organization in testnet.
- OTP values are never stored or logged.
- Circle session material is encrypted at rest and decrypted only into a temporary worker directory.
- Both `HOME` and `CIRCLE_CLI_HOME` are isolated per job.
- Every mutating Circle command is idempotent and organization scoped.
- Payment access remains disabled for agents until an admin enables it.
- No HTTP request may fall back to a process-global Circle session.

## Task 1: Validate Circle CLI isolation

- Add a validation harness for isolated `HOME` and `CIRCLE_CLI_HOME` values.
- Prove empty profiles cannot see the host session.
- During final acceptance, authenticate the fresh account inside the isolated worker profile, restore the encrypted profile after a worker restart, and prove another org cannot use it.

## Task 2: Persist encrypted organization connections

Files:

- `packages/db/src/migrations/0018_circle_org_connections.sql`
- `packages/db/test/migrate.test.ts`
- `apps/api/src/engines/payments/circle-session-crypto.ts`
- `apps/api/src/engines/payments/circle-session-store.ts`
- matching API tests

Add `circle_org_connections` and `circle_auth_challenges`. Encrypt profile bundles with AES-256-GCM using a deployment secret. Bind ciphertext to organization, mode, and revision using authenticated additional data.

## Task 3: Add an organization-scoped Circle executor

Files:

- `apps/api/src/engines/payments/circle-agent-cli.ts`
- `apps/api/src/engines/payments/circle-provider.ts`
- provider tests

Add non-interactive login initialization/completion commands. Require an organization execution context for Agent Wallet provider calls. Set isolated environment variables on every `execFile` invocation. Remove the hardcoded healthy-session response and verify the real profile session.

## Task 4: Add the Circle worker boundary

Files:

- `apps/api/src/circle-worker.ts`
- `apps/api/src/engines/payments/circle-worker-app.ts`
- `apps/api/src/engines/payments/circle-worker-client.ts`
- `apps/api/package.json`
- root scripts and deployment files

Use a private authenticated worker service for the testnet MVP. The public API remains the policy and ledger authority and calls only allowlisted internal worker operations. The worker loads the encrypted org profile, decrypts into `tmpfs`, invokes the CLI, persists session changes, and destroys plaintext state. Existing `circle_provider_jobs` remains the durable operational ledger. Serialize worker operations per organization and mode; a durable asynchronous queue can replace the internal request-response transport without changing the provider contract when production volume requires it.

## Task 5: Build connection APIs

Files:

- `apps/api/src/engines/payments/routes.ts`
- `apps/api/src/engines/payments/circle-connection-service.ts`
- route tests

Add status, initialize login, complete OTP, reconnect, and disconnect endpoints. Only owners/admins may connect; disconnect and email changes require owner. Verify the Circle session email before activating a connection.

## Task 6: Make the product testnet only

Files:

- payment mode API/store validation
- Payments UI
- onboarding UI
- tests

Force new and existing organizations into test mode. Reject live-mode writes in the API. Remove the mode switch and all simulation-provider creation controls from the rendered product.

## Task 7: Build optional treasury onboarding

Files:

- `apps/web/src/app/onboarding/**`
- `apps/web/src/app/actions/identity-spine.ts`
- `apps/web/src/app/actions/payments.ts`
- `apps/web/src/lib/server/payments-client.ts`
- new focused onboarding components and tests

Flow: organization name -> optional Circle connection -> OTP -> automatic wallet/treasury/source sync -> optional faucet -> completion. Persist each step in `org_onboarding_states`. Skipping Circle enters the console with payments disconnected and resumable from Payments or Settings.

## Task 8: Automate treasury bootstrap

After successful Circle authentication, create or reconcile the existing treasury, wallet-set, five chain-wallet, exact source, and Gateway source records. Do not ask users to manually create payment sources. Keep faucet funding and Gateway deposit explicit because they move funds.

## Task 9: Verification

- Unit tests for encryption, challenge expiry, OTP non-persistence, session ownership, and idempotency.
- API integration tests for RBAC, cross-org access denial, testnet-only enforcement, retries, and expired sessions.
- Worker tests with a fake CLI executable and separate temporary profiles.
- Browser QA through CDP 9223.
- Existing Ryuk and OpenAssets org regression.
- Fresh `abhinavpangaria2001@gmail.com` onboarding with real OTP, wallet discovery, faucet, treasury, exact x402, Gateway x402, and rebalancing.

## Completion Gate

The feature is complete only when the fresh-email flow works without a terminal command and cross-organization tests prove that no organization can execute against another organization's Circle session or wallets.
