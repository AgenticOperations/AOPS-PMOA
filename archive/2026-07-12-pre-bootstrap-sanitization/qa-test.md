# AgentOps End-to-End QA Checklist

Purpose: define the full browser-led QA scope before live execution. This checklist is grounded in the current API, web, MCP, and DB surfaces in `BUILD-PMOA`. After review, execute it in Chrome CDP on `http://localhost:3005`, using real browser actions for operator flows and real API/MCP calls for managed-agent flows.

Do not mark a feature passed from code inspection alone. A pass requires live browser or live endpoint evidence, with request/response details recorded separately during execution.

## Test Rig

- [ ] Start Redis with Docker and verify `redis-cli ping` returns `PONG`.
- [ ] Start API on `8080`; verify `GET /healthz` returns `ok: true` and `section: section_9`.
- [ ] Start web on `3005`; verify `/auth` returns `200`.
- [ ] Launch Chrome with CDP:
  ```bash
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --remote-debugging-port=9223 \
    --user-data-dir="$HOME/Library/Application Support/Google/Aops-Test" \
    http://localhost:3005
  ```
- [ ] Attach Chrome DevTools to CDP `9223`.
- [ ] Confirm browser network logging captures page requests and server-action navigations.
- [ ] Confirm no stale authenticated org state remains before clean-user onboarding unless intentionally testing existing-user flows.
- [ ] Confirm no manual DB shortcuts are used for happy-path product setup.
- [ ] During agent tests, mask credentials in logs as `conn_test_...last4` and never print full bearer tokens.

## Infrastructure And Data Integrity

- [ ] Migrations run automatically at API boot without error.
- [ ] Platform catalog data exists after clean DB setup:
  - [ ] `policy_action_registry` has management, operational, capability/payment actions.
  - [ ] `circle_chain_capabilities` has test/live capability rows for Base, Arbitrum, Polygon, Optimism, Avalanche.
- [ ] Redis cache does not block API health if temporarily unavailable, but works when running.
- [ ] Audit event hash chain remains verifiable after product actions:
  - [ ] `GET /v1/evidence/events`
  - [ ] `GET /v1/evidence/events/:eventId`
  - [ ] `GET /v1/evidence/events/:eventId/verify`
  - [ ] `GET /v1/evidence/chain/verify`

## Auth And Session

- [ ] `/auth` renders the Google sign-in entry state.
- [ ] Google OAuth start route redirects to Google:
  - [ ] `GET /api/auth/google/start`
  - [ ] API-backed authorize URL exists through `GET /v1/auth/google/authorize-url`.
- [ ] Google callback exchanges code and sets session cookie:
  - [ ] `GET /api/auth/google/callback`
  - [ ] API `POST /v1/auth/google/exchange`
- [ ] `GET /v1/auth/me` returns the signed-in user and org list.
- [ ] Logout works from web route and API:
  - [ ] `POST /api/auth/logout`
  - [ ] `POST /v1/auth/logout`
- [ ] Unauthenticated console page redirects to `/auth`.
- [ ] Authenticated user with no org lands in onboarding/org creation.

## Onboarding And Org Creation

- [ ] `/onboarding` renders for authenticated user without org.
- [ ] Create org from onboarding/auth flow.
- [ ] Duplicate-org guard: submitting org creation twice from the same Google user returns existing org, not a second org.
- [ ] Created org has:
  - [ ] active org record
  - [ ] unique slug
  - [ ] default team
  - [ ] owner membership for signed-in user
  - [ ] onboarding state rows available after setup actions
- [ ] Optional setup steps after org creation can be skipped from Settings without blocking product use.
- [ ] Org slug route `/app/{orgSlug}/overview` loads after creation.
- [ ] Invalid or unauthorized org slug redirects or blocks access cleanly.

## Console Shell And Navigation

- [ ] Sidebar navigation opens every route without 404/app error:
  - [ ] Overview
  - [ ] Agents
  - [ ] Controls
  - [ ] Operations
  - [ ] Payments overview
  - [ ] Payments sources/rails
  - [ ] Payments agent access
  - [ ] Payments liquidity
  - [ ] Payments activity
  - [ ] Approvals
  - [ ] Settings
