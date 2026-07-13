import pg from 'pg';
import { conflict, IdentityError } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import type { PaymentRail } from './types.js';
import {
  validateX402ResultEnvelope,
  type X402ResultCryptoCodec,
  type X402ResultEnvelope,
} from './x402-result-crypto.js';

export type X402AttemptStatus = 'reserved' | 'submitting' | 'settled' | 'failed' | 'unknown';

export type X402PaymentMetadata = {
  readonly eventId?: string | undefined;
  readonly payer?: string | undefined;
  readonly providerMode?: string | undefined;
  readonly providerReference?: string | undefined;
  readonly reservationId?: string | undefined;
  readonly receiptId?: string | undefined;
  readonly transactionHash?: string | undefined;
};

export type X402SafeResponseMetadata = {
  readonly contentLength?: number | undefined;
  readonly contentType?: string | undefined;
  readonly statusCode?: number | undefined;
};

export type X402AttemptRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly connection_id: string | null;
  readonly source_id: string | null;
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly quote_hash: string | null;
  readonly amount_usdc: string | null;
  readonly asset: string | null;
  readonly rail: PaymentRail | null;
  readonly network: string | null;
  readonly recipient: string | null;
  readonly status: X402AttemptStatus;
  readonly payment_metadata: X402PaymentMetadata;
  readonly response_metadata: X402SafeResponseMetadata;
  readonly encrypted_result: X402ResultEnvelope | null;
  readonly result_expires_at: string | null;
  readonly error_code: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly submitted_at: string | null;
  readonly finalized_at: string | null;
};

export type CreateX402AttemptInput = {
  readonly orgId: string;
  readonly agentId: string;
  readonly connectionId: string;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly quoteHash: string;
  readonly amountUsdc: string;
  readonly asset: string;
  readonly rail: PaymentRail;
  readonly network: string;
  readonly recipient: string;
};

export type X402AttemptScope = {
  readonly connectionId: string;
  readonly orgId: string;
};

type X402AttemptFinalizationInput = {
  readonly paymentMetadata?: X402PaymentMetadata | undefined;
  readonly responseMetadata?: X402SafeResponseMetadata | undefined;
  readonly result?: unknown;
};

export type FinalizeSettledX402AttemptInput = X402AttemptFinalizationInput;

export type FinalizeFailedX402AttemptInput = X402AttemptFinalizationInput & {
  readonly errorCode: string;
  readonly providerCallMade: boolean;
};

export type FinalizeUnknownX402AttemptInput = X402AttemptFinalizationInput & {
  readonly errorCode: string;
};

export type X402AttemptStore = {
  readonly findAttempt: (
    connectionId: string,
    idempotencyKey: string,
  ) => Promise<X402AttemptRecord | null>;
  readonly createAttempt: (input: CreateX402AttemptInput) => Promise<X402AttemptRecord>;
  readonly markSubmitting: (
    scope: X402AttemptScope,
    attemptId: string,
  ) => Promise<X402AttemptRecord>;
  readonly finalizeSettled: (
    scope: X402AttemptScope,
    attemptId: string,
    input: FinalizeSettledX402AttemptInput,
  ) => Promise<X402AttemptRecord>;
  readonly finalizeFailed: (
    scope: X402AttemptScope,
    attemptId: string,
    input: FinalizeFailedX402AttemptInput,
  ) => Promise<X402AttemptRecord>;
  readonly finalizeUnknown: (
    scope: X402AttemptScope,
    attemptId: string,
    input: FinalizeUnknownX402AttemptInput,
  ) => Promise<X402AttemptRecord>;
};

export type X402AttemptStoreOptions = {
  readonly resultCrypto: X402ResultCryptoCodec;
};

type X402AttemptDb = pg.Pool | pg.PoolClient;

type X402AttemptRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly connection_id: string | null;
  readonly source_id: string | null;
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly quote_hash: string | null;
  readonly amount_usdc: string | null;
  readonly asset: string | null;
  readonly rail: PaymentRail | null;
  readonly network: string | null;
  readonly recipient: string | null;
  readonly status: X402AttemptStatus;
  readonly payment_metadata: unknown;
  readonly response_metadata: unknown;
  readonly encrypted_result: unknown;
  readonly result_expires_at: Date | null;
  readonly error_code: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly submitted_at: Date | null;
  readonly finalized_at: Date | null;
};

