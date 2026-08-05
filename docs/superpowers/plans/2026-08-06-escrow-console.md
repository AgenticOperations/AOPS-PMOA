# Escrow Console and Trust UI Implementation Plan (Piece 4)

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an operator the screen where they read an external agent's on-chain escrow record, mark it trusted, and see it graduate to the Permit2 rail — and surface the evaluator-liveness trap before it costs a provider their work.

**Architecture:** Four presentational components in `apps/web/src/components/payments/`, following the existing prop-driven pattern (components receive data as props; no fetching inside, which is what makes them testable with plain React Testing Library). Wired into the existing treasury surface rather than a new page.

**Tech Stack:** Next.js App Router, React, TypeScript, vitest + @testing-library/react.

**Design doc:** `docs/superpowers/specs/2026-08-05-escrow-trust-graduation-design.md`
**Depends on:** piece 2 (`…-escrow-lifecycle-engine.md`) and piece 3 (`…-escrow-trust-graduation.md`) — the routes must exist.

---

## Context you need before starting

This is **piece 4 of 4**, the last one. Pieces 1–3 deployed the escrow contract, built the lifecycle engine, and built the trust engine plus routes.

### The story this UI has to tell

The payoff is a **contrast**, and the UI exists to make it legible:

| | Untrusted (escrow) | Trusted (Permit2) |
|---|---|---|
| Transactions per job | **5** | **1** |
| Capital | locked for the duration of the work | nothing locked |
| Who decides | a human reviewed the work and granted the checkmark | |

Same counterparty. The difference is trust, earned on-chain and granted by a person.

### Claim discipline — this is UI, so it is where overclaiming actually happens

- ✅ "Escrow proves the funds exist and cannot be silently withdrawn before the provider starts work."
- ❌ **Never** the words "neutral arbitration", "dispute", "appeal", or "arbiter." With `evaluator == client` the client decides release, and **there is no dispute path in ERC-8183 at all** — `reject` and `expire` are final. Do not build UI that implies otherwise.
- ✅ Say ERC-8183 is a **Draft** standard from the Ethereum Foundation + Virtuals Protocol, not Circle's, and that this is testnet.

### The evaluator-liveness trap — the one thing this UI must not hide

If the evaluator goes silent after `submit`, `claimRefund` refunds the **client** even though the work was delivered. The provider absorbs the loss, and on-chain `expired` is indistinguishable from `rejected`.

In our model the operator *is* the evaluator, so this is their own risk to manage. **Surfacing at-risk jobs is a required feature, not a nicety.** Piece 2 provides `listEscrowLivenessRisks`.

### Existing patterns — read before writing

| Pattern | Where |
|---|---|
| Prop-driven component, `'use client'`, chain labels, `EXPECTED_REJECTIONS` map for expected-state errors | `apps/web/src/components/payments/DelegateFromTreasury.tsx` |
| Test style — render with props, `fireEvent`, no network mocking | `apps/web/tests/payments/treasury-agent-access.test.tsx` |
| Chain rendering | `ChainMark.tsx`, `CopyableAddress.tsx` |
| Where treasury actions live | `TreasuryActionTabs.tsx`, `TreasuryAgentAccess.tsx` |

`CHAIN_LABELS` is `{ arc: 'Arc testnet', base: 'Base Sepolia' }` — reuse, don't redefine.

### Routes available from piece 3

```
GET  /v1/orgs/:orgId/payments/trust/:chain/:address
POST /v1/orgs/:orgId/payments/trust/:chain/:address          { label, ceilingUsdc, expiresAt }
POST /v1/orgs/:orgId/payments/trust/:chain/:address/revoke
```

### Running the web tests

```bash
cd apps/web
../../node_modules/.bin/vitest run tests/payments/trust-agent-panel.test.tsx
```

No database or Docker needed — these are pure component tests.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `apps/web/src/components/payments/TrustedBadge.tsx` | The checkmark itself. Tiny, reusable, accessible | **Create** |
| `apps/web/src/components/payments/EscrowJobList.tsx` | The on-chain track record — one row per job, explorer links | **Create** |
| `apps/web/src/components/payments/TrustAgentPanel.tsx` | Evidence + the promote/revoke action | **Create** |
| `apps/web/src/components/payments/EscrowLivenessBanner.tsx` | Submitted jobs approaching expiry | **Create** |
| `apps/web/tests/payments/trusted-badge.test.tsx` | | **Create** |
| `apps/web/tests/payments/escrow-job-list.test.tsx` | | **Create** |
| `apps/web/tests/payments/trust-agent-panel.test.tsx` | | **Create** |
| `apps/web/tests/payments/escrow-liveness-banner.test.tsx` | | **Create** |
| `apps/web/src/components/payments/TreasuryAgentAccess.tsx` | Mount the panel | Modify |

