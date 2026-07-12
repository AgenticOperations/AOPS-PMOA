---
created: 2026-07-12
project: agentOps
ecosystem: circle
tags: [implementation-plan, mcp, hosted-mcp, tdd, browser-e2e]
---

# Hosted MCP Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a credential-authenticated public Streamable HTTP MCP service, connect its one-time setup to the post-onboarding console, supervise it locally and in deployment, and prove it through browser E2E plus a real model-directed MCP tool call.

**Architecture:** `apps/mcp` retains its stdio entrypoint and gains a separate stateless HTTP entrypoint on port `8070`. Each authenticated HTTP request creates its own runtime client, validates the bearer credential with `/v1/runtime/onboard`, and uses the existing single-sourced eight-tool registry; the runtime API remains the only identity and enforcement authority. The browser uses the one-time plaintext credential to verify MCP directly, while stored credentials remain hashes and cannot be retested later.

**Tech Stack:** Node.js 22, TypeScript 6, `@modelcontextprotocol/sdk@1.29.0`, native `node:http`, Zod, Vitest, Next.js 15, React 19, Bash bootstrap, Claude Code real-agent QA.

[[HANDOFF]] | [[BUILD-PMOA/docs/superpowers/specs/2026-07-12-hosted-mcp-design]] | [[validation/spike-results]]

---

## File Map

### MCP service

- Create `apps/mcp/src/http-config.ts` — parse and validate hosted-only environment values.
- Create `apps/mcp/src/http-handler.ts` — authenticate, validate origin/host/body, and execute request-owned MCP transports.
- Create `apps/mcp/src/http.ts` — create the HTTP listener, health routes, readiness probe, and graceful shutdown.
- Modify `apps/mcp/src/server.ts` — add factual server instructions while preserving one registry.
- Modify `apps/mcp/package.json` — add hosted development and production commands.
- Modify `apps/mcp/.env.example` — document stdio and hosted variables without adding a hosted global credential.
- Create `apps/mcp/test/server.test.ts` — server metadata/instruction and tool-parity coverage.
- Create `apps/mcp/test/http-config.test.ts` — defaults and fail-closed production configuration.
- Create `apps/mcp/test/http-handler.test.ts` — authenticated protocol, negative paths, limits, and isolation.
- Create `apps/mcp/test/http-entrypoint.test.ts` — health, readiness, and shutdown behavior.

### Console

- Create `apps/web/src/lib/mcp-verification.ts` — browser-side JSON-RPC verification against `/mcp` only.
- Create `apps/web/tests/lib/mcp-verification.test.ts` — exact initialize/list/onboard sequence and failure mapping.
- Modify `apps/web/src/components/agents/ConnectionPanel.tsx` — one-time remote MCP setup and verification; remove synthetic stored-credential test.
- Modify `apps/web/src/components/agents/AgentDetailShell.tsx` — pass the public MCP endpoint and remove the synthetic test action.
- Modify `apps/web/src/app/app/[orgSlug]/agents/[agentId]/page.tsx` — read and pass `MCP_PUBLIC_URL` after onboarding.
- Modify `apps/web/tests/agents/connection-panel.test.tsx` — setup, verification, rotation, and no-later-test coverage.
- Modify `apps/web/tests/agents/agent-detail-shell.test.tsx` — endpoint propagation and action regression coverage.
- Modify `apps/web/src/app/globals.css` — restrained drawer layout and verification states.
- Modify `apps/web/.env.example` — add the safe server-side public MCP URL.

### Operations and documentation

- Modify `package.json` — add `dev:mcp:http`.
- Modify `setup.sh` — supervise and health-check the fourth service on `8070`.
- Modify `scripts/setup-script.test.mjs` — assert the four-service contract.
- Modify `README.md` and `docs/env-inventory.md` — document both transports and exact credential names.
- Create `docs/deployment/hosted-mcp.md` — deployment, ingress, health, redaction, and real-agent smoke contract.
- Modify `docs/qa/2026-07-12-testnet-release-evidence.md` only after live proof — append hosted MCP evidence without rewriting prior evidence.

