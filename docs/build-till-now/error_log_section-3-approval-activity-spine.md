---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [section-3, error-log, approvals, activity]
---

# Error Log - Section 3 Approval and Activity Spine

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-3-approval-activity-spine]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]]

| Issue | Cause | Fix | Status | Prevention |
|---|---|---|---|---|
| Approval inbox initially showed real records but no review action | The first UI pass exposed the data route before wiring human actions | Added approve and deny server actions and buttons for pending approvals | Fixed | Any real operational object shown in the UI needs its primary action if the backend already supports it |
| Approval consumption could become stale if policy changed after approval | One-time approvals are created before final execution | Added final policy recheck during consumption and block if the current policy now denies | Fixed | Runtime approvals must always be checked against current policy before consumption |
| Activity and audit could blur together | Both record operational events, but they serve different users | Kept activity as product feed and audit events as canonical evidence | Fixed | Treat activity as queryable UX feed; treat audit as evidence |
| Approval inbox did not show enough request context | The page rendered action, agent, and decision only, while backend stored full context | Added target, context hash, and concise resource/payment/tool context rows | Fixed | Human approval screens must show the facts being approved |
| Approval note from web actions was dropped | Web client sent `reason` while the API accepted `note` | Changed approval client payloads to send `note` | Fixed | Keep BFF payload names aligned with backend schemas |