Four small components rather than one big one: each is independently testable, and the badge gets reused in lists where the full panel would not fit.

---

## Chunk 1: The checkmark and the record

### Task 1: `TrustedBadge`

**Files:**
- Create: `apps/web/src/components/payments/TrustedBadge.tsx`
- Create: `apps/web/tests/payments/trusted-badge.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders a trusted state with an accessible label', () => {
  render(<TrustedBadge trusted />);
  // Screen readers must get the meaning, not just a tick glyph.
  expect(screen.getByLabelText(/trusted/i)).toBeTruthy();
});

it('renders an untrusted state distinctly', () => {
  render(<TrustedBadge trusted={false} />);
  expect(screen.getByLabelText(/not trusted/i)).toBeTruthy();
});

it('never implies arbitration or dispute', () => {
  const { container } = render(<TrustedBadge trusted />);
  expect(container.textContent).not.toMatch(/arbitrat|dispute|appeal/i);
});
```

- [ ] **Step 2: Run, confirm failure, implement**

Do not signal state by colour alone — carry it in text or `aria-label` too.

- [ ] **Step 3: Run until green, commit**

```bash
git add apps/web/src/components/payments/TrustedBadge.tsx apps/web/tests/payments/trusted-badge.test.tsx
git commit -m "feat(web): add the trusted-agent badge"
```

---

### Task 2: `EscrowJobList`

**Files:**
- Create: `apps/web/src/components/payments/EscrowJobList.tsx`
- Create: `apps/web/tests/payments/escrow-job-list.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows each job with its state and budget', () => { /* ... */ });

it('distinguishes expired from rejected in the UI', () => {
  render(<EscrowJobList jobs={[expiredJob, rejectedJob]} chain="arc" />);
  // The chain refunds both identically; our evidence must not blur them,
  // because they mean different things to the human deciding on trust.
  expect(screen.getByText(/expired/i)).toBeTruthy();
  expect(screen.getByText(/rejected/i)).toBeTruthy();
});

it('links each job to the block explorer by tx hash', () => { /* ... */ });

it('renders an empty state rather than an empty table', () => {
  render(<EscrowJobList jobs={[]} chain="arc" />);
  expect(screen.getByText(/no escrow jobs yet/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run, confirm failure, implement**

Explorer bases: Arc `https://testnet.arcscan.app/tx/`, Base Sepolia `https://sepolia.basescan.org/tx/`.

- [ ] **Step 3: Run until green, commit**

```bash
git commit -m "feat(web): list an agent's on-chain escrow record"
```

---

## Chunk 2: The trust decision

### Task 3: `TrustAgentPanel`

The screen where the human actually decides.

**Files:**
- Create: `apps/web/src/components/payments/TrustAgentPanel.tsx`
- Create: `apps/web/tests/payments/trust-agent-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('disables the trust action when there is no settled history', () => {
  render(<TrustAgentPanel evidence={{ completedCount: 0, settledUsdc: '0.00', ... }} />);
  expect(screen.getByRole('button', { name: /trust this agent/i })).toHaveProperty('disabled', true);
});

it('requires a ceiling before promoting', () => {
  // The operator chooses how much authority to grant. There is no default
  // and no derived number -- that is the design decision (D-2/D-3).
  render(<TrustAgentPanel evidence={withHistory} />);
  fireEvent.click(screen.getByRole('button', { name: /trust this agent/i }));
  expect(screen.getByText(/enter a ceiling/i)).toBeTruthy();
});

it('shows the cost contrast so the operator knows what trust buys', () => {
  render(<TrustAgentPanel evidence={withHistory} />);
  expect(screen.getByText(/5 transactions/i)).toBeTruthy();
  expect(screen.getByText(/1 transaction/i)).toBeTruthy();
});

it('offers revoke when already trusted', () => { /* ... */ });

it('explains that there is no dispute path', () => {
  render(<TrustAgentPanel evidence={withHistory} />);
  // Stating the limit plainly is required; implying an appeal exists is
  // the overclaim this project exists to avoid.
  expect(screen.getByText(/no dispute path/i)).toBeTruthy();
});

it('maps expected rejections to specific guidance, not a generic failure', () => {
  render(<TrustAgentPanel evidence={withHistory} error="trust_requires_escrow_history" />);
  expect(screen.getByText(/complete at least one escrow job/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run, confirm failure, implement**

Follow `DelegateFromTreasury`'s `EXPECTED_REJECTIONS` pattern for `trust_requires_escrow_history` and `agent_already_trusted` — these are configured states, not faults, and deserve specific wording.

- [ ] **Step 3: Run until green, commit**

```bash
git commit -m "feat(web): add the trust-agent review and promotion panel"
```

---

### Task 4: `EscrowLivenessBanner`

**Files:**
- Create: `apps/web/src/components/payments/EscrowLivenessBanner.tsx`
- Create: `apps/web/tests/payments/escrow-liveness-banner.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('warns when submitted jobs are approaching expiry', () => {
  render(<EscrowLivenessBanner atRisk={[jobExpiringIn2h]} />);
  expect(screen.getByRole('alert')).toBeTruthy();
});