## Task 1: Preserve the MCP Contract and Add Server Instructions

**Files:**
- Create: `apps/mcp/test/server.test.ts`
- Modify: `apps/mcp/src/server.ts`

- [ ] **Step 1: Write the failing metadata and tool-parity test**

```ts
it('publishes the AOPS boundary instruction and existing tool names', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildAgentOpsMcpServer(fakeClient());
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  expect(client.getInstructions()).toContain('Actions sent outside AOPS are not governed');
  expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
    'agentops.onboard',
    'agentops.policy_check',
    'agentops.payment_x402',
    'agentops.approval_status',
    'agentops.approval_consume',
    'agentops.activity_record',
    'agentops.operation_check',
    'agentops.operation_record',
  ]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm --workspace @agentops-pmoa/mcp test -- test/server.test.ts`

Expected: FAIL because the current server publishes no instructions.

- [ ] **Step 3: Add one exported factual instruction**

```ts
export const AGENTOPS_MCP_INSTRUCTIONS =
  'Use AOPS before governed tool calls, HTTP operations, or x402 payments. Call the matching check tool first, follow approval requirements, and record the final outcome. Actions sent outside AOPS are not governed by this connection.';

const server = new McpServer(
  { name: 'agentops', version: '0.0.0' },
  { instructions: AGENTOPS_MCP_INSTRUCTIONS },
);
```

- [ ] **Step 4: Run server and existing MCP tests and verify GREEN**

Run: `npm --workspace @agentops-pmoa/mcp test`

Expected: all existing 11 tests plus the new contract test pass with the original dotted tool names.

- [ ] **Step 5: Commit the contract slice**

```bash
git add apps/mcp/src/server.ts apps/mcp/test/server.test.ts
git commit -m "feat(mcp): publish governed runtime instructions"
```

## Task 2: Parse Hosted MCP Configuration Fail-Closed

**Files:**
- Create: `apps/mcp/src/http-config.ts`
- Create: `apps/mcp/test/http-config.test.ts`

- [ ] **Step 1: Write failing configuration tests**

```ts
it('uses safe local hosted defaults', () => {
  expect(readHostedMcpEnv({ NODE_ENV: 'development' })).toMatchObject({
    apiBaseUrl: 'http://localhost:8080',
    host: '127.0.0.1',
    port: 8070,
    publicUrl: 'http://localhost:8070/mcp',
    allowedHosts: ['127.0.0.1:8070', 'localhost:8070'],
    allowedOrigins: ['http://localhost:3005'],
    maxBodyBytes: 1_048_576,
    maxInFlight: 100,
  });
});

it('rejects unsafe production configuration', () => {
  expect(() => readHostedMcpEnv({ NODE_ENV: 'production', MCP_PUBLIC_URL: 'http://mcp.example/mcp' }))
    .toThrow('MCP_PUBLIC_URL must use https in production');
  expect(() => readHostedMcpEnv({
    NODE_ENV: 'production', MCP_PUBLIC_URL: 'https://mcp.example/mcp',
    MCP_ALLOWED_HOSTS: 'mcp.example', AGENTOPS_MCP_CREDENTIAL: 'customer-secret',
  })).toThrow('AGENTOPS_MCP_CREDENTIAL is forbidden');
  expect(() => readHostedMcpEnv({ NODE_ENV: 'development', AGENTOPS_MCP_CREDENTIAL: 'customer-secret' }))
    .toThrow('AGENTOPS_MCP_CREDENTIAL is forbidden');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm --workspace @agentops-pmoa/mcp test -- test/http-config.test.ts`

Expected: FAIL because `readHostedMcpEnv` does not exist.

- [ ] **Step 3: Implement typed parsing and validation**

