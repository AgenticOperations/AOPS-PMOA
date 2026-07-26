---
created: 2026-07-26
project: agentOps
ecosystem: circle
tags: [pmoa, checkpoint-2, presentation, arc, circle, implementation-plan]
---

# PMOA Checkpoint 2 Submission Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and publish the complete PMOA Checkpoint 2 package: an editable AOPS-aligned pitch deck, reusable cover image, judge factsheet, and public feature-branch repository path.

**Architecture:** Build the deck as native editable PowerPoint objects with the explicitly authorized PptxGenJS fallback in an external retained scratch workspace. Source every material claim from repository evidence, use verified AOPS assets and approved console-system captures, then commit only the final judge-facing artifacts and documentation to `feat/mcp-paid-http`; keep `main` untouched.

**Tech Stack:** PptxGenJS, Playwright Core with system Chrome, Keynote, `pdftoppm`, PowerPoint PPTX, PNG, Git/GitHub CLI.

---

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/superpowers/specs/2026-07-26-pmoa-checkpoint-2-submission-design]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/README]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/DESIGN]]

## Execution Amendment — Authorized Presentation Fallback

On 2026-07-26 the required Node REPL rejected all calls before JavaScript
execution because host-provided `sandboxPolicy` metadata was absent.
`@oai/artifact-tool` was also unavailable on disk and from the public npm
registry. After five bounded diagnostics, Abhinav explicitly authorized a
fallback presentation implementation.

The execution runtime is therefore:

- PptxGenJS for the editable `.pptx`.
- Keynote for PPTX-to-PDF rendering on macOS.
- `pdftoppm` for full-resolution slide PNGs.
- Native editable text, shapes, images, and connectors; no full-slide bitmap
  construction.

The approved content, visual system, claim boundaries, evidence requirements,
repository scope, and QA acceptance criteria are unchanged.

## File Map

### Repository files

- Create: `submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2.pptx`
  - Editable eight-slide judge presentation.
- Create: `submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2-cover.png`
  - Slide 1 export for the checkpoint/project preview.
- Create: `submission/pmoa-checkpoint-2/README.md`
  - Judge factsheet, proof index, branch boundary, and track selection.
- Modify: `README.md`
  - Add a compact Checkpoint 2 entry point linking the deck, factsheet, evidence,
    and active feature branch.
- Create: `docs/superpowers/plans/2026-07-26-pmoa-checkpoint-2-submission-production-plan.md`
  - This execution contract.

### Retained external presentation workspace

Use:

`/private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2`

Create:

- `tmp/source-notes.txt` — claim and asset provenance.
- `tmp/slide-plan.txt` — slide-by-slide object, copy, and asset plan.
- `tmp/assets/` — verified product screenshots and copied source assets.
- `tmp/slides/` — rendered final slide PNGs.
- `tmp/layout/` — slide layout JSON.
- `tmp/preview/deck-montage.webp` — contact sheet.
- `tmp/qa/visual-qa.txt` — visual and factual QA ledger.
- `tmp/build-deck.mjs` — artifact-tool authoring script.

## Task 1: Establish the evidence and asset ledger

**Files:**

- Read: `docs/superpowers/specs/2026-07-26-pmoa-checkpoint-2-submission-design.md`
- Read: `docs/qa/2026-07-12-testnet-release-evidence.md`
- Read: `docs/qa/2026-07-13-x402-paid-http-evidence.md`
- Read: `DESIGN.md`
- Read: `apps/mcp/src/tools.ts`
- Read: `apps/web/public/landing/aops-wordmark.png`
- Read: `apps/web/public/landing/aops-wordmark-nav.png`
- Read: `apps/web/public/landing/hero-boundary.jpg`
- Create: `/private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/source-notes.txt`
- Create: `/private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/slide-plan.txt`

- [ ] **Step 1: Create the retained workspace**

Run:

```bash
mkdir -p \
  /private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/{assets,slides,preview,layout,qa}
```

