---
target: Controls page, drawers, policy detail, sidebar
total_score: 15
p0_count: 2
p1_count: 2
timestamp: 2026-07-11T06-48-36Z
slug: rgslug-controls-page-drawers-policy-detail-sidebar
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | No pending/loading/success state on any Controls form action (create, validate, activate, discard, archive, simulate) |
| 2 | Match System / Real World | 3 | Plain-English policy summaries (`policySummary()`) match product vocabulary well |
| 3 | User Control and Freedom | 2 | No Escape-to-close on Controls' own drawer; Discard has zero confirm/undo |
| 4 | Consistency and Standards | 1 | Two competing drawer implementations; unused shadcn `Sidebar` primitive next to a hand-rolled one; read-only Conditions tab ignores the create form's own conditional-field logic |
| 5 | Error Prevention | 1 | Discard draft is a single unconfirmed click; sidebar hover-expand shifts an open drawer 176px mid-task |
| 6 | Recognition Rather Than Recall | 1 | Collapsed sidebar (72px) is icon-only by default; labels fade in only on hover/focus |
| 7 | Flexibility and Efficiency | 1 | No bulk actions; flat 9-item action select despite an unused `category` field that could group it |
| 8 | Aesthetic and Minimalist Design | 1 | Font-weight scale collapses to ~2 real rendered weights; same 3 counts shown in 3 adjacent widgets |
| 9 | Error Recovery | 1 | No visible error-state rendering for a failed server action anywhere in Controls |
| 10 | Help and Documentation | 2 | Good inline reassurance copy in places (Archive), inconsistent (Discard has none) |
| **Total** | | **15/40** | **Poor band** |

#### Anti-Patterns Verdict

**Yes, this reads as AI-generated** — not in the "nonsense output" sense, but in the more diagnosable sense: a system that looks plausible in isolation and was never verified against its own runtime constraints.

**LLM assessment:** Two concrete, mechanical signatures of ungrounded generation:

1. **A font-weight scale that was designed but never checked against the loaded font.** `globals.css` has 108 `font-weight` declarations using precise-looking values (610, 620, 630...850). `layout.tsx` loads Montserrat with exactly four static weights: `['400','500','600','700']`. Verified directly: per CSS font-weight matching, values in (600,700) match upward to 700; values above 700 fall back downward to 700 (no heavier weight is loaded); only values in [500,599] land on 600. Counting the actual declarations: **97 of 108 (89.8%) render as 700, 8 render as 600, 3 are exact 500 matches.** The type hierarchy DESIGN.md specifies ("fixed rem scale, ~1.15 ratio between steps") functionally does not exist at the weight level — nearly everything is bold. This is the direct, mechanical explanation for "bold text... looks super bad... everywhere."
2. **A canonical primitive built and then abandoned.** `apps/web/src/components/ui/sidebar.tsx` is a complete shadcn-style `Sidebar`/`SidebarMenu` component set. Verified: it has zero imports anywhere else in the codebase. The actual nav, `ConsoleSidebarNav.tsx`, reimplements the same concept from scratch with different classes and different behavior. Same pattern with drawers: `ui/sheet.tsx` is a real overlay (backdrop, Escape-to-close, bounded width) used once elsewhere in the app; Controls reimplements its own `.controls-work-drawer` with none of that — verified no Escape handler exists in `ControlsLibrary.tsx` at all.

**Deterministic scan:** Unavailable this run — the bundled `detect.mjs` entrypoint is not present in this install (`Error: bundled detector not found`), and browser automation (`claude-in-chrome`) is currently disconnected, so no live/injected scan could run either. Assessment B's evidence in this report comes from direct source grep/verification instead (font-weight distribution counted exactly, dead-import search run directly, CSS rule and Escape-handler locations confirmed by grep) rather than the bundled heuristic detector or a rendered-page overlay. Flagging this clearly: findings below are source-verified, not visually screenshotted.

**Visual overlays:** Not available — browser injection could not run. No `[Human]` tab overlay exists for this critique.

#### Overall Impression

The information architecture and copy are genuinely competent — this isn't a case of nonsensical AI output. What's broken is that two specific implementation details never got checked against reality: the font-weight values declared in CSS don't correspond to any weight actually loaded (so "intentional" hierarchy collapses into near-uniform bold), and a real drawer/sidebar primitive was built once, then reimplemented differently on the one page that most needed it. The user's read ("Agents page clean, Controls close but not shadcn-fintech level") lines up exactly with the evidence: Agents doesn't touch the redundant-count or two-drawer problems Controls does.

#### What's Working

1. **`PolicyDraftBuilder`'s live review rail** translates form state into a plain-English sentence as you type ("Deny · External HTTP/API request · category weather") — exactly the reassurance a rule-authoring tool needs before commitment.
2. **Conditional field disclosure on the create form** (`fieldEnabled()`) correctly hides payment/tool fields for actions that can't have them — the right instinct, just not carried through to the read-only detail view.
3. **Keyboard-parallel sidebar expansion** (`:focus-within` mirrors `:hover`) is a real accessibility credit most icon-rail navs skip — undermined by the icon-only default state, but the mechanism itself is correct.

#### Priority Issues

