import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodObject, type ZodRawShape } from 'zod';
import { RuntimeApiError } from './runtime-client.js';
import type {
  RuntimeCheckInput,
  RuntimeIntraFleetPaymentInput,
  RuntimeX402PaymentInput,
} from './runtime-client.js';

export type AgentOpsRuntimeClient = {
  readonly activityRecord: (input: { readonly payload?: Record<string, unknown> | undefined; readonly summary: string }) => Promise<Record<string, unknown>>;
  readonly approvalConsume: (approvalId: string, decisionId: string) => Promise<Record<string, unknown>>;
  readonly approvalStatus: (approvalId: string) => Promise<Record<string, unknown>>;
  readonly check: (input: RuntimeCheckInput) => Promise<Record<string, unknown>>;
  readonly identityRegister: (input: {
    readonly endpoint_url: string;
    readonly agent_uri?: string | undefined;
    readonly chain?: 'arc' | undefined;
  }) => Promise<Record<string, unknown>>;
  readonly identityStatus: () => Promise<Record<string, unknown>>;
  readonly onboard: () => Promise<Record<string, unknown>>;
  readonly operationCheck: (input: OperationInput) => Promise<Record<string, unknown>>;
  readonly operationRecord: (input: OperationInput & {
    readonly outcome?: 'success' | 'denied' | 'pending' | 'error' | undefined;
    readonly summary: string;
  }) => Promise<Record<string, unknown>>;
  readonly paymentIntraFleet: (input: RuntimeIntraFleetPaymentInput) => Promise<Record<string, unknown>>;
  readonly paymentX402: (input: RuntimeX402PaymentInput) => Promise<Record<string, unknown>>;
  readonly publish: (input: { readonly public_endpoint_url: string }) => Promise<Record<string, unknown>>;
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
const deniedPaidHttpHeaders = new Set([
  'host',
  'content-length',
  'connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'keep-alive',
  'accept-encoding',
  'payment-signature',
  'payment-response',
  'payment-required',
  'x-payment',
]);
const paidHttpHeaderName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const paidHttpHeaderSchema = z.tuple([
  z.string().min(1).regex(paidHttpHeaderName, 'Invalid paid HTTP header name.'),
  z.string().refine((value) => !/[\r\n\0]/.test(value), 'Invalid paid HTTP header value.'),
]).superRefine(([name], context) => {
  const normalizedName = name.toLowerCase();
  if (
    deniedPaidHttpHeaders.has(normalizedName)
    || normalizedName.startsWith('proxy-')
    || normalizedName.startsWith('x-payment-')
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Paid HTTP header is not allowed: ${name}`,
      path: [0],
    });
  }
});
const paidHttpJsonBodySchema = z.object({
  kind: z.literal('json'),
  value: z.unknown(),
}).strict().superRefine((body, context) => {
  if (!Object.prototype.hasOwnProperty.call(body, 'value')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Required', path: ['value'] });
  }
});
const paidHttpBodySchema = z.union([
  paidHttpJsonBodySchema,
  z.object({ kind: z.literal('text'), value: z.string() }).strict(),
  z.object({ kind: z.literal('base64'), value: z.string() }).strict(),
]);
const paidHttpRequestSchema = z.object({
  url: z.string().min(1).max(4096).refine((value) => value.trim().length > 0, 'URL is required.'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  headers: z.array(paidHttpHeaderSchema).max(100),
  body: paidHttpBodySchema.optional(),
}).strict();
const paymentX402Schema = z.object({
  idempotency_key: z.string().min(1).max(160).refine((value) => value.trim().length > 0, 'Idempotency key is required.'),
  request: paidHttpRequestSchema,
}).strict();
const paymentIntraFleetSchema = z.object({
  payee_agent_id: z.string().trim().min(1).max(120),
  chain: z.enum(['base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc']),
  url: z.string().trim().min(1).max(4096),
}).strict();
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
const publishSchema = z.object({
  public_endpoint_url: z.string().trim().url().max(2048),
});
const identityRegisterSchema = z.object({
  endpoint_url: z.string().trim().url().max(2048),
  agent_uri: z.string().trim().url().max(2048).optional(),
  chain: z.literal('arc').optional(),
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

function errorContent(error: unknown, message: string): Record<string, unknown> {
  if (error instanceof RuntimeApiError) {
    return {
      ...error.details,
      code: error.code,
      error: message,
      statusCode: error.statusCode,
    };
  }
  return { error: message };
}

function recordArgs(args: unknown): Record<string, unknown> {
  return args !== null && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

function summarize(label: string, payload: Record<string, unknown>): string {
  const payment = payload.payment;
  if (payment !== null && typeof payment === 'object' && !Array.isArray(payment)) {
    const paymentRecord = payment as Record<string, unknown>;
    const decision = typeof paymentRecord.decision === 'string' ? paymentRecord.decision : 'unknown';
    const amount = typeof paymentRecord.amount === 'string' ? ` ${paymentRecord.amount} USDC` : '';
    const rail = typeof paymentRecord.rail === 'string' ? ` on ${paymentRecord.rail}` : '';
    return `${label}: ${decision}${amount}${rail}.`;
  }

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
    if (error instanceof RuntimeApiError && error.code === 'policy_requires_approval') {
      const approvalId = typeof error.details.approvalId === 'string' ? error.details.approvalId : null;
      const decisionId = typeof error.details.decisionId === 'string' ? error.details.decisionId : null;
      const approval = approvalId === null ? '' : ` Approval: ${approvalId}.`;
      const decision = decisionId === null ? '' : ` Decision: ${decisionId}.`;
      return textResult(
        `${label}: approval required.${approval}${decision}`,
        errorContent(error, message),
        false,
      );
    }
    if (error instanceof RuntimeApiError && error.code === 'liquidity_preparing') {
      const retryAfter = typeof error.details.retryAfterSeconds === 'number'
        ? ` Retry after ${error.details.retryAfterSeconds} seconds.`
        : '';
      return textResult(`${label}: liquidity preparing.${retryAfter}`, errorContent(error, message), false);
    }
    return textResult(`agentOps MCP error: ${message}`, errorContent(error, message), true);
  }
}

async function safePaymentExecute(
  fn: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    const payload = await fn();
    return textResult(JSON.stringify(payload), payload);
  } catch (error) {
    const message = errorText(error);
    if (error instanceof RuntimeApiError && error.code === 'policy_requires_approval') {
      const approvalId = typeof error.details.approvalId === 'string' ? error.details.approvalId : null;
      const decisionId = typeof error.details.decisionId === 'string' ? error.details.decisionId : null;
      const approval = approvalId === null ? '' : ` Approval: ${approvalId}.`;
      const decision = decisionId === null ? '' : ` Decision: ${decisionId}.`;
      return textResult(
        `x402 payment: approval required.${approval}${decision}`,
        errorContent(error, message),
        false,
      );
    }
    if (error instanceof RuntimeApiError && error.code === 'liquidity_preparing') {
      const retryAfter = typeof error.details.retryAfterSeconds === 'number'
        ? ` Retry after ${error.details.retryAfterSeconds} seconds.`
        : '';
      return textResult(
        `x402 payment: liquidity preparing.${retryAfter}`,
        errorContent(error, message),
        false,
      );
    }
    return textResult(`agentOps MCP error: ${message}`, errorContent(error, message), true);
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
      description: 'Execute an idempotent paid HTTP request through agentOps x402 payment controls for this agent.',
      execute: async (args) =>
        safePaymentExecute(async () => client.paymentX402(
          paymentX402Schema.parse(recordArgs(args)) as RuntimeX402PaymentInput,
        )),
      inputSchema: paymentX402Schema,
      name: 'agentops.payment_x402',
      title: 'Request governed paid HTTP',
    },
    {
      description: 'Pay another agent in this fleet for a paid HTTP resource it serves (agent-to-agent x402 discovery, settled by drawing down this agent\'s standing Permit2 delegation — funds never leave the payer\'s wallet until draw time). Bounded by the payer\'s delegation ceiling and treasury solvency, not by a policy check — this call is NOT idempotent, so do not retry it blindly after a timeout or crash; confirm the payment did not already land before calling again.',
      execute: async (args) =>
        safePaymentExecute(async () => client.paymentIntraFleet(
          paymentIntraFleetSchema.parse(recordArgs(args)),
        )),
      inputSchema: paymentIntraFleetSchema,
      name: 'agentops.payment_intra_fleet',
      title: 'Pay a fleet agent',
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
    {
      description:
        'Publish this agent\'s public MCP/HTTP endpoint URL into agentOps marketplace metadata (same effect as console Publish). Payment remains operator-gated.',
      execute: async (args) =>
        safeExecute('Publish endpoint', async () => client.publish(publishSchema.parse(recordArgs(args)))),
      inputSchema: publishSchema,
      name: 'agentops.publish',
      title: 'Publish public endpoint',
    },
    {
      description: 'Read this agent\'s ERC-8004 on-chain identity status on Arc (if registered).',
      execute: async (args) =>
        safeExecute('Identity status', async () => {
          emptySchema.parse(recordArgs(args));
          return client.identityStatus();
        }),
      inputSchema: emptySchema,
      name: 'agentops.identity_status',
      title: 'ERC-8004 identity status',
    },
    {
      description:
        'Register this agent on Arc ERC-8004 Identity Registry. Requires a human operator to have enabled payment access so an Arc wallet exists; fails closed otherwise.',
      execute: async (args) =>
        safeExecute('Identity register', async () =>
          client.identityRegister(identityRegisterSchema.parse(recordArgs(args)))),
      inputSchema: identityRegisterSchema,
      name: 'agentops.identity_register',
      title: 'Register ERC-8004 identity',
    },
  ];
}