Expected: all six directories exist outside the repository.

- [ ] **Step 2: Verify the exact branch and proof commit**

Run:

```bash
git branch --show-current
git rev-parse --short HEAD
git log --oneline --decorate -5
```

Expected:

- Branch is `feat/mcp-paid-http`.
- The code proof commit `add41aa` remains in branch history.
- The design and production-plan commits are documentation-only descendants.

- [ ] **Step 3: Write `source-notes.txt`**

Record these facts with repository paths:

```text
SOURCE: PMOA checkpoint form, user-provided 2026-07-26
SUPPORTS: required code link, presentation link, Agentic Economy track

SOURCE: docs/qa/2026-07-13-x402-paid-http-evidence.md
SUPPORTS: MCP-only paid HTTP, 0.001 USDC Gateway settlement, HTTP 200 merchant
response, replay safety, credential lifecycle, failure-recovery matrix
BOUNDARY: feature-branch evidence; no public HTTPS staging claim

SOURCE: fresh npm run verify on feat/mcp-paid-http, 2026-07-26
SUPPORTS: lint, typecheck, production builds, 878/878 tests

SOURCE: docs/qa/2026-07-12-testnet-release-evidence.md
SUPPORTS: product onboarding, Circle wallet connection, policy matrix,
approvals, Gateway payment, browser lifecycle evidence

SOURCE: apps/web/public/landing/aops-wordmark.png
TYPE: repository product asset
SUPPORTS: AOPS identity

SOURCE: product screenshots captured from the current local AOPS console
TYPE: first-party product UI
SUPPORTS: slides 3 and 5

BOUNDARY: Arc-native settlement is the next milestone, not current proof
BOUNDARY: current proof networks appear only in evidence captions
```

- [ ] **Step 4: Write `slide-plan.txt`**

Record the approved eight-slide titles, exact headline/subhead copy, object
types, asset dependencies, and the 60/20/10 palette:

```text
Deck: AOPS PMOA Checkpoint 2
Audience: Build on Arc mixed product/technical judges
Canvas: 1280x720
Palette: #F5F2EA 65%, #071A3D 20%, #315EF6 10%, #71B7FF 5%
Display: Iowan Old Style/Baskerville/Georgia fallback
Body: Montserrat

1 Cover — identity, product definition, Build on Arc checkpoint label
2 Missing layer — money primitives vs organizational authority
3 Working proof — real console and seven verified proof statements
4 Workflow — continuous intent-to-evidence sequence
5 Product surface — four operating surfaces with real UI crops
6 Architecture — Circle-native path, Arc dominant as next environment
7 Next milestone — five Arc/product-hardening outcomes
8 Company direction — now/next/company horizons and repository CTA
```

- [ ] **Step 5: Confirm no unsupported claims entered the ledgers**

Run:

```bash
rg -n -i \
  'deployed on arc|settles on arc today|per-agent wallet provision|autonomous liquidity rebalanc|every decision.*onchain|production deployment' \
  /private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/{source-notes,slide-plan}.txt
```

Expected: no positive claim matches. Boundary notes may match only when clearly
labelled `BOUNDARY`.

## Task 2: Capture current product proof

**Files:**

- Read: `setup.sh`
- Read: `startup.sh`
- Read: `.env` from the canonical `BUILD-PMOA` checkout without copying or
  exposing its values.
- Create: `/private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/assets/console-overview.png`
- Create: `/private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/assets/console-controls.png`
- Create: `/private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/assets/console-treasury.png`

- [ ] **Step 1: Inspect the canonical local startup contract**

Run:

```bash
./setup.sh --help
```

Expected: the command prints the supported local startup options without
starting services.

- [ ] **Step 2: Start only the existing local test profile**

Run from the canonical checkout so its existing ignored environment remains the
only secret source. Do not copy `.env` into the worktree:

```bash
./startup.sh --run-only
```

