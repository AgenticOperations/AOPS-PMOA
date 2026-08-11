# Arkiv Ideathon Submission — AOPS Governed Action Ledger

**Status:** field-mapped to the actual Tally form, ready to submit
**Track:** AI & DevTools (closes Aug 11, 23:59 UTC)
**Diagram:** https://claude.ai/code/artifact/725d930a-27c5-415c-bd8d-ee4cfcbf963d

## Final answers, mapped to the Tally form fields

The form (`tally.so/r/OD9eeY`) has dedicated fields beyond what an initial WebFetch
surfaced — separate entries for entities/attributes, queries, expiry/extension/
ownership, the Arkiv counterfactual, and what stays off Arkiv, plus a required
question on whether the Ideathon MCP was used. Answers below map 1:1 to those fields;
everything else in this doc is the underlying design they're drawn from.

- **Idea name:** AOPS Governed Action Ledger
- **One-line pitch:** AOPS already governs what autonomous agents are allowed to spend
  and with whom — Arkiv becomes its evidence and coordination layer, so every approval,
  denial, and settlement is a queryable, wallet-owned, time-scoped record instead of a
  private database row.
- **Problem & audience:** see "Problem & audience" section below.
- **Scope — weekend slice + honest risks** (800-char form limit — this is the exact
  text to paste):

  > Weekend slice: point one AOPS approval-escalation path at Arkiv. On escalation,
  > createEntity() a GovernedAction ($owner=agent, status=pending_approval, short
  > expiresIn). Build an inbox — where(eq(orgId,X), eq(status,'pending_approval')) —
  > with Approve/Deny. Approve = one mutateEntities batch: changeOwnership() to
  > approver + updateEntity() setting status=approved, atomically. Add
  > ownedBy(approverWallet) for "my approvals". Prove by hand: raise 3 actions,
  > approve one, deny one, let one expire unclaimed.
  >
  > Risks: (1) changeOwnership()/updateEntity() are separate writes — batching
  > required, since cross-tx ops aren't guaranteed ordering. (2) Proves the
  > mechanic, not cross-org trust — agentId is operator-asserted, not yet
  > verifiable without a real identity registry (ERC-8004), out of scope here.
- **Track:** AI & DevTools
- **Entities & attributes** (limit 1220 chars — text below is 1034):

  > GovernedAction — one per governed action (payment, hire, escrow release,
  > cross-chain call). Attributes: agentId (string), orgId (string), policyId
  > (string, shared key -> PolicySnapshot), actionType (string), counterpartyId
  > (string), status (string: pending_approval/approved/denied/executing/settled/
  > expired), riskTier (numeric 0-3), amountCents (numeric, integer fixed-point
  > USD — range queries need integers), chain (string), parentActionKey (string,
  > links a delegation to its parent, no graph DB needed). Payload: evidence
  > bundle (intent text, budget-check summary, approval trace, tx hash). $creator
  > = initiating agent wallet (immutable). $owner = agent -> approver via
  > changeOwnership().
  >
  > PolicySnapshot — one per published policy version. Attributes: orgId
  > (string), policyName (string), version (numeric), active (numeric 0/1),
  > effectiveAtBlock (numeric). Payload: policy JSON (limits, thresholds).
  > $creator = org-admin wallet. Referenced by GovernedAction.policyId — Arkiv
  > has no joins, so this shared key is the relationship.

- **The queries you rely on** (limit 1000 chars — text below is 627):

  > Approval inbox: where(eq(orgId,X), eq(status,'pending_approval')), paginated
  > by cursor, sorted client-side by riskTier (no server-side ORDER BY). My
  > approvals: ownedBy(approverWallet). Policy audit:
  > where(eq(policyId,'policy-42-v3')) — every action under one exact policy
  > version, for compliance review. Delegation trace:
  > where(eq(parentActionKey,rootKey)) — reconstructs a second-hop hire chain
  > via a shared key, no graph DB. Risk feed: where(gt(riskTier,1),
  > eq(status,'executing')). Trust score: count(where(eq(counterpartyId,X),
  > eq(status,'settled'))) — a dashboard number, not a full fetch, feeding
  > counterparty reputation.