```ts
export type HostedMcpConfig = {
  readonly apiBaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly publicUrl: string;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
  readonly maxInFlight: number;
  readonly shutdownGraceMs: number;
};

export function readHostedMcpEnv(env: NodeJS.ProcessEnv = process.env): HostedMcpConfig {
  const production = env.NODE_ENV === 'production';
  if (env.AGENTOPS_MCP_CREDENTIAL?.trim()) {
    throw new Error('AGENTOPS_MCP_CREDENTIAL is forbidden for the hosted MCP service.');
  }
  const publicUrl = env.MCP_PUBLIC_URL ?? 'http://localhost:8070/mcp';
  if (production && new URL(publicUrl).protocol !== 'https:') {
    throw new Error('MCP_PUBLIC_URL must use https in production.');
  }
  return parseHostedValues(env, publicUrl);
}
```

`parseHostedValues` must reject non-integer ports, non-positive limits, empty production allowlists, URLs whose path is not `/mcp`, and malformed origins. It must normalize the API base URL without trailing slashes.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm --workspace @agentops-pmoa/mcp test -- test/http-config.test.ts`

Expected: PASS for local defaults and every unsafe-production negative path.

Run: `npm --workspace @agentops-pmoa/mcp run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit hosted configuration**

```bash
git add apps/mcp/src/http-config.ts apps/mcp/test/http-config.test.ts
git commit -m "feat(mcp): validate hosted service configuration"
```

## Task 3: Implement Authenticated Stateless HTTP Handling

**Files:**
- Create: `apps/mcp/src/http-handler.ts`
- Create: `apps/mcp/test/http-handler.test.ts`

- [ ] **Step 1: Write failing transport and authentication tests**

The test must launch a temporary native HTTP server around `createHostedMcpHandler`, use the SDK `StreamableHTTPClientTransport`, and assert:

```ts
expect(await rawPost({ authorization: undefined })).toMatchObject({ status: 401 });
expect(await rawPost({ authorization: 'Basic abc' })).toMatchObject({ status: 401 });
expect(await rawPost({ authorization: 'Bearer revoked' })).toMatchObject({ status: 401 });
expect((await validClient.listTools()).tools).toHaveLength(8);
expect(await validClient.callTool({ name: 'agentops.onboard', arguments: {} }))
  .toMatchObject({ isError: false });
expect(capturedCredentials).toEqual(['credential-a', 'credential-b']);
```

Separate tests must assert `405` for authenticated GET/DELETE, `403` for a disallowed host or origin, `413` for an oversized body, `503` for upstream timeout, `429` when the in-flight ceiling is exhausted, no credential text in thrown errors, and zero crossover in 100 parallel alternating calls.

An allowed browser preflight must return `204` with exact `access-control-allow-origin`, `access-control-allow-methods: POST`, and `access-control-allow-headers: authorization, content-type`; a disallowed preflight origin must return `403`.

- [ ] **Step 2: Run the handler suite and verify RED**

Run: `npm --workspace @agentops-pmoa/mcp test -- test/http-handler.test.ts`

Expected: FAIL because the handler and factory types do not exist.

- [ ] **Step 3: Implement request-owned handler dependencies**

```ts
export type HostedMcpHandlerDeps = {
  readonly config: HostedMcpConfig;
  readonly createRuntimeClient: (credential: string) => AgentOpsRuntimeClient;
  readonly onRequestLog?: (event: SafeRequestLog) => void;
};

export function createHostedMcpHandler(deps: HostedMcpHandlerDeps): RequestListener {
  let inFlight = 0;
  return async (request, response) => {
    const requestId = randomUUID();
    if (!validateHostAndOrigin(request, deps.config)) return writeForbidden(response, requestId);
    if (request.url !== '/mcp') return writeNotFound(response, requestId);
    if (request.method === 'OPTIONS') return writeAllowedPreflight(request, response, deps.config);
    const credential = readBearerCredential(request.headers.authorization);
    if (credential === null) return writeUnauthorized(response, requestId);
    if (request.method !== 'POST') return writeMethodNotAllowed(response, requestId);
    if (inFlight >= deps.config.maxInFlight) return writeBusy(response, requestId);
    inFlight += 1;
    try { await handleAuthenticatedMcp(request, response, credential, deps, requestId); }
    finally { inFlight -= 1; }
  };
}
```

