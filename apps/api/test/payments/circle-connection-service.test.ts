import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createCircleConnectionService,
  type CircleConnectionRepository,
  type StoredCircleChallenge,
  type StoredCircleConnection,
} from '../../src/engines/payments/circle-connection-service.js';
import type { CircleAgentCliExecutor } from '../../src/engines/payments/circle-agent-cli.js';

function repository(): CircleConnectionRepository & {
  challenge: StoredCircleChallenge | null;
  connection: StoredCircleConnection | null;
} {
  const state = {
    challenge: null as StoredCircleChallenge | null,
    connection: null as StoredCircleConnection | null,
  };
  return {
    disconnectConnection: vi.fn((input: Parameters<CircleConnectionRepository['disconnectConnection']>[0]) => {
      if (state.connection !== null) {
        state.connection = {
          ...state.connection,
          emailHash: null,
          encryptedProfile: input.encryptedProfile,
          expiresAt: null,
          revision: input.revision,
          status: 'disconnected',
          verifiedAt: null,
        };
      }
      return Promise.resolve();
    }),
    getChallenge: vi.fn(() => Promise.resolve(state.challenge)),
    getPendingChallenge: vi.fn((orgId: string, userId?: string) => Promise.resolve(
      state.challenge?.orgId === orgId &&
      (userId === undefined || state.challenge.userId === userId) &&
      state.challenge.status === 'pending'
        ? state.challenge
        : null,
    )),
    getConnection: vi.fn(() => Promise.resolve(state.connection)),
    saveFailedChallenge: vi.fn(() => {
      if (state.challenge !== null) state.challenge = { ...state.challenge, status: 'failed' };
      return Promise.resolve();
    }),
    savePendingChallenge: vi.fn((input: Parameters<CircleConnectionRepository['savePendingChallenge']>[0]) => {
      state.connection = input.connection;
      state.challenge = input.challenge;
      return Promise.resolve();
    }),
    saveSessionProfile: vi.fn((input: Parameters<CircleConnectionRepository['saveSessionProfile']>[0]) => {
      if (state.connection !== null) {
        state.connection = { ...state.connection, encryptedProfile: input.encryptedProfile };
      }
      return Promise.resolve();
    }),
    saveVerifiedConnection: vi.fn((input: Parameters<CircleConnectionRepository['saveVerifiedConnection']>[0]) => {
      state.connection = input.connection;
      if (state.challenge !== null) state.challenge = { ...state.challenge, status: 'verified' };
      return Promise.resolve();
    }),
    ...state,
    get challenge() { return state.challenge; },
    set challenge(value) { state.challenge = value; },
    get connection() { return state.connection; },
    set connection(value) { state.connection = value; },
  };
}

function executor(overrides: Partial<CircleAgentCliExecutor> = {}): CircleAgentCliExecutor {
  return {
    bridgeUsdc: vi.fn(),
    completeLogin: vi.fn(() => Promise.resolve({ email: 'owner@example.com' })),
    executeContract: vi.fn(),
    fundTestnetUsdc: vi.fn(),
    gatewayBalance: vi.fn(),
    gatewayDepositDirect: vi.fn(),
    gatewayDepositEco: vi.fn(),
    initializeLogin: vi.fn(() => Promise.resolve({
      email: 'owner@example.com',
      requestId: '68c34a64-bf7a-4ca5-a2ac-125cab514bc9',
    })),
    listWallet: vi.fn(),
    payService: vi.fn(),
    status: vi.fn(() => Promise.resolve({
      live: { email: null, expiresIn: null, tokenStatus: 'UNKNOWN' },
      test: { email: 'owner@example.com', expiresIn: '7d', tokenStatus: 'VALID' },
    })),
    transferUsdc: vi.fn(),
    walletBalance: vi.fn(),
    ...overrides,
  };
}

