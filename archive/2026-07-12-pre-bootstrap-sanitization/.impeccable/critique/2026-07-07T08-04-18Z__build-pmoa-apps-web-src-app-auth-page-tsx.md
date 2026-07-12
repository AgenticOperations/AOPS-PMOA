---
target: BUILD-PMOA/apps/web/src/app/auth/page.tsx
total_score: 18
p0_count: 0
p1_count: 3
timestamp: 2026-07-07T08-04-18Z
slug: build-pmoa-apps-web-src-app-auth-page-tsx
---
# Auth Page Critique - agentOps PMOA

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No loading, redirect, or OAuth error state is visible. |
| 2 | Match System / Real World | 2 | Copy says "Section 1 foundation" and "org boundary", which is internal build language. |
| 3 | User Control and Freedom | 2 | Clear Google action exists, but no secondary path, help, or visible recovery path. |
| 4 | Consistency and Standards | 3 | Layout and controls are consistent, but the visual system is generic. |
| 5 | Error Prevention | 2 | No visible warning for OAuth config errors, account mismatch, or failed callback. |
| 6 | Recognition Rather Than Recall | 3 | Primary action and steps are visible. |
| 7 | Flexibility and Efficiency | 1 | One rigid path, no alternate account switching explanation beyond reauth. |
| 8 | Aesthetic and Minimalist Design | 1 | Too sterile: black slab plus white form reads unfinished and template-like. |
| 9 | Error Recovery | 1 | `/auth?error=...` is not surfaced to the user. |
| 10 | Help and Documentation | 1 | No contextual reassurance about what Google grants or what happens next. |
| **Total** | | **18/40** | **Poor: functionally clear, visually and emotionally underbuilt.** |

## Anti-Patterns Verdict

This does look AI-generated. The page is clean but not crafted: a dark rectangle on the left, a white rectangle on the right, three generic steps, and a Google button. Nothing says premium fintech infrastructure beyond the words.

Deterministic scan was attempted but unavailable because the installed skill wrapper could not find the bundled detector engine. Browser evidence did run through Playwright at `http://localhost:3005/auth`. Snapshot showed a 1200x687 layout with a 522px dark hero, 606px form panel, and the Google button at the center-right.

## Overall Impression

The flow is correct, but the screen has no product magnetism. The biggest opportunity is to turn this from a plain authentication gate into a confident trust-entry screen: identity, control plane, and operator calm, with motion and a richer visual field.

## What's Working

- The primary action is obvious: "Continue with Google" is visible and accessible.
- The screen avoids fake GitHub/password options, which is correct for the current implementation.
- Semantics are decent: main regions, headings, and the Google link are visible to the accessibility tree.

## Priority Issues

### [P1] Visual direction is too binary and generic

Why it matters: The black/white split feels like a default mock, not a modern infrastructure product. It lowers trust before the user even signs in.

Fix: Replace the black hero with a richer product scene: warm off-white form surface, dark graphite/blue-tinted hero, subtle animated operations field, status chips, or a short ambient media panel. Keep it fintech-clean, but make it designed.

Suggested command: `impeccable craft`

### [P1] Copy exposes the build model instead of the user value

Why it matters: "Section 1 foundation" and "org boundary" are implementation language. A new user wants to know what they are signing into and why it is safe.

Fix: Rewrite around the user flow: "Create your control plane", "Sign in to choose a workspace", "Register agents, issue credentials, attach policies." Keep protocol details out.

Suggested command: `impeccable clarify`

### [P1] Missing OAuth states and recovery

Why it matters: If Google fails, the current UI has no visible recovery. This is a production trust issue.

Fix: Surface `?error=oauth_state` and `?error=oauth_exchange`, add a loading/redirect affordance, and provide retry/back guidance.

Suggested command: `impeccable harden`

### [P2] No motion or interaction polish

Why it matters: Auth is the first product moment. Static panels make the product feel inert.

Fix: Add a staggered reveal for hero text/steps, button press feedback, reduced-motion-safe animation, and maybe an animated left-panel field. Do not animate layout.

Suggested command: `impeccable animate`

### [P2] Logged-in variants are not separately designed

Why it matters: No-org and workspace-picker states reuse the same sparse structure, so they feel like text swaps rather than finished states.

Fix: Design three auth states as siblings: logged out, no workspace, workspace selection. Give each a focused hierarchy and state-specific action.

Suggested command: `impeccable polish`

## Persona Red Flags

**Jordan, first-timer:** The first action is clear, but the explanation is too internal. "Org boundary" and "Section 1" make the product feel unfinished.

**Sam, accessibility-dependent user:** The structure is mostly accessible, but OAuth error states are invisible, and the visual "G" mark is not meaningful. Focus states exist globally, which helps.

**Maya, enterprise operator:** The screen does not yet communicate enterprise trust: no security reassurance, no workspace ownership explanation, no audit/policy promise in user language.

## What To Learn From The Aurora Prompt

- Use the two-column structure, but improve the left side into a visual identity panel, not a black block.
- Use motion for staged comprehension: brand, promise, steps, action.
- Use step items as designed components with active/inactive states, not plain list rows.
- Use richer surface styling, stronger spacing, and higher-touch button states.
- Do not copy Aurora's password/GitHub flow. Our current product only supports Google, so the form side should stay focused on Google and workspace continuation.

## Questions To Consider

- Should the auth page feel like a calm financial console entry, or a more cinematic "agent control plane" portal?
- What should the left panel show: abstract operations motion, product UI preview, or a short video/visual asset?
- Do we want to add a motion dependency now, or use CSS-only motion until the design system is more stable?
