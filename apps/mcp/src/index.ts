#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { runtimeClientFromEnv } from './config.js';
import { buildAgentOpsMcpServer } from './server.js';

async function main(): Promise<void> {
  const client = runtimeClientFromEnv();
  const server = buildAgentOpsMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('agentOps MCP server running on stdio');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown MCP server startup failure.';
  console.error(`agentOps MCP server failed: ${message}`);
  process.exit(1);
});
