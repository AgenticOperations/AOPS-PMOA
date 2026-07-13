---
created: 2026-07-13
project: agentOps
ecosystem: circle
tags: [implementation-plan, mcp, x402, tdd, testnet]
---

# Governed x402 Paid-HTTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

[[HANDOFF]] | [[docs/superpowers/specs/2026-07-13-x402-paid-http-design]] | [[validation/spike-results]]

**Goal:** Complete the AgentOps MCP x402 boundary so a real external agent submits one original HTTP request, AgentOps discovers and governs the authentic 402, pays at most once, and returns the merchant response with durable recovery and testnet release proof.

**Architecture:** Add a bounded paid-HTTP codec and executor, a durable idempotent attempt table, and a provider result that keeps payment truth separate from HTTP response truth. Preserve the existing identity, policy, approval, treasury, liquidity, audit, and hosted-MCP boundaries. Finish with deployment hardening and browser plus real-agent evidence.

**Tech Stack:** Node.js 22, TypeScript 6, Fastify, PostgreSQL 16, Zod, native `fetch`, `@x402/core@2.18.0`, `@x402/evm@2.18.0`, `@circle-fin/cli@0.0.6`, MCP SDK 1.29, Vitest, Testcontainers, Next.js 15, Playwright/CDP, Claude Code real-agent QA.

---

### Task 1: Canonical paid-HTTP request, discovery, response, and safety codec

**Files:**
- Create: `apps/api/src/engines/payments/x402-http.ts`
- Create: `apps/api/test/payments/x402-http.test.ts`
- Modify: `apps/api/src/engines/payments/types.ts`

- [ ] **Step 1: Write failing codec tests**

Add tests that express the public internal contract:

```ts
const request = normalizePaidHttpRequest({
  url: `${merchant.url}/paid?q=one&q=two&encoded=a%2Fb`,
  method: 'POST',
  headers: [{ name: 'content-type', value: 'application/json' }],
  body: { encoding: 'json', value: { prompt: 'hello' } },
}, { allowHttpOrigins: [merchant.origin] });

expect(request.method).toBe('POST');
expect(request.url).toContain('q=one&q=two');
expect(request.body).toEqual(Buffer.from('{"prompt":"hello"}'));
```

Cover: v2 `PAYMENT-REQUIRED` parsing, JSON-body fallback, JSON/text/base64, repeated query values, forbidden headers, invalid URL, HTTPS enforcement, configured local HTTP exception, loopback/private rejection, manual redirect rejection, timeout, 256 KiB request limit, 1 MiB response limit, binary response encoding, and settled non-2xx response preservation.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test --workspace @agentops-pmoa/api -- x402-http.test.ts
```

Expected: FAIL because `x402-http.ts` and exported types do not exist.

- [ ] **Step 3: Implement the minimal codec and executor**

Define:

```ts
export type PaidHttpBody =
  | { readonly encoding: 'json'; readonly value: unknown }
  | { readonly encoding: 'text' | 'base64'; readonly value: string };

export type PaidHttpRequest = {
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly headers: readonly { readonly name: string; readonly value: string }[];
  readonly body?: PaidHttpBody;
};

export type PaidHttpResponse = {
  readonly status: number;
  readonly headers: readonly { readonly name: string; readonly value: string }[];
  readonly contentType: string | null;
  readonly bodyEncoding: 'json' | 'text' | 'base64';
  readonly body: unknown;
  readonly sizeBytes: number;
  readonly truncated: false;
};
```

Implement `normalizePaidHttpRequest`, `canonicalPaidHttpRequestHash`, `executeBoundedHttpRequest`, and `paymentRequiredFromResponse`. Use `redirect: 'manual'`, `AbortSignal.timeout`, bounded stream reads, public `@x402/core/http` decoders, DNS resolution injection for tests, and denylisted headers. Do not log request or response bodies.

- [ ] **Step 4: Verify GREEN and refactor**

Run the focused test until all cases pass, then run API typecheck and lint.

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/api/src/engines/payments/x402-http.ts apps/api/src/engines/payments/types.ts apps/api/test/payments/x402-http.test.ts
git commit -m "feat(payments): add bounded x402 HTTP contract"
```

