import type pg from 'pg';
import { conflict } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import type { PaymentRail } from './types.js';

export type X402AttemptStatus = 'reserved' | 'submitting' | 'settled' | 'failed' | 'unknown';

export type X402PaymentMetadata = {
  readonly providerReference?: string | undefined;
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
  readonly encrypted_result: Readonly<Record<string, unknown>> | null;
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

type X402AttemptFinalizationInput = {
  readonly encryptedResult?: Readonly<Record<string, unknown>> | undefined;
  readonly paymentMetadata?: X402PaymentMetadata | undefined;
  readonly responseMetadata?: X402SafeResponseMetadata | undefined;
  readonly resultExpiresAt?: Date | undefined;
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
  readonly markSubmitting: (attemptId: string) => Promise<X402AttemptRecord>;
  readonly finalizeSettled: (
    attemptId: string,
    input: FinalizeSettledX402AttemptInput,
  ) => Promise<X402AttemptRecord>;
  readonly finalizeFailed: (
    attemptId: string,
    input: FinalizeFailedX402AttemptInput,
  ) => Promise<X402AttemptRecord>;
  readonly finalizeUnknown: (
    attemptId: string,
    input: FinalizeUnknownX402AttemptInput,
  ) => Promise<X402AttemptRecord>;
};

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
  'providerReference',
  'receiptId',
  'transactionHash',
]);
const RESPONSE_METADATA_KEYS = new Set([
  'contentLength',
  'contentType',
  'statusCode',
]);

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
      : objectFromDatabase(row.encrypted_result, 'encrypted_result'),
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

function validateEncryptedResult(result: Readonly<Record<string, unknown>> | undefined): void {
  if (result !== undefined && !isObject(result)) {
    throw new Error('payment_attempt_invalid_encrypted_result');
  }
}

function finalizationValues(input: X402AttemptFinalizationInput): readonly unknown[] {
  validatePaymentMetadata(input.paymentMetadata);
  validateResponseMetadata(input.responseMetadata);
  validateEncryptedResult(input.encryptedResult);
  return [
    input.paymentMetadata === undefined ? null : JSON.stringify(input.paymentMetadata),
    input.responseMetadata === undefined ? null : JSON.stringify(input.responseMetadata),
    input.encryptedResult === undefined ? null : JSON.stringify(input.encryptedResult),
    input.resultExpiresAt ?? null,
  ];
}

function stateConflict(): never {
  throw conflict(
    'payment_attempt_state_conflict',
    'The payment attempt is not in the required state.',
  );
}

async function transaction<T>(
  pool: pg.Pool,
  operation: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
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
  pool: pg.Pool,
  sql: string,
  values: unknown[],
): Promise<X402AttemptRecord> {
  const result = await pool.query<X402AttemptRow>(sql, values);
  const row = result.rows[0];
  if (row === undefined) stateConflict();
  return attemptFromRow(row);
}

export function createPostgresX402AttemptStore(pool: pg.Pool): X402AttemptStore {
  const findAttempt = async (
    connectionId: string,
    idempotencyKey: string,
  ): Promise<X402AttemptRecord | null> => {
    const result = await pool.query<X402AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS}
         FROM runtime_payment_attempts
        WHERE connection_id = $1 AND idempotency_key = $2
        LIMIT 1`,
      [connectionId, idempotencyKey],
    );
    const row = result.rows[0];
    return row === undefined ? null : attemptFromRow(row);
  };

  return {
    findAttempt,

    createAttempt: async (input) => transaction(pool, async (client) => {
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
      return attemptFromRow(row);
    }),

    markSubmitting: async (attemptId) => transition(
      pool,
      `UPDATE runtime_payment_attempts
          SET status = 'submitting', submitted_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'reserved'
        RETURNING ${ATTEMPT_COLUMNS}`,
      [attemptId],
    ),

    finalizeSettled: async (attemptId, input) => {
      const values = finalizationValues(input);
      return transition(
        pool,
        `UPDATE runtime_payment_attempts
            SET status = 'settled',
                payment_metadata = COALESCE($2::jsonb, payment_metadata),
                response_metadata = COALESCE($3::jsonb, response_metadata),
                encrypted_result = COALESCE($4::jsonb, encrypted_result),
                result_expires_at = COALESCE($5::timestamptz, result_expires_at),
                error_code = NULL,
                finalized_at = now(),
                updated_at = now()
          WHERE id = $1 AND status = 'submitting'
          RETURNING ${ATTEMPT_COLUMNS}`,
        [attemptId, ...values],
      );
    },

    finalizeFailed: async (attemptId, input) => {
      const values = finalizationValues(input);
      const requiredStatus = input.providerCallMade ? 'submitting' : 'reserved';
      return transition(
        pool,
        `UPDATE runtime_payment_attempts
            SET status = 'failed',
                payment_metadata = COALESCE($2::jsonb, payment_metadata),
                response_metadata = COALESCE($3::jsonb, response_metadata),
                encrypted_result = COALESCE($4::jsonb, encrypted_result),
                result_expires_at = COALESCE($5::timestamptz, result_expires_at),
                error_code = $6,
                finalized_at = now(),
                updated_at = now()
          WHERE id = $1 AND status = $7
          RETURNING ${ATTEMPT_COLUMNS}`,
        [attemptId, ...values, input.errorCode, requiredStatus],
      );
    },

    finalizeUnknown: async (attemptId, input) => {
      const values = finalizationValues(input);
      return transition(
        pool,
        `UPDATE runtime_payment_attempts
            SET status = 'unknown',
                payment_metadata = COALESCE($2::jsonb, payment_metadata),
                response_metadata = COALESCE($3::jsonb, response_metadata),
                encrypted_result = COALESCE($4::jsonb, encrypted_result),
                result_expires_at = COALESCE($5::timestamptz, result_expires_at),
                error_code = $6,
                finalized_at = now(),
                updated_at = now()
          WHERE id = $1 AND status = 'submitting'
          RETURNING ${ATTEMPT_COLUMNS}`,
        [attemptId, ...values, input.errorCode],
      );
    },
  };
}