- [ ] Active nav state matches current route, including nested Payments routes.
- [ ] Command palette opens and navigates to major console routes.
- [ ] Theme toggle works without layout/runtime errors.
- [ ] Global shell never shows mock-only data as real product state.

## Overview Page

- [ ] Overview loads with current org, agents, policy library, payment rail readiness, recent activity/audit summary, and setup state.
- [ ] Empty-state overview is coherent for a brand-new org.
- [ ] After creating agents, credentials, policies, payment access, and payments, overview reflects those changes.
- [ ] Overview links route to the relevant section pages.
- [ ] No hardcoded test organization or stale counts appear after clean org setup.

## Workspace Settings

### Members

- [ ] Settings `Members` tab lists current owner membership.
- [ ] Add member by email/name/role.
- [ ] Change member role across supported roles: owner/admin/operator/auditor/viewer/member where allowed.
- [ ] Remove member and verify status becomes removed/inactive in UI/API.
- [ ] RBAC negative path: lower-privilege member cannot perform admin-only member changes.
- [ ] Duplicate member add is handled without corrupting memberships.

### Teams

- [ ] Settings `Teams` tab lists default team.
- [ ] Create a custom team.
- [ ] Update team name and description.
- [ ] Archive custom team.
- [ ] Default team archive is disabled or rejected.
- [ ] Archived team is not available for new active agent assignment unless intended.

### Org Profile And Setup Checklist

- [ ] Org profile shows name, slug, status, and default team id.
- [ ] Setup checklist reflects onboarding states.
- [ ] Skip optional steps records completed/skipped state and updates Overview.

## Agents

### Agents List

- [ ] Empty state renders before first agent.
- [ ] Inline create form creates a new agent.
- [ ] Agents table shows name, id, team, status, credential state, policy coverage, last activity, and detail link.
- [ ] Multiple agents render without broken row height or duplicated IDs.

### Agent Detail: Overview

- [ ] Agent detail opens from list.
- [ ] Edit agent name, team, description, labels, and default environment.
- [ ] Pause agent, verify status and runtime behavior.
- [ ] Reactivate paused agent.
- [ ] Deactivate agent and verify runtime credential/policy/payment behavior is blocked or clearly handled.
- [ ] Agent overview shows direct and inherited operational/payment state accurately.

### Agent Detail: Credentials

- [ ] Create credential for agent.
- [ ] Secret is shown only once and masked in all later history/logs.
- [ ] Credential auth check succeeds with newly issued secret.
- [ ] Credential test works and does not create noisy audit history if test events are intentionally excluded.
- [ ] Rotate credential:
  - [ ] new secret returned once
  - [ ] old secret rejected
  - [ ] new secret accepted
- [ ] Revoke credential:
  - [ ] credential status updates
  - [ ] revoked secret rejected by runtime API and MCP
- [ ] Credential audit/activity identifies credential by safe name/id, never secret value.

### Agent Detail: Wallet References

- [ ] Attach wallet reference with provider, external wallet id/address/chain/label.
- [ ] Wallet reference appears on agent detail.
- [ ] Detach wallet reference.
- [ ] Detached wallet reference no longer appears as active.
- [ ] Wallet reference actions are not shown as treasury creation if wallet/treasury is not implemented for that path.

### Agent Detail: Policies And Access

- [ ] Agent shows directly attached policies.
- [ ] Agent shows inherited org/team/credential policies read-only where applicable.
- [ ] Attach active policy to agent from agent-local UI.
- [ ] Remove direct policy binding from agent.
- [ ] Effective policy list updates after attach/remove/revision/archive.

### Agent Detail: Activity

- [ ] Live activity tab shows runtime agent actions recorded through API/MCP.
- [ ] Activity includes policy decisions, operation records, payment events, and credential/config changes relevant to that agent.
- [ ] Activity filters or sections separate configuration audit from runtime/live agent stream where implemented.
- [ ] New agent MCP/API calls appear without page reload where live update exists, or after refresh where server-rendered.