---

### Task 2: Durable idempotent payment attempts and encrypted result recovery

**Files:**
- Create: `packages/db/src/migrations/0021_runtime_payment_attempts.sql`
- Create: `apps/api/src/engines/payments/x402-attempt-store.ts`
- Create: `apps/api/test/payments/x402-attempt-store.test.ts`
- Modify: `packages/db/test/migrate.test.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing migration and state tests**

Test the desired transitions using a real migrated PostgreSQL container:

```ts
const first = await reserveAttempt(pool, input);
expect(first.status).toBe('reserved');

const replay = await reserveAttempt(pool, input);
expect(replay.id).toBe(first.id);

await expect(reserveAttempt(pool, { ...input, requestHash: 'different' }))
  .rejects.toMatchObject({ code: 'payment_idempotency_conflict' });
```

Cover unique `(connection_id, idempotency_key)`, request-hash mismatch, legal state transitions, duplicate concurrent reservation, encrypted response round-trip, expiry, response-not-logged shape, and recovery from `reserved`, `submitting`, `settled`, `failed`, and `unknown`.

- [ ] **Step 2: Run the focused tests and verify RED**

Expected: migration `0021` and attempt functions are missing.

- [ ] **Step 3: Add the additive migration**

Create `runtime_payment_attempts` with request/quote hashes, connection/org/agent/source relations, amount/rail/network, status check, receipt metadata, encrypted result envelope, expiry, error code, and timestamps. Add:

```sql
UNIQUE (connection_id, idempotency_key)
```

Do not alter or delete existing payment history.

- [ ] **Step 4: Implement attempt storage**

Implement `findAttempt`, `reserveAttempt`, `markAttemptSubmitting`, `finalizeAttemptSettled`, `finalizeAttemptFailed`, and `finalizeAttemptUnknown`. Encrypt only recoverable response content using an authenticated AES-256-GCM envelope derived from the required production payment-result key; retain safe response metadata separately.

- [ ] **Step 5: Verify GREEN and migration repeatability**

Run the focused API test, database migration test, API lint, and API typecheck.

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/db apps/api/src/engines/payments/x402-attempt-store.ts apps/api/test/payments/x402-attempt-store.test.ts apps/api/src/config/env.ts .env.example
git commit -m "feat(payments): persist idempotent x402 attempts"
```

---

### Task 3: Circle providers execute the original paid request and retain receipts

**Files:**
- Modify: `apps/api/src/engines/payments/circle-agent-cli.ts`
- Modify: `apps/api/src/engines/payments/circle-provider.ts`
- Modify: `apps/api/test/payments/circle-agent-cli.test.ts`
- Modify: `apps/api/test/payments/circle-provider.test.ts`

- [ ] **Step 1: Write failing provider tests**

Specify the Agent Wallet CLI call:

```ts
expect(call.args).toEqual([
  'services', 'pay', request.url,
  '--address', wallet,
  '--chain', 'BASE-SEPOLIA',
  '--max-amount', '0.01',
  '--method', 'POST',
  '--data', '{"prompt":"hello"}',
  '--header', 'content-type: application/json',
  '--timeout', '30',
  '--output', 'json',
]);
```

Test nested `payment.receipt` promotion, JSON/text response promotion, definitive pre-submit failure, ambiguous post-submit failure, developer-controlled exact response body/headers, Gateway paid retry to the merchant rather than direct client-side facilitator settlement, and settled 422 preservation.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: current executor accepts only URL/amount and current provider drops response metadata.

- [ ] **Step 3: Extend provider types and Agent Wallet execution**

Change `payService` to accept the normalized request, safe headers, timeout, and attempt correlation. Parse:

