---
created: 2026-07-12
project: agentOps
ecosystem: circle
tags: [mcp, hosted-mcp, runtime, credentials, production]
---

# Hosted MCP Design

[[HANDOFF]] | [[BUILD-PMOA/README]] | [[BUILD-PMOA/docs/env-inventory]]

## Status

Approved architecture, awaiting written-spec review. This specification defines the first production-usable hosted MCP surface for AOPS. It does not authorize implementation until Abhinav approves this written version and the validation spikes in this document pass.

## Outcome

An organization operator can create an agent and one-time credential in the existing post-onboarding console, copy a tested remote MCP configuration, and connect a compatible agent host to a public AOPS MCP endpoint. Every MCP request is authenticated as exactly one organization, agent, and connection. The existing policy, approval, rate-limit, activity, operation, and x402 payment paths remain the enforcement authority.

The first hosted endpoint is:

```text
https://mcp.<deployment-domain>/mcp
```

Local development uses:

```text
http://127.0.0.1:8070/mcp
```

## Product Boundaries

### Included

- A public Streamable HTTP MCP endpoint authenticated with the existing agent bearer credential.
- The existing eight MCP tools with identical names, schemas, and runtime behavior.
- Request-scoped credential isolation; no process-global customer credential.
- A post-onboarding credential reveal flow with endpoint, secret, tested client configuration, agent boundary instructions, and a real MCP verification action.
- A fourth locally supervised service on port `8070`.
- Deployment, environment, observability, security, and external-client verification for the hosted service.
- Continued support for the current stdio MCP adapter.

### Excluded

- Any redesign of authentication or onboarding.
- OAuth account linking or MCP OAuth discovery in this release.
- Publishing the stdio package to npm.
- Proxying or intercepting arbitrary network or tool traffic that an agent sends outside AOPS.
- New policy semantics, new payment rails, a new credential type, or a database migration.
- Claiming hard enforcement for cooperative checks. Non-payment actions are governed only when routed through AOPS; x402 execution is hard-enforced when AOPS controls treasury signing.

Credential-only remote authentication is an explicit MVP compatibility boundary. MCP's HTTP authorization specification defines OAuth-based discovery for general remote interoperability, while this release uses a static bearer header and therefore supports only hosts that can attach custom HTTP headers. — Source: [MCP Authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

## Existing Invariants

The build must preserve these already-tested behaviors:

1. A credential hash resolves to one active connection, one active agent, and one organization.
2. Missing, malformed, inactive, revoked, or paused-agent credentials fail closed.
3. The runtime API remains the authority for identity resolution and all policy/payment decisions.
4. Tenant identifiers supplied by an MCP caller are never trusted for authorization.
5. The Circle worker remains private and continues to own decrypted provider material.
6. The web application never receives Circle profile encryption keys, OTPs, or decrypted provider state.
7. Existing stdio hosts continue to use `AGENTOPS_API_BASE_URL` plus `AGENTOPS_MCP_CREDENTIAL`.

## Architecture

### Service boundary

`apps/mcp` becomes one package with two executable entrypoints:

- `src/index.ts`: current stdio entrypoint, retained for local and embedded MCP hosts.
- `src/http.ts`: hosted HTTP entrypoint on port `8070`.

Both entrypoints use the same server builder, tool registry, schemas, result mapping, and runtime API client. Transport concerns stay outside tool definitions.

The hosted service is deployed independently from the public API. Its only trusted upstream is `AGENTOPS_API_BASE_URL`; it does not connect to PostgreSQL, Redis, or the Circle worker directly. This keeps identity and enforcement logic in the runtime API instead of creating a second policy authority.

### Transport mode

The public endpoint uses MCP Streamable HTTP. MCP defines a single endpoint for client-to-server POST requests and optional GET streaming; a server that does not offer an SSE stream may reject GET with `405 Method Not Allowed`. — Source: [MCP transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)

The initial implementation is stateless and JSON-response-only:

- Each HTTP request creates a new transport, MCP server, and runtime client.
- `sessionIdGenerator` is disabled.
- JSON responses are enabled.
- No MCP session identifier is issued or stored.
- `POST /mcp` handles JSON-RPC requests.
- `GET /mcp` and `DELETE /mcp` return `405` because the initial service has no server-initiated stream or stateful session to retrieve or terminate.
- `OPTIONS /mcp` is answered only for the explicitly configured console origin; wildcard credentialed CORS is forbidden.