Expected health surfaces:

```text
Web:  http://127.0.0.1:3005
MCP:  http://127.0.0.1:8070/healthz returns 200
API:  http://127.0.0.1:8080/healthz returns 200
Worker: http://127.0.0.1:8090/healthz returns 200
```

- [ ] **Step 3: Attach to the `aops-test` Chrome profile**

Use Chrome CDP and reuse the existing authenticated test organization. Do not
create, rotate, or revoke credentials during screenshot capture.

- [ ] **Step 4: Capture three first-party UI compositions**

Capture at 1440×900:

```text
/app/<orgSlug>/overview
/app/<orgSlug>/controls
/app/<orgSlug>/payments/sources
```

Requirements:

- Light theme.
- No drawers or transient toasts covering content.
- No secret values, bearer tokens, full wallet addresses, or personal email
  addresses visible.
- Preserve the real AOPS sidebar, hierarchy, typography, and blue accents.

- [ ] **Step 5: Visually inspect each screenshot**

Use the image viewer at original detail and reject any screenshot with:

- loading skeletons,
- missing data,
- clipped navigation,
- sensitive values,
- incorrect dark theme,
- browser chrome dominating the composition.

## Task 3: Create the judge factsheet and repository entry point

**Files:**

- Create: `submission/pmoa-checkpoint-2/README.md`
- Modify: `README.md`

- [ ] **Step 1: Write the judge factsheet**

Create `submission/pmoa-checkpoint-2/README.md` with YAML frontmatter and links
to the project README, design spec, and QA evidence. Use this exact information
hierarchy:

```markdown
# AOPS — PMOA Checkpoint 2

## Submission
- Track: Agentic Economy
- Latest working branch: `feat/mcp-paid-http`
- Tested code checkpoint: `add41aa`
- Verification: `878/878` tests plus lint, typecheck, and production builds

## Progress summary
AOPS is a working Circle-native authority layer for teams operating autonomous
agents. The current branch proves policy enforcement, hosted MCP execution, a
real USDC paid-service flow, replay-safe result return, credential lifecycle,
and failure-safe reconciliation. Arc-native execution is the next milestone.

## Proof index
| Claim | Evidence |
|---|---|
| Complete verification gate | `docs/qa/2026-07-13-x402-paid-http-evidence.md` |
| Broader product E2E | `docs/qa/2026-07-12-testnet-release-evidence.md` |

## Honest boundary
No public deployment is required or claimed for Checkpoint 2. Arc settlement
is the next milestone, and the paid HTTP feature remains unmerged.
```

- [ ] **Step 2: Add a compact README checkpoint banner**

Add directly after the main product introduction:

```markdown
## Build on Arc — Checkpoint 2

The latest tested checkpoint is on
[`feat/mcp-paid-http`](../../tree/feat/mcp-paid-http). It demonstrates the
Circle-native control foundation that AOPS is taking onto Arc next.

- [Pitch deck](submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2.pptx)
- [Judge factsheet](submission/pmoa-checkpoint-2/README.md)
- [Paid HTTP evidence](docs/qa/2026-07-13-x402-paid-http-evidence.md)
```

- [ ] **Step 3: Validate the factsheet claims**

Run:

```bash
rg -n '878/878|add41aa|feat/mcp-paid-http|Agentic Economy|Arc' \
  README.md submission/pmoa-checkpoint-2/README.md
```

Expected: the branch, test count, track, and Arc-next boundary are present.

- [ ] **Step 4: Commit the text-only judge path**

Run:

```bash
git add README.md submission/pmoa-checkpoint-2/README.md
git commit -m "docs: add PMOA checkpoint 2 judge path"
```

Expected: one commit containing no binary deck assets.

## Task 4: Build the editable presentation foundation

**Files:**

- Read: presentation skill `artifact_tool/API_QUICK_START.md`
- Read: presentation skill `artifact_tool/api/API_DOCS.md`
- Create: `/private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/build-deck.mjs`