```ts
{
  response,
  payment: { amount, chain, scheme, seller, receipt }
}
```

Return body and receipt without inventing missing arbitrary headers. Preserve CLI ambiguity details and payment debug material only in the encrypted attempt path; never ordinary logs.

- [ ] **Step 4: Unify developer-controlled paid replay**

Create the x402 payload, inject the correct payment header, call the bounded executor with the original request, decode payment receipt, and return independent payment/response truth. For Gateway, send the batch payload to the merchant; do not separately settle then omit the merchant request.

- [ ] **Step 5: Verify GREEN and existing rail tests**

Run both focused provider suites and the full Section 9 payment test file.

- [ ] **Step 6: Commit Task 3**

```bash
git add apps/api/src/engines/payments/circle-agent-cli.ts apps/api/src/engines/payments/circle-provider.ts apps/api/test/payments
git commit -m "feat(payments): return merchant response from Circle x402"
```

---

### Task 4: Orchestrate discovery, policy, durable reservation, execution, and finalization

**Files:**
- Modify: `apps/api/src/engines/payments/routes.ts`
- Modify: `apps/api/src/engines/payments/store.ts`
- Modify: `apps/api/src/engines/payments/types.ts`
- Create: `apps/api/test/payments/x402-paid-http-flow.test.ts`
- Modify: `apps/api/test/payments/section-6-8-payment-control.test.ts`
- Modify: `apps/api/test/payments/section-9-circle-treasury.test.ts`

- [ ] **Step 1: Write failing end-to-end API tests**

Use a real local Fastify merchant and migrated database. Call:

```ts
await api.inject({
  method: 'POST',
  url: '/v1/runtime/payments/x402',
  headers: { authorization: `Bearer ${credential}` },
  payload: {
    idempotency_key: 'paid-post-1',
    request: {
      url: merchant.paidUrl,
      method: 'POST',
      headers: [{ name: 'content-type', value: 'application/json' }],
      body: { encoding: 'json', value: { prompt: 'hello' } },
    },
  },
});
```

Cover authentic discovery, quote/resource mismatch, policy deny, approval-required and same-key approved retry, cap, budget, rate control, reservation before provider invocation, provider called outside a database transaction, exact same-key cached replay, different-hash conflict, definite failure release, ambiguous failure unknown/no-repay, settled 422, binary response, and crash injection after `submitting` and after provider success.

- [ ] **Step 2: Run focused flow tests and verify RED**

Expected: route still requires caller `accepts` and no durable attempt exists.

- [ ] **Step 3: Implement discovery input and preflight replay lookup**

Replace the runtime request schema with required `idempotency_key` and typed `request`. Discover the 402 internally and construct the existing normalized quote/policy input. Before discovery, return an existing same-key outcome or conflict.

- [ ] **Step 4: Split the current long transaction**

Refactor `payRuntimeX402` into explicit prepare, execute, and finalize phases. Preserve `enforceX402Policy`, approval context binding, rail readiness, liquidity preparation, route observations, activity, payment event, audit event, and balance/account updates. Hold no database transaction during Circle, RPC, facilitator, CLI, or merchant HTTP calls.

- [ ] **Step 5: Implement payment/delivery truth**

Always finalize confirmed settlement even if the merchant response is 4xx/5xx or missing. Use `unknown` only when submission may have happened and no reliable receipt proves the result. Never automatically execute from `submitting` or `unknown`.

- [ ] **Step 6: Verify GREEN and all payment regression suites**

