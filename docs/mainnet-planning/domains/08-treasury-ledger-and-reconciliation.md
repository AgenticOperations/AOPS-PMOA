---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [domain, treasury, ledger, reconciliation, accounting]
---

# Treasury, Ledger, and Reconciliation

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/02-canonical-kernel|Canonical kernel]] | [[10-Projects/Web3-Builds/agentOps/creative-free/06-autonomous-treasury-controller|Prior treasury design]]

## Scope and ownership

This domain owns internal accounts, budgets, allocations, reservations, balanced journal entries, balances, fees, FX records, reconciliation cases, accounting periods, corrections, and financial reporting.

It does not own private keys, external submission, provider delivery, or the provider/network source of truth.

## Required product capabilities

- Organization, environment, team, mission, agent, provider, asset, fee, and clearing accounts.
- Exact integer amounts with explicit asset, unit, decimals, network, and valuation metadata.
- Time-windowed budgets and allocations.
- Reservation, consumption, release, expiry, and quarantine.
- Double-entry journal and immutable postings.
- Fees, gas, tax, FX, spread, refunds, reversals, disputes, and write-offs.
- Internal balance and available-to-spend projections.
- Daily external reconciliation by provider/account/network/asset.
- Exception aging, assignment, investigation, and resolution.
- Period close and immutable correction.
- Ledger rebuild and independent balance verification.
- Export to accounting and audit systems.
- Liquidity planning based on ledger truth, never model-authored signing.

## Chart-of-accounts model

At minimum:

- Treasury asset.
- Provider/wallet asset.
- Agent or mission allocation.
- Reserved funds.
- Clearing/pending settlement.
- Expense by service/category.
- Fees and gas.
- Refund receivable.
- Dispute receivable/liability.
- FX gain/loss.
- Reconciliation suspense.

Account keys include organization, environment, asset, and purpose. Unrelated tenants never share a balance account.

## Reservation lifecycle

```text
proposed → held → consumed
                ↘ released
                ↘ expired
                ↘ quarantined
quarantined → consumed
            ↘ released
```

Reservation is created before external submission and references mission, decision, grant, action, preallocated payment-attempt ID, amount, maximum fees, and expiry policy. Grant consumption, reservation creation, and prepared payment-attempt creation share one atomic commit boundary.

Rules:

- Available budget equals ceiling minus settled consumption minus live holds.
- Authorization-ready, dispatching, submitted, or unknown attempts retain or quarantine holds.
- Hold validity covers the adapter’s complete payment validity and finality window.
- Release requires proof that no external economic effect can still occur.
- Reservation expiry is not a substitute for reconciliation.
- `expired` is allowed only when the reservation was never connected to an externally executable authorization or irreversible submission and the complete external authorization-validity window is proven closed. Authorization-ready, `dispatching`, submitted, or unknown attempts cannot expire locally.
- Quarantine is a nonterminal exposure classification. It resolves to `consumed` with authoritative effect/settlement proof or `released` with authoritative proof that no authorization can still be accepted and no economic effect occurred.

## Double-entry lifecycle

Every economic event produces one balanced journal entry:

- Allocate.
- Reserve.
- Submit/clear.
- Settle.
- Release.
- Fee.
- Refund.
- Reverse.
- Dispute.
- Correct.

Entries and postings are append-only. A correction references the prior entry and posts the economic inverse or adjustment. Monetary values are never floating point.

### Normative posting matrix

The ledger distinguishes economic general-ledger accounts from balanced control/memorandum accounts used for budgets and reservations. Every row is idempotently bound to one business-event identity.

