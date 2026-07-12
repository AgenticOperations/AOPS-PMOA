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
  | 'response_too_large'
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
const MAX_RESPONSE_BYTES = 1_048_576;

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
  response_too_large: 'The MCP service response was too large.',
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasOwnNonBlankString<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, string> {
  return Object.hasOwn(value, key) && typeof value[key] === 'string' && value[key].trim() !== '';
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

async function readBoundedText(response: Response, signal: AbortSignal): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) throw verificationError('protocol_error', response.status);
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes)) throw verificationError('protocol_error', response.status);
    if (declaredBytes > MAX_RESPONSE_BYTES) {
      try {
        await response.body?.cancel();
      } catch {
        // The fixed verifier error below is safe regardless of cancellation behavior.
      }
      throw verificationError('response_too_large', response.status);
    }
  }

  if (response.body === null) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  let completed = false;

  try {
    while (true) {
      if (signal.aborted) throw verificationError('timeout', null);

      let removeAbortListener = () => {};
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => {
          void reader.cancel().catch(() => undefined);
          reject(verificationError('timeout', null));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener('abort', onAbort);
      });

      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([reader.read(), aborted]);
      } finally {
        removeAbortListener();
      }
      if (signal.aborted) throw verificationError('timeout', null);
      if (chunk.done) {
        completed = true;
        break;
      }
      if (!ArrayBuffer.isView(chunk.value) || chunk.value.BYTES_PER_ELEMENT !== 1) {
        throw verificationError('protocol_error', response.status);
      }

      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The bounded failure remains safe even when the stream cannot be cancelled.
        }
        throw verificationError('response_too_large', response.status);
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } catch (error) {
    if (signal.aborted) throw verificationError('timeout', null);
    if (error instanceof McpVerificationError) throw error;
    throw verificationError('protocol_error', response.status);
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Never surface a raw stream cancellation error.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // The reader may still be settling after an abort; it owns no reusable state.
    }
  }
}

async function readJson(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  requireJsonResponse(response);
  try {
    const text = await readBoundedText(response, signal);
    const body: unknown = JSON.parse(text);
    if (!isPlainObject(body)) throw verificationError('protocol_error', response.status);
    return body;
  } catch (error) {
    if (signal.aborted) throw verificationError('timeout', null);
    if (error instanceof McpVerificationError) throw error;
    throw verificationError('protocol_error', response.status);
  }
}

async function post(context: RequestContext, body: Record<string, unknown>): Promise<Response> {
  try {
    return await context.fetchImpl(context.endpoint, {
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        // MCP requires both media types in Accept; hosted AOPS must answer JSON and this verifier never parses SSE.
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${context.credential}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
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

  const body = await readJson(response, context.signal);
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

  const text = await readBoundedText(response, context.signal);
  if (text !== '') throw verificationError('protocol_error', response.status);
}

function assertInitializeResult(result: Record<string, unknown>): void {
  const capabilities = result.capabilities;
  const serverInfo = result.serverInfo;
  if (
    !hasOwnNonBlankString(result, 'protocolVersion')
    || !Object.hasOwn(result, 'capabilities')
    || !isPlainObject(capabilities)
    || !Object.hasOwn(result, 'serverInfo')
    || !isPlainObject(serverInfo)
    || !hasOwnNonBlankString(serverInfo, 'name')
    || !hasOwnNonBlankString(serverInfo, 'version')
  ) {
    throw verificationError('protocol_error', null);
  }
}

function readTools(result: Record<string, unknown>): { readonly toolCount: number } {
  if (!Array.isArray(result.tools)) throw verificationError('protocol_error', null);

  const names = result.tools.map((tool) => {
    if (
      !isPlainObject(tool)
      || !hasOwnNonBlankString(tool, 'name')
      || !Object.hasOwn(tool, 'inputSchema')
      || !isPlainObject(tool.inputSchema)
      || !Object.hasOwn(tool.inputSchema, 'type')
      || tool.inputSchema.type !== 'object'
    ) {
      throw verificationError('protocol_error', null);
    }
    return tool.name as string;
  });

  const available = new Set(names);
  if (available.size !== names.length) throw verificationError('protocol_error', null);
  for (const required of REQUIRED_TOOLS) {
    if (!available.has(required)) {
      throw verificationError('protocol_error', null, 'The MCP service did not provide the required tools.');
    }
  }
  return { toolCount: available.size };
}

function isValidAopsTextContent(item: unknown): item is Record<string, unknown> & { readonly text: string } {
  return isPlainObject(item)
    && Object.hasOwn(item, 'type')
    && item.type === 'text'
    && Object.hasOwn(item, 'text')
    && typeof item.text === 'string';
}

function parseOnboardContent(result: Record<string, unknown>): Record<string, unknown> {
  if (
    !Array.isArray(result.content)
    || result.content.length === 0
    || !result.content.every(isValidAopsTextContent)
    || (Object.hasOwn(result, 'isError') && typeof result.isError !== 'boolean')
  ) {
    throw verificationError('protocol_error', null);
  }

  if (result.isError === true) {
    throw verificationError('protocol_error', null, 'The MCP onboarding check failed.');
  }

  if (Object.hasOwn(result, 'structuredContent')) {
    if (!isPlainObject(result.structuredContent)) throw verificationError('protocol_error', null);
    return result.structuredContent;
  }

  const firstText = result.content[0];
  if (!isValidAopsTextContent(firstText)) throw verificationError('protocol_error', null);

  try {
    const parsed: unknown = JSON.parse(firstText.text);
    if (!isPlainObject(parsed)) throw verificationError('protocol_error', null);
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
    !Object.hasOwn(identity, 'agent')
    || !isPlainObject(agent)
    || !hasOwnNonBlankString(agent, 'name')
    || !Object.hasOwn(identity, 'connection')
    || !isPlainObject(connection)
    || !hasOwnNonBlankString(connection, 'id')
    || !Object.hasOwn(identity, 'contractVersion')
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
    const initialized = await rpc(context, 1, 'initialize', INITIALIZE_PARAMS);
    assertInitializeResult(initialized);
    await notify(context, 'notifications/initialized');
    const listed = await rpc(context, 2, 'tools/list', {});
    const { toolCount } = readTools(listed);
    const onboarded = await rpc(context, 3, 'tools/call', { arguments: {}, name: 'agentops.onboard' });
    return readVerifiedIdentity(toolCount, onboarded);
  } catch (error) {
    if (controller.signal.aborted) throw verificationError('timeout', null);
    if (error instanceof McpVerificationError) throw error;
    throw verificationError('protocol_error', null);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function safeMcpVerificationMessage(error: unknown): string {
  if (error instanceof McpVerificationError) return SAFE_MESSAGES[error.code];
  return 'MCP verification failed. Try again.';
}
