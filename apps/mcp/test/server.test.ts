import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { AGENTOPS_MCP_INSTRUCTIONS, buildAgentOpsMcpServer } from '../src/server.js';
import type { AgentOpsRuntimeClient } from '../src/tools.js';

function fakeClient(): AgentOpsRuntimeClient {
  return {
    activityRecord: () => Promise.resolve({}),
    approvalConsume: () => Promise.resolve({}),
    approvalStatus: () => Promise.resolve({}),
    check: () => Promise.resolve({}),
    onboard: () => Promise.resolve({}),
    operationCheck: () => Promise.resolve({}),
    operationRecord: () => Promise.resolve({}),
    paymentX402: () => Promise.resolve({}),
  };
}

describe('agentOps MCP server', () => {
  it('publishes governance instructions without changing the tool contract', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildAgentOpsMcpServer(fakeClient());
    const client = new Client({ name: 'agentops-test', version: '0.0.0' });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getInstructions()).toBe(AGENTOPS_MCP_INSTRUCTIONS);
      expect(client.getServerVersion()).toEqual({ name: 'agentops', version: '0.0.0' });
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'agentops.onboard',
        'agentops.policy_check',
        'agentops.payment_x402',
        'agentops.approval_status',
        'agentops.approval_consume',
        'agentops.activity_record',
        'agentops.operation_check',
        'agentops.operation_record',
      ]);
      const paymentTool = tools.find((tool) => tool.name === 'agentops.payment_x402');
      expect(paymentTool?.inputSchema).toMatchObject({
        type: 'object',
        required: ['idempotency_key', 'request'],
        properties: {
          idempotency_key: { type: 'string' },
          request: {
            type: 'object',
            required: ['url', 'method', 'headers'],
          },
        },
      });
      expect(paymentTool?.inputSchema.properties).not.toHaveProperty('accepts');
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});