it('explains who actually loses if the evaluator stays silent', () => {
  render(<EscrowLivenessBanner atRisk={[jobExpiringIn2h]} />);
  // The provider delivered and gets refunded against. Naming that plainly
  // is the entire point of the banner.
  expect(screen.getByText(/provider/i)).toBeTruthy();
  expect(screen.getByText(/refund/i)).toBeTruthy();
});

it('renders nothing when no job is at risk', () => {
  const { container } = render(<EscrowLivenessBanner atRisk={[]} />);
  expect(container.firstChild).toBeNull();
});
```

- [ ] **Step 2: Run, confirm failure, implement**

Use `role="alert"`. Each row links to the job and shows time remaining.

- [ ] **Step 3: Run until green, commit**

```bash
git commit -m "feat(web): warn on evaluator-liveness risk"
```

---

## Chunk 3: Wire it up

### Task 5: Mount into the treasury surface

**Files:**
- Modify: `apps/web/src/components/payments/TreasuryAgentAccess.tsx`
- Modify: `apps/web/tests/payments/treasury-agent-access.test.tsx`

- [ ] **Step 1: Read the current component and its test**

Follow the existing prop-threading; do not introduce a new data-fetching approach.

- [ ] **Step 2: Add a failing test asserting the panel appears for external agents**

- [ ] **Step 3: Wire the panel and banner in, threading data from the piece 3 routes**

- [ ] **Step 4: Run the payments web suite**

```bash
cd apps/web && ../../node_modules/.bin/vitest run tests/payments/
```

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git commit -m "feat(web): surface escrow trust in the treasury console"
```

---

### Task 6: Walk the whole demo and record it

- [ ] **Step 1: Run the app**

- [ ] **Step 2: Walk the full narrative end to end**

Untrusted agent → escrow job → fund → submit → complete → repeat → review the record → **click Trust** → confirm the delegation opened → run a Permit2 drawdown job → confirm it took one transaction.

- [ ] **Step 3: Capture the contrast as evidence**

Record tx counts and hashes for both paths in `docs/spike-results.md` under "Piece 4 — trust graduation demo".

- [ ] **Step 4: Commit**

```bash
git add docs/spike-results.md
git commit -m "docs: record the escrow-to-Permit2 graduation demo"
```

---

## Done Criteria

- [ ] Badge carries meaning in text/`aria-label`, not colour alone
- [ ] Job list distinguishes **expired** from **rejected**
- [ ] Every job links to a real block-explorer tx
- [ ] Trust action disabled without settled history
- [ ] Operator must choose a ceiling — no default, no derived number
- [ ] Cost contrast (5 tx vs 1 tx) visible
- [ ] Revoke offered when already trusted
- [ ] "No dispute path" stated plainly
- [ ] Expected rejections get specific guidance, not a generic failure
- [ ] Liveness banner uses `role="alert"`, names who loses, renders nothing when empty
- [ ] **No UI text anywhere matches `/arbitrat|dispute resolution|appeal/i`** except the explicit "no dispute path" disclosure
- [ ] `pnpm typecheck` and `pnpm lint` clean
- [ ] Full demo walked and recorded

## Explicitly out of scope

- ERC-8004 identity resolution or on-chain reputation writes (`[D4]`/`[D5]`)
- Mainnet
- Automatic promotion of any kind
- Moving escrow upgrade authority off the piece 1 deployer key — tracked separately
