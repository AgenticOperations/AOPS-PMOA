import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest, type Server } from 'node:http';
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

type ChildExit = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
};

type HostedChild = {
  readonly child: ChildProcess;
  readonly exited: Promise<ChildExit>;
  readonly stderr: () => string;
  readonly stdout: () => string;
};

const execFileAsync = promisify(execFile);
const services = new Set<HostedMcpService>();

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout<T>(promise: Promise<T>, message: string, milliseconds = 3_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(message));
      },
    );
  });
}

function childEnvironment(port: number, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: 'test',
    AGENTOPS_API_BASE_URL: 'https://private-api.example.test',
    AGENTOPS_MCP_TIMEOUT_MS: '100',
    MCP_HOST: '127.0.0.1',
    MCP_PORT: String(port),
    MCP_PUBLIC_URL: 'https://configured-public.example.test/mcp',
    MCP_ALLOWED_HOSTS: `127.0.0.1:${String(port)}`,
    MCP_ALLOWED_ORIGINS: 'https://console.example.test',
    MCP_MAX_BODY_BYTES: '16384',
    MCP_MAX_IN_FLIGHT: '20',
    MCP_SHUTDOWN_GRACE_MS: '100',
    ...overrides,
  };
}

function spawnHostedChild(port: number, overrides: NodeJS.ProcessEnv = {}): HostedChild {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/http.ts'], {
    cwd: new URL('..', import.meta.url),
    env: childEnvironment(port, overrides),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  });
  const exited = new Promise<ChildExit>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    exited,
    stderr: () => stderr,
    stdout: () => stdout,
  };
}

async function stopChild(running: HostedChild): Promise<void> {
  if (running.child.exitCode === null && running.child.signalCode === null) {
    running.child.kill('SIGKILL');
  }
  await withTimeout(running.exited, 'Hosted child did not stop.', 1_000).catch(() => undefined);
}

async function listenOnAvailablePort(): Promise<{ readonly port: number; readonly server: Server }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing reserved test port.');
  return { port: address.port, server };
}

async function closeNodeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

async function availablePort(): Promise<number> {
  const reserved = await listenOnAvailablePort();
  await closeNodeServer(reserved.server);
  return reserved.port;
}

async function waitForHealth(origin: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(250) });
      if (response.status === 200 && (await response.text()) === '{"status":"ok"}') return;
    } catch {
      // The child may still be binding the listener.
    }
    await delay(15);
  }
  throw new Error('Hosted child health endpoint did not become ready.');
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = netConnect({ host: '127.0.0.1', port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 250);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

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

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'runs the executable service and exits cleanly on %s',
    async (signal) => {
      const port = await availablePort();
      const origin = `http://127.0.0.1:${String(port)}`;
      const running = spawnHostedChild(port);
      try {
        await waitForHealth(origin);
        expect(running.stdout()).toBe('');
        expect(running.stderr()).toBe(`agentOps hosted MCP listening on ${origin}\n`);

        expect(running.child.kill(signal)).toBe(true);
        const exit = await withTimeout(running.exited, `Hosted child did not exit after ${signal}.`);
        expect(exit).toEqual({ code: 0, signal: null });
        expect(await isPortOpen(port)).toBe(false);
      } finally {
        await stopChild(running);
      }
    },
  );

  it('exits nonzero with one generic line for invalid configuration', async () => {
    const port = await availablePort();
    const secret = 'forbidden-customer-secret';
    const running = spawnHostedChild(port, { AGENTOPS_MCP_CREDENTIAL: secret });
    try {
      const exit = await withTimeout(running.exited, 'Invalid-config child did not exit.');
      expect(exit.code).not.toBe(0);
      expect(exit.signal).toBeNull();
      expect(running.stdout()).toBe('');
      expect(running.stderr()).toBe('agentOps hosted MCP failed to start.\n');
      expect(running.stderr()).not.toContain(secret);
      expect(running.stderr()).not.toContain('private-api.example.test');
    } finally {
      await stopChild(running);
    }
  });

  it('exits nonzero safely when the listener address is already in use', async () => {
    const reserved = await listenOnAvailablePort();
    const secretApiUrl = 'https://bind-failure-secret.example.test';
    const running = spawnHostedChild(reserved.port, { AGENTOPS_API_BASE_URL: secretApiUrl });
    try {
      const exit = await withTimeout(running.exited, 'Bind-failure child did not exit.');
      expect(exit.code).not.toBe(0);
      expect(exit.signal).toBeNull();
      expect(running.stdout()).toBe('');
      expect(running.stderr()).toBe('agentOps hosted MCP failed to start.\n');
      expect(running.stderr()).not.toContain(secretApiUrl);
      expect(running.stderr()).not.toContain('EADDRINUSE');
      expect(running.stderr()).not.toContain('Error:');
    } finally {
      await stopChild(running);
      await closeNodeServer(reserved.server);
    }
  });
});
