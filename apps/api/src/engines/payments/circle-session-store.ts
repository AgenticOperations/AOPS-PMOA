import type pg from 'pg';
import { recordAuditEvent } from '../evidence/audit-writer.js';
import { conflict } from '../identity/errors.js';
import type {
  CircleConnectionRepository,
  StoredCircleChallenge,
  StoredCircleConnection,
} from './circle-connection-service.js';
import type { CircleSessionCiphertext } from './circle-session-crypto.js';

type CircleConnectionRow = {
  readonly circle_email_hash: string | null;
  readonly created_by_user_id: string;
  readonly expires_at: Date | null;
  readonly id: string;
  readonly org_id: string;
  readonly profile_ciphertext: string;
  readonly profile_iv: string;
  readonly profile_tag: string;
  readonly revision: number;
  readonly status: StoredCircleConnection['status'];
  readonly verified_at: Date | null;
};

type CircleChallengeRow = {
  readonly connection_id: string;
  readonly connection_revision: number;
  readonly expires_at: Date;
  readonly id: string;
  readonly org_id: string;
  readonly request_bundle_ciphertext: string;
  readonly request_bundle_iv: string;
  readonly request_bundle_tag: string;
  readonly status: StoredCircleChallenge['status'];
  readonly user_id: string;
};

function envelope(input: {
  readonly ciphertext: string;
  readonly iv: string;
  readonly revision: number;
  readonly tag: string;
}): CircleSessionCiphertext {
  return {
    algorithm: 'aes-256-gcm',
    ciphertext: input.ciphertext,
    iv: input.iv,
    mode: 'test',
    revision: input.revision,
    tag: input.tag,
  };
}

function connectionFromRow(row: CircleConnectionRow): StoredCircleConnection {
  return {
    createdByUserId: row.created_by_user_id,
    emailHash: row.circle_email_hash,
    encryptedProfile: envelope({
      ciphertext: row.profile_ciphertext,
      iv: row.profile_iv,
      revision: row.revision,
      tag: row.profile_tag,
    }),
    expiresAt: row.expires_at,
    id: row.id,
    orgId: row.org_id,
    revision: row.revision,
    status: row.status,
    verifiedAt: row.verified_at,
  };
}

function challengeFromRow(row: CircleChallengeRow): StoredCircleChallenge {
  return {
    connectionId: row.connection_id,
    connectionRevision: row.connection_revision,
    encryptedRequest: envelope({
      ciphertext: row.request_bundle_ciphertext,
      iv: row.request_bundle_iv,
      revision: row.connection_revision,
      tag: row.request_bundle_tag,
    }),
    expiresAt: row.expires_at,
    id: row.id,
    orgId: row.org_id,
    status: row.status,
    userId: row.user_id,
  };
}

async function transaction<T>(pool: pg.Pool, operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function translateUniqueEmail(error: unknown): never {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '23505'
  ) {
    throw conflict(
      'circle_email_already_connected',
      'This Circle email is already connected to another workspace.',
    );
  }
  throw error;
}

