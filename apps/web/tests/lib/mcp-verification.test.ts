import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  McpVerificationError,
  safeMcpVerificationMessage,
  verifyHostedMcp,
} from '../../src/lib/mcp-verification.js';

const endpoint = 'https://mcp.example/mcp';
const credential = 'conn_secret';
const requiredTools = [
  'agentops.onboard',
  'agentops.policy_check',
  'agentops.payment_x402',
  'agentops.approval_status',
  'agentops.approval_consume',
  'agentops.activity_record',
  'agentops.operation_check',
  'agentops.operation_record',
] as const;

type CapturedRequest = {
  readonly init: RequestInit;
  readonly url: string;
};

const onboardIdentity = {
  agent: { id: 'agt_1', name: 'Research agent' },
  connection: { id: 'conn_1' },
  contractVersion: '2026-07-07.1',
};

function jsonResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': contentType },
    status,
  });
}

function rpcResult(id: number, result: unknown): Response {
  return jsonResponse({ id, jsonrpc: '2.0', result });
}

function successFetch(options: {
  readonly extraTools?: readonly string[];
  readonly notificationResponse?: Response;
  readonly onboardResult?: unknown;
} = {}): { readonly fetchImpl: typeof fetch; readonly requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const responses = [
    rpcResult(1, { capabilities: {}, protocolVersion: '2025-06-18', serverInfo: { name: 'agentops', version: '0.0.0' } }),
    options.notificationResponse ?? new Response(null, { status: 202 }),
    rpcResult(2, { tools: [...requiredTools, ...(options.extraTools ?? [])].map((name) => ({ name })) }),
    rpcResult(3, options.onboardResult ?? { content: [], isError: false, structuredContent: onboardIdentity }),
  ];

  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    requests.push({ init: init ?? {}, url: String(input) });
    const response = responses.shift();
    if (response === undefined) throw new Error('Unexpected request.');
    return response;
  });

  return { fetchImpl, requests };
}

