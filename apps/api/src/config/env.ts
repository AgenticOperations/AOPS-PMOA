export type ApiService = 'api' | 'worker';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type ApiEnv = {
  readonly appBaseUrl: string;
  readonly circleProfileMasterKey: string;
  readonly circleWorkerTimeoutMs: number;
  readonly circleWorkerToken: string;
  readonly circleWorkerUrl: string;
  readonly databaseUrl: string;
  readonly enableTestnetX402Fixtures: boolean;
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  readonly googleOAuthRedirectUrl: string;
  readonly host: string;
  readonly logLevel: string;
  readonly nodeEnv: string;
  readonly port: number;
  readonly publicApiBaseUrl: string;
  readonly redisUrl: string;
  readonly sessionCookieName: string;
  readonly x402ResultEncryptionKey: string;
};

function stringValue(
  environment: RuntimeEnvironment,
  key: string,
  fallback = '',
): string {
  return environment[key]?.trim() || fallback;
}

function numberValue(
  environment: RuntimeEnvironment,
  key: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const raw = environment[key];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${key} must be a positive integer no greater than ${maximum}.`);
  }
  return value;
}

function booleanValue(environment: RuntimeEnvironment, key: string): boolean {
  const raw = environment[key];
  if (raw === undefined || raw.trim().length === 0 || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new Error(`${key} must be either true or false.`);
}

function requireValue(environment: RuntimeEnvironment, key: string): string {
  const value = stringValue(environment, key);
  if (value.length === 0) throw new Error(`${key} is required in production.`);
  return value;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::' ||
    normalized === '::1' ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('127.');
}

function requireProductionUrl(
  environment: RuntimeEnvironment,
  key: string,
  options: {
    readonly exactOrigin?: boolean;
    readonly protocols: readonly string[];
  },
): URL {
  const raw = requireValue(environment, key);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${key} must be an absolute URL in production.`);
  }
  if (!options.protocols.includes(parsed.protocol)) {
    throw new Error(`${key} must use ${options.protocols.join(' or ')} in production.`);
  }
  if (isLoopbackHostname(parsed.hostname)) {
    throw new Error(`${key} may not use a loopback authority in production.`);
  }
  if (
    options.exactOrigin === true &&
    (parsed.username.length > 0 || parsed.password.length > 0)
  ) {
    throw new Error(`${key} may not contain URL credentials in production.`);
  }
  if (
    options.exactOrigin === true &&
    (parsed.pathname !== '/' || parsed.search.length > 0 || parsed.hash.length > 0)
  ) {
    throw new Error(`${key} must be an exact origin in production.`);
  }
  return parsed;
}

function requireCanonicalBase64Key(environment: RuntimeEnvironment, key: string): string {
  const value = requireValue(environment, key);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value) {
    throw new Error(`${key} must be canonical base64 for exactly 32 bytes.`);
  }
  return value;
}

function validateProductionApi(environment: RuntimeEnvironment): void {
  requireProductionUrl(environment, 'DATABASE_URL', { protocols: ['postgres:', 'postgresql:'] });
  requireProductionUrl(environment, 'REDIS_URL', { protocols: ['redis:', 'rediss:'] });
  const appBaseUrl = requireProductionUrl(environment, 'APP_BASE_URL', {
    exactOrigin: true,
    protocols: ['https:'],
  });
  requireProductionUrl(environment, 'PUBLIC_API_BASE_URL', {
    exactOrigin: true,
    protocols: ['https:'],
  });
  requireValue(environment, 'GOOGLE_CLIENT_ID');
  requireValue(environment, 'GOOGLE_CLIENT_SECRET');
  const redirectUrl = requireProductionUrl(environment, 'GOOGLE_OAUTH_REDIRECT_URL', {
    protocols: ['https:'],
  });
  const expectedRedirectUrl = new URL('/api/auth/google/callback', appBaseUrl).href;
  if (redirectUrl.href !== expectedRedirectUrl) {
    throw new Error(`GOOGLE_OAUTH_REDIRECT_URL must equal ${expectedRedirectUrl} in production.`);
  }
  requireProductionUrl(environment, 'CIRCLE_WORKER_URL', {
    exactOrigin: true,
    protocols: ['http:', 'https:'],
  });
  if (requireValue(environment, 'CIRCLE_WORKER_TOKEN').length < 32) {
    throw new Error('CIRCLE_WORKER_TOKEN must contain at least 32 characters.');
  }
  requireCanonicalBase64Key(environment, 'X402_RESULT_ENCRYPTION_KEY');
}