## Policy Controls

### Policy Library

- [ ] Controls page lists policy drafts, active policies, archived policies, simulations, and control audit relevant to policies only.
- [ ] Policy action metadata is backend-owned and action-specific.
- [ ] Policy library does not show irrelevant global decision stream as the primary control history.
- [ ] Search/filter policy list by status/action/name if implemented.
- [ ] Archived policy shows archived state and does not show active-only `Archive` action.

### Draft Creation

- [ ] Create draft for `runtime.http.request` with resource category/domain conditions.
- [ ] Create draft for `payment.x402.authorize` with payment amount/asset and resource conditions.
- [ ] Create draft for `tool.call` with tool name condition.
- [ ] Create draft for management actions:
  - [ ] `management.agent.create`
  - [ ] `management.agent.pause`
  - [ ] `management.agent.activate`
  - [ ] `management.agent.deactivate`
  - [ ] `management.connection.issue`
  - [ ] `management.connection.rotate`
  - [ ] `management.connection.revoke`
- [ ] Action-specific form hides incompatible fields.
- [ ] Comma/list inputs parse as lists where supported, not one literal comma string.
- [ ] Invalid/incompatible condition combinations are rejected with visible errors.
- [ ] Draft creation has no enforcement until activation and binding.

### Draft Lifecycle

- [ ] Update draft name/description/category where supported.
- [ ] Validate draft successfully.
- [ ] Invalid draft validation produces readable error and no activation.
- [ ] Simulate draft against org/team/agent/connection target.
- [ ] Simulation stores dry-run result without creating runtime policy decision.
- [ ] Discard draft requires/receives intended confirmation behavior and removes it from active drafting list.
- [ ] Activate new draft creates policy v1 and active version.

### Policy Versioning And Revision Lifecycle

- [ ] Create revision draft from active policy.
- [ ] Activate revision:
  - [ ] creates new immutable version
  - [ ] supersedes old active version
  - [ ] migrates active bindings to new version atomically
  - [ ] old version no longer enforces
  - [ ] audit records version change
- [ ] Create restore draft from archived policy.
- [ ] Restore draft does not silently reattach stale bindings unless explicitly selected.
- [ ] Direct legacy version creation, if still exposed, does not break one-active-version invariant.

### Binding And Archive

- [ ] Bind policy to org.
- [ ] Bind policy to team.
- [ ] Bind policy to agent.
- [ ] Bind policy to credential/connection where action metadata allows it.
- [ ] Invalid target type or nonexistent target is rejected.
- [ ] Remove policy binding and verify enforcement stops for that direct binding.
- [ ] Archive active policy:
  - [ ] removes/stops active assignments
  - [ ] stops enforcement
  - [ ] records audit event
  - [ ] blocks repeat archive or shows correct restore/revision action
- [ ] Delete is not exposed for active/archived policies if product preserves audit history.

### Policy Enforcement Scenarios

- [ ] Deny weather HTTP API request for attached agent.
- [ ] Allow non-weather HTTP request.
- [ ] Natural-language intent normalizes to runtime HTTP request and is denied/allowed as expected.
- [ ] Require approval for paid market data x402 above threshold.
- [ ] Allow paid market data x402 below threshold.
- [ ] Observe browser search tool call and record activity without blocking.
- [ ] Deny/observe management credential issue/rotate/revoke according to attached policies.
- [ ] Conflicting policies resolve deterministically with denied/approval/observe precedence.
- [ ] Policy enforcement respects org/team/agent/connection binding scope.
- [ ] Check each and every kind of policy is created and tested with a running agent, all policies are attached to an agent ans tested to work properly.

## Operations

### Tool Catalog

- [ ] Operations page lists imported tools.
- [ ] Import tool with name/display name/category/risk/description.
- [ ] Update tool display name/category/risk/description.
- [ ] Archive tool and verify it no longer behaves as active.
- [ ] Duplicate tool import is handled cleanly.

### Rate Limits