This mode is accepted only if the pinned SDK and two real target clients pass the validation spikes below. Stateless Streamable HTTP is supported by the official TypeScript SDK server APIs. — Source: [MCP TypeScript SDK server guide](https://ts.sdk.modelcontextprotocol.io/server)

### Request flow

```text
MCP host
  -> TLS ingress
  -> hosted MCP auth and request limits
  -> runtime /v1/runtime/onboard credential validation
  -> request-scoped MCP server and tool registry
  -> runtime /v1/runtime/* enforcement endpoint
  -> existing policy, approval, operation, activity, or x402 engine
```

For every `POST /mcp` request:

1. Validate the request host and, when present, origin.
2. Enforce method, content type, accepted response types, and body-size limits.
3. Parse exactly one `Authorization: Bearer <credential>` header.
4. Construct a `RuntimeApiClient` scoped to that credential.
5. Call the existing `/v1/runtime/onboard` endpoint before handing the request to MCP. This validates the credential for initialization and discovery requests as well as tool calls.
6. Create and connect a new stateless `StreamableHTTPServerTransport` and MCP server.
7. Handle the JSON-RPC request and close request-owned resources after the response.

No customer credential is stored in a module global, shared singleton, session map, query parameter, cookie, response, metric, or log field. Concurrent requests must never share a runtime client.

### Authentication responses

- Missing or malformed bearer header: HTTP `401` with `WWW-Authenticate: Bearer realm="agentops-mcp"`.
- Runtime rejection for an invalid, inactive, revoked, or paused-agent credential: HTTP `401` without revealing whether the agent, connection, or organization exists.
- Valid credential with a policy denial or approval requirement: a successful MCP protocol response containing the existing structured tool error/result. It is not converted into transport authentication failure.
- Upstream API timeout or unavailability during credential validation: HTTP `503` with a request ID and no credential material.

The hosted service forwards the existing high-entropy agent credential to the first-party runtime API over the private service network. It does not forward cookies or operator sessions.

## MCP Contract

### Server identity and instructions

The initialized server identifies itself as `agentops` using the package version. Its instructions tell the agent host:

> Use AOPS before governed tool calls, HTTP operations, or x402 payments. Call the matching check tool first, follow approval requirements, and record the final outcome. Actions sent outside AOPS are not governed by this connection.

The exact instruction is concise and factual. It does not imply that installing the MCP server automatically intercepts unrelated tools.

### Tool parity

The hosted service exposes the same eight tools as stdio:

1. `agentops_onboard`
2. `agentops_policy_check`
3. `agentops_payment_x402`
4. `agentops_approval_status`
5. `agentops_approval_consume`
6. `agentops_activity_record`
7. `agentops_operation_check`
8. `agentops_operation_record`

Tool schemas and runtime paths remain single-sourced in `createAgentOpsTools`. The HTTP implementation may not maintain a second registry.

### Errors

Runtime policy, approval, rate-limit, payment, and validation errors continue through the existing MCP error mapping. Transport code adds only HTTP/authentication/protocol failures. Error output includes a stable error code and safe message where available, but never a credential, upstream authorization header, provider secret, stack trace, or raw payment signature.

## Console Experience

The redesign scope still begins after onboarding. Auth and onboarding layouts remain unchanged.

### One-time credential reveal

After create or rotate, the existing credential drawer becomes the setup surface. It contains:

- Hosted MCP endpoint.
- One-time credential with an explicit save-now warning.
- Copy buttons for endpoint, credential, and a tested host configuration.
- A short agent boundary instruction suitable for the host's project instructions.
- A `Verify MCP connection` action available only while the plaintext secret is present.
- Verification states for connecting, authenticated, tools discovered, failure, and retry.

The current `AGENTOPS_CONNECTION_SECRET` snippet is removed. Local stdio instructions use `AGENTOPS_MCP_CREDENTIAL`; remote instructions use `Authorization: Bearer <credential>`.

### Real verification

Verification performs an actual remote MCP sequence against the configured hosted endpoint:

1. `initialize`
2. `notifications/initialized` when required by the tested client library
3. `tools/list`
4. `agentops_onboard`

Success requires authenticated discovery plus the onboard call. Merely updating `last_tested_at` is not success.

The reveal drawer performs this sequence directly from the browser to the hosted MCP URL. The plaintext credential stays in the existing one-time client state and is sent only to the intended MCP endpoint over TLS. The web server does not proxy, persist, or log it. This direct check also validates the same CORS and public transport path a browser-capable client would use.

Because plaintext credentials are intentionally not recoverable, the later credential-detail drawer cannot repeat this verification. Its existing synthetic `Test` control is removed from the UI. Rotation opens a new one-time reveal and verification opportunity. The existing management endpoint may remain temporarily for API compatibility, but the product does not present it as an end-to-end test.

### Client configurations

Only configurations executed successfully in the compatibility spike are displayed. The console must not show an invented universal JSON format. The default target set is:

- MCP Inspector for protocol-level diagnosis.
- One production agent host available in the release environment that supports remote URL plus static bearer headers.

If a named host does not support static headers, the console marks it unsupported for the credential-only MVP instead of exposing a broken example.

## HTTP and Security Controls

### Endpoints

| Route | Authentication | Purpose |
|---|---|---|
| `GET /healthz` | none | Process liveness only |
| `GET /readyz` | none | Configuration and upstream API reachability |
| `POST /mcp` | agent bearer | MCP JSON-RPC |
| `GET /mcp` | agent bearer | `405` in stateless JSON mode |
| `DELETE /mcp` | agent bearer | `405` in stateless mode |

Health responses expose no environment values, upstream bodies, build paths, or customer identifiers.

### Required controls

- TLS is terminated at the deployment ingress; production refuses an `http://` public URL.
- Host allowlist protection is mandatory. MCP specifically calls for Origin validation to prevent DNS rebinding attacks. — Source: [MCP transport security warning](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#security-warning)
- Origin allowlist is explicit. Requests without `Origin`, as expected from server-side agent hosts, are permitted after host validation.
- Request body size, upstream timeout, header timeout, keep-alive timeout, and maximum in-flight requests are bounded.
- Ingress rate limits apply per source IP. Runtime tool calls retain the product's existing credential/policy rate limits.
- Request logs contain request ID, method, safe route, status, latency, and user agent only.
- Authorization headers and JSON-RPC bodies are redacted from logs and error telemetry.
- Graceful shutdown stops accepting traffic, lets bounded in-flight requests finish, then closes the listener.
- The process runs without Circle secrets, database credentials, OAuth secrets, or operator session keys.

## Environment Contract

Hosted service variables:

| Variable | Required | Purpose |
|---|---:|---|
| `AGENTOPS_API_BASE_URL` | yes | Private/public runtime API origin |
| `MCP_HOST` | yes | Bind address; local default `127.0.0.1`, container default explicitly configured |
| `MCP_PORT` | yes | Local and container listener port, default `8070` |
| `MCP_PUBLIC_URL` | yes in deployment | Canonical HTTPS `/mcp` URL shown in console |
| `MCP_ALLOWED_HOSTS` | yes | Comma-separated request host allowlist |
| `MCP_ALLOWED_ORIGINS` | yes for browser verification | Comma-separated exact origin allowlist |
| `AGENTOPS_MCP_TIMEOUT_MS` | no | Runtime API timeout, default `10000` |
| `MCP_MAX_BODY_BYTES` | no | JSON-RPC body limit with a conservative default |
| `MCP_MAX_IN_FLIGHT` | no | Per-process concurrency ceiling |
| `MCP_SHUTDOWN_GRACE_MS` | no | Graceful shutdown deadline |

`AGENTOPS_MCP_CREDENTIAL` remains valid only for the stdio entrypoint and is forbidden as a hosted-service deployment secret. The hosted process must fail startup if that variable is present in its production environment, preventing accidental use of one customer credential for all callers.

## Local Bootstrap and Deployment

The supported local topology becomes:

| Service | Port | Exposure |
|---|---:|---|
| Web | `3005` | public application |
| Hosted MCP | `8070` | public MCP transport |
| API | `8080` | public runtime and web BFF API |
| Circle worker | `8090` | private only |

`setup.sh`, `startup.sh --run-only`, supervisor state, health output, shutdown handling, bootstrap tests, and README documentation are updated from three to four services. `npm run dev:mcp` continues to mean stdio. A separate `dev:mcp:http` and production start command run the hosted service.

Deployment adds a dedicated hosted-MCP service/container with `/healthz` and `/readyz`. The public ingress maps only the MCP service's public routes. The service communicates with the API over the deployment private network where available.

## Impact Assessment

### Expected unchanged behavior

- Google auth, organization creation, onboarding, and existing console routing.
- Agent, team, policy, approval, operation, activity, treasury, and audit data models.
- Credential creation, rotation, revocation, and hash-based runtime authentication.
- Runtime API route contracts.
- Circle worker custody boundary and x402 execution behavior.
- Current stdio tool behavior and tests.

### Intentional changes

- `apps/mcp` gains an HTTP entrypoint and transport-focused tests.
- The root bootstrap supervises a fourth service.
- Credential create/rotate UI gains remote MCP setup and real verification.
- The misleading credential environment-variable name and synthetic test UI are corrected.
- Environment, deployment, README, and release evidence include the hosted surface.

### Main regression risks

1. Transport refactoring changes stdio tools or error mapping.
   - Control: keep tools/runtime client single-sourced and run existing 11 MCP tests unchanged before adding HTTP tests.
2. Concurrent callers leak credentials across requests.
   - Control: stateless per-request server/client construction plus a parallel two-tenant isolation spike and integration test.
3. Client configuration looks valid but the target host cannot attach the bearer header.
   - Control: publish only examples proven against real installed hosts.
4. Bootstrap regressions stop or orphan one of four services.
   - Control: extend all startup, occupied-port, health, interrupt, and restart tests.
5. Console verification accidentally logs or persists plaintext credentials.
   - Control: one-time in-memory form flow, explicit log redaction tests, and database assertions that only the existing hash is stored.
6. Hosted health checks create upstream load or disclose state.
   - Control: lightweight liveness, bounded readiness, and safe fixed response schemas.

## Validation Spikes

No implementation plan may be written until all three spikes pass and `validation/spike-results.md` records `ALL PASS`.

### Assumption 1: SDK transport behavior

The repository's resolved MCP TypeScript SDK version can run a stateless JSON-response Streamable HTTP server that completes `initialize`, `tools/list`, and a tool call without a persisted session.

Failure impact: the initial transport architecture must change to stateful sessions or a different supported adapter.

### Assumption 2: credential isolation

Two simultaneous HTTP MCP calls using different agent credentials can create request-scoped runtime clients and reach the correct tenant with no shared credential or server state.

Failure impact: the server lifecycle and dependency-injection design is unsafe and implementation stops.

### Assumption 3: real client compatibility

MCP Inspector plus one production agent host available locally can connect to a remote Streamable HTTP URL and send a static bearer header on every request.

Failure impact: the credential-only hosted MVP cannot claim those clients; either a supported client must be selected or the authentication architecture must return for review.

## Test and Release Gates

### Automated

- Existing stdio MCP suite remains green.
- HTTP transport unit tests cover header parsing, host/origin checks, content types, method handling, body limits, upstream timeout, status mapping, redaction, graceful shutdown, and concurrency limits.
- HTTP MCP integration completes initialize, discovery, onboarding, policy allow/deny, approval-required/status/consume, operation check/record, activity record, and x402 paths.
- Negative integration covers missing, malformed, random, revoked, inactive, and paused-agent credentials.
- A two-organization concurrency test proves tenant and credential isolation.
- Web tests cover one-time reveal, correct variable names, tested configs, verification states, retry, rotation, and absence of the synthetic detail test.
- Bootstrap tests cover four-service start, occupied port, health failure, one-interrupt shutdown, and `--run-only` restart.
- Full repository tests, typecheck, lint, production build, and security audit policy pass.

### Live

- The public HTTPS endpoint is exercised from outside the deployment network.
- At least two real MCP clients complete the supported connection flow.
- A real restrictive policy denies a tool/operation through hosted MCP.
- An approval-required action completes the approval lifecycle through hosted MCP.
- A real testnet x402 payment succeeds through hosted MCP and appears in activity/evidence surfaces.
- Credential rotation immediately invalidates the old remote connection and enables the new one.
- Agent pause and credential revoke fail closed.
- Service restart leaves no credential/session state to recover and clients can reconnect.
- Authenticated browser QA verifies the post-onboarding setup drawer without changing auth/onboarding design.

## Completion Definition

The feature is complete only when a new user can finish existing onboarding, create an agent and credential, copy a configuration from the console, connect a supported external agent host to the public MCP URL, discover all eight tools, observe policy and approval enforcement, execute a testnet x402 payment, see resulting activity/evidence in the console, rotate or revoke the credential, and confirm the old connection fails.

Passing unit tests without the external-client and public-network run is not sufficient for a READY claim.
