---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [domain, wallets, keys, signing, custody, kms]
---

# Wallet, Key, Signing, and Custody

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/domains/08-treasury-ledger-and-reconciliation|Treasury and ledger]] | [[10-Projects/Web3-Builds/agentOps/architecture/archive/signing-and-storage|Historical signing design]]

## Scope and ownership

This domain owns wallet/account bindings, provider account references, key references, signing policies, signing workers, custody profiles, attestation, signing receipts, key rotation, destination fences, and maximum-loss boundaries.

It does not decide whether an action is allowed, own the financial reservation, choose a provider offer, or interpret settlement truth.

## Custody profiles

AOPS supports explicitly different profiles rather than pretending one wallet topology fits every customer:

1. `customer_provider_account` — customer owns the provider/custody account; AOPS receives scoped execution access.
2. `customer_managed_key` — customer KMS/HSM/MPC controls keys; AOPS submits approved intents.
3. `provider_managed_agent_wallet` — provider provisions agent-scoped wallets and policies.
4. `allocated_float_wallet` — bounded wallet/subaccount per agent or workload, replenished asynchronously.
5. `shared_treasury_signer` — shared tenant wallet controlled by AOPS policy; highest blast radius and not default for unrestricted production.
6. `testnet_session` — encrypted local/provider session for non-production proof only.

Each release certificate names one profile and its loss bound. No profile inherits certification from another.

## Required product capabilities

- Connect and verify customer wallet/custody/provider account.
- Discover supported chains/assets and provider capabilities.
- Bind wallets/accounts to organization and environment.
- Define signer policy over operation, asset, destination, amount, network, contract, function, and expiry.
- Require decision, grant, reservation, and adapter canonical intent before signing.
- Keep raw keys unavailable to the control plane and model.
- Use per-tenant KMS/HSM/MPC/provider isolation for every live-money profile. A shared technology control plane may operate those isolated identities, but one tenant's authority must not sign for another tenant.
- Rotate master/envelope keys, provider tokens, signer identities, and wallets.
- Record key/version ID and signing receipt.
- Separate treasury allocation authority from agent external-spend authority.
- Suspend signer/profile and support controlled recovery.
- Quantify exposure for each compromise scenario.

## Signing flow

1. Financial execution constructs a canonical intent.
2. Signer authenticates calling service and tenant.
3. Signer verifies grant, reservation, policy epoch, adapter profile, destination, amount, asset, network, and operation.
4. Signer verifies its own independent policy.
5. KMS/HSM/custody provider signs without exposing raw key.
6. Signer returns signature or signed envelope plus key ID, policy version, request hash, attestation, and time.
7. Submission occurs only through the certified adapter/relay.

The signer never accepts arbitrary opaque calldata without a decoded, allowlisted semantic contract.

## Wallet topology decision

The current product uses organization-scoped Circle/Gateway and chain-level wallet concepts because earlier per-agent wallet paths had practical limitations. The production design does not assume that choice is permanent.

Before implementation, an ADR must compare:

- Provider-supported per-agent wallet.
- Per-agent allocated float.
- Tenant-shared wallet with software subledger.
- Customer-controlled signer.
- Provider/custody subaccounts.

The decision is made by loss bound, latency, funding/rebalancing cost, provider support, reconciliation, recovery, operational complexity, and jurisdiction—not UI convenience.

The custody, signer, tenant-isolation, runtime-bypass, ledger, and evidence-integrity spikes are prerequisites to implementation of the live-money signing slice. They are not deferred implementation details. If none of the evaluated profiles can enforce the certified per-tenant and aggregate loss bounds, mainnet work remains blocked.

## Key lifecycle

```text
planned → provisioned → active → rotating → retired
                                 ↘ compromised → revoked
```

Rotation includes dual-read/controlled-sign overlap, key identifier on every ciphertext/signature, migration evidence, rollback rule, and final old-key disablement. A static environment master key without versioning is not production sufficient.

## Failure behavior

- KMS/provider unavailable: new signing stops; submitted work reconciles.
- Signer returns unknown: no automatic second signature unless first is proven unused.
- Key compromised: revoke profile, stop new grants, inventory affected attempts, rotate, reconcile, notify, and recertify.
- Destination mismatch: deny before signing.
- Provider changes chain/contract: execution-profile gate result and dependent release certificates invalidate.
- Signing receipt not persisted: do not submit; if submission may have occurred, create unknown incident.
- Shared signer exposure exceeds certified limit: production profile revoked.

## Requirements

- `AOPS-SGN-001` (`S0`): Raw private keys MUST NOT be available to agents, prompts, general API hosts, or logs.
- `AOPS-SGN-002` (`S0`): Signing MUST require exact grant, reservation, adapter, and semantic-intent binding.
- `AOPS-SGN-003` (`S0`): Every signer profile MUST publish maximum loss for each compromise case.
- `AOPS-SGN-004` (`S0`): Cross-tenant signing authority MUST be cryptographically or provider-isolated.
- `AOPS-SGN-005` (`S0`): Arbitrary opaque calldata signing MUST be prohibited.
- `AOPS-SGN-006` (`S1`): Keys and encrypted material MUST carry version identifiers and tested rotation.
- `AOPS-SGN-007` (`S0`): Destination/key/policy widening MUST use dual control.
- `AOPS-SGN-008` (`S0`): Signing uncertainty MUST preserve the attempt and reservation.
- `AOPS-SGN-009` (`S0`): A live-money signer MUST reject stale or revoked release-certificate epochs at the signing boundary.

## Verification and exit gate

- Custody and data-flow review.
- Maximum-loss analysis for every compromise scenario.
- Per-tenant key/provider isolation test.
- Semantic-intent and destination substitution tests.
- Arbitrary-call negative suite.
- Key and provider-token rotation drills.
- KMS outage and signer restart chaos.
- Compromise containment tabletop.
- Signing receipt/evidence reconstruction.
- Low-limit mainnet canary for the exact signer profile.
