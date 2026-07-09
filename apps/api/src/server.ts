import { buildApp } from './app.js';
import { readApiEnv } from './config/env.js';
import pg from 'pg';
import { runMigrations } from '@agentops-pmoa/db';
import { resolveSession } from './engines/auth/store.js';
import { getMembershipRole } from './engines/identity/store.js';

const env = readApiEnv();
const pool = new pg.Pool({ connectionString: env.databaseUrl });

await runMigrations(pool);

function bearerToken(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

const app = buildApp({
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
    pool,
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
});

app.addHook('onClose', async () => {
  await pool.end();
});

try {
  await app.listen({ host: env.host, port: env.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
