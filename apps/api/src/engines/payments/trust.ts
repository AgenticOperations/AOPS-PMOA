import type pg from 'pg';
import { conflict } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import type { EscrowJobRow } from './escrow.js';
import { formatUsdc, parseUsdcMicros, recordSignedDelegation, revokeDelegation } from './permit2.js';
import type { PaymentChain, PaymentMode } from './types.js';

// Duplicated from permit2.ts/escrow.ts (not imported) for the same reason
// those two duplicate it from store.ts: store.ts doesn't import from this
// engine, and importing it here would create a cycle.
async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Anything with a `.query` method -- a pg.Pool or a pg.PoolClient mid-transaction. */
type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

export type TrustEvidenceInput = {
  readonly orgId: string;
  readonly chain: PaymentChain;
  readonly mode: PaymentMode;
  readonly address: string;
};

export type TrustEvidence = {
  readonly completedCount: number;
  // The chain refunds 'rejected' and 'expired' identically, but "delivered
  // and judged unacceptable" is not the same signal to a human reviewer as
  // "delivered but nobody ever evaluated it" -- kept as distinct counts
  // rather than folded into one "not completed" number.
  readonly rejectedCount: number;
  readonly expiredCount: number;
  readonly settledUsdc: string;
  // True once an ACTIVE allowlist row exists for this (org, chain,
  // address). Scoped per org deliberately: one org trusting an address
  // tells another org nothing about it.
  readonly trusted: boolean;
  // The human is reviewing work, not a score -- the console needs the
  // actual jobs, not just the counts above.
  readonly jobs: readonly EscrowJobRow[];
};

async function queryTrustEvidence(db: Queryable, input: TrustEvidenceInput): Promise<TrustEvidence> {
  const jobsResult = await db.query<EscrowJobRow>(
    `SELECT * FROM escrow_jobs
      WHERE org_id = $1 AND chain = $2 AND mode = $3 AND lower(provider_address) = lower($4)
      ORDER BY created_at DESC`,
    [input.orgId, input.chain, input.mode, input.address],
  );
  const jobs = jobsResult.rows;

  let completedCount = 0;
  let rejectedCount = 0;
  let expiredCount = 0;
  let settledMicros = 0n;
  for (const job of jobs) {
    if (job.state === 'completed') {
      completedCount += 1;
      settledMicros += parseUsdcMicros(job.budget_usdc);
    } else if (job.state === 'rejected') {
      rejectedCount += 1;
    } else if (job.state === 'expired') {
      expiredCount += 1;
    }
  }

  // Not mode-scoped: the allowlist has no mode column (a payTo address is
  // either trusted for this org on this chain or it is not), and promotion
  // itself always deals from the treasury regardless of test/live.
  const allowlistResult = await db.query<{ status: string }>(
    `SELECT status FROM payment_destination_allowlist
      WHERE org_id = $1 AND chain = $2 AND lower(address) = lower($3)`,
    [input.orgId, input.chain, input.address],
  );
  const trusted = allowlistResult.rows.some((row) => row.status === 'active');

  return {
    completedCount,
    rejectedCount,
    expiredCount,
    settledUsdc: formatUsdc(settledMicros),
    trusted,
    jobs,
  };
}

/** Assembles an external agent's escrow track record for a human to review. */
export async function getTrustEvidence(pool: pg.Pool, input: TrustEvidenceInput): Promise<TrustEvidence> {
  return queryTrustEvidence(pool, input);
}

export type TrustExternalAgentInput = {
  readonly orgId: string;
  readonly chain: PaymentChain;
  readonly mode: PaymentMode;
  readonly address: string;
  readonly label: string;
  readonly ceilingUsdc: string;
  readonly expiresAt: Date;
  // The real user id of the person who reviewed the work and decided to
  // promote it. Never 'system' -- that would defeat the entire point of
  // this engine. Contrast agent-payee.ts:55, which legitimately writes a
  // system-authored allowlist row for a FLEET agent's own wallet, where no
  // trust decision is involved because the platform already controls it.
  readonly approvedBy: string;
};

export type TrustExternalAgentResult = {
  readonly allowlistId: string;
  readonly delegationId: string;
};