export function createPostgresCircleConnectionRepository(pool: pg.Pool): CircleConnectionRepository {
  return {
    disconnectConnection: async ({ actorUserId, connectionId, encryptedProfile, orgId, revision }) => {
      await transaction(pool, async (client) => {
        await client.query(
          `UPDATE circle_connection_challenges
              SET status = 'expired', updated_at = now()
            WHERE connection_id = $1 AND org_id = $2 AND status = 'pending'`,
          [connectionId, orgId],
        );
        const result = await client.query(
          `UPDATE circle_org_connections
              SET circle_email_hash = NULL,
                  profile_ciphertext = $3,
                  profile_iv = $4,
                  profile_tag = $5,
                  revision = $6,
                  status = 'disconnected',
                  verification_requested_at = NULL,
                  verified_at = NULL,
                  expires_at = NULL,
                  last_error_code = NULL,
                  updated_at = now()
            WHERE id = $1 AND org_id = $2 AND mode = 'test'`,
          [
            connectionId,
            orgId,
            encryptedProfile.ciphertext,
            encryptedProfile.iv,
            encryptedProfile.tag,
            revision,
          ],
        );
        if (result.rowCount !== 1) throw new Error('circle_connection_disconnect_conflict');
        await recordAuditEvent(client, {
          orgId,
          idempotencyKey: `circle.connection.disconnected:${connectionId}:${revision}`,
          eventType: 'circle.connection.disconnected',
          actor: { type: 'user', id: actorUserId },
          action: 'circle.connection.disconnected',
          outcome: 'success',
          resource: { type: 'circle_connection', id: connectionId },
          classification: {
            domain: 'treasury',
            category: 'security',
            severity: 'info',
            tags: ['section_9', 'circle', 'connection'],
          },
          source: { section: 'section_9', system: 'circle_worker' },
          retentionClass: 'security',
          payload: { mode: 'test', revision },
        });
      });
    },

    getConnection: async (orgId) => {
      const result = await pool.query<CircleConnectionRow>(
        `SELECT id, org_id, circle_email_hash, profile_ciphertext, profile_iv, profile_tag,
                revision, status, expires_at, verified_at, created_by_user_id
           FROM circle_org_connections
          WHERE org_id = $1 AND mode = 'test'
          LIMIT 1`,
        [orgId],
      );
      return result.rows[0] === undefined ? null : connectionFromRow(result.rows[0]);
    },

    getChallenge: async (challengeId) => {
      const result = await pool.query<CircleChallengeRow>(
        `SELECT id, org_id, user_id, connection_id, connection_revision,
                request_bundle_ciphertext, request_bundle_iv, request_bundle_tag,
                status, expires_at
           FROM circle_connection_challenges
          WHERE id = $1
          LIMIT 1`,
        [challengeId],
      );
      return result.rows[0] === undefined ? null : challengeFromRow(result.rows[0]);
    },

    getPendingChallenge: async (orgId, userId) => {
      const result = await pool.query<CircleChallengeRow>(
        `SELECT id, org_id, user_id, connection_id, connection_revision,
                request_bundle_ciphertext, request_bundle_iv, request_bundle_tag,
                status, expires_at
           FROM circle_connection_challenges
          WHERE org_id = $1
            AND ($2::text IS NULL OR user_id = $2)
            AND mode = 'test'
            AND status = 'pending'
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [orgId, userId ?? null],
      );
      return result.rows[0] === undefined ? null : challengeFromRow(result.rows[0]);
    },

    savePendingChallenge: async ({ challenge, connection }) => {
      try {
        await transaction(pool, async (client) => {
          await client.query(
            `UPDATE circle_connection_challenges
                SET status = 'expired', updated_at = now()
              WHERE org_id = $1 AND status = 'pending'`,
            [connection.orgId],
          );
          await client.query(
            `INSERT INTO circle_org_connections (
               id, org_id, mode, circle_email_hash, profile_ciphertext, profile_iv,
               profile_tag, revision, status, verification_requested_at,
               expires_at, verified_at, last_error_code, created_by_user_id
             )
             VALUES ($1, $2, 'test', $3, $4, $5, $6, $7, 'otp_pending', now(), NULL, NULL, NULL, $8)
             ON CONFLICT (org_id, mode)
             DO UPDATE SET circle_email_hash = EXCLUDED.circle_email_hash,
                           profile_ciphertext = EXCLUDED.profile_ciphertext,
                           profile_iv = EXCLUDED.profile_iv,
                           profile_tag = EXCLUDED.profile_tag,
                           revision = EXCLUDED.revision,
                           status = 'otp_pending',
                           verification_requested_at = now(),
                           expires_at = NULL,
                           verified_at = NULL,
                           last_error_code = NULL,
                           updated_at = now()`,
            [
              connection.id,
              connection.orgId,
              connection.emailHash,
              connection.encryptedProfile.ciphertext,
              connection.encryptedProfile.iv,
              connection.encryptedProfile.tag,
              connection.revision,
              connection.createdByUserId,
            ],
          );
          await client.query(
            `INSERT INTO circle_connection_challenges (
               id, org_id, user_id, connection_id, mode,
               request_bundle_ciphertext, request_bundle_iv, request_bundle_tag,
               connection_revision, status, expires_at
             )
             VALUES ($1, $2, $3, $4, 'test', $5, $6, $7, $8, 'pending', $9)`,
            [
              challenge.id,
              challenge.orgId,
              challenge.userId,
              challenge.connectionId,
              challenge.encryptedRequest.ciphertext,
              challenge.encryptedRequest.iv,
              challenge.encryptedRequest.tag,
              challenge.connectionRevision,
              challenge.expiresAt,
            ],
          );
          await recordAuditEvent(client, {
            orgId: connection.orgId,
            idempotencyKey: `circle.connection.verification_requested:${challenge.id}`,
            eventType: 'circle.connection.verification_requested',
            actor: { type: 'user', id: challenge.userId },
            action: 'circle.connection.verification_requested',
            outcome: 'pending',
            resource: { type: 'circle_connection', id: connection.id },
            classification: {
              domain: 'treasury',
              category: 'security',
              severity: 'info',
              tags: ['section_9', 'circle', 'connection'],
            },
            source: { section: 'section_9', system: 'circle_worker' },
            retentionClass: 'security',
            payload: { challenge_id: challenge.id, mode: 'test', revision: connection.revision },
          });
        });
      } catch (error) {
        translateUniqueEmail(error);
      }
    },

    saveVerifiedConnection: async ({ actorUserId, challengeId, connection }) => {
      await transaction(pool, async (client) => {
        await client.query(
          `UPDATE circle_org_connections
              SET profile_ciphertext = $3,
                  profile_iv = $4,
                  profile_tag = $5,
                  status = 'connected',
                  verified_at = $6,
                  expires_at = $7,
                  last_error_code = NULL,
                  updated_at = now()
            WHERE id = $1 AND org_id = $2 AND mode = 'test' AND revision = $8`,
          [
            connection.id,
            connection.orgId,
            connection.encryptedProfile.ciphertext,
            connection.encryptedProfile.iv,
            connection.encryptedProfile.tag,
            connection.verifiedAt,
            connection.expiresAt,
            connection.revision,
          ],
        );
        await client.query(
          `UPDATE circle_connection_challenges
              SET status = 'verified', verified_at = now(), updated_at = now()
            WHERE id = $1 AND connection_id = $2 AND status = 'pending'`,
          [challengeId, connection.id],
        );
        await recordAuditEvent(client, {
          orgId: connection.orgId,
          idempotencyKey: `circle.connection.verified:${challengeId}`,
          eventType: 'circle.connection.verified',
          actor: { type: 'user', id: actorUserId },
          action: 'circle.connection.verified',
          outcome: 'success',
          resource: { type: 'circle_connection', id: connection.id },
          classification: {
            domain: 'treasury',
            category: 'security',
            severity: 'info',
            tags: ['section_9', 'circle', 'connection'],
          },
          source: { section: 'section_9', system: 'circle_worker' },
          retentionClass: 'security',
          payload: { mode: 'test', revision: connection.revision },
        });
      });
    },

    saveSessionProfile: async ({ connectionId, encryptedProfile, orgId, revision }) => {
      const result = await pool.query(
        `UPDATE circle_org_connections
            SET profile_ciphertext = $4,
                profile_iv = $5,
                profile_tag = $6,
                updated_at = now()
          WHERE id = $1
            AND org_id = $2
            AND mode = 'test'
            AND revision = $3
            AND status = 'connected'`,
        [
          connectionId,
          orgId,
          revision,
          encryptedProfile.ciphertext,
          encryptedProfile.iv,
          encryptedProfile.tag,
        ],
      );
      if (result.rowCount !== 1) throw new Error('circle_connection_profile_update_conflict');
    },

    saveFailedChallenge: async ({ challengeId, connectionId, errorCode, orgId, userId }) => {
      await transaction(pool, async (client) => {
        await client.query(
          `UPDATE circle_connection_challenges
              SET status = 'failed', failed_at = now(), attempt_count = attempt_count + 1, updated_at = now()
            WHERE id = $1 AND connection_id = $2 AND status = 'pending'`,
          [challengeId, connectionId],
        );
        await client.query(
          `UPDATE circle_org_connections
              SET status = 'disconnected', last_error_code = $2, updated_at = now()
            WHERE id = $1 AND status = 'otp_pending'`,
          [connectionId, errorCode],
        );
        await recordAuditEvent(client, {
          orgId,
          idempotencyKey: `circle.connection.verification_failed:${challengeId}`,
          eventType: 'circle.connection.verification_failed',
          actor: { type: 'user', id: userId },
          action: 'circle.connection.verification_failed',
          outcome: 'error',
          reasonCode: errorCode,
          resource: { type: 'circle_connection', id: connectionId },
          classification: {
            domain: 'treasury',
            category: 'security',
            severity: 'warning',
            tags: ['section_9', 'circle', 'connection'],
          },
          source: { section: 'section_9', system: 'circle_worker' },
          retentionClass: 'security',
          payload: { mode: 'test' },
        });
      });
    },
  };
}
