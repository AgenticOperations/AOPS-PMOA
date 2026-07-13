import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdentityError } from '../../src/engines/identity/errors.js';
import {
  createPostgresX402AttemptStore,
  type X402AttemptStatus,
  type X402AttemptStore,
} from '../../src/engines/payments/x402-attempt-store.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

const ORG_ID = 'org_x402_attempt';
const AGENT_ID = 'agt_x402_attempt';
const CONNECTION_ID = 'conn_x402_attempt';
const OTHER_CONNECTION_ID = 'conn_x402_attempt_other';
const SOURCE_ID = 'src_x402_attempt';

let keySequence = 0;

function nextKey(label: string): string {
  keySequence += 1;
  return `${label}-${keySequence}`;
}

function attemptInput(
  idempotencyKey: string,
  requestHash: string,
  connectionId = CONNECTION_ID,
) {
  return {
    agentId: AGENT_ID,
    amountUsdc: '1.250000',
    asset: 'USDC',
    connectionId,
    idempotencyKey,
    network: 'base',
    orgId: ORG_ID,
    quoteHash: `quote-${requestHash}`,
    rail: 'exact_base' as const,
    recipient: '0x0000000000000000000000000000000000000001',
    requestHash,
    sourceId: SOURCE_ID,
  };
}

function assertIdentityError(error: unknown, code: string): asserts error is IdentityError {
  expect(error).toBeInstanceOf(IdentityError);
  if (!(error instanceof IdentityError)) throw error;
  expect(error.code).toBe(code);
  expect(error.statusCode).toBe(409);
}

async function expectIdentityConflict(
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation();
  } catch (error: unknown) {
    assertIdentityError(error, code);
    return;
  }
  throw new Error(`Expected IdentityError ${code}`);
}

