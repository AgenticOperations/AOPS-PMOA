---
created: 2026-07-12
project: agentOps
ecosystem: circle
tags: [landing-page, redesign, scroll-story, implementation]
---

# AOPS Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/PRODUCT]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-1-core-product-spine]]

**Goal:** Replace only the public `/` route with the approved AOPS landing experience, including scroll-controlled product and five-chain stories, verified chain marks, corrected hero media treatment, and a full scroll-reveal footer.

**Architecture:** Keep the redesign route-local. `page.tsx` imports one landing stylesheet and composes focused landing components; client JavaScript is limited to navigation and the two scroll sequences. Auth, onboarding, console routes, server actions, APIs, shared UI components, and shared console CSS remain untouched.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 6, route-local CSS, Vitest, Testing Library, browser QA through Chrome DevTools.

---

## File structure and ownership

- Modify `apps/web/src/app/page.tsx`: public route composition and `/auth` entry links only.
- Create `apps/web/src/app/landing.css`: every landing selector scoped under `.aops-landing`.
- Create `apps/web/src/components/landing/LandingPage.tsx`: static narrative sections and overall composition.
- Create `apps/web/src/components/landing/LandingNavigation.tsx`: mobile navigation state only.
- Create `apps/web/src/components/landing/ControlStory.tsx`: Identify, Decide, Govern, Prove pinned sequence.
- Create `apps/web/src/components/landing/ChainStory.tsx`: Base, Arbitrum, Polygon, Optimism, Avalanche pinned sequence.
- Create `apps/web/src/components/landing/LandingFooter.tsx`: full-height reveal footer and canonical wordmark.
- Create `apps/web/src/components/landing/scroll-sequence.ts`: pure scroll-index calculation and reusable hook.
- Create `apps/web/public/landing/*`: canonical AOPS wordmark, corrected hero background, and five verified chain SVGs.
- Create `apps/web/tests/landing/landing-page.test.tsx`: public-route structure and landing-only invariants.
- Create `apps/web/tests/landing/scroll-sequence.test.ts`: scroll-step boundary coverage.
- Modify only the root-route assertion in `apps/web/tests/section-1-flow.test.tsx` so the existing public/auth boundary remains covered.

### Task 1: Protect the public-route contract

- [ ] **Step 1: Write the failing landing structure test**

```tsx
it('renders the complete public landing while keeping auth as the only product entry', async () => {
  render(await HomePage());
  expect(screen.getByRole('heading', { name: /Let agents act\. Keep authority\./i })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Request access/i })[0]).toHaveAttribute('href', '/auth');
  expect(screen.getByRole('tablist', { name: 'Control plane stages' })).toBeInTheDocument();
  expect(screen.getByRole('tablist', { name: 'Supported USDC chains' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Create organization/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm --workspace @agentops-pmoa/web test -- tests/landing/landing-page.test.tsx`

Expected: FAIL because the current public route contains only `agentOps` and `Get started`.

- [ ] **Step 3: Update the existing Section 1 root-route assertions**

Replace only the old landing heading/link expectations with the approved heading and `/auth` request-access link. Keep all auth, onboarding, and console assertions unchanged.

### Task 2: Implement and test deterministic scroll steps

- [ ] **Step 1: Write the failing pure-function tests**

```ts
expect(scrollStepForPosition({ top: 0, height: 4000, viewport: 1000, steps: 4 })).toBe(0);
expect(scrollStepForPosition({ top: -1100, height: 4000, viewport: 1000, steps: 4 })).toBe(1);
expect(scrollStepForPosition({ top: -2999, height: 4000, viewport: 1000, steps: 4 })).toBe(3);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm --workspace @agentops-pmoa/web test -- tests/landing/scroll-sequence.test.ts`

Expected: FAIL because `scrollStepForPosition` does not exist.

- [ ] **Step 3: Add the minimal calculation and hook**

```ts
export function scrollStepForPosition(input: ScrollStepInput): number {
  const travel = Math.max(1, input.height - input.viewport);
  const progress = Math.min(1, Math.max(0, -input.top / travel));
  return Math.min(input.steps - 1, Math.floor(progress * input.steps));
}
```

