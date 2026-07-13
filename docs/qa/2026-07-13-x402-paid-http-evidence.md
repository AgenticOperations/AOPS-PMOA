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

This note currently records automated evidence on branch `feat/mcp-paid-http` at `fe0d43f`. It does not yet claim the browser-created credential, real-agent MCP call, Circle testnet transaction, credential lifecycle, or post-E2E cleanup required for release.

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
| API | 42 | 387 |
| Hosted MCP | 6 | 202 |
| Web | 27 | 244 |
| **Total** |  | **861** |

The web build completed every static and dynamic route. The test runner's existing `Not implemented: navigation to another Document` jsdom message remained non-failing; the web suite passed `244/244`.

Source: fresh `npm run verify` output on commit `fe0d43f`; package scripts in `package.json`.

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

## Remaining Release Gate

Start the full local stack, use the authenticated `aops-test` Chrome profile to create a disposable agent credential, run a real model with only the hosted AgentOps MCP tools, prove one Circle testnet payment and same-key replay, verify the console evidence, rotate and revoke credentials, clean up temporary policy/payment access, then rerun `npm run verify` and complete this note.
