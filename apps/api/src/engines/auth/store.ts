import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { prefixedId } from '../identity/ids.js';
import type { AuthenticatedUser, GoogleProfile, SessionContext } from './types.js';

type UserRow = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly avatar_url: string | null;
};

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sessionToken(): string {
  return `sess_${randomBytes(32).toString('base64url')}`;
}

function userFromRow(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar_url: row.avatar_url,
  };
}

export async function upsertGoogleUser(client: pg.PoolClient, profile: GoogleProfile): Promise<AuthenticatedUser> {
  const email = profile.email.toLowerCase();
  const userId = prefixedId('usr');
  await client.query(
    `INSERT INTO users (id, email, name, avatar_url, last_seen_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           avatar_url = EXCLUDED.avatar_url,
           last_seen_at = now(),
           updated_at = now()`,
    [userId, email, profile.name, profile.picture ?? null],
  );

  const userResult = await client.query<UserRow>(
    `SELECT id, email, name, avatar_url
       FROM users
      WHERE email = $1`,
    [email],
  );
  const user = userResult.rows[0];
  if (user === undefined) throw new Error('user_upsert_failed');

  await client.query(
    `INSERT INTO oauth_accounts (
       id,
       user_id,
       provider,
       provider_subject,
       email,
       email_verified
     )
     VALUES ($1, $2, 'google', $3, $4, $5)
     ON CONFLICT (provider, provider_subject) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           email = EXCLUDED.email,
           email_verified = EXCLUDED.email_verified,
           updated_at = now()`,
    [prefixedId('oauth'), user.id, profile.sub, email, profile.email_verified],
  );

  return userFromRow(user);
}

export async function createSession(client: pg.PoolClient, userId: string): Promise<{
  readonly token: string;
  readonly expiresAt: Date;
  readonly sessionId: string;
}> {
  const token = sessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const sessionId = prefixedId('ses');
  await client.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, userId, tokenHash(token), expiresAt],
  );

  return { token, expiresAt, sessionId };
}

export async function resolveSession(pool: pg.Pool, token: string): Promise<SessionContext | null> {
  const result = await pool.query<
    UserRow & {
      readonly session_id: string;
    }
  >(
    `SELECT
       s.id AS session_id,
       u.id,
       u.email,
       u.name,
       u.avatar_url
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
     LIMIT 1`,
    [tokenHash(token)],
  );
  const row = result.rows[0];
  if (row === undefined) return null;

  await pool.query('UPDATE auth_sessions SET last_used_at = now() WHERE id = $1', [row.session_id]);
  return {
    sessionId: row.session_id,
    user: userFromRow(row),
  };
}

export async function revokeSession(pool: pg.Pool, token: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE auth_sessions
        SET revoked_at = now()
      WHERE token_hash = $1
        AND revoked_at IS NULL`,
    [tokenHash(token)],
  );
  return (result.rowCount ?? 0) > 0;
}
