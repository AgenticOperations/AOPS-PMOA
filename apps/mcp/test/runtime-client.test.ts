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
});
