---
created: 2026-07-13
project: agentOps
ecosystem: circle
tags: [mcp, x402, paid-http, testnet, architecture]
---

# Governed x402 Paid-HTTP Design

[[HANDOFF]] | [[docs/superpowers/specs/2026-07-12-hosted-mcp-design]] | [[docs/qa/2026-07-12-testnet-release-evidence]]

## Outcome

`agentops.payment_x402` becomes the complete governed paid-request boundary. The external agent supplies one bounded HTTP request and an idempotency key. AgentOps discovers the authentic `402`, applies the existing identity, policy, approval, budget, rate, treasury, and rail controls, executes the paid retry once, and returns the merchant response to the same agent.

AgentOps does not interpret or maintain the purchased service. Session IDs, API keys, WebSocket URLs, SSE URLs, and similar bootstrap values remain opaque response data owned by the calling agent runtime.

## Product boundaries preserved

- Hosted MCP remains credential-only Streamable HTTP.
- Existing org, agent, connection, credential rotation, and revocation behavior remains authoritative.
- Existing policy evaluation and approval consumption remains authoritative.
- Existing Circle connection, wallet, source, rail, liquidity, treasury, and audit behavior remains authoritative.
- Auth, onboarding, console routing, operations, activities, and non-payment MCP tools do not change behavior.
- Merchant hosting and facilitator correctness remain outside AgentOps. AgentOps must nevertheless record its own request, payment, receipt, response, and ambiguity truthfully.

## Supported MVP contract

The testnet MVP advertises:

- x402 version 2 discovery through `PAYMENT-REQUIRED`, with the existing JSON-body fixture accepted for local exact verification.
- `exact` USDC requirements on Base, Arbitrum, Polygon, Optimism, and Avalanche networks already supported by the treasury engine.
- The existing Circle `GatewayWalletBatched` exact variant.
- `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`.
- JSON, UTF-8 text, and base64 request and response bodies.
- Bounded non-streaming responses.

It fails closed for unsupported schemes, direct protocol upgrades, unbounded SSE, cross-origin redirects, unsafe destinations, and oversized bodies. Broader x402 schemes are not implied.

## MCP request

```json
{
  "idempotency_key": "order-2026-07-13-0001",
  "request": {
    "url": "https://merchant.example/analyze?q=one&q=two",
    "method": "POST",
    "headers": [
      { "name": "content-type", "value": "application/json" },
      { "name": "x-client-context", "value": "research" }
    ],
    "body": {
      "encoding": "json",
      "value": { "text": "Analyze this" }
    }
  },
  "context": {
    "intent": "Purchase one analysis result"
  }
}
```

Rules:

- `idempotency_key` is required, 1-160 characters, and unique per runtime connection.
- Reusing the key with the same canonical request returns the existing outcome and never pays again.
- Reusing it with a different canonical request returns `payment_idempotency_conflict`.
- URL query ordering and repeated query keys are preserved.
- Caller payment headers, hop-by-hop headers, `Host`, and `Content-Length` are rejected or removed.
- JSON is canonically serialized for hashing; transmitted JSON preserves semantic value.
- Maximum request body is 256 KiB after decoding.

## Discovery and policy flow

1. Authenticate the MCP bearer credential as the existing connection.
2. Look up `connection_id + idempotency_key` before network execution.
3. Validate the URL and resolve it through the outbound safety policy.
4. Send the original unpaid request with manual redirect handling and a bounded timeout.
5. Require HTTP `402`; parse and validate its payment requirements.
6. Bind the quote to the same request URL and canonical request hash.
7. Run the existing account, rail, per-request cap, budget, policy, approval, and liquidity gates.
8. If approval is required, return the existing structured approval result without submitting payment. The retry must use the same request and key.
9. Reserve the budget and write the durable attempt before external payment execution.

An initial non-402 response is returned as `x402_payment_not_required` with bounded response metadata. It is not treated as a paid success and no payment attempt is created.

## Durable attempt model

Create `runtime_payment_attempts` with a unique `(connection_id, idempotency_key)` constraint and these states:

- `reserved`: policy passed and accounting reservation committed; no provider call has started.
- `submitting`: external payment execution may have started.
- `settled`: payment receipt is confirmed. The merchant response may be received or missing.
- `failed`: payment definitely did not settle.
- `unknown`: AgentOps cannot prove whether payment settled after execution began.

The attempt stores the request hash, bounded request metadata, quote, source, rail, amount, receipt metadata, response metadata, failure code, and timestamps. Merchant response content is encrypted at rest and expires after 15 minutes; audit and payment history retain only hashes, sizes, status, content type, and safe payment metadata.