| Event | Debit | Credit | Required dimensions and rule |
|---|---|---|---|
| Treasury funded | Treasury/provider asset | Funding source or contributed capital/liability | Tenant, environment, asset, network, external receipt |
| Internal allocation | Available allocation control | Unallocated authority control | No asset movement; ceiling and period are explicit |
| Reservation held | Reserved commitment control | Available allocation control | Amount plus maximum fee/gas envelope |
| Reservation released/expired | Available allocation control | Reserved commitment control | Only with no-effect proof; never for submitted/unknown |
| Reservation quarantined | Quarantined commitment control | Reserved commitment control | Control-account reclassification only; capacity remains unavailable |
| Quarantined reservation released | Available allocation control | Quarantined commitment control | Only with authoritative no-effect and no-valid-authorization proof |
| Reservation consumed | Consumed allocation control | Reserved or quarantined commitment control | Authoritative economic effect; consumed capacity remains counted for its budget window |
| Provider/wallet prefund | Provider/wallet asset | Treasury asset | External transfer reference and finality |
| Payment submitted | Settlement clearing asset | Provider/wallet asset | Only where the rail economically debits at submission; otherwise memo state only |
| Service settlement | Service/category expense | Settlement clearing or provider/wallet asset | Provider, offer, mission, agent, asset, external ID |
| Fee/gas settlement | Fee/gas expense | Provider/wallet or treasury asset | Actual fee; unused reserved envelope is released separately |
| Partial capture | Service expense plus fee expense | Settlement clearing or provider/wallet asset | Captured amount only; remaining reservation stays held or is authoritatively released |
| Refund initiated | Refund receivable | Service expense reversal or provider receivable | Original settlement identity required |
| Refund received | Treasury/provider asset | Refund receivable | External refund receipt required |
| Dispute opened | Dispute receivable or restricted asset | Provider/wallet asset or dispute liability | Provider status and exposure class |
| Reversal/reorg | Reversal/correction account | Original economic account | Append-only inverse; original entry remains |
| Write-off | Loss/write-off expense | Receivable or suspense | Dual approval and incident/evidence reference |
| Reconciliation difference | Reconciliation suspense | Relevant external/internal account | Never closes without identified disposition |

Account normal balances, asset/expense/liability classification, network-finality treatment, FX valuation, and tax mapping are versioned per market and adapter profile. A posting rule change is a material ledger-schema change and invalidates dependent certificates.

## Reconciliation

Reconciliation compares:

- Internal attempt and ledger state.
- Provider transaction and balance state.
- Wallet/chain transaction, logs, confirmations, and finality.
- Facilitator or payment-processor receipt.
- Provider delivery/refund/dispute status.

Cases are:

```text
open → investigating → resolved
                     ↘ escalated
```

Resolution records authoritative evidence, ledger correction, reservation disposition, customer impact, approver, and root cause. Zero unexplained monetary difference is required at the certified cutoff.

## Concurrency

Budget and reservation operations use serializable transactions, account-level sequence/locking, or equivalent invariant-preserving logic. Concurrent sibling agents share the same organization/mission ceilings without double allocation. Idempotency binds each economic event to one business identity.

## Failure behavior

- Atomic grant/hold/attempt transaction aborts: none of the three becomes visible or executable.
- Commit succeeds but response is lost: replay returns the same hold and payment attempt.
- Crash after submission: hold remains and attempt becomes unknown.
- Duplicate webhook: no duplicate posting.
- Reorg or reversal: append correcting entry.
- Provider balance unavailable: reconciliation remains open; do not claim balanced external truth.
- Ledger imbalance: immediately stop affected money profile.
- Restore: rebuild projections, reconcile unknowns, and verify balances before reopening.
- Currency/decimal mismatch: reject before posting.

## Requirements

- `AOPS-LED-001` (`S0`): Every economic event MUST create balanced immutable postings.
- `AOPS-LED-002` (`S0`): Monetary amounts MUST use exact integers and explicit asset units.
- `AOPS-LED-003` (`S0`): Limits MUST include settled consumption and outstanding holds.
- `AOPS-LED-004` (`S0`): Authorization-ready, dispatching, submitted, and unknown attempts MUST retain or quarantine reservations until authoritative resolution.
- `AOPS-LED-005` (`S0`): History MUST be corrected through new entries, never mutation.
- `AOPS-LED-006` (`S0`): Duplicate external events MUST NOT create duplicate postings.
- `AOPS-LED-007` (`S0`): Internal balances MUST reconcile to authoritative external truth.
- `AOPS-LED-008` (`S0`): Unexplained monetary difference MUST revoke affected production profile.
- `AOPS-LED-009` (`S1`): Full ledger rebuild MUST reproduce balances and evidence links.
- `AOPS-LED-010` (`S0`): Reservation release or expiry MUST require proof that no irreversible submission, economic effect, or still-valid externally executable authorization exists; quarantined reservations MUST resolve only through authoritative consume-or-release evidence.
- `AOPS-LED-011` (`S0`): Every supported economic event MUST map to an approved debit/credit posting rule before the adapter is certifiable.

## Verification and exit gate

- Chart-of-accounts review.
- Balance invariant and property tests.
- Ten/hundred concurrent-agent budget tests.
- Duplicate and changed-payload idempotency tests.
- Crash injection at every reservation/attempt/posting boundary.
- Refund, fee, reversal, dispute, reorg, and correction fixtures.
- Migration balance proof.
- Full rebuild and hash comparison.
- Daily provider/network reconciliation.
- Exception-aging dashboard and runbook.
- Isolated backup restore with unknown attempts and holds.
