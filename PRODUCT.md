---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [build-pmoa, product-context, impeccable]
---

# agentOps PMOA Product Context

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/README]] | [[10-Projects/Web3-Builds/agentOps/PMOA-EVENT-PRD/40-final-implementation-readiness-and-build-sequence]]

register: product

agentOps PMOA is an infrastructure control plane for teams and developers running agents. It gives operators one clean surface for agent identity, connections, policy, approvals, financial controls, capabilities, and evidence.

The product should feel like premium financial infrastructure: quiet, direct, precise, and trustworthy. The default UX should explain the user workflow, not the underlying protocol stack.

Primary users:

- Solo developers connecting one or a few local or coded agents.
- Small teams managing agent identities and runtime credentials.
- Enterprise operators who need tenant-safe identity, controls, evidence, and auditability.

Product language:

- Use "agent", "connection", "policy", "approval", "payment", "wallet", "capability", and "evidence".
- Keep MCP, x402, Arc, CCTP, ERC standards, and provider implementation details in setup snippets or advanced details only.

Anti-references:

- Do not make it look like a crypto trading dashboard.
- Do not lead with token balances in identity workflows.
- Do not use jargon-heavy pages that expose every backend primitive at once.
- Do not use generic SaaS card grids when a workflow, table, or detail surface would be clearer.
