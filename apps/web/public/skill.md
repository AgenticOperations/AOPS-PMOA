---
name: agentops-runtime
description: Connect to and operate through an agentOps-governed agent identity — policy checks, x402 payments, and human approvals, all over MCP.
audience: agent
---

# Operating through agentOps

This is a step-by-step walkthrough for an agent (or the code configuring
one) connecting to agentOps for the first time, with worked examples for
every tool call. Read `llms.txt` first if you have not — this is the longer
version of the same five steps.

## 1. Connect

Obtain an MCP URL + bearer credential via one of:

- **Phase 0:** operator console (Agents → Connections → new credential)
- **Phase 1:** `POST {API}/v1/agent-join/invite/redeem` with
  `{ "token": "<invite>", "agent_name": "<name>" }`. **Before calling redeem in a
  chat session, ask the human** what display name to use (console + marketplace).
  Do not silently invent `joined-agent-…` names when a human is present.
- **Phase 3:** `POST {API}/v1/agent-join/open` only if `GET .../open/status` says
  enabled — same rule: ask for `agent_name` first, then include it in the body.

Join paths start with **payment access disabled**. Every MCP request then carries
`Authorization: Bearer <credential>`. The credential identifies which agent you
are — you never pass an agent id yourself.

## 2. Onboard

Call `agentops.onboard` with no arguments:

```json
{ "name": "agentops.onboard", "arguments": {} }
```

You get back the current runtime contract for your connection — agent and
connection identity, which enforcement modes are active, and the full
action catalog with required/optional fields and a worked example per
action. **This response is generated live from the same policy registry
your requests are checked against.** Treat it as the source of truth for
what actions exist right now; this file only teaches the shape of the
conversation, not the current catalog.

## 3. Check policy before an ungoverned action

For an external HTTP/API call or a tool call, check first:

```json
{
  "name": "agentops.policy_check",
  "arguments": {
    "action": "runtime.http.request",
    "resource": { "url": "https://api.weather.example/current", "category": "weather" },
    "context": { "purpose": "research" }
  }
}
```

Three outcomes:

- **Allowed** — the response's `decision.decision` is `"allow"`. Proceed.
- **Denied** — `decision.decision` is `"deny"`. Stop. Do not retry the same
  request reworded — it will not pass, and repeated attempts around a
  denial look like an attempt to route around governance.
- **Approval required** — the tool result reports `approval required` with
  an `Approval: <id>` and `Decision: <id>`. Go to step 5.

`agentops.operation_check` is the same evaluation, scoped to exactly
`runtime.http.request` and `tool.call` — **prefer it over `policy_check`
for those two action types**; reach for the more general `policy_check`
for anything else the contract lists.

## 4. Pay through x402

For a paid resource, skip the separate policy check — `agentops.payment_x402`
applies policy and payment controls itself, then executes the payment:

```json
{
  "name": "agentops.payment_x402",
  "arguments": {
    "idempotency_key": "job-42-fetch-report",
    "request": {
      "url": "https://paid-data.example/report",
      "method": "GET",
      "headers": []
    }
  }
}
```

`idempotency_key` must be unique per logical attempt — reusing it replays
the same recorded result rather than paying twice, which is the point: if
your process crashes mid-call and retries, use the SAME key. A brand new
attempt needs a new key.

If this also comes back `approval required`, go to step 5 — the payment
has not been made yet.

## 4b. Pay another agent in your own fleet

If the resource you need is served by another agent in the same fleet
(rather than an external merchant), call `agentops.payment_intra_fleet`
instead of `agentops.payment_x402`:

```json
{
  "name": "agentops.payment_intra_fleet",
  "arguments": {
    "payee_agent_id": "agt_data_fetcher",
    "chain": "arc",
    "url": "https://data-fetcher.internal/report"
  }
}
```

This settles by drawing down your agent's standing Permit2 delegation to
the payee (signed automatically on first use, reused after) rather than
Circle's x402 settlement rails — the 402 price-discovery step still
happens against `url`, only the settlement mechanism differs. It is
bounded by your delegation ceiling and the org treasury's solvency, not
by a policy check. **It has no idempotency key** — unlike
`agentops.payment_x402`, retrying it after a timeout or crash risks
paying twice. If a call's outcome is unknown, check with the operator or
inspect the activity feed before calling again.

## 5. Wait for and consume an approval

Poll status (a human has to act; wait at least 2 seconds between polls,
backing off further — e.g. doubling up to a ~30 second cap — rather than
polling in a tight loop):

```json
{ "name": "agentops.approval_status", "arguments": { "approval_id": "apv_..." } }
```

Once `status` is `"approved"`, consume it **immediately before** performing
the action it authorizes — do not consume it ahead of time and hold it,
consuming is one-time:

```json
{
  "name": "agentops.approval_consume",
  "arguments": { "approval_id": "apv_...", "decision_id": "pdec_..." }
}
```

Then perform the original action (re-issue the same `agentops.payment_x402`
or proceed with the operation `agentops.policy_check` was guarding).

## 6. Record what happened

For actions that weren't themselves an agentOps-mediated call but that an
operator should see in the activity feed:

```json
{
  "name": "agentops.activity_record",
  "arguments": { "summary": "Summarized 3 competitor pricing pages for the weekly report." }
}
```

`agentops.operation_record` is the equivalent for a specific
`runtime.http.request` / `tool.call` you already performed and want
reflected against that action's own history, with an `outcome`
(`success` | `denied` | `pending` | `error`).

## Common mistakes

- **Retrying past a denial.** A `deny` is a decision, not a transient
  failure. Reformulating the request to slip past policy is not the goal —
  ask the operator to adjust policy if the denial is wrong.
- **Holding a consumed approval.** Consume right before acting, every time.
  An approval consumed early and acted on late can be acting against a
  policy state that has since changed.
- **Skipping `idempotency_key` reuse on retry.** If a payment attempt's
  outcome is genuinely unknown (your process crashed, the connection
  dropped), retry with the SAME `idempotency_key` so agentOps returns the
  already-recorded result instead of risking a second payment.
- **Assuming the action catalog in this file is current.** It is not
  reproduced here on purpose — always read it from `agentops.onboard`.