**[P0] Font-weight scale silently clamps to bold almost everywhere**
- **Why it matters:** This is the direct, verified, mechanical cause of "bold text especially in sidebars and form placeholders... looks super bad." 97 of 108 declared font-weight values render as 700 regardless of the intended step, because Montserrat is loaded with only four static weights and nothing in between matches.
- **Fix:** Load Montserrat as a variable font (drop the static `weight` array so intermediate weights render as requested), or snap every declared weight to one of {400, 500, 600, 700} and rebuild the scale deliberately — reserve 700 for one or two genuinely emphasized elements per screen, not defaults.
- **Location:** `apps/web/src/app/layout.tsx:5-10`; `apps/web/src/app/globals.css` (108 sites).
- **Suggested command:** `{{command_prefix}}impeccable typeset`

**[P0] No confirmation before discarding a policy draft**
- **Why it matters:** Verified — "Discard draft" is a bare form + submit button, no confirm, no undo. A user can lose work from the entire 3-step draft flow in one misclick, with zero resistance, directly contradicting the "trustworthy, precise" register the product claims.
- **Fix:** Add an inline two-step confirm before submit, matching the reassurance-copy pattern Archive already uses ("This is not deletion...").
- **Location:** `apps/web/src/components/controls/ControlsLibrary.tsx:781-788`.
- **Suggested command:** `{{command_prefix}}impeccable harden`

**[P1] Two incompatible drawer implementations in the same console**
- **Why it matters:** Verified — Controls' own `.controls-work-drawer` has no Escape-key handler while the app's real `Sheet` primitive does; keyboard users lose the exit specifically on the page with the highest-stakes forms. A second unused shadcn `Sidebar` primitive sits dead in the codebase next to a hand-rolled duplicate.
- **Fix:** Route Controls' panels through the existing `Sheet` component instead of the bespoke drawer; resolve `ui/sidebar.tsx` by either adopting it in `ConsoleSidebarNav.tsx` or deleting it.
- **Location:** `apps/web/src/components/controls/ControlsLibrary.tsx:565-989`; `apps/web/src/components/ui/sheet.tsx`; `apps/web/src/components/ui/sidebar.tsx`.
- **Suggested command:** `{{command_prefix}}impeccable extract`

**[P1] Sidebar hover-expand relocates an open drawer mid-task**
- **Why it matters:** Verified in CSS — `.console-shell:has(.app-sidebar-body:hover) .controls-work-drawer { left: 248px; }`. Any mouse movement near the collapsed sidebar's edge while a drawer is open (plausible while reaching for a form field) shifts the entire open panel 176px right, relocating form controls under the user's cursor mid-interaction.
- **Fix:** Disable sidebar hover-expansion while a drawer/modal is open, or give the drawer a fixed left offset independent of sidebar state.
- **Location:** `apps/web/src/app/globals.css:4487-4507`.
- **Suggested command:** `{{command_prefix}}impeccable layout`

**[P2] No loading or success feedback on any Controls form action**
- **Why it matters:** Create, validate, activate, discard, simulate, and archive are all plain server actions with no pending state and no success confirmation — three consecutive "did that work?" moments in the one flow the product is built around.
- **Fix:** Wrap submit buttons with `useFormStatus`-driven pending state; add a lightweight success indicator after each action.
- **Location:** `apps/web/src/components/controls/ControlsLibrary.tsx` (all `<form action={...}>` instances).
- **Suggested command:** `{{command_prefix}}impeccable clarify`

#### Persona Red Flags

**Alex (Power User)**: Three separate form submissions to create → validate → activate a policy, none with a pending indicator or toast — Alex can't confirm a click registered without manually reopening the Drafts tab. The 9-item action select is flat despite an unused `category` field that could group it. No bulk validate/activate across multiple drafts.

**Jordan (First-Timer)**: Lands on an icon-only collapsed sidebar with no visible hint to hover. Submits "Create draft" and gets no confirmation of any kind. Opens an activated policy's Conditions tab and sees "Payment minimum: No minimum" on a policy that has nothing to do with payments — inconsistent with what the create form just correctly hid. Clicks "Discard draft" while exploring and loses it with zero warning.

**Sam (Accessibility-dependent)**: No Escape-key exit from Controls' own drawer (confirmed absent, unlike the app's real `Sheet` primitive). No evidence of managed focus on drawer open — no autofocus, no focus trap — so a `role="dialog"` panel gives screen-reader users no signal a new modal context appeared.

#### Minor Observations

- `PolicyDraftBuilder`'s step rail restates the same 3 steps as the section headers with slightly different copy for each — two labels for one concept.
- Audit hash cells truncate to 18 characters with no way to see or copy the full hash — a real gap on an evidence surface.
- Simulation's "Target" select is a single flat dropdown across all agents/connections/teams/org with no search — won't scale.
- Triple-redundant count display (view tabs + summary strip + count pill all show the same active/drafts/changes numbers) directly contradicts `DESIGN.md`'s own "no non-functional metrics" rule.

#### Questions to Consider

1. Was this UI ever visually QA'd in a browser after the Montserrat font swap? The clamping bug is invisible in source review and immediately obvious in DevTools.
2. `ui/sidebar.tsx` has zero imports — was it meant to be the canonical primitive and abandoned when `ConsoleSidebarNav.tsx` was hand-rolled instead? Which one is the actual source of truth going forward?
3. If create→validate→activate is the product's core loop, is silent server-action revalidation considered acceptable, or is optimistic/toast feedback planned?