`handleAuthenticatedMcp` must read a bounded JSON body, create one runtime client, call `onboard()` before transport handling, create one `McpServer` and one `StreamableHTTPServerTransport({ enableJsonResponse: true, sessionIdGenerator: undefined })`, and close both on response completion. It may log request ID, method, safe path, status, latency, and user agent only.

- [ ] **Step 4: Run focused tests repeatedly**

Run the following command three times: `npm --workspace @agentops-pmoa/mcp test -- test/http-handler.test.ts`

Expected: all positive, negative, and 100-call isolation cases pass on all three runs.

Run: `npm --workspace @agentops-pmoa/mcp run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the HTTP handler**

```bash
git add apps/mcp/src/http-handler.ts apps/mcp/test/http-handler.test.ts
git commit -m "feat(mcp): add credential-isolated streamable HTTP handler"
```

## Task 4: Add Health, Readiness, and Graceful Hosted Entrypoint

**Files:**
- Create: `apps/mcp/src/http.ts`
- Create: `apps/mcp/test/http-entrypoint.test.ts`
- Modify: `apps/mcp/package.json`
- Modify: `apps/mcp/.env.example`
- Modify: `package.json`

- [ ] **Step 1: Write failing entrypoint tests**

```ts
expect(await fetch(`${origin}/healthz`).then((r) => r.json())).toEqual({ status: 'ok' });
expect(await fetch(`${origin}/readyz`).then((r) => r.status)).toBe(200);
upstreamHealthy = false;
expect(await fetch(`${origin}/readyz`).then((r) => r.status)).toBe(503);
await hosted.close();
expect(hosted.inFlightCount()).toBe(0);
```

The test must also assert that health bodies contain no environment value, credential, upstream body, stack trace, or filesystem path.

- [ ] **Step 2: Run the entrypoint test and verify RED**

Run: `npm --workspace @agentops-pmoa/mcp test -- test/http-entrypoint.test.ts`

Expected: FAIL because `createHostedMcpService` does not exist.

- [ ] **Step 3: Implement the service lifecycle**

```ts
export function createHostedMcpService(config = readHostedMcpEnv()): HostedMcpService {
  const handler = createHostedMcpHandler({
    config,
    createRuntimeClient: (credential) => new RuntimeApiClient({
      apiBaseUrl: config.apiBaseUrl,
      credential,
      timeoutMs: config.timeoutMs,
    }),
  });
  const server = createServer(routeHealthAndMcp(handler, config));
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return exposeLifecycle(server, config.shutdownGraceMs);
}
```

The executable `main()` must bind `MCP_HOST:MCP_PORT`, print only the safe origin, handle `SIGINT`/`SIGTERM`, and exit non-zero on startup/configuration failure.

- [ ] **Step 4: Add exact scripts and environment examples**

```json
// apps/mcp/package.json
"dev:http": "node --import tsx src/http.ts",
"start:http": "node dist/src/http.js"
```

```json
// root package.json
"dev:mcp:http": "npm --workspace @agentops-pmoa/mcp run dev:http"
```

The `.env.example` must keep `AGENTOPS_MCP_CREDENTIAL` under a clearly labeled stdio section and list hosted variables separately; it must state that the hosted process never receives a customer credential from environment configuration.

- [ ] **Step 5: Run MCP verification and commit**

Run: `npm --workspace @agentops-pmoa/mcp test`

Run: `npm --workspace @agentops-pmoa/mcp run lint`

Run: `npm --workspace @agentops-pmoa/mcp run typecheck`

Run: `npm --workspace @agentops-pmoa/mcp run build`

Expected: all pass.

```bash
git add apps/mcp package.json
git commit -m "feat(mcp): run hosted MCP as a production service"
```

## Task 5: Implement Browser-Side MCP Verification

**Files:**
- Create: `apps/web/src/lib/mcp-verification.ts`
- Create: `apps/web/tests/lib/mcp-verification.test.ts`

- [ ] **Step 1: Write the failing request-sequence test**

```ts
const result = await verifyHostedMcp({ endpoint: 'https://mcp.example/mcp', credential: 'conn_secret', fetchImpl });

