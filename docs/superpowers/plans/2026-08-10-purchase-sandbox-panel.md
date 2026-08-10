# Purchase Sandbox Panel Implementation Plan

> **For Claude:** Execute in this session — user asked to plan and do. Targeted v1 only.

**Goal:** On Purchases, opening a hired agent/service shows a side panel with endpoint metadata plus sample / delivered JSON so buyers can see what data they get.

**Architecture:** Reuse existing Sheet drawer pattern from Activity. Add a static sample catalog for demo fleet services. Persist a bounded response body on new Permit2 fleet payment events so the panel can show real delivered payloads. No OpenAPI publisher flow in v1.

**Tech Stack:** Next.js client components, existing Sheet UI, Vitest.

---

### Task 1: Sample catalog + body persistence

**Files:**
- Create: `apps/web/src/lib/marketplace-service-samples.ts`
- Modify: `apps/api/src/engines/payments/intra-fleet.ts` (store bounded `fulfillment.body`)

- [ ] **Step 1:** Port DataFetcher / Analyst / Writer / SeniorReviewer / weather sample JSON keyed by seed listing id + name/path fallbacks
- [ ] **Step 2:** When recording intra-fleet payment events, include truncated fulfillment body (≤4KB JSON)

### Task 2: Purchase sandbox Sheet UI

**Files:**
- Create: `apps/web/src/components/marketplace/PurchaseSandboxPanel.tsx`
- Modify: `apps/web/src/components/marketplace/PurchasedMarketplaceView.tsx`
- Modify: `apps/web/src/app/globals.css` (sandbox panel styles)
- Test: `apps/web/tests/marketplace/purchased-marketplace-view.test.tsx`

- [ ] **Step 1:** Make purchase rows open a Sheet with listing meta, endpoint, Sample / Delivered tabs, JSON viewer
- [ ] **Step 2:** Extend vitest to open a row and assert sample JSON appears for a known listing

### Task 3: Verify

- [ ] **Step 1:** Run marketplace vitest; fix regressions
