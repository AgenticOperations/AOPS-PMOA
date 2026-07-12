import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ZodTypeAny } from 'zod';
import type { AgentOpsRuntimeClient } from './tools.js';
import { createAgentOpsTools } from './tools.js';

export const AGENTOPS_MCP_INSTRUCTIONS = 'Use AOPS before governed tool calls, HTTP operations, or x402 payments. Call the matching check tool first, follow approval requirements, and record the final outcome. Actions sent outside AOPS are not governed by this connection.';

type ToolRegistrar = (
  name: string,
  config: {
    readonly description: string;
    readonly inputSchema: ZodTypeAny;
    readonly title: string;
  },
  cb: (args: Record<string, unknown>) => Promise<CallToolResult>,
) => unknown;

export function buildAgentOpsMcpServer(client: AgentOpsRuntimeClient): McpServer {
  const server = new McpServer({
    name: 'agentops',
    version: '0.0.0',
  }, {
    instructions: AGENTOPS_MCP_INSTRUCTIONS,
  });
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;

  for (const tool of createAgentOpsTools(client)) {
    registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        title: tool.title,
      },
      async (args) => tool.execute(args),
    );
  }

  return server;
}
