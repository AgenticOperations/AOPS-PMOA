import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { HostedMcpConfig } from './http-config.js';
import { RuntimeApiError } from './runtime-client.js';
import { buildAgentOpsMcpServer } from './server.js';
import type { AgentOpsRuntimeClient } from './tools.js';

export type SafeRequestLog = {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly userAgent: string | null;
};

export type HostedMcpHandlerDeps = {
  readonly config: HostedMcpConfig;
  readonly createRuntimeClient: (credential: string) => AgentOpsRuntimeClient;
  readonly onRequestLog?: (event: SafeRequestLog) => void | Promise<void>;
};

type OriginCheck =
  | { readonly kind: 'absent' }
  | { readonly kind: 'allowed'; readonly value: string }
  | { readonly kind: 'forbidden' };

type BodyReadResult =
  | { readonly kind: 'body'; readonly value: Buffer }
  | { readonly kind: 'too-large' };

const BEARER_CHALLENGE = 'Bearer realm="agentops-mcp"';
const PREFLIGHT_MAX_AGE_SECONDS = 600;
const MAX_USER_AGENT_LENGTH = 256;

function rawHeaderValues(request: IncomingMessage, name: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      const value = request.rawHeaders[index + 1];
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}

function normalizePort(value: string | undefined): string | null {
  if (value === undefined) return '';
  if (!/^[0-9]+$/.test(value)) return null;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) return null;
  return `:${String(port)}`;
}

function normalizeHost(value: string): string | null {
  if (value.length === 0 || /[\s,/@\\]/.test(value)) return null;
  if (value.startsWith('[') || value.includes(']')) {
    const match = /^\[([^\]]+)\](?::(.*))?$/.exec(value);
    if (match === null) return null;
    const address = match[1];
    const port = normalizePort(match[2]);
    if (address === undefined || isIP(address) !== 6 || port === null) return null;
    return `${new URL(`http://[${address}]/`).hostname.toLowerCase()}${port}`;
  }

  const colonIndex = value.indexOf(':');
  if (colonIndex !== value.lastIndexOf(':')) return null;
  const hostname = (colonIndex === -1 ? value : value.slice(0, colonIndex)).toLowerCase();
  const port = normalizePort(colonIndex === -1 ? undefined : value.slice(colonIndex + 1));
  if (hostname.length === 0 || port === null) return null;
  if (isIP(hostname) === 4) return `${hostname}${port}`;
  if (hostname.length > 253) return null;
  const labels = hostname.split('.');
  if (labels.every((label) => /^(?:[0-9]+|0x[0-9a-f]+)$/i.test(label))) return null;
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return null;
  }
  return `${hostname}${port}`;
}

function hasAllowedHost(request: IncomingMessage, config: HostedMcpConfig): boolean {
  const values = rawHeaderValues(request, 'host');
  if (values.length !== 1) return false;
  const host = values[0];
  if (host === undefined) return false;
  const normalized = normalizeHost(host);
  return normalized !== null && normalized === host.toLowerCase() && config.allowedHosts.includes(normalized);
}

function normalizeOrigin(value: string): string | null {
  if (value.length === 0 || /[\s,]/.test(value)) return null;
  const schemeEnd = value.indexOf('://');
  if (schemeEnd <= 0) return null;
  const authorityStart = schemeEnd + 3;
  if (authorityStart >= value.length || value.slice(authorityStart).search(/[/?#]/) !== -1) {
    return null;
  }
  const authority = value.slice(authorityStart);
  if (authority.includes('@') || normalizeHost(authority) === null) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== '/' ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    return null;
  }
  return parsed.origin;
}

function checkOrigin(request: IncomingMessage, config: HostedMcpConfig): OriginCheck {
  const values = rawHeaderValues(request, 'origin');
  if (values.length === 0) return { kind: 'absent' };
  if (values.length !== 1) return { kind: 'forbidden' };
  const value = values[0];
  if (value === undefined) return { kind: 'forbidden' };
  const normalized = normalizeOrigin(value);
  if (normalized === null || !config.allowedOrigins.includes(normalized)) {
    return { kind: 'forbidden' };
  }
  return { kind: 'allowed', value };
}

function setAllowedOrigin(response: ServerResponse, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
}

function writeSafeJson(
  response: ServerResponse,
  status: number,
  requestId: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (response.writableEnded) return;
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify({ requestId }));
}

