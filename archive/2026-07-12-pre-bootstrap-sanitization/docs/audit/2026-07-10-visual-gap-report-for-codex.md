# Visual Design Gap Report — for Codex

Date: 2026-07-10
Audience: Codex (built `2026-07-10-console-feature-data-audit.md` and `2026-07-10-visual-ux-redesign-spec.md`)
Purpose: your IA/route/functional-mapping work is sound and should not be redone. This report is the missing layer — the actual visual design specification your spec deferred — plus a verified answer on directly reusing `shadcn-fintech`'s source code.

---

## 1. What's solid — keep as-is

- Section 2 (Current Product Surfaces): every card/table/form ties to a real backend object. This is the right discipline and prevents the "fake metric card" failure mode.
- The three layout blueprints (Aggregator / Index / Focus Canvas): correct call — reused shapes beat bespoke pages for consistency.
- The Treasury split (`/payments`, `/sources`, `/access`, `/liquidity`, `/activity`): clean, non-overlapping data ownership.
- Form rules (single-step / confirmation drawer / stepper drawer) and the acceptance criteria: both hold.

None of this needs to change. What follows is what's missing.

---

## 2. The gap: your spec has no actual visual design system

Section 6 of your spec says "Compact cards," "Chart cards using recharts," "Theme toggle" — but never specifies the values that make those things look like `shadcn-fintech` instead of a generic admin panel. I pulled the actual source from the reference repo (MIT licensed, see §3) to answer this concretely instead of describing it abstractly.

### 2.1 Elevation: no shadows, a 1px ring

`shadcn-fintech`'s `Card` component (`src/components/ui/card.tsx`):
```
rounded-xl bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10
```
There is **no `box-shadow` anywhere on cards.** Depth comes from a `ring-1 ring-foreground/10` (a 1px, 10%-opacity border-like ring), not a drop shadow. This is the single biggest reason it reads as "premium fintech" instead of "generic dashboard" — generic AI-generated dashboards almost always reach for `shadow-md`/`shadow-lg` on every card. Your spec doesn't currently forbid this or specify the ring-based alternative.

### 2.2 Color: charts are grayscale by default; semantic color is tinted, never solid

`globals.css`'s chart tokens:
```
--chart-1: oklch(0.87 0 0);   /* all five are chroma=0 — pure grayscale */
--chart-2: oklch(0.556 0 0);
--chart-3: oklch(0.439 0 0);
--chart-4: oklch(0.371 0 0);
--chart-5: oklch(0.269 0 0);
```
This matches what's visible live — the "Financial Overview" and "Spending Activity" charts are black/gray bars and dots, not a rainbow of series colors. Color is reserved entirely for semantic state, and even there it's never a solid fill. `Badge`'s destructive variant:
```
bg-destructive/10 text-destructive ... dark:bg-destructive/20
```
10-20% opacity tint, not a solid red badge. Your spec's Section 8 (Analytics Placement) lists rich chart content per page but never states this rule. Without it, an implementer's default instinct (solid-colored bar series, solid-fill status pills) will produce something visibly louder and cheaper than the reference, even while following your IA correctly.

### 2.3 Badges are pills, cards are not

`Badge` uses `rounded-4xl` (fully rounded/pill). `Card` uses `rounded-xl`. Two different radius roles, not one global "small radius" rule. `DESIGN.md` currently states "8px or less for cards and controls" as one flat rule — that's a simplification that will make badges/pills look wrong if followed literally.

### 2.4 Empty states are illustrated and animated, not text placeholders

`src/components/empty-state.tsx` — a `variant`-driven component (`accounts | transactions | cards | ... | search | filter | generic`) that renders a custom hand-drawn SVG illustration per context (e.g. a wallet illustration with `motion`-animated `pathLength` draw-in and a staggered card fly-in), tinted at `fill-primary/10 stroke-primary/40` — same restrained-tint rule as above. Your spec currently has empty states as a Phase 7 QA checklist line ("check empty/loading/error states"). At the reference's quality bar, empty states are **designed content per page**, with real illustration and copy, decided during each page's design — not verified after the fact.

### 2.5 Icon vocabulary conflict

