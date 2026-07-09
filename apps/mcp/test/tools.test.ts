import { describe, expect, it } from 'vitest';
import { RuntimeApiError } from '../src/runtime-client.js';
import { createAgentOpsTools, type AgentOpsRuntimeClient } from '../src/tools.js';

function fakeClient(overrides: Partial<AgentOpsRuntimeClient> = {}): AgentOpsRuntimeClient {
  return {
    activityRecord: () => Promise.resolve({ activity: { id: 'act_1', summary: 'recorded' } }),
    approvalConsume: () => Promise.resolve({ approval: { id: 'apv_1', status: 'consumed' } }),
    approvalStatus: () => Promise.resolve({ approval: { id: 'apv_1', status: 'approved' } }),
    check: (input) => Promise.resolve({
      decision: {
        id: 'dec_1',
        decision: 'deny',
        reasonCode: 'policy_denied',
        approvalId: null,
        input,
      },
    }),
    onboard: () => Promise.resolve({
      agent: { id: 'agt_1', name: 'Research agent' },
      contractVersion: '2026-07-07.1',
      runtime: { checkEndpoint: '/v1/runtime/check' },
    }),
    operationCheck: (input) => Promise.resolve({
      operation: {
        id: 'opdec_1',
        decision: 'allow',
        action: input.action,
      },
    }),
    operationRecord: () => Promise.resolve({ activity: { id: 'act_op_1', summary: 'operation recorded' } }),
    paymentX402: () => Promise.resolve({
      payment: {
        id: 'payevt_1',
        decision: 'submitted',
        amount: '1.25',
        rail: 'gateway_base',
      },
    }),
    ...overrides,
  };
}

