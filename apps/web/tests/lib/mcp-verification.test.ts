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

const initializeResult = {
  capabilities: {},
  protocolVersion: '2025-06-18',
  serverInfo: { name: 'agentops', version: '0.0.0' },
};

const onboardContent = [{ type: 'text', text: 'AOPS onboarding completed.' }] as const;

function toolDescriptor(name: string): Record<string, unknown> {
  return {
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      additionalProperties: false,
      properties: {
        context: { type: 'object' },
        intent: { type: 'string' },
      },
      required: ['intent'],
      type: 'object',
    },
    name,
  };
}

function toolsWithFirstSchema(inputSchema: unknown): Record<string, unknown> {
  return {
    tools: requiredTools.map((name, index) => index === 0 ? { inputSchema, name } : toolDescriptor(name)),
  };
}

function neverCancellingBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    cancel: () => new Promise<void>(() => {}),
  }, { highWaterMark: 0 });
}

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
  readonly initializeResult?: unknown;
  readonly notificationResponse?: Response;
  readonly onboardResult?: unknown;
  readonly toolsResult?: unknown;
} = {}): { readonly fetchImpl: typeof fetch; readonly requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const responses = [
    rpcResult(1, options.initializeResult ?? initializeResult),
    options.notificationResponse ?? new Response(null, { status: 202 }),
    rpcResult(2, options.toolsResult ?? { tools: [...requiredTools, ...(options.extraTools ?? [])].map(toolDescriptor) }),
    rpcResult(3, options.onboardResult ?? { content: onboardContent, isError: false, structuredContent: onboardIdentity }),
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
      expect(init.cache).toBe('no-store');
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('error');
      expect(init.referrerPolicy).toBe('no-referrer');
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

  it('rejects a 202 initialized notification with a whitespace-only body', async () => {
    const { fetchImpl } = successFetch({
      notificationResponse: new Response('  \n', { status: 202 }),
    });

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: 202 });
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

  it('rejects non-text MCP content even when structuredContent provides the identity', async () => {
    const { fetchImpl } = successFetch({
      onboardResult: {
        content: [{ data: 'aGVsbG8=', mimeType: 'image/png', type: 'image' }],
        structuredContent: onboardIdentity,
      },
    });

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: null });
  });

  it.each([
    ['missing content', { structuredContent: onboardIdentity }],
    ['non-array content', { content: {}, structuredContent: onboardIdentity }],
    ['empty content', { content: [], structuredContent: onboardIdentity }],
    ['non-boolean isError', { content: onboardContent, isError: 'false', structuredContent: onboardIdentity }],
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

  it.each([
    ['missing protocolVersion', { capabilities: {}, serverInfo: { name: 'agentops', version: '1' } }],
    ['blank protocolVersion', { capabilities: {}, protocolVersion: ' ', serverInfo: { name: 'agentops', version: '1' } }],
    ['mismatched protocolVersion', { capabilities: {}, protocolVersion: '2024-11-05', serverInfo: { name: 'agentops', version: '1' } }],
    ['array capabilities', { capabilities: [], protocolVersion: '2025-06-18', serverInfo: { name: 'agentops', version: '1' } }],
    ['missing serverInfo', { capabilities: {}, protocolVersion: '2025-06-18' }],
    ['array serverInfo', { capabilities: {}, protocolVersion: '2025-06-18', serverInfo: [] }],
    ['blank server name', { capabilities: {}, protocolVersion: '2025-06-18', serverInfo: { name: '', version: '1' } }],
    ['blank server version', { capabilities: {}, protocolVersion: '2025-06-18', serverInfo: { name: 'agentops', version: ' ' } }],
  ])('rejects malformed initialize result: %s', async (_label, malformedInitialize) => {
    const { fetchImpl } = successFetch({ initializeResult: malformedInitialize });

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: null });
  });

  it.each([
    ['duplicate name', { tools: [...requiredTools.map(toolDescriptor), toolDescriptor('agentops.onboard')] }],
    ['missing inputSchema', { tools: requiredTools.map((name) => ({ name })) }],
    ['non-object inputSchema', { tools: requiredTools.map((name) => ({ inputSchema: [], name })) }],
    ['wrong schema type', { tools: requiredTools.map((name) => ({ inputSchema: { type: 'array' }, name })) }],
    ['blank name', { tools: [...requiredTools.map(toolDescriptor), toolDescriptor(' ')] }],
  ])('rejects malformed tools/list result: %s', async (_label, toolsResult) => {
    const { fetchImpl } = successFetch({ toolsResult });

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: null });
  });

  it.each([
    ['array properties', toolsWithFirstSchema({ properties: [], type: 'object' })],
    ['non-object property schema', toolsWithFirstSchema({ properties: { intent: [] }, type: 'object' })],
    ['non-array required', toolsWithFirstSchema({ properties: { intent: {} }, required: 'intent', type: 'object' })],
    ['non-string required item', toolsWithFirstSchema({ properties: { intent: {} }, required: [1], type: 'object' })],
    ['duplicate required item', toolsWithFirstSchema({ properties: { intent: {} }, required: ['intent', 'intent'], type: 'object' })],
    ['required item absent from properties', toolsWithFirstSchema({ properties: { intent: {} }, required: ['missing'], type: 'object' })],
    ['array additionalProperties', toolsWithFirstSchema({ additionalProperties: [], type: 'object' })],
    ['numeric additionalProperties', toolsWithFirstSchema({ additionalProperties: 1, type: 'object' })],
    ['blank $schema', toolsWithFirstSchema({ $schema: ' ', type: 'object' })],
    ['non-string $schema', toolsWithFirstSchema({ $schema: 1, type: 'object' })],
  ])('rejects malformed tool inputSchema details: %s', async (_label, toolsResult) => {
    const { fetchImpl } = successFetch({ toolsResult });

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(error).toMatchObject({ code: 'protocol_error', status: null });
  });

  it('rejects a tool list missing any required tool', async () => {
    const missingOnboard = requiredTools.filter((name) => name !== 'agentops.onboard');
    const responses = [
      rpcResult(1, initializeResult),
      new Response(null, { status: 202 }),
      rpcResult(2, { tools: missingOnboard.map(toolDescriptor) }),
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

  it('rejects malformed UTF-8 before it can decode into an otherwise valid response', async () => {
    const encoder = new TextEncoder();
    const prefix = encoder.encode('{"id":1,"jsonrpc":"2.0","result":{"capabilities":{},"protocolVersion":"2025-06-18","serverInfo":{"name":"agent');
    const suffix = encoder.encode('","version":"1"}}}');
    const bytes = new Uint8Array(prefix.length + 2 + suffix.length);
    bytes.set(prefix);
    bytes.set([0xc3, 0x28], prefix.length);
    bytes.set(suffix, prefix.length + 2);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(bytes, {
      headers: { 'content-type': 'application/json' },
      status: 200,
    }));

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ code: 'protocol_error', status: 200 });
    expect(JSON.stringify(error)).not.toContain(credential);
  });

  it('rejects a response whose declared content length exceeds the safe limit', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      result: { ...initializeResult, raw: credential },
    }), {
      headers: {
        'content-length': String(1_048_577),
        'content-type': 'application/json',
      },
      status: 200,
    }));

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({
      code: 'response_too_large',
      message: 'The MCP service response was too large.',
      status: 200,
    });
    expect(JSON.stringify(error)).not.toContain(credential);
  });

  it('cancels a chunked response stream once it crosses the safe limit', async () => {
    let cancelled = false;
    let pullCount = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      pull(controller) {
        pullCount += 1;
        if (pullCount <= 2) {
          controller.enqueue(encoder.encode(`${pullCount === 1 ? credential : ''}${'x'.repeat(600_000)}`));
        } else {
          controller.close();
        }
      },
    }, { highWaterMark: 0 });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, {
      headers: { 'content-type': 'application/json' },
      status: 200,
    }));

    const error = await captureError({ credential, endpoint, fetchImpl });

    expect(cancelled).toBe(true);
    expect(error).toMatchObject({ code: 'response_too_large', status: 200 });
    expect(JSON.stringify(error)).not.toContain(credential);
  });

  it('settles an oversized response even when stream cancellation never settles', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(neverCancellingBody(), {
      headers: {
        'content-length': String(1_048_577),
        'content-type': 'application/json',
      },
      status: 200,
    }));
    let captured: unknown;
    let settled = false;
    void verifyHostedMcp({ credential, endpoint, fetchImpl, timeoutMs: 25 }).then(
      () => { settled = true; },
      (error: unknown) => { captured = error; settled = true; },
    );

    await vi.advanceTimersByTimeAsync(25);

    expect(settled).toBe(true);
    expect(captured).toBeInstanceOf(McpVerificationError);
    expect(captured).toMatchObject({ code: 'response_too_large', status: 200 });
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
      rpcResult(1, initializeResult),
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
    const { fetchImpl } = successFetch({ onboardResult: { content: onboardContent, structuredContent: identity } });

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

  it('maps an abort while streaming a JSON-RPC response body to timeout', async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`{"jsonrpc":"2.0","raw":"${credential}`));
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException(`raw ${credential}`, 'AbortError'));
          }, { once: true });
        },
      });
      return new Response(body, { headers: { 'content-type': 'application/json' }, status: 200 });
    });

    const verification = captureError({ credential, endpoint, fetchImpl, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    const error = await verification;

    expect(error).toMatchObject({ code: 'timeout', status: null });
    expect(JSON.stringify(error)).not.toContain(credential);
  });

  it('maps an abort while streaming the initialized notification body to timeout', async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      requestCount += 1;
      if (requestCount === 1) return rpcResult(1, initializeResult);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException(`raw ${credential}`, 'AbortError'));
          }, { once: true });
        },
      });
      return new Response(body, { status: 202 });
    });

    const verification = captureError({ credential, endpoint, fetchImpl, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    const error = await verification;

    expect(requestCount).toBe(2);
    expect(error).toMatchObject({ code: 'timeout', status: null });
    expect(JSON.stringify(error)).not.toContain(credential);
  });

  it('settles a JSON body timeout even when reader cancellation never settles', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(neverCancellingBody(), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    }));
    let captured: unknown;
    let settled = false;
    void verifyHostedMcp({ credential, endpoint, fetchImpl, timeoutMs: 25 }).then(
      () => { settled = true; },
      (error: unknown) => { captured = error; settled = true; },
    );

    await vi.advanceTimersByTimeAsync(25);

    expect(settled).toBe(true);
    expect(captured).toBeInstanceOf(McpVerificationError);
    expect(captured).toMatchObject({ code: 'timeout', status: null });
  });

  it('settles a notification body timeout even when reader cancellation never settles', async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      requestCount += 1;
      if (requestCount === 1) return rpcResult(1, initializeResult);
      return new Response(neverCancellingBody(), { status: 202 });
    });
    let captured: unknown;
    let settled = false;
    void verifyHostedMcp({ credential, endpoint, fetchImpl, timeoutMs: 25 }).then(
      () => { settled = true; },
      (error: unknown) => { captured = error; settled = true; },
    );

    await vi.advanceTimersByTimeAsync(25);

    expect(requestCount).toBe(2);
    expect(settled).toBe(true);
    expect(captured).toBeInstanceOf(McpVerificationError);
    expect(captured).toMatchObject({ code: 'timeout', status: null });
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
