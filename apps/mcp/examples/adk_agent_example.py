"""Google ADK binding example [manifest G1].

Proves agentOps' hosted MCP service is consumable by Google ADK's own
MCP toolset with ZERO changes on our side -- "a binding, not new
architecture," per docs/superpowers/plans/2026-08-03-phase9-ledger-distribution.md.
Our MCP server (apps/mcp/src/http.ts) already speaks standard MCP over
Streamable HTTP with bearer auth; that is exactly what ADK's McpToolset
expects for a StreamableHTTPConnectionParams connection.

What this proves, and what it does not:
  - PROVEN: a real google-adk McpToolset connects to our real running MCP
    server, completes the MCP handshake, lists our real tool surface
    (agentops.onboard, agentops.policy_check, agentops.payment_x402,
    agentops.payment_intra_fleet, agentops.approval_status,
    agentops.approval_consume, ...), and invokes one tool end to end
    against a real agentOps org/agent/connection -- with a real result
    coming back.
  - NOT ATTEMPTED: wrapping this toolset in a full `LlmAgent` reasoning
    loop. That needs a live Gemini API key, which is a deployment-time
    credential, not a binding-correctness concern -- the binding this task
    is about is the MCP connection itself, and `google_search_agent`-style
    LlmAgent wiring is a few lines on top of `tools=[toolset]` once a key
    is available. Overclaiming a full agent run without ever executing an
    LLM call would be exactly the kind of unearned claim this build's own
    "claim discipline" rule (docs/superpowers/plans/2026-08-03-scope-and-cuts.md)
    exists to forbid.

Setup -- this connects to a REAL agentOps instance, not a mock. Three
processes, matching how these two apps actually deploy (talking over real
HTTP, never sharing TypeScript source across the package boundary):

  1. From apps/api/, with a native Postgres available:
       TEST_DATABASE_URL=postgres://agentops:agentops@localhost:5432/agentops_pmoa_test \\
         ../../node_modules/.bin/tsx scripts/adk-example-fixture.ts
     Leave it running. It starts a real api instance, creates a throwaway
     org/agent/connection, and prints the exact env for step 2 plus the
     command for step 3.

  2. From apps/mcp/, in a second terminal, run agentOps' REAL,
     UNMODIFIED mcp dev entrypoint -- exactly the env line step 1 printed:
       AGENTOPS_API_BASE_URL=http://127.0.0.1:18581 MCP_HOST=127.0.0.1 \\
         MCP_PORT=18582 MCP_PUBLIC_URL=http://127.0.0.1:18582/mcp \\
         MCP_ALLOWED_HOSTS=127.0.0.1:18582 node --import tsx src/http.ts

  3. In a venv: pip install "google-adk[mcp]"
     python3 examples/adk_agent_example.py http://127.0.0.1:18582/mcp <credential>
     (<credential> is printed by step 1.)
"""

import asyncio
import json
import sys

from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset


async def run(mcp_url: str, credential: str) -> None:
    toolset = McpToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=mcp_url,
            headers={"Authorization": f"Bearer {credential}"},
        ),
    )
    try:
        # get_tools() performs the real MCP handshake (initialize +
        # tools/list) against the live server -- this is the binding.
        tools = await toolset.get_tools()
        print(f"Connected. {len(tools)} tools exposed by agentOps' MCP server:")
        for tool in tools:
            print(f"  - {tool.name}: {tool.description}")

        onboard = next((t for t in tools if t.name == "agentops.onboard"), None)
        if onboard is None:
            raise RuntimeError("agentops.onboard was not offered by the server.")

        # A real tool CALL, not just a listing -- this is what proves the
        # bearer credential and the runtime client wiring work end to end,
        # not merely that the transport handshake succeeded.
        result = await onboard.run_async(args={}, tool_context=None)
        print("\nagentops.onboard result:")
        print(json.dumps(result, indent=2, default=str))
    finally:
        await toolset.close()


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python3 adk_agent_example.py <mcp_url> <credential>", file=sys.stderr)
        raise SystemExit(1)
    asyncio.run(run(sys.argv[1], sys.argv[2]))


if __name__ == "__main__":
    main()
