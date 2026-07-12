export type VerifyHostedMcpInput = {
  readonly endpoint: string;
  readonly credential: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
};

export type McpVerificationResult = {
  readonly status: 'verified';
  readonly toolCount: number;
  readonly agentName: string;
  readonly connectionId: string;
  readonly contractVersion: string;
};

export type McpVerificationErrorCode =
  | 'invalid_input'
  | 'invalid_credential'
  | 'origin_not_allowed'
  | 'rate_limited'
  | 'service_unavailable'
  | 'network_error'
  | 'timeout'
  | 'protocol_error';

export class McpVerificationError extends Error {
  readonly code: McpVerificationErrorCode;
  readonly status: number | null;

  constructor(code: McpVerificationErrorCode, status: number | null, message: string) {
    super(message);
    this.name = 'McpVerificationError';
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_CREDENTIAL_LENGTH = 4_096;

const REQUIRED_TOOLS = new Set([
  'agentops.onboard',
  'agentops.policy_check',
  'agentops.payment_x402',
  'agentops.approval_status',
  'agentops.approval_consume',
  'agentops.activity_record',
  'agentops.operation_check',
  'agentops.operation_record',
]);

const SAFE_MESSAGES: Readonly<Record<McpVerificationErrorCode, string>> = {
  invalid_input: 'Enter a valid hosted MCP endpoint and credential.',
  invalid_credential: 'The MCP credential is invalid or has been revoked.',
  origin_not_allowed: 'This browser origin is not allowed to connect to the MCP service.',
  rate_limited: 'The MCP service is busy. Try again shortly.',
  service_unavailable: 'The MCP service is temporarily unavailable.',
  network_error: 'Could not reach the MCP service.',
  timeout: 'The MCP verification timed out. Try again.',
  protocol_error: 'The MCP service returned an invalid response.',
};

const INITIALIZE_PARAMS = {
  capabilities: {},
  clientInfo: { name: 'aops-console-verifier', version: '1.0.0' },
  protocolVersion: '2025-06-18',
} as const;

type ValidatedInput = {
  readonly credential: string;
  readonly endpoint: string;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
};

type RequestContext = ValidatedInput & {
  readonly signal: AbortSignal;
};

function verificationError(
  code: McpVerificationErrorCode,
  status: number | null,
  message = SAFE_MESSAGES[code],
): McpVerificationError {
  return new McpVerificationError(code, status, message);
}

function invalidInput(): never {
  throw verificationError('invalid_input', null);
}

function validateInput(input: VerifyHostedMcpInput): ValidatedInput {
  if (typeof input.endpoint !== 'string' || input.endpoint.trim() !== input.endpoint) invalidInput();

  let endpoint: URL;
  try {
    endpoint = new URL(input.endpoint);
  } catch {
    invalidInput();
  }

  if (
    (endpoint.protocol !== 'https:' && (
      endpoint.protocol !== 'http:'
      || !new Set(['localhost', '127.0.0.1', '[::1]']).has(endpoint.hostname)
    ))
    || endpoint.pathname !== '/mcp'
    || endpoint.username !== ''
    || endpoint.password !== ''
    || endpoint.search !== ''
    || endpoint.hash !== ''
  ) {
    invalidInput();
  }

  if (
    typeof input.credential !== 'string'
    || input.credential.trim() === ''
    || input.credential.length > MAX_CREDENTIAL_LENGTH
  ) {
    invalidInput();
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) invalidInput();

  return {
    credential: input.credential,
    endpoint: input.endpoint,
    fetchImpl: input.fetchImpl ?? fetch,
    timeoutMs,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mapHttpError(status: number): McpVerificationError {
  if (status === 401) return verificationError('invalid_credential', status);
  if (status === 403) return verificationError('origin_not_allowed', status);
  if (status === 429) return verificationError('rate_limited', status);
  if (status === 503) return verificationError('service_unavailable', status);
  return verificationError('protocol_error', status, 'The MCP service returned an unexpected response.');
}

function requireJsonResponse(response: Response): void {
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') throw verificationError('protocol_error', response.status);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  requireJsonResponse(response);
  try {
    const body: unknown = await response.json();
    if (!isRecord(body)) throw verificationError('protocol_error', response.status);
    return body;
  } catch (error) {
    if (error instanceof McpVerificationError) throw error;
    throw verificationError('protocol_error', response.status);
  }
}

async function post(context: RequestContext, body: Record<string, unknown>): Promise<Response> {
  try {
    return await context.fetchImpl(context.endpoint, {
      body: JSON.stringify(body),
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${context.credential}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      redirect: 'error',
      signal: context.signal,
    });
  } catch {
    if (context.signal.aborted) throw verificationError('timeout', null);
    throw verificationError('network_error', null);
  }
}

async function rpc(
  context: RequestContext,
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await post(context, { id, jsonrpc: '2.0', method, params });
  if (!response.ok) throw mapHttpError(response.status);

  const body = await readJson(response);
  if (
    body.jsonrpc !== '2.0'
    || body.id !== id
    || Object.hasOwn(body, 'error')
    || !Object.hasOwn(body, 'result')
    || !isRecord(body.result)
  ) {
    throw verificationError('protocol_error', response.status);
  }
  return body.result;
}

async function notify(context: RequestContext, method: string): Promise<void> {
  const response = await post(context, { jsonrpc: '2.0', method });
  if (!response.ok) throw mapHttpError(response.status);
  if (response.status !== 202) throw verificationError('protocol_error', response.status);

  const text = await response.text();
  if (text.trim() !== '') throw verificationError('protocol_error', response.status);
}

function readTools(result: Record<string, unknown>): { readonly toolCount: number } {
  if (!Array.isArray(result.tools)) throw verificationError('protocol_error', null);

  const names = result.tools.map((tool) => {
    if (!isRecord(tool) || typeof tool.name !== 'string' || tool.name.trim() === '') {
      throw verificationError('protocol_error', null);
    }
    return tool.name;
  });

  const available = new Set(names);
  for (const required of REQUIRED_TOOLS) {
    if (!available.has(required)) {
      throw verificationError('protocol_error', null, 'The MCP service did not provide the required tools.');
    }
  }
  return { toolCount: names.length };
}

function isValidMcpContentItem(item: unknown): item is Record<string, unknown> {
  if (!isRecord(item) || typeof item.type !== 'string') return false;
  if (item.type === 'text') return typeof item.text === 'string';
  if (item.type === 'image' || item.type === 'audio') {
    return typeof item.data === 'string' && typeof item.mimeType === 'string';
  }
  if (item.type === 'resource') {
    if (!isRecord(item.resource) || typeof item.resource.uri !== 'string') return false;
    return typeof item.resource.text === 'string' || typeof item.resource.blob === 'string';
  }
  if (item.type === 'resource_link') {
    return typeof item.name === 'string' && typeof item.uri === 'string';
  }
  return false;
}

function parseOnboardContent(result: Record<string, unknown>): Record<string, unknown> {
  if (
    !Array.isArray(result.content)
    || !result.content.every(isValidMcpContentItem)
    || (Object.hasOwn(result, 'isError') && typeof result.isError !== 'boolean')
  ) {
    throw verificationError('protocol_error', null);
  }

  if (result.isError === true) {
    throw verificationError('protocol_error', null, 'The MCP onboarding check failed.');
  }

  if (Object.hasOwn(result, 'structuredContent')) {
    if (!isRecord(result.structuredContent)) throw verificationError('protocol_error', null);
    return result.structuredContent;
  }

  const firstText = result.content.find((item) => isRecord(item) && item.type === 'text' && typeof item.text === 'string');
  if (!isRecord(firstText) || typeof firstText.text !== 'string') throw verificationError('protocol_error', null);

  try {
    const parsed: unknown = JSON.parse(firstText.text);
    if (!isRecord(parsed)) throw verificationError('protocol_error', null);
    return parsed;
  } catch (error) {
    if (error instanceof McpVerificationError) throw error;
    throw verificationError('protocol_error', null);
  }
}

function readVerifiedIdentity(
  toolCount: number,
  result: Record<string, unknown>,
): McpVerificationResult {
  const identity = parseOnboardContent(result);
  const agent = identity.agent;
  const connection = identity.connection;
  const contractVersion = identity.contractVersion;

  if (
    !isRecord(agent)
    || typeof agent.name !== 'string'
    || agent.name.trim() === ''
    || !isRecord(connection)
    || typeof connection.id !== 'string'
    || connection.id.trim() === ''
    || typeof contractVersion !== 'string'
    || contractVersion.trim() === ''
  ) {
    throw verificationError('protocol_error', null);
  }

  return {
    agentName: agent.name,
    connectionId: connection.id,
    contractVersion,
    status: 'verified',
    toolCount,
  };
}

export async function verifyHostedMcp(input: VerifyHostedMcpInput): Promise<McpVerificationResult> {
  const validated = validateInput(input);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), validated.timeoutMs);
  const context: RequestContext = { ...validated, signal: controller.signal };

  try {
    await rpc(context, 1, 'initialize', INITIALIZE_PARAMS);
    await notify(context, 'notifications/initialized');
    const listed = await rpc(context, 2, 'tools/list', {});
    const { toolCount } = readTools(listed);
    const onboarded = await rpc(context, 3, 'tools/call', { arguments: {}, name: 'agentops.onboard' });
    return readVerifiedIdentity(toolCount, onboarded);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function safeMcpVerificationMessage(error: unknown): string {
  if (error instanceof McpVerificationError) return SAFE_MESSAGES[error.code];
  return 'MCP verification failed. Try again.';
}
