import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveMcpPublicUrl } from '../../src/lib/server/mcp-public-url.js';

function env(nodeEnv: string | undefined, mcpPublicUrl?: string): NodeJS.ProcessEnv {
  const values: Record<string, string | undefined> = {
    NODE_ENV: nodeEnv,
    ...(mcpPublicUrl === undefined ? {} : { MCP_PUBLIC_URL: mcpPublicUrl }),
  };
  return values as NodeJS.ProcessEnv;
}

describe('resolveMcpPublicUrl', () => {
  it('requires an explicit MCP_PUBLIC_URL in production', () => {
    expect(() => resolveMcpPublicUrl(env('production'))).toThrowError(
      'MCP_PUBLIC_URL is required in production',
    );
    expect(() => resolveMcpPublicUrl(env('production', ''))).toThrowError(
      'MCP_PUBLIC_URL is required in production',
    );
  });

  it('accepts only HTTPS exact /mcp production endpoints', () => {
    expect(resolveMcpPublicUrl(env('production', 'https://mcp.agentops.example/mcp'))).toBe(
      'https://mcp.agentops.example/mcp',
    );
  });

  it.each([
    'http://localhost:8070/mcp',
    'http://mcp.agentops.example/mcp',
    'https://mcp.agentops.example/mcp/',
    'https://mcp.agentops.example/other',
    'https://user:pass@mcp.agentops.example/mcp',
    'https://@mcp.agentops.example/mcp',
    'https://mcp.agentops.example/mcp?tenant=one',
    'https://mcp.agentops.example/mcp?',
    'https://mcp.agentops.example/mcp#fragment',
    'https://mcp.agentops.example/mcp#',
    ' https://mcp.agentops.example/mcp',
    'https:mcp.agentops.example/mcp',
    'https://MCP.AgentOps.Example/mcp',
    'https://mcp.agentops.example:443/mcp',
    'https://mcp.\texample/mcp',
    'https://mcp.example/mcp\n',
    'https://mcp.example/\u0000mcp',
    'https://mcp.example/mcp\u001f',
    'https://mcp.example/mcp\u007f',
  ])('rejects unsafe production endpoint %s', (value) => {
    expect(() => resolveMcpPublicUrl(env('production', value))).toThrowError(
      'MCP_PUBLIC_URL must be an HTTPS URL with the exact /mcp path',
    );
  });

  it.each(['development', 'test'])('defaults %s to the local hosted MCP service', (nodeEnv) => {
    expect(resolveMcpPublicUrl(env(nodeEnv))).toBe('http://localhost:8070/mcp');
    expect(resolveMcpPublicUrl(env(nodeEnv, ''))).toBe('http://localhost:8070/mcp');
  });

  it.each([
    'http://localhost:8070/mcp',
    'http://127.0.0.1:8070/mcp',
    'http://[::1]:8070/mcp',
    'https://mcp.preview.example/mcp',
  ])('accepts safe explicit non-production endpoint %s', (value) => {
    expect(resolveMcpPublicUrl(env('development', value))).toBe(value);
  });

  it.each([
    'http://0.0.0.0:8070/mcp',
    'http://mcp.preview.example/mcp',
    'https://mcp.preview.example/mcp/',
    'https://user@mcp.preview.example/mcp',
    'https://mcp.preview.example/mcp?debug=1',
    'https://mcp.preview.example/mcp#debug',
  ])('rejects unsafe non-production endpoint %s', (value) => {
    expect(() => resolveMcpPublicUrl(env('test', value))).toThrowError(
      'MCP_PUBLIC_URL must use HTTPS or explicit HTTP loopback with the exact /mcp path',
    );
  });

  it.each([undefined, 'staging', 'prod', ''])('rejects unknown NODE_ENV value %s', (nodeEnv) => {
    expect(() => resolveMcpPublicUrl(env(nodeEnv, 'https://mcp.agentops.example/mcp'))).toThrowError(
      'NODE_ENV must be development, test, or production',
    );
  });
});
