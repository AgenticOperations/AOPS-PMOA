import type { RuntimeActionSchema } from './types.js';

export const runtimeContractVersion = '2026-07-12.1';

export const runtimeActionSchemas: readonly RuntimeActionSchema[] = [
  {
    action: 'runtime.http.request',
    label: 'External HTTP/API request',
    description: 'Use before an agent accesses an external website or API through an agentOps-managed surface.',
    required: ['resource.url or resource.category'],
    optional: ['resource.domain', 'resource.category', 'context.purpose'],
    example: {
      action: 'runtime.http.request',
      resource: {
        url: 'https://api.weather.example/current',
        category: 'weather',
      },
      context: {
        purpose: 'research',
      },
    },
  },
  {
    action: 'payment.x402.authorize',
    label: 'Authorize x402 payment',
    description: 'Use before an x402 payment. agentOps applies policy and payment controls, then executes supported USDC rails.',
    required: ['resource.url', 'payment.amount', 'payment.asset', 'payment.network', 'payment.recipient'],
    optional: ['resource.category', 'resource.domain', 'resource.serviceName'],
    example: {
      action: 'payment.x402.authorize',
      resource: {
        url: 'https://paid-data.example/report',
        category: 'market-data',
      },
      payment: {
        amount: '1.00',
        asset: 'USDC',
        network: 'base',
        recipient: '0xRecipient',
      },
    },
  },
  {
    action: 'tool.call',
    label: 'Tool call',
    description: 'Use before calling a tool exposed through an agentOps-managed MCP or tool gateway.',
    required: ['tool.name'],
    optional: ['tool.riskLevel', 'tool.arguments'],
    example: {
      action: 'tool.call',
      tool: {
        name: 'browser.search',
        riskLevel: 'low',
      },
    },
  },
];

export function runtimeActionIds(): readonly string[] {
  return runtimeActionSchemas.map((schema) => schema.action);
}
