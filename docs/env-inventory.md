---
created: 2026-07-06
project: agentOps
ecosystem: circle
tags: [build-pmoa, env, circle, arc, secrets]
---

# BUILD-PMOA Env Inventory

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/README]] | [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/40-final-implementation-readiness-and-build-sequence]]

This file lists env key names only. It does not contain secret values.

## API Env Sources

Copied from `BUILD/Backend/.env` and `BUILD/Backend/.env.example` into `BUILD-PMOA/apps/api/`.

Expected API keys include:

- `NODE_ENV`
- `HOST`
- `PORT`
- `LOG_LEVEL`
- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_COOKIE_NAME`
- `COOKIE_DOMAIN`
- `APP_BASE_URL`
- `AUTH_RATE_LIMIT`
- `AUTH_RATE_WINDOW_SECONDS`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URL`
- `ARC_RPC_URL`
- `ARC_CHAIN_ID`
- `ARC_USDC_ADDRESS`
- `ARC_LIVE`
- `GATEWAY_WALLET_ADDRESS`
- `GATEWAY_MINTER_ADDRESS`
- `SOLANA_RPC_URL`
- `KMS_PROVIDER`
- `KMS_TREASURY_KEY_ID`
- `KMS_AGENT_FLOAT_KEY_ID`
- `TREASURY_PRIVATE_KEY`
- `AGENT_FLOAT_PRIVATE_KEY`
- `CIRCLE_API_BASE`
- `CIRCLE_API_KEY`
- `CIRCLE_GATEWAY_LIVE`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `DEMO_ENABLED`
- `DEMO_VENDOR_HOST`
- `DEMO_VENDOR_ADDRESS`
- `DEMO_RESOURCE`

## Web Env Sources

Copied from `BUILD/Frontend/.env.local` and `BUILD/Frontend/.env.example` into `BUILD-PMOA/apps/web/`.

Expected web keys include:

- `AGENTOPS_API_BASE_URL`
- `OPERATOR_ADMIN_KEY`
- `AGENTOPS_ORG_ID`
- `ARC_ENV_LABEL`
- `SESSION_COOKIE_NAME`
- `APP_BASE_URL`

## MCP Env Sources

Defined in `BUILD-PMOA/apps/mcp/.env.example`.

Expected MCP keys include:

- `AGENTOPS_API_BASE_URL`
- `AGENTOPS_MCP_CREDENTIAL`
- `AGENTOPS_MCP_TIMEOUT_MS`

## Rules

- Never print env values in logs, tests, docs, or final responses.
- Add new env keys to `.env.example` before using them in code.
- Validate env at app boot with a typed schema.
- Provider credentials are not evidence that a feature is production-ready; live provider behavior still needs verification gates.

## Section 11A Database Rule

`DATABASE_URL` is the single database target switch for PMOA.

- Local-first: use local Postgres or the copied local `.env`.
- Cloud-ready: set `DATABASE_URL` to managed Postgres or Supabase.
- Do not print or log the URL.
- Do not run PMOA migrations against the old `BUILD` database until an explicit compatibility plan exists.
- Evidence routes still need an injected authenticated org resolver; `DATABASE_URL` alone must not expose audit reads.
