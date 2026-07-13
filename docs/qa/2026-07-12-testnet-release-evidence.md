---
created: 2026-07-12
updated: 2026-07-13
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

## Real-Agent Policy Matrix — 2026-07-13

A second browser-authored test identity, `Hosted Policy Matrix Agent 2026-07-13` (`agt_ee020502-1b8b-4b3e-a856-df0016551186`), was used to exercise the hosted MCP contract beyond the basic allow path. Claude Code `2.1.207` with `claude-haiku-4-5-20251001` ran with built-in tools disabled, strict MCP configuration, and only `mcp__agentops__*` allowed. The agent did not receive an HTTP, shell, or direct runtime API tool.

| Scenario | Result | Evidence |
|---|---|---|
| Default operation | Allow | `pdec_6514a9ed-fee8-4f27-9ef3-e54d981605a2`, `no_matching_policy` |
| Observed HTTP policy | Observe | `pdec_623f7f51-e86e-4cb6-98e1-4518224383c9` |
| Denied HTTP policy | Deny | `pdec_86ad6198-741b-450b-a9f6-4bf3380ad01c`, `policy_denied` |
| Incomplete tool context | Needs more info | Required `tool.name` without creating an operation |
| Rate limit | First allow, second blocked | `opdec_3637a28b-ed8e-45a5-a044-5939e20c864d`, then `opdec_87275a95-ac69-4283-9a70-f0c9d53f184a` / `operation_rate_limited` |
| Tool approval | Approved and consumed once | `apv_8167ac3d-5bdc-420d-96fa-28e8241e6065`, `apcons_f8fcb054-fe3a-4733-8ac8-3ebc3837596c`; repeat consumption failed closed |
| Tool denial | Denied and not consumable | `apv_778b53d8-5563-41d3-889f-7a389e1c7858`; consumption returned `Approval must be approved before it can be consumed.` |
| Payment access disabled | Blocked | `Payment access is disabled for this agent` |
| Payment policy | Deny | `pdec_d1c5176b-8a75-44ca-a6da-f6ed1e3ad6c1`, `policy_denied` |
| Disallowed rail | Blocked | `payment_rail_not_allowed` |
| Per-request cap | Blocked | `Payment amount exceeds the agent per-request cap.` |
| Monthly budget | Blocked | `Payment amount exceeds the agent budget.` |
| Approval threshold | Approval required | `apv_3618bdc1-c08a-4669-9117-357bc488e334`, `pdec_9ea58d9e-0cef-4079-858d-ad146230e829` |
| Approved x402 retry | Delivered | `payevt_1214265e-621b-4bdb-a4f8-7cfb34cd5218`, `0.001 USDC`, Gateway Base Sepolia, provider mode `test` |
| Payment approval consumption | Consumed | `apcons_a6851923-0085-4976-8952-c06318753718` |

The final x402 fulfillment used reservation `payres_8d2e5145-501f-4fb7-8198-5d491edb4a96`, source `paysrc_c1af1e7c-7421-40b3-8686-61286852a289`, network `eip155:84532`, and provider reference `bbd17811-83a4-4a07-80de-3bfea718712b`. The authenticated browser independently showed the payment as `Delivered`, the approval as `consumed`, the denied approval as `denied`, and the second rate-limited operation as `Rate limited`.

The real client exposed one integration defect: `policy_requires_approval` was returned with MCP `isError=true`, causing Claude to lose the structured `approvalId` and `decisionId` needed to continue the approval lifecycle. `apps/mcp/src/tools.ts` now treats that expected governance outcome as a successful structured MCP result while preserving the runtime error code and details. The regression test in `apps/mcp/test/tools.test.ts` was observed failing before the implementation change and passing after it.

Fresh post-fix `npm run verify` passed lint, typecheck, all production builds, bootstrap `14/14`, config/contracts `2/2`, database `6/6`, API `196/196`, MCP `183/183`, and web `243/243`. Browser cleanup then disabled payment access and the temporary rate limit, revoked connection `conn_887f290c-d81b-427a-ba64-c5b113aa23b2`, detached and archived the four temporary policies, discarded the duplicate draft, and deactivated the test identity. A final strict Claude retry received no AgentOps tools after revocation, so it could not issue another managed call.

Source: real Claude stream-json sessions, the authenticated AgentOps Chrome session, and the fresh local `npm run verify` output captured on 2026-07-13.