const ATTEMPT_COLUMNS = `
  id, org_id, agent_id, connection_id, source_id, idempotency_key,
  request_hash, quote_hash, amount_usdc, asset, rail, network, recipient,
  status, payment_metadata, response_metadata, encrypted_result,
  result_expires_at, error_code, created_at, updated_at, submitted_at, finalized_at
`;

const PAYMENT_METADATA_KEYS = new Set([
  'eventId',
  'payer',
  'providerMode',
  'providerReference',
  'reservationId',
  'receiptId',
  'transactionHash',
]);
const RESPONSE_METADATA_KEYS = new Set([
  'contentLength',
  'contentType',
  'statusCode',
]);
const DEFAULT_RESULT_PURGE_BATCH_LIMIT = 100;
const MAX_RESULT_PURGE_BATCH_LIMIT = 1_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objectFromDatabase(value: unknown, field: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`payment_attempt_invalid_${field}`);
  return value;
}

function dateString(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function attemptFromRow(row: X402AttemptRow): X402AttemptRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    connection_id: row.connection_id,
    source_id: row.source_id,
    idempotency_key: row.idempotency_key,
    request_hash: row.request_hash,
    quote_hash: row.quote_hash,
    amount_usdc: row.amount_usdc,
    asset: row.asset,
    rail: row.rail,
    network: row.network,
    recipient: row.recipient,
    status: row.status,
    payment_metadata: objectFromDatabase(
      row.payment_metadata,
      'payment_metadata',
    ),
    response_metadata: objectFromDatabase(
      row.response_metadata,
      'response_metadata',
    ),
    encrypted_result: row.encrypted_result === null
      ? null
      : validateX402ResultEnvelope(row.encrypted_result),
    result_expires_at: dateString(row.result_expires_at),
    error_code: row.error_code,
    created_at: dateString(row.created_at)!,
    updated_at: dateString(row.updated_at)!,
    submitted_at: dateString(row.submitted_at),
    finalized_at: dateString(row.finalized_at),
  };
}

function ensureKnownKeys(
  metadata: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  errorCode: string,
): void {
  if (!isObject(metadata) || Object.keys(metadata).some((key) => !allowedKeys.has(key))) {
    throw new Error(errorCode);
  }
}

function validatePaymentMetadata(metadata: X402PaymentMetadata | undefined): void {
  if (metadata === undefined) return;
  ensureKnownKeys(metadata, PAYMENT_METADATA_KEYS, 'payment_attempt_unsafe_payment_metadata');
  for (const value of Object.values(metadata)) {
    if (value !== undefined && typeof value !== 'string') {
      throw new Error('payment_attempt_unsafe_payment_metadata');
    }
  }
}

function validateResponseMetadata(metadata: X402SafeResponseMetadata | undefined): void {
  if (metadata === undefined) return;
  ensureKnownKeys(metadata, RESPONSE_METADATA_KEYS, 'payment_attempt_unsafe_response_metadata');
  if (
    (metadata.contentLength !== undefined && (
      !Number.isSafeInteger(metadata.contentLength) || metadata.contentLength < 0
    )) ||
    (metadata.contentType !== undefined && typeof metadata.contentType !== 'string') ||
    (metadata.statusCode !== undefined && (
      !Number.isInteger(metadata.statusCode) ||
      metadata.statusCode < 100 ||
      metadata.statusCode > 599
    ))
  ) {
    throw new Error('payment_attempt_unsafe_response_metadata');
  }
}

function finalizationValues(
  resultCrypto: X402ResultCryptoCodec,
  scope: X402AttemptScope,
  attemptId: string,
  input: X402AttemptFinalizationInput,
): readonly unknown[] {
  validatePaymentMetadata(input.paymentMetadata);
  validateResponseMetadata(input.responseMetadata);
  const encryptedResult = input.result === undefined
    ? null
    : validateX402ResultEnvelope(resultCrypto.encrypt(
      {
        attemptId,
        connectionId: scope.connectionId,
        orgId: scope.orgId,
      },
      input.result,
    ));
  return [
    input.paymentMetadata === undefined ? null : JSON.stringify(input.paymentMetadata),
    input.responseMetadata === undefined ? null : JSON.stringify(input.responseMetadata),
    encryptedResult === null ? null : JSON.stringify(encryptedResult),
  ];
}

function stateConflict(): never {
  throw conflict(
    'payment_attempt_state_conflict',
    'The payment attempt is not in the required state.',
  );
}

function scopeInvalid(): never {
  throw new IdentityError(
    'payment_attempt_scope_invalid',
    404,
    'The payment attempt was not found in this tenant scope.',
  );
}

