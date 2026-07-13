---
created: 2026-07-13
updated: 2026-07-13
project: agentOps
ecosystem: circle
tags: [qa, x402, mcp, payments, recovery, testnet]
---

# x402 Paid HTTP Release Evidence

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/superpowers/specs/2026-07-13-x402-paid-http-design]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/deployment/hosted-mcp]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/qa/2026-07-12-testnet-release-evidence]]

## Evidence Boundary

This note records the completed local release proof on branch `feat/mcp-paid-http` through code candidate `dff4a92`. The proof used the authenticated `aops-test` browser profile, a browser-created disposable agent and credential, the locally hosted four-service stack, and a real Claude Haiku process restricted to AgentOps MCP tools.

## Full Verification

Command:

```bash
npm run verify
```

Result: exit `0` on 2026-07-13. Lint, typecheck, all production builds, bootstrap, and every workspace test passed.

| Surface | Files | Tests |
|---|---:|---:|
| Bootstrap and deployment contracts | n/a | 19 |
| Config | 1 | 1 |
| Contracts | 1 | 1 |
| Database | 2 | 7 |
| API | 42 | 402 |
| Hosted MCP | 6 | 204 |
| Web | 27 | 244 |
| **Total** |  | **878** |

The web build completed every static and dynamic route. The test runner's existing `Not implemented: navigation to another Document` jsdom message remained non-failing; the web suite passed `244/244`.

Source: fresh `npm run verify` output after `dff4a92`; package scripts in `package.json`.

## Browser And Real-Agent MCP Proof

The browser-created release identity was `agt_ec64c04d-64eb-4435-a168-7b7e0cf46598` in the existing `Abhinav Testnet QA` organization. The credential value was handled only as a one-time secret in mode-`0600` temporary files and was never printed, committed, or retained.

A real `claude-haiku-4-5-20251001` process was started with `--strict-mcp-config`, no built-in tools, and only `mcp__agentops__*` allowed. It called `agentops.payment_x402` for the explicitly enabled local QA merchant fixture using idempotency key `task8-20260713-live-004`.

Confirmed settlement evidence:

| Field | Value |
|---|---|
| Payment event | `payevt_2e37ca8b-58ef-42c8-9d48-46f39e2ada70` |
| Runtime attempt | `rpa_8ca0f643-dcdd-4982-bf44-96d407d92dad` |
| Status | `settled` |
| Rail | `gateway_base` |
| Amount | `0.001 USDC` |
| Network | `eip155:84532` |
| Payer | `0x1b3e1e392732d37ecba66916be7650c8f214358b` |
| Gateway transaction | `cd71d443-4396-4665-ab45-dd544ce85d47` |
| Merchant response | HTTP `200`, `gateway-weather` resource delivered |

The exact same MCP call and idempotency key were replayed by a second real model process. It returned the same payment event, attempt, payer, transaction, and merchant response. The browser Activity & Evidence page showed one settled event for that payment, proving the replay did not create another product payment record or settlement.

The browser console also confirmed the release agent's spend changed to `0.001 USDC`, while the payment evidence row showed `Settled` on `Gateway · Base`.

After the final hardening commit, the four-service stack was restarted and every API, hosted MCP, and Circle-worker health/readiness probe returned `200`. The authenticated browser reloaded the deactivated release agent and Treasury Activity & Evidence routes, still showed the settled event above, and reported no console warnings or errors. This post-fix smoke did not create another credential or payment.

## Credential Lifecycle And Cleanup

- The browser rotated the release credential. A real MCP-only model using the old secret could no longer discover `agentops.onboard`.
- The replacement secret authenticated the same agent and connection and returned its governed capabilities.
- The browser revoked the replacement. A real MCP-only model using it could no longer discover `agentops.onboard`.
- The browser then showed zero active credentials, disabled payment access, and a deactivated disposable agent.
- All temporary credential and MCP configuration files were removed after the lifecycle proof.

Source: authenticated Chrome DevTools browser run and real Claude Code `2.1.207` MCP-only invocations on 2026-07-13.

## Defects Found By The Real-Agent Gate

The live gate found three contract mismatches that the earlier mocked provider path did not expose. Each was fixed before the final successful call:

1. The API had not received the explicitly gated local QA HTTP origin allowlist, although the worker had. The shared fail-closed derivation is now wired into both services; production still requires HTTPS.
2. The hand-built x402 v2 payment payload omitted the merchant's `resource`. The authenticated quote resource is now carried into the signed payload.
3. Gateway funds and signatures belong to the Agent Wallet backing EOA, while the signing command targets the smart-account wallet. Authorization and receipt validation now use the backing EOA without changing the wallet used to request the signature.

