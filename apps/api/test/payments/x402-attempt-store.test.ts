import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdentityError } from '../../src/engines/identity/errors.js';
import {
  createPostgresX402AttemptStore,
  purgeExpiredX402Results,
  type CreateX402AttemptInput,
  type X402AttemptStatus,
  type X402AttemptStore,
} from '../../src/engines/payments/x402-attempt-store.js';
import {
  createX402ResultCryptoCodec,
  type X402ResultCryptoCodec,
} from '../../src/engines/payments/x402-result-crypto.js';
import type { PaidHttpResponse } from '../../src/engines/payments/x402-http.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

const ORG_ID = 'org_x402_attempt';
const AGENT_ID = 'agt_x402_attempt';
const CONNECTION_ID = 'conn_x402_attempt';
const OTHER_CONNECTION_ID = 'conn_x402_attempt_other';
const SOURCE_ID = 'src_x402_attempt';
const OTHER_ORG_ID = 'org_x402_attempt_other';
const OTHER_AGENT_ID = 'agt_x402_attempt_other';
const CROSS_TENANT_CONNECTION_ID = 'conn_x402_attempt_cross_tenant';
const OTHER_SOURCE_ID = 'src_x402_attempt_other';

const ATTEMPT_SCOPE = { connectionId: CONNECTION_ID, orgId: ORG_ID } as const;

let keySequence = 0;

function nextKey(label: string): string {
  keySequence += 1;
  return `${label}-${keySequence}`;
}

function attemptInput(
  idempotencyKey: string,
  requestHash: string,
  overrides: Partial<CreateX402AttemptInput> = {},
): CreateX402AttemptInput {
  return {
    agentId: AGENT_ID,
    amountUsdc: '1.250000',
    asset: 'USDC',
    connectionId: CONNECTION_ID,
    idempotencyKey,
    network: 'base',
    orgId: ORG_ID,
    quoteHash: `quote-${requestHash}`,
    rail: 'exact_base' as const,
    recipient: '0x0000000000000000000000000000000000000001',
    requestHash,
    sourceId: SOURCE_ID,
    ...overrides,
  };
}

function paidResponse(overrides: Partial<PaidHttpResponse> = {}): PaidHttpResponse {
  return {
    body: { accessToken: 'merchant-secret', ok: true },
    bodyEncoding: 'json',
    contentType: 'application/json',
    headers: [
      ['content-type', 'application/json'],
      ['x-merchant-secret', 'do-not-store-in-plaintext'],
    ],
    sizeBytes: 48,
    status: 200,
    truncated: false,
    ...overrides,
  };
}

function assertIdentityError(
  error: unknown,
  code: string,
  statusCode = 409,
): asserts error is IdentityError {
  expect(error).toBeInstanceOf(IdentityError);
  if (!(error instanceof IdentityError)) throw error;
  expect(error.code).toBe(code);
  expect(error.statusCode).toBe(statusCode);
}

async function expectIdentityFailure(
  operation: () => Promise<unknown>,
  code: string,
  statusCode = 409,
): Promise<void> {
  try {
    await operation();
  } catch (error: unknown) {
    assertIdentityError(error, code, statusCode);
    return;
  }
  throw new Error(`Expected IdentityError ${code}`);
}

