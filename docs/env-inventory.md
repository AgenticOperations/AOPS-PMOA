---
created: 2026-07-06
updated: 2026-07-12
project: agentOps
ecosystem: circle
tags: [environment, setup, security, circle, oauth]
---

# Environment Inventory

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/README]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/deployment/testnet-circle-worker]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/deployment/hosted-mcp]]

This inventory lists key names and ownership only. It must never contain credential values.

## Required Local Product Values

### API and Circle worker: `apps/api/.env`

| Key | Owner | Purpose |
|---|---|---|
| `NODE_ENV` | API/worker | Runtime mode |
| `HOST`, `PORT` | API | API listener; supported local port is `8080` |
| `LOG_LEVEL` | API/worker | Structured log level |
| `DATABASE_URL` | API/worker | PostgreSQL authority and migration target |
| `REDIS_URL` | API | Payment balance cache and enforcement hot tier |
| `SESSION_COOKIE_NAME` | API/web | Human session cookie contract |
| `APP_BASE_URL` | OAuth/web | Supported local web origin is `http://localhost:3005` |
| `GOOGLE_CLIENT_ID` | OAuth | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth | Google OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URL` | OAuth | Web BFF callback URL |
| `CIRCLE_TREASURY_PROVIDER` | worker | Defaults to `agent_stack` |
| `CIRCLE_PROFILE_MASTER_KEY` | worker only | Base64-encoded 32-byte key encrypting organization Circle profiles |
| `CIRCLE_WORKER_TOKEN` | API/worker | Internal bearer token, minimum 32 characters |
| `CIRCLE_WORKER_URL` | API | Private worker base URL |
| `CIRCLE_WORKER_HOST`, `CIRCLE_WORKER_PORT` | worker | Worker listener; supported local port is `8090` |

`setup.sh` securely asks for missing Google values and generates the two internal Circle worker secrets. It never generates or stores organization OTPs.

## Optional API and Worker Values

- `CIRCLE_CLI_TIMEOUT_MS`, `CIRCLE_CLI_MAX_RETRIES`, `CIRCLE_CLI_RETRY_DELAY_MS`
- `CIRCLE_LIQUIDITY_WORKER_POLL_MS`, `CIRCLE_LIQUIDITY_SUBMITTED_RETRY_MS`
- `CIRCLE_PROVIDER_JOB_TIMEOUT_MS`
- `CIRCLE_GATEWAY_API_BASE`
- `CIRCLE_LIVE_RAIL_VERIFICATION_ENABLED`, `CIRCLE_LIVE_REBALANCE_ENABLED` (not enabled in the testnet product)
- `PUBLIC_API_BASE_URL`

### Developer-controlled provider only

The shipped local flow uses organization-scoped Agent Stack sessions. These values are read only when `CIRCLE_TREASURY_PROVIDER=developer_controlled`:

- `CIRCLE_API_BASE`
- `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`
- `CIRCLE_TEST_API_KEY`, `CIRCLE_TEST_ENTITY_SECRET`
- `CIRCLE_LIVE_API_KEY`, `CIRCLE_LIVE_ENTITY_SECRET`

## Web: `apps/web/.env.local`

| Key | Purpose |
|---|---|
| `AGENTOPS_API_BASE_URL` | Server-only API origin; local value uses port `8080` |
| `ARC_ENV_LABEL` | Honest environment label shown in the console |
| `SESSION_COOKIE_NAME` | Must match the API value |
| `APP_BASE_URL` | Must match the API value and use port `3005` locally |
| `MCP_PUBLIC_URL` | Server-side hosted MCP endpoint shown during one-time credential setup; HTTPS is required in production |

## MCP

### Hosted HTTP service

| Key | Purpose |
|---|---|
| `NODE_ENV` | Runtime mode; production enables fail-closed public URL requirements |
| `AGENTOPS_API_BASE_URL` | Runtime API authority used for credential resolution and governed calls |
| `MCP_HOST`, `MCP_PORT` | Hosted listener; local bootstrap binds `127.0.0.1:8070` |
| `MCP_PUBLIC_URL` | Externally reachable exact `/mcp` URL; HTTPS is required in production |
| `MCP_ALLOWED_HOSTS` | Exact accepted HTTP Host authorities |
| `MCP_ALLOWED_ORIGINS` | Exact browser origins allowed to verify one-time credentials |
| `MCP_MAX_BODY_BYTES` | JSON-RPC request body limit |
| `MCP_MAX_INFLIGHT_REQUESTS` | Process-level concurrent request ceiling |
| `MCP_SHUTDOWN_GRACE_MS` | Maximum graceful drain time after termination begins |
| `AGENTOPS_MCP_TIMEOUT_MS` | Runtime API request timeout |

The hosted service receives the agent credential per request in the bearer header. It must not be configured with a process-wide `AGENTOPS_MCP_CREDENTIAL`.

### Local stdio adapter: `apps/mcp/.env`

| Key | Purpose |
|---|---|
| `AGENTOPS_API_BASE_URL` | Runtime API origin |
| `AGENTOPS_MCP_CREDENTIAL` | One agent runtime credential created by an operator |
| `AGENTOPS_MCP_TIMEOUT_MS` | Upstream request timeout |

The bootstrap does not prompt for `AGENTOPS_MCP_CREDENTIAL`, because credentials are created after an organization and agent exist. The hosted service is one of the four supervised product processes; the stdio adapter is launched only by its local MCP host.

## Security Rules

- Local `.env` files are gitignored and written with owner-only permissions by setup.
- Never print secrets, OTPs, session cookies, private keys, payment signatures, or decrypted Circle profiles.
- The profile master key belongs only on the Circle worker in deployment.
- API and worker must share the same database and worker token.
- The web process must never receive worker secrets or Circle profile material.
- `DATABASE_URL` is the only PMOA database target switch. Never point it at the legacy `BUILD` database without a migration plan.