async function captureError(input: Parameters<typeof verifyHostedMcp>[0]): Promise<McpVerificationError> {
  try {
    await verifyHostedMcp(input);
  } catch (error) {
    expect(error).toBeInstanceOf(McpVerificationError);
    return error as McpVerificationError;
  }
  throw new Error('Expected verification to fail.');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('verifyHostedMcp', () => {
  it('performs the exact hosted MCP exchange and returns the verified identity', async () => {
    const { fetchImpl, requests } = successFetch();

    const result = await verifyHostedMcp({ credential, endpoint, fetchImpl });

    expect(requests).toHaveLength(4);
    expect(requests.map(({ url }) => url)).toEqual([endpoint, endpoint, endpoint, endpoint]);
    expect(requests.map(({ init }) => JSON.parse(String(init.body)))).toEqual([
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          capabilities: {},
          clientInfo: { name: 'aops-console-verifier', version: '1.0.0' },
          protocolVersion: '2025-06-18',
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { id: 2, jsonrpc: '2.0', method: 'tools/list', params: {} },
      {
        id: 3,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: {}, name: 'agentops.onboard' },
      },
    ]);
    for (const { init } of requests) {
      const headers = new Headers(init.headers);
      expect(init.method).toBe('POST');
      expect(headers.get('accept')).toBe('application/json, text/event-stream');
      expect(headers.get('authorization')).toBe(`Bearer ${credential}`);
      expect(headers.get('content-type')).toBe('application/json');
      expect(init.redirect).toBe('error');
    }
    expect(result).toEqual({
      agentName: 'Research agent',
      connectionId: 'conn_1',
      contractVersion: '2026-07-07.1',
      status: 'verified',
      toolCount: 8,
    });
  });

  it('accepts a 202 empty initialized notification and counts extra tools', async () => {
    const { fetchImpl } = successFetch({ extraTools: ['vendor.extra'] });

    await expect(verifyHostedMcp({ credential, endpoint, fetchImpl })).resolves.toMatchObject({
      status: 'verified',
      toolCount: 9,
    });
  });

  it('accepts a 202 initialized notification with a whitespace-only body', async () => {
    const { fetchImpl } = successFetch({
      notificationResponse: new Response('  \n', { status: 202 }),
    });

    await expect(verifyHostedMcp({ credential, endpoint, fetchImpl })).resolves.toMatchObject({ status: 'verified' });
  });

  it.each([
    ['HTTP 200 with no body', new Response(null, { status: 200 })],
    ['HTTP 202 with a body', new Response('accepted', { status: 202 })],
    ['HTTP 200 JSON success', jsonResponse({ jsonrpc: '2.0', result: {} })],
    ['HTTP 202 JSON-RPC success', jsonResponse({ jsonrpc: '2.0', result: {} }, 202)],
    ['HTTP 204 with no body', new Response(null, { status: 204 })],
  ])('rejects initialized notification response other than empty HTTP 202: %s', async (_label, notificationResponse) => {
    const { fetchImpl } = successFetch({ notificationResponse });

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: notificationResponse.status });
  });

  it('falls back to the first text content JSON when structuredContent is absent', async () => {
    const { fetchImpl } = successFetch({
      onboardResult: {
        content: [{ type: 'text', text: JSON.stringify(onboardIdentity) }],
        isError: false,
      },
    });

    await expect(verifyHostedMcp({ credential, endpoint, fetchImpl })).resolves.toEqual({
      agentName: 'Research agent',
      connectionId: 'conn_1',
      contractVersion: '2026-07-07.1',
      status: 'verified',
      toolCount: 8,
    });
  });

  it('accepts valid non-text MCP content when structuredContent provides the identity', async () => {
    const { fetchImpl } = successFetch({
      onboardResult: {
        content: [{ data: 'aGVsbG8=', mimeType: 'image/png', type: 'image' }],
        structuredContent: onboardIdentity,
      },
    });

    await expect(verifyHostedMcp({ credential, endpoint, fetchImpl })).resolves.toMatchObject({ status: 'verified' });
  });

  it.each([
    ['missing content', { structuredContent: onboardIdentity }],
    ['non-array content', { content: {}, structuredContent: onboardIdentity }],
    ['non-boolean isError', { content: [], isError: 'false', structuredContent: onboardIdentity }],
    ['non-object item', { content: [null], structuredContent: onboardIdentity }],
    ['unsupported item type', { content: [{ type: 'video' }], structuredContent: onboardIdentity }],
    ['text without text', { content: [{ type: 'text' }], structuredContent: onboardIdentity }],
    ['image without data', { content: [{ mimeType: 'image/png', type: 'image' }], structuredContent: onboardIdentity }],
    ['audio without mime type', { content: [{ data: 'aGVsbG8=', type: 'audio' }], structuredContent: onboardIdentity }],
    ['resource without contents', { content: [{ resource: { uri: 'file:///a' }, type: 'resource' }], structuredContent: onboardIdentity }],
    ['resource link without name', { content: [{ type: 'resource_link', uri: 'file:///a' }], structuredContent: onboardIdentity }],
  ])('rejects malformed CallToolResult content even with structuredContent: %s', async (_label, onboardResult) => {
    const { fetchImpl } = successFetch({ onboardResult });

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: null });
  });

  it('rejects a tool list missing any required tool', async () => {
    const missingOnboard = requiredTools.filter((name) => name !== 'agentops.onboard');
    const responses = [
      rpcResult(1, {}),
      new Response(null, { status: 202 }),
      rpcResult(2, { tools: missingOnboard.map((name) => ({ name })) }),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift() ?? rpcResult(3, {}));

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: null });
    expect(error.message).toBe('The MCP service did not provide the required tools.');
  });

  it('rejects an onboard tool error without exposing its content', async () => {
    const { fetchImpl } = successFetch({
      onboardResult: {
        content: [{ type: 'text', text: `upstream rejected ${credential}` }],
        isError: true,
      },
    });

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: null });
    expect(error.message).toBe('The MCP onboarding check failed.');
    expect(JSON.stringify(error)).not.toContain(credential);
  });

  it.each([
    [401, 'invalid_credential', 'The MCP credential is invalid or has been revoked.'],
    [403, 'origin_not_allowed', 'This browser origin is not allowed to connect to the MCP service.'],
    [429, 'rate_limited', 'The MCP service is busy. Try again shortly.'],
    [503, 'service_unavailable', 'The MCP service is temporarily unavailable.'],
  ] as const)('maps HTTP %i to a safe %s error', async (status, code, message) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(`raw ${credential}`, { status }));

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code, message, status });
    expect(safeMcpVerificationMessage(error)).toBe(message);
    expect(JSON.stringify(error)).not.toContain(credential);
  });

  it('maps unrecognized non-2xx statuses to a safe protocol error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(`raw ${credential}`, { status: 500 }));

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({
      code: 'protocol_error',
      message: 'The MCP service returned an unexpected response.',
      status: 500,
    });
  });

  it('rejects the wrong content type', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ id: 1, jsonrpc: '2.0', result: {} }, 200, 'text/plain'));

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: 200 });
  });

  it('rejects malformed JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{', {
      headers: { 'content-type': 'application/json' },
      status: 200,
    }));

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: 200 });
    expect(error.message).not.toContain('{');
  });

  it.each([
    ['wrong JSON-RPC version', { id: 1, jsonrpc: '1.0', result: {} }],
    ['wrong id', { id: 99, jsonrpc: '2.0', result: {} }],
    ['error response', { error: { code: -32_000, message: `secret ${credential}` }, id: 1, jsonrpc: '2.0' }],
    ['missing result', { id: 1, jsonrpc: '2.0' }],
    ['non-object result', { id: 1, jsonrpc: '2.0', result: null }],
  ])('rejects a malformed id response: %s', async (_label, body) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(body));

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: 200 });
    expect(JSON.stringify(error)).not.toContain(credential);
  });

  it('rejects malformed JSON notification success', async () => {
    const responses = [
      rpcResult(1, {}),
      jsonResponse({ error: { code: -32_000, message: `secret ${credential}` }, jsonrpc: '2.0' }),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift() ?? rpcResult(2, {}));

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: 200 });
    expect(JSON.stringify(error)).not.toContain(credential);
  });

  it.each([
    ['missing agent', { connection: { id: 'conn_1' }, contractVersion: 'v1' }],
    ['blank agent name', { agent: { name: ' ' }, connection: { id: 'conn_1' }, contractVersion: 'v1' }],
    ['missing connection id', { agent: { name: 'Agent' }, connection: {}, contractVersion: 'v1' }],
    ['missing contract version', { agent: { name: 'Agent' }, connection: { id: 'conn_1' } }],
  ])('rejects malformed onboard identity: %s', async (_label, identity) => {
    const { fetchImpl } = successFetch({ onboardResult: { content: [], structuredContent: identity } });

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: null });
  });

  it('rejects malformed text fallback JSON without exposing it', async () => {
    const { fetchImpl } = successFetch({
      onboardResult: { content: [{ type: 'text', text: `{${credential}` }] },
    });

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: null });
    expect(JSON.stringify(error)).not.toContain(credential);
  });

  it('maps raw network errors to a fixed safe message', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error(`Failed to fetch ${endpoint}?credential=${credential}`);
    });

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({
      code: 'network_error',
      message: 'Could not reach the MCP service.',
      status: null,
    });
    expect(JSON.stringify(error)).not.toContain(credential);
  });

  it('rejects redirects without fetching either the endpoint again or the redirect target', async () => {
    const urls: string[] = [];
    const redirectTarget = `https://evil.example/mcp?credential=${credential}`;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      urls.push(String(input));
      if (init?.redirect === 'error') throw new TypeError(`redirect to ${redirectTarget} rejected`);
      urls.push(redirectTarget);
      return rpcResult(1, {});
    });

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(urls).toEqual([endpoint]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({
      code: 'network_error',
      message: 'Could not reach the MCP service.',
      status: null,
    });
    expect(JSON.stringify(error)).not.toContain(credential);
  });

  it.each([
    'http://localhost/mcp',
    'http://localhost:8070/mcp',
    'http://127.0.0.1:8070/mcp',
    'http://[::1]:8070/mcp',
  ])('allows explicit HTTP loopback endpoint %s', async (loopbackEndpoint) => {
    const { fetchImpl, requests } = successFetch();

    await expect(verifyHostedMcp({ credential, endpoint: loopbackEndpoint, fetchImpl })).resolves.toMatchObject({ status: 'verified' });
    expect(requests.map(({ url }) => url)).toEqual([
      loopbackEndpoint,
      loopbackEndpoint,
      loopbackEndpoint,
      loopbackEndpoint,
    ]);
  });

  it('uses one timeout across the exchange and aborts a pending request safely', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('raw timeout', 'AbortError')), { once: true });
      });
    });

    const verification = captureError({ credential, endpoint, fetchImpl, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    const error = await verification;

    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(error).toMatchObject({
      code: 'timeout',
      message: 'The MCP verification timed out. Try again.',
      status: null,
    });
  });

  it('clears the timeout after a successful exchange', async () => {
    vi.useFakeTimers();
    const { fetchImpl, requests } = successFetch();

    await verifyHostedMcp({ credential, endpoint, fetchImpl, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);

    const signals = requests.map(({ init }) => init.signal as AbortSignal);
    expect(new Set(signals).size).toBe(1);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });

  it.each([
    [{ endpoint: '/mcp', credential }, 'relative endpoint'],
    [{ endpoint: 'ftp://mcp.example/mcp', credential }, 'non-HTTP protocol'],
    [{ endpoint: 'http://mcp.example/mcp', credential }, 'non-loopback HTTP endpoint'],
    [{ endpoint: 'https://user:pass@mcp.example/mcp', credential }, 'endpoint credentials'],
    [{ endpoint: 'https://mcp.example/other', credential }, 'wrong path'],
    [{ endpoint: 'https://mcp.example/mcp?x=1', credential }, 'query'],
    [{ endpoint: 'https://mcp.example/mcp#x', credential }, 'hash'],
    [{ endpoint, credential: '   ' }, 'blank credential'],
    [{ endpoint, credential: 'x'.repeat(4097) }, 'oversized credential'],
    [{ endpoint, credential, timeoutMs: 0 }, 'zero timeout'],
    [{ endpoint, credential, timeoutMs: -1 }, 'negative timeout'],
    [{ endpoint, credential, timeoutMs: 60_001 }, 'unbounded timeout'],
    [{ endpoint, credential, timeoutMs: Number.NaN }, 'non-finite timeout'],
  ])('rejects invalid input: $1', async (input, _label) => {
    const fetchImpl = vi.fn<typeof fetch>();

    const error = await captureError({ ...input, fetchImpl });

    expect(error).toMatchObject({
      code: 'invalid_input',
      message: 'Enter a valid hosted MCP endpoint and credential.',
      status: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain(input.credential);
  });

  it('returns a fixed safe UI message for unknown errors', () => {
    expect(safeMcpVerificationMessage(new Error(`raw ${credential}`))).toBe('MCP verification failed. Try again.');
    expect(safeMcpVerificationMessage(credential)).toBe('MCP verification failed. Try again.');
  });
});
