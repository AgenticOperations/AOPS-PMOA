---
created: 2026-07-07
updated: 2026-07-10
project: agentOps
ecosystem: circle
tags: [build-pmoa, design-context, impeccable, canonical]
---

# agentOps PMOA Design Context (Canonical)

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/PRODUCT]] | [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/42-build-execution-operating-model]]

This document is the canonical source of truth for agentOps' authenticated-product visual design, superseding any prior "restrained Stripe/RazorpayX/Linear" framing. It reflects the 2026-07-10 redesign pass.

## Register

Product UI. Design serves repeated operator work.

## Scope

This doc governs the **authenticated product only**: everything from the moment a user clicks "Get Started" onward — Auth, Onboarding, and the full console (Overview, Agents, Controls, Operations, Payments, Approvals, Workspace Settings).

The public landing/marketing site is explicitly **out of scope** here. It is a separate, later effort in the brand register, using the `high-end-visual-design` skill to build a distinct billion-dollar-SaaS marketing experience. Do not pull that skill's techniques (glass, huge radii, dark OLED, exotic display fonts, orchestrated hero motion) into the console — they belong to the landing page only.

## Visual Direction

- **Canonical reference: `shadcn-fintech`** (github.com/abderrahimghazali/shadcn-fintech, MIT). Its component structure, layout patterns, card/table/chart treatment, spacing rhythm, and overall fintech-SaaS polish level are the target for agentOps' dashboard — there is no ambiguity here, it is the reference to build toward.
- **What still doesn't carry over from it**: its wallet-first/crypto-trading *content* framing (leading with token balances, a dedicated Crypto page, card-flip visuals). `PRODUCT.md`'s anti-references remain in force at the content/IA level — don't lead with wallet balances, don't look like a crypto-trading dashboard, use agentOps' own vocabulary (agent/connection/policy/approval/payment/wallet/capability/evidence). This is a content and IA constraint, not a visual-style constraint — the polish level, components, and layout discipline of shadcn-fintech apply in full.
- Theme: light, per shadcn-fintech's own default.

## Tokens

- Background: warm-tinted off-white (existing token, kept — `--bg-app`).
- Surface: near-white panel (kept — `--bg-panel`), plus a second, slightly cooler-tinted neutral layer for sidebar/toolbar chrome (new — distinguishes nav chrome from content surface, per shadcn-fintech's own sidebar treatment).
- Text: dark neutral with a subtle cool tint, never pure black (kept).
- Accent: clear blue for primary actions and selected states (kept — also directionally close to USDC's own brand blue, useful when pairing with the USDC mark next to amounts).
- Semantic state colors: success/warning/danger/info, used as 10-20% opacity tints behind full-opacity text/icons. Never use solid-fill warning/error/success slabs for inactive status.
- Elevation: cards and panels use a 1px ring/border treatment (`ring-1`/`border-subtle` equivalent), not drop shadows. Shadows are reserved for overlays such as sheets, menus, popovers, and drag states.
- Radius roles: cards and panels use the shadcn-fintech `rounded-xl` role; inputs and compact controls stay tighter; status badges and pills use a full-pill radius. Do not flatten all components to one radius.
- Charts: neutral/grayscale series by default. Use color only when a series encodes semantic state such as success vs. failed, and use the same tint discipline as badges.

## Typography

- **Primary face: Montserrat**, loaded via `next/font/google`, used for both UI and display roles (headings, labels, body, buttons, data). Replaces the previous Aptos/SF Pro/system-ui stack.
- Fallback stack still ends in system-ui/sans-serif for resilience if the font fails to load.
- Monospace (`--font-mono`) is unchanged — Montserrat has no bearing on code/technical values (ids, hashes, addresses).
- Fixed rem scale, ~1.15 ratio between steps (product register — more type sizes needed for dense data screens than a marketing site).
- Tabular figures (`font-variant-numeric: tabular-nums`) on every number column.

## UX Rules

- Default screens show only what the user can act on now.
- Do not add non-functional fields, selectors, cards, metrics, filters, tabs, or copy. Every visible element must either complete a real user action, explain a real decision, or expose real system state.
- Advanced implementation details are behind setup snippets or small detail rows.
- Tables and lists are preferred for scan-heavy operational data; tables use a fixed-height shell with a hidden (not removed) scrollbar — see the redesign spec's table pattern.
- Empty states should tell the next action, not market the product.
- Finance and wallet surfaces must not appear as the main story in Section 1 (Overview) — the USDC mark identifies currency next to amounts, it does not brand the product.

## Related documents

- `docs/audit/2026-07-10-console-feature-data-audit.md` — full page/data/action inventory.
- `docs/audit/2026-07-10-visual-ux-redesign-spec.md` — full IA, per-page analytics mapping, Overview design, component patterns, and phased build roadmap.