Run the focused flow file, Section 6-8, Section 9, quote selection/validation, API lint, and API typecheck.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/api/src/engines/payments apps/api/test/payments
git commit -m "feat(payments): execute x402 through durable paid HTTP flow"
```

---

### Task 5: Upgrade the MCP tool contract and agent-visible result

**Files:**
- Modify: `apps/mcp/src/runtime-client.ts`
- Modify: `apps/mcp/src/tools.ts`
- Modify: `apps/mcp/test/tools.test.ts`
- Modify: `apps/mcp/test/runtime-client.test.ts`
- Modify: `apps/mcp/test/server.test.ts`
- Modify: `apps/web/src/components/agents/McpConnectionGuide.tsx`
- Modify: `apps/web/test/agents/mcp-connection-guide.test.tsx`

- [ ] **Step 1: Write failing MCP contract tests**

Require `idempotency_key` and the typed request schema, reject caller-supplied payment headers, forward the request unchanged to the runtime API, and return the complete result in both MCP text JSON and `structuredContent`.

```ts
expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent?.payment);
expect(result.structuredContent?.payment.response.body.session_url)
  .toBe('wss://merchant.example/session');
```

Preserve approval-required, liquidity-preparing, deny, and credential errors with their current agent-usable semantics.

- [ ] **Step 2: Run MCP/web focused tests and verify RED**

Expected: current schema requires `accepts` and summary content omits the merchant response.

- [ ] **Step 3: Implement the MCP schema and output**

Update the runtime client type and request body. Make successful x402 results serialize the complete bounded payment object into text and structured content. Keep all other tool contracts unchanged.

- [ ] **Step 4: Update the connection guide**

Document the one-call paid HTTP shape and same-key retry behavior without exposing secrets. Do not add another setup button or duplicate console action.

- [ ] **Step 5: Verify GREEN and all MCP/web tests**

Run MCP tests, the focused web test, MCP/web lint, MCP/web typecheck, and MCP build.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/mcp apps/web/src/components/agents/McpConnectionGuide.tsx apps/web/test/agents/mcp-connection-guide.test.tsx
git commit -m "feat(mcp): expose governed paid HTTP requests"
```

---

### Task 6: Deployment hardening required for the four-service testnet MVP

**Files:**
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/test/migrate.test.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/circle-worker.ts`
- Modify: `apps/api/src/engines/payments/circle-worker-client.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `scripts/bootstrap.test.mjs`
- Modify: `.env.example`
- Modify: `docs/deployment/hosted-mcp.md`
- Modify: `docs/env-inventory.md`
- Create: `deploy/docker-compose.testnet.yml`

- [ ] **Step 1: Write failing deployment tests**

Cover PostgreSQL advisory migration locking, production rejection of localhost/default URLs and missing secrets, dependency-aware readiness, bounded API-to-worker timeout, SIGTERM draining, QA x402 fixture disabled unless explicitly enabled, consistent `MCP_MAX_INFLIGHT`, and a four-service manifest containing web/API/MCP/worker plus Postgres/Redis health dependencies.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: each HANDOFF blocker remains observable.

- [ ] **Step 3: Implement minimal hardening**

Use a database advisory lock around migration application. Validate production/testnet deployment variables fail closed. Add `AbortSignal.timeout` to worker calls, dependency-aware readiness, and graceful close handlers. Mount QA merchant routes only when `ENABLE_TESTNET_X402_FIXTURES=true` and never by default in production.

- [ ] **Step 4: Add the reproducible manifest and correct docs**

The manifest must define all four application services, Postgres, Redis, secret injection points, private service networking, public web/API/MCP ports, health checks, and persistent database storage. Do not embed secrets.

- [ ] **Step 5: Verify GREEN**

Run database, API, bootstrap, config, deployment contract tests, lint, typecheck, and production builds.

- [ ] **Step 6: Commit Task 6**

```bash
git add packages/db apps/api scripts .env.example docs deploy
git commit -m "chore(deploy): harden AgentOps testnet services"
```

---

### Task 7: Full automated regression and adversarial failure matrix

**Files:**
- Modify only files required by failures, always test-first
- Create: `docs/qa/2026-07-13-x402-paid-http-evidence.md`

- [ ] **Step 1: Run the complete verification command**

```bash
npm run verify
```

Record exact build/test counts and any baseline warnings. Do not claim success if any workspace, build, lint, typecheck, bootstrap, or test fails.

- [ ] **Step 2: Run focused failure injection repeatedly**