describe('Postgres x402 attempt store', () => {
  let postgres: PostgresTestStore;
  let attempts: X402AttemptStore;

  beforeAll(async () => {
    postgres = await startPostgres();
    attempts = createPostgresX402AttemptStore(postgres.pool);

    await postgres.pool.query(
      `INSERT INTO orgs (id, display_name) VALUES ($1, 'x402 Attempt Org')`,
      [ORG_ID],
    );
    await postgres.pool.query(
      `INSERT INTO teams (id, org_id, name, is_default)
       VALUES ('team_x402_attempt', $1, 'Default', true)`,
      [ORG_ID],
    );
    await postgres.pool.query(
      `UPDATE orgs SET default_team_id = 'team_x402_attempt' WHERE id = $1`,
      [ORG_ID],
    );
    await postgres.pool.query(
      `INSERT INTO agents (id, org_id, team_id, name)
       VALUES ($1, $2, 'team_x402_attempt', 'x402 Agent')`,
      [AGENT_ID, ORG_ID],
    );
    await postgres.pool.query(
      `INSERT INTO connections (id, org_id, agent_id, kind, name)
       VALUES ($1, $3, $4, 'mcp_http', 'Primary'),
              ($2, $3, $4, 'mcp_http', 'Other')`,
      [CONNECTION_ID, OTHER_CONNECTION_ID, ORG_ID, AGENT_ID],
    );
    await postgres.pool.query(
      `INSERT INTO payment_sources (
         id, org_id, source_type, provider, rail, chain, label,
         status, account_type, simulated_balance_usdc, created_by
       )
       VALUES ($1, $2, 'direct_exact', 'simulation', 'exact_base', 'base',
               'x402 Source', 'active', 'virtual', 100, 'test')`,
      [SOURCE_ID, ORG_ID],
    );
  }, 90_000);

  afterAll(async () => {
    await postgres.stop();
  });

  it('scopes idempotency keys to a connection', async () => {
    const idempotencyKey = nextKey('scope');
    const first = await attempts.createAttempt(
      attemptInput(idempotencyKey, 'request-hash-primary'),
    );
    const second = await attempts.createAttempt(
      attemptInput(idempotencyKey, 'request-hash-other', OTHER_CONNECTION_ID),
    );

    expect(first.id).not.toBe(second.id);
    const rows = await postgres.pool.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM runtime_payment_attempts
        WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    expect(rows.rows[0]?.count).toBe('2');
  });

  it('returns one row to simultaneous same-key same-hash creators', async () => {
    const idempotencyKey = nextKey('concurrent-same');
    const input = attemptInput(idempotencyKey, 'request-hash-concurrent');

    const [first, second] = await Promise.all([
      attempts.createAttempt(input),
      attempts.createAttempt(input),
    ]);

    expect(second).toEqual(first);
    const rows = await postgres.pool.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM runtime_payment_attempts
        WHERE connection_id = $1 AND idempotency_key = $2`,
      [CONNECTION_ID, idempotencyKey],
    );
    expect(rows.rows[0]?.count).toBe('1');
  });

  it('replays the stored attempt for a matching request hash', async () => {
    const idempotencyKey = nextKey('replay');
    const input = attemptInput(idempotencyKey, 'request-hash-replay');

    const first = await attempts.createAttempt(input);
    await attempts.markSubmitting(first.id);
    const settled = await attempts.finalizeSettled(first.id, {
      encryptedResult: { algorithm: 'aes-256-gcm', ciphertext: 'opaque' },
      paymentMetadata: {
        providerReference: 'provider-ref-replay',
        receiptId: 'receipt-replay',
        transactionHash: '0xabc123',
      },
      responseMetadata: {
        contentLength: 42,
        contentType: 'application/json',
        statusCode: 200,
      },
      resultExpiresAt: new Date('2030-01-02T03:04:05.000Z'),
    });

    await expect(attempts.createAttempt(input)).resolves.toEqual(settled);
    await expect(attempts.findAttempt(CONNECTION_ID, idempotencyKey)).resolves.toEqual(settled);
  });

  it('rejects sequential and concurrent request-hash aliases', async () => {
    const sequentialKey = nextKey('hash-conflict');
    await attempts.createAttempt(attemptInput(sequentialKey, 'request-hash-original'));
    await expectIdentityConflict(
      () => attempts.createAttempt(attemptInput(sequentialKey, 'request-hash-different')),
      'payment_idempotency_conflict',
    );

    const concurrentKey = nextKey('hash-conflict-concurrent');
    const results = await Promise.allSettled([
      attempts.createAttempt(attemptInput(concurrentKey, 'request-hash-a')),
      attempts.createAttempt(attemptInput(concurrentKey, 'request-hash-b')),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    const rejectionReason: unknown = rejected?.status === 'rejected' ? rejected.reason : null;
    assertIdentityError(rejectionReason, 'payment_idempotency_conflict');
  });

  it('maps numeric, JSON, and timestamp fields without losing precision', async () => {
    const resultExpiresAt = new Date('2031-02-03T04:05:06.789Z');
    const created = await attempts.createAttempt({
      ...attemptInput(nextKey('mapping'), 'request-hash-mapping'),
      amountUsdc: '12345678901234.123456',
      quoteHash: 'quote-hash-mapping',
      recipient: '0x0000000000000000000000000000000000000002',
    });

    expect(created).toMatchObject({
      agent_id: AGENT_ID,
      amount_usdc: '12345678901234.123456',
      asset: 'USDC',
      connection_id: CONNECTION_ID,
      error_code: null,
      finalized_at: null,
      network: 'base',
      org_id: ORG_ID,
      payment_metadata: {},
      quote_hash: 'quote-hash-mapping',
      rail: 'exact_base',
      response_metadata: {},
      source_id: SOURCE_ID,
      status: 'reserved',
      submitted_at: null,
    });
    expect(new Date(created.created_at).toISOString()).toBe(created.created_at);
    expect(new Date(created.updated_at).toISOString()).toBe(created.updated_at);

    const submitting = await attempts.markSubmitting(created.id);
    expect(submitting.submitted_at).not.toBeNull();
    const settled = await attempts.finalizeSettled(created.id, {
      encryptedResult: { ciphertext: 'opaque', iv: 'iv', tag: 'tag' },
      paymentMetadata: { transactionHash: '0xmapping' },
      responseMetadata: { contentType: 'application/json', statusCode: 201 },
      resultExpiresAt,
    });

    expect(settled).toMatchObject({
      encrypted_result: { ciphertext: 'opaque', iv: 'iv', tag: 'tag' },
      error_code: null,
      payment_metadata: { transactionHash: '0xmapping' },
      response_metadata: { contentType: 'application/json', statusCode: 201 },
      result_expires_at: resultExpiresAt.toISOString(),
      status: 'settled',
    });
    expect(settled.finalized_at).not.toBeNull();
  });

  it('keeps response metadata object-shaped and rejects merchant payload material', async () => {
    const created = await attempts.createAttempt(
      attemptInput(nextKey('safe-json'), 'request-hash-safe-json'),
    );
    await attempts.markSubmitting(created.id);

    await expect(attempts.finalizeSettled(created.id, {
      responseMetadata: {
        body: 'merchant-body',
        headers: { authorization: 'secret' },
        statusCode: 200,
      } as never,
    })).rejects.toThrow('payment_attempt_unsafe_response_metadata');

    const row = await attempts.findAttempt(CONNECTION_ID, created.idempotency_key);
    expect(row?.status).toBe('submitting');
    await expect(postgres.pool.query(
      `UPDATE runtime_payment_attempts SET response_metadata = '[]'::jsonb WHERE id = $1`,
      [created.id],
    )).rejects.toMatchObject({ code: '23514' });
  });

  async function createInStatus(status: X402AttemptStatus): Promise<string> {
    const created = await attempts.createAttempt(attemptInput(
      nextKey(`state-${status}`),
      `request-hash-state-${status}-${keySequence}`,
    ));
    if (status === 'reserved') return created.id;

    await attempts.markSubmitting(created.id);
    if (status === 'submitting') return created.id;
    if (status === 'settled') {
      await attempts.finalizeSettled(created.id, {});
      return created.id;
    }
    if (status === 'failed') {
      await attempts.finalizeFailed(created.id, {
        errorCode: 'provider_failed',
        providerCallMade: true,
      });
      return created.id;
    }
    await attempts.finalizeUnknown(created.id, { errorCode: 'provider_outcome_unknown' });
    return created.id;
  }

  it('allows each legal transition', async () => {
    const markId = await createInStatus('reserved');
    await expect(attempts.markSubmitting(markId)).resolves.toMatchObject({ status: 'submitting' });

    const settledId = await createInStatus('submitting');
    await expect(attempts.finalizeSettled(settledId, {})).resolves.toMatchObject({ status: 'settled' });

    const failedId = await createInStatus('submitting');
    await expect(attempts.finalizeFailed(failedId, {
      errorCode: 'provider_failed',
      providerCallMade: true,
    })).resolves.toMatchObject({ error_code: 'provider_failed', status: 'failed' });

    const deterministicFailureId = await createInStatus('reserved');
    await expect(attempts.finalizeFailed(deterministicFailureId, {
      errorCode: 'quote_rejected',
      providerCallMade: false,
    })).resolves.toMatchObject({ error_code: 'quote_rejected', status: 'failed' });

    const unknownId = await createInStatus('submitting');
    await expect(attempts.finalizeUnknown(unknownId, {
      errorCode: 'provider_outcome_unknown',
    })).resolves.toMatchObject({ error_code: 'provider_outcome_unknown', status: 'unknown' });
  });

  it('rejects every stale or illegal transition with a stable conflict', async () => {
    const invalid = [
      async (id: string) => attempts.markSubmitting(id),
      async (id: string) => attempts.finalizeSettled(id, {}),
      async (id: string) => attempts.finalizeFailed(id, {
        errorCode: 'provider_failed',
        providerCallMade: true,
      }),
      async (id: string) => attempts.finalizeUnknown(id, {
        errorCode: 'provider_outcome_unknown',
      }),
    ];

    for (const status of ['reserved', 'submitting', 'settled', 'failed', 'unknown'] as const) {
      for (const [operationIndex, operation] of invalid.entries()) {
        const legal =
          (status === 'reserved' && operationIndex === 0) ||
          (status === 'submitting' && operationIndex > 0);
        if (legal) continue;

        const id = await createInStatus(status);
        await expectIdentityConflict(
          () => operation(id),
          'payment_attempt_state_conflict',
        );
      }
    }

    const reservedId = await createInStatus('reserved');
    await expectIdentityConflict(
      () => attempts.finalizeFailed(reservedId, {
        errorCode: 'provider_failed',
        providerCallMade: true,
      }),
      'payment_attempt_state_conflict',
    );

    await expectIdentityConflict(
      () => attempts.markSubmitting('rpa_missing'),
      'payment_attempt_state_conflict',
    );
  });
});