describe('Postgres x402 attempt store', () => {
  let postgres: PostgresTestStore | undefined;
  let pool: PostgresTestStore['pool'];
  let attempts: X402AttemptStore;
  let resultCrypto: X402ResultCryptoCodec;

  beforeAll(async () => {
    postgres = await startPostgres();
    pool = postgres.pool;
    resultCrypto = createX402ResultCryptoCodec(randomBytes(32).toString('base64'));
    attempts = createPostgresX402AttemptStore(pool, { resultCrypto });

    await pool.query(
      `INSERT INTO orgs (id, display_name) VALUES ($1, 'x402 Attempt Org')`,
      [ORG_ID],
    );
    await pool.query(
      `INSERT INTO teams (id, org_id, name, is_default)
       VALUES ('team_x402_attempt', $1, 'Default', true)`,
      [ORG_ID],
    );
    await pool.query(
      `UPDATE orgs SET default_team_id = 'team_x402_attempt' WHERE id = $1`,
      [ORG_ID],
    );
    await pool.query(
      `INSERT INTO agents (id, org_id, team_id, name)
       VALUES ($1, $2, 'team_x402_attempt', 'x402 Agent')`,
      [AGENT_ID, ORG_ID],
    );
    await pool.query(
      `INSERT INTO connections (id, org_id, agent_id, kind, name)
       VALUES ($1, $3, $4, 'mcp_http', 'Primary'),
              ($2, $3, $4, 'mcp_http', 'Other')`,
      [CONNECTION_ID, OTHER_CONNECTION_ID, ORG_ID, AGENT_ID],
    );
    await pool.query(
      `INSERT INTO payment_sources (
         id, org_id, source_type, provider, rail, chain, label,
         status, account_type, simulated_balance_usdc, created_by
       )
       VALUES ($1, $2, 'direct_exact', 'simulation', 'exact_base', 'base',
               'x402 Source', 'active', 'virtual', 100, 'test')`,
      [SOURCE_ID, ORG_ID],
    );

    await pool.query(
      `INSERT INTO orgs (id, display_name) VALUES ($1, 'Other x402 Attempt Org')`,
      [OTHER_ORG_ID],
    );
    await pool.query(
      `INSERT INTO teams (id, org_id, name, is_default)
       VALUES ('team_x402_attempt_other', $1, 'Default', true)`,
      [OTHER_ORG_ID],
    );
    await pool.query(
      `UPDATE orgs SET default_team_id = 'team_x402_attempt_other' WHERE id = $1`,
      [OTHER_ORG_ID],
    );
    await pool.query(
      `INSERT INTO agents (id, org_id, team_id, name)
       VALUES ($1, $2, 'team_x402_attempt_other', 'Other x402 Agent')`,
      [OTHER_AGENT_ID, OTHER_ORG_ID],
    );
    await pool.query(
      `INSERT INTO connections (id, org_id, agent_id, kind, name)
       VALUES ($1, $2, $3, 'mcp_http', 'Cross Tenant')`,
      [CROSS_TENANT_CONNECTION_ID, OTHER_ORG_ID, OTHER_AGENT_ID],
    );
    await pool.query(
      `INSERT INTO payment_sources (
         id, org_id, source_type, provider, rail, chain, label,
         status, account_type, simulated_balance_usdc, created_by
       )
       VALUES ($1, $2, 'direct_exact', 'simulation', 'exact_base', 'base',
               'Other x402 Source', 'active', 'virtual', 100, 'test')`,
      [OTHER_SOURCE_ID, OTHER_ORG_ID],
    );
  }, 90_000);

  afterAll(async () => {
    await postgres?.stop();
  });

  it('scopes idempotency keys to a connection', async () => {
    const idempotencyKey = nextKey('scope');
    const first = await attempts.createAttempt(
      attemptInput(idempotencyKey, 'request-hash-primary'),
    );
    const second = await attempts.createAttempt(
      attemptInput(idempotencyKey, 'request-hash-other', {
        connectionId: OTHER_CONNECTION_ID,
      }),
    );

    expect(first.id).not.toBe(second.id);
    const rows = await pool.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM runtime_payment_attempts
        WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    expect(rows.rows[0]?.count).toBe('2');
  });

  it('rejects cross-tenant org, agent, connection, and source combinations without writing', async () => {
    const mismatches: readonly Partial<CreateX402AttemptInput>[] = [
      { orgId: OTHER_ORG_ID },
      { agentId: OTHER_AGENT_ID },
      { connectionId: CROSS_TENANT_CONNECTION_ID },
      { sourceId: OTHER_SOURCE_ID },
      {
        agentId: OTHER_AGENT_ID,
        connectionId: CROSS_TENANT_CONNECTION_ID,
        sourceId: OTHER_SOURCE_ID,
      },
    ];

    for (const [index, mismatch] of mismatches.entries()) {
      const idempotencyKey = nextKey(`tenant-mismatch-${index}`);
      await expectIdentityFailure(
        () => attempts.createAttempt(attemptInput(
          idempotencyKey,
          `request-hash-tenant-mismatch-${index}`,
          mismatch,
        )),
        'payment_attempt_scope_invalid',
        404,
      );
      const rows = await pool.query<{ count: string }>(
        `SELECT count(*) AS count
           FROM runtime_payment_attempts
          WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      expect(rows.rows[0]?.count).toBe('0');
    }
  });

  it('returns one row to simultaneous same-key same-hash creators', async () => {
    const idempotencyKey = nextKey('concurrent-same');
    const input = attemptInput(idempotencyKey, 'request-hash-concurrent');

    const [first, second] = await Promise.all([
      attempts.createAttempt(input),
      attempts.createAttempt(input),
    ]);

    expect(second).toEqual(first);
    const rows = await pool.query<{ count: string }>(
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
    await attempts.markSubmitting(ATTEMPT_SCOPE, first.id);
    const settled = await attempts.finalizeSettled(ATTEMPT_SCOPE, first.id, {
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
    });

    await expect(attempts.createAttempt(input)).resolves.toEqual(settled);
    await expect(attempts.findAttempt(CONNECTION_ID, idempotencyKey)).resolves.toEqual(settled);
  });

  it('rejects sequential and concurrent request-hash aliases', async () => {
    const sequentialKey = nextKey('hash-conflict');
    await attempts.createAttempt(attemptInput(sequentialKey, 'request-hash-original'));
    await expectIdentityFailure(
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

    const submitting = await attempts.markSubmitting(ATTEMPT_SCOPE, created.id);
    expect(submitting.submitted_at).not.toBeNull();
    const settled = await attempts.finalizeSettled(ATTEMPT_SCOPE, created.id, {
      paymentMetadata: { transactionHash: '0xmapping' },
      responseMetadata: { contentType: 'application/json', statusCode: 201 },
    });

    expect(settled).toMatchObject({
      encrypted_result: null,
      error_code: null,
      payment_metadata: { transactionHash: '0xmapping' },
      response_metadata: { contentType: 'application/json', statusCode: 201 },
      result_expires_at: null,
      status: 'settled',
    });
    expect(settled.finalized_at).not.toBeNull();
  });

  it('keeps response metadata object-shaped and rejects merchant payload material', async () => {
    const created = await attempts.createAttempt(
      attemptInput(nextKey('safe-json'), 'request-hash-safe-json'),
    );
    await attempts.markSubmitting(ATTEMPT_SCOPE, created.id);

    await expect(attempts.finalizeSettled(ATTEMPT_SCOPE, created.id, {
      responseMetadata: {
        body: 'merchant-body',
        headers: { authorization: 'secret' },
        statusCode: 200,
      } as never,
    })).rejects.toThrow('payment_attempt_unsafe_response_metadata');

    const row = await attempts.findAttempt(CONNECTION_ID, created.idempotency_key);
    expect(row?.status).toBe('submitting');
    await expect(pool.query(
      `UPDATE runtime_payment_attempts SET response_metadata = '[]'::jsonb WHERE id = $1`,
      [created.id],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('encrypts paid HTTP results for exactly 15 minutes and scrubs them after expiry', async () => {
    const created = await attempts.createAttempt(
      attemptInput(nextKey('encrypted-result'), 'request-hash-encrypted-result'),
    );
    await attempts.markSubmitting(ATTEMPT_SCOPE, created.id);
    const plaintext = paidResponse();
    const settled = await attempts.finalizeSettled(ATTEMPT_SCOPE, created.id, {
      result: plaintext,
      responseMetadata: {
        contentLength: plaintext.sizeBytes,
        contentType: plaintext.contentType,
        statusCode: plaintext.status,
      },
    });

    expect(settled.encrypted_result).not.toBeNull();
    expect(settled.result_expires_at).not.toBeNull();
    if (settled.encrypted_result === null) throw new Error('Missing encrypted result');
    expect(resultCrypto.decrypt(
      { attemptId: settled.id, connectionId: CONNECTION_ID, orgId: ORG_ID },
      settled.encrypted_result,
    )).toEqual(plaintext);

    const stored = await pool.query<{
      encrypted_result: string;
      ttl_seconds: string;
    }>(
      `SELECT encrypted_result::text,
              extract(epoch FROM (result_expires_at - finalized_at))::text AS ttl_seconds
         FROM runtime_payment_attempts
        WHERE id = $1`,
      [created.id],
    );
    expect(stored.rows[0]?.ttl_seconds).toBe('900.000000');
    expect(stored.rows[0]?.encrypted_result).not.toContain('merchant-secret');
    expect(stored.rows[0]?.encrypted_result).not.toContain('do-not-store-in-plaintext');

    await pool.query(
      `UPDATE runtime_payment_attempts
          SET result_expires_at = now() - interval '1 second'
        WHERE id = $1`,
      [created.id],
    );
    const expired = await attempts.findAttempt(CONNECTION_ID, created.idempotency_key);
    expect(expired).toMatchObject({ encrypted_result: null, result_expires_at: null });

    const scrubbed = await pool.query<{
      encrypted_result: unknown;
      result_expires_at: Date | null;
    }>(
      `SELECT encrypted_result, result_expires_at
         FROM runtime_payment_attempts
        WHERE id = $1`,
      [created.id],
    );
    expect(scrubbed.rows[0]).toEqual({ encrypted_result: null, result_expires_at: null });
  });

  it('scrubs an expired encrypted result before returning a same-key create replay', async () => {
    const idempotencyKey = nextKey('expired-create-replay');
    const input = attemptInput(idempotencyKey, 'request-hash-expired-create-replay');
    const created = await attempts.createAttempt(input);
    await attempts.markSubmitting(ATTEMPT_SCOPE, created.id);
    await attempts.finalizeSettled(ATTEMPT_SCOPE, created.id, {
      result: paidResponse({ body: { secret: 'expired-create-secret' } }),
    });
    await pool.query(
      `UPDATE runtime_payment_attempts
          SET result_expires_at = now() - interval '1 second'
        WHERE id = $1`,
      [created.id],
    );

    const replayed = await attempts.createAttempt(input);

    expect(replayed).toMatchObject({
      encrypted_result: null,
      id: created.id,
      result_expires_at: null,
      status: 'settled',
    });
    const stored = await pool.query<{
      encrypted_result: unknown;
      result_expires_at: Date | null;
    }>(
      `SELECT encrypted_result, result_expires_at
         FROM runtime_payment_attempts
        WHERE id = $1`,
      [created.id],
    );
    expect(stored.rows[0]).toEqual({ encrypted_result: null, result_expires_at: null });
  });

  it('purges expired encrypted results in expiry order within a bounded batch', async () => {
    const expiries = ['30 seconds', '20 seconds', '10 seconds'] as const;
    const expiredIds: string[] = [];
    for (const [index, expiry] of expiries.entries()) {
      const created = await attempts.createAttempt(attemptInput(
        nextKey(`purge-expired-${index}`),
        `request-hash-purge-expired-${index}`,
      ));
      await attempts.markSubmitting(ATTEMPT_SCOPE, created.id);
      await attempts.finalizeSettled(ATTEMPT_SCOPE, created.id, {
        result: paidResponse({ body: { index } }),
      });
      await pool.query(
        `UPDATE runtime_payment_attempts
            SET result_expires_at = now() - $2::interval
          WHERE id = $1`,
        [created.id, expiry],
      );
      expiredIds.push(created.id);
    }
    const unexpired = await attempts.createAttempt(attemptInput(
      nextKey('purge-unexpired'),
      'request-hash-purge-unexpired',
    ));
    await attempts.markSubmitting(ATTEMPT_SCOPE, unexpired.id);
    await attempts.finalizeSettled(ATTEMPT_SCOPE, unexpired.id, {
      result: paidResponse({ body: { fresh: true } }),
    });

    await expect(purgeExpiredX402Results(pool, 2)).resolves.toBe(2);
    const firstPass = await pool.query<{
      encrypted_result: unknown;
      id: string;
      result_expires_at: Date | null;
    }>(
      `SELECT id, encrypted_result, result_expires_at
         FROM runtime_payment_attempts
        WHERE id = ANY($1::text[])
        ORDER BY id`,
      [[...expiredIds, unexpired.id]],
    );
    const firstPassById = new Map(firstPass.rows.map((row) => [row.id, row]));
    for (const id of expiredIds.slice(0, 2)) {
      expect(firstPassById.get(id)).toMatchObject({
        encrypted_result: null,
        result_expires_at: null,
      });
    }
    const remainingExpired = firstPassById.get(expiredIds[2]!);
    expect(remainingExpired?.encrypted_result).not.toBeNull();
    expect(remainingExpired?.result_expires_at).toBeInstanceOf(Date);
    const retainedUnexpired = firstPassById.get(unexpired.id);
    expect(retainedUnexpired?.encrypted_result).not.toBeNull();
    expect(retainedUnexpired?.result_expires_at).toBeInstanceOf(Date);

    await expect(purgeExpiredX402Results(pool, 2)).resolves.toBe(1);
    const finalRows = await pool.query<{
      encrypted_result: unknown;
      id: string;
      result_expires_at: Date | null;
    }>(
      `SELECT id, encrypted_result, result_expires_at
         FROM runtime_payment_attempts
        WHERE id = ANY($1::text[])`,
      [[...expiredIds, unexpired.id]],
    );
    const finalById = new Map(finalRows.rows.map((row) => [row.id, row]));
    for (const id of expiredIds) {
      expect(finalById.get(id)).toMatchObject({
        encrypted_result: null,
        result_expires_at: null,
      });
    }
    const finalUnexpired = finalById.get(unexpired.id);
    expect(finalUnexpired?.encrypted_result).not.toBeNull();
    expect(finalUnexpired?.result_expires_at).toBeInstanceOf(Date);
  });

  it('enforces paired encrypted-result retention fields in PostgreSQL', async () => {
    const created = await attempts.createAttempt(
      attemptInput(nextKey('retention-pair'), 'request-hash-retention-pair'),
    );
    await expect(pool.query(
      `UPDATE runtime_payment_attempts
          SET encrypted_result = '{"version":1}'::jsonb
        WHERE id = $1`,
      [created.id],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(
      `UPDATE runtime_payment_attempts
          SET result_expires_at = now() + interval '15 minutes'
        WHERE id = $1`,
      [created.id],
    )).rejects.toMatchObject({ code: '23514' });
  });

  async function createInStatus(status: X402AttemptStatus): Promise<string> {
    const created = await attempts.createAttempt(attemptInput(
      nextKey(`state-${status}`),
      `request-hash-state-${status}-${keySequence}`,
    ));
    if (status === 'reserved') return created.id;

    await attempts.markSubmitting(ATTEMPT_SCOPE, created.id);
    if (status === 'submitting') return created.id;
    if (status === 'settled') {
      await attempts.finalizeSettled(ATTEMPT_SCOPE, created.id, {});
      return created.id;
    }
    if (status === 'failed') {
      await attempts.finalizeFailed(ATTEMPT_SCOPE, created.id, {
        errorCode: 'provider_failed',
        providerCallMade: true,
      });
      return created.id;
    }
    await attempts.finalizeUnknown(
      ATTEMPT_SCOPE,
      created.id,
      { errorCode: 'provider_outcome_unknown' },
    );
    return created.id;
  }

  it('allows each legal transition', async () => {
    const markId = await createInStatus('reserved');
    await expect(attempts.markSubmitting(ATTEMPT_SCOPE, markId)).resolves.toMatchObject({ status: 'submitting' });

    const settledId = await createInStatus('submitting');
    await expect(attempts.finalizeSettled(ATTEMPT_SCOPE, settledId, {})).resolves.toMatchObject({ status: 'settled' });

    const failedId = await createInStatus('submitting');
    await expect(attempts.finalizeFailed(ATTEMPT_SCOPE, failedId, {
      errorCode: 'provider_failed',
      providerCallMade: true,
    })).resolves.toMatchObject({ error_code: 'provider_failed', status: 'failed' });

    const deterministicFailureId = await createInStatus('reserved');
    await expect(attempts.finalizeFailed(ATTEMPT_SCOPE, deterministicFailureId, {
      errorCode: 'quote_rejected',
      providerCallMade: false,
    })).resolves.toMatchObject({ error_code: 'quote_rejected', status: 'failed' });

    const unknownId = await createInStatus('submitting');
    await expect(attempts.finalizeUnknown(ATTEMPT_SCOPE, unknownId, {
      errorCode: 'provider_outcome_unknown',
    })).resolves.toMatchObject({ error_code: 'provider_outcome_unknown', status: 'unknown' });
  });

  it('requires the exact tenant scope for every transition and never mutates wrong-scope rows', async () => {
    const wrongOrgScope = { connectionId: CONNECTION_ID, orgId: OTHER_ORG_ID } as const;
    const wrongConnectionScope = { connectionId: OTHER_CONNECTION_ID, orgId: ORG_ID } as const;
    const cases = [
      {
        expectedStatus: 'reserved',
        operation: async (id: string) => attempts.markSubmitting(wrongOrgScope, id),
        status: 'reserved' as const,
      },
      {
        expectedStatus: 'reserved',
        operation: async (id: string) => attempts.markSubmitting(wrongConnectionScope, id),
        status: 'reserved' as const,
      },
      {
        expectedStatus: 'submitting',
        operation: async (id: string) => attempts.finalizeSettled(wrongOrgScope, id, {}),
        status: 'submitting' as const,
      },
      {
        expectedStatus: 'submitting',
        operation: async (id: string) => attempts.finalizeFailed(wrongConnectionScope, id, {
          errorCode: 'provider_failed',
          providerCallMade: true,
        }),
        status: 'submitting' as const,
      },
      {
        expectedStatus: 'submitting',
        operation: async (id: string) => attempts.finalizeUnknown(wrongOrgScope, id, {
          errorCode: 'provider_outcome_unknown',
        }),
        status: 'submitting' as const,
      },
      {
        expectedStatus: 'reserved',
        operation: async (id: string) => attempts.finalizeFailed(wrongConnectionScope, id, {
          errorCode: 'quote_rejected',
          providerCallMade: false,
        }),
        status: 'reserved' as const,
      },
    ];

    for (const testCase of cases) {
      const id = await createInStatus(testCase.status);
      await expectIdentityFailure(
        () => testCase.operation(id),
        'payment_attempt_scope_invalid',
        404,
      );
      const row = await pool.query<{ status: X402AttemptStatus }>(
        `SELECT status FROM runtime_payment_attempts WHERE id = $1`,
        [id],
      );
      expect(row.rows[0]?.status).toBe(testCase.expectedStatus);
    }
  });

  it('rejects every stale or illegal transition with a stable conflict', async () => {
    const invalid = [
      async (id: string) => attempts.markSubmitting(ATTEMPT_SCOPE, id),
      async (id: string) => attempts.finalizeSettled(ATTEMPT_SCOPE, id, {}),
      async (id: string) => attempts.finalizeFailed(ATTEMPT_SCOPE, id, {
        errorCode: 'provider_failed',
        providerCallMade: true,
      }),
      async (id: string) => attempts.finalizeUnknown(ATTEMPT_SCOPE, id, {
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
        await expectIdentityFailure(
          () => operation(id),
          'payment_attempt_state_conflict',
        );
      }
    }

    const reservedId = await createInStatus('reserved');
    await expectIdentityFailure(
      () => attempts.finalizeFailed(ATTEMPT_SCOPE, reservedId, {
        errorCode: 'provider_failed',
        providerCallMade: true,
      }),
      'payment_attempt_state_conflict',
    );

    await expectIdentityFailure(
      () => attempts.markSubmitting(ATTEMPT_SCOPE, 'rpa_missing'),
      'payment_attempt_scope_invalid',
      404,
    );
  });
});
