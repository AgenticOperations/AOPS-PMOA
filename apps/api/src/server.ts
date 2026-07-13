import { buildApp } from './app.js';
import { readApiEnv } from './config/env.js';
import pg from 'pg';
import { Redis } from 'ioredis';
import { runMigrations } from '@agentops-pmoa/db';
import { resolveSession } from './engines/auth/store.js';
import { getMembershipRole } from './engines/identity/store.js';
import {
  createCircleWorkerConnectionClient,
  createCircleWorkerTreasuryProvider,
} from './engines/payments/circle-worker-client.js';
import { createX402ResultCryptoCodec } from './engines/payments/x402-result-crypto.js';
import { deriveTestnetPaidHttpAllowOrigins } from './engines/payments/x402-http.js';
import { createHttpReadinessCheck, createReadinessProbe } from './readiness.js';
import { installGracefulShutdown } from './shutdown.js';

const env = readApiEnv(process.env, 'api');
const pool = new pg.Pool({ connectionString: env.databaseUrl });
const redis = new Redis(env.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 1 });
const circleWorkerConfigured = env.circleWorkerUrl.length > 0 && env.circleWorkerToken.length >= 32;
const readiness = createReadinessProbe([
  () => pool.query('SELECT 1'),
  () => redis.ping(),
  ...(circleWorkerConfigured
    ? [createHttpReadinessCheck({
        timeoutMs: env.circleWorkerTimeoutMs,
        url: `${env.circleWorkerUrl.replace(/\/+$/, '')}/readyz`,
      })]
    : []),
]);
redis.on('error', (error: Error) => {
  process.stderr.write(
    `[redis] connection error, payments balance cache disabled for this request ${
      error.stack ?? error.message
    }\n`,
  );
});

await runMigrations(pool);

function bearerToken(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

const app = buildApp({
  enableTestnetX402Fixtures: env.enableTestnetX402Fixtures,
  identity: {
    pool,
    sessionCookieName: env.sessionCookieName,
    googleOAuth:
      env.googleClientId.length > 0 && env.googleClientSecret.length > 0
        ? {
            clientId: env.googleClientId,
            clientSecret: env.googleClientSecret,
            redirectUrl: env.googleOAuthRedirectUrl,
          }
        : undefined,
  },
  policy: {
    pool,
    sessionCookieName: env.sessionCookieName,
  },
  approvals: {
    pool,
    sessionCookieName: env.sessionCookieName,
  },
  operations: {
    pool,
    sessionCookieName: env.sessionCookieName,
  },
  payments: {
    ...(circleWorkerConfigured
      ? {
          circleConnectionService: createCircleWorkerConnectionClient({
            baseUrl: env.circleWorkerUrl,
            timeoutMs: env.circleWorkerTimeoutMs,
            token: env.circleWorkerToken,
          }),
          circleProviderFactory: (orgId: string) => createCircleWorkerTreasuryProvider({
            baseUrl: env.circleWorkerUrl,
            orgId,
            timeoutMs: env.circleWorkerTimeoutMs,
            token: env.circleWorkerToken,
          }),
        }
      : {}),
    pool,
    paidHttpUrlPolicy: {
      allowHttpOrigins: deriveTestnetPaidHttpAllowOrigins(
        env.enableTestnetX402Fixtures,
        env.publicApiBaseUrl,
      ),
    },
    redis,
    resultCrypto: env.x402ResultEncryptionKey.length > 0
      ? createX402ResultCryptoCodec(env.x402ResultEncryptionKey)
      : undefined,
    sessionCookieName: env.sessionCookieName,
  },
  runtime: {
    pool,
  },
  evidence: {
    pool,
    resolveOrgScope: async (request) => {
      const header = request.headers['x-agentops-org-id'];
      if (typeof header !== 'string' || header.length === 0) return null;
      const token = bearerToken(request.headers.authorization);
      if (token === null) return null;
      const session = await resolveSession(pool, token);
      if (session === null) return null;
      const role = await getMembershipRole(pool, header, session.user.id);
      if (role === null) return null;
      return { orgId: header };
    },
  },
  readiness,
});

app.addHook('onClose', async () => {
  await pool.end();
  redis.disconnect();
});
installGracefulShutdown(() => app.close());

try {
  await app.listen({ host: env.host, port: env.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