Transitions use short transactions:

```text
prepare transaction: lock account -> reserve budget -> insert attempt(reserved) -> commit
submit transaction: attempt(reserved) -> submitting -> commit
external execution: no database lock held
finalize transaction: settled|failed|unknown -> account/reservation/event/audit updates -> commit
```

No automatic execution is allowed from `submitting` or `unknown`. A same-key retry returns the stored state. This deliberately prefers an explicit unresolved payment over double payment.

## Provider execution

The provider boundary receives:

- normalized requirements selected by the existing rail logic;
- the complete safe HTTP request;
- source wallet identity;
- provider mode;
- attempt ID for correlation.

It returns:

```ts
type X402ExecutionResult = {
  payment: {
    status: 'settled' | 'failed' | 'unknown';
    transaction?: string;
    payer?: string;
    network: string;
    receipt?: unknown;
    errorCode?: string;
  };
  response?: PaidHttpResponse;
};
```

Circle Agent Wallet execution extends the pinned `circle services pay` invocation with `--method`, `--data`, repeated `--header`, and `--timeout`. Its JSON response body and nested payment receipt are promoted into the provider result. A successful CLI invocation reports HTTP 200-compatible delivery; arbitrary merchant headers unavailable from the CLI are represented as an empty list rather than invented.

Developer-controlled wallet execution creates the official payment payload, sends it to the merchant through the same bounded HTTP executor, decodes `PAYMENT-RESPONSE`, and retains response status, headers, content type, and body. Gateway payment payloads are sent to the merchant; the merchant remains responsible for facilitator verification and settlement.

The proprietary `x-agentops-payment-*` fulfillment path remains only for the explicitly gated local exact QA fixture and is never advertised as generic x402 behavior.

## MCP response

```json
{
  "attempt_id": "payatt_...",
  "payment": {
    "status": "settled",
    "amount": "0.01",
    "asset": "USDC",
    "rail": "gateway_base",
    "network": "eip155:84532",
    "transaction": "...",
    "receipt": {}
  },
  "response": {
    "status": 200,
    "headers": [{ "name": "content-type", "value": "application/json" }],
    "content_type": "application/json",
    "body": { "session_url": "wss://merchant.example/session" },
    "body_encoding": "json",
    "size_bytes": 72,
    "truncated": false
  }
}
```

The same object is present in MCP text content as JSON and in `structuredContent`. Expected approval and liquidity states remain non-error structured MCP outcomes.

Payment truth and delivery truth are independent. A settled payment with an HTTP 422 merchant response remains `payment.status = settled` and returns the 422 response. A response timeout after possible submission becomes `unknown` unless a verifiable receipt proves settlement.

## Outbound safety

- Production permits HTTPS only. Local test mode may use HTTP for the configured AgentOps QA origin.
- Reject loopback, private, carrier-grade NAT, link-local, multicast, unspecified, and cloud metadata destinations except the exact configured local QA origin.
- Resolve DNS before request and reject unsafe resolved addresses.
- Use manual redirects. Never forward payment proof or caller authorization across origins.
- Reject caller `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, `PAYMENT-REQUIRED`, `X-PAYMENT`, `Host`, `Content-Length`, and hop-by-hop headers.
- Maximum response body is 1 MiB. Crossing the limit stops reading, records `response_too_large`, and preserves payment truth.
- Discovery timeout is 15 seconds; paid execution timeout is 30 seconds.
- Response bodies, authorization headers, cookies, and merchant bootstrap credentials are never written to ordinary logs or audit payloads.

## Regression and release gates

Completion requires:

1. TDD red-green evidence for every new behavior.
2. Existing full `npm run verify` remains green.
3. Integration merchant tests cover POST request fidelity, JSON, text, binary/base64, 402 parsing, settled 4xx, timeout, oversized response, unsafe destination, redirect, duplicate key, hash mismatch, and crash boundaries.
4. Existing policy deny, approval-required/consume, cap, budget, rail, liquidity, credential rotation/revocation, and console evidence behavior remains green.
5. Browser with the `aops-test` CDP profile creates or selects an org, creates an agent and credential, enables payment access, and verifies resulting console evidence.
6. A real model host receives only AgentOps MCP tools, invokes `agentops.payment_x402`, receives the merchant response, and cannot double-pay on same-key replay.
7. Test data and credentials are cleaned up after evidence capture.

## Rollback

The schema migration is additive. The previous route can be retained behind a temporary internal feature flag during canary, but the public tool exposes only the governed request contract after release. Disabling the paid-HTTP executor stops new submissions without disabling other MCP tools, credentials, policies, operations, treasury views, or payment history.