Focused red/green regression tests cover the QA-origin derivation, payload resource binding, backing-EOA authorization, and matching receipt payer. The final full verification includes those tests.

## Consolidated Review Closure

The single consolidated release review found four remaining failure modes. Commit `dff4a92` closes them with red-to-green coverage:

1. API-to-worker settlement timeouts and network failures are now `ambiguous_post_submit`, so AgentOps records `unknown` and retains the reservation instead of asserting failure after a potentially completed external settlement.
2. Expired pre-submit reservations and denied or expired approvals are reconciled atomically. Reserved budget is decremented exactly once; submitting and unknown attempts remain reserved for operator recovery.
3. Non-x402 responses and bounded transport failures now return stable, safe API/MCP errors instead of generic `500` responses or upstream details.
4. The API and MCP enforce the specified 160-character idempotency-key maximum with exact 160/161 boundary tests.

## Adversarial Recovery Matrix

The full paid-flow suite ran three consecutive times after integration:

```bash
for run in 1 2 3; do
  npm test --workspace @agentops-pmoa/api -- x402-paid-http-flow.test.ts || exit 1
done
```

Each run passed `14/14`; aggregate repeated result was `42/42`.

| Failure or replay condition | Automated result |
|---|---|
| Concurrent same-key requests | One durable attempt, one reservation, one provider call |
| Same key with a different request hash | Rejected without reusing the first result |
| Crash after reservation | Same-key controlled recovery; no duplicate payment |
| Crash after `submitting` | Remains unresolved and does not automatically repay |
| Crash after durable provider-success evidence | Finalizes from evidence without a second provider call |
| Lost API response | Same-key recovery returns the settled result; provider called once |
| Lost hosted-MCP response | Caller disconnect followed by same-key recovery; no duplicate MCP execution |
| Merchant `422` after payment | Payment stays settled while HTTP response truth stays `422` |
| Discovery timeout | Rejected before payment submission |
| Oversized discovery response | Rejected before payment submission |
| Redirect | Rejected before payment submission |
| Unsafe/private destination | Rejected before payment submission |

Source: `apps/api/test/payments/x402-paid-http-flow.test.ts`, `apps/api/test/payments/x402-http.test.ts`, `apps/api/test/payments/x402-attempt-store.test.ts`, and `apps/mcp/test/http-handler.test.ts`.

## Deployment And Security Gates

- `docker compose --env-file /dev/null -f deploy/docker-compose.testnet.yml config --quiet` passed with synthetic required values.
- `node --test scripts/bootstrap.test.mjs scripts/setup-script.test.mjs` passed `11/11` with the temporary loopback permission required by the supervisor test.
- `git diff --check 2776f57..HEAD` passed.
- The feature diff contains no PEM private key, long bearer value, or JWT-shaped value.
- Assignment-pattern matches are confined to synthetic deployment fixtures in `apps/api/test/config/env.test.ts`.
- The only repository-wide PEM-pattern match is the pre-existing test-only TLS key fixture in `apps/api/test/payments/x402-http.test.ts`; it is not a deployment credential.
- `npm audit --audit-level=high` exited `0`: no high or critical advisory. Seven moderate advisories remain in the locked Circle CLI to Solana `uuid` dependency path, with no upstream fix available at verification time.

Source: deployment contract tests, sanitized pattern-only git scans, and fresh npm audit output on 2026-07-13.

## Accepted Test Boundary

- Timeout, oversized-response, redirect, and unsafe-destination full-flow cases fail during authentic discovery, before payment submission. Provider-specific post-submission ambiguity is covered by durable unknown-state handling rather than artificial production hooks.
- Lost-response evidence is compositional: a real API/provider abort recovery test plus a real hosted-MCP disconnect recovery test. The release gate still requires a live model using only MCP against the locally hosted stack.
- QA merchant fixtures are disabled by default and must be explicitly enabled only for the isolated local release proof.

## Release Gate Result

The browser-created credential, real-agent MCP settlement, same-key replay, console evidence, rotation, revocation, cleanup, consolidated review fixes, post-fix browser smoke, and final full verification gates all passed. `npm audit --audit-level=high` also exited `0`: there are no high or critical advisories; seven transitive moderate `uuid` advisories remain in the pinned Circle/Solana dependency chain with no upstream fix available.

This is a deployment-ready testnet MVP code candidate. A public HTTPS staging deployment, managed backing services, and external staging smoke remain environment rollout work and are not claimed by this local evidence.