async function transaction<T>(
  pool: X402AttemptDb,
  operation: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!(pool instanceof pg.Pool)) return operation(pool);
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

async function transition(
  pool: X402AttemptDb,
  scope: X402AttemptScope,
  attemptId: string,
  sql: string,
  values: unknown[],
): Promise<X402AttemptRecord> {
  const result = await pool.query<X402AttemptRow>(sql, values);
  const row = result.rows[0];
  if (row === undefined) {
    const scoped = await pool.query<{ exists: boolean }>(
      `SELECT true AS exists
         FROM runtime_payment_attempts
        WHERE id = $1 AND org_id = $2 AND connection_id = $3`,
      [attemptId, scope.orgId, scope.connectionId],
    );
    if (scoped.rows[0] === undefined) scopeInvalid();
    stateConflict();
  }
  return attemptFromRow(row);
}

export async function purgeExpiredX402Results(
  pool: pg.Pool,
  batchLimit = DEFAULT_RESULT_PURGE_BATCH_LIMIT,
): Promise<number> {
  if (!Number.isInteger(batchLimit) || batchLimit < 1) {
    throw new RangeError('payment_attempt_purge_batch_limit_invalid');
  }
  const boundedBatchLimit = Math.min(batchLimit, MAX_RESULT_PURGE_BATCH_LIMIT);
  const result = await pool.query<{ id: string }>(
    `WITH expired AS (
       SELECT id
         FROM runtime_payment_attempts
        WHERE result_expires_at <= now()
        ORDER BY result_expires_at ASC, id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE runtime_payment_attempts AS attempt
        SET encrypted_result = NULL,
            result_expires_at = NULL,
            updated_at = now()
       FROM expired
      WHERE attempt.id = expired.id
      RETURNING attempt.id`,
    [boundedBatchLimit],
  );
  return result.rowCount ?? 0;
}

