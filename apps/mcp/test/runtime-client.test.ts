import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeApiError, RuntimeApiClient } from '../src/runtime-client.js';

type FetchCall = {
  readonly input: string | URL | Request;
  readonly init: RequestInit | undefined;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function inputUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('RuntimeApiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends bearer-authenticated runtime checks to the backend', async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input, init });
      return Promise.resolve(jsonResponse({ decision: { decision: 'allow' } }));
    });

    const client = new RuntimeApiClient({
      apiBaseUrl: 'http://localhost:8080/',
      credential: 'agent_secret_value',
      timeoutMs: 5000,
    });
    await client.check({ intent: 'Can I call weather data?' });

    expect(calls).toHaveLength(1);
    const firstCall = calls[0];
    if (firstCall === undefined) throw new Error('Expected fetch call.');
    expect(inputUrl(firstCall.input)).toBe('http://localhost:8080/v1/runtime/check');
    expect(firstCall.init?.method).toBe('POST');
    expect(firstCall.init?.headers).toMatchObject({
      authorization: 'Bearer agent_secret_value',
      'content-type': 'application/json',
    });
    expect(firstCall.init?.body).toBe(JSON.stringify({ intent: 'Can I call weather data?' }));
  });

  it('sends bearer-authenticated operation checks to the backend', async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input, init });
      return Promise.resolve(jsonResponse({ operation: { decision: 'allow' } }));
    });

    const client = new RuntimeApiClient({
      apiBaseUrl: 'http://localhost:8080/',
      credential: 'agent_secret_value',
      timeoutMs: 5000,
    });
    await client.operationCheck({ action: 'tool.call', tool: { name: 'browser.search' } });

    expect(calls).toHaveLength(1);
    const firstCall = calls[0];
    if (firstCall === undefined) throw new Error('Expected fetch call.');
    expect(inputUrl(firstCall.input)).toBe('http://localhost:8080/v1/runtime/operations/check');
    expect(firstCall.init?.method).toBe('POST');
    expect(firstCall.init?.headers).toMatchObject({
      authorization: 'Bearer agent_secret_value',
      'content-type': 'application/json',
    });
    expect(firstCall.init?.body).toBe(JSON.stringify({ action: 'tool.call', tool: { name: 'browser.search' } }));
  });

  it('forwards the exact governed paid HTTP request and returns the canonical result', async () => {
    const calls: FetchCall[] = [];
    const canonicalResult = {
      payment: {
        id: 'payevt_paid_http',
        attemptId: 'x402att_paid_http',
        status: 'settled',
        providerMode: 'live',
        rail: 'exact_base',
        chain: 'base',
        amount: '0.25',
        asset: 'USDC',
        agentId: 'agt_research',
        connectionId: 'conn_runtime',
        sourceId: 'src_wallet',
        reservationId: 'rsv_paid_http',
        recipient: '0x0000000000000000000000000000000000000001',
        network: 'eip155:8453',
        transaction: '0xsettled',
        payer: '0x0000000000000000000000000000000000000002',
        responseAvailable: true,
      },
      response: {
        status: 200,
        headers: [['content-type', 'application/json']],
        contentType: 'application/json',
        bodyEncoding: 'json',
        body: { sessionUrl: 'https://merchant.example/sessions/sess_1' },
        sizeBytes: 64,
        truncated: false,
      },
    };
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input, init });
      return Promise.resolve(jsonResponse(canonicalResult));
    });
    const client = new RuntimeApiClient({
      apiBaseUrl: 'http://localhost:8080/',
      credential: 'agent_secret_value',
      timeoutMs: 5000,
    });
    const input = {
      idempotency_key: 'paid-http-report-1',
      request: {
        url: 'https://merchant.example/report',
        method: 'POST' as const,
        headers: [
          ['accept', 'application/json'],
          ['x-trace-id', 'trace-1'],
          ['x-trace-id', 'trace-2'],
        ] as const,
        body: { kind: 'json' as const, value: { range: '30d', include: ['usage', 'cost'] } },
      },
    };

    await expect(client.paymentX402(input)).resolves.toEqual(canonicalResult);

    expect(calls).toHaveLength(1);
    const firstCall = calls[0];
    if (firstCall === undefined) throw new Error('Expected fetch call.');
    expect(inputUrl(firstCall.input)).toBe('http://localhost:8080/v1/runtime/payments/x402');
    expect(firstCall.init?.method).toBe('POST');
    expect(firstCall.init?.body).toBe(JSON.stringify(input));
  });

  it('reports backend errors without leaking the runtime credential', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(jsonResponse({ message: 'Connection credential is invalid.' }, 401)));

    const client = new RuntimeApiClient({
      apiBaseUrl: 'http://localhost:8080',
      credential: 'do_not_leak_me',
      timeoutMs: 5000,
    });

    await expect(client.onboard()).rejects.toThrow(RuntimeApiError);
    await expect(client.onboard()).rejects.not.toThrow('do_not_leak_me');
  });

  it('preserves structured approval metadata from backend errors', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        jsonResponse(
          {
            approvalId: 'apv_payment',
            decisionId: 'pdec_payment',
            error: 'policy_requires_approval',
            message: 'A policy requires approval before this request can continue.',
          },
          409,
        ),
      ),
    );

    const client = new RuntimeApiClient({
      apiBaseUrl: 'http://localhost:8080',
      credential: 'agent_secret_value',
      timeoutMs: 5000,
    });

    let caught: unknown;
    try {
      await client.paymentX402({
        idempotency_key: 'approval-payment-1',
        request: {
          url: 'https://merchant.example/report',
          method: 'GET',
          headers: [],
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RuntimeApiError);
    expect((caught as RuntimeApiError).details).toMatchObject({
      approvalId: 'apv_payment',
      decisionId: 'pdec_payment',
    });
  });
});
