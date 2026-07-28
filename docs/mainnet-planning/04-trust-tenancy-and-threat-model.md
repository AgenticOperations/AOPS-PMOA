---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [security, tenancy, trust-boundaries, threat-model]
---

# Trust, Tenancy, and Threat Model

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/creative-free/14-competitive-security-and-launch-audit|Prior security audit]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/superpowers/specs/2026-07-12-hosted-mcp-design|Hosted MCP design]]

## Trust model

AOPS assumes that agents, prompts, tools, providers, networks, webhooks, browser content, and external responses may be malicious or compromised. It also assumes that application administrators, signing workers, and provider credentials create distinct blast radii that must be measured rather than described with vague labels.

No trust is inherited merely from network location. Human and workload identities are authenticated and authorized for the specific resource and action. OAuth access tokens must be audience-restricted; MCP token passthrough is forbidden.

## Primary trust boundaries

1. Human browser and enterprise identity provider.
2. Agent runtime and AOPS MCP/SDK/proxy entry point.
3. Public API and tenant-scoped control plane.
4. Policy and approval services.
5. Treasury, ledger, and reconciliation database.
6. Queue, cache, object store, and evidence pipeline.
7. Signing coordinator, KMS/HSM/custody provider, and restricted relay.
8. Provider account, facilitator, payment network, blockchain, or tool.
9. Webhook and external-state lookup.
10. Support, observability, backup, analytics, and export systems.

## Tenant isolation

Tenant isolation must be proven across:

- Relational rows and foreign keys.
- Cache keys and eviction.
- Queue topics, payloads, retries, and dead-letter queues.
- Object storage paths and encryption context.
- KMS keys, aliases, grants, and encryption context.
- Provider accounts, wallets, subaccounts, and API credentials.
- Signer selection and policy.
- Webhook routing and deduplication.
- Logs, traces, metrics, alerts, and dashboards.
- Support tooling and impersonation.
- Backups, replicas, exports, and restore.

Application-level `organization_id` predicates are not sufficient proof. Database constraints, authenticated context, service identities, encryption boundaries, and adversarial two-tenant tests must agree.

## Maximum-loss analysis

Every production profile quantifies the maximum plausible loss from:

- One agent credential.
- One organization administrator.
- One approver.
- One compromised runtime or MCP client.
- Control-plane host compromise.
- Queue or cache compromise.
- Provider API credential compromise.
- Signing worker compromise.
- KMS policy or master-key compromise.
- Treasury signer compromise.
- Coordinated multi-agent spending.
- AOPS support or break-glass abuse.

Each bound identifies whether it is:

- Cryptographically enforced.
- Provider/network enforced.
- Independently custodied.
- Software policy only.
- Operational detection and response only.

A software destination fence is not cryptographic if the compromised signer can ignore it. A shared live signer with unbounded aggregate tenant funds is an `S0` blocker.

## Principal threats

- Cross-tenant object substitution.
- Shared-secret reuse.
- Stolen or replayed workload tokens.
- Confused-deputy and token-audience failures.
- Prompt injection and malicious tool output.
- SSRF, DNS rebinding, unsafe redirects, and response-size exhaustion.
- Pre-policy external side effects.
- Approval substitution after amount, destination, request, mission, or policy change.
- Concurrent sibling-agent overspending.
- Duplicate submission after lost response.
- Webhook spoofing, replay, delay, and reordering.
- Provider catalog poisoning or destination replacement.
- Signer exfiltration or arbitrary-call signing.
- Ledger mutation, imbalance, and orphan reservations.
- Evidence alteration, truncation, overcollection, or unlawful immutability.
- Backup compromise and unsafe restore.
- Insider privilege and support-path abuse.

## Security posture

Destructive new actions fail closed when authorization, reservation, signer policy, or evidence prerequisites are unavailable. Submitted external actions do not pretend to fail closed; they enter controlled unknown or pending resolution.

Credentials remain outside prompts and model context. Runtime components receive short-lived, audience-specific capability needed for one operation. Provider credentials are injected at the trusted execution boundary and never returned to the agent.

## Emergency containment

Emergency controls operate at organization, agent, connection, mission, policy, adapter, provider, signer, and global release scope. Revocation increments an epoch and synchronously blocks new grants. Submitted or irreversible work moves to reconciliation rather than disappearing.

Break-glass access requires phishing-resistant authentication, a reason, bounded scope and duration, two-person approval for money or key authority, live notification, and complete evidence.

## Security requirements

- `AOPS-SEC-001`: Every request MUST derive tenant and principal from verified credentials.
- `AOPS-SEC-002`: Privileged human roles MUST use phishing-resistant MFA.
- `AOPS-SEC-003`: Workload tokens MUST be short-lived and audience-restricted.
- `AOPS-SEC-004`: No secret or private key MAY enter agent-visible context.
- `AOPS-SEC-005`: Certified execution paths MUST prevent or explicitly disable direct bypass.
- `AOPS-SEC-006`: Every signer profile MUST publish a maximum-loss analysis.
- `AOPS-SEC-007`: Cross-tenant tests MUST cover every persistence and execution layer.
- `AOPS-SEC-008`: Policy, key, destination, and production-limit widening MUST require separation of duties.
- `AOPS-SEC-009`: New destructive actions MUST stop when emergency revocation succeeds.
- `AOPS-SEC-010`: Post-submit ambiguity MUST remain visible and recoverable.

## Required proof

- Threat model reviewed after material change.
- Privileged-access inventory and access review.
- Cross-tenant adversarial suite.
- Token audience and replay tests.
- Direct-provider bypass and egress tests.
- Prompt/tool injection and SSRF suite.
- Signer compromise and maximum-loss exercises.
- Kill-switch propagation trace.
- Secret scanning and artifact provenance.
- Independent penetration test before unrestricted production.
