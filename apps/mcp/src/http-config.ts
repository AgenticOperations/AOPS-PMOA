export type HostedMcpConfig = {
  readonly apiBaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly publicUrl: string;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
  readonly maxInFlight: number;
  readonly shutdownGraceMs: number;
};

const DEFAULT_API_BASE_URL = 'http://localhost:8080';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8070;
const DEFAULT_PUBLIC_URL = 'http://localhost:8070/mcp';
const DEFAULT_ALLOWED_HOSTS = ['127.0.0.1:8070', 'localhost:8070'] as const;
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3005'] as const;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const DEFAULT_MAX_IN_FLIGHT = 100;
const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;

function requiredString(value: string | undefined, name: string, fallback: string): string {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${name} must be nonblank.`);
  return trimmed;
}

function hasRawUserInfo(value: string): boolean {
  const schemeEnd = value.indexOf('://');
  if (schemeEnd === -1) return false;
  const authorityStart = schemeEnd + 3;
  const authorityEndOffset = value.slice(authorityStart).search(/[/?#]/);
  const authorityEnd = authorityEndOffset === -1 ? value.length : authorityStart + authorityEndOffset;
  return value.slice(authorityStart, authorityEnd).includes('@');
}

function hasRawQueryOrHash(value: string): boolean {
  return value.includes('?') || value.includes('#');
}

function parseApiBaseUrl(value: string | undefined): string {
  const raw = requiredString(value, 'AGENTOPS_API_BASE_URL', DEFAULT_API_BASE_URL);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('AGENTOPS_API_BASE_URL must be a valid http or https URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AGENTOPS_API_BASE_URL must be a valid http or https URL.');
  }
  if (hasRawUserInfo(raw) || parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error('AGENTOPS_API_BASE_URL must not include credentials.');
  }
  if (parsed.pathname !== '/') {
    throw new Error('AGENTOPS_API_BASE_URL must be an origin with no path.');
  }
  if (hasRawQueryOrHash(raw)) {
    throw new Error('AGENTOPS_API_BASE_URL must not include a query or hash.');
  }
  return parsed.origin;
}

function parsePositiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (
    trimmed.length === 0 ||
    !Number.isFinite(parsed) ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > maximum
  ) {
    throw new Error(`${name} must be a positive integer no greater than ${String(maximum)}.`);
  }
  return parsed;
}

function parsePublicUrl(value: string, production: boolean): string {
  const raw = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('MCP_PUBLIC_URL must be a valid http or https URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('MCP_PUBLIC_URL must be a valid http or https URL.');
  }
  if (production && parsed.protocol !== 'https:') {
    throw new Error('MCP_PUBLIC_URL must use https in production.');
  }
  if (hasRawUserInfo(raw) || parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error('MCP_PUBLIC_URL must not include credentials.');
  }
  if (parsed.pathname !== '/mcp') {
    throw new Error('MCP_PUBLIC_URL path must be exactly /mcp.');
  }
  if (hasRawQueryOrHash(raw)) {
    throw new Error('MCP_PUBLIC_URL must not include a query or hash.');
  }
  return parsed.toString();
}

function splitAllowlist(value: string, name: string): string[] {
  const tokens = value.split(',').map((token) => token.trim());
  if (tokens.length === 0 || tokens.some((token) => token.length === 0)) {
    throw new Error(`${name} must contain a non-empty comma-separated list.`);
  }
  return tokens;
}

function validateAllowedHost(token: string): void {
  if (/\s/.test(token) || /[\\/?#@%]/.test(token) || token.includes('://')) {
    throw new Error(`MCP_ALLOWED_HOSTS contains an invalid host token: ${token}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(`http://${token}/`);
  } catch {
    throw new Error(`MCP_ALLOWED_HOSTS contains an invalid host token: ${token}`);
  }
  if (
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    (parsed.port.length > 0 && (Number(parsed.port) <= 0 || Number(parsed.port) > 65_535))
  ) {
    throw new Error(`MCP_ALLOWED_HOSTS contains an invalid host token: ${token}`);
  }
}

function parseAllowedHosts(value: string): readonly string[] {
  const hosts = splitAllowlist(value, 'MCP_ALLOWED_HOSTS');
  for (const host of hosts) validateAllowedHost(host);
  return [...new Set(hosts)];
}

function parseAllowedOrigins(value: string): readonly string[] {
  const origins = splitAllowlist(value, 'MCP_ALLOWED_ORIGINS').map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`MCP_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      hasRawUserInfo(origin) ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.pathname !== '/' ||
      hasRawQueryOrHash(origin)
    ) {
      throw new Error(`MCP_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
    return parsed.origin;
  });
  return [...new Set(origins)];
}

function productionValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required in production.`);
  }
  return value;
}

export function readHostedMcpEnv(env: NodeJS.ProcessEnv = process.env): HostedMcpConfig {
  const production = env.NODE_ENV === 'production';
  if (env.AGENTOPS_MCP_CREDENTIAL?.trim()) {
    throw new Error('AGENTOPS_MCP_CREDENTIAL is forbidden for the hosted MCP service.');
  }

  const publicUrlValue = production
    ? productionValue(env, 'MCP_PUBLIC_URL')
    : (env.MCP_PUBLIC_URL ?? DEFAULT_PUBLIC_URL);
  const publicUrl = parsePublicUrl(publicUrlValue, production);
  const allowedHostsValue = production
    ? productionValue(env, 'MCP_ALLOWED_HOSTS')
    : (env.MCP_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS.join(','));
  const allowedOriginsValue = production
    ? productionValue(env, 'MCP_ALLOWED_ORIGINS')
    : (env.MCP_ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(','));

  return {
    apiBaseUrl: parseApiBaseUrl(env.AGENTOPS_API_BASE_URL),
    host: requiredString(env.MCP_HOST, 'MCP_HOST', DEFAULT_HOST),
    port: parsePositiveInteger(env.MCP_PORT, 'MCP_PORT', DEFAULT_PORT, 65_535),
    publicUrl,
    allowedHosts: parseAllowedHosts(allowedHostsValue),
    allowedOrigins: parseAllowedOrigins(allowedOriginsValue),
    timeoutMs: parsePositiveInteger(
      env.AGENTOPS_MCP_TIMEOUT_MS,
      'AGENTOPS_MCP_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
    ),
    maxBodyBytes: parsePositiveInteger(
      env.MCP_MAX_BODY_BYTES,
      'MCP_MAX_BODY_BYTES',
      DEFAULT_MAX_BODY_BYTES,
    ),
    maxInFlight: parsePositiveInteger(
      env.MCP_MAX_IN_FLIGHT,
      'MCP_MAX_IN_FLIGHT',
      DEFAULT_MAX_IN_FLIGHT,
    ),
    shutdownGraceMs: parsePositiveInteger(
      env.MCP_SHUTDOWN_GRACE_MS,
      'MCP_SHUTDOWN_GRACE_MS',
      DEFAULT_SHUTDOWN_GRACE_MS,
    ),
  };
}
