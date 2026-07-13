---
created: 2026-07-12
updated: 2026-07-13
project: agentOps
ecosystem: circle
tags: [deployment, mcp, security, agents, operations]
---

# Hosted MCP Deployment

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/README]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/env-inventory]] | [[10-Projects/Web3-Builds/agentOps/HANDOFF]]

## Product Contract

The hosted MCP service is a stateless Streamable HTTP boundary for remote agents. It exposes the canonical eight-tool AOPS contract at `POST /mcp` and resolves every request from the supplied agent bearer credential through the runtime API. There is no shared process credential and no tenant state is reused between requests.

The local product endpoint is `http://127.0.0.1:8070/mcp`. Production must publish an HTTPS URL with the exact `/mcp` path and a reverse proxy that preserves `Authorization`, `Origin`, `Host`, `Content-Type`, and `Accept` headers.

Paid HTTP is exposed through `agentops.payment_x402`. The hosted MCP forwards the agent's bounded request and idempotency key to the runtime API; the API remains the policy, approval, accounting, recovery, and payment authority. MCP returns the exact bounded merchant response and never acts as a general-purpose proxy.

## Start And Health

```bash
./startup.sh --run-only

# Hosted service only, for development
npm run dev:mcp:http

# Compiled entrypoint
npm --workspace @agentops-pmoa/mcp run start:http
```

| Route | Authentication | Purpose |
|---|---|---|
| `GET /healthz` | none | Process liveness |
| `GET /readyz` | none | Runtime API dependency readiness |
| `POST /mcp` | agent bearer | MCP JSON-RPC |

`GET /mcp` and `DELETE /mcp` are rejected because this release uses stateless JSON responses rather than server-held sessions or SSE streams.

## Reproducible Testnet Topology

The deployment manifest starts four application services plus PostgreSQL and Redis:

```bash
cp .env.example .env
# Populate every blank secret and replace every example.com authority.
docker compose --env-file .env -f deploy/docker-compose.testnet.yml config
docker compose --env-file .env -f deploy/docker-compose.testnet.yml up -d --build
docker compose --env-file .env -f deploy/docker-compose.testnet.yml ps
```

Web, API, and MCP publish ports `3005`, `8080`, and `8070`. The Circle worker, PostgreSQL, and Redis remain reachable only on the application network. Health dependencies start the worker after PostgreSQL, the API after PostgreSQL/Redis/worker, MCP after API, and web after API/MCP. API and worker may start together safely because database migrations use a PostgreSQL advisory lock.

The manifest uses required environment interpolation for secrets and public authorities; it contains no credential values. In a managed platform, map the same variables from its secret manager and keep the same service boundaries. The Circle profile master key is worker-only, while the distinct x402 result encryption key is API-only. `ENABLE_TESTNET_X402_FIXTURES` must remain `false` except in an isolated QA deployment.

After startup, require all probes to pass:

```bash
curl --fail https://api.example.com/healthz
curl --fail https://api.example.com/readyz
curl --fail https://mcp.example.com/healthz
curl --fail https://mcp.example.com/readyz
curl --fail https://console.example.com/
```

`healthz` is process liveness. `readyz` is dependency readiness and must be used for traffic admission. A failed readiness probe must remove the service from traffic without restarting healthy dependencies.

## Agent Setup

1. Sign in to AOPS and finish onboarding.
2. Create or open an agent.
3. Open **Credentials & wallets** and create a credential.
4. Save the one-time credential and copy the hosted client configuration.
5. Add the supplied governance instruction to the agent's operating prompt.
6. Run **Verify MCP connection** before closing the reveal drawer.

The verifier initializes MCP, completes the initialized notification, discovers all eight tools, and calls `agentops.onboard`. A successful check shows the resolved agent, connection ID, tool count, and contract version.

For Codex, keep the secret in the host environment:

```bash
export AGENTOPS_MCP_CREDENTIAL='<one-time agent credential>'
codex mcp add agentops \
  --url https://mcp.example.com/mcp \
  --bearer-token-env-var AGENTOPS_MCP_CREDENTIAL
```

Claude Code clients that support remote HTTP MCP can use a secret-free project template and inject `AGENTOPS_MCP_CREDENTIAL` at runtime. The client host must support an `Authorization: Bearer ...` header; OAuth discovery is not part of this credential-only MVP.

## Security Requirements

- Configure exact `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS`; never use wildcard browser origins.
- Keep the service behind HTTPS in production and terminate TLS only at a trusted proxy.
- Never log bearer headers, JSON-RPC bodies, one-time credential values, or upstream credential-bearing errors.
- Keep request body, timeout, and in-flight limits enabled.
- Rotate credentials from the console when exposure is suspected. The previous secret stops authenticating immediately.
- Revoke credentials that are no longer used. Revocation immediately makes the MCP connection unavailable.
- Treat `agentops.onboard` as identity discovery, not authorization to bypass checks. Agents must call the matching policy/operation/payment check before governed actions.
- Calls made outside AOPS are outside this connection's governance boundary.

Chrome may ask for Local Network Access permission when a localhost console verifies a loopback MCP service. Allow the prompt only for the local AOPS origin. Production HTTPS-to-HTTPS deployments do not use this loopback development path. See [Chrome's Local Network Access guidance](https://developer.chrome.com/blog/local-network-access).

## Deployment Checklist

- `NODE_ENV=production`
- `MCP_HOST=0.0.0.0` (or the platform-required container bind); restrict public access at the proxy/firewall
- `MCP_PUBLIC_URL=https://<host>/mcp`
- exact public authority in `MCP_ALLOWED_HOSTS`
- exact console HTTPS origin in `MCP_ALLOWED_ORIGINS`
- runtime API reachable from the MCP service
- `/healthz` and `/readyz` wired to platform probes
- proxy request/body/idle limits aligned with the application limits
- no process-level `AGENTOPS_MCP_CREDENTIAL`
- credential create, verify, rotate, and revoke tested after deployment

## Backup, Rollback, And Shutdown

Back up PostgreSQL before every release and retain the backup outside the application host. Redis is an AOF-backed hot tier, not the system of record. A minimal PostgreSQL backup/restore drill is:

```bash
docker compose --env-file .env -f deploy/docker-compose.testnet.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > /secure/agentops-before-release.dump

# Restore only into a stopped, empty recovery database after validating the dump.
pg_restore --list /secure/agentops-before-release.dump
```

Deploy immutable image tags. To roll back, stop new traffic, let API/MCP/worker graceful-shutdown windows drain in-flight requests, redeploy the last known-good image, and verify every `readyz` probe. Migrations are forward-only: do not point an older binary at a schema it does not support. If a release requires data rollback, stop all application services and restore the validated PostgreSQL backup before starting the previous image.

`SIGTERM` is the supported shutdown signal. The API, worker, and MCP stop accepting new work, drain bounded in-flight work, then close PostgreSQL/Redis connections. The deployment platform's termination grace period must exceed the largest configured application grace period.
