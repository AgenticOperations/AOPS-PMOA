import { createHmac } from 'node:crypto';
import { prefixedId } from '../identity/ids.js';
import type { CircleAgentCliExecutor } from './circle-agent-cli.js';
import {
  decryptCircleSessionJson,
  encryptCircleSessionJson,
  type CircleSessionCiphertext,
} from './circle-session-crypto.js';
import {
  withCircleProfileWorkspace,
  type CircleProfileBundle,
} from './circle-profile-workspace.js';

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CircleConnectionStatus = 'disconnected' | 'otp_pending' | 'connected' | 'expired' | 'blocked';
export type CircleChallengeStatus = 'pending' | 'verified' | 'expired' | 'failed' | 'blocked';

export type StoredCircleConnection = {
  readonly createdByUserId: string;
  readonly emailHash: string | null;
  readonly encryptedProfile: CircleSessionCiphertext;
  readonly expiresAt: Date | null;
  readonly id: string;
  readonly orgId: string;
  readonly revision: number;
  readonly status: CircleConnectionStatus;
  readonly verifiedAt: Date | null;
};

export type StoredCircleChallenge = {
  readonly connectionId: string;
  readonly connectionRevision: number;
  readonly encryptedRequest: CircleSessionCiphertext;
  readonly expiresAt: Date;
  readonly id: string;
  readonly orgId: string;
  readonly status: CircleChallengeStatus;
  readonly userId: string;
};

export type CircleConnectionRepository = {
  readonly disconnectConnection: (input: {
    readonly actorUserId: string;
    readonly connectionId: string;
    readonly encryptedProfile: CircleSessionCiphertext;
    readonly orgId: string;
    readonly revision: number;
  }) => Promise<void>;
  readonly getChallenge: (challengeId: string) => Promise<StoredCircleChallenge | null>;
  readonly getPendingChallenge: (orgId: string, userId?: string) => Promise<StoredCircleChallenge | null>;
  readonly getConnection: (orgId: string) => Promise<StoredCircleConnection | null>;
  readonly saveFailedChallenge: (input: {
    readonly challengeId: string;
    readonly connectionId: string;
    readonly errorCode: string;
    readonly orgId: string;
    readonly userId: string;
  }) => Promise<void>;
  readonly savePendingChallenge: (input: {
    readonly challenge: StoredCircleChallenge;
    readonly connection: StoredCircleConnection;
  }) => Promise<void>;
  readonly saveSessionProfile: (input: {
    readonly connectionId: string;
    readonly encryptedProfile: CircleSessionCiphertext;
    readonly orgId: string;
    readonly revision: number;
  }) => Promise<void>;
  readonly saveVerifiedConnection: (input: {
    readonly actorUserId: string;
    readonly challengeId: string;
    readonly connection: StoredCircleConnection;
  }) => Promise<void>;
};

type StoredProfile = {
  readonly bundle: CircleProfileBundle;
  readonly email: string;
};

type StoredRequest = {
  readonly requestId: string;
};

type CircleConnectionServiceOptions = {
  readonly executorFactory: (environment: NodeJS.ProcessEnv) => CircleAgentCliExecutor;
  readonly masterKeyBase64: string;
  readonly now?: (() => Date) | undefined;
  readonly repository: CircleConnectionRepository;
};

type ConnectionResult = {
  readonly challengeId?: string | undefined;
  readonly email: string;
  readonly expiresAt: string | null;
  readonly status: CircleConnectionStatus;
};

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('circle_connection_email_invalid');
  return email;
}

function emailHash(email: string, masterKeyBase64: string): string {
  return createHmac('sha256', Buffer.from(masterKeyBase64, 'base64'))
    .update(`circle-email:${email}`)
    .digest('hex');
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('circle_')) return error.message;
  return 'circle_connection_login_failed';
}

