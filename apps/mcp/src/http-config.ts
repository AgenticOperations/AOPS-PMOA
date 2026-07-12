import { isIP } from 'node:net';

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
const MAX_TIMEOUT_MS = 300_000;
const MAX_BODY_BYTES = 10_485_760;
const MAX_IN_FLIGHT = 10_000;
const MAX_SHUTDOWN_GRACE_MS = 300_000;

function requiredString(value: string | undefined, name: string, fallback: string): string {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${name} must be nonblank.`);
  return trimmed;
}

function rawAuthority(value: string): string {
  const schemeEnd = value.indexOf('://');
  if (schemeEnd === -1) return '';
  const authorityStart = schemeEnd + 3;
  const authorityEndOffset = value.slice(authorityStart).search(/[/?#]/);
  const authorityEnd = authorityEndOffset === -1 ? value.length : authorityStart + authorityEndOffset;
  return value.slice(authorityStart, authorityEnd);
}

function hasRawUserInfo(value: string): boolean {
  return rawAuthority(value).includes('@');
}

function hasRawQueryOrHash(value: string): boolean {
  return value.includes('?') || value.includes('#');
}

function readNodeEnvironment(env: NodeJS.ProcessEnv): 'development' | 'test' | 'production' {
  if (!Object.prototype.hasOwnProperty.call(env, 'NODE_ENV')) return 'development';
  const value = env.NODE_ENV;
  if (value === 'development' || value === 'test' || value === 'production') return value;
  throw new Error('NODE_ENV must be development, test, or production.');
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
  const parsed = Number(value);
  if (
    !/^[0-9]+$/.test(value) ||
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
  const emptyIndex = tokens.findIndex((token) => token.length === 0);
  if (tokens.length === 0 || emptyIndex !== -1) {
    throw new Error(`${name} contains an empty token at index ${String(Math.max(emptyIndex, 0) + 1)}.`);
  }
  return tokens;
}

function invalidAllowlistToken(name: string, index: number): never {
  throw new Error(`${name} contains an invalid token at index ${String(index + 1)}.`);
}

function normalizePort(value: string | undefined, name: string, index: number): string {
  if (value === undefined) return '';
  if (!/^[0-9]+$/.test(value)) invalidAllowlistToken(name, index);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    invalidAllowlistToken(name, index);
  }
  return `:${String(port)}`;
}

function normalizeAllowedHost(token: string, name: string, index: number): string {
  if (/\s/.test(token)) invalidAllowlistToken(name, index);

  if (token.startsWith('[') || token.includes(']')) {
    const match = /^\[([^\]]+)\](?::(.*))?$/.exec(token);
    if (match === null) invalidAllowlistToken(name, index);
    const address = match[1];
    if (address === undefined || isIP(address) !== 6) {
      invalidAllowlistToken(name, index);
    }
    const normalizedHost = new URL(`http://[${address}]/`).hostname.toLowerCase();
    return `${normalizedHost}${normalizePort(match[2], name, index)}`;
  }

  const colonIndex = token.indexOf(':');
  if (colonIndex !== token.lastIndexOf(':')) invalidAllowlistToken(name, index);
  const host = (colonIndex === -1 ? token : token.slice(0, colonIndex)).toLowerCase();
  const port = normalizePort(
    colonIndex === -1 ? undefined : token.slice(colonIndex + 1),
    name,
    index,
  );
  if (host.length === 0) invalidAllowlistToken(name, index);

  if (isIP(host) === 4) return `${host}${port}`;
  const labels = host.split('.');
  const legacyNumericHost = labels.every((label) => /^(?:[0-9]+|0x[0-9a-f]+)$/i.test(label));
  if (legacyNumericHost || host.length > 253) {
    invalidAllowlistToken(name, index);
  }
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    invalidAllowlistToken(name, index);
  }
  return `${host}${port}`;
}

function parseAllowedHosts(value: string): readonly string[] {
  const hosts = splitAllowlist(value, 'MCP_ALLOWED_HOSTS').map((host, index) =>
    normalizeAllowedHost(host, 'MCP_ALLOWED_HOSTS', index),
  );
  return [...new Set(hosts)];
}

function parseAllowedOrigins(value: string): readonly string[] {
  const origins = splitAllowlist(value, 'MCP_ALLOWED_ORIGINS').map((origin, index) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      invalidAllowlistToken('MCP_ALLOWED_ORIGINS', index);
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      hasRawUserInfo(origin) ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.pathname !== '/' ||
      hasRawQueryOrHash(origin)
    ) {
      invalidAllowlistToken('MCP_ALLOWED_ORIGINS', index);
    }
    normalizeAllowedHost(rawAuthority(origin), 'MCP_ALLOWED_ORIGINS', index);
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
  if (Object.prototype.hasOwnProperty.call(env, 'AGENTOPS_MCP_CREDENTIAL')) {
    throw new Error('AGENTOPS_MCP_CREDENTIAL is forbidden for the hosted MCP service.');
  }
  const production = readNodeEnvironment(env) === 'production';

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
      MAX_TIMEOUT_MS,
    ),
    maxBodyBytes: parsePositiveInteger(
      env.MCP_MAX_BODY_BYTES,
      'MCP_MAX_BODY_BYTES',
      DEFAULT_MAX_BODY_BYTES,
      MAX_BODY_BYTES,
    ),
    maxInFlight: parsePositiveInteger(
      env.MCP_MAX_IN_FLIGHT,
      'MCP_MAX_IN_FLIGHT',
      DEFAULT_MAX_IN_FLIGHT,
      MAX_IN_FLIGHT,
    ),
    shutdownGraceMs: parsePositiveInteger(
      env.MCP_SHUTDOWN_GRACE_MS,
      'MCP_SHUTDOWN_GRACE_MS',
      DEFAULT_SHUTDOWN_GRACE_MS,
      MAX_SHUTDOWN_GRACE_MS,
    ),
  };
}
