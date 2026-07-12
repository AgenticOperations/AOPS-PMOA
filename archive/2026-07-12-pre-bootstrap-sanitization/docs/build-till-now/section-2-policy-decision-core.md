---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [section-2, policy, controls, decision-core, build-history]
---

# Section 2 - Policy Decision Core

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]] | [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/42-build-execution-operating-model]]

## What Was Built

Section 2 adds the first real authorization layer above Section 1 identity and credentials.
It now supports both management actions and the first runtime action shapes needed by Sections 3 and 4.

Backend:

- Added migration `0006_policy_decision_core.sql`.
- Added `policy_action_registry` seeded with enforceable Section 1 management actions and the runtime action contracts used by Sections 3 and 4.
- Added `policy_drafts`, `policy_versions`, `policy_bindings`, `policy_decisions`, and `policy_simulations`.
- Added a deterministic decision engine with statement matching by action, actor role, target type, target ID, wildcard actions, and structured runtime conditions.
- Added structured conditions for resource category/domain, payment amount/asset/network/recipient, and tool name/risk level.
- Added restrictive precedence: `deny` beats `approval_required`, which beats `observe`, which beats `allow`.
- Added policy validation against the action registry so unknown actions cannot activate.
- Added validation for condition objects, including numeric payment bounds, action-compatible condition groups, and non-empty condition groups.
- Added binding target existence checks for workspace, team, agent, and credential bindings.
- Added policy routes for draft create, validate, activate, bind, library listing, and decision checks.
- Added canonical policy audit events: `policy.draft.created`, `policy.validated`, `policy.activated`, `policy.bound`, and `policy.decision.recorded`.
- Wired real enforcement into Section 1 agent and credential management actions. Active policies can now block agent create/pause/activate/deactivate and credential issue/rotate/revoke.

Frontend:

- Added `/app/[orgSlug]/controls`.
- Added Controls to the console sidebar as a real Section 2 route.
- Added an action-aware policy draft builder. It only shows condition fields that belong to the selected action surface.
- Draft creation stays global and reusable. Attachment happens later through bindings.
- Added draft review list with validate and activate actions.
- Added active policy library with binding form for real workspace/team/agent/credential targets.
- Added list parsing so comma-separated policy inputs become real arrays, not one literal string.
- Added web policy client and server actions.
- Kept the UI scoped to policy core only. No payment, treasury, marketplace, MCP, wallet, or approval placeholders were added.

## Why It Was Built This Way

Policies are backend-owned structured objects, not README or prompt files. A visible policy only matters if it can be evaluated and enforced by the product.

The first enforceable surface was Section 1 management. The runtime action shapes were then added only after Section 4 added real direct API and MCP entry points that can call the decision engine.

Policy self-management is not automatically enforced yet. Blocking policy creation or activation before recovery controls exist can lock an org out of its own controls. The registry includes policy management actions so the model is ready, but automatic gating of those routes needs recovery/break-glass design.

## Backend Boundary

Built now:

- `GET /v1/orgs/:orgId/policies`
- `POST /v1/orgs/:orgId/policy-drafts`
- `POST /v1/orgs/:orgId/policy-drafts/:draftId/validate`
- `POST /v1/orgs/:orgId/policy-drafts/:draftId/activate`
- `POST /v1/orgs/:orgId/policies/:policyId/bindings`
- `POST /v1/orgs/:orgId/policy-decisions/check`
- Enforcement hooks for Section 1 agent and credential management actions.
- Runtime condition matching for `runtime.http.request`, `payment.x402.authorize`, and `tool.call`.
- Backend rejection for incompatible policy shapes, such as tool conditions on HTTP request policies.
- Backend rejection for policy bindings that reference nonexistent org objects.

Deferred:

- Policy edit/version increment beyond first activation.
- Policy archive/remove-binding UI.
- Natural-language-to-policy assistant.
- Wallet/payment signing, treasury, marketplace, and job-flow enforcement.
- Policy recovery/break-glass controls.

## Frontend Boundary

Built now:

- Controls route and sidebar navigation.
- Action-aware policy draft builder:
  - HTTP/API request policies expose resource fields.
  - x402 authorization policies expose resource and payment fields.
  - tool call policies expose tool fields.
  - management policies expose no runtime condition fields.
- Draft validate/activate controls.
- Active policy list.
- Policy binding form with actual workspace/team/agent/credential targets.
- Policy preview text describing the decision, action, and relevant conditions before draft creation.

Deferred:

- Visual policy graph/builder.
- AI policy drafting.
- Request-derived policy suggestions.
- Policy edit/version increment UI.

## Verification

Commands passed after the Section 2-4 implementation:

- `npm --workspace @agentops-pmoa/api run test -- test/policy/decision-engine.test.ts`
- `npm --workspace @agentops-pmoa/db run test -- test/migrate.test.ts`
- `npm --workspace @agentops-pmoa/api run test -- test/policy/policy-routes.test.ts`
- `npm --workspace @agentops-pmoa/web run test -- tests/console-shell.test.tsx tests/controls/controls-library.test.tsx`
- `npm run typecheck`
- `npm run verify`

Final verification result:

- Full workspace tests: PASS.
- API tests: 16 files, 45 tests passed.
- Web tests: 8 files, 25 tests passed.
- MCP tests: 2 files, 5 tests passed.
- DB tests: 2 files, 6 tests passed.
- Config tests: 1 file, 1 test passed.
- Contracts tests: 1 file, 1 test passed.

## What Remains For Later Sections

Section 3 added approval requests and human gates for `approval_required` decisions.

Section 4 added direct runtime API and MCP entry points that can evaluate the runtime actions.

The finance/payment sections still need wallet/payment signing before x402 checks become hard payment enforcement.

The dashboard section can later turn policy decisions into request-derived suggestions such as "make a policy around this repeated request."