- [ ] **Step 1: Confirm the presentation runtime**

Run in `node_repl`:

```js
var artifactTool = await import("@oai/artifact-tool");
nodeRepl.write(Object.keys(artifactTool).sort().join("\n"));
```

Expected: the result includes `Presentation` and `PresentationFile`.

Blocker reference if the Node REPL rejects the request before JavaScript
execution:

`~/Documents/Brain/40-Memory/bug-reports/agentOps-20260726-node-repl-sandbox-meta.md`

- [ ] **Step 2: Create the presentation shell**

The build script must use:

```js
import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const presentation = Presentation.create({
  slideSize: { width: 1280, height: 720 },
});
```

Define exact theme constants:

```js
const C = {
  canvas: "#F5F2EA",
  ink: "#071A3D",
  blue: "#315EF6",
  sky: "#71B7FF",
  surface: "#FCFBF7",
  rule: "#D7DEE9",
  muted: "#657087",
  success: "#1F7A62",
};

const FONT = {
  display: "Iowan Old Style",
  body: "Montserrat",
  mono: "Aptos Mono",
};
```

- [ ] **Step 3: Implement reusable editable primitives**

Implement:

```js
async function readImageBytes(imagePath) {
  const bytes = await fs.readFile(imagePath);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

function addText(slide, name, text, position, style = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name,
    position,
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    typeface: FONT.body,
    fontSize: 18,
    color: C.ink,
    alignment: "left",
    verticalAlignment: "top",
    autoFit: "shrinkText",
    wrap: "square",
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    ...style,
  };
  return shape;
}

function addRule(slide, name, position, color = C.rule, width = 1) {
  return slide.shapes.add({
    geometry: "line",
    name,
    position,
    fill: "none",
    line: { style: "solid", fill: color, width },
  });
}

function addSurface(slide, name, position, options = {}) {
  return slide.shapes.add({
    geometry: options.geometry ?? "rect",
    name,
    position,
    fill: options.fill ?? C.surface,
    line: {
      style: "solid",
      fill: options.lineColor ?? C.rule,
      width: options.lineWidth ?? 1,
    },
    borderRadius: options.borderRadius ?? 8,
    shadow: options.shadow ?? "shadow-none",
  });
}

function addPill(slide, name, text, position, options = {}) {
  const pill = addSurface(slide, name, position, {
    geometry: "roundRect",
    fill: options.fill ?? C.surface,
    lineColor: options.lineColor ?? C.rule,
    borderRadius: options.borderRadius ?? 999,
  });
  pill.text = text;
  pill.text.style = {
    typeface: FONT.body,
    fontSize: options.fontSize ?? 12,
    bold: options.bold ?? true,
    color: options.color ?? C.ink,
    alignment: "center",
    verticalAlignment: "middle",
    autoFit: "shrinkText",
    insets: { top: 2, right: 10, bottom: 2, left: 10 },
  };
  return pill;
}

function addFooter(slide, index, source) {
  addRule(
    slide,
    `footer-rule-${index}`,
    { left: 64, top: 676, width: 1152, height: 0 },
    C.rule,
    1,
  );
  addText(
    slide,
    `footer-source-${index}`,
    source,
    { left: 64, top: 686, width: 980, height: 18 },
    { fontSize: 10, color: C.muted, verticalAlignment: "middle" },
  );
  addText(
    slide,
    `footer-page-${index}`,
    String(index).padStart(2, "0"),
    { left: 1136, top: 686, width: 80, height: 18 },
    {
      typeface: FONT.mono,
      fontSize: 10,
      color: C.muted,
      alignment: "right",
      verticalAlignment: "middle",
    },
  );
}

async function addImage(
  slide,
  name,
  imagePath,
  position,
  fit = "cover",
  contentType = "image/png",
) {
  return slide.images.add({
    blob: await readImageBytes(imagePath),
    contentType,
    alt: name,
    fit,
    position,
    geometry: "roundRect",
    borderRadius: 8,
  });
}

function addArrow(slide, name, fromShape, toShape, options = {}) {
  const connector = slide.shapes.connect(fromShape, toShape, {
    kind: options.kind ?? "straight",
    fromSide: options.fromSide ?? "right",
    toSide: options.toSide ?? "left",
    line: {
      style: options.dashed ? "dashed" : "solid",
      fill: options.color ?? C.blue,
      width: options.width ?? 2,
    },
    head: {
      type: options.headType ?? "arrow",
      width: "sm",
      length: "sm",
    },
  });
  connector.name = name;
  return connector;
}
```

