---
target: control page and policy drawers
total_score: 24
p0_count: 0
p1_count: 3
timestamp: 2026-07-08T07-00-35Z
slug: ps-web-src-components-controls-controlslibrary-tsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Draft validate and activate states exist, but create and bind actions lack clear pending, success, and failure feedback in the drawer. |
| 2 | Match System / Real World | 3 | Policy, draft, binding, credential language is mostly correct; "Surface", "Effect", and some summaries still feel implementation-shaped. |
| 3 | User Control and Freedom | 2 | Drawers have Close, but no Escape handling, dirty-form warning, reset, or clear recovery from accidental closure. |
| 4 | Consistency and Standards | 2 | Main table, create drawer, drafts drawer, and policy detail drawer use different density, widths, and action placement. |
| 5 | Error Prevention | 2 | Action-specific fields are improved, but comma list inputs, optional conditions, and binding choices still allow policies that look valid but may be weak or too broad. |
| 6 | Recognition Rather Than Recall | 3 | Main filters and action labels are visible, but users still need to infer how draft, active policy, and binding lifecycle connect. |
| 7 | Flexibility and Efficiency | 2 | Search and filters exist, but no bulk actions, no quick duplicate, no keyboard path, and no inline binding from the policy list. |
| 8 | Aesthetic and Minimalist Design | 2 | Cleaner than before, but still too carded, over-chipped, uneven in hierarchy, and not yet at Stripe/RazorpayX quality. |
| 9 | Error Recovery | 2 | Basic form validation exists through required fields, but no visible recovery language for failed server actions. |
| 10 | Help and Documentation | 2 | Small helper copy exists, but no contextual examples for what a good policy means or when it starts enforcing. |
| **Total** | | **24/40** | **Acceptable, not production-ready high-end.** |

#### Anti-Patterns Verdict

This no longer looks like raw unstructured AI output, but it still has AI-slop residue. The page reads as a table plus drawers assembled from generic SaaS primitives, not as a confidently designed policy workbench. The core issue is not visual flash. It is weak interaction hierarchy: create, review, activate, inspect, and bind are separate objects but not shaped into a strong operational flow.

Deterministic scan could not run because `detect.mjs` reported `Error: bundled detector not found.` Browser inspection was attempted at `http://localhost:3005/app/test-organisation-1/controls`, but the Playwright session redirected to `/auth`, so no authenticated visual overlay was available.

#### Overall Impression

The control page is usable and moving in the right direction, but it is not yet production-ready high-end UI. A serious operator could understand the objects, but they would not feel the product has a polished, confident policy-operations model yet.

#### What's Working

1. The policy list is the right primary surface. Tables and scan-heavy rows fit this product better than decorative KPI cards.
2. Action-specific policy fields are a real UX improvement. This avoids the earlier broken generic form where payment, tool, and HTTP fields could be mixed accidentally.
3. The drawer direction is reasonable for policy creation and detail inspection, as long as drawers become proper work surfaces instead of generic slide-over cards.

#### Priority Issues

**[P1] The page lacks a strong workflow model**
Why it matters: Users need to understand policy lifecycle: draft, validate, activate, bind, then enforce. Right now that lifecycle is split between buttons, drawers, and row details without a clear operational spine.
Fix: Redesign the control page around two stable zones: policy library and active work surface. The work surface should adapt to create, draft review, or policy detail, with the same header, body, and footer rhythm.
Suggested command: `$impeccable shape controls policy workbench`

**[P1] Drawers feel like generic slide-over panels, not product-grade workspaces**
Why it matters: High-end admin tools make side panels feel intentional, with stable sizing, structured footers, and clear decision areas. Here, create, drafts, and detail drawers each have different density and composition.
Fix: Standardize drawer anatomy: compact title bar, scrollable content, sticky footer actions, one primary action, one secondary action. Full-height create and detail should share a layout system; drafts should either be a right panel with list rows or part of the same workbench, not a third pattern.
Suggested command: `$impeccable craft controls drawers`

**[P1] The create policy form still looks mechanically carded**
Why it matters: The form technically works, but the stacked boxed labels make it feel generated and heavy. Policy creation is the core product surface, so it needs to feel precise and guided.
Fix: Replace form-card chunks with sections: identity, rule, conditions, review. Use inline grouping, not a card around every form row. Add a generated plain-language preview that updates as fields change.
Suggested command: `$impeccable craft policy creation flow`

**[P2] Visual hierarchy is still too flat**
Why it matters: The table rows, badges, filters, drawer cards, and helper copy compete at similar weight. A polished product should guide the eye without making the user parse every object equally.
Fix: Reduce badges, lighten table headers, use stronger row title/body separation, and reserve dark/high-contrast styling only for primary actions.
Suggested command: `$impeccable polish controls page`

**[P2] Error and state handling are not visible enough**
Why it matters: In policy systems, users need confidence that a policy is draft-only, active, bound, or enforcing. The current UI states do not fully reassure after create, validate, activate, bind, or failed submit.
Fix: Add explicit in-drawer state rows, inline server errors, disabled/loading button states, and success confirmation that does not feel like marketing copy.
Suggested command: `$impeccable harden controls page`

#### Persona Red Flags

**Alex, power operator:** Can filter and open rows, but cannot quickly duplicate a policy, bulk bind, or use keyboard-first controls. The workflow is too one-object-at-a-time for a serious operator managing many agents.

**Jordan, first-time developer:** Understands "New policy", but may not understand when a draft enforces, why activation is separate from binding, or whether binding to workspace versus agent is safe. The UI does not teach through the workflow strongly enough.

**Sam, accessibility-dependent user:** Dialog semantics exist, but the implementation does not visibly show focus trapping, Escape close behavior, or clear state announcements for server actions. The row-as-button pattern needs careful keyboard and screen reader verification.

#### Minor Observations

- Pill buttons are still slightly overused for a restrained financial console.
- Some labels are clean, but "Effect", "Surface", and "No extra condition fields" are still too internal.
- The compact draft drawer introduces a different spatial model from create/detail.
- The policy row open affordance is cleaner now, but the table still depends heavily on badge scanning.
- Mobile fallback exists, but the target product experience is currently desktop-first and should be judged there first.

#### Questions to Consider

- Should policy creation feel like a four-step guided builder, or a dense single-form editor for operators?
- Should Drafts be a separate drawer at all, or a filtered state inside the policy library?
- Is binding the most important action after activation, and if yes, why is it hidden behind policy detail instead of surfaced more directly?