export function createPostgresX402AttemptStore(
  pool: X402AttemptDb,
  { resultCrypto }: X402AttemptStoreOptions,
): X402AttemptStore {
  const findAttempt = async (
    connectionId: string,
    idempotencyKey: string,
  ): Promise<X402AttemptRecord | null> => {
    const result = await pool.query<X402AttemptRow>(
      `WITH scrubbed AS (
         UPDATE runtime_payment_attempts
            SET encrypted_result = NULL,
                result_expires_at = NULL,
                updated_at = now()
          WHERE connection_id = $1
            AND idempotency_key = $2
            AND result_expires_at <= now()
          RETURNING ${ATTEMPT_COLUMNS}
       )
       SELECT ${ATTEMPT_COLUMNS}
         FROM scrubbed
       UNION ALL
       SELECT ${ATTEMPT_COLUMNS}
         FROM runtime_payment_attempts
        WHERE connection_id = $1
          AND idempotency_key = $2
          AND NOT EXISTS (SELECT 1 FROM scrubbed)
        LIMIT 1`,
      [connectionId, idempotencyKey],
    );
    const row = result.rows[0];
    return row === undefined ? null : attemptFromRow(row);
  };

  return {
    findAttempt,

    createAttempt: async (input) => transaction(pool, async (client) => {
      const validScope = await client.query<{ exists: boolean }>(
        `SELECT true AS exists
           FROM connections AS connection
           JOIN agents AS agent
             ON agent.id = connection.agent_id
            AND agent.org_id = connection.org_id
           JOIN payment_sources AS source
             ON source.id = $4
            AND source.org_id = connection.org_id
          WHERE connection.id = $1
            AND connection.org_id = $2
            AND connection.agent_id = $3
          FOR SHARE OF connection, agent, source`,
        [input.connectionId, input.orgId, input.agentId, input.sourceId],
      );
      if (validScope.rows[0] === undefined) scopeInvalid();

      const inserted = await client.query<X402AttemptRow>(
        `INSERT INTO runtime_payment_attempts (
           id, org_id, agent_id, connection_id, source_id, idempotency_key,
           request_hash, quote_hash, amount_usdc, asset, rail, network, recipient,
           status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'reserved')
         ON CONFLICT (connection_id, idempotency_key) DO NOTHING
         RETURNING ${ATTEMPT_COLUMNS}`,
        [
          prefixedId('rpa'),
          input.orgId,
          input.agentId,
          input.connectionId,
          input.sourceId,
          input.idempotencyKey,
          input.requestHash,
          input.quoteHash,
          input.amountUsdc,
          input.asset,
          input.rail,
          input.network,
          input.recipient,
        ],
      );
      const created = inserted.rows[0];
      if (created !== undefined) return attemptFromRow(created);

      const existing = await client.query<X402AttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS}
           FROM runtime_payment_attempts
          WHERE connection_id = $1 AND idempotency_key = $2
          FOR UPDATE`,
        [input.connectionId, input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        throw new Error('payment_attempt_idempotency_row_missing');
      }
      if (row.request_hash !== input.requestHash) {
        throw conflict(
          'payment_idempotency_conflict',
          'This idempotency key is already bound to a different payment request.',
        );
      }
      const scrubbed = await client.query<X402AttemptRow>(
        `UPDATE runtime_payment_attempts
            SET encrypted_result = NULL,
                result_expires_at = NULL,
                updated_at = now()
          WHERE id = $1 AND result_expires_at <= now()
          RETURNING ${ATTEMPT_COLUMNS}`,
        [row.id],
      );
      return attemptFromRow(scrubbed.rows[0] ?? row);
    }),

    markSubmitting: async (scope, attemptId) => transition(
      pool,
      scope,
      attemptId,
      `UPDATE runtime_payment_attempts
          SET status = 'submitting', submitted_at = now(), updated_at = now()
        WHERE id = $1
          AND org_id = $2
          AND connection_id = $3
          AND status = 'reserved'
        RETURNING ${ATTEMPT_COLUMNS}`,
      [attemptId, scope.orgId, scope.connectionId],
    ),

    finalizeSettled: async (scope, attemptId, input) => {
      const values = finalizationValues(resultCrypto, scope, attemptId, input);
      return transition(
        pool,
        scope,
        attemptId,
        `UPDATE runtime_payment_attempts
            SET status = 'settled',
                payment_metadata = COALESCE($4::jsonb, payment_metadata),
                response_metadata = COALESCE($5::jsonb, response_metadata),
                encrypted_result = COALESCE($6::jsonb, encrypted_result),
                result_expires_at = CASE
                  WHEN $6::jsonb IS NULL THEN result_expires_at
                  ELSE now() + interval '15 minutes'
                END,
                error_code = NULL,
                finalized_at = now(),
                updated_at = now()
          WHERE id = $1
            AND org_id = $2
            AND connection_id = $3
            AND status = 'submitting'
          RETURNING ${ATTEMPT_COLUMNS}`,
        [attemptId, scope.orgId, scope.connectionId, ...values],
      );
    },

    finalizeFailed: async (scope, attemptId, input) => {
      const values = finalizationValues(resultCrypto, scope, attemptId, input);
      const requiredStatus = input.providerCallMade ? 'submitting' : 'reserved';
      return transition(
        pool,
        scope,
        attemptId,
        `UPDATE runtime_payment_attempts
            SET status = 'failed',
                payment_metadata = COALESCE($4::jsonb, payment_metadata),
                response_metadata = COALESCE($5::jsonb, response_metadata),
                encrypted_result = COALESCE($6::jsonb, encrypted_result),
                result_expires_at = CASE
                  WHEN $6::jsonb IS NULL THEN result_expires_at
                  ELSE now() + interval '15 minutes'
                END,
                error_code = $7,
                finalized_at = now(),
                updated_at = now()
          WHERE id = $1
            AND org_id = $2
            AND connection_id = $3
            AND status = $8
          RETURNING ${ATTEMPT_COLUMNS}`,
        [
          attemptId,
          scope.orgId,
          scope.connectionId,
          ...values,
          input.errorCode,
          requiredStatus,
        ],
      );
    },

    finalizeUnknown: async (scope, attemptId, input) => {
      const values = finalizationValues(resultCrypto, scope, attemptId, input);
      return transition(
        pool,
        scope,
        attemptId,
        `UPDATE runtime_payment_attempts
            SET status = 'unknown',
                payment_metadata = COALESCE($4::jsonb, payment_metadata),
                response_metadata = COALESCE($5::jsonb, response_metadata),
                encrypted_result = COALESCE($6::jsonb, encrypted_result),
                result_expires_at = CASE
                  WHEN $6::jsonb IS NULL THEN result_expires_at
                  ELSE now() + interval '15 minutes'
                END,
                error_code = $7,
                finalized_at = now(),
                updated_at = now()
          WHERE id = $1
            AND org_id = $2
            AND connection_id = $3
            AND status = 'submitting'
          RETURNING ${ATTEMPT_COLUMNS}`,
        [attemptId, scope.orgId, scope.connectionId, ...values, input.errorCode],
      );
    },
  };
}