- **Expiry, extension & ownership** (limit 1000 chars — text below is 720):

  > A pending_approval GovernedAction gets a short expiresIn — an unclaimed
  > request genuinely drops off the inbox; expiry is a guarantee, not a cron
  > job. Once settled, extendEntity() renews it to match the org's compliance
  > retention window; an active PolicySnapshot is renewed the same way for as
  > long as it governs live actions, then allowed to lapse. Ownership is the
  > core mechanic: $owner starts on the initiating agent's wallet, and a human
  > approval is a changeOwnership() transfer to the approver — the approval
  > itself is the on-chain event, not an editable status column. $creator stays
  > immutable, so it's always verifiable who actually initiated an action or
  > published a policy, independent of who currently holds it.

- **Why Arkiv, not a plain database?** (limit 700 chars — text below is 678):

  > When an agent from one org hires an agent from another, the second org
  > shouldn't have to trust the first org's private table — $creator plus
  > Ethereum anchoring gives both sides an independently verifiable record
  > neither has to run an indexer to check. Approval-as-changeOwnership() is a
  > mechanic a conventional database can't express: real non-repudiation, not
  > an approved_by column anyone with DB access could edit. Time-scoping
  > matches AOPS's own escrow-to-standing-relationship model as a schema
  > feature, not an ops burden. AOPS's agents already query this state across
  > runs via MCP — Arkiv's built-in attribute indexes replace a database plus a
  > search index plus a sync job.

- **What stays off Arkiv?** (limit 2000 chars — text below is 452):

  > Settlement execution itself — the Permit2 transfer or cross-chain call
  > still runs on Arc/Base; GovernedAction holds the tx hash as evidence, not
  > the execution path, since Arkiv never executes logic. Secrets, credentials,
  > and raw counterparty PII never enter the payload, since entities are public
  > by design. Full policy-engine logs and raw agent traces are hashed and
  > referenced by pointer, not embedded — Arkiv holds the evidence record, not
  > the blob.

- **Used the Ideathon MCP?** Yes — connected `arkiv-ideathon`, used `get_doc`
  (`arkiv-fundamentals`, `rubric`) and `review_my_idea` to pressure-test and correct the
  schema (see "Verified against the Ideathon MCP" below).
- **Did you use the Arkiv MCP or docs?** (limit 2000 chars — text below is 409):

  > Used the Ideathon MCP's get_doc (arkiv-fundamentals, rubric) and
  > review_my_idea, plus docs.arkiv.network directly. Hardest part: realizing
  > amountUsd needed to become amountCents, since range-queryable attributes
  > must be integers — and that updateEntity is a full replace, not a patch,
  > which forced designing changeOwnership() + updateEntity() as one atomic
  > mutateEntities batch instead of two separate writes.

- **Sketch/diagram:** the artifact URL above.
- **Video walkthrough / X post:** left to the user — not something to generate on their
  behalf.

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
| `amountCents` | numeric (integer) | USD amount in cents — fixed-point, since Arkiv numeric attributes must be integers and this is the field threshold/range queries run on |
| `chain` | string | `arc` / `base` |
| `parentActionKey` | string | links a second-hop delegation to its parent action, no graph DB needed |

- Payload: evidence bundle metadata — intent text, budget-check result summary, approval
  trace, settlement tx hash. Large artifacts (full policy-engine logs, raw LLM traces) are
  hashed and referenced by pointer, not embedded — see "What stays off Arkiv" below.
- **`$creator`** = the agent wallet that initiated the action (immutable — proof of who acted).
- **`$owner`** = starts on the agent wallet. A human approval is a `changeOwnership()` call
  to the approver's wallet: the approval is a signed transfer of custody, not a status
  flag anyone with DB access could edit.
- `expiresIn`: short while `status = pending_approval` (stale, unclaimed requests drop off
  the inbox automatically); extended via `extendEntity()` once `settled`, to match the
  org's compliance retention window.
