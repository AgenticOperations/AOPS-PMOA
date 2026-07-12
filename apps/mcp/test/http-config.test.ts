import { describe, expect, it } from 'vitest';
import { readHostedMcpEnv } from '../src/http-config.js';

describe('readHostedMcpEnv', () => {
  it('uses the exact safe local hosted defaults', () => {
    expect(readHostedMcpEnv({ NODE_ENV: 'development' })).toEqual({
      apiBaseUrl: 'http://localhost:8080',
      host: '127.0.0.1',
      port: 8070,
      publicUrl: 'http://localhost:8070/mcp',
      allowedHosts: ['127.0.0.1:8070', 'localhost:8070'],
      allowedOrigins: ['http://localhost:3005'],
      timeoutMs: 10_000,
      maxBodyBytes: 1_048_576,
      maxInFlight: 100,
      shutdownGraceMs: 10_000,
    });
  });

  it('parses overrides, normalizes URLs, and deduplicates allowlists', () => {
    expect(
      readHostedMcpEnv({
        NODE_ENV: 'development',
        AGENTOPS_API_BASE_URL: ' https://api.example.test/ ',
        MCP_HOST: ' 0.0.0.0 ',
        MCP_PORT: '9000',
        MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
        MCP_ALLOWED_HOSTS: ' mcp.example.test, mcp.example.test:443, mcp.example.test ',
        MCP_ALLOWED_ORIGINS:
          ' https://console.example.test/, https://console.example.test, http://localhost:4173 ',
        AGENTOPS_MCP_TIMEOUT_MS: '2500',
        MCP_MAX_BODY_BYTES: '2048',
        MCP_MAX_IN_FLIGHT: '12',
        MCP_SHUTDOWN_GRACE_MS: '7500',
      }),
    ).toEqual({
      apiBaseUrl: 'https://api.example.test',
      host: '0.0.0.0',
      port: 9000,
      publicUrl: 'https://mcp.example.test/mcp',
      allowedHosts: ['mcp.example.test', 'mcp.example.test:443'],
      allowedOrigins: ['https://console.example.test', 'http://localhost:4173'],
      timeoutMs: 2500,
      maxBodyBytes: 2048,
      maxInFlight: 12,
      shutdownGraceMs: 7500,
    });
  });

  it.each(['development', 'production'])('forbids a hosted global credential in %s', (nodeEnv) => {
    expect(() =>
      readHostedMcpEnv({
        NODE_ENV: nodeEnv,
        AGENTOPS_MCP_CREDENTIAL: ' customer-secret ',
      }),
    ).toThrow('AGENTOPS_MCP_CREDENTIAL is forbidden');
  });

  it('requires an explicit secure public URL and allowlists in production', () => {
    expect(() => readHostedMcpEnv({ NODE_ENV: 'production' })).toThrow(
      'MCP_PUBLIC_URL is required in production',
    );

    expect(() =>
      readHostedMcpEnv({
        NODE_ENV: 'production',
        MCP_PUBLIC_URL: 'http://mcp.example.test/mcp',
      }),
    ).toThrow('MCP_PUBLIC_URL must use https in production');

    expect(() =>
      readHostedMcpEnv({
        NODE_ENV: 'production',
        MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
        MCP_ALLOWED_ORIGINS: 'https://console.example.test',
      }),
    ).toThrow('MCP_ALLOWED_HOSTS is required in production');

    expect(() =>
      readHostedMcpEnv({
        NODE_ENV: 'production',
        MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
        MCP_ALLOWED_HOSTS: 'mcp.example.test',
      }),
    ).toThrow('MCP_ALLOWED_ORIGINS is required in production');
  });

  it.each([
    'not a URL',
    'ftp://mcp.example.test/mcp',
    'https://mcp.example.test/',
    'https://mcp.example.test/mcp/',
    'https://mcp.example.test/other',
    'https://mcp.example.test/mcp?debug=true',
    'https://mcp.example.test/mcp#debug',
    'https://user@mcp.example.test/mcp',
    'https://user:secret@mcp.example.test/mcp',
    'https://@mcp.example.test/mcp',
    'https://mcp.example.test/mcp?',
    'https://mcp.example.test/mcp#',
  ])('rejects invalid MCP_PUBLIC_URL value %s', (publicUrl) => {
    expect(() => readHostedMcpEnv({ MCP_PUBLIC_URL: publicUrl })).toThrow('MCP_PUBLIC_URL');
  });

  it.each([
    'https://mcp.example.test',
    'mcp.example.test/path',
    'mcp.example.test?debug=true',
    'user@mcp.example.test',
    'mcp example.test',
    'mcp.example.test:0',
    'mcp.example.test:65536',
    'mcp.example.test,,localhost:8070',
    '   ',
  ])('rejects invalid MCP_ALLOWED_HOSTS value %s', (allowedHosts) => {
    expect(() => readHostedMcpEnv({ MCP_ALLOWED_HOSTS: allowedHosts })).toThrow('MCP_ALLOWED_HOSTS');
  });

  it.each([
    'ftp://console.example.test',
    'https://console.example.test/app',
    'https://console.example.test/?debug=true',
    'https://console.example.test/#debug',
    'https://user@console.example.test',
    'https://@console.example.test',
    'https://console.example.test?',
    'https://console.example.test#',
    'console.example.test',
    'https://console.example.test,,http://localhost:3005',
    '   ',
  ])('rejects invalid MCP_ALLOWED_ORIGINS value %s', (allowedOrigins) => {
    expect(() => readHostedMcpEnv({ MCP_ALLOWED_ORIGINS: allowedOrigins })).toThrow(
      'MCP_ALLOWED_ORIGINS',
    );
  });

  it.each([
    ['MCP_PORT', '0'],
    ['MCP_PORT', '65536'],
    ['MCP_PORT', '1.5'],
    ['MCP_PORT', 'Infinity'],
    ['AGENTOPS_MCP_TIMEOUT_MS', '-1'],
    ['AGENTOPS_MCP_TIMEOUT_MS', '1.5'],
    ['MCP_MAX_BODY_BYTES', '0'],
    ['MCP_MAX_BODY_BYTES', 'NaN'],
    ['MCP_MAX_IN_FLIGHT', '-3'],
    ['MCP_MAX_IN_FLIGHT', ''],
    ['MCP_SHUTDOWN_GRACE_MS', '9007199254740992'],
  ])('rejects invalid numeric value %s=%s', (name, value) => {
    expect(() => readHostedMcpEnv({ [name]: value })).toThrow(name);
  });

  it.each([
    ['AGENTOPS_API_BASE_URL', ''],
    ['AGENTOPS_API_BASE_URL', 'postgres://db.example.test'],
    ['AGENTOPS_API_BASE_URL', 'not a URL'],
    ['AGENTOPS_API_BASE_URL', 'https://user@api.example.test'],
    ['AGENTOPS_API_BASE_URL', 'https://user:secret@api.example.test'],
    ['AGENTOPS_API_BASE_URL', 'https://@api.example.test'],
    ['AGENTOPS_API_BASE_URL', 'https://api.example.test/v1'],
    ['AGENTOPS_API_BASE_URL', 'https://api.example.test?debug=true'],
    ['AGENTOPS_API_BASE_URL', 'https://api.example.test?'],
    ['AGENTOPS_API_BASE_URL', 'https://api.example.test#debug'],
    ['AGENTOPS_API_BASE_URL', 'https://api.example.test#'],
    ['MCP_HOST', '   '],
  ])('rejects invalid required value %s=%s', (name, value) => {
    expect(() => readHostedMcpEnv({ [name]: value })).toThrow(name);
  });
});