function writeSafeJsonAndClose(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  requestId: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  const socket = request.socket;
  response.setHeader('Connection', 'close');
  response.once('finish', () => {
    if (!socket.destroyed) socket.destroySoon();
  });
  writeSafeJson(response, status, requestId, headers);
}

function readBearerCredential(request: IncomingMessage): string | null {
  const values = rawHeaderValues(request, 'authorization');
  if (values.length !== 1) return null;
  const value = values[0];
  if (value === undefined || value.length > 4096 || value.includes(',')) return null;
  const match = /^Bearer ([^\s,]+)$/.exec(value);
  const credential = match?.[1];
  if (credential === undefined || credential.length === 0 || credential.length > 4096) return null;
  return credential;
}

function singleHeader(request: IncomingMessage, name: string): string | null {
  const values = rawHeaderValues(request, name);
  return values.length === 1 ? (values[0] ?? null) : null;
}

function hasJsonContentType(request: IncomingMessage): boolean {
  const value = singleHeader(request, 'content-type');
  return value !== null && value.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function acceptsMcpResponses(request: IncomingMessage): boolean {
  const values = rawHeaderValues(request, 'accept');
  if (values.length === 0) return false;
  const ranges = values.flatMap((value) => value.split(','));
  return ['application/json', 'text/event-stream'].every((requiredType) =>
    ranges.some((range) => {
      const [rawType, ...rawParameters] = range.split(';');
      if (rawType?.trim().toLowerCase() !== requiredType) return false;
      let quality = 1;
      let foundQuality = false;
      for (const rawParameter of rawParameters) {
        const separator = rawParameter.indexOf('=');
        if (separator === -1) continue;
        const name = rawParameter.slice(0, separator).trim().toLowerCase();
        if (name !== 'q') continue;
        if (foundQuality) return false;
        foundQuality = true;
        const value = rawParameter.slice(separator + 1).trim();
        if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)) return false;
        quality = Number(value);
      }
      return quality > 0;
    }),
  );
}

async function readBoundedBody(request: IncomingMessage, maximumBytes: number): Promise<BodyReadResult> {
  const declaredLength = singleHeader(request, 'content-length');
  if (declaredLength !== null && /^[0-9]+$/.test(declaredLength)) {
    const parsedLength = Number(declaredLength);
    if (Number.isSafeInteger(parsedLength) && parsedLength > maximumBytes) {
      return { kind: 'too-large' };
    }
  }

  return new Promise<BodyReadResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const cleanup = (): void => {
      request.off('aborted', onAborted);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
    };
    const finish = (result: BodyReadResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onAborted = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException('Request aborted.', 'AbortError'));
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maximumBytes) {
        finish({ kind: 'too-large' });
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => finish({ kind: 'body', value: Buffer.concat(chunks) });
    const onError = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    request.on('aborted', onAborted);
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
  });
}