- **Write ownership**: `updateEntity` is a full replace, not a patch, so `status`
  transitions (`executing` → `settled`) are read-modify-write operations. AOPS's approval
  engine is the single authoritative writer for each `GovernedAction` — no other AOPS
  service writes to the same entity — which sidesteps the race that a full-replace API
  creates when two writers touch one entity concurrently.

### `PolicySnapshot` — one entity per published policy version

| Attribute | Type | Notes |
|---|---|---|
| `orgId` | string | |
| `policyName` | string | |
| `version` | numeric | |
| `active` | numeric (0/1) | |
| `effectiveAtBlock` | numeric | |

- Payload: the policy JSON (limits, allowed counterparties, approval thresholds).
- **`$creator`** = the org-admin wallet that published it — immutable proof of who set the
  rule a `GovernedAction` is later judged against.
- Referenced by `GovernedAction.policyId`, so an action's authorizing policy is a
  lookup, not a foreign key in someone else's database.
- **Lifetime**: long-lived and renewed via `extendEntity()` while `active = 1` — a policy
  stays queryable for as long as it governs live actions. When a new version is published,
  the old `PolicySnapshot` is superseded (`active` flips to `0`) but is deliberately **not**
  deleted or left to expire while any `GovernedAction` still references it by key — Arkiv
  has no joins or cascades, so a `GovernedAction` whose `policyId` pointed at an expired
  entity would be unauditable. Once every action under a policy version is `settled` or
  `expired`, that `PolicySnapshot` is allowed to lapse.

## Key queries

1. **Approval inbox** — `.where(eq('orgId', X), eq('status','pending_approval'))`
2. **My approvals** — `.ownedBy(approverWallet)` — cryptographically the approver's own
   history, not a filter scoped by someone else's database permissions.
3. **Policy audit** — `.where(eq('policyId', 'policy-42-v3'))` — every action ever
   taken under one exact policy version.
4. **Delegation trace** — `.where(eq('parentActionKey', rootKey))` — reconstructs a
   second-hop hire chain without a graph database.
5. **Risk feed** — `.where(gt('riskTier', 1), eq('status','executing'))`, sorted
   client-side by `riskTier` descending — Arkiv has no server-side `ORDER BY`, so the
   inbox and risk feed both filter first (which is selective) and sort the small result
   after fetching.
6. **Trust score** — `.where(eq('counterpartyId', X), eq('status','settled'))` — feeds
   an ERC-8004-style reputation score for a counterparty agent. Read as a `count()` for
   a dashboard tile rather than fetching every matching entity.

## What stays off Arkiv

- **Settlement execution itself.** Arkiv stores and answers queries; it never executes
  logic. The actual payment/settlement (Permit2 transfer, cross-chain call) happens on
  Arc/Base as it does today — `GovernedAction` holds the evidence of that execution
  (the tx hash), not the execution path itself.
- **Secrets and PII.** Entities are public and verifiable by design. Policy internals
  that must stay private, raw counterparty PII, and API credentials never go in the
  payload — only hashes/commitments or non-sensitive summaries do.
- **Large artifacts.** Full policy-engine logs or raw agent traces are hashed and
  referenced by pointer in the payload, not embedded — Arkiv holds the evidence record,
  not the underlying blob.

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

## Verified against the Ideathon MCP (2026-08-11)

Once `arkiv-ideathon` connected, `get_doc('arkiv-fundamentals')`, `get_doc('rubric')`,
and `review_my_idea` surfaced fixes applied above:

- Numeric attributes must be integers — `amountUsd` became `amountCents` (fixed-point).
- System fields are `$creator` / `$owner` (dollar-prefixed), not bare names.
- `updateEntity` is a full replace, not a patch — noted the single-authoritative-writer
  answer for `GovernedAction` status transitions to avoid a read-modify-write race.
- No server-side `ORDER BY` — the risk feed and inbox filter first, sort client-side.
- `PolicySnapshot` needed its own differentiated lifetime story (rubric criterion 3
  explicitly rewards differentiated lifetimes per entity type, not one blanket expiry).
- Added an explicit "what stays off Arkiv" section — the rubric's Arkiv-fit criterion
  names this as what separates a 3 from a 5.