- [ ] Create operation rate limit for agent, action, optional bucket, limit, and window.
- [ ] List existing rate limits with utilization/counters.
- [ ] Update rate limit bucket/limit/window/status.
- [ ] Disable rate limit.
- [ ] Runtime operation checks respect the active rate limit.
- [ ] Disabled rate limit no longer blocks.
- [ ] Rate-limit counters reset after window or show expected utilization.

### Operational Decisions And Sessions

- [ ] Org operation check endpoint records/returns allow/deny/rate_limited as expected.
- [ ] Runtime operation check with valid credential works.
- [ ] Runtime operation record writes operation activity.
- [ ] Blocked operations list includes denied/rate-limited actions.
- [ ] Decisions history filters by agent/action/decision.
- [ ] MCP sessions list reflects runtime/MCP usage if implemented.
- [ ] Agent allowed-actions endpoint reflects current policies and operations controls.

## Approvals

- [ ] Approvals page shows Inbox and History tabs.
- [ ] Runtime policy check creates approval request when policy decision is `approval_required`.
- [ ] Pending approval shows action, agent, decision id, target, expiry, context, context hash.
- [ ] Approve approval with note.
- [ ] Deny approval with note.
- [ ] Approved approval can be consumed once by the same agent/connection.
- [ ] Second consume fails.
- [ ] Wrong agent/connection cannot view or consume approval.
- [ ] Expired approval renders as expired and has no approve/deny controls.
- [ ] History shows requested/approved/denied/expired/consumed action timeline.
- [ ] Consumption proof appears after consume.
- [ ] Filters and pagination work for approval status/action/agent.

## Payments And Treasury

### Provider Mode And Health

- [ ] Payments overview loads for clean org without mock data.
- [ ] Provider mode defaults to test mode for testnet QA.
- [ ] Toggle provider mode test/live:
  - [ ] test mode works
  - [ ] live mode is blocked or clearly requires production credentials
  - [ ] no accidental mainnet movement occurs during testnet QA
- [ ] Provider health shows Circle configuration status.

### Circle Treasury Setup

- [ ] Create Circle treasury for org.
- [ ] OTP flow is handled by pausing and requesting OTP for the designated QA account when Circle requires it.
- [ ] Circle wallet set is created or reused idempotently.
- [ ] Five chain wallets exist for Base, Arbitrum, Polygon, Optimism, Avalanche.
- [ ] Wallet records show correct mode, chain, address, account type, status, and external wallet id.
- [ ] Re-running treasury setup does not duplicate wallet sets or wallets.

### Sources And Rails

- [ ] Sources page lists payment sources.
- [ ] Create payment source for Gateway rail.
- [ ] Create payment source for exact rail.
- [ ] Manual/simulation providers are not presented as real live testnet sources unless intentionally supported.
- [ ] Rail capabilities show all five chains and both rail families:
  - [ ] `gateway_base`
  - [ ] `gateway_arbitrum`
  - [ ] `gateway_polygon`
  - [ ] `gateway_optimism`
  - [ ] `gateway_avalanche`
  - [ ] `exact_base`
  - [ ] `exact_arbitrum`
  - [ ] `exact_polygon`
  - [ ] `exact_optimism`
  - [ ] `exact_avalanche`
- [ ] Verify a single rail.
- [ ] Verify all unverified rails.
- [ ] Rail verification jobs progress through queued/submitted/complete or clear failed/blocked state.
- [ ] Completed rail proof exposes useful evidence in UI/API: job id, chain, rail, amount, tx/result metadata where available.

### Funding And Balances

- [ ] Request testnet funds for selected chains.
- [ ] Faucet jobs are created and visible.
- [ ] Circle balances refresh after faucet/top-up/deposit.
- [ ] Gateway deposit from chain wallet into Gateway bucket works for supported chains.
- [ ] Gateway balances are read through the same Circle path used for deposit/payment, not misleading raw SCA-only bucket.
- [ ] Balance cache via Redis updates without stale UI state.

### Agent Payment Access

