# Platform Story Tour Implementation Plan

> **For Claude:** Execute this plan in-repo. Steps use checkbox syntax for tracking.

**Goal:** Ship a non-forced, skippable, path-choosing guided story tour (create agent → policy → publish → hire) with clean UI that does not disrupt the existing console.

**Architecture:** Client-only tour controller mounted in `ConsoleShell`. Persistence via `localStorage` (instant, per-org). Spotlight via `driver.js` with branded popover CSS. Multi-route steps use Next.js `router.push` + resume-from-storage. Never blocks UI; Close / Skip / Esc always available.

**Tech Stack:** Next.js App Router, React 19, driver.js, existing CSS variables / Motion-friendly CSS, Tabler icons.

**Constraints (from design):**
- User chooses path: Publish & hire | MCP operator | Just explore
- Close / Skip anything — never force actions
- Beautiful, clean, smooth; match console theme (no purple glow chrome)
- Site must remain fully usable

---

## File map

| File | Role |
|------|------|
| `apps/web/src/lib/platform-tour/types.ts` | Tour types |
| `apps/web/src/lib/platform-tour/storage.ts` | localStorage read/write |
| `apps/web/src/lib/platform-tour/steps.ts` | Step copy + selectors by path |
| `apps/web/src/components/platform-tour/PlatformTour.tsx` | Controller + welcome + driver |
| `apps/web/src/components/platform-tour/TourReplayButton.tsx` | Quiet header replay |
| `apps/web/src/app/globals.css` | Tour CSS (branded) |
| `ConsoleShell.tsx` | Mount tour + replay |
| `ConsoleSidebarNav.tsx` | `data-tour` anchors |
| `AgentCreateDrawer.tsx` | `data-tour="add-agent"` |
| `OverviewHomeView.tsx` | checklist / connect anchors |
| `package.json` | `driver.js` dependency |

## Chunk 1: Core tour engine

### Task 1: Types + storage + steps
- [x] Create types, storage helpers, step definitions

### Task 2: PlatformTour UI
- [x] Welcome chooser (path / skip / close)
- [x] driver.js runner with branded popover
- [x] Route-aware resume; destroy on unmount

### Task 3: Anchors + mount
- [x] Add `data-tour` attributes; mount in ConsoleShell; replay button

### Task 4: Styles + verify
- [x] CSS for overlay/popover; typecheck; smoke test

---

## Acceptance

1. First console visit shows optional welcome (not a trap).
2. Path choice changes later step emphasis.
3. Skip / Close / Esc dismiss; replay from header.
4. No hard gates; CTAs optional.
5. Existing pages look unchanged when tour idle.
