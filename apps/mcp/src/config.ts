import { RuntimeApiClient } from './runtime-client.js';

export type McpServiceEnv = {
  readonly apiBaseUrl: string;
  readonly credential: string;
  readonly timeoutMs: number;
};

function parseTimeout(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) return 10_000;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('AGENTOPS_MCP_TIMEOUT_MS must be a positive number.');
  return parsed;
}

export function readMcpEnv(env: NodeJS.ProcessEnv = process.env): McpServiceEnv {
  return {
    apiBaseUrl: env.AGENTOPS_API_BASE_URL ?? 'http://localhost:8080',
    credential: env.AGENTOPS_MCP_CREDENTIAL ?? '',
    timeoutMs: parseTimeout(env.AGENTOPS_MCP_TIMEOUT_MS),
  };
}

export function runtimeClientFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeApiClient {
  const config = readMcpEnv(env);
  return new RuntimeApiClient(config);
}
