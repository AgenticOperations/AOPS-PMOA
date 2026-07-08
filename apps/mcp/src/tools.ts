import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { RuntimeCheckInput } from './runtime-client.js';

export type AgentOpsRuntimeClient = {
  readonly activityRecord: (input: { readonly payload?: Record<string, unknown> | undefined; readonly summary: string }) => Promise<Record<string, unknown>>;
  readonly approvalConsume: (approvalId: string, decisionId: string) => Promise<Record<string, unknown>>;
  readonly approvalStatus: (approvalId: string) => Promise<Record<string, unknown>>;
  readonly check: (input: RuntimeCheckInput) => Promise<Record<string, unknown>>;
  readonly onboard: () => Promise<Record<string, unknown>>;
  readonly operationCheck: (input: OperationInput) => Promise<Record<string, unknown>>;
  readonly operationRecord: (input: OperationInput & {
    readonly outcome?: 'success' | 'denied' | 'pending' | 'error' | undefined;
    readonly summary: string;
  }) => Promise<Record<string, unknown>>;
};

export type AgentOpsTool = {
  readonly description: string;
  readonly execute: (args: Record<string, unknown>) => Promise<CallToolResult>;
  readonly inputSchema: ZodObject<ZodRawShape>;
  readonly name: string;
  readonly title: string;
};

const objectRecord = z.record(z.string(), z.unknown());

const emptySchema = z.object({});
const policyCheckSchema = z.object({
  action: z.string().trim().min(1).max(160).optional(),
  context: objectRecord.optional(),
  intent: z.string().trim().min(1).max(2000).optional(),
  payment: objectRecord.optional(),
  resource: objectRecord.optional(),
  tool: objectRecord.optional(),
});
const approvalStatusSchema = z.object({
  approval_id: z.string().trim().min(1),
});
const approvalConsumeSchema = z.object({
  approval_id: z.string().trim().min(1),
  decision_id: z.string().trim().min(1),
});
const activityRecordSchema = z.object({
  payload: objectRecord.optional(),
  summary: z.string().trim().min(1).max(500),
});
const operationSchema = z.object({
  action: z.enum(['runtime.http.request', 'tool.call']),
  context: objectRecord.optional(),
  resource: objectRecord.optional(),
  tool: objectRecord.optional(),
});
const operationRecordSchema = operationSchema.extend({
  outcome: z.enum(['success', 'denied', 'pending', 'error']).optional(),
  summary: z.string().trim().min(1).max(500),
});

type OperationInput = z.infer<typeof operationSchema>;

function textResult(text: string, structuredContent: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    isError,
    structuredContent,
  };
}

function errorText(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  return error instanceof Error ? error.message : 'Unknown agentOps MCP error.';
}

function recordArgs(args: unknown): Record<string, unknown> {
  return args !== null && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

function summarize(label: string, payload: Record<string, unknown>): string {
  const decision = payload.decision;
  if (decision !== null && typeof decision === 'object' && !Array.isArray(decision)) {
    const decisionRecord = decision as Record<string, unknown>;
    const value = typeof decisionRecord.decision === 'string' ? decisionRecord.decision : 'unknown';
    const approvalId = typeof decisionRecord.approvalId === 'string' ? ` Approval: ${decisionRecord.approvalId}.` : '';
    return `${label}: ${value}.${approvalId}`;
  }
  return `${label} completed.`;
}

async function safeExecute(
  label: string,
  fn: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    const payload = await fn();
    return textResult(summarize(label, payload), payload);
  } catch (error) {
    const message = errorText(error);
    return textResult(`agentOps MCP error: ${message}`, { error: message }, true);
  }
}

export function createAgentOpsTools(client: AgentOpsRuntimeClient): readonly AgentOpsTool[] {
  return [
    {
      description: 'Fetch the current agentOps runtime contract for this agent credential.',
      execute: async (args) =>
        safeExecute('Runtime onboard', async () => {
          emptySchema.parse(recordArgs(args));
          return client.onboard();
        }),
      inputSchema: emptySchema,
      name: 'agentops.onboard',
      title: 'Onboard agent runtime',
    },
    {
      description: 'Ask agentOps to evaluate a runtime action against policies attached to this agent.',
      execute: async (args) =>
        safeExecute('Policy check', async () => client.check(policyCheckSchema.parse(recordArgs(args)))),
      inputSchema: policyCheckSchema,
      name: 'agentops.policy_check',
      title: 'Check policy',
    },
    {
      description: 'Fetch the status of a one-time approval request created by a policy check.',
      execute: async (args) =>
        safeExecute('Approval status', async () => {
          const parsed = approvalStatusSchema.parse(recordArgs(args));
          return client.approvalStatus(parsed.approval_id);
        }),
      inputSchema: approvalStatusSchema,
      name: 'agentops.approval_status',
      title: 'Approval status',
    },
    {
      description: 'Consume an approved one-time approval before executing the matching runtime action.',
      execute: async (args) =>
        safeExecute('Approval consume', async () => {
          const parsed = approvalConsumeSchema.parse(recordArgs(args));
          return client.approvalConsume(parsed.approval_id, parsed.decision_id);
        }),
      inputSchema: approvalConsumeSchema,
      name: 'agentops.approval_consume',
      title: 'Consume approval',
    },
    {
      description: 'Record a concise agent activity event in agentOps for operator visibility.',
      execute: async (args) =>
        safeExecute('Activity record', async () => client.activityRecord(activityRecordSchema.parse(recordArgs(args)))),
      inputSchema: activityRecordSchema,
      name: 'agentops.activity_record',
      title: 'Record activity',
    },
    {
      description: 'Ask agentOps to evaluate a non-financial operational action such as a tool call or external API request.',
      execute: async (args) =>
        safeExecute('Operation check', async () => client.operationCheck(operationSchema.parse(recordArgs(args)))),
      inputSchema: operationSchema,
      name: 'agentops.operation_check',
      title: 'Check operation',
    },
    {
      description: 'Record a completed non-financial operational action in agentOps for live operator visibility.',
      execute: async (args) =>
        safeExecute('Operation record', async () => client.operationRecord(operationRecordSchema.parse(recordArgs(args)))),
      inputSchema: operationRecordSchema,
      name: 'agentops.operation_record',
      title: 'Record operation',
    },
  ];
}