expect(requests.map(({ body }) => JSON.parse(body).method)).toEqual([
  'initialize',
  'notifications/initialized',
  'tools/list',
  'tools/call',
]);
expect(requests.every(({ url }) => url === 'https://mcp.example/mcp')).toBe(true);
expect(requests.every(({ headers }) => headers.authorization === 'Bearer conn_secret')).toBe(true);
expect(JSON.parse(requests[3].body)).toMatchObject({
  method: 'tools/call',
  params: { name: 'agentops.onboard', arguments: {} },
});
expect(result).toEqual({ status: 'verified', toolCount: 8, agentName: 'Research agent' });
```

Negative tests must cover `401`, `403`, `429`, `503`, network failure, malformed JSON-RPC, missing required tools, and onboard tool error. The returned error must not contain the credential.

- [ ] **Step 2: Run the verifier test and verify RED**

Run: `npm --workspace @agentops-pmoa/web test -- tests/lib/mcp-verification.test.ts`

Expected: FAIL because `verifyHostedMcp` does not exist.

- [ ] **Step 3: Implement the four-step MCP exchange**

```ts
const REQUIRED_TOOLS = new Set([
  'agentops.onboard', 'agentops.policy_check', 'agentops.payment_x402',
  'agentops.approval_status', 'agentops.approval_consume', 'agentops.activity_record',
  'agentops.operation_check', 'agentops.operation_record',
]);

export async function verifyHostedMcp(input: VerifyHostedMcpInput): Promise<McpVerificationResult> {
  await rpc(input, 1, 'initialize', initializeParams);
  await notify(input, 'notifications/initialized');
  const listed = await rpc(input, 2, 'tools/list', {});
  assertRequiredTools(listed, REQUIRED_TOOLS);
  const onboarded = await rpc(input, 3, 'tools/call', { name: 'agentops.onboard', arguments: {} });
  return readVerifiedIdentity(listed, onboarded);
}
```

Every request must set `content-type: application/json`, `accept: application/json, text/event-stream`, and the bearer header. The notification accepts `202` with an empty body. No URL other than `endpoint` is allowed.

- [ ] **Step 4: Run focused web tests and typecheck**

Run: `npm --workspace @agentops-pmoa/web test -- tests/lib/mcp-verification.test.ts`

Expected: PASS with exactly four MCP requests and no runtime API request.

Run: `npm --workspace @agentops-pmoa/web run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the browser verifier**

```bash
git add apps/web/src/lib/mcp-verification.ts apps/web/tests/lib/mcp-verification.test.ts
git commit -m "feat(web): verify one-time credentials through hosted MCP"
```

## Task 6: Build the One-Time MCP Setup Drawer

**Files:**
- Modify: `apps/web/src/components/agents/ConnectionPanel.tsx`
- Modify: `apps/web/src/components/agents/AgentDetailShell.tsx`
- Modify: `apps/web/src/app/app/[orgSlug]/agents/[agentId]/page.tsx`
- Modify: `apps/web/tests/agents/connection-panel.test.tsx`
- Modify: `apps/web/tests/agents/agent-detail-shell.test.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/.env.example`

- [ ] **Step 1: Replace old expectations with failing hosted-setup tests**

```ts
expect(screen.getByText('http://localhost:8070/mcp')).toBeInTheDocument();
expect(screen.getByText(/AGENTOPS_MCP_CREDENTIAL=conn_test_abc123/)).toBeInTheDocument();
expect(screen.getByText(/Authorization: Bearer conn_test_abc123/)).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Verify MCP connection' })).toBeInTheDocument();
expect(screen.queryByText(/AGENTOPS_CONNECTION_SECRET=/)).not.toBeInTheDocument();
```

Mock `verifyHostedMcp`, click the verify button, and expect `Authenticated`, `8 tools discovered`, and the resolved agent name. Open an existing credential and assert there is no `Test` button. Repeat the reveal assertions after rotation and confirm the secret disappears after closing.

