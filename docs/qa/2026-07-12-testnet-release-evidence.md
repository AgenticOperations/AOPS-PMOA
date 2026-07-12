---
created: 2026-07-12
updated: 2026-07-12
project: agentOps
ecosystem: circle
tags: [qa, testnet, release, circle, x402, treasury]
---

# Testnet Release Evidence

Backlinks: [[10-Projects/Web3-Builds/agentOps/HANDOFF]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/deployment/testnet-circle-worker]]

## Scope

This report covers the testnet-only AgentOps product: Google organization onboarding, isolated Circle Agent Wallet connection, five-chain treasury bootstrap, policy/runtime/MCP controls, real exact and Gateway x402 settlement, request-driven liquidity preparation, and deployment gates.

No credential secret, OTP, session token, Circle profile, or worker token is included. The custom `0.40 USDC` quote attempted during QA is excluded from acceptance evidence: it queued only an internal `0.085772 USDC` Arbitrum-to-Base top-up and no payment was executed.

## Release Gates

| Gate | Result | Evidence |
|---|---|---|
| Lint | Pass | `npm run verify`, all workspaces |
| Typecheck | Pass | `npm run verify`, all workspaces |
| Production build | Pass | API, Next.js web, hosted and standalone MCP, and shared packages |
| Bootstrap suite | Pass | 14 tests |
| Shared config/contracts | Pass | 2 files, 2 tests |
| Database migrations | Pass | 2 files, 6 tests |
| API suite | Pass | 35 files, 196 tests |
| MCP suite | Pass | 6 files, 183 tests |
| Web suite | Pass | 27 files, 243 tests |
| Docker image | Pass | `agentops-pmoa:testnet-qa`, manifest `sha256:cdda114b6d9cbab1289017a29b72c985ac0540dbcb10a23a72f2e235982a6f73` |
| Diff whitespace | Pass | `git diff --check` |

Source: fresh local release run on 2026-07-12 using the `package.json` `verify` script.

## Production-Mode Recovery

- Built web, API, and Circle worker started from compiled output on ports `3005`, `8080`, and `8090`.
- Duplicate development watchers were stopped before the production-mode run.
- After restarting the Circle worker, QA organization A restored its encrypted organization-scoped Circle profile without another OTP.
- The browser showed the same masked wallet address, five chains, and `10/10 rails ready` after restart.
- An unauthenticated request to the worker's private command surface returned `401 circle_worker_unauthorized`.
- The production browser loaded Overview, Agents, Controls, Operations, Approvals, Settings, Treasury, Sources & Rails, Agent Access, Liquidity, and Activity & Evidence for QA organization C with the expected page heading and no application error.

Source: Chrome CDP browser session on `9223`, built process logs, and [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/deployment/testnet-circle-worker]].

## Organization And Isolation Checks

| Scenario | Result |
|---|---|
| Duplicate org submission for QA organization A | Returned the existing org with HTTP 200; org count stayed 1 |
| QA organization A reads organization B Circle wallets | 404 `not_found` |
| QA organization A reads organization C Circle wallets | 404 `not_found` |
| Missing runtime credential | 401 `invalid_connection` |
| Invalid runtime credential | 401 `invalid_connection` |
| Policy creation without operator session | 401 `unauthorized` |
| Attempt to enable live payment mode | 400 `payment_mode_testnet_only` |
| Create `simulation` payment source | 400 `validation_error` |
| Create `manual` payment source | 400 `validation_error` |

Source: authenticated Chrome calls from the API origin and sanitized `/tmp/agentops-e2e-*.jsonl` QA ledgers.

## Organization Regressions

### QA organization A

- Encrypted Circle session reconnected after OTP and restored again after worker restart.
- Browser showed five chain wallets and all ten exact/Gateway rails ready.
- Browser payment ledger contains successful testnet exact and Gateway proof records for Base, Arbitrum, Polygon, Optimism, and Avalanche.
- A fresh browser `Run proof` action created a completed Base Gateway rail-verification provider job.

### QA organization B