- [ ] Agent payment access defaults disabled.
- [ ] Enable payment access for selected agent.
- [ ] Configure budget, per-request cap, approval threshold, and allowed rails.
- [ ] Disable payment access.
- [ ] Disabled payment agent cannot call payment runtime/MCP endpoint.
- [ ] Per-request cap rejects oversized x402 request.
- [ ] Budget rejects request exceeding available budget.
- [ ] Approval threshold creates approval request.
- [ ] Allowed rails restrict route choice.

### Liquidity And Rebalancing

- [ ] Liquidity page lists recommendations.
- [ ] Bridge/top-up exact wallet from source chain to destination chain.
- [ ] Liquidity prepare jobs are created when exact/Gateway bucket is underfunded.
- [ ] Reconcile Circle provider jobs changes stale submitted/queued jobs to complete/failed based on real balances/timeouts.
- [ ] Retry failed liquidity job.
- [ ] Cancel queued/submitted liquidity job where allowed.
- [ ] Completed/failed jobs do not show invalid actions.
- [ ] Multiple Arbitrum exact requests can trigger or consume prepared Arbitrum wallet liquidity.
- [ ] Gateway rail request on non-Base chain prepares chain-local Gateway liquidity before payment.
- [ ] If Gateway liquidity is propagating, runtime/MCP returns a clear `liquidity_preparing` response, not false success.

### x402 Payments

- [ ] Testnet exact x402 endpoint works for Base.
- [ ] Testnet exact x402 endpoint works for Arbitrum.
- [ ] Testnet exact x402 endpoint works for Polygon.
- [ ] Testnet exact x402 endpoint works for Optimism.
- [ ] Testnet exact x402 endpoint works for Avalanche.
- [ ] Testnet Gateway x402 endpoint works for Base.
- [ ] Testnet Gateway x402 endpoint works for Arbitrum.
- [ ] Testnet Gateway x402 endpoint works for Polygon.
- [ ] Testnet Gateway x402 endpoint works for Optimism.
- [ ] Testnet Gateway x402 endpoint works for Avalanche.
- [ ] Runtime endpoint `/v1/runtime/payments/x402` handles accepted payment offers and chooses valid rail.
- [ ] Unsupported scheme/network/asset is rejected with route observation.
- [ ] Missing/ambiguous payment facts return actionable failure, not fake success.
- [ ] Payment events ledger records submitted/settled/failed with rail, chain, agent, amount, quote, result.
- [ ] Route observations record accepted/rejected routes with reasons.
- [ ] Reservations are created/settled/released/failed correctly.
- [ ] Payment activity page shows ledger, route observations, reservations, provider jobs, and payment audit.

## Runtime API As Managed Agent

Use a freshly created agent credential unless testing revoked/invalid credentials.

- [ ] Runtime API without authorization returns `401 invalid_connection`.
- [ ] Runtime API with invalid credential returns `401 invalid_connection`.
- [ ] Runtime onboard with valid credential returns agent, org, connection, contract version, and available actions.
- [ ] Runtime policy check supports structured action/context input.
- [ ] Runtime policy check supports natural-language intent normalization.
- [ ] Runtime activity record appears on agent detail activity.
- [ ] Runtime approval status works for same agent/connection.
- [ ] Runtime approval consume works once for matching decision id.
- [ ] Runtime operations check works with valid credential.
- [ ] Runtime operations record writes activity.
- [ ] Runtime payment x402 respects payment access, policies, budgets, approvals, rails, and liquidity.
- [ ] Paused/deactivated/revoked agent/connection is rejected across runtime endpoints.

## MCP As Managed Agent

Run MCP via:

```bash
AGENTOPS_API_BASE_URL=http://localhost:8080 \
AGENTOPS_MCP_CREDENTIAL=<masked-agent-credential> \
AGENTOPS_MCP_TIMEOUT_MS=10000 \
npm --workspace @agentops-pmoa/mcp run dev
```

