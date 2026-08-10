import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createServer, request as httpRequest, type RequestListener, type Server } from 'node:http';
import { connect as netConnect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeApiError } from '../src/runtime-client.js';
import type { AgentOpsRuntimeClient } from '../src/tools.js';
import {
  createHostedMcpHandler,
  type HostedMcpHandlerDeps,
  type SafeRequestLog,
} from '../src/http-handler.js';
import type { HostedMcpConfig } from '../src/http-config.js';

type StartedHandler = {
  readonly config: HostedMcpConfig;
  readonly server: Server;
  readonly url: URL;
};

type RawResponse = {
  readonly body: string;
  readonly headers: Headers;
  readonly status: number;
};

const servers = new Set<Server>();

function fakeClient(
  credential = 'credential-a',
  overrides: Partial<AgentOpsRuntimeClient> = {},
): AgentOpsRuntimeClient {
  return {
    activityRecord: () => Promise.resolve({}),
    approvalConsume: () => Promise.resolve({}),
    approvalStatus: () => Promise.resolve({}),
    check: () => Promise.resolve({}),
    identityRegister: () => Promise.resolve({}),
    identityStatus: () => Promise.resolve({}),
    onboard: () => Promise.resolve({ tenant: credential }),
    operationCheck: () => Promise.resolve({}),
    operationRecord: () => Promise.resolve({}),
    paymentIntraFleet: () => Promise.resolve({}),
    paymentX402: () => Promise.resolve({}),
    publish: () => Promise.resolve({}),
    ...overrides,
  };
}

async function startHandler(
  options: {
    readonly config?: Partial<HostedMcpConfig>;
    readonly createRuntimeClient?: HostedMcpHandlerDeps['createRuntimeClient'];
    readonly onRequestLog?: HostedMcpHandlerDeps['onRequestLog'];
  } = {},
): Promise<StartedHandler> {
  const server = createServer({ requireHostHeader: false });
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing test listener.');
  const url = new URL(`http://127.0.0.1:${String(address.port)}/mcp`);
  const config: HostedMcpConfig = {
    apiBaseUrl: 'http://127.0.0.1:8080',
    host: '127.0.0.1',
    port: address.port,
    publicUrl: url.href,
    allowedHosts: [url.host],
    allowedOrigins: ['https://console.example.test'],
    timeoutMs: 1_000,
    maxBodyBytes: 16_384,
    maxInFlight: 200,
    shutdownGraceMs: 1_000,
    ...options.config,
  };
  const handler: RequestListener = createHostedMcpHandler({
    config,
    createRuntimeClient: options.createRuntimeClient ?? ((credential) => fakeClient(credential)),
    ...(options.onRequestLog === undefined ? {} : { onRequestLog: options.onRequestLog }),
  });
  server.on('request', handler);
  return { config, server, url };
}

async function rawSocketRequest(started: StartedHandler, payload: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = netConnect({ host: started.url.hostname, port: Number(started.url.port) });
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Raw test socket remained open.'));
    }, 1_500);
    socket.once('connect', () => socket.write(payload));
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

function rawPostHead(started: StartedHandler, extraHeaders: readonly string[]): string {
  return [
    'POST /mcp HTTP/1.1',
    `Host: ${started.url.host}`,
    'Authorization: Bearer credential-a',
    'Content-Type: application/json',
    'Accept: application/json, text/event-stream',
    ...extraHeaders,
    '',
    '',
  ].join('\r\n');
}

async function closeServer(server: Server): Promise<void> {
  servers.delete(server);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
    server.closeAllConnections();
  });
}