/**
 * Promotes an external agent to the Permit2 rail -- the human act at the
 * center of this engine. Writes the allowlist checkmark and opens the
 * delegation together: a checkmark with no delegation behind it is a lie
 * the console would display, so if the delegation fails the allowlist
 * insert must not survive either.
 *
 * recordSignedDelegation manages its own transaction on its own pool
 * connection (it takes a Pool, not a client -- reused as-is rather than
 * writing a second delegation path, per the plan). That makes this two
 * physical transactions, not one atomic multi-table transaction. Atomicity
 * of the OUTCOME still holds: if recordSignedDelegation throws, its own
 * internal transaction has already rolled back the delegation insert, and
 * the thrown error propagates out through this function's withTransaction,
 * rolling back the allowlist insert above in turn.
 */
export async function trustExternalAgent(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: TrustExternalAgentInput,
): Promise<TrustExternalAgentResult> {
  return withTransaction(pool, async (client) => {
    const evidence = await queryTrustEvidence(client, {
      orgId: input.orgId, chain: input.chain, mode: input.mode, address: input.address,
    });

    // Evidence is what makes this a judgement rather than a guess. Without
    // any completed job there is nothing for a human to have reviewed.
    if (evidence.completedCount === 0) {
      throw conflict(
        'trust_requires_escrow_history',
        'trust_requires_escrow_history: this address has no completed escrow jobs with this org, so there is nothing here for a human to have reviewed.',
      );
    }
    if (evidence.trusted) {
      throw conflict('agent_already_trusted', 'agent_already_trusted: this address is already trusted on this chain.');
    }

    const allowlistId = prefixedId('payto');
    await client.query(
      `INSERT INTO payment_destination_allowlist (id, org_id, chain, address, label, source, created_by, approved_by)
       VALUES ($1, $2, $3, $4, $5, 'marketplace', $6, $6)
       ON CONFLICT (org_id, chain, address) DO NOTHING`,
      [allowlistId, input.orgId, input.chain, input.address, input.label, input.approvedBy],
    );

    // Treasury-funded: a graduation delegation pays from the org's shared
    // pool, not from a fleet agent's own wallet -- the whole point is that
    // this address is NOT one of our agents.
    const delegation = await recordSignedDelegation(pool, provider, {
      orgId: input.orgId,
      payeeAddress: input.address,
      mode: input.mode,
      chain: input.chain,
      ceilingUsdc: input.ceilingUsdc,
      expiresAt: input.expiresAt,
      approvedBy: input.approvedBy,
      payerTreasury: true,
    });

    return { allowlistId, delegationId: delegation.id };
  });
}

export type RevokeTrustInput = {
  readonly orgId: string;
  readonly chain: PaymentChain;
  readonly mode: PaymentMode;
  readonly address: string;
  // No column to persist this into -- neither destination table gained one
  // ("No migration" is the point of this design), so nothing here writes
  // it. Required anyway so the route layer is forced to take it from the
  // authenticated session rather than quietly omitting who acted, matching
  // the same discipline approvedBy enforces on promotion.
  readonly revokedBy: string;
};

/**
 * Revokes trust in both halves: the allowlist checkmark locally, and every
 * active delegation naming this address as payee on-chain via the existing
 * revokeDelegation (which itself decides whether it can submit lockdown()
 * based on who holds the payer's key -- see permit2.ts). Escrow history is
 * never touched: it is evidence, not a grant, and survives revocation.
 */
export async function revokeTrust(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: RevokeTrustInput,
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const allowlist = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM payment_destination_allowlist
        WHERE org_id = $1 AND chain = $2 AND lower(address) = lower($3)
        FOR UPDATE`,
      [input.orgId, input.chain, input.address],
    );
    const row = allowlist.rows[0];
    if (row === undefined || row.status !== 'active') {
      throw conflict('agent_not_trusted', 'agent_not_trusted: this address is not currently trusted on this chain.');
    }

    await client.query(
      `UPDATE payment_destination_allowlist SET status = 'revoked' WHERE id = $1`,
      [row.id],
    );

    const delegations = await client.query<{ id: string }>(
      `SELECT id FROM agent_delegations
        WHERE org_id = $1 AND chain = $2 AND mode = $3 AND lower(payee_address) = lower($4) AND status = 'active'`,
      [input.orgId, input.chain, input.mode, input.address],
    );
    for (const delegation of delegations.rows) {
      await revokeDelegation(pool, provider, { delegationId: delegation.id });
    }
  });
}
