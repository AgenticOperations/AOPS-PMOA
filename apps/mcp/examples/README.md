# Google ADK binding example [manifest G1]

Proves agentOps' hosted MCP service (`apps/mcp/src/http.ts`) is consumable
by Google ADK's own `McpToolset` with **zero changes on our side** — this is
a binding, not new architecture. Our server already speaks standard MCP over
Streamable HTTP with bearer auth; that is exactly what ADK's
`StreamableHTTPConnectionParams` expects.

## What's here

- `adk_agent_example.py` — connects via `google-adk`'s `McpToolset`, lists
  agentOps' real tool surface, and calls `agentops.onboard` end to end
  against a real agentOps org/agent/connection.

The fixture that stands up a real, throwaway agentOps instance for this to
connect to lives in `apps/api/scripts/adk-example-fixture.ts` — deliberately
**not** in this directory, because it needs `apps/api`'s internals
(`buildApp`, the Postgres test helper) and this package has no dependency on
`@agentops-pmoa/api`. The two apps talk over real HTTP here, exactly like
they do in production — no TypeScript source is shared across the package
boundary.

## Running it

Three processes:

```bash
# 1. From apps/api/ — starts a real api instance + a throwaway org/agent/connection
TEST_DATABASE_URL=postgres://agentops:agentops@localhost:5432/agentops_pmoa_test \
  ../../node_modules/.bin/tsx scripts/adk-example-fixture.ts
# Leave running. It prints the exact command for step 2 and the credential for step 3.

# 2. From apps/mcp/ — agentOps' REAL, unmodified mcp dev entrypoint
AGENTOPS_API_BASE_URL=http://127.0.0.1:18581 MCP_HOST=127.0.0.1 MCP_PORT=18582 \
  MCP_PUBLIC_URL=http://127.0.0.1:18582/mcp MCP_ALLOWED_HOSTS=127.0.0.1:18582 \
  node --import tsx src/http.ts

# 3. python3 -m venv .venv && source .venv/bin/activate && pip install "google-adk[mcp]"
python3 examples/adk_agent_example.py http://127.0.0.1:18582/mcp <credential-from-step-1>
```

## What this proves, and what it does not

- **Proven**: a real `google-adk` `McpToolset` completes the MCP handshake
  against our real server, lists our real tools (`agentops.onboard`,
  `agentops.policy_check`, `agentops.payment_x402`, `agentops.approval_status`,
  `agentops.approval_consume`, `agentops.operation_check`,
  `agentops.operation_record`, `agentops.activity_record`), and invokes
  `agentops.onboard` end to end — a real result comes back from a real
  agentOps org.
- **Not attempted**: wrapping this toolset in a full `LlmAgent` reasoning
  loop, which needs a live Gemini API key (a deployment-time credential, not
  a binding-correctness concern). See `adk_agent_example.py`'s own docstring
  for the reasoning — claiming a full autonomous run without ever executing
  an LLM call would be exactly the kind of unearned claim this build's claim
  discipline rule exists to forbid.

Live run recorded in `docs/spike-results.md`'s "Phase 9 · Task 5" section.