- [ ] **Step 2: Run the component tests and verify RED**

Run: `npm --workspace @agentops-pmoa/web test -- tests/agents/connection-panel.test.tsx tests/agents/agent-detail-shell.test.tsx`

Expected: FAIL on the old variable name, missing endpoint/configuration, and synthetic Test control.

- [ ] **Step 3: Thread the safe endpoint through server components**

```tsx
// page.tsx
const mcpEndpoint = process.env.MCP_PUBLIC_URL ?? 'http://localhost:8070/mcp';
<AgentDetailShell mcpEndpoint={mcpEndpoint} ... />

// AgentDetailShell.tsx
<ConnectionPanel mcpEndpoint={mcpEndpoint} ... />
```

Remove `testConnectionFromFormAction` from this page, remove `testConnection` from `AgentDetailShell` action types, and remove `testAction` from `ConnectionPanel`. Do not delete the backend management endpoint in this slice.

- [ ] **Step 4: Implement the reveal and verification state**

```tsx
const [verification, setVerification] = useState<McpVerificationView>({ state: 'idle' });
const remoteConfig = JSON.stringify({
  mcpServers: {
    agentops: {
      type: 'http',
      url: mcpEndpoint,
      headers: { Authorization: `Bearer ${secret.secret}` },
    },
  },
}, null, 2);

async function verify() {
  setVerification({ state: 'connecting' });
  try {
    const result = await verifyHostedMcp({ endpoint: mcpEndpoint, credential: secret.secret });
    setVerification({ state: 'verified', result });
  } catch (error) {
    setVerification({ state: 'failed', message: safeMcpVerificationMessage(error) });
  }
}
```

Render three flat setup sections—endpoint, remote host configuration, local stdio variable—followed by the boundary instruction and verification action. Copy buttons must announce success through an `aria-live` region. Do not nest bordered cards inside the drawer.

- [ ] **Step 5: Add restrained responsive styles**

Use existing tokens, `8px` maximum radius, no gradients, no large shadows, and a single blue verification accent. At widths below `680px`, configuration blocks must scroll horizontally without widening the drawer or page.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm --workspace @agentops-pmoa/web test -- tests/agents/connection-panel.test.tsx tests/agents/agent-detail-shell.test.tsx tests/lib/mcp-verification.test.ts`

Run: `npm --workspace @agentops-pmoa/web run typecheck`

Run: `npm --workspace @agentops-pmoa/web run lint`

Expected: all pass.

```bash
git add apps/web
git commit -m "feat(web): add hosted MCP credential setup"
```

## Task 7: Supervise Four Local Services

**Files:**
- Modify: `setup.sh`
- Modify: `scripts/setup-script.test.mjs`

- [ ] **Step 1: Write failing bootstrap-contract assertions**

```js
assert.match(result.stdout, /Hosted MCP \(8070\)/);
const source = await readFile(setup, 'utf8');
assert.match(source, /port_available_for_app 8070/);
assert.match(source, /start_service mcp npm run dev:mcp:http/);
assert.match(source, /http:\/\/127\.0\.0\.1:8070\/healthz/);
assert.match(source, /stop all four application services/);
```

- [ ] **Step 2: Run bootstrap tests and verify RED**

Run: `npm run test:bootstrap`

Expected: FAIL because setup still documents and starts only three services.

- [ ] **Step 3: Add MCP to the supervisor contract**

```bash
port_available_for_app 8070
start_service mcp npm run dev:mcp:http

if ! node "$ROOT_DIR/scripts/wait-for-http.mjs" 'Hosted MCP' http://127.0.0.1:8070/healthz 90000; then
  show_failure_logs
  fail 'One or more services failed startup health checks.'