function service(
  repo: CircleConnectionRepository,
  circleExecutor: CircleAgentCliExecutor,
  masterKeyBase64 = randomBytes(32).toString('base64'),
) {
  return createCircleConnectionService({
    executorFactory: () => circleExecutor,
    masterKeyBase64,
    now: () => new Date('2026-07-11T12:00:00.000Z'),
    repository: repo,
  });
}

describe('Circle connection service', () => {
  it('initializes a testnet login and persists only encrypted profile and request data', async () => {
    const repo = repository();
    const circleExecutor = executor();

    const result = await service(repo, circleExecutor).initialize({
      email: ' Owner@Example.com ',
      orgId: 'org_1',
      userId: 'usr_1',
    });

    expect(result).toMatchObject({ email: 'owner@example.com', status: 'otp_pending' });
    expect(result.challengeId).toMatch(/^cch_/);
    expect(repo.connection).toMatchObject({ orgId: 'org_1', revision: 1, status: 'otp_pending' });
    expect(repo.challenge).toMatchObject({ orgId: 'org_1', status: 'pending', userId: 'usr_1' });
    expect(JSON.stringify(repo.connection)).not.toContain('owner@example.com');
    expect(JSON.stringify(repo.challenge)).not.toContain('68c34a64-bf7a-4ca5-a2ac-125cab514bc9');
  });

  it('reuses the same live OTP challenge for an idempotent initialization retry', async () => {
    const repo = repository();
    const circleExecutor = executor();
    const connectionService = service(repo, circleExecutor);
    const first = await connectionService.initialize({
      email: 'owner@example.com',
      orgId: 'org_1',
      userId: 'usr_1',
    });

    const second = await connectionService.initialize({
      email: 'owner@example.com',
      orgId: 'org_1',
      userId: 'usr_1',
    });

    expect(second).toEqual(first);
    expect(repo.connection?.revision).toBe(1);
    expect(circleExecutor.initializeLogin).toHaveBeenCalledOnce();
  });

  it('rejects a competing initialization while another live OTP challenge exists', async () => {
    const repo = repository();
    const circleExecutor = executor();
    const connectionService = service(repo, circleExecutor);
    await connectionService.initialize({ email: 'owner@example.com', orgId: 'org_1', userId: 'usr_1' });

    await expect(connectionService.initialize({
      email: 'other@example.com',
      orgId: 'org_1',
      userId: 'usr_2',
    })).rejects.toThrow('circle_connection_verification_in_progress');
    expect(repo.connection?.revision).toBe(1);
    expect(circleExecutor.initializeLogin).toHaveBeenCalledOnce();
  });

  it('does not replace an active connected profile without explicit disconnect', async () => {
    const repo = repository();
    const circleExecutor = executor();
    const connectionService = service(repo, circleExecutor);
    const initialized = await connectionService.initialize({
      email: 'owner@example.com',
      orgId: 'org_1',
      userId: 'usr_1',
    });
    await connectionService.complete({
      challengeId: initialized.challengeId,
      orgId: 'org_1',
      otp: 'ABC-123456',
      userId: 'usr_1',
    });

    await expect(connectionService.initialize({
      email: 'owner@example.com',
      orgId: 'org_1',
      userId: 'usr_1',
    })).rejects.toThrow('circle_connection_already_connected');
    expect(repo.connection).toMatchObject({ revision: 1, status: 'connected' });
    expect(circleExecutor.initializeLogin).toHaveBeenCalledOnce();
  });

  it('reports an expired pending challenge and allows a new initialization', async () => {
    const repo = repository();
    const circleExecutor = executor();
    const connectionService = service(repo, circleExecutor);
    const first = await connectionService.initialize({
      email: 'owner@example.com',
      orgId: 'org_1',
      userId: 'usr_1',
    });
    if (repo.challenge === null) throw new Error('expected challenge');
    repo.challenge = { ...repo.challenge, expiresAt: new Date('2026-07-11T11:59:59.000Z') };

    await expect(connectionService.status({ orgId: 'org_1', userId: 'usr_1' })).resolves.toEqual({
      email: 'owner@example.com',
      expiresAt: null,
      status: 'expired',
    });

    const second = await connectionService.initialize({
      email: 'owner@example.com',
      orgId: 'org_1',
      userId: 'usr_1',
    });
    expect(second.challengeId).not.toBe(first.challengeId);
    expect(repo.connection?.revision).toBe(2);
    expect(circleExecutor.initializeLogin).toHaveBeenCalledTimes(2);
  });

  it('completes the OTP challenge and verifies the Circle session belongs to the requested email', async () => {
    const repo = repository();
    const circleExecutor = executor();
    const connectionService = service(repo, circleExecutor);
    const initialized = await connectionService.initialize({ email: 'owner@example.com', orgId: 'org_1', userId: 'usr_1' });

    const connected = await connectionService.complete({
      challengeId: initialized.challengeId,
      orgId: 'org_1',
      otp: 'ABC-123456',
      userId: 'usr_1',
    });

    expect(connected).toMatchObject({ email: 'owner@example.com', status: 'connected' });
    expect(repo.connection).toMatchObject({ status: 'connected' });
    expect(repo.challenge?.status).toBe('verified');
    expect(circleExecutor.completeLogin).toHaveBeenCalledWith({
      otp: 'ABC-123456',
      requestId: '68c34a64-bf7a-4ca5-a2ac-125cab514bc9',
    });
  });

  it('fails closed when the completed Circle session email does not match', async () => {
    const repo = repository();
    const circleExecutor = executor({
      status: vi.fn(() => Promise.resolve({
        live: { email: null, expiresIn: null, tokenStatus: 'UNKNOWN' },
        test: { email: 'attacker@example.com', expiresIn: '7d', tokenStatus: 'VALID' },
      })),
    });
    const connectionService = service(repo, circleExecutor);
    const initialized = await connectionService.initialize({ email: 'owner@example.com', orgId: 'org_1', userId: 'usr_1' });

    await expect(connectionService.complete({
      challengeId: initialized.challengeId,
      orgId: 'org_1',
      otp: 'ABC-123456',
      userId: 'usr_1',
    })).rejects.toThrow('circle_session_email_mismatch');
    expect(repo.challenge?.status).toBe('failed');
  });

  it('does not allow a different user or organization to complete the challenge', async () => {
    const repo = repository();
    const connectionService = service(repo, executor());
    const initialized = await connectionService.initialize({ email: 'owner@example.com', orgId: 'org_1', userId: 'usr_1' });

    await expect(connectionService.complete({
      challengeId: initialized.challengeId,
      orgId: 'org_2',
      otp: 'ABC-123456',
      userId: 'usr_1',
    })).rejects.toThrow('circle_connection_challenge_not_found');

    await expect(connectionService.complete({
      challengeId: initialized.challengeId,
      orgId: 'org_1',
      otp: 'ABC-123456',
      userId: 'usr_2',
    })).rejects.toThrow('circle_connection_challenge_not_found');
  });

  it('returns a redacted connection status without exposing encrypted session material', async () => {
    const repo = repository();
    const connectionService = service(repo, executor());
    const initialized = await connectionService.initialize({ email: 'owner@example.com', orgId: 'org_1', userId: 'usr_1' });
    await connectionService.complete({ challengeId: initialized.challengeId, orgId: 'org_1', otp: 'ABC-123456', userId: 'usr_1' });

    const status = await connectionService.status({ orgId: 'org_1' });

    expect(status).toMatchObject({ email: 'owner@example.com', status: 'connected' });
    expect(JSON.stringify(status)).not.toContain('ciphertext');
    expect(JSON.stringify(status)).not.toContain('session.json');
  });

  it('resumes the same user pending OTP challenge after the service is recreated', async () => {
    const repo = repository();
    const key = randomBytes(32).toString('base64');
    const initialized = await service(repo, executor(), key).initialize({
      email: 'owner@example.com',
      orgId: 'org_1',
      userId: 'usr_1',
    });

    const restartedService = service(repo, executor(), key);
    const status = await restartedService.status({ orgId: 'org_1', userId: 'usr_1' });

    expect(status).toEqual({
      challengeId: initialized.challengeId,
      email: 'owner@example.com',
      expiresAt: null,
      status: 'otp_pending',
    });
  });

  it('fails closed with a recoverable blocked status when stored session material is unreadable', async () => {
    const repo = repository();
    const oldKey = randomBytes(32).toString('base64');
    const newKey = randomBytes(32).toString('base64');
    await service(repo, executor(), oldKey).initialize({
      email: 'owner@example.com',
      orgId: 'org_1',
      userId: 'usr_1',
    });

    const status = await service(repo, executor(), newKey).status({ orgId: 'org_1' });

    expect(status).toEqual({ email: '', expiresAt: null, status: 'blocked' });
  });

  it('restarts verification with the current key when the stored profile is blocked', async () => {
    const repo = repository();
    const oldKey = randomBytes(32).toString('base64');
    const newKey = randomBytes(32).toString('base64');
    await service(repo, executor(), oldKey).initialize({
      email: 'owner@example.com',
      orgId: 'org_1',
      userId: 'usr_1',
    });
    const currentExecutor = executor();

    const initialized = await service(repo, currentExecutor, newKey).initialize({
      email: 'owner@example.com',
      orgId: 'org_1',
      userId: 'usr_1',
    });

    expect(initialized).toMatchObject({ email: 'owner@example.com', status: 'otp_pending' });
    expect(repo.connection).toMatchObject({ revision: 2, status: 'otp_pending' });
    expect(repo.challenge).toMatchObject({ connectionRevision: 2, status: 'pending' });
    expect(currentExecutor.initializeLogin).toHaveBeenCalledOnce();
  });

  it('executes provider work only through the connected org profile', async () => {
    const repo = repository();
    const circleExecutor = executor();
    const connectionService = service(repo, circleExecutor);
    const initialized = await connectionService.initialize({ email: 'owner@example.com', orgId: 'org_1', userId: 'usr_1' });
    await connectionService.complete({ challengeId: initialized.challengeId, orgId: 'org_1', otp: 'ABC-123456', userId: 'usr_1' });

    const result = await connectionService.withConnectedExecutor({ orgId: 'org_1' }, (scopedExecutor) => {
      expect(scopedExecutor).toBe(circleExecutor);
      return Promise.resolve('executed');
    });

    expect(result).toBe('executed');
    expect(repo.saveSessionProfile).toHaveBeenCalledOnce();
  });

  it('rejects provider work for an organization without a connected session', async () => {
    const repo = repository();

    await expect(service(repo, executor()).withConnectedExecutor({ orgId: 'org_missing' }, () => Promise.resolve(null)))
      .rejects.toThrow('circle_connection_required');
  });

  it('disconnects by replacing session material and disabling further execution', async () => {
    const repo = repository();
    const connectionService = service(repo, executor());
    const initialized = await connectionService.initialize({ email: 'owner@example.com', orgId: 'org_1', userId: 'usr_1' });
    await connectionService.complete({ challengeId: initialized.challengeId, orgId: 'org_1', otp: 'ABC-123456', userId: 'usr_1' });
    const connectedCiphertext = repo.connection?.encryptedProfile.ciphertext;

    const result = await connectionService.disconnect({ orgId: 'org_1', userId: 'usr_1' });

    expect(result).toEqual({ email: '', expiresAt: null, status: 'disconnected' });
    expect(repo.connection).toMatchObject({ emailHash: null, revision: 2, status: 'disconnected' });
    expect(repo.connection?.encryptedProfile.ciphertext).not.toBe(connectedCiphertext);
    await expect(connectionService.withConnectedExecutor({ orgId: 'org_1' }, () => Promise.resolve(null)))
      .rejects.toThrow('circle_connection_required');
  });
});
