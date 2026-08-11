# Arkiv Ideathon Submission — AOPS Governed Action Ledger

**Status:** design approved, ready to draft into the Tally form
**Track:** AI & DevTools (closes Aug 11, 23:59 UTC)
**Diagram:** https://claude.ai/code/artifact/725d930a-27c5-415c-bd8d-ee4cfcbf963d

## Idea

AOPS is the organizational control plane for autonomous agents: identity, policy,
budget, approval, and evidence for every economically-consequential action an agent
takes. AOPS's own README already describes this as a lifecycle —
`Intent → Identity → Policy → Budget → Approval → Execution → Settlement → Evidence` —
currently backed by Supabase/Postgres.

The submission proposes moving that lifecycle's system of record onto Arkiv: each
governed action becomes an Arkiv entity whose state transitions are queryable, and
whose human-approval step is a wallet-signed `changeOwnership()` transfer rather than
an editable status column in a database the AOPS operator alone controls.

**One-line pitch:** AOPS already governs what autonomous agents are allowed to spend
and with whom — Arkiv becomes its evidence and coordination layer, so every approval,
denial, and settlement is a queryable, wallet-owned, time-scoped record instead of a
private database row.

## Problem & audience

AOPS's evidence lifecycle currently lives in a database only the AOPS operator
controls. That's sufficient for a single organization inspecting its own agents, but
breaks down the moment agents cross organizational boundaries — one org's agent hiring
another org's agent (AOPS already supports second-hop delegation), or a counterparty
deciding whether to trust an unfamiliar agent (AOPS is building toward ERC-8004
reputation). No outside party can verify a decision was authorized, by whom, under
which policy, without trusting that operator's private database.

Audience: compliance/risk teams operating agent fleets, and counterparty agents or
services deciding whether to transact with an agent they don't already trust.

## Data model

### `GovernedAction` — one entity per governed action (payment, hire, escrow release, cross-chain call)

| Attribute | Type | Notes |
|---|---|---|
| `agentId` | string | acting agent identity |
| `orgId` | string | owning organization |
| `policyId` | string | key of the `PolicySnapshot` that authorized/evaluated this action |
| `actionType` | string | `payment` / `hire` / `escrow_release` / `cross_chain_call` |
| `counterpartyId` | string | other agent or service |
| `status` | string | `pending_approval` / `approved` / `denied` / `executing` / `settled` / `expired` |
| `riskTier` | numeric (0–3) | escalation tier |
| `amountUsd` | numeric | for threshold and range queries |
| `chain` | string | `arc` / `base` |
| `parentActionKey` | string | links a second-hop delegation to its parent action, no graph DB needed |

- Payload: full evidence bundle — intent text, budget-check result, approval trace, settlement tx hash.
- **Creator** = the agent wallet that initiated the action (immutable — proof of who acted).
- **Owner** = starts on the agent wallet. A human approval is a `changeOwnership()` call
  to the approver's wallet: the approval is a signed transfer of custody, not a status
  flag anyone with DB access could edit.
- `expiresIn`: short while `pending_approval` (stale, unclaimed requests drop off the
  inbox automatically); extended via `extendEntity()` once `settled`, to match the
  org's compliance retention window.

### `PolicySnapshot` — one entity per published policy version

| Attribute | Type | Notes |
|---|---|---|
| `orgId` | string | |
| `policyName` | string | |
| `version` | numeric | |
| `active` | numeric (0/1) | |
| `effectiveAtBlock` | numeric | |

- Payload: the policy JSON (limits, allowed counterparties, approval thresholds).
- **Creator** = the org-admin wallet that published it — immutable proof of who set the
  rule a `GovernedAction` is later judged against.
- Referenced by `GovernedAction.policyId`, so an action's authorizing policy is a
  lookup, not a foreign key in someone else's database.

## Key queries

1. **Approval inbox** — `.where(eq('orgId', X), eq('status','pending_approval'))`
2. **My approvals** — `.ownedBy(approverWallet)` — cryptographically the approver's own
   history, not a filter scoped by someone else's database permissions.
3. **Policy audit** — `.where(eq('policyId', 'policy-42-v3'))` — every action ever
   taken under one exact policy version.
4. **Delegation trace** — `.where(eq('parentActionKey', rootKey))` — reconstructs a
   second-hop hire chain without a graph database.
5. **Risk feed** — `.where(gt('riskTier', 1), eq('status','executing'))`
6. **Trust score** — `.where(eq('counterpartyId', X), eq('status','settled'))` — feeds
   an ERC-8004-style reputation score for a counterparty agent.

## Why Arkiv, not Postgres (the counterfactual)

- **Cross-org trust without a shared database.** When an agent from one org hires an
  agent from another, the second org shouldn't have to trust the first org's private
  table. Arkiv's `creator` field plus Ethereum anchoring gives both sides an
  independently verifiable record neither has to run an indexer to check.
- **Approval as ownership transfer** is a mechanic Postgres cannot express — a
  wallet-signed `changeOwnership()` gives non-repudiation an `approved_by` column
  never can.
- **Time-scoped by design** matches AOPS's own escrow-to-standing-relationship model
  (ERC-8183): a retention window is part of the schema (`expiresIn`,
  `extendEntity()`), not a cron job someone has to maintain.
- **No side indexer.** AOPS's agents already query this state across runs via MCP;
  Arkiv's built-in attribute indexes replace what would otherwise be Postgres plus a
  search index plus a sync job to keep it current with on-chain settlement.

## Scope — first buildable slice

Just the human-approval escalation path: AOPS's approval engine writes
`GovernedAction` entities to Arkiv instead of Postgres for any action crossing a
policy threshold. The approval UI is powered by query 1 (approval inbox) and query 2
(`ownedBy` history). Delegation tracing and the counterparty trust feed are the growth
story, not the MVP.

## Decisions made during brainstorming

- **Entity scope:** two entities (`GovernedAction` + `PolicySnapshot`), not one —
  chosen to show Arkiv modeling a real cross-entity reference (policy → action)
  without expanding past what a judge can skim in the time available.
- **Core mechanic:** approval-as-`changeOwnership()` was chosen over a plain
  Agent-Handoff-Queue retelling or a plain audit-log retelling, because it's the one
  piece of the pitch that couldn't be done the same way in an ordinary database — it
  directly answers "why Arkiv, not Postgres."
- **Visual:** one diagram artifact (entity model + lifecycle + query panel) was built
  to support the rubric's Data & Query Design (20 pts) and Clarity & Feasibility
  (15 pts) criteria; the ideathon submission explicitly allows an optional mock or
  diagram.
