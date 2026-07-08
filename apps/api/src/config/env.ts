import { readNumberEnv, readStringEnv } from '@agentops-pmoa/config';

export type ApiEnv = {
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly databaseUrl: string;
  readonly sessionCookieName: string;
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  readonly googleOAuthRedirectUrl: string;
};

export function readApiEnv(): ApiEnv {
  return {
    host: readStringEnv('HOST', '127.0.0.1'),
    port: readNumberEnv('PORT', 4010),
    logLevel: readStringEnv('LOG_LEVEL', 'info'),
    databaseUrl: readStringEnv(
      'DATABASE_URL',
      'postgres://agentops:agentops@localhost:5432/agentops_pmoa',
    ),
    sessionCookieName: readStringEnv('SESSION_COOKIE_NAME', 'agentops_session'),
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    googleOAuthRedirectUrl:
      process.env.GOOGLE_OAUTH_REDIRECT_URL ?? 'http://localhost:3005/api/auth/google/callback',
  };
}