describe('agentOps MCP tools', () => {
  it('exposes only the agentOps runtime tools', () => {
    expect(createAgentOpsTools(fakeClient()).map((tool) => tool.name)).toEqual([
      'agentops.onboard',
      'agentops.policy_check',
      'agentops.payment_x402',
      'agentops.approval_status',
      'agentops.approval_consume',
      'agentops.activity_record',
      'agentops.operation_check',
      'agentops.operation_record',
    ]);
  });

  it('delegates policy checks to the runtime API client and returns structured content', async () => {
    const calls: unknown[] = [];
    const tools = createAgentOpsTools(fakeClient({
      check: (input) => {
        calls.push(input);
        return Promise.resolve({
          decision: {
            id: 'dec_2',
            decision: 'approval_required',
            reasonCode: 'approval_required',
            approvalId: 'apv_2',
            normalized: { action: 'payment.x402.authorize' },
          },
        });
      },
    }));

    const tool = tools.find((candidate) => candidate.name === 'agentops.policy_check');
    if (tool === undefined) throw new Error('policy_check tool missing');

    const result = await tool.execute({
      action: 'payment.x402.authorize',
      payment: { amount: '2.00', asset: 'USDC' },
      resource: { category: 'market-data' },
    });

    expect(calls).toEqual([
      {
        action: 'payment.x402.authorize',
        payment: { amount: '2.00', asset: 'USDC' },
        resource: { category: 'market-data' },
      },
    ]);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      decision: {
        decision: 'approval_required',
        approvalId: 'apv_2',
      },
    });
    const firstContent = result.content[0];
    expect(firstContent?.type).toBe('text');
    if (firstContent?.type !== 'text') throw new Error('Expected text content.');
    expect(firstContent.text).toContain('approval_required');
  });

  it('delegates x402 payments to the runtime API client', async () => {
    const calls: unknown[] = [];
    const tools = createAgentOpsTools(fakeClient({
      paymentX402: (input) => {
        calls.push(input);
        return Promise.resolve({
          payment: {
            id: 'payevt_2',
            decision: 'submitted',
            providerMode: 'simulation',
            amount: '1.25',
            rail: 'gateway_base',
          },
        });
      },
    }));
    const tool = tools.find((candidate) => candidate.name === 'agentops.payment_x402');
    if (tool === undefined) throw new Error('payment_x402 tool missing');

    const result = await tool.execute({
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          asset: 'USDC',
          amount: '1.25',
          payTo: '0x0000000000000000000000000000000000000001',
          extra: { name: 'GatewayWalletBatched' },
        },
      ],
      resource: { category: 'market-data' },
    });

    expect(calls).toEqual([
      {
        accepts: [
          {
            scheme: 'exact',
            network: 'base',
            asset: 'USDC',
            amount: '1.25',
            payTo: '0x0000000000000000000000000000000000000001',
            extra: { name: 'GatewayWalletBatched' },
          },
        ],
        resource: { category: 'market-data' },
      },
    ]);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      payment: {
        decision: 'submitted',
        rail: 'gateway_base',
      },
    });
  });

  it('returns approval metadata when x402 payment needs approval', async () => {
    const tools = createAgentOpsTools(fakeClient({
      paymentX402: () =>
        Promise.reject(
          new RuntimeApiError(409, 'A policy requires approval before this request can continue.', 'policy_requires_approval', {
            approvalId: 'apv_payment',
            decisionId: 'pdec_payment',
          }),
        ),
    }));
    const tool = tools.find((candidate) => candidate.name === 'agentops.payment_x402');
    if (tool === undefined) throw new Error('payment_x402 tool missing');

    const result = await tool.execute({
      accepts: [{ amount: '1.25', network: 'base', scheme: 'exact' }],
      resource: { category: 'market-data' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      approvalId: 'apv_payment',
      code: 'policy_requires_approval',
      decisionId: 'pdec_payment',
      statusCode: 409,
    });
  });

  it('returns liquidity preparation as a retryable non-error x402 result', async () => {
    const tools = createAgentOpsTools(fakeClient({
      paymentX402: () =>
        Promise.reject(
          new RuntimeApiError(409, 'Preparing 0.50 USDC for gateway_arbitrum.', 'liquidity_preparing', {
            chain: 'arbitrum',
            jobId: 'cjob_prepare',
            rail: 'gateway_arbitrum',
            retryAfterSeconds: 30,
          }),
        ),
    }));
    const tool = tools.find((candidate) => candidate.name === 'agentops.payment_x402');
    if (tool === undefined) throw new Error('payment_x402 tool missing');

    const result = await tool.execute({
      accepts: [{ amount: '1000', network: 'eip155:421614', scheme: 'exact' }],
      resource: { category: 'weather' },
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      chain: 'arbitrum',
      code: 'liquidity_preparing',
      jobId: 'cjob_prepare',
      rail: 'gateway_arbitrum',
      retryAfterSeconds: 30,
      statusCode: 409,
    });
    const firstContent = result.content[0];
    expect(firstContent?.type).toBe('text');
    if (firstContent?.type !== 'text') throw new Error('Expected text content.');
    expect(firstContent.text).toContain('liquidity preparing');
  });

  it('returns tool execution errors for invalid approval consume input', async () => {
    const tools = createAgentOpsTools(fakeClient());
    const tool = tools.find((candidate) => candidate.name === 'agentops.approval_consume');
    if (tool === undefined) throw new Error('approval_consume tool missing');

    const result = await tool.execute({ approval_id: 'apv_1' });

    expect(result.isError).toBe(true);
    const firstContent = result.content[0];
    expect(firstContent?.type).toBe('text');
    if (firstContent?.type !== 'text') throw new Error('Expected text content.');
    expect(firstContent.text).toContain('decision_id');
  });

  it('delegates operation checks to the runtime API client', async () => {
    const calls: unknown[] = [];
    const tools = createAgentOpsTools(fakeClient({
      operationCheck: (input) => {
        calls.push(input);
        return Promise.resolve({
          operation: {
            id: 'opdec_2',
            action: 'tool.call',
            decision: 'deny',
            reasonCode: 'policy_denied',
            tool_name: 'browser.search',
          },
        });
      },
    }));
    const tool = tools.find((candidate) => candidate.name === 'agentops.operation_check');
    if (tool === undefined) throw new Error('operation_check tool missing');

    const result = await tool.execute({
      action: 'tool.call',
      tool: { name: 'browser.search', riskLevel: 'low' },
    });

    expect(calls).toEqual([
      {
        action: 'tool.call',
        tool: { name: 'browser.search', riskLevel: 'low' },
      },
    ]);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      operation: {
        decision: 'deny',
        tool_name: 'browser.search',
      },
    });
  });
});