- [ ] Missing MCP credential fails safely.
- [ ] Invalid MCP credential returns tool error, not process crash.
- [ ] `listTools()` returns:
  - [ ] `agentops.onboard`
  - [ ] `agentops.policy_check`
  - [ ] `agentops.payment_x402`
  - [ ] `agentops.approval_status`
  - [ ] `agentops.approval_consume`
  - [ ] `agentops.activity_record`
  - [ ] `agentops.operation_check`
  - [ ] `agentops.operation_record`
- [ ] `agentops.onboard` matches runtime API onboard.
- [ ] `agentops.policy_check` matches direct runtime API decisions.
- [ ] `agentops.operation_check` matches direct runtime operations checks.
- [ ] `agentops.operation_record` appears in agent activity.
- [ ] `agentops.activity_record` appears in agent activity.
- [ ] `agentops.payment_x402` executes allowed x402 and returns same rail/payment outcome as direct API.
- [ ] `agentops.payment_x402` returns safe `liquidity_preparing` when prep is pending.
- [ ] `agentops.approval_status` works for a fresh approval.
- [ ] `agentops.approval_consume` consumes once and rejects second consume.
- [ ] Invalid tool input returns `isError: true` with validation message.

## Rogue Agent And Abuse Scenarios

- [ ] Rogue agent attempts runtime check without credential.
- [ ] Rogue agent uses revoked credential.
- [ ] Rogue agent uses another agent's approval id.
- [ ] Rogue agent tries payment while payment access disabled.
- [ ] Rogue agent requests unsupported rail/network/asset.
- [ ] Rogue agent exceeds per-request cap.
- [ ] Rogue agent exceeds budget.
- [ ] Rogue agent calls denied weather API under deny policy.
- [ ] Rogue agent spams operation calls until rate limited.
- [ ] Rogue agent attempts management operation it should not perform.
- [ ] Rogue agent sends malformed x402 accepts payload.
- [ ] Rogue agent sends false resource category/domain to bypass policy; verify route/policy behavior is at least audited and does not silently grant protected treasury movement.

## Cross-Page Consistency

- [ ] Creating an agent updates Overview, Agents, Settings/team counts where relevant.
- [ ] Creating a credential updates Agents list health and Agent detail credentials.
- [ ] Attaching/removing policy updates Controls and Agent detail effective policies.
- [ ] Runtime denied/observed decisions update Agent activity and relevant Operations/Controls history surfaces.
- [ ] Payment access changes update Payments overview and Agent detail.
- [ ] Payments update Payments overview, Activity ledger, Agent activity, and audit.
- [ ] Approval lifecycle updates Approvals, Agent activity, and runtime consume behavior.
- [ ] Archived/disabled/deactivated entities no longer appear as active targets in forms.

## Browser UX And Error Handling During QA

- [ ] Every visible button/form has a backend-backed action or is removed/disabled.
- [ ] No placeholder-only controls remain.
- [ ] Required fields validate before or at submit with readable error.
- [ ] Server-action failures are visible to the operator where implemented; otherwise log as UX bug.
- [ ] Long-running Circle/payment operations show queued/submitted state.
- [ ] Refreshing after long-running jobs does not lose progress.
- [ ] Empty states are accurate for clean org.
- [ ] Tables/lists handle multiple records without layout failure.
- [ ] No network 4xx/5xx occurs during happy path except intentionally tested negative cases.

## Evidence To Record During Execution

For every executed test case, record:

- [ ] Test id.
- [ ] Surface: browser, API, MCP, or DB-read-only verification.
- [ ] Purpose.
- [ ] Sanitized request/action.
- [ ] Sanitized response/result.
- [ ] Browser URL and visible UI state.
- [ ] Pass/fail.
- [ ] Bug link or fix summary if failed and fixed.

## Pause Conditions

Pause and ask the user when:

- [ ] Google/Circle OTP is required for the designated QA account.
- [ ] Testnet faucet funds are exhausted or chain balance cannot be recovered.
- [ ] Circle provider returns an external-system blocker that cannot be fixed in product code.
- [ ] A bug appears architectural or too large to fix inline without changing accepted scope.
- [ ] The checklist needs product-scope revision before execution.