All primitives must:

- use explicit pixel geometry,
- assign stable names,
- use `typeface` in text styles,
- default to flat fills and one-pixel rules,
- avoid nested rounded cards.

- [ ] **Step 4: Render a one-slide typography fixture**

Create one temporary slide using the AOPS wordmark, display headline,
Montserrat body, a blue authority line, and a proof metric.

Export:

```text
tmp/preview/theme-fixture.png
tmp/layout/theme-fixture.layout.json
```

Expected: the render uses warm off-white, readable navy text, visible hierarchy,
and no fallback Calibri.

- [ ] **Step 5: Inspect the fixture before building all slides**

Check at original size for:

- wordmark crop,
- display-font availability,
- Montserrat body weight,
- minimum 16px non-footer text,
- rule and accent contrast.

## Task 5: Author Slides 1–4

**Files:**

- Modify: `/private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/build-deck.mjs`

- [ ] **Step 1: Build Slide 1 — Cover**

Use:

```text
Eyebrow: BUILD ON ARC · CHECKPOINT 2 · AGENTIC ECONOMY
Title: AOPS
Headline: Programmable authority for autonomous money.
Subhead: Give agents economic autonomy without giving them unrestricted authority.
Footer: AgenticOperations/AOPS-PMOA · feat/mcp-paid-http
```

Composition: transparent AOPS wordmark at top-left, large editorial headline,
and one thin authority-to-settlement path on the right. No black logo plate and
no screenshot collage.

- [ ] **Step 2: Build Slide 2 — Missing organizational layer**

Use one split field:

```text
Left: Circle primitives
Wallets · USDC · Gateway · x402

Right: Organizational authority
Roles · policy · approvals · budgets · emergency control · evidence
```

Connect the fields with a single blue AOPS control seam. Headline:

```text
Circle gives agents programmable money.
Organizations still need control.
```

- [ ] **Step 3: Build Slide 3 — Working progress**

Use a real overview/controls screenshot on the left and a seven-item proof rail
on the right:

```text
Role-level policy inheritance
Credentialed hosted MCP
Approval and spend controls
Real Circle USDC execution
Replay-safe paid HTTP
Hash-chained evidence
878 / 878 verification tests
```

Footer boundary:

```text
Current proof uses Circle-supported test rails. Arc-native settlement is next.
```

- [ ] **Step 4: Build Slide 4 — Governed execution workflow**

Draw one continuous horizontal path:

```text
Mandate → Credential → MCP intent → Policy + hold → Approve / deny
→ Circle execution → Service response → Evidence
```

Use blue only for allowed authority propagation, light blue for infrastructure,
and navy for policy boundaries. Avoid eight individual feature cards.

- [ ] **Step 5: Render Slides 1–4 and inspect**

Export each to `tmp/slides/slide-01.png` through `slide-04.png`.

Expected:

- cover readable in a thumbnail,
- Slide 2 communicates the product gap without a paragraph,
- Slide 3 exposes real proof in under ten seconds,
- Slide 4 can be followed left to right without reading footnotes.

## Task 6: Author Slides 5–8

**Files:**

- Modify: `/private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/build-deck.mjs`

- [ ] **Step 1: Build Slide 5 — Product surface**

