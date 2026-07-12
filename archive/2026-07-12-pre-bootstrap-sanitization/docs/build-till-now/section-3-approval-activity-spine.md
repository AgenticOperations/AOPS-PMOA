---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [section-3, approvals, activity, audit, build-history]
---

# Section 3 - Approval and Activity Spine

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-2-policy-decision-core]]

## What Was Built

Section 3 turns `approval_required` policy decisions into real reviewable objects instead of dead-end decisions.

Backend:

- Added `approval_requests`, `approval_actions`, `approval_consumptions`, and `activity_items`.
- Added approval creation from runtime policy checks.
- Added human approval and denial endpoints.
- Added one-time approval consumption for runtime agents.
- Added final policy recheck during approval consumption so an old approval cannot bypass a stricter policy added later.
- Added a canonical activity stream for runtime checks, approval requests, and integration events.

Frontend:

- Added `/app/[orgSlug]/approvals`.
- Added Approvals to the console sidebar.
- Added a real approval inbox populated only from backend approval records.
- Added approve and deny actions for pending approvals.
- Added concise request context to each approval row: target, context hash, and available resource/payment/tool facts.

## Why It Was Built This Way

Approval is a separate object from policy. Policy says a request needs review; approval records the human decision for one specific request context.

Approvals are one-time consumable. This prevents an agent from reusing one approval for repeated calls. Consumption checks the same agent, credential, decision ID, and current policy state.

Activity is separate from the immutable audit stream. The audit stream remains canonical evidence; activity is the operational feed shown in product surfaces.

## Backend Boundary

Built now:

- `GET /v1/orgs/:orgId/approvals`
- `GET /v1/orgs/:orgId/approvals/:approvalId`
- `POST /v1/orgs/:orgId/approvals/:approvalId/approve`
- `POST /v1/orgs/:orgId/approvals/:approvalId/deny`
- Approval creation from runtime checks.
- Approval consumption from runtime/MCP integration surfaces.
- Activity recording for runtime and integration actions.

Deferred:

- Approval assignment, escalation, expiry sweeps, and notifications.
- Approval comments beyond the current reason string.
- Bulk approval workflows.
- Recovery and break-glass controls.

## Frontend Boundary

Built now:

- Approval inbox.
- Pending approval approve/deny buttons.
- Status, timestamp, target, context hash, and request context display.

Deferred:

- Detail drawer with full raw request context and decision trace.
- Filters by agent/action/status.
- Notification delivery.

## Verification

Commands passed:

- `npm --workspace @agentops-pmoa/api test -- test/runtime/runtime-integration.test.ts`
- `npm --workspace @agentops-pmoa/api test`
- `npm --workspace @agentops-pmoa/web test`
- `npm --workspace @agentops-pmoa/db test`
- `npm --workspace @agentops-pmoa/api run typecheck`
- `npm --workspace @agentops-pmoa/web run typecheck`
- `npm run verify`

## What Remains For Later Sections

The approval spine can support payment approvals, tool approvals, wallet approvals, and marketplace approvals later. No fake wallet or payment execution was added in this section.