async function rawRequest(
  started: StartedHandler,
  options: {
    readonly authorization?: string | undefined;
    readonly body?: string | undefined;
    readonly headers?: Record<string, string> | undefined;
    readonly method?: string | undefined;
    readonly path?: string | undefined;
    readonly setHost?: boolean | undefined;
  } = {},
): Promise<RawResponse> {
  const body = options.body;
  const headers: Record<string, string> = { ...options.headers };
  if (options.authorization !== undefined) headers.authorization = options.authorization;
  if (body !== undefined && headers['content-length'] === undefined) {
    headers['content-length'] = String(Buffer.byteLength(body));
  }
  return new Promise<RawResponse>((resolve, reject) => {
    const request = httpRequest(
      {
        headers,
        hostname: started.url.hostname,
        method: options.method ?? 'POST',
        path: options.path ?? started.url.pathname,
        port: started.url.port,
        setHost: options.setHost,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: new Headers(
              Object.entries(response.headers).flatMap(([name, value]) =>
                value === undefined
                  ? []
                  : [[name, Array.isArray(value) ? value.join(', ') : value] as [string, string]],
              ),
            ),
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.once('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

const initializeBody = JSON.stringify({
  id: 1,
  jsonrpc: '2.0',
  method: 'initialize',
  params: {
    capabilities: {},
    clientInfo: { name: 'raw-test', version: '1.0.0' },
    protocolVersion: '2025-06-18',
  },
});

function validPostHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...extra,
  };
}

async function connectClient(url: URL, credential: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${credential}` } },
  });
  const client = new Client({ name: `test-${credential}`, version: '1.0.0' });
  await client.connect(transport as unknown as Transport);
  return client;
}

afterEach(async () => {
  await Promise.all([...servers].map(async (server) => closeServer(server)));
});

describe('createHostedMcpHandler', () => {
  it('supports initialize, all nine tools, and agentops.onboard through the real SDK transport', async () => {
    const credentials: string[] = [];
    const started = await startHandler({
      createRuntimeClient: (credential) => {
        credentials.push(credential);
        return fakeClient(credential);
      },
    });
    const client = await connectClient(started.url, 'credential-a');

    try {
      expect(client.getServerVersion()).toEqual({ name: 'agentops', version: '0.0.0' });
      expect((await client.listTools()).tools).toHaveLength(12);
      expect(await client.callTool({ name: 'agentops.onboard', arguments: {} })).toMatchObject({
        isError: false,
        structuredContent: { tenant: 'credential-a' },
      });
      expect(credentials.length).toBeGreaterThanOrEqual(3);
      expect(credentials.every((credential) => credential === 'credential-a')).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('recovers the same payment key after the MCP caller disconnects without executing the provider twice', async () => {
    const results = new Map<string, Record<string, unknown>>();
    let providerCalls = 0;
    let signalProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      signalProviderStarted = resolve;
    });
    let releaseProvider!: () => void;
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let signalSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      signalSettled = resolve;
    });
    const started = await startHandler({
      createRuntimeClient: (credential) => fakeClient(credential, {
        paymentX402: async (input) => {
          const retained = results.get(input.idempotency_key);
          if (retained !== undefined) return retained;
          providerCalls += 1;
          signalProviderStarted();
          await providerRelease;
          const result = {
            payment: {
              attemptId: 'rpa_lost_mcp_response',
              responseAvailable: true,
              status: 'settled',
              transaction: '0xpaid-once',
            },
            response: {
              body: { delivered: true },
              bodyEncoding: 'json',
              headers: [['content-type', 'application/json']],
              sizeBytes: 18,
              status: 200,
              truncated: false,
            },
          };
          results.set(input.idempotency_key, result);
          signalSettled();
          return result;
        },
      }),
    });
    const toolBody = JSON.stringify({
      id: 77,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'agentops.payment_x402',
        arguments: {
          idempotency_key: 'lost-mcp-response-key',
          request: {
            headers: [],
            method: 'GET',
            url: 'https://merchant.example.test/report',
          },
        },
      },
    });
    const lostResponse = new Promise<RawResponse>((resolve, reject) => {
      const request = httpRequest(
        {
          headers: {
            ...validPostHeaders(),
            authorization: 'Bearer credential-a',
            'content-length': String(Buffer.byteLength(toolBody)),
          },
          hostname: started.url.hostname,
          method: 'POST',
          path: started.url.pathname,
          port: started.url.port,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: new Headers(),
            status: response.statusCode ?? 0,
          }));
        },
      );
      request.once('error', reject);
      request.end(toolBody);
      void providerStarted.then(() => request.destroy(new Error('Test MCP caller disconnected.')));
    });

    await providerStarted;
    await expect(lostResponse).rejects.toThrow('Test MCP caller disconnected.');
    releaseProvider();
    await settled;

    const replay = await rawRequest(started, {
      authorization: 'Bearer credential-a',
      body: toolBody,
      headers: validPostHeaders(),
    });
    expect(replay.status).toBe(200);
    expect(JSON.parse(replay.body)).toMatchObject({
      id: 77,
      result: {
        isError: false,
        structuredContent: {
          payment: {
            attemptId: 'rpa_lost_mcp_response',
            status: 'settled',
            transaction: '0xpaid-once',
          },
        },
      },
    });
    expect(providerCalls).toBe(1);
  });

  it.each([
    ['missing', undefined],
    ['wrong scheme', 'Basic abc'],
    ['blank', 'Bearer '],
    ['whitespace token', 'Bearer two tokens'],
    ['comma token', 'Bearer first,second'],
    ['oversize header', `Bearer ${'x'.repeat(4090)}`],
    ['oversize', `Bearer ${'x'.repeat(4097)}`],
  ])('returns a bearer challenge for a %s credential', async (_label, authorization) => {
    const started = await startHandler();
    const response = await rawRequest(started, {
      authorization,
      body: initializeBody,
      headers: validPostHeaders(),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="agentops-mcp"');
  });

  it.each([401, 403, 404])('maps runtime identity status %i to a generic 401', async (statusCode) => {
    const started = await startHandler({
      createRuntimeClient: () =>
        fakeClient('revoked-secret', {
          onboard: () =>
            Promise.reject(
              new RuntimeApiError(statusCode, 'organization org-sensitive has a revoked agent', 'sensitive_code'),
            ),
        }),
    });
    const response = await rawRequest(started, {
      authorization: 'Bearer revoked-secret',
      body: initializeBody,
      headers: validPostHeaders(),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="agentops-mcp"');
    expect(response.body).not.toContain('revoked-secret');
    expect(response.body).not.toContain('org-sensitive');
    expect(response.body).not.toContain('sensitive_code');
    expect(Object.keys(JSON.parse(response.body) as object)).toEqual(['requestId']);
  });

  it('returns safe 404 and authenticated 405 responses with the required Allow header', async () => {
    const started = await startHandler();

    const missing = await rawRequest(started, { method: 'GET', path: '/not-mcp' });
    expect(missing.status).toBe(404);
    expect(Object.keys(JSON.parse(missing.body) as object)).toEqual(['requestId']);

    for (const method of ['GET', 'DELETE', 'PATCH']) {
      const response = await rawRequest(started, {
        authorization: 'Bearer credential-a',
        method,
      });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST, OPTIONS');
    }
  });

  it('rejects missing, malformed, and disallowed hosts while accepting a canonical allowed host', async () => {
    const started = await startHandler();

    const allowed = await rawRequest(started, { method: 'GET', path: '/not-mcp' });
    expect(allowed.status).toBe(404);

    const missing = await rawRequest(started, { method: 'GET', path: '/not-mcp', setHost: false });
    expect(missing.status).toBe(403);

    for (const host of [
      'example.test',
      'user@example.test',
      `${started.url.host},evil.test`,
      `${started.url.hostname}:0${started.url.port}`,
    ]) {
      const response = await rawRequest(started, {
        headers: { host },
        method: 'GET',
        path: '/not-mcp',
      });
      expect(response.status).toBe(403);
      expect(response.body).not.toContain(host);
    }
  });

  it('normalizes allowed origins, emits CORS on every response, and rejects unsafe origins', async () => {
    const started = await startHandler();
    const allowedOrigin = 'HTTPS://CONSOLE.EXAMPLE.TEST:443';
    const allowed = await rawRequest(started, {
      headers: { origin: allowedOrigin },
      method: 'GET',
      path: '/not-mcp',
    });
    expect(allowed.status).toBe(404);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(allowed.headers.get('vary')).toBe('Origin');

    for (const origin of [
      'https://evil.example.test',
      'https://user:pass@console.example.test',
      'https://console.example.test/path',
      'https://console.example.test?query=1',
      'https://console.example.test#hash',
      'https://console.example.test, https://evil.example.test',
    ]) {
      const response = await rawRequest(started, {
        headers: { origin },
        method: 'GET',
        path: '/not-mcp',
      });
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(response.body).not.toContain(origin);
    }
  });

  it('allows configured browser preflight without authentication and forbids disallowed preflight', async () => {
    const started = await startHandler();
    const allowed = await rawRequest(started, {
      headers: {
        'access-control-request-headers': 'authorization, content-type',
        'access-control-request-method': 'POST',
        'access-control-request-private-network': 'true',
        origin: 'https://console.example.test',
      },
      method: 'OPTIONS',
    });

    expect(allowed.status).toBe(204);
    expect(allowed.body).toBe('');
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://console.example.test');
    expect(allowed.headers.get('access-control-allow-methods')).toBe('POST');
    expect(allowed.headers.get('access-control-allow-headers')).toBe('authorization, content-type');
    expect(allowed.headers.get('access-control-allow-private-network')).toBe('true');
    expect(Number(allowed.headers.get('access-control-max-age'))).toBeGreaterThan(0);
    expect(Number(allowed.headers.get('access-control-max-age'))).toBeLessThanOrEqual(86_400);

    for (const privateNetworkValue of [undefined, 'false', 'TRUE', 'true, true']) {
      const headers: Record<string, string> = {
        'access-control-request-headers': 'authorization, content-type',
        'access-control-request-method': 'POST',
        origin: 'https://console.example.test',
      };
      if (privateNetworkValue !== undefined) {
        headers['access-control-request-private-network'] = privateNetworkValue;
      }
      const notRequested = await rawRequest(started, { headers, method: 'OPTIONS' });
      expect(notRequested.status).toBe(204);
      expect(notRequested.headers.get('access-control-allow-private-network')).toBeNull();
    }

    const disallowed = await rawRequest(started, {
      headers: {
        'access-control-request-private-network': 'true',
        origin: 'https://evil.example.test',
      },
      method: 'OPTIONS',
    });
    expect(disallowed.status).toBe(403);
    expect(disallowed.headers.get('access-control-allow-private-network')).toBeNull();
  });

  it('enforces JSON content type and both MCP response media types', async () => {
    const started = await startHandler();
    const unsupported = await rawRequest(started, {
      authorization: 'Bearer credential-a',
      body: initializeBody,
      headers: validPostHeaders({ 'content-type': 'text/plain' }),
    });
    expect(unsupported.status).toBe(415);

    for (const accept of [
      'application/json',
      'text/event-stream',
      '*/*',
      'application/json; q=0, text/event-stream',
      'application/json, text/event-stream; q=0',
      'application/json; q=-0.1, text/event-stream',
      'application/json; q=invalid, text/event-stream',
      'application/json; profile="a,b"; q=0, text/event-stream',
      'application/json; profile="a,b, text/event-stream',
    ]) {
      const unacceptable = await rawRequest(started, {
        authorization: 'Bearer credential-a',
        body: initializeBody,
        headers: validPostHeaders({ accept }),
      });
      expect(unacceptable.status).toBe(406);
    }

    const parameterized = await rawRequest(started, {
      authorization: 'Bearer credential-a',
      body: initializeBody,
      headers: validPostHeaders({
        accept: 'application/json; charset=utf-8; q=0.5, text/event-stream; q=1.0',
      }),
    });
    expect(parameterized.status).toBe(200);
  });

  it('fails closed on duplicate authorization, duplicate host, and content-length plus transfer-encoding', async () => {
    const started = await startHandler();
    const duplicateAuthorization = await rawSocketRequest(
      started,
      rawPostHead(started, [
        'Authorization: Bearer credential-b',
        `Content-Length: ${String(Buffer.byteLength(initializeBody))}`,
        '',
        initializeBody,
      ]),
    );
    expect(duplicateAuthorization).toMatch(/^HTTP\/1\.1 401 /);

    const duplicateHost = await rawSocketRequest(
      started,
      [
        'GET /not-mcp HTTP/1.1',
        `Host: ${started.url.host}`,
        'Host: evil.example.test',
        '',
        '',
      ].join('\r\n'),
    );
    expect(duplicateHost).toMatch(/^HTTP\/1\.1 403 /);

    const clAndTe = await rawSocketRequest(
      started,
      rawPostHead(started, [
        `Content-Length: ${String(Buffer.byteLength(initializeBody))}`,
        'Transfer-Encoding: chunked',
        '',
        initializeBody,
      ]),
    );
    expect(clAndTe).toMatch(/^HTTP\/1\.1 400 /);
  });

  it.each([
    ['empty', ''],
    ['malformed', '{'],
    ['array', '[]'],
    ['null', 'null'],
    ['primitive', 'true'],
  ])('rejects %s JSON-RPC bodies safely', async (_label, body) => {
    const started = await startHandler();
    const response = await rawRequest(started, {
      authorization: 'Bearer credential-a',
      body,
      headers: validPostHeaders(),
    });
    expect(response.status).toBe(400);
    expect(Object.keys(JSON.parse(response.body) as object)).toEqual(['requestId']);
  });

  it('rejects bodies over the configured byte limit before creating a runtime client', async () => {
    let created = 0;
    const started = await startHandler({
      config: { maxBodyBytes: 32 },
      createRuntimeClient: (credential) => {
        created += 1;
        return fakeClient(credential);
      },
    });
    const secretBody = JSON.stringify({ payload: 'body-secret'.repeat(10) });
    const response = await rawRequest(started, {
      authorization: 'Bearer credential-a',
      body: secretBody,
      headers: validPostHeaders(),
    });

    expect(response.status).toBe(413);
    expect(response.body).not.toContain('body-secret');
    expect(created).toBe(0);
  });

  it('closes slow chunked attacker sockets after observable 413 and 429 responses', async () => {
    let releaseFirst: (() => void) | undefined;
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let signalStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const started = await startHandler({
      config: { maxBodyBytes: 256, maxInFlight: 1 },
      createRuntimeClient: (credential) =>
        fakeClient(credential, {
          onboard: async () => {
            signalStarted?.();
            await release;
            return { tenant: credential };
          },
        }),
    });

    const oversized = await rawSocketRequest(
      started,
      `${rawPostHead(started, ['Transfer-Encoding: chunked'])}200\r\n${'x'.repeat(512)}\r\n`,
    );
    expect(oversized).toMatch(/^HTTP\/1\.1 413 /);
    expect(oversized).toMatch(/\r\nConnection: close\r\n/i);

    const first = rawRequest(started, {
      authorization: 'Bearer credential-a',
      body: initializeBody,
      headers: validPostHeaders(),
    });
    await firstStarted;
    const busy = await rawSocketRequest(
      started,
      rawPostHead(started, ['Transfer-Encoding: chunked']),
    );
    expect(busy).toMatch(/^HTTP\/1\.1 429 /);
    expect(busy).toMatch(/\r\nConnection: close\r\n/i);

    releaseFirst?.();
    expect((await first).status).toBe(200);
  });

  it.each([
    ['timeout', new DOMException('credential-a timed out', 'AbortError'), 503],
    ['upstream 5xx', new RuntimeApiError(502, 'upstream leaked org-a', 'upstream_secret'), 503],
    ['fetch failure', new TypeError('fetch failed for credential-a'), 503],
    ['unexpected', new Error('unexpected credential-a org-a'), 500],
  ])('maps %s onboarding failures to a safe status', async (_label, error, expectedStatus) => {
    const logs: SafeRequestLog[] = [];
    const started = await startHandler({
      createRuntimeClient: () => fakeClient('credential-a', { onboard: () => Promise.reject(error) }),
      onRequestLog: (event) => {
        logs.push(event);
      },
    });
    const response = await rawRequest(started, {
      authorization: 'Bearer credential-a',
      body: JSON.stringify({ body: 'body-secret' }),
      headers: validPostHeaders(),
    });

    expect(response.status).toBe(expectedStatus);
    expect(response.body).not.toMatch(/credential-a|org-a|body-secret|upstream_secret/);
    expect(JSON.stringify(logs)).not.toMatch(/credential-a|org-a|body-secret|upstream_secret/);
  });

  it('enforces max-in-flight before body reads and recovers after the request completes', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let onboardCalls = 0;
    let signalStarted: (() => void) | undefined;
    const startedSignal = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const started = await startHandler({
      config: { maxInFlight: 1 },
      createRuntimeClient: (credential) =>
        fakeClient(credential, {
          onboard: async () => {
            onboardCalls += 1;
            if (onboardCalls === 1) {
              signalStarted?.();
              await firstStarted;
            }
            return { tenant: credential };
          },
        }),
    });
    const first = rawRequest(started, {
      authorization: 'Bearer credential-a',
      body: initializeBody,
      headers: validPostHeaders(),
    });
    await startedSignal;

    const busy = await rawRequest(started, {
      authorization: 'Bearer credential-b',
      body: initializeBody,
      headers: validPostHeaders(),
    });
    expect(busy.status).toBe(429);
    expect(busy.headers.get('retry-after')).toBe('1');

    releaseFirst?.();
    expect((await first).status).toBe(200);
    const recovered = await rawRequest(started, {
      authorization: 'Bearer credential-b',
      body: initializeBody,
      headers: validPostHeaders(),
    });
    expect(recovered.status).toBe(200);
  });

  it('keeps 100 parallel alternating credential clients isolated with a new runtime client per request', async () => {
    const constructions: Array<{ credential: string; instanceId: number }> = [];
    let nextInstanceId = 0;
    const started = await startHandler({
      config: { maxInFlight: 1_000 },
      createRuntimeClient: (credential) => {
        const instanceId = nextInstanceId;
        nextInstanceId += 1;
        constructions.push({ credential, instanceId });
        return fakeClient(credential, {
          onboard: async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, instanceId % 5));
            return { instanceId, tenant: credential === 'credential-a' ? 'org-a' : 'org-b' };
          },
        });
      },
    });

    const results = await Promise.all(
      Array.from({ length: 100 }, async (_, index) => {
        const credential = index % 2 === 0 ? 'credential-a' : 'credential-b';
        const client = await connectClient(started.url, credential);
        try {
          const result = await client.callTool({ name: 'agentops.onboard', arguments: {} });
          return { credential, result };
        } finally {
          await client.close();
        }
      }),
    );

    expect(results).toHaveLength(100);
    expect(
      results.every(({ credential, result }) => {
        const structuredContent = result.structuredContent as Record<string, unknown> | undefined;
        return structuredContent?.tenant === (credential === 'credential-a' ? 'org-a' : 'org-b');
      }),
    ).toBe(true);
    expect(constructions.length).toBeGreaterThanOrEqual(200);
    expect(new Set(constructions.map(({ instanceId }) => instanceId)).size).toBe(constructions.length);
    expect(constructions.every(({ credential }) => credential === 'credential-a' || credential === 'credential-b')).toBe(true);
  }, 20_000);

  it('logs exactly the bounded safe fields once and redacts the authenticated credential', async () => {
    const logs: SafeRequestLog[] = [];
    const started = await startHandler({
      onRequestLog: (event) => {
        logs.push(event);
        throw new Error('logger failed');
      },
    });
    const response = await rawRequest(started, {
      headers: {
        authorization: 'Bearer log-secret',
        'user-agent': `safe-test-agent log-secret ${'a'.repeat(400)}`,
        'x-agent': 'agent-sensitive',
        'x-organization': 'org-sensitive',
      },
      method: 'GET',
    });

    expect(response.status).toBe(405);
    expect(logs).toHaveLength(1);
    expect(Object.keys(logs[0] ?? {}).sort()).toEqual([
      'durationMs',
      'method',
      'path',
      'requestId',
      'status',
      'userAgent',
    ]);
    expect(logs[0]).toMatchObject({
      method: 'GET',
      path: '/mcp',
      status: 405,
    });
    expect(logs[0]?.userAgent).not.toContain('log-secret');
    expect(logs[0]?.userAgent?.length).toBeLessThanOrEqual(256);
    expect(
      [...(logs[0]?.userAgent ?? '')].every((character) => {
        const code = character.charCodeAt(0);
        return code > 31 && (code < 127 || code > 159);
      }),
    ).toBe(true);
    expect(logs[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(logs[0]?.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(logs)).not.toMatch(/log-secret|agent-sensitive|org-sensitive/);
  });

  it('swallows a rejected async request logger without an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const started = await startHandler({
        onRequestLog: async () => {
          await Promise.resolve();
          throw new Error('async logger failed');
        },
      });
      const response = await rawRequest(started, { method: 'GET', path: '/not-mcp' });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(response.status).toBe(404);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