function validateProductionWorker(
  environment: RuntimeEnvironment,
  enableTestnetX402Fixtures: boolean,
): void {
  requireProductionUrl(environment, 'DATABASE_URL', { protocols: ['postgres:', 'postgresql:'] });
  if (requireValue(environment, 'CIRCLE_WORKER_TOKEN').length < 32) {
    throw new Error('CIRCLE_WORKER_TOKEN must contain at least 32 characters.');
  }
  requireCanonicalBase64Key(environment, 'CIRCLE_PROFILE_MASTER_KEY');
  if (enableTestnetX402Fixtures) {
    requireProductionUrl(environment, 'PUBLIC_API_BASE_URL', {
      exactOrigin: true,
      protocols: ['https:'],
    });
  }
}

export function readApiEnv(
  environment: RuntimeEnvironment = process.env,
  service: ApiService = 'api',
): ApiEnv {
  const enableTestnetX402Fixtures = booleanValue(environment, 'ENABLE_TESTNET_X402_FIXTURES');
  const nodeEnv = stringValue(environment, 'NODE_ENV', 'development');
  if (nodeEnv === 'production') {
    if (service === 'api') validateProductionApi(environment);
    else validateProductionWorker(environment, enableTestnetX402Fixtures);
  }

  return {
    appBaseUrl: stringValue(environment, 'APP_BASE_URL', 'http://localhost:3005'),
    circleProfileMasterKey: service === 'worker'
      ? stringValue(environment, 'CIRCLE_PROFILE_MASTER_KEY')
      : '',
    circleWorkerTimeoutMs: numberValue(environment, 'CIRCLE_WORKER_TIMEOUT_MS', 10_000, 300_000),
    circleWorkerToken: stringValue(environment, 'CIRCLE_WORKER_TOKEN'),
    circleWorkerUrl: stringValue(environment, 'CIRCLE_WORKER_URL'),
    databaseUrl: stringValue(
      environment,
      'DATABASE_URL',
      'postgres://agentops:agentops@localhost:5432/agentops_pmoa',
    ),
    enableTestnetX402Fixtures,
    googleClientId: stringValue(environment, 'GOOGLE_CLIENT_ID'),
    googleClientSecret: stringValue(environment, 'GOOGLE_CLIENT_SECRET'),
    googleOAuthRedirectUrl: stringValue(
      environment,
      'GOOGLE_OAUTH_REDIRECT_URL',
      'http://localhost:3005/api/auth/google/callback',
    ),
    host: stringValue(environment, 'HOST', '127.0.0.1'),
    logLevel: stringValue(environment, 'LOG_LEVEL', 'info'),
    nodeEnv,
    port: numberValue(environment, 'PORT', 4010, 65_535),
    publicApiBaseUrl: stringValue(environment, 'PUBLIC_API_BASE_URL', 'http://localhost:8080'),
    redisUrl: stringValue(environment, 'REDIS_URL', 'redis://127.0.0.1:6380'),
    sessionCookieName: stringValue(environment, 'SESSION_COOKIE_NAME', 'agentops_session'),
    x402ResultEncryptionKey: service === 'api'
      ? stringValue(environment, 'X402_RESULT_ENCRYPTION_KEY')
      : '',
  };
}