The hook reads its section rectangle in one requestAnimationFrame callback, listens passively to `scroll` and `resize`, and returns index zero when reduced motion is requested.

- [ ] **Step 4: Run the test and verify GREEN**

Run the same focused test; expected: PASS.

### Task 3: Build the approved landing composition

- [ ] **Step 1: Implement the route-local component tree**

`HomePage` returns `<LandingPage />`. The page includes: navigation, corrected image-led hero, problem statement, four-stage control story, focused policy/approval/evidence product assets, five-chain USDC story, developer interface, security/evidence explanation, operating workflow, final access action, and reveal footer.

- [ ] **Step 2: Add the scoped stylesheet**

Every selector begins with `.aops-landing` or targets an `aops-*` class. The stylesheet must not redefine root console tokens, generic `button`, generic heading styles, auth classes, onboarding classes, or console classes.

- [ ] **Step 3: Run the landing structure tests**

Expected: the complete semantic structure passes and existing auth isolation assertions remain unchanged.

### Task 4: Add authoritative visual assets

- [ ] **Step 1: Add the canonical AOPS wordmark**

Copy the supplied background-removed wordmark into `public/landing/aops-wordmark.png`; use it in navigation and the reveal footer without recreating the mark as text.

- [ ] **Step 2: Add chain marks from authoritative web sources**

Use CryptoLogos SVGs for Arbitrum, Polygon, Optimism, and Avalanche. Use Base's current official brand-kit square because CryptoLogos does not list Base. Store assets locally; do not hotlink them at runtime.

- [ ] **Step 3: Correct the hero media treatment**

Use the approved boundary object as a CSS background layer rather than a framed `<img>`. Apply a controlled crop, tonal wash, and mask so the object reads cleanly at desktop and mobile widths without exposing malformed edges from the visual mockup.

### Task 5: Wire scroll and direct interaction

- [ ] **Step 1: Implement the four-stage sequence**

The pinned visual changes Identify → Decide → Govern → Prove as the section crosses four scroll intervals. Its labels remain buttons so mouse, touch, and keyboard users can select any state directly. `aria-selected`, tab focus, and reduced-motion fallbacks remain valid.

- [ ] **Step 2: Implement the five-chain sequence**

The pinned visual changes Base → Arbitrum → Polygon → Optimism → Avalanche across five scroll intervals. The large official logo, chain-specific information, and active item in the bottom chain strip change together. Strip buttons provide direct selection.

- [ ] **Step 3: Implement the footer reveal**

The footer is a complete closing viewport behind the final content surface, not a thin strip. It includes the large AOPS wordmark, product statement, main navigation, sign-in/request access, privacy/terms placeholders only if real paths exist, and the testnet product boundary.

### Task 6: Verify the landing and the isolation boundary

- [ ] **Step 1: Run focused tests**

Run: `npm --workspace @agentops-pmoa/web test -- tests/landing/landing-page.test.tsx tests/landing/scroll-sequence.test.ts tests/section-1-flow.test.tsx`

- [ ] **Step 2: Run web typecheck, lint, and build**

Run:

```bash
npm --workspace @agentops-pmoa/web run typecheck
npm --workspace @agentops-pmoa/web run lint
npm --workspace @agentops-pmoa/web run build
```

- [ ] **Step 3: Browser-test desktop and mobile**

At desktop and mobile widths, verify the hero crop, no horizontal overflow, four stage transitions, five chain transitions, direct tab clicks, mobile navigation, focus visibility, reduced motion, and the full footer reveal. Capture screenshots of the hero, all four control states, all five chain states, and footer.

- [ ] **Step 4: Audit the diff**

Use `git diff --name-only` and `git diff -- apps/web/src/app/page.tsx apps/web/src/app/landing.css apps/web/src/components/landing apps/web/public/landing apps/web/tests/landing apps/web/tests/section-1-flow.test.tsx`. Confirm no auth, onboarding, console route, API, server action, shared component, or shared stylesheet was changed by this landing implementation.
