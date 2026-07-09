---
created: 2026-07-08
project: agentOps
ecosystem: circle
tags: [section-6, section-7, section-8, error-log, payments, gateway]
---

# Error Log - Sections 6-8 Base Gateway Payment Control

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-6-8-base-gateway-payment-control]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]]

| Issue | Cause | Fix | Status | Prevention |
|---|---|---|---|---|
| API payment integration test could not reach RED application failure through Testcontainers | Testcontainers could not find a working container runtime strategy in this shell, even though Docker Desktop was running | Started a disposable Postgres container directly and ran the same test through the existing `TEST_DATABASE_URL` helper path | Fixed with local workaround | If Testcontainers discovery fails, verify with `TEST_DATABASE_URL` rather than skipping DB-backed tests |
| Payment test initially failed with missing `agent_payment_accounts` table | The API test imports migrations from the built DB package, and `@agentops-pmoa/db` had not been rebuilt after adding migration 0009 | Ran `npm --workspace @agentops-pmoa/db run build` so migration 0009 was copied into `dist` | Fixed | Rebuild the DB package before running API tests that import `@agentops-pmoa/db` |
| API health test returned 500 after marking health as `section_6_8` | The shared contracts health schema has individual section ids, not a combined `section_6_8` enum | Changed health marker to `section_8` because the combined 6-8 block is complete | Fixed | Keep health markers inside `packages/contracts` allowed section ids |
| Payments component test failed on duplicated balance and agent text | The values intentionally appear in both summary/table and row/select surfaces | Updated the test to assert the expected number of occurrences | Fixed | Use scoped or `getAllByText` queries when testing repeated operational values |
| Runtime x402 payment endpoint bypassed active `payment.x402.authorize` policies | Section 6-8 payment execution enforced access, rail, cap, budget, and balance, but did not call the Section 2 policy engine before inserting payment events | Added a policy gate before submission, returns approval metadata when approval is required, consumes matching approved approval proof, and links payment activity/audit to policy decisions | Fixed | Payment execution tests now include approval-required policy gating and hard-cap priority |
| MCP payment tool dropped approval metadata from payment errors | MCP runtime client preserved only status, code, and message from backend errors | Added structured error details to `RuntimeApiError` and MCP tool `structuredContent` | Fixed | MCP tests now assert `approvalId` and `decisionId` are returned for approval-gated payments |
| Payment approval policy ran before hard spend caps | Initial policy-gate placement allowed an over-cap payment to create an approval request instead of returning `per_request_cap_exceeded` | Moved policy evaluation after rail, per-request cap, budget, and source-balance safety checks | Fixed | Approval policy tests now assert hard caps win before approval flow |
| Product scope risk: treating all x402 exact requests as Gateway-payable | x402 payment requirements can depend on facilitator/payment-method verification, and Gateway-compatible requests need a supported Gateway payment method | Runtime payment endpoint accepts only Gateway-marked Base x402 requests and rejects exact-only Base requests with `unsupported_payment_rail` | Fixed | Add new rails only when the provider can create a payload the facilitator can verify |
| Product scope risk: making payment access implicit for every agent | Agent payment access is a safety-critical capability and should not be inferred from agent registration | Added per-agent payment accounts with `payment_access` off by default and an explicit access endpoint | Fixed | Future wallet/payment UI must keep default-off semantics |
| Product scope risk: showing fake wallet controls before wallet provider exists | Dedicated agent wallets need real Circle wallet creation/funding integration before they are actionable | Payments UI exposes only Gateway treasury/source/access setup for now | Fixed | UI should only expose configured, callable provider operations |