Run the paid-flow suite at least three times. Explicitly prove duplicate concurrency, crash after reserve, crash after submitting, lost MCP response, same-key replay, hash mismatch, merchant 422, timeout, oversized response, redirect, and unsafe destination.

- [ ] **Step 3: Run security and secret scans**

Verify logs, git diff, fixtures, evidence, and deployment files contain no bearer credential, OAuth token, Circle session, cookie, private key, payment result encryption key, or one-time secret.

- [ ] **Step 4: Write automated evidence**

Create the evidence note with YAML frontmatter, backlinks to the design and release evidence, commands, exit codes, exact counts, and any accepted limitation. Do not write browser or real-agent claims yet.

- [ ] **Step 5: Commit Task 7**

```bash
git add .
git commit -m "test(payments): prove x402 paid HTTP recovery"
```

---

### Task 8: Browser-created agent and real-agent MCP release proof

**Files:**
- Modify: `docs/qa/2026-07-13-x402-paid-http-evidence.md`
- Modify: `README.md`
- Modify: `docs/deployment/hosted-mcp.md`
- Modify: `HANDOFF.md` in the project root after final verification

- [ ] **Step 1: Start the complete local stack**

Use the supported startup path with web, API, hosted MCP, Circle worker, PostgreSQL, and Redis. Verify all dependency-aware health endpoints before browser work.

- [ ] **Step 2: Attach the browser through the existing `aops-test` CDP profile**

Use the authenticated profile rather than creating a new browser identity. Through the UI, select or create a disposable QA org, create a disposable agent and one-time credential, connect Circle if required, enable the tested rail and bounded payment access, and record only sanitized IDs.

- [ ] **Step 3: Run a real model with MCP only**

Create a mode-0600 temporary client configuration pointing to hosted MCP with the browser-issued bearer credential. Disable built-in HTTP, shell, and direct API tools. Instruct the model to call `agentops.payment_x402` with the bounded merchant request and a unique idempotency key.

Expected proof:

- authentic 402 discovery;
- policy allow or approval-required then browser approval and retry;
- one Circle testnet payment;
- exact merchant response visible to the model;
- same-key replay returns the stored result without a second payment;
- browser console shows matching attempt, payment, activity, approval, and balance evidence.

- [ ] **Step 4: Prove credential lifecycle and cleanup**

Rotate the credential and confirm the old real-agent client fails. Confirm the replacement works, revoke it, and confirm it fails. Disable temporary payment access, detach/archive temporary policies, deactivate the agent, and remove temporary client files.

- [ ] **Step 5: Rerun full verification after E2E**

Run `npm run verify` fresh and read the complete output. Check git status and secret scans.

- [ ] **Step 6: Complete documentation and handoff**

Add sanitized browser/model/payment evidence, exact commands, IDs safe to retain, transaction/receipt reference, test counts, supported scheme matrix, deployment command, rollback procedure, and remaining external limitations. Fully overwrite `HANDOFF.md` with current state and next action per project protocol.

- [ ] **Step 7: Request final spec and code-quality reviews**

Dispatch independent reviewers against the design, plan, git diff, verification output, and E2E evidence. Fix every Critical or Important issue with a failing test first and re-review.

- [ ] **Step 8: Finish the branch**

Use `superpowers:finishing-a-development-branch` only after all verification and reviews pass.

---

## Plan self-review

- Spec coverage: request fidelity, authentic discovery, existing governance, durable state, idempotency, response pass-through, ambiguity, security, provider paths, deployment, browser, real-agent, cleanup, and rollback are each mapped to a task.
- Placeholder scan: no TBD/TODO/implement-later steps remain.
- Type consistency: `PaidHttpRequest`, `PaidHttpResponse`, `runtime_payment_attempts`, `idempotency_key`, and payment states use the same names across tasks.
- Scope boundary: no proxy, session broker, WebSocket relay, merchant hosting, or new x402 scheme is added.