The reference uses `lucide-react` throughout (confirmed in `app-sidebar.tsx`: `LayoutDashboardIcon`, `WalletIcon`, etc.). agentOps' `apps/web` currently uses `@tabler/icons-react`. Your spec recommends keeping Tabler "unless the team chooses a full Lucide migration" — but if any component source gets ported directly from the reference (see §3), it will import Lucide icons by default. This needs an explicit decision now, not a "keep as is unless" hedge, because it affects which files can be copied verbatim versus which need icon-swap edits.

### 2.6 No fixed-height/hidden-scrollbar table shell exists in the reference either

Worth confirming: `src/components/ui/table.tsx` is a plain `overflow-x-auto` wrapper with no max-height or hidden-scrollbar behavior. This part of your spec (Index layout's "fixed-height table shell with sticky header and hidden scrollbar") is **net-new work agentOps needs regardless** — it's not something to extract from the reference, so don't expect to find it there.

---

## 3. Can we directly reuse the shadcn-fintech repo code? Yes — verified.

`gh api repos/abderrahimghazali/shadcn-fintech/license` → `MIT`. MIT permits copying, modifying, and redistributing the code, including commercially, with only the license/copyright notice retained. There is no reason to reverse-engineer these patterns from screenshots when the source is directly portable.

**Recommended reuse plan:**

Port directly (adapt import paths/tokens, keep structure):
- `src/components/ui/card.tsx`, `badge.tsx`, `table.tsx`, `chart.tsx`, `sidebar.tsx` (their real primitive — ours in `apps/web/src/components/ui/sidebar.tsx` is a minimal hover-expand one with no collapsible groups; theirs has the full `SidebarMenu`/group/collapsible support your spec's Treasury-accordion nav needs).
- `src/components/empty-state.tsx` — port wholesale, swap illustration variants to agentOps' domains (`agents | policies | approvals | payments | ...`) instead of their fintech ones.
- `globals.css`'s `@theme inline` token block and radius scale (`--radius-sm` through `--radius-4xl`) — port the *scale mechanism*, not their literal grayscale values, since agentOps already has its own oklch tokens in `DESIGN.md`/`globals.css` (background/surface/accent-blue/state colors) that must stay. Merge: keep agentOps' color values, adopt their radius-scale and ring-based elevation approach.

**Decision needed from Codex before porting:**
1. **`@base-ui/react` dependency**: their `Card`/`Badge`/`SidebarMenuButton` use Base UI's `useRender`/`mergeProps` for polymorphic rendering (`render={<Link .../>}`). Either add `@base-ui/react` as a new dependency to match their code 1:1, or strip the polymorphic-render pattern during porting (simpler, smaller dependency footprint, visually identical). Recommendation: strip it — agentOps' spec never called for polymorphic "render as" flexibility, and it's the one piece of their code that's genuinely more complex than what this project needs.
2. **Icons**: keep `@tabler/icons-react` and swap every `lucide-react` import during porting (mechanical, one-for-one icon renames), or migrate fully to Lucide to match the reference exactly with zero translation. Recommendation: swap during porting — Tabler already has equivalent icons for everything in `app-sidebar.tsx`'s icon set, and a full migration touches every existing page unnecessarily.

---

## 4. Concrete addendum to add to your spec (Section 6 replacement)

Add these as hard rules, not suggestions:

- **No `box-shadow` on cards.** Elevation = `ring-1 ring-foreground/10` equivalent (translate to agentOps' border-subtle token), full stop.
- **Charts default to grayscale/neutral series.** Introduce color in a chart only when a series genuinely needs to be distinguished by state (e.g. success vs. failed payment events) — and even then, use the same tinted-opacity approach as badges, not saturated fills.
- **Two radius roles, not one:** pills (`rounded-full`/`rounded-4xl`-equivalent) for badges/status indicators, `rounded-xl`-equivalent for cards/panels. Update `DESIGN.md`'s flat "8px or less" rule to specify both.
- **Semantic color is always a tint** (10-20% opacity background + full-opacity text), never a solid fill, matching the Badge pattern above.
- **Every page's empty state is designed, not deferred** — each page in Section 5 of your spec gets one line stating what its empty state shows and says, same level of specificity as its data/actions.
- **Icon decision**: Tabler, with mechanical substitution during any ported-component work (see §3).

---

## 5. What I did not re-litigate

The command-palette/entity-search backend gap and the mobile-IA-as-QA-checklist issue from my prior review still stand and aren't visual-token issues — they're scope/sequencing issues, addressed separately. This report is scoped to the visual-design gap and the code-reuse question only, per what was asked.
