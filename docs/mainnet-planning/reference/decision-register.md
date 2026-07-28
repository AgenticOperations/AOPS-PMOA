---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [decisions, adr, architecture, mainnet]
---

# Decision Register

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/decision-log|Historical decision log]] | [[10-Projects/Web3-Builds/agentOps/creative-free/11-category-reset-and-product-kernel|Product kernel]]

## Locked decisions

These architecture decisions were ratified by the product owner in the 2026-07-28 planning session. They define the planning model; they do not assert that code implements them or waive the empirical implementation ADRs below.

| ID | Decision | Rationale | Invalidates/requires |
|---|---|---|---|
| `ADR-MP-001` | Use domain-first modular architecture before service decomposition | Stable ownership and contracts matter before operational microservice cost | All implementation plans |
| `ADR-MP-002` | Use one canonical kernel and event/interface envelope | Prevent duplicate identities, states, terminality, and evidence semantics | Domain schemas and APIs |
| `ADR-MP-003` | Certify `Core × Execution Profile × Market`, never one global production badge | Runtime, financial, provider, network, and jurisdiction readiness are not inherited from core tests | Runtime production flags |
| `ADR-MP-004` | Treat `unknown` as nonterminal after possible external acceptance | Avoid duplicate execution and unsafe reservation release | Adapters, ledger, operations |
| `ADR-MP-005` | Use append-only double-entry accounting | Counters cannot support correction, reconciliation, audit, and concurrent real money safely | Treasury migration |
| `ADR-MP-006` | Build typed evidence and privacy lifecycle into every domain | Audit cannot be retrofitted after state semantics diverge | All domain events |
| `ADR-MP-007` | Keep the core provider-neutral and adapters rail-specific | x402, MPP, AP2, cards, wallets, and chains have distinct semantics | Adapter SDK and certificates |
| `ADR-MP-008` | Separate payment settlement from provider delivery and mission completion | A receipt does not prove resource delivery or business outcome | Provider and journey models |
| `ADR-MP-009` | No external side effect before durable intent and policy | Current candidate discovery order can create pre-policy effects | Phase 0 |
| `ADR-MP-010` | Default deny for production destructive/financial actions | Current no-match allow contradicts production control claims | Policy migration |
| `ADR-MP-011` | Arc is a Public Testnet conformance profile until mainnet is available | Prevent false mainnet claims and separate network evidence | Arc roadmap and submissions |
| `ADR-MP-012` | Credentials/keys stay outside model context | Prompt/tool compromise must not expose standing provider or financial authority | Runtime and signer architecture |

## Decisions requiring implementation ADRs

| ID | Decision required | Options to evaluate | Required evidence |
|---|---|---|---|
| `ADR-MP-P01` | First Circle mainnet adapter tuple | Agent Wallet, Developer-Controlled Wallet, Gateway/Nanopayments, other supported path | Current official support, provider access, sandbox spike, mainnet canary plan |
| `ADR-MP-P02` | Production wallet/custody topology | Customer-managed signer, provider wallet, allocated float, tenant-shared wallet | Loss bound, latency, funding, reconciliation, recovery, legal analysis |
| `ADR-MP-P03` | Production signer technology | Customer KMS/HSM/MPC, custody API, enclave-backed signer | Isolation and compromise spike |
| `ADR-MP-P04` | Ledger implementation | PostgreSQL double entry, specialized ledger engine, hybrid | Invariant, throughput, migration, recovery benchmarks |
| `ADR-MP-P05` | Independent evidence integrity | Signed checkpoints, WORM store, transparency log, onchain digest | Tamper/tail-deletion and privacy proof |
| `ADR-MP-P06` | Runtime controlled-path model | Hosted gateway, customer egress proxy, service mesh, BYOC | Bypass and TLS/credential boundary spike |
| `ADR-MP-P07` | Tenant isolation depth | Shared DB with RLS, schema/database per tenant, hybrid tiers | Threat model, operational cost, data residency |
| `ADR-MP-P08` | First market/use-case profile | Low-value B2B API procurement is recommended | Customer validation and legal/provider review |
| `ADR-MP-P09` | Arc evidence anchor | No anchor, signed offchain proof, Arc digest contract | Privacy, verification utility, cost, failure behavior |
| `ADR-MP-P10` | Provider seller onboarding depth | Curated providers, self-service verification, partner-only | Demand, abuse, KYB/provider obligations |

`ADR-MP-P02` through `ADR-MP-P07` are Phase 0 implementation blockers. Their spikes must be complete before the Production Core ledger/signing/runtime substrate is implemented. They may end in “no safe supported profile”; in that case mainnet remains disabled.

## ADR rule

An ADR must include context, exact decision, alternatives, source facts with retrieval date, prototype/spike evidence, security/loss analysis, migration, rollback, dependent requirements, and certificate invalidation. No unresolved ADR may be silently decided inside feature code.
