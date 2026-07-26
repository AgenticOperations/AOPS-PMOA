---
created: 2026-07-06
updated: 2026-07-13
project: agentOps
ecosystem: circle
tags: [readme, product, setup, testnet, mcp, circle]
---

# agentOps

Backlinks: [[10-Projects/Web3-Builds/agentOps/HANDOFF]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/PRODUCT]]

agentOps is a testnet control plane for teams operating autonomous agents. It combines agent identity, runtime credentials, policy enforcement, human approvals, operational rate limits, Circle-backed USDC treasury execution, MCP integration, and hash-chained evidence in one organization-isolated product.

The current release is intentionally **testnet only**. It does not represent mainnet payment execution as available.

## Build on Arc — Checkpoint 2

The latest tested checkpoint is on
[`feat/mcp-paid-http`](https://github.com/AgenticOperations/AOPS-PMOA/tree/feat/mcp-paid-http).
It demonstrates the working Circle-native control foundation that AOPS is
taking onto Arc next.

- [Pitch deck](submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2.pptx)
- [Judge factsheet](submission/pmoa-checkpoint-2/README.md)
- [Paid HTTP release evidence](docs/qa/2026-07-13-x402-paid-http-evidence.md)

## Product Surface

- **Organizations and access:** Google OAuth, organization membership, roles, teams, and tenant-isolated reads and mutations.
- **Managed agents:** agent identities, runtime credentials, pause/deactivate controls, wallet references, effective policies, and activity history.
- **Policy controls:** action-specific policy drafts, validation, simulations, immutable revisions, activation, target assignment, archival, and runtime decisions.
- **Approvals:** expiring approval requests, one-time approve/deny decisions, and one-time consumption tied to the original decision.
- **Operations:** managed tool catalog, rate limits, runtime decisions, and auditable control changes.
- **Treasury:** organization-scoped Circle Agent Wallet sessions, five testnet chain wallets, exact and Gateway x402 rails, payment access and budgets, provider jobs, liquidity preparation, balances, and evidence.
- **MCP:** a hosted Streamable HTTP service for remote agents plus a supported local stdio adapter, both exposing the same eight-tool runtime contract.
- **Evidence:** classified, tenant-fenced, hash-chained audit events for operator and runtime actions.

## Architecture

```text
Browser / operator
       |
       v
Next.js web :3005  --->  Fastify API :8080  --->  PostgreSQL
                              |                  Redis
                              v
                    Circle worker :8090
                    (private provider boundary)

Remote agent  --->  hosted MCP :8070  ---+
                                          +--->  Fastify runtime API
Local host    --->  standalone stdio MCP -+
```

| Workspace | Responsibility |
|---|---|
| `apps/web` | Next.js operator console and OAuth BFF |
| `apps/api` | Fastify API, identity, policy, approvals, operations, payments, evidence |
| `apps/api/src/circle-worker.ts` | Private multi-tenant Circle CLI/provider worker and liquidity-job processor |
| `apps/mcp` | Hosted Streamable HTTP MCP service and local stdio adapter |
| `packages/contracts` | Shared wire contracts |
| `packages/config` | Shared configuration helpers |
| `packages/db` | PostgreSQL migrations and migration runner |

## Requirements

- macOS or Linux with Bash
- Node.js `22.13.0` or newer and npm
- Docker Desktop with Compose v2 when using the bundled local PostgreSQL and Redis
- A Google OAuth web client configured with this callback:

  `http://localhost:3005/api/auth/google/callback`

Circle Agent Wallet access is connected **per organization inside the product** using email and OTP. The default `agent_stack` provider does not require a global Circle API key in the local env file.

## One-Command Setup

```bash
./setup.sh
```

The setup command:

1. Validates Node and npm.
2. Creates missing `apps/api/.env` and `apps/web/.env.local` files from their templates.
3. Asks one at a time for missing Google OAuth values. Secret input is not echoed.
4. Generates distinct base64 32-byte Circle profile and x402 result encryption keys plus a random internal worker token when absent.
5. Starts local PostgreSQL and Redis only when the configured local ports are not already reachable.
6. Installs the locked npm dependency graph, verifies the pinned Circle CLI, rejects high/critical npm advisories, and builds shared packages/migrations.
7. Starts and health-checks web `3005`, hosted MCP `8070`, API `8080`, and Circle worker `8090`.
8. Keeps all four application services supervised until you press `Ctrl+C`.

Service logs are written to `.runtime/logs/`. PostgreSQL and Redis data use named Docker volumes and remain available after the application services stop.

Open [http://localhost:3005](http://localhost:3005), sign in with Google, create an organization, and connect its Circle Agent Wallet from Treasury setup. OTP values are handled by the product flow and are never written to repository env files.

## Start an Existing Installation

```bash
./startup.sh --run-only
```

`startup.sh` is a compatibility entrypoint to the same bootstrap implementation. `--run-only` validates existing env files, dependencies, and infrastructure and starts the four application services. It does not create env files, prompt for credentials, run `npm install`, or rebuild packages.

The equivalent npm command is:

```bash
npm run start:local
```

If any application port is already occupied, startup fails without killing the existing process.

## Environment Contract

Local secrets remain gitignored. The bootstrap validates these cross-service invariants:

- API uses port `8080`; web uses `3005`; hosted MCP uses `8070`; the private Circle worker uses `8090`.
- API and web use the same `APP_BASE_URL` and `SESSION_COOKIE_NAME`.
- Google OAuth redirects through the web BFF callback.
- `CIRCLE_WORKER_TOKEN` is at least 32 characters.
- `CIRCLE_PROFILE_MASTER_KEY` decodes to exactly 32 bytes.
- `X402_RESULT_ENCRYPTION_KEY` decodes to exactly 32 bytes and is distinct from the worker-only Circle profile key.
- Database and Redis URLs use supported URL schemes.

See [docs/env-inventory.md](docs/env-inventory.md) for the current key inventory. To use managed PostgreSQL or Redis, populate their URLs before running setup; the bootstrap skips local Docker startup for non-local endpoints.

## MCP Server

The normal product path is the hosted Streamable HTTP endpoint:

```text
http://127.0.0.1:8070/mcp
```

Create an agent in the console, open **Credentials & wallets**, and issue a credential. The one-time reveal provides the endpoint, Claude Code configuration, Codex command, local adapter, governance instruction, and a browser verification action. Remote calls authenticate with `Authorization: Bearer <agent credential>`; plaintext credentials are never stored or shown again.

Agents call `agentops.payment_x402` with one bounded HTTP request and an idempotency key. AgentOps performs discovery, policy and approval enforcement, budget reservation, Circle settlement, durable recovery, and the paid retry, then returns the exact bounded merchant response to the same MCP caller. Production paid-resource URLs require HTTPS; the local QA merchant fixtures remain disabled unless `ENABLE_TESTNET_X402_FIXTURES=true` is explicitly set for an isolated test run.

The local stdio adapter remains supported for repository-local hosts:

```bash
cp apps/mcp/.env.example apps/mcp/.env
# Set AGENTOPS_MCP_CREDENTIAL to an agent runtime credential created in the console.
npm run dev:mcp
```

For Claude Desktop or another stdio MCP host, launch the built server with an absolute path or run the workspace development command. Never write logs to stdout from the stdio server. Hosted deployment, security, client setup, and health-check details are in [docs/deployment/hosted-mcp.md](docs/deployment/hosted-mcp.md).

## Development Commands

```bash
npm run dev:web             # Next.js; pass -- --port 3005 when run manually
npm run dev:api             # Fastify API
npm run dev:circle-worker   # private Circle worker
npm run dev:mcp             # standalone stdio MCP
npm run dev:mcp:http        # hosted Streamable HTTP MCP on 8070

npm run lint
npm run typecheck
npm test
npm run build
npm run verify
```

The API and Circle worker apply pending PostgreSQL migrations at startup. Do not point `DATABASE_URL` at the legacy `BUILD` database.

The current Circle CLI/Solana dependency chain reports moderate npm advisories with no non-breaking upstream fix. Setup reports them but fails only on high or critical advisories; do not use `npm audit fix --force` without re-running the payment-provider regression suite.

## Health and Operations

| Service | Health endpoint | Exposure |
|---|---|---|
| API | `http://127.0.0.1:8080/healthz` | public deployment service |
| Hosted MCP | `http://127.0.0.1:8070/healthz` | public deployment service; `/mcp` requires an agent bearer credential |
| Circle worker | `http://127.0.0.1:8090/healthz` | private network only |
| Web | `http://127.0.0.1:3005/` | public deployment service |

All `/internal/circle/*` routes require the worker bearer token. The worker owns decrypted temporary Circle CLI profiles; the web and public API must never receive profile encryption keys, OTPs, or decrypted provider state.

## Current Documentation

- [PRODUCT.md](PRODUCT.md): product boundaries and language.
- [DESIGN.md](DESIGN.md): authenticated-console design contract.
- [docs/env-inventory.md](docs/env-inventory.md): current environment keys and ownership.
- [docs/deployment/testnet-circle-worker.md](docs/deployment/testnet-circle-worker.md): deployment and worker security model.
- [docs/deployment/hosted-mcp.md](docs/deployment/hosted-mcp.md): hosted MCP deployment, security, and client contract.
- [docs/qa/2026-07-13-x402-paid-http-evidence.md](docs/qa/2026-07-13-x402-paid-http-evidence.md): real-agent MCP settlement, replay, credential lifecycle, and final verification evidence.
- [docs/qa/2026-07-12-testnet-release-evidence.md](docs/qa/2026-07-12-testnet-release-evidence.md): latest accepted testnet evidence.
- [docs/features-to-discuss-later.md](docs/features-to-discuss-later.md): deliberately deferred product work.

Historical audits, build journals, critiques, screenshots, wireframes, and completed plans are retained under [archive/2026-07-12-pre-bootstrap-sanitization](archive/2026-07-12-pre-bootstrap-sanitization/README.md). They are reference material, not current implementation instructions.
