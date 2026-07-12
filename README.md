---
created: 2026-07-06
updated: 2026-07-12
project: agentOps
ecosystem: circle
tags: [readme, product, setup, testnet, mcp, circle]
---

# agentOps

Backlinks: [[10-Projects/Web3-Builds/agentOps/HANDOFF]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/PRODUCT]]

agentOps is a testnet control plane for teams operating autonomous agents. It combines agent identity, runtime credentials, policy enforcement, human approvals, operational rate limits, Circle-backed USDC treasury execution, MCP integration, and hash-chained evidence in one organization-isolated product.

The current release is intentionally **testnet only**. It does not represent mainnet payment execution as available.

## Product Surface

- **Organizations and access:** Google OAuth, organization membership, roles, teams, and tenant-isolated reads and mutations.
- **Managed agents:** agent identities, runtime credentials, pause/deactivate controls, wallet references, effective policies, and activity history.
- **Policy controls:** action-specific policy drafts, validation, simulations, immutable revisions, activation, target assignment, archival, and runtime decisions.
- **Approvals:** expiring approval requests, one-time approve/deny decisions, and one-time consumption tied to the original decision.
- **Operations:** managed tool catalog, rate limits, runtime decisions, and auditable control changes.
- **Treasury:** organization-scoped Circle Agent Wallet sessions, five testnet chain wallets, exact and Gateway x402 rails, payment access and budgets, provider jobs, liquidity preparation, balances, and evidence.
- **MCP:** an independent stdio MCP server exposing the same runtime policy and approval plane used by direct API clients.
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

Agent / MCP host  --->  standalone stdio MCP  --->  Fastify runtime API
```

| Workspace | Responsibility |
|---|---|
| `apps/web` | Next.js operator console and OAuth BFF |
| `apps/api` | Fastify API, identity, policy, approvals, operations, payments, evidence |
| `apps/api/src/circle-worker.ts` | Private multi-tenant Circle CLI/provider worker and liquidity-job processor |
| `apps/mcp` | Independent stdio MCP adapter for managed agents |
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
4. Generates a base64 32-byte Circle profile encryption key and a random internal worker token when absent.
5. Starts local PostgreSQL and Redis only when the configured local ports are not already reachable.
6. Installs the locked npm dependency graph, verifies the pinned Circle CLI, rejects high/critical npm advisories, and builds shared packages/migrations.
7. Starts and health-checks web `3005`, API `8080`, and Circle worker `8090`.
8. Keeps the three application services supervised until you press `Ctrl+C`.

Service logs are written to `.runtime/logs/`. PostgreSQL and Redis data use named Docker volumes and remain available after the application services stop.

Open [http://localhost:3005](http://localhost:3005), sign in with Google, create an organization, and connect its Circle Agent Wallet from Treasury setup. OTP values are handled by the product flow and are never written to repository env files.

## Start an Existing Installation

```bash
./startup.sh --run-only
```

`startup.sh` is a compatibility entrypoint to the same bootstrap implementation. `--run-only` validates existing env files, dependencies, and infrastructure and starts the three application services. It does not create env files, prompt for credentials, run `npm install`, or rebuild packages.

The equivalent npm command is:

```bash
npm run start:local
```

If any application port is already occupied, startup fails without killing the existing process.

## Environment Contract

Local secrets remain gitignored. The bootstrap validates these cross-service invariants:

- API uses port `8080`; web uses `3005`; the private Circle worker uses `8090`.
- API and web use the same `APP_BASE_URL` and `SESSION_COOKIE_NAME`.
- Google OAuth redirects through the web BFF callback.
- `CIRCLE_WORKER_TOKEN` is at least 32 characters.
- `CIRCLE_PROFILE_MASTER_KEY` decodes to exactly 32 bytes.
- Database and Redis URLs use supported URL schemes.

See [docs/env-inventory.md](docs/env-inventory.md) for the current key inventory. To use managed PostgreSQL or Redis, populate their URLs before running setup; the bootstrap skips local Docker startup for non-local endpoints.

## MCP Server

The MCP process is stdio-based and starts when an MCP host launches it. It is not a fourth HTTP daemon.

```bash
cp apps/mcp/.env.example apps/mcp/.env
# Set AGENTOPS_MCP_CREDENTIAL to an agent runtime credential created in the console.
npm run dev:mcp
```

For Claude Desktop or another MCP host, launch the built server with an absolute path or run the workspace development command. Never write logs to stdout from the stdio server.

## Development Commands

```bash
npm run dev:web             # Next.js; pass -- --port 3005 when run manually
npm run dev:api             # Fastify API
npm run dev:circle-worker   # private Circle worker
npm run dev:mcp             # standalone stdio MCP

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
| Circle worker | `http://127.0.0.1:8090/healthz` | private network only |
| Web | `http://127.0.0.1:3005/` | public deployment service |

All `/internal/circle/*` routes require the worker bearer token. The worker owns decrypted temporary Circle CLI profiles; the web and public API must never receive profile encryption keys, OTPs, or decrypted provider state.

## Current Documentation

- [PRODUCT.md](PRODUCT.md): product boundaries and language.
- [DESIGN.md](DESIGN.md): authenticated-console design contract.
- [docs/env-inventory.md](docs/env-inventory.md): current environment keys and ownership.
- [docs/deployment/testnet-circle-worker.md](docs/deployment/testnet-circle-worker.md): deployment and worker security model.
- [docs/qa/2026-07-12-testnet-release-evidence.md](docs/qa/2026-07-12-testnet-release-evidence.md): latest accepted testnet evidence.
- [docs/features-to-discuss-later.md](docs/features-to-discuss-later.md): deliberately deferred product work.

Historical audits, build journals, critiques, screenshots, wireframes, and completed plans are retained under [archive/2026-07-12-pre-bootstrap-sanitization](archive/2026-07-12-pre-bootstrap-sanitization/README.md). They are reference material, not current implementation instructions.
