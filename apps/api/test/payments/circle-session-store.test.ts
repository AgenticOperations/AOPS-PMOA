import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CircleAgentCliExecutor } from '../../src/engines/payments/circle-agent-cli.js';
import { createCircleConnectionService } from '../../src/engines/payments/circle-connection-service.js';
import { createPostgresCircleConnectionRepository } from '../../src/engines/payments/circle-session-store.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

function executor(): CircleAgentCliExecutor {
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
  };
}

describe('Postgres Circle connection persistence', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ('org_circle_restart', 'Circle Restart')");
    await store.pool.query(
      "INSERT INTO users (id, email, name) VALUES ('usr_circle_restart', 'owner@example.com', 'Owner')",
    );
    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ('org_circle_audit', 'Circle Audit')");
    await store.pool.query(
      "INSERT INTO users (id, email, name) VALUES ('usr_circle_audit', 'audit@example.com', 'Audit Owner')",
    );
    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ('org_circle_idem', 'Circle Idempotency')");
    await store.pool.query(
      "INSERT INTO users (id, email, name) VALUES ('usr_circle_idem', 'idem@example.com', 'Idempotent Owner')",
    );
    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ('org_circle_failure', 'Circle Failure')");
    await store.pool.query(
      "INSERT INTO users (id, email, name) VALUES ('usr_circle_failure', 'failure@example.com', 'Failure Owner')",
    );
    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ('org_circle_recovery', 'Circle Recovery')");
    await store.pool.query(
      "INSERT INTO users (id, email, name) VALUES ('usr_circle_recovery', 'recovery@example.com', 'Recovery Owner')",
    );
  }, 90_000);

  afterAll(async () => {
    await store.stop();
  });

  it('restores a connected encrypted profile after service recreation', async () => {
    const key = randomBytes(32).toString('base64');
    const circleExecutor = executor();
    const repository = createPostgresCircleConnectionRepository(store.pool);
    const firstService = createCircleConnectionService({
      executorFactory: () => circleExecutor,
      masterKeyBase64: key,
      repository,
    });
    const initialized = await firstService.initialize({
      email: 'owner@example.com',
      orgId: 'org_circle_restart',
      userId: 'usr_circle_restart',
    });
    await firstService.complete({
      challengeId: initialized.challengeId,
      orgId: 'org_circle_restart',
      otp: 'ABC-123456',
      userId: 'usr_circle_restart',
    });

    const restartedService = createCircleConnectionService({
      executorFactory: () => circleExecutor,
      masterKeyBase64: key,
      repository: createPostgresCircleConnectionRepository(store.pool),
    });

    await expect(restartedService.status({ orgId: 'org_circle_restart' })).resolves.toMatchObject({
      email: 'owner@example.com',
      status: 'connected',
    });
    await expect(restartedService.withConnectedExecutor(
      { orgId: 'org_circle_restart' },
      () => Promise.resolve('executed'),
    )).resolves.toBe('executed');
  });

  it('restarts verification under the current key when a persisted profile is unreadable', async () => {
    const oldKey = randomBytes(32).toString('base64');
    const newKey = randomBytes(32).toString('base64');
    const oldExecutor = executor();
    vi.mocked(oldExecutor.completeLogin).mockResolvedValue({ email: 'recovery@example.com' });
    vi.mocked(oldExecutor.initializeLogin).mockResolvedValue({
      email: 'recovery@example.com',
      requestId: '105bac75-84ca-4458-96da-f01837eb02bb',
    });
    vi.mocked(oldExecutor.status).mockResolvedValue({
      live: { email: null, expiresIn: null, tokenStatus: 'UNKNOWN' },
      test: { email: 'recovery@example.com', expiresIn: '7d', tokenStatus: 'VALID' },
    });
    const repository = createPostgresCircleConnectionRepository(store.pool);
    const oldService = createCircleConnectionService({
      executorFactory: () => oldExecutor,
      masterKeyBase64: oldKey,
      repository,
    });
    const firstChallenge = await oldService.initialize({
      email: 'recovery@example.com',
      orgId: 'org_circle_recovery',
      userId: 'usr_circle_recovery',
    });
    await oldService.complete({
      challengeId: firstChallenge.challengeId,
      orgId: 'org_circle_recovery',
      otp: 'REC-123456',
      userId: 'usr_circle_recovery',
    });

    const newExecutor = executor();
    vi.mocked(newExecutor.initializeLogin).mockResolvedValue({
      email: 'recovery@example.com',
      requestId: 'b0e72926-ac37-40db-b73a-ab61ef44f1d5',
    });
    const restartedService = createCircleConnectionService({
      executorFactory: () => newExecutor,
      masterKeyBase64: newKey,
      repository: createPostgresCircleConnectionRepository(store.pool),
    });

    await expect(restartedService.status({ orgId: 'org_circle_recovery' })).resolves.toEqual({
      email: '',
      expiresAt: null,
      status: 'blocked',
    });
    const recovered = await restartedService.initialize({
      email: 'recovery@example.com',
      orgId: 'org_circle_recovery',
      userId: 'usr_circle_recovery',
    });
    expect(recovered).toMatchObject({ email: 'recovery@example.com', status: 'otp_pending' });
    expect(recovered.challengeId).not.toBe(firstChallenge.challengeId);

    const state = await store.pool.query<{
      challenge_statuses: string[];
      current_revision: number;
      current_status: string;
      pending_count: string;
      profile_ciphertext: string;
      request_ciphertexts: string[];
    }>(
      `SELECT connection.revision AS current_revision,
              connection.status AS current_status,
              connection.profile_ciphertext,
              ARRAY(
                SELECT challenge.status
                  FROM circle_connection_challenges challenge
                 WHERE challenge.org_id = connection.org_id
                 ORDER BY challenge.created_at ASC
              ) AS challenge_statuses,
              ARRAY(
                SELECT challenge.request_bundle_ciphertext
                  FROM circle_connection_challenges challenge
                 WHERE challenge.org_id = connection.org_id
                 ORDER BY challenge.created_at ASC
              ) AS request_ciphertexts,
              (
                SELECT count(*)
                  FROM circle_connection_challenges challenge
                 WHERE challenge.org_id = connection.org_id AND challenge.status = 'pending'
              ) AS pending_count
         FROM circle_org_connections connection
        WHERE connection.org_id = 'org_circle_recovery'`,
    );
    expect(state.rows[0]).toMatchObject({
      challenge_statuses: ['verified', 'pending'],
      current_revision: 2,
      current_status: 'otp_pending',
      pending_count: '1',
    });
    expect(JSON.stringify(state.rows[0])).not.toContain('recovery@example.com');
    expect(JSON.stringify(state.rows[0])).not.toContain('REC-123456');

    const events = await store.pool.query<{ action: string; canonical_body: Record<string, unknown> }>(
      `SELECT action, canonical_body
         FROM audit_events
        WHERE org_id = 'org_circle_recovery'
        ORDER BY sequence ASC`,
    );
    expect(events.rows.map(({ action }) => action)).toEqual([
      'circle.connection.verification_requested',
      'circle.connection.verified',
      'circle.connection.verification_requested',
    ]);
    expect(JSON.stringify(events.rows)).not.toContain('REC-123456');
  });

  it('records connection request, verification, and disconnect in the audit chain', async () => {
    const key = randomBytes(32).toString('base64');
    const circleExecutor = executor();
    vi.mocked(circleExecutor.completeLogin).mockResolvedValue({ email: 'audit@example.com' });
    vi.mocked(circleExecutor.initializeLogin).mockResolvedValue({
      email: 'audit@example.com',
      requestId: '2f5cc9c7-bb08-42b3-87e1-6ba52e54ca21',
    });
    vi.mocked(circleExecutor.status).mockResolvedValue({
      live: { email: null, expiresIn: null, tokenStatus: 'UNKNOWN' },
      test: { email: 'audit@example.com', expiresIn: '7d', tokenStatus: 'VALID' },
    });
    const connectionService = createCircleConnectionService({
      executorFactory: () => circleExecutor,
      masterKeyBase64: key,
      repository: createPostgresCircleConnectionRepository(store.pool),
    });
    const initialized = await connectionService.initialize({
      email: 'audit@example.com',
      orgId: 'org_circle_audit',
      userId: 'usr_circle_audit',
    });
    await connectionService.complete({
      challengeId: initialized.challengeId,
      orgId: 'org_circle_audit',
      otp: 'ABC-123456',
      userId: 'usr_circle_audit',
    });
    await connectionService.disconnect({ orgId: 'org_circle_audit', userId: 'usr_circle_audit' });

    const events = await store.pool.query<{
      action: string;
      actor_id: string | null;
      outcome: string;
    }>(
      `SELECT action, actor_id, outcome
         FROM audit_events
        WHERE org_id = 'org_circle_audit'
        ORDER BY sequence ASC`,
    );
    expect(events.rows).toEqual([
      {
        action: 'circle.connection.verification_requested',
        actor_id: 'usr_circle_audit',
        outcome: 'pending',
      },
      {
        action: 'circle.connection.verified',
        actor_id: 'usr_circle_audit',
        outcome: 'success',
      },
      {
        action: 'circle.connection.disconnected',
        actor_id: 'usr_circle_audit',
        outcome: 'success',
      },
    ]);
  });

  it('keeps repeated live initialization idempotent in Postgres', async () => {
    const key = randomBytes(32).toString('base64');
    const circleExecutor = executor();
    vi.mocked(circleExecutor.initializeLogin).mockResolvedValue({
      email: 'idem@example.com',
      requestId: '5f9b7a88-60ce-4fdc-8840-2a9c96b12381',
    });
    const connectionService = createCircleConnectionService({
      executorFactory: () => circleExecutor,
      masterKeyBase64: key,
      repository: createPostgresCircleConnectionRepository(store.pool),
    });

    const first = await connectionService.initialize({
      email: 'idem@example.com',
      orgId: 'org_circle_idem',
      userId: 'usr_circle_idem',
    });
    const second = await connectionService.initialize({
      email: 'idem@example.com',
      orgId: 'org_circle_idem',
      userId: 'usr_circle_idem',
    });

    expect(second).toEqual(first);
    expect(circleExecutor.initializeLogin).toHaveBeenCalledOnce();
    const state = await store.pool.query<{
      challenge_count: string;
      event_count: string;
      revision: number;
    }>(
      `SELECT connection.revision,
              (SELECT count(*) FROM circle_connection_challenges WHERE org_id = 'org_circle_idem') AS challenge_count,
              (SELECT count(*) FROM audit_events WHERE org_id = 'org_circle_idem') AS event_count
         FROM circle_org_connections connection
        WHERE connection.org_id = 'org_circle_idem'`,
    );
    expect(state.rows[0]).toEqual({ challenge_count: '1', event_count: '1', revision: 1 });
  });

  it('records failed verification without exposing the OTP', async () => {
    const circleExecutor = executor();
    vi.mocked(circleExecutor.initializeLogin).mockResolvedValue({
      email: 'failure@example.com',
      requestId: '271ca00b-7285-4ec1-9fe4-780aa179a43d',
    });
    vi.mocked(circleExecutor.completeLogin).mockRejectedValue(new Error('circle_connection_login_failed'));
    const connectionService = createCircleConnectionService({
      executorFactory: () => circleExecutor,
      masterKeyBase64: randomBytes(32).toString('base64'),
      repository: createPostgresCircleConnectionRepository(store.pool),
    });
    const initialized = await connectionService.initialize({
      email: 'failure@example.com',
      orgId: 'org_circle_failure',
      userId: 'usr_circle_failure',
    });

    await expect(connectionService.complete({
      challengeId: initialized.challengeId,
      orgId: 'org_circle_failure',
      otp: 'ABC-999999',
      userId: 'usr_circle_failure',
    })).rejects.toThrow('circle_connection_login_failed');

    const events = await store.pool.query<{
      action: string;
      actor_id: string | null;
      canonical_body: Record<string, unknown>;
      outcome: string;
      reason_code: string | null;
    }>(
      `SELECT action, actor_id, canonical_body, outcome, reason_code
         FROM audit_events
        WHERE org_id = 'org_circle_failure'
        ORDER BY sequence ASC`,
    );
    expect(events.rows.map(({ action, actor_id, outcome, reason_code }) => ({
      action,
      actor_id,
      outcome,
      reason_code,
    }))).toEqual([
      {
        action: 'circle.connection.verification_requested',
        actor_id: 'usr_circle_failure',
        outcome: 'pending',
        reason_code: null,
      },
      {
        action: 'circle.connection.verification_failed',
        actor_id: 'usr_circle_failure',
        outcome: 'error',
        reason_code: 'circle_connection_login_failed',
      },
    ]);
    expect(JSON.stringify(events.rows)).not.toContain('ABC-999999');
  });
});
