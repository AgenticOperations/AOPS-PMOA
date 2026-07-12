import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import { isIP, type AddressInfo, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createHostedMcpHandler, type SafeRequestLog } from './http-handler.js';
import { readHostedMcpEnv, type HostedMcpConfig } from './http-config.js';
import { RuntimeApiClient } from './runtime-client.js';
import type { AgentOpsRuntimeClient } from './tools.js';

export type HostedMcpServiceOptions = {
  readonly config?: HostedMcpConfig;
  readonly fetch?: typeof fetch;
  readonly createRuntimeClient?: (credential: string) => AgentOpsRuntimeClient;
  readonly logger?: (event: SafeRequestLog) => void | Promise<void>;
};

export type HostedMcpService = {
  readonly address: AddressInfo | null;
  readonly origin: string | null;
  readonly server: Server;
  start(): Promise<void>;
  close(): Promise<void>;
};

const HEADERS_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
const MAX_HEADERS_COUNT = 100;

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

function writeJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  payload: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (response.writableEnded) return;
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const body = JSON.stringify(payload);
  response.setHeader('Content-Length', String(Buffer.byteLength(body)));
  response.end(request.method === 'HEAD' ? undefined : body);
}

function writeForbiddenAndClose(request: IncomingMessage, response: ServerResponse): void {
  const socket = request.socket;
  response.setHeader('Connection', 'close');
  response.once('finish', () => {
    if (!socket.destroyed) socket.destroySoon();
  });
  writeJson(request, response, 403, { status: 'forbidden' });
}

function upstreamHealthUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/healthz`;
}

function formatOrigin(address: AddressInfo): string {
  const hostname = isIP(address.address) === 6 ? `[${address.address}]` : address.address;
  return `http://${hostname}:${String(address.port)}`;
}

export function createHostedMcpService(options: HostedMcpServiceOptions = {}): HostedMcpService {
  const config = options.config ?? readHostedMcpEnv();
  const fetchImpl = options.fetch ?? fetch;
  const createRuntimeClient =
    options.createRuntimeClient ??
    ((credential: string) =>
      new RuntimeApiClient({
        apiBaseUrl: config.apiBaseUrl,
        credential,
        timeoutMs: config.timeoutMs,
      }));
  const mcpHandler = createHostedMcpHandler({
    config,
    createRuntimeClient,
    ...(options.logger === undefined ? {} : { onRequestLog: options.logger }),
  });
  const sockets = new Set<Socket>();
  const readinessControllers = new Set<AbortController>();
  let inFlight = 0;
  let startPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let serverClosed = false;
  let resolveWhenIdle: (() => void) | undefined;

  const probeReadiness = async (): Promise<boolean> => {
    const controller = new AbortController();
    readinessControllers.add(controller);
    let timeout: NodeJS.Timeout | undefined;
    try {
      const deadline = new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve(false);
        }, config.timeoutMs);
      });
      const upstream = Promise.resolve(
        fetchImpl(upstreamHealthUrl(config.apiBaseUrl), {
          headers: { accept: 'application/json' },
          method: 'GET',
          signal: controller.signal,
        }),
      ).then(
        (response) => response.ok,
        () => false,
      );
      return await Promise.race([upstream, deadline]);
    } catch {
      return false;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      readinessControllers.delete(controller);
    }
  };

  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!hasAllowedHost(request, config)) {
      writeForbiddenAndClose(request, response);
      return;
    }

    if (request.url === '/mcp') {
      mcpHandler(request, response);
      return;
    }

    if (request.url === '/healthz' || request.url === '/readyz') {
      const method = request.method ?? '';
      if (method !== 'GET' && method !== 'HEAD') {
        writeJson(request, response, 405, { status: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
        return;
      }
      if (request.url === '/healthz') {
        writeJson(request, response, 200, { status: 'ok' });
        return;
      }
      const ready = await probeReadiness();
      writeJson(
        request,
        response,
        ready ? 200 : 503,
        { status: ready ? 'ready' : 'not_ready' },
      );
      return;
    }

    writeJson(request, response, 404, { status: 'not_found' });
  };

  const listener: RequestListener = (request, response) => {
    inFlight += 1;
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      response.off('finish', finish);
      response.off('close', finish);
      inFlight -= 1;
      if (inFlight === 0) resolveWhenIdle?.();
    };
    response.once('finish', finish);
    response.once('close', finish);
    void route(request, response).catch(() => {
      writeJson(request, response, 500, { status: 'error' });
    });
  };

  const server = createServer({ requireHostHeader: false }, listener);
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.maxHeadersCount = MAX_HEADERS_COUNT;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  const service: HostedMcpService = {
    get address(): AddressInfo | null {
      const address = server.address();
      return address === null || typeof address === 'string' ? null : address;
    },
    get origin(): string | null {
      const address = service.address;
      return address === null ? null : formatOrigin(address);
    },
    server,
    start(): Promise<void> {
      if (closePromise !== undefined) return Promise.reject(new Error('Hosted MCP service is closed.'));
      if (server.listening) return Promise.resolve();
      if (startPromise !== undefined) return startPromise;
      startPromise = new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off('listening', onListening);
          startPromise = undefined;
          reject(error);
        };
        const onListening = (): void => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(config.port, config.host);
      });
      return startPromise;
    },
    close(): Promise<void> {
      if (closePromise !== undefined) return closePromise;
      if (!server.listening) {
        closePromise = Promise.resolve();
        return closePromise;
      }

      closePromise = new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(graceTimer);
          resolveWhenIdle = undefined;
          if (error === undefined) resolve();
          else reject(error);
        };
        const maybeFinish = (): void => {
          if (serverClosed && inFlight === 0) finish();
        };
        resolveWhenIdle = maybeFinish;
        const graceTimer = setTimeout(() => {
          for (const controller of readinessControllers) controller.abort();
          server.closeAllConnections();
          for (const socket of sockets) socket.destroy();
          finish();
        }, config.shutdownGraceMs);
        server.close((error) => {
          if (error !== undefined && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            finish(error);
            return;
          }
          serverClosed = true;
          maybeFinish();
        });
      });
      return closePromise;
    },
  };

  return service;
}

export async function main(): Promise<void> {
  const config = readHostedMcpEnv();
  const service = createHostedMcpService({ config });
  await service.start();
  const address = service.address;
  if (address === null) throw new Error('Hosted MCP listener did not expose an address.');
  console.error(`agentOps hosted MCP listening on ${formatOrigin(address)}`);

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    void service.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && fileURLToPath(import.meta.url) === entrypoint) {
  void main().catch(() => {
    console.error('agentOps hosted MCP failed to start.');
    process.exitCode = 1;
  });
}
