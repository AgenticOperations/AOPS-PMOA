---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [build-pmoa, design-context, impeccable]
---

# agentOps PMOA Design Context

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/PRODUCT]] | [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/42-build-execution-operating-model]]

## Register

Product UI. Design serves repeated operator work.

## Visual Direction

- Theme: light, high-trust infrastructure console used during normal work hours by operators who need to scan status quickly.
- Color strategy: restrained. Tinted neutrals, one blue action accent, and semantic state colors only where they carry meaning.
- Anchors: Stripe Dashboard, RazorpayX, Linear settings.

## Tokens

- Background: warm-tinted off-white.
- Surface: near-white panel.
- Text: dark neutral with a subtle cool tint, never pure black.
- Muted text: medium neutral.
- Border: low-contrast neutral line.
- Accent: clear blue for primary actions and selected states.
- Radius: 8px or less for cards and controls.

## UX Rules

- Default screens show only what the user can act on now.
- Do not add non-functional fields, selectors, cards, metrics, filters, tabs, or copy. Every visible element must either complete a real user action, explain a real decision, or expose real system state.
- Advanced implementation details are behind setup snippets or small detail rows.
- Tables and lists are preferred for scan-heavy operational data.
- Empty states should tell the next action, not market the product.
- Finance and wallet surfaces must not appear as the main story in Section 1.