- Browser revision flow edited, validated, and activated `QA deny weather requests` as policy version 2.
- Standalone MCP call for a weather HTTP request returned `deny`, `policy_denied`, and matched policy version 2.
- Non-weather request remained allowed in the earlier regression ledger.

### QA organization C

- Fresh Google user created one organization through the product UI.
- Circle OTP was completed through onboarding; the product synchronized one wallet across Base, Arbitrum, Polygon, Optimism, and Avalanche and created ten real sources.
- Direct API exact Base x402 paid `0.01 USDC`, delivered the resource, and produced transaction `0x11732fd02f8750fcfe03698ff2900b5622892b36c4d9421eebff79396fea67c1`.
- Standalone MCP Gateway Base x402 paid `0.001 USDC`, delivered the resource, and produced Gateway settlement `2569bdbb-8bcb-46dd-877c-fd650d021cbd`.
- Browser balances decreased by the corresponding `0.01` wallet and `0.001` Gateway amounts.

Source: Chrome onboarding and treasury pages plus sanitized API/MCP QA ledgers.

## Treasury Behavior

- Request-driven exact-wallet preparation, same-chain Gateway deposit preparation, and cross-chain wallet-to-Gateway preparation are implemented and worker-driven.
- Open liquidity jobs are idempotent by quote hash and destination; retries do not create duplicate open jobs.
- Preparation is deficit-aware: destination balance and target are persisted, and only the positive deficit is moved.
- Automated tests cover an exact wallet at `20.00 USDC` receiving only `0.10 USDC` for a `20.10 USDC` target and a partially funded Gateway preparation.
- The 24-hour demand view remains advisory. Scheduled autonomous optimization is intentionally deferred in `docs/features-to-discuss-later.md`; it is not represented as active automation.

Source: `apps/api/src/engines/payments/store.ts`, migration `0020_liquidity_job_idempotency.sql`, and `section-9-circle-treasury.test.ts`.

## Accepted Boundaries

- Product mode is testnet only; live mode is unavailable.
- Payment access is disabled per agent until an administrator enables it.
- Non-payment HTTP and tool policy checks are mediated when the agent uses AgentOps API/MCP; AgentOps cannot intercept arbitrary external traffic outside a managed surface.
- Scheduled demand-based treasury optimization is not part of this release.

## Hosted MCP Completion

- `./startup.sh --run-only` started and health-checked web `3005`, hosted MCP `8070`, API `8080`, and Circle worker `8090`; one `Ctrl+C` stopped all four listeners and a restart returned all four health checks to `200`.
- Chrome created `MCP Live Agent 2026-07-12` and its credentials through the authenticated `AgentOps QA Workspace` UI. No database or runtime API shortcut created the identity or secret.
- The one-time console verifier reached `http://127.0.0.1:8070/mcp`, completed four MCP requests with statuses `200`, `202`, `200`, and `200`, showed `Authenticated`, discovered all eight tools, and resolved contract `2026-07-12.1`.
- A real Claude Code 2.1.207 / Haiku 4.5 agent ran with built-in tools disabled and only the configured AOPS MCP tools available. `agentops.onboard` resolved the browser-created agent and `agentops.operation_check` returned `allow / no_matching_policy` for a synthetic read action. The harness made no direct runtime API call.
- Browser activity showed hash-backed `Runtime Onboarded` evidence for the exact tested connection.
- Browser rotation immediately made the protected stale Claude MCP config return exactly `MCP_UNAVAILABLE`; the replacement secret authenticated and discovered all eight tools.
- Browser revocation immediately made the previously valid replacement config return exactly `MCP_UNAVAILABLE` from a second real Claude attempt.
- All browser-issued credentials on the QA agent were revoked after evidence capture; no live test bearer was left behind.
- A 390 by 844 mobile emulation reported `documentWidth=390`, `bodyWidth=390`, and no page-level horizontal overflow. Screenshot: `/tmp/aops-mcp-mobile-390.png` (local QA artifact, not committed).
- Local integration hardening changed the advertised endpoint to the exact IPv4 listener, injects the same value into the web and MCP processes, and permits a private-network preflight only after exact host and origin validation.

No bearer credential, OAuth token, session cookie, or one-time secret is included in this evidence.