fi
```

Update help text, startup log, ready output, PID/log cleanup, service count language, unexpected-exit handling, and Ctrl+C message. Preserve the current API/web/worker commands and port checks.

- [ ] **Step 4: Run bootstrap and shell validation**

Run: `npm run test:bootstrap`

Run: `bash -n setup.sh startup.sh`

Expected: all bootstrap tests pass and Bash parses cleanly.

- [ ] **Step 5: Commit the supervisor change**

```bash
git add setup.sh scripts/setup-script.test.mjs
git commit -m "feat(dev): supervise the hosted MCP service"
```

## Task 8: Document Deployment and Security Operations

**Files:**
- Modify: `README.md`
- Modify: `docs/env-inventory.md`
- Create: `docs/deployment/hosted-mcp.md`

- [ ] **Step 1: Write the deployment note with vault metadata and links**

The new note must include YAML frontmatter plus links to `[[BUILD-PMOA/README]]`, `[[BUILD-PMOA/docs/env-inventory]]`, and `[[BUILD-PMOA/docs/deployment/testnet-circle-worker]]`. It must specify:

```text
Public:  POST https://mcp.<domain>/mcp
Health:  GET  https://mcp.<domain>/healthz
Ready:   GET  https://mcp.<domain>/readyz
Private upstream: AGENTOPS_API_BASE_URL
Forbidden hosted secret: AGENTOPS_MCP_CREDENTIAL
```

Document TLS ingress, host/origin allowlists, body/concurrency limits, safe logs, graceful shutdown, private API routing, credential rotation/revocation behavior, and the real-agent smoke command shape.

- [ ] **Step 2: Correct README transport language**

Replace “MCP is not a fourth HTTP daemon” with separate `Hosted MCP` and `Local stdio MCP` subsections. Show `AGENTOPS_MCP_CREDENTIAL` only for stdio and `Authorization: Bearer <agent credential>` only for hosted clients.

- [ ] **Step 3: Update the environment inventory**

Add `MCP_PUBLIC_URL` under web, add the hosted variables under MCP, and explicitly state that `AGENTOPS_MCP_CREDENTIAL` is never a hosted deployment variable.

- [ ] **Step 4: Verify documentation consistency**

Run: `rg -n 'AGENTOPS_CONNECTION_SECRET|not a fourth HTTP daemon|three application services' README.md docs apps/web apps/mcp setup.sh`

Expected: no stale product instructions; historical archive matches are permitted only under `archive/`.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/env-inventory.md docs/deployment/hosted-mcp.md
git commit -m "docs: publish hosted MCP operations contract"
```

## Task 9: Run Full Automated Regression Verification

**Files:**
- No new production files.
- Update only failing tests whose existing assertions intentionally describe the removed synthetic test or old service count.

- [ ] **Step 1: Run focused MCP tests**

Run: `npm --workspace @agentops-pmoa/mcp test`

Expected: all prior stdio/runtime/tool tests and all hosted HTTP tests pass.

- [ ] **Step 2: Run focused web tests**

Run: `npm --workspace @agentops-pmoa/web test -- tests/agents/connection-panel.test.tsx tests/agents/agent-detail-shell.test.tsx tests/lib/mcp-verification.test.ts`

Expected: all pass.

- [ ] **Step 3: Run the complete repository test suite**

Run: `npm test`

Expected: bootstrap, database, API, MCP, web, and shared-package suites all pass with zero failures.

- [ ] **Step 4: Run static and production checks**

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm run build`

Expected: all commands exit `0` with no new warnings attributable to this feature.

- [ ] **Step 5: Run dependency audit at the repository policy threshold**

Run: `npm audit --audit-level=high`

Expected: no high or critical advisories; the existing locked moderate Circle dependency boundary may remain documented.

## Task 10: Run Four-Service, Browser, and Real-Agent E2E

**Files:**
- Append after proof: `docs/qa/2026-07-12-testnet-release-evidence.md`
- Overwrite current state after proof: `../HANDOFF.md`

- [ ] **Step 1: Start the supported four-service topology**

Run: `./startup.sh --run-only`

Expected health:

```text
Web           http://127.0.0.1:3005/         200
Hosted MCP    http://127.0.0.1:8070/healthz  200
API           http://127.0.0.1:8080/healthz  200
Circle worker http://127.0.0.1:8090/healthz  200
```

- [ ] **Step 2: Browser-test the post-onboarding setup**

Use the authenticated Chrome CDP session on `9223` against `http://localhost:3005`. Open an existing organization, create a new agent credential from the agent's `Credentials & wallets` route, and verify:

