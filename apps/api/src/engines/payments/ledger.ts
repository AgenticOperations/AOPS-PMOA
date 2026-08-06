import type pg from 'pg';
import { prefixedId } from '../identity/ids.js';
import type { PaymentChain, PaymentMode } from './types.js';

// ---------------------------------------------------------------------------
// Append-only ledger [manifest E5]. The manifest scopes this as "minimum
// viable version: append-only postings with derived balances, keeping
// counters as a cache" -- explicitly NOT full double-entry. Say so honestly
// wherever this is described.
//
// The existing destructive counters (agent_payment_accounts.reserved_usdc /
// spent_usdc) are NOT removed. They stay the fast cache every read path
// already uses; this table becomes the record those counters can be
// reconstructed FROM. deriveSpentUsdc's whole job is proving the two agree.
// ---------------------------------------------------------------------------

export type LedgerEntryType = 'reserve' | 'release' | 'settle' | 'topup' | 'sweep' | 'deposit' | 'correction';

export type LedgerPostingRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string | null;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain | null;
  readonly entry_type: LedgerEntryType;
  readonly amount_usdc: string;
  readonly reservation_id: string | null;
  readonly attempt_id: string | null;
  readonly job_id: string | null;
  readonly corrects_posting_id: string | null;
  readonly reason_code: string;
  readonly created_by: string;
  readonly created_at: Date;
};

export type WritePostingInput = {
  readonly orgId: string;
  readonly agentId?: string | undefined;
  readonly mode: PaymentMode;
  readonly chain?: PaymentChain | undefined;
  readonly entryType: LedgerEntryType;
  // Signed: reserve is negative (money leaves "available"), release and
  // settle are positive, correction is whatever offsets the posting it
  // targets.
  readonly amountUsdc: string;
  readonly reservationId?: string | undefined;
  readonly attemptId?: string | undefined;
  readonly jobId?: string | undefined;
  readonly reasonCode: string;
  readonly createdBy: string;
};

type Db = pg.Pool | pg.PoolClient;

/**
 * Writes one posting. Takes a `pg.PoolClient` when called from inside an
 * existing money-movement transaction (the normal case -- a posting and the
 * counter update it mirrors must land together or not at all) or a `Pool`
 * for one-off writes like a manual correction.
 *
 * The `reservation_id OR attempt_id OR job_id OR corrects_posting_id`
 * constraint is enforced by the table itself (migration 0034), not
 * re-checked here -- a posting with none of the four fails to insert at
 * all, the same "rejected at the database level" pattern Phase 8's
 * reputation gating already uses.
 */
export async function writePosting(db: Db, input: WritePostingInput): Promise<LedgerPostingRow> {
  const inserted = await db.query<LedgerPostingRow>(
    `INSERT INTO ledger_postings (
       id, org_id, agent_id, mode, chain, entry_type, amount_usdc,
       reservation_id, attempt_id, job_id, reason_code, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      prefixedId('post'),
      input.orgId,
      input.agentId ?? null,
      input.mode,
      input.chain ?? null,
      input.entryType,
      input.amountUsdc,
      input.reservationId ?? null,
      input.attemptId ?? null,
      input.jobId ?? null,
      input.reasonCode,
      input.createdBy,
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('ledger_posting_insert_failed');
  return row;
}

export type CorrectPostingInput = {
  readonly postingId: string;
  readonly reasonCode: string;
  readonly createdBy?: string | undefined;
};

/**
 * Corrects a posting by appending its exact negation, referencing it via
 * `corrects_posting_id` -- never by editing or deleting the original, which
 * the table's own trigger refuses anyway. This is what makes a correction
 * itself part of the permanent record instead of erasing the mistake.
 */
export async function correctPosting(pool: pg.Pool, input: CorrectPostingInput): Promise<LedgerPostingRow> {
  const original = await pool.query<LedgerPostingRow>(
    'SELECT * FROM ledger_postings WHERE id = $1', [input.postingId],
  );
  const row = original.rows[0];
  if (row === undefined) throw new Error('ledger_posting_not_found');

  const offsetAmount = (-Number(row.amount_usdc)).toFixed(6);
  const inserted = await pool.query<LedgerPostingRow>(
    `INSERT INTO ledger_postings (
       id, org_id, agent_id, mode, chain, entry_type, amount_usdc,
       corrects_posting_id, reason_code, created_by
     )
     VALUES ($1, $2, $3, $4, $5, 'correction', $6::numeric, $7, $8, $9)
     RETURNING *`,
    [
      prefixedId('post'),
      row.org_id,
      row.agent_id,
      row.mode,
      row.chain,
      offsetAmount,
      input.postingId,
      input.reasonCode,
      input.createdBy ?? 'system',
    ],
  );
  const correction = inserted.rows[0];
  if (correction === undefined) throw new Error('ledger_correction_insert_failed');
  return correction;
}

export type DeriveSpentUsdcInput = {
  readonly orgId: string;
  readonly agentId: string;
  readonly mode: PaymentMode;
};

/**
 * Reconstructs `agent_payment_accounts.spent_usdc` from postings alone --
 * proof the two representations agree, not a second source of truth to keep
 * in sync by hand. Sums 'settle' postings plus any correction that targets
 * one, so a correction actually moves the derived total rather than only
 * existing for the record.
 */
export async function deriveSpentUsdc(pool: pg.Pool, input: DeriveSpentUsdcInput): Promise<string> {
  const result = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(p.amount_usdc), 0)::text AS total
       FROM ledger_postings p
       LEFT JOIN ledger_postings corrected ON corrected.id = p.corrects_posting_id
      WHERE p.org_id = $1 AND p.agent_id = $2 AND p.mode = $3
        AND (p.entry_type = 'settle' OR corrected.entry_type = 'settle')`,
    [input.orgId, input.agentId, input.mode],
  );
  const total = result.rows[0]?.total ?? '0';
  // agent_payment_accounts.spent_usdc is numeric(20,6) and always rendered
  // with 6 places -- match that so a direct string comparison in tests
  // isn't tripped up by trailing-zero formatting differences.
  return Number(total).toFixed(6);
}
