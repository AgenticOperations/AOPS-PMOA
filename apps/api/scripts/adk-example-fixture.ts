// Fixture for apps/mcp/examples/adk_agent_example.py (Phase 9 Task 5, manifest G1).
//
// Starts a REAL api instance listening on loopback TCP and creates a real
// org/agent/connection, then prints the env agentOps' REAL, UNMODIFIED mcp
// dev entrypoint (apps/mcp/src/http.ts) needs to point at it. This script
// only imports from within apps/api -- the MCP service is launched as its
// own separate process from apps/mcp/ (its normal deployment shape), never
// as a cross-package TypeScript import, which would violate the mcp
// workspace's own rootDir and break its typecheck.
//
// Usage: from apps/api/, with TEST_DATABASE_URL pointed at a native Postgres
//   TEST_DATABASE_URL=postgres://agentops:agentops@localhost:5432/agentops_pmoa_test \
//     ../../node_modules/.bin/tsx scripts/adk-example-fixture.ts
import { buildApp } from '../src/app.js';
import { startPostgres } from '../test/helpers/postgres.js';

const API_PORT = 18581;
const MCP_PORT = 18582;

type OrgResponse = { readonly org: { readonly id: string } };
type AgentResponse = { readonly agent: { readonly id: string } };
type ConnectionResponse = { readonly secret: string };

async function main(): Promise<void> {
  const store = await startPostgres();
  const app = buildApp({
    identity: {
      pool: store.pool,
      resolveOperator: () => Promise.resolve({ actorId: 'usr_adk_owner', role: 'owner' }),
    },
    runtime: { pool: store.pool },
  });
  await app.listen({ port: API_PORT, host: '127.0.0.1' });

  const org = await app.inject({
    method: 'POST',
    url: '/v1/orgs',
    payload: { name: 'ADK Binding Org', owner: { email: 'adk@example.test', name: 'ADK Tester' } },
  });
  const orgId = org.json<OrgResponse>().org.id;

  const agent = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents`,
    payload: { name: 'ADK example agent' },
  });
  const agentId = agent.json<AgentResponse>().agent.id;

  const connection = await app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/agents/${agentId}/connections`,
    payload: { kind: 'agent_credential', name: 'ADK runtime credential' },
  });
  const credential = connection.json<ConnectionResponse>().secret;

  const mcpUrl = `http://127.0.0.1:${MCP_PORT}/mcp`;

  console.log('agentOps api ready for the ADK example.\n');
  console.log('In a second terminal, from apps/mcp/, launch the REAL mcp dev entrypoint pointed at this api:\n');
  console.log([
    `AGENTOPS_API_BASE_URL=http://127.0.0.1:${API_PORT}`,
    'MCP_HOST=127.0.0.1',
    `MCP_PORT=${MCP_PORT}`,
    `MCP_PUBLIC_URL=${mcpUrl}`,
    `MCP_ALLOWED_HOSTS=127.0.0.1:${MCP_PORT}`,
    'node --import tsx src/http.ts',
  ].join(' '));
  console.log('\nThen run the Python example:\n');
  console.log(`python3 examples/adk_agent_example.py ${mcpUrl} ${credential}`);
  console.log(`\n(org_id=${orgId} agent_id=${agentId})`);

  // Stay alive for the mcp process (in the other terminal) and the Python
  // client to connect against.
  process.stdin.resume();
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
