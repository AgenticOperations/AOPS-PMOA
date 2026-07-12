import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHostedMcpService,
  type HostedMcpService,
  type HostedMcpServiceOptions,
} from '../src/http.js';
import type { HostedMcpConfig } from '../src/http-config.js';
import type { AgentOpsRuntimeClient } from '../src/tools.js';

type HttpResponse = {
  readonly body: string;
  readonly headers: Headers;
  readonly status: number;
};

const execFileAsync = promisify(execFile);
const services = new Set<HostedMcpService>();

function fakeRuntimeClient(): AgentOpsRuntimeClient {
  return {
    activityRecord: () => Promise.resolve({}),
    approvalConsume: () => Promise.resolve({}),
    approvalStatus: () => Promise.resolve({}),
    check: () => Promise.resolve({}),
    onboard: () => Promise.resolve({ tenant: 'test' }),
    operationCheck: () => Promise.resolve({}),
    operationRecord: () => Promise.resolve({}),
    paymentX402: () => Promise.resolve({}),
  };
}

function testConfig(overrides: Partial<HostedMcpConfig> = {}): HostedMcpConfig {
  return {
    apiBaseUrl: 'https://api.internal.example.test',
    host: '127.0.0.1',
    port: 0,
    publicUrl: 'https://mcp.example.test/mcp',
    allowedHosts: ['mcp.example.test'],
    allowedOrigins: ['https://console.example.test'],
    timeoutMs: 50,
    maxBodyBytes: 16_384,
    maxInFlight: 20,
    shutdownGraceMs: 100,
    ...overrides,
  };
}

async function startService(options: Partial<HostedMcpServiceOptions> = {}): Promise<HostedMcpService> {
  const service = createHostedMcpService({
    config: testConfig(),
    fetch: () => Promise.resolve(new Response(null, { status: 204 })),
    createRuntimeClient: () => fakeRuntimeClient(),
    ...options,
  });
  services.add(service);
  await service.start();
  return service;
}

async function request(
  service: HostedMcpService,
  options: {
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly host?: string | null;
    readonly method?: string;
    readonly path: string;
  },
): Promise<HttpResponse> {
  const address = service.address;
  if (address === null) throw new Error('Test service is not listening.');
  const headers: Record<string, string> = { ...options.headers };
  if (options.host !== null) headers.host = options.host ?? 'mcp.example.test';
  if (options.body !== undefined) headers['content-length'] = String(Buffer.byteLength(options.body));

  return new Promise<HttpResponse>((resolve, reject) => {
    const outgoing = httpRequest(
      {
        headers,
        hostname: '127.0.0.1',
        method: options.method ?? 'GET',
        path: options.path,
        port: address.port,
        setHost: false,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.once('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: new Headers(
              Object.entries(incoming.headers).flatMap(([name, value]) =>
                value === undefined
                  ? []
                  : [[name, Array.isArray(value) ? value.join(', ') : value] as [string, string]],
              ),
            ),
            status: incoming.statusCode ?? 0,
          });
        });
      },
    );
    outgoing.once('error', reject);
    if (options.body !== undefined) outgoing.write(options.body);
    outgoing.end();
  });
}