Use three real UI crops and four aligned operating labels:

```text
DEFINE AUTHORITY
Organization · teams · roles · policy

OPERATE AGENTS
Registry · credentials · pause · deactivate

GOVERN MONEY
Treasury · budgets · approvals · rails

PROVE OUTCOMES
Operations · reconciliation · evidence
```

The screenshots form one wide product plane; do not put each crop inside a
separate feature card.

- [ ] **Step 2: Build Slide 6 — Circle-native architecture**

Draw:

```text
Agent
  ↓ MCP
AOPS authority plane
  ↓ authorized execution
Circle Agent Wallet · Gateway · x402
  ↓
Paid service
  ↘ response + reconciliation + evidence
```

Add a dominant Arc destination plane labelled:

```text
NEXT NATIVE ENVIRONMENT
Arc · USDC settlement · agent transactions
```

Place Base, Arbitrum, Polygon, Optimism, and Avalanche only in a small footer
caption:

```text
Current Circle-supported execution coverage
```

- [ ] **Step 3: Build Slide 7 — Next milestone**

Use a sequential five-step Arc delivery line:

```text
01 Arc Testnet settlement
02 Arc-aware wallet and Gateway execution
03 Governed paid-service flow on Arc
04 Production resilience and observability
05 Mission, provider, and outcome UX
```

Headline:

```text
Next: make Arc the native execution environment.
```

- [ ] **Step 4: Build Slide 8 — Company direction**

Use three horizons across one continuous baseline:

```text
NOW
Governed execution

NEXT
Arc-native economic operations

COMPANY
Authority, provider commerce, treasury orchestration, outcome evidence
```

Close with:

```text
Programmable money needs programmable authority.
github.com/AgenticOperations/AOPS-PMOA
feat/mcp-paid-http · tested code checkpoint add41aa
```

- [ ] **Step 5: Render Slides 5–8 and inspect**

Expected:

- Slide 5 looks like the AOPS product, not a generic feature grid.
- Slide 6 makes the honest current-vs-next boundary unmistakable.
- Slide 7 is a delivery sequence, not an aspirational cloud.
- Slide 8 leaves a company-scale thesis and a verifiable repository path.

## Task 7: Export the complete package

**Files:**

- Create: `submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2.pptx`
- Create: `submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2-cover.png`
- Create: `/private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/preview/deck-montage.webp`
- Create: `/private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/layout/slide-01.layout.json` through `slide-08.layout.json`

- [ ] **Step 1: Export every slide and layout**

Use:

```js
for (const [index, slide] of presentation.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, "0")}`;
  await writeBlob(`${SLIDES_DIR}/${stem}.png`,
    await presentation.export({ slide, format: "png", scale: 2 }));
  await fs.writeFile(`${LAYOUT_DIR}/${stem}.layout.json`,
    await (await slide.export({ format: "layout" })).text());
}
```

- [ ] **Step 2: Export the montage**

Use:

```js
await writeBlob(
  `${PREVIEW_DIR}/deck-montage.webp`,
  await presentation.export({ format: "webp", montage: true, scale: 1 }),
);
```

- [ ] **Step 3: Export PPTX**

Use:

```js
const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(FINAL_PPTX);
```

Expected final path:

```text
submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2.pptx
```

- [ ] **Step 4: Export Slide 1 as the checkpoint image**

Copy the final high-resolution Slide 1 PNG to:

```text
submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2-cover.png
```

## Task 8: Run visual, structural, and factual QA

**Files:**

- Read: all eight rendered PNGs.
- Read: all eight layout JSON files.
- Create: `/private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/qa/visual-qa.txt`

- [ ] **Step 1: Inspect the montage**

View the complete montage and check:

- deck-wide rhythm,
- title and footer consistency,
- proof-to-vision balance,
- absence of repetitive card grids,
- Arc emphasis without false current-state implication.

- [ ] **Step 2: Inspect every slide at original detail**

Check:

- text clipping,
- wordmark cropping,
- line wrapping,
- unreadable footers,
- distorted screenshots,
- misaligned arrows,
- detached labels,
- uneven whitespace,
- accidental nested borders.

- [ ] **Step 3: Inspect layout JSON**

Search:

```bash
rg -n -i 'overflow|clipped|warning|error|out.of.bounds' \
  /private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/layout
