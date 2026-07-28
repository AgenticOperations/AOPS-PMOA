---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [journey, payment, paid-service, x402]
---

# Journey: Governed Paid-Service Purchase

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/08-treasury-ledger-and-reconciliation|Treasury and ledger]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/10-financial-execution-and-adapters|Financial adapters]]

## Outcome

An agent purchases a permitted API, data product, or service through a certified adapter. AOPS binds the purchase to mission, policy, offer, approval, budget, signer, external settlement, delivery, ledger, reconciliation, and evidence.

## Flow

1. Runtime authenticates and persists the unpaid request as an action intent.
2. Pre-egress policy permits the target, method, data, and possible side effect.
3. Runtime sends the governed request.
4. Provider returns payment requirements or another recorded outcome.
5. Provider commerce resolves the verified provider, offer, destination, delivery terms, and quote expiry.
6. Policy evaluates exact price, fees, asset, destination, provider, network, mission, and budget context.
7. Approval service returns an action-bound grant when required.
8. Orchestrator preallocates the payment-attempt ID.
9. One atomic commit consumes the grant, holds amount plus bounded fees, and creates the prepared payment attempt with exact canonical request and provider/idempotency identity.
10. Signer verifies the committed grant, reservation, destination, network, and adapter. If it produces an externally executable signature, token, mandate, or debit instruction before dispatch, the attempt enters `authorization_ready` and persists the authorization hash/receipt, validity window, and revocation identity.
11. Dispatcher enters `dispatching` under a durable lease before the adapter performs irreversible I/O.
12. Adapter submits the payment/request.
13. Adapter records submitted, pending, unknown, authoritatively failed, or settled external truth.
14. Treasury posts balanced entries and consumes or retains the hold.
15. Provider delivers the resource; delivery is separately accepted or disputed.
16. Reconciliation verifies provider/network and ledger truth.
17. Runtime returns the resource and evidence reference.
18. Evidence seals the complete bundle.

## Invariants

- No payment without a held reservation.
- No signature without exact grant and adapter profile.
- No silent price, payee, network, asset, or provider substitution.
- Payment settlement does not prove delivery.
- Provider delivery does not prove ledger settlement.
- Response loss does not produce a second payment.
- Unknown retains its reservation.
- Signed or otherwise externally executable but undispatched authorization retains or quarantines its reservation until authoritative invalidation, expiry beyond every acceptance window, or reconciliation.

## Failure cases

- Payment requirements malformed: reject before reservation.
- Quote changes after approval: invalidate and reauthorize.
- Provider succeeds without requiring payment: record a nonfinancial delivery; do not invent payment evidence.
- Signer times out: preserve attempt state; determine whether signature/submission occurred.
- Mission cancellation or emergency stop after `authorization_ready`: block dispatch where possible, retain or quarantine the hold, and prove authorization invalidity or expiry before release.
- Payment settles but resource response is lost: replay returns retained result or performs delivery recovery without paying again.
- Resource not delivered: open refund/dispute workflow.
- Ledger post fails after external settlement: quarantine and reconcile; do not report complete.
- Evidence seal fails: return controlled result where safe, open incident, block certification.

## Required assertions

- Happy path with one economic effect and accepted delivery.
- Policy denial before first egress.
- Payment-policy denial after quote with no signature/payment.
- Human approval resume using the same intent.
- Ten concurrent calls under shared budget cannot overspend.
- Crash at intent, hold, attempt, submit, external acceptance, posting, delivery, and response.
- Duplicate/out-of-order webhook does not duplicate posting.
- Repeated agent request receives the existing outcome.
- Independent verifier reconstructs the journey.

## Exit criteria by applicability

- `CORE`: deterministic mock or sandbox proves the provider-neutral invariants, ambiguity windows, double entry, evidence, restore, and operator controls. This is sufficient for the Core gate result and grants no adapter or mainnet authority.
- `ADAPTER TESTNET`: the named adapter/provider/network/signer tuple passes conformance and external reconciliation in its non-production environment.
- `ADAPTER MAINNET`: the exact tuple passes a separately approved low-limit mainnet canary and external reconciliation.

Evidence never promotes from one applicability level to another.