function parseJsonRpcObject(body: Buffer): Record<string, unknown> | null {
  if (body.byteLength === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function failureStatus(error: unknown): 401 | 500 | 503 {
  if (error instanceof RuntimeApiError) {
    if (error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 404) return 401;
    if (error.statusCode >= 500) return 503;
    return 500;
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return 503;
    if (error instanceof TypeError && /fetch|network|socket|connect/i.test(error.message)) return 503;
  }
  return 500;
}

async function handleAuthenticatedMcp(
  request: IncomingMessage,
  response: ServerResponse,
  credential: string,
  deps: HostedMcpHandlerDeps,
  requestId: string,
): Promise<void> {
  const bodyResult = await readBoundedBody(request, deps.config.maxBodyBytes);
  if (bodyResult.kind === 'too-large') {
    writeSafeJsonAndClose(request, response, 413, requestId);
    return;
  }
  const body = parseJsonRpcObject(bodyResult.value);
  if (body === null) {
    writeSafeJson(response, 400, requestId);
    return;
  }

  let transport: StreamableHTTPServerTransport | undefined;
  let server: ReturnType<typeof buildAgentOpsMcpServer> | undefined;
  try {
    const runtimeClient = deps.createRuntimeClient(credential);
    await runtimeClient.onboard();
    server = buildAgentOpsMcpServer(runtimeClient);
    transport = new StreamableHTTPServerTransport(
      {
        enableJsonResponse: true,
        sessionIdGenerator: undefined,
      } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0],
    );
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(request, response, body);
  } catch (error) {
    const status = failureStatus(error);
    writeSafeJson(
      response,
      status,
      requestId,
      status === 401 ? { 'WWW-Authenticate': BEARER_CHALLENGE } : {},
    );
  } finally {
    await Promise.allSettled([
      ...(transport === undefined ? [] : [transport.close()]),
      ...(server === undefined ? [] : [server.close()]),
    ]);
  }
}

function safePath(request: IncomingMessage): string {
  const value = request.url ?? '/';
  const queryIndex = value.search(/[?#]/);
  return queryIndex === -1 ? value : value.slice(0, queryIndex);
}

function safeUserAgent(request: IncomingMessage, credential: string | undefined): string | null {
  const value = singleHeader(request, 'user-agent');
  if (value === null) return null;
  let sanitized = [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159) ? '?' : character;
    })
    .join('');
  if (credential !== undefined && credential.length > 0) {
    sanitized = sanitized.replaceAll(credential, '[REDACTED]');
  }
  return sanitized.slice(0, MAX_USER_AGENT_LENGTH);
}

export function createHostedMcpHandler(deps: HostedMcpHandlerDeps): RequestListener {
  let inFlight = 0;

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    const method = request.method ?? '';
    const path = safePath(request);
    let credentialForLog: string | undefined;

    try {
      const origin = checkOrigin(request, deps.config);
      if (origin.kind === 'allowed') setAllowedOrigin(response, origin.value);
      if (origin.kind === 'forbidden' || !hasAllowedHost(request, deps.config)) {
        writeSafeJsonAndClose(request, response, 403, requestId);
        return;
      }
      if (request.url !== '/mcp') {
        writeSafeJsonAndClose(request, response, 404, requestId);
        return;
      }
      if (method === 'OPTIONS') {
        if (origin.kind !== 'allowed') {
          writeSafeJsonAndClose(request, response, 403, requestId);
          return;
        }
        response.statusCode = 204;
        response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
        response.setHeader('Access-Control-Allow-Methods', 'POST');
        response.setHeader('Access-Control-Max-Age', String(PREFLIGHT_MAX_AGE_SECONDS));
        response.end();
        return;
      }

      const credential = readBearerCredential(request);
      if (credential === null) {
        writeSafeJsonAndClose(request, response, 401, requestId, {
          'WWW-Authenticate': BEARER_CHALLENGE,
        });
        return;
      }
      credentialForLog = credential;
      if (method !== 'POST') {
        writeSafeJsonAndClose(request, response, 405, requestId, { Allow: 'POST, OPTIONS' });
        return;
      }
      if (!hasJsonContentType(request)) {
        writeSafeJsonAndClose(request, response, 415, requestId);
        return;
      }
      if (!acceptsMcpResponses(request)) {
        writeSafeJsonAndClose(request, response, 406, requestId);
        return;
      }
      if (inFlight >= deps.config.maxInFlight) {
        writeSafeJsonAndClose(request, response, 429, requestId, { 'Retry-After': '1' });
        return;
      }

      inFlight += 1;
      try {
        await handleAuthenticatedMcp(request, response, credential, deps, requestId);
      } finally {
        inFlight -= 1;
      }
    } catch {
      writeSafeJson(response, 500, requestId);
    } finally {
      const event: SafeRequestLog = {
        durationMs: Math.max(0, performance.now() - startedAt),
        method,
        path,
        requestId,
        status: response.statusCode,
        userAgent: safeUserAgent(request, credentialForLog),
      };
      try {
        await deps.onRequestLog?.(event);
      } catch {
        // Request logging must never affect the response path.
      }
    }
  };

  return (request, response) => {
    void handle(request, response);
  };
}