```text
- auth and onboarding layouts are unchanged
- the secret appears once
- endpoint is http://localhost:8070/mcp
- remote configuration contains the same endpoint and bearer credential
- local stdio variable is AGENTOPS_MCP_CREDENTIAL
- Verify MCP connection reaches authenticated + 8 tools discovered
- closing the drawer removes the plaintext secret
- existing credential detail has Rotate and Revoke but no synthetic Test
- mobile 390px viewport has no page-level horizontal overflow
```

Capture desktop and mobile screenshots in `/tmp` only; do not add QA screenshots to the repository.

- [ ] **Step 3: Use the real one-time credential from a real agent host**

Create a mode-`0600` temporary Claude MCP configuration pointing to `http://127.0.0.1:8070/mcp` with the browser-issued bearer credential. Run one non-interactive Claude turn with only the AOPS MCP tools allowed:

```text
Use agentops.onboard through the configured AOPS MCP server. Do not call the runtime API directly. Return the resolved agent name, connection, and contract version from the tool result.
```

Expected: Claude reports a successful tool result, the hosted MCP logs an authenticated `tools/call`, and the API records last-use/activity for the exact credential identity. A direct `/v1/runtime/*` call from the test harness does not satisfy this step.

- [ ] **Step 4: Prove policy enforcement through the same real agent MCP connection**

Attach or use a restrictive test policy for the agent, then instruct Claude to call `agentops.operation_check` for a denied tool action. Expected: the MCP tool returns the existing structured denial and the console activity/evidence surface shows it. Remove only the test policy binding after evidence is captured; do not alter unrelated policies.

- [ ] **Step 5: Prove credential lifecycle fail-closed**

Rotate the credential in the browser. Expected: the old Claude MCP configuration fails authentication immediately; the new one-time credential connects and completes `agentops.onboard`. Revoke the new credential after evidence capture and confirm it returns `401`.

- [ ] **Step 6: Verify one-interrupt shutdown and restart**

Send one `Ctrl+C` to the setup supervisor. Expected: ports `3005`, `8070`, `8080`, and `8090` all close and no watcher respawns. Run `./startup.sh --run-only` again and confirm all four health checks pass.

- [ ] **Step 7: Append release evidence and update handoff**

Append exact commands, status codes, test counts, real-agent result, policy denial, rotation/revocation results, and screenshot paths to `docs/qa/2026-07-12-testnet-release-evidence.md`. Overwrite `../HANDOFF.md` with current state, commit IDs, READY/BLOCKED verdict, and the single next action.

- [ ] **Step 8: Run final diff and secret checks**

Run: `git diff --check`

Run: `git status --short`

Run: `rg -n 'conn_[A-Za-z0-9_-]{16,}|Bearer [A-Za-z0-9_-]{16,}' --glob '!archive/**' --glob '!validation/**' .`

Expected: no whitespace errors, no unintended files, and no real credential in tracked files or logs.

- [ ] **Step 9: Commit verified release evidence**

```bash
git add docs/qa/2026-07-12-testnet-release-evidence.md
git commit -m "test: record hosted MCP end-to-end proof"
```

## Execution Order and Stop Conditions

1. Execute Tasks 1–8 strictly test-first.
2. Stop immediately if stdio parity changes, credentials cross requests, a secret appears in logs, auth/onboarding changes, or the hosted service can start in production with a global customer credential.
3. Task 9 must be fully green before starting live QA.
4. Task 10 must use the actual hosted MCP endpoint and a real model-directed tool call. API-only calls, mocked clients, and connection-status-only checks do not count.
5. Claim `READY` only after automated, browser, lifecycle, policy, and real-agent evidence all pass.