async function rawRequest(service: HostedMcpService, lines: readonly string[]): Promise<string> {
  const address = service.address;
  if (address === null) throw new Error('Test service is not listening.');
  return new Promise<string>((resolve, reject) => {
    const socket = netConnect({ host: '127.0.0.1', port: address.port });
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Raw request remained open.'));
    }, 1_000);
    socket.once('connect', () => socket.end([...lines, '', ''].join('\r\n')));
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

afterEach(async () => {
  await Promise.all([...services].map(async (service) => service.close()));
  services.clear();
});

describe('createHostedMcpService', () => {
  it('serves exact health JSON, mirrors HEAD without a body, and rejects other methods safely', async () => {
    const service = await startService();

    const get = await request(service, { path: '/healthz' });
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(JSON.parse(get.body)).toEqual({ status: 'ok' });
    expect(get.body).toBe('{"status":"ok"}');
    expect(get.body).not.toContain('api.internal');

    const head = await request(service, { method: 'HEAD', path: '/healthz' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');

    const post = await request(service, { method: 'POST', path: '/healthz' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    expect(post.body).not.toContain('api.internal');
  });

  it('reports ready only for an upstream 2xx and probes the exact bounded health URL', async () => {
    const calls: Array<{ input: string; signal: AbortSignal | null }> = [];
    const service = await startService({
      fetch: (input, init) => {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        calls.push({ input: url, signal: init?.signal ?? null });
        return Promise.resolve(new Response('private upstream body', { status: 200 }));
      },
    });

    const get = await request(service, { path: '/readyz' });
    expect(get.status).toBe(200);
    expect(get.body).toBe('{"status":"ready"}');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe('https://api.internal.example.test/healthz');
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);

    const head = await request(service, { method: 'HEAD', path: '/readyz' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  it('returns generic not-ready JSON for upstream non-2xx and does not read or expose its body', async () => {
    let bodyRead = false;
    const upstreamBody = 'upstream-secret-body';
    class TrackingResponse extends Response {
      override readonly text = (): Promise<string> => {
        bodyRead = true;
        return Promise.resolve(upstreamBody);
      };
    }
    const upstreamResponse = new TrackingResponse(null, { status: 503 });
    const service = await startService({
      fetch: () => Promise.resolve(upstreamResponse),
    });

    const response = await request(service, { path: '/readyz' });
    expect(response.status).toBe(503);
    expect(response.body).toBe('{"status":"not_ready"}');
    expect(response.body).not.toContain(upstreamBody);
    expect(bodyRead).toBe(false);
  });

  it('returns generic not-ready JSON for network failures without leaking the error', async () => {
    const secret = 'network-secret api.internal.example.test /private/runtime/file.ts';
    const service = await startService({
      fetch: () => Promise.reject(new TypeError(secret)),
    });

    const response = await request(service, { path: '/readyz' });
    expect(response.status).toBe(503);
    expect(response.body).toBe('{"status":"not_ready"}');
    expect(response.body).not.toContain(secret);
    expect(response.body).not.toContain('/private/');
  });

  it('bounds a stalled readiness probe and returns generic not-ready JSON', async () => {
    const secret = 'timeout-secret-upstream-body';
    const service = await startService({
      config: testConfig({ timeoutMs: 20 }),
      fetch: () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response(secret, { status: 200 })), 200);
        }),
    });

    const startedAt = performance.now();
    const response = await request(service, { path: '/readyz' });
    expect(performance.now() - startedAt).toBeLessThan(150);
    expect(response.status).toBe(503);
    expect(response.body).toBe('{"status":"not_ready"}');
    expect(response.body).not.toContain(secret);
  });

  it('delegates /mcp to the real hosted handler with a request-scoped runtime client', async () => {
    const credentials: string[] = [];
    const service = await startService({
      createRuntimeClient: (credential) => {
        credentials.push(credential);
        return fakeRuntimeClient();
      },
    });
    const body = JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'entrypoint-test', version: '1.0.0' },
        protocolVersion: '2025-06-18',
      },
    });

    const response = await request(service, {
      body,
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer request-credential',
        'content-type': 'application/json',
      },
      method: 'POST',
      path: '/mcp',
    });

    expect(response.status).toBe(200);
    expect(credentials).toEqual(['request-credential']);
    expect(JSON.parse(response.body)).toMatchObject({ id: 1, jsonrpc: '2.0' });
  });

  it('returns safe 404 elsewhere and fails closed for missing, malformed, disallowed, or duplicate Host', async () => {
    const service = await startService();

    const unknown = await request(service, { path: '/unknown' });
    expect(unknown.status).toBe(404);
    expect(unknown.body).not.toContain('api.internal');

    for (const host of [null, 'evil.example.test', 'mcp.example.test:0443', 'user@mcp.example.test']) {
      const response = await request(service, { host, path: '/healthz' });
      expect(response.status).toBe(403);
      expect(response.body).not.toContain(host ?? 'mcp.example.test');
    }

    const duplicate = await rawRequest(service, [
      'GET /readyz HTTP/1.1',
      'Host: mcp.example.test',
      'Host: evil.example.test',
      'Connection: close',
    ]);
    expect(duplicate).toContain(' 403 ');
    expect(duplicate).not.toContain('evil.example.test');
  });

  it('binds port zero and exposes the actual address and origin after start', async () => {
    const service = createHostedMcpService({
      config: testConfig(),
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
      createRuntimeClient: () => fakeRuntimeClient(),
    });
    services.add(service);
    expect(service.address).toBeNull();
    expect(service.origin).toBeNull();

    await service.start();

    expect(service.address?.port).toBeGreaterThan(0);
    expect(service.origin).toBe(`http://127.0.0.1:${String(service.address?.port)}`);
  });

  it('closes idempotently and force-closes an incomplete in-flight request within the grace bound', async () => {
    const service = await startService({ config: testConfig({ shutdownGraceMs: 40 }) });
    const address = service.address;
    if (address === null) throw new Error('Test service is not listening.');
    const socket = netConnect({ host: '127.0.0.1', port: address.port });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.write(
      [
        'POST /mcp HTTP/1.1',
        'Host: mcp.example.test',
        'Authorization: Bearer held-request-credential',
        'Content-Type: application/json',
        'Accept: application/json, text/event-stream',
        'Content-Length: 100',
        '',
        '{',
      ].join('\r\n'),
    );
    const clientClosed = new Promise<void>((resolve) => socket.once('close', resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    const startedAt = performance.now();
    const firstClose = service.close();
    const secondClose = service.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;
    await Promise.race([
      clientClosed,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('Held client socket remained open.')), 250),
      ),
    ]);

    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(socket.destroyed).toBe(true);
    await expect(service.close()).resolves.toBeUndefined();
  });

  it('configures safe bounded native HTTP server timeouts', () => {
    const service = createHostedMcpService({
      config: testConfig(),
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
      createRuntimeClient: () => fakeRuntimeClient(),
    });
    services.add(service);

    expect(service.server.headersTimeout).toBe(15_000);
    expect(service.server.requestTimeout).toBe(30_000);
    expect(service.server.keepAliveTimeout).toBe(5_000);
    expect(service.server.maxHeadersCount).toBe(100);
  });
});

describe('hosted HTTP module', () => {
  it('does not start a listener merely by being imported', async () => {
    const env = { ...process.env };
    Reflect.deleteProperty(env, 'AGENTOPS_MCP_CREDENTIAL');
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        "await import('./src/http.ts'); process.stdout.write('imported');",
      ],
      { cwd: new URL('..', import.meta.url), env, timeout: 1_000 },
    );
    expect(stdout).toBe('imported');
  });
});