```

Expected: no unresolved layout defects.

- [ ] **Step 4: Verify PPTX structure and font references**

Run:

```bash
test -s submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2.pptx
unzip -p submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2.pptx \
  'ppt/slides/*.xml' | rg -o 'Montserrat|Iowan Old Style|Baskerville|Georgia' | sort -u
```

Expected:

- PPTX is non-empty.
- `Montserrat` appears.
- A deliberate display face appears; no silent Calibri-only export.

- [ ] **Step 5: Verify exact claim consistency**

Run:

```bash
rg -n '878/878|add41aa|feat/mcp-paid-http|Arc-native|Agentic Economy' \
  README.md submission/pmoa-checkpoint-2/README.md \
  /private/tmp/codex-presentations/pmoa-20260726/pmoa-checkpoint-2/tmp/source-notes.txt
```

Expected: all surfaces agree.

- [ ] **Step 6: Write `visual-qa.txt`**

For each slide record:

```text
Slide N — PASS/REVISE
Hierarchy:
Alignment:
Readability:
Claim boundary:
Asset provenance:
Fix applied:
```

Every slide must end at `PASS`.

- [ ] **Step 7: Rerender after every visual correction**

Do not export the final PPTX from stale in-memory content. Rebuild the complete
deck after fixes, rerender all eight slides, and repeat the montage check.

## Task 9: Commit, publish, and verify the judge path

**Files:**

- Add: `submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2.pptx`
- Add: `submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2-cover.png`
- Add: `submission/pmoa-checkpoint-2/README.md`
- Modify: `README.md`

- [ ] **Step 1: Run repository checks**

Run:

```bash
git diff --check
git status --short
```

Expected: only intended checkpoint submission files are modified or untracked.

- [ ] **Step 2: Commit final presentation assets**

Run:

```bash
git add README.md submission/pmoa-checkpoint-2
git commit -m "docs: add PMOA checkpoint 2 presentation"
```

- [ ] **Step 3: Confirm `main` remained untouched**

Run:

```bash
git -C /Users/18abhinav07/Documents/Brain/10-Projects/Web3-Builds/agentOps/BUILD-PMOA \
  status --short --branch
```

Expected:

```text
## main...origin/main
```

- [ ] **Step 4: Push the feature branch**

Run:

```bash
git push origin feat/mcp-paid-http
```

Expected: remote branch advances to the presentation commit.

- [ ] **Step 5: Make the repository public**

Run only after the deck and factsheet are committed and pushed:

```bash
gh repo edit AgenticOperations/AOPS-PMOA \
  --visibility public \
  --accept-visibility-change-consequences
```

- [ ] **Step 6: Verify the public branch and deck anonymously**

Verify:

```text
https://github.com/AgenticOperations/AOPS-PMOA/tree/feat/mcp-paid-http
https://github.com/AgenticOperations/AOPS-PMOA/blob/feat/mcp-paid-http/submission/pmoa-checkpoint-2/AOPS-PMOA-Checkpoint-2.pptx
https://github.com/AgenticOperations/AOPS-PMOA/blob/feat/mcp-paid-http/submission/pmoa-checkpoint-2/README.md
```

Expected: all return publicly without authentication.

- [ ] **Step 7: Final delivery**

Report:

- Public repository URL.
- Direct feature-branch URL.
- Presentation file URL and local path.
- Cover image local path.
- Fresh `878/878` verification result.
- Honest boundary: no public deployment required or claimed; Arc-native
  settlement remains the next milestone.
