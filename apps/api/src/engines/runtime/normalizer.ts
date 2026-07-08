import type { RuntimeCheckInput } from './types.js';

export type NormalizedRuntimeRequest =
  | {
      readonly ok: true;
      readonly action: string;
      readonly context: Record<string, unknown>;
      readonly missingFields: readonly string[];
    }
  | {
      readonly ok: false;
      readonly action: string | null;
      readonly context: Record<string, unknown>;
      readonly missingFields: readonly string[];
      readonly reasonCode: 'runtime_needs_more_info';
      readonly explanation: string;
    };

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function urlDomain(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function mergeResource(resource: Record<string, unknown>): Record<string, unknown> {
  const url = stringValue(resource.url);
  const domain = stringValue(resource.domain) ?? urlDomain(url);
  return {
    ...resource,
    ...(url === null ? {} : { url }),
    ...(domain === null ? {} : { domain }),
  };
}

function normalizeStructured(input: RuntimeCheckInput): NormalizedRuntimeRequest {
  const action = stringValue(input.action);
  const context = objectOrEmpty(input.context);
  const resource = mergeResource(objectOrEmpty(input.resource));
  const payment = objectOrEmpty(input.payment);
  const tool = objectOrEmpty(input.tool);
  const normalizedContext = {
    ...context,
    ...(Object.keys(resource).length === 0 ? {} : { resource }),
    ...(Object.keys(payment).length === 0 ? {} : { payment }),
    ...(Object.keys(tool).length === 0 ? {} : { tool }),
  };

  if (action === null) {
    return {
      ok: false,
      action: null,
      context: normalizedContext,
      missingFields: ['action'],
      reasonCode: 'runtime_needs_more_info',
      explanation: 'The runtime check needs a structured action.',
    };
  }

  const missingFields: string[] = [];
  if (action === 'payment.x402.authorize') {
    for (const field of ['amount', 'asset', 'network', 'recipient']) {
      if (stringValue(payment[field]) === null) missingFields.push(`payment.${field}`);
    }
    if (stringValue(resource.url) === null) missingFields.push('resource.url');
  }
  if (action === 'tool.call' && stringValue(tool.name) === null) {
    missingFields.push('tool.name');
  }
  if (action === 'runtime.http.request' && stringValue(resource.url) === null && stringValue(resource.category) === null) {
    missingFields.push('resource.url_or_category');
  }

  if (missingFields.length > 0) {
    return {
      ok: false,
      action,
      context: normalizedContext,
      missingFields,
      reasonCode: 'runtime_needs_more_info',
      explanation: 'The runtime check is missing required facts.',
    };
  }

  return {
    ok: true,
    action,
    context: normalizedContext,
    missingFields: [],
  };
}

function normalizeIntent(intent: string): NormalizedRuntimeRequest {
  const lower = intent.toLowerCase();
  if (lower.includes('weather')) {
    return {
      ok: true,
      action: 'runtime.http.request',
      context: {
        intent,
        resource: {
          category: 'weather',
        },
      },
      missingFields: [],
    };
  }
  if (lower.includes('x402') || lower.includes('paid') || lower.includes('payment')) {
    return {
      ok: false,
      action: 'payment.x402.authorize',
      context: { intent },
      missingFields: ['resource.url', 'payment.amount', 'payment.asset', 'payment.network', 'payment.recipient'],
      reasonCode: 'runtime_needs_more_info',
      explanation: 'Payment checks need exact payment facts before policy can evaluate them.',
    };
  }
  if (lower.includes('tool')) {
    return {
      ok: false,
      action: 'tool.call',
      context: { intent },
      missingFields: ['tool.name'],
      reasonCode: 'runtime_needs_more_info',
      explanation: 'Tool checks need the tool name before policy can evaluate them.',
    };
  }
  return {
    ok: false,
    action: null,
    context: { intent },
    missingFields: ['action'],
    reasonCode: 'runtime_needs_more_info',
    explanation: 'agentOps could not normalize this intent into a known runtime action.',
  };
}

export function normalizeRuntimeCheck(input: RuntimeCheckInput): NormalizedRuntimeRequest {
  const intent = stringValue(input.intent);
  if (intent !== null && stringValue(input.action) === null) return normalizeIntent(intent);
  return normalizeStructured(input);
}