export function createCircleConnectionService(options: CircleConnectionServiceOptions) {
  const now = options.now ?? (() => new Date());

  return {
    disconnect: async (input: { readonly orgId: string; readonly userId: string }): Promise<ConnectionResult> => {
      const connection = await options.repository.getConnection(input.orgId);
      if (connection === null) return { email: '', expiresAt: null, status: 'disconnected' };
      const revision = connection.revision + 1;
      const encryptedProfile = encryptCircleSessionJson({
        masterKeyBase64: options.masterKeyBase64,
        orgId: input.orgId,
        revision,
        value: {
          bundle: { files: {}, version: 1 },
          email: '',
        } satisfies StoredProfile,
      });
      await options.repository.disconnectConnection({
        actorUserId: input.userId,
        connectionId: connection.id,
        encryptedProfile,
        orgId: input.orgId,
        revision,
      });
      return { email: '', expiresAt: null, status: 'disconnected' };
    },

    withConnectedExecutor: async <T>(
      input: { readonly orgId: string },
      operation: (executor: CircleAgentCliExecutor) => Promise<T>,
    ): Promise<T> => {
      const connection = await options.repository.getConnection(input.orgId);
      if (
        connection === null ||
        connection.status !== 'connected' ||
        connection.expiresAt === null ||
        connection.expiresAt.getTime() <= now().getTime()
      ) {
        throw new Error('circle_connection_required');
      }
      const stored = decryptCircleSessionJson<StoredProfile>({
        encrypted: connection.encryptedProfile,
        masterKeyBase64: options.masterKeyBase64,
        orgId: input.orgId,
        revision: connection.revision,
      });
      const workspace = await withCircleProfileWorkspace(stored.bundle, async ({ environment }) => (
        operation(options.executorFactory(environment))
      ));
      const encryptedProfile = encryptCircleSessionJson({
        masterKeyBase64: options.masterKeyBase64,
        orgId: input.orgId,
        revision: connection.revision,
        value: { bundle: workspace.bundle, email: stored.email } satisfies StoredProfile,
      });
      await options.repository.saveSessionProfile({
        connectionId: connection.id,
        encryptedProfile,
        orgId: input.orgId,
        revision: connection.revision,
      });
      return workspace.result;
    },

    status: async (input: { readonly orgId: string; readonly userId?: string | undefined }): Promise<ConnectionResult> => {
      const connection = await options.repository.getConnection(input.orgId);
      if (connection === null) return { email: '', expiresAt: null, status: 'disconnected' };
      let stored: StoredProfile;
      try {
        stored = decryptCircleSessionJson<StoredProfile>({
          encrypted: connection.encryptedProfile,
          masterKeyBase64: options.masterKeyBase64,
          orgId: input.orgId,
          revision: connection.revision,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'circle_session_decryption_failed') {
          return { email: '', expiresAt: null, status: 'blocked' };
        }
        throw error;
      }
      const timestamp = now();
      const pendingChallenge = connection.status === 'otp_pending'
        ? await options.repository.getPendingChallenge(input.orgId)
        : null;
      const currentPendingChallenge = pendingChallenge !== null &&
        pendingChallenge.connectionId === connection.id &&
        pendingChallenge.connectionRevision === connection.revision
        ? pendingChallenge
        : null;
      const pendingChallengeIsLive = currentPendingChallenge !== null &&
        currentPendingChallenge.expiresAt.getTime() > timestamp.getTime();
      const status = (
        connection.status === 'connected' &&
        connection.expiresAt !== null &&
        connection.expiresAt.getTime() <= timestamp.getTime()
      ) || (connection.status === 'otp_pending' && !pendingChallengeIsLive)
        ? 'expired'
        : connection.status;
      const challengeId = status === 'otp_pending' &&
        currentPendingChallenge !== null &&
        currentPendingChallenge.userId === input.userId
        ? currentPendingChallenge.id
        : undefined;
      return {
        ...(challengeId === undefined ? {} : { challengeId }),
        email: stored.email,
        expiresAt: connection.expiresAt?.toISOString() ?? null,
        status,
      };
    },

    initialize: async (input: { readonly email: string; readonly orgId: string; readonly userId: string }) => {
      const email = normalizeEmail(input.email);
      const existing = await options.repository.getConnection(input.orgId);
      let existingBundle: CircleProfileBundle | null = null;
      if (existing !== null) {
        let stored: StoredProfile | null = null;
        try {
          stored = decryptCircleSessionJson<StoredProfile>({
            encrypted: existing.encryptedProfile,
            masterKeyBase64: options.masterKeyBase64,
            orgId: input.orgId,
            revision: existing.revision,
          });
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'circle_session_decryption_failed') throw error;
        }
        if (stored !== null) {
          const timestamp = now();
          if (
            existing.status === 'connected' &&
            existing.expiresAt !== null &&
            existing.expiresAt.getTime() > timestamp.getTime()
          ) {
            throw new Error('circle_connection_already_connected');
          }
          if (existing.status === 'otp_pending') {
            const pendingChallenge = await options.repository.getPendingChallenge(input.orgId);
            const pendingChallengeIsLive = pendingChallenge !== null &&
              pendingChallenge.connectionId === existing.id &&
              pendingChallenge.connectionRevision === existing.revision &&
              pendingChallenge.expiresAt.getTime() > timestamp.getTime();
            if (pendingChallengeIsLive) {
              if (pendingChallenge.userId === input.userId && stored.email === email) {
                return { challengeId: pendingChallenge.id, email, status: 'otp_pending' as const };
              }
              throw new Error('circle_connection_verification_in_progress');
            }
          }
          if (stored.email === email) existingBundle = stored.bundle;
        }
      }
      const revision = (existing?.revision ?? 0) + 1;

      const workspace = await withCircleProfileWorkspace(existingBundle, async ({ environment }) => {
        const executor = options.executorFactory(environment);
        return executor.initializeLogin({ email, mode: 'test' });
      });
      const connectionId = existing?.id ?? prefixedId('ccn');
      const challengeId = prefixedId('cch');
      const timestamp = now();
      const connection: StoredCircleConnection = {
        createdByUserId: input.userId,
        emailHash: emailHash(email, options.masterKeyBase64),
        encryptedProfile: encryptCircleSessionJson({
          masterKeyBase64: options.masterKeyBase64,
          orgId: input.orgId,
          revision,
          value: { bundle: workspace.bundle, email } satisfies StoredProfile,
        }),
        expiresAt: null,
        id: connectionId,
        orgId: input.orgId,
        revision,
        status: 'otp_pending',
        verifiedAt: null,
      };
      const challenge: StoredCircleChallenge = {
        connectionId,
        connectionRevision: revision,
        encryptedRequest: encryptCircleSessionJson({
          masterKeyBase64: options.masterKeyBase64,
          orgId: input.orgId,
          revision,
          value: { requestId: workspace.result.requestId } satisfies StoredRequest,
        }),
        expiresAt: new Date(timestamp.getTime() + CHALLENGE_TTL_MS),
        id: challengeId,
        orgId: input.orgId,
        status: 'pending',
        userId: input.userId,
      };
      await options.repository.savePendingChallenge({ challenge, connection });
      return { challengeId, email, status: 'otp_pending' as const };
    },

    complete: async (input: {
      readonly challengeId: string;
      readonly orgId: string;
      readonly otp: string;
      readonly userId: string;
    }): Promise<ConnectionResult> => {
      const challenge = await options.repository.getChallenge(input.challengeId);
      if (
        challenge === null ||
        challenge.orgId !== input.orgId ||
        challenge.userId !== input.userId ||
        challenge.status !== 'pending' ||
        challenge.expiresAt.getTime() <= now().getTime()
      ) {
        throw new Error('circle_connection_challenge_not_found');
      }
      const connection = await options.repository.getConnection(input.orgId);
      if (
        connection === null ||
        connection.id !== challenge.connectionId ||
        connection.revision !== challenge.connectionRevision ||
        connection.status !== 'otp_pending'
      ) {
        throw new Error('circle_connection_challenge_not_found');
      }

      const storedProfile = decryptCircleSessionJson<StoredProfile>({
        encrypted: connection.encryptedProfile,
        masterKeyBase64: options.masterKeyBase64,
        orgId: input.orgId,
        revision: connection.revision,
      });
      const storedRequest = decryptCircleSessionJson<StoredRequest>({
        encrypted: challenge.encryptedRequest,
        masterKeyBase64: options.masterKeyBase64,
        orgId: input.orgId,
        revision: connection.revision,
      });

      try {
        const workspace = await withCircleProfileWorkspace(storedProfile.bundle, async ({ environment }) => {
          const executor = options.executorFactory(environment);
          const completed = await executor.completeLogin({ otp: input.otp, requestId: storedRequest.requestId });
          const status = await executor.status();
          return { completed, status };
        });
        const completedEmail = normalizeEmail(workspace.result.completed.email);
        const sessionEmail = workspace.result.status.test.email === null
          ? null
          : normalizeEmail(workspace.result.status.test.email);
        if (
          completedEmail !== storedProfile.email ||
          sessionEmail !== storedProfile.email ||
          workspace.result.status.test.tokenStatus !== 'VALID'
        ) {
          throw new Error('circle_session_email_mismatch');
        }

        const verifiedAt = now();
        const expiresAt = new Date(verifiedAt.getTime() + SESSION_TTL_MS);
        const verifiedConnection: StoredCircleConnection = {
          ...connection,
          encryptedProfile: encryptCircleSessionJson({
            masterKeyBase64: options.masterKeyBase64,
            orgId: input.orgId,
            revision: connection.revision,
            value: { bundle: workspace.bundle, email: storedProfile.email } satisfies StoredProfile,
          }),
          expiresAt,
          status: 'connected',
          verifiedAt,
        };
        await options.repository.saveVerifiedConnection({
          actorUserId: input.userId,
          challengeId: challenge.id,
          connection: verifiedConnection,
        });
        return { email: storedProfile.email, expiresAt: expiresAt.toISOString(), status: 'connected' };
      } catch (error) {
        await options.repository.saveFailedChallenge({
          challengeId: challenge.id,
          connectionId: connection.id,
          errorCode: errorCode(error),
          orgId: input.orgId,
          userId: input.userId,
        });
        throw error;
      }
    },
  };
}

export type CircleConnectionService = ReturnType<typeof createCircleConnectionService>;
