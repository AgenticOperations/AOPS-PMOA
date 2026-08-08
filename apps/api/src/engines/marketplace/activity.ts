import type pg from 'pg';
import type { MarketplaceListing } from './store.js';

export type MarketplaceActivityPoint = {
  readonly day: string;
  readonly settledUsdc: string;
  readonly completedJobs: number;
  readonly reputationEvents: number;
};

export type MarketplaceActivityEvent = {
  readonly id: string;
  readonly day: string;
  readonly kind: 'fleet_hire' | 'x402' | 'escrow';
  readonly label: string;
  readonly amountUsdc: string;
  readonly chain: string;
  readonly txHash: string | null;
  readonly explorerUrl: string | null;
  readonly occurredAt: string;
};

export type MarketplaceListingActivity = {
  readonly listingId: string;
  readonly agentId: string | null;
  readonly providerAddress: string | null;
  readonly reputationScore: number;
  readonly reputationEvents: number;
  readonly completedJobs: number;
  readonly rejectedJobs: number;
  readonly settledUsdc: string;
  readonly series: readonly MarketplaceActivityPoint[];
  readonly recentEvents: readonly MarketplaceActivityEvent[];
};

const EXPLORER_TX: Readonly<Record<string, string>> = {
  arc: 'https://testnet.arcscan.app/tx/',
  base: 'https://sepolia.basescan.org/tx/',
};

/** Ignore demo chart-seed rows — only real settlement evidence. */
const NOT_SEEDED_PAYMENT = `coalesce(result->>'seed_tag', '') = ''`;
const NOT_SEEDED_ESCROW = `created_by <> 'marketplace_purchase_script'`;

const EMPTY_ACTIVITY = (
  listing: MarketplaceListing,
): MarketplaceListingActivity => ({
  listingId: listing.id,
  agentId: listing.agentId,
  providerAddress: listing.providerAddress,
  reputationScore: 0,
  reputationEvents: 0,
  completedJobs: 0,
  rejectedJobs: 0,
  settledUsdc: '0.000000',
  series: [],
  recentEvents: [],
});

/**
 * Public seller-side activity for marketplace detail charts.
 * Never includes buyer-org trust evidence or allowlist state.
 */
export async function getMarketplaceListingActivity(
  pool: pg.Pool,
  listing: MarketplaceListing,
  input: { readonly days?: number | undefined } = {},
): Promise<MarketplaceListingActivity> {
  const days = Math.min(90, Math.max(1, input.days ?? 30));
  if (listing.agentId === null && listing.providerAddress === null) {
    return EMPTY_ACTIVITY(listing);
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const reputation = listing.agentId === null
    ? { score: 0, events: 0 }
    : await loadReputation(pool, listing.agentId);

  const escrow = await loadEscrowStats(pool, {
    agentId: listing.agentId,
    providerAddress: listing.providerAddress,
    since,
  });
  const fleet = await loadFleetHireStats(pool, {
    agentId: listing.agentId,
    providerAddress: listing.providerAddress,
    since,
  });

  const series = await loadActivitySeries(pool, {
    agentId: listing.agentId,
    providerAddress: listing.providerAddress,
    since,
  });
  const recentEvents = await loadRecentEvents(pool, {
    agentId: listing.agentId,
    providerAddress: listing.providerAddress,
    since,
  });

  return {
    listingId: listing.id,
    agentId: listing.agentId,
    providerAddress: listing.providerAddress,
    reputationScore: reputation.score,
    reputationEvents: reputation.events,
    completedJobs: escrow.completed + fleet.completed,
    rejectedJobs: escrow.rejected,
    settledUsdc: addUsdc(escrow.settledUsdc, fleet.settledUsdc),
    series,
    recentEvents,
  };
}

function addUsdc(left: string, right: string): string {
  const sum = (Number.parseFloat(left) || 0) + (Number.parseFloat(right) || 0);
  return sum.toFixed(6);
}

async function loadFleetHireStats(
  pool: pg.Pool,
  input: {
    readonly agentId: string | null;
    readonly providerAddress: string | null;
    readonly since: Date;
  },
): Promise<{ readonly completed: number; readonly settledUsdc: string }> {
  // Prefer payee_agent_id when present so shared demo wallets do not
  // attribute one agent's fleet hires to every listing on that address.
  if (input.agentId !== null) {
    const byAgent = await pool.query<{ completed: string; settled_usdc: string | null }>(
      `SELECT COUNT(*)::text AS completed,
              COALESCE(SUM(amount_usdc), 0)::text AS settled_usdc
         FROM payment_events
        WHERE decision = 'settled'
          AND coalesce(result->>'lane', '') = 'permit2_intra_fleet'
          AND result->>'payee_agent_id' = $1
          AND ${NOT_SEEDED_PAYMENT}
          AND created_at >= $2`,
      [input.agentId, input.since],
    );
    const row = byAgent.rows[0];
    return {
      completed: Number.parseInt(row?.completed ?? '0', 10) || 0,
      settledUsdc: row?.settled_usdc ?? '0.000000',
    };
  }
  if (input.providerAddress === null) {
    return { completed: 0, settledUsdc: '0.000000' };
  }
  const result = await pool.query<{ completed: string; settled_usdc: string | null }>(
    `SELECT COUNT(*)::text AS completed,
            COALESCE(SUM(amount_usdc), 0)::text AS settled_usdc
       FROM payment_events
      WHERE decision = 'settled'
        AND lower(recipient) = lower($1)
        AND coalesce(result->>'lane', '') = 'permit2_intra_fleet'
        AND ${NOT_SEEDED_PAYMENT}
        AND created_at >= $2`,
    [input.providerAddress, input.since],
  );
  const row = result.rows[0];
  return {
    completed: Number.parseInt(row?.completed ?? '0', 10) || 0,
    settledUsdc: row?.settled_usdc ?? '0.000000',
  };
}

async function loadReputation(
  pool: pg.Pool,
  agentId: string,
): Promise<{ readonly score: number; readonly events: number }> {
  const result = await pool.query<{ score: string | null; events: string }>(
    `SELECT COALESCE(SUM(score), 0)::text AS score, COUNT(*)::text AS events
       FROM agent_reputation_events
      WHERE agent_id = $1`,
    [agentId],
  );
  const row = result.rows[0];
  return {
    score: Number.parseInt(row?.score ?? '0', 10) || 0,
    events: Number.parseInt(row?.events ?? '0', 10) || 0,
  };
}

async function loadEscrowStats(
  pool: pg.Pool,
  input: {
    readonly agentId: string | null;
    readonly providerAddress: string | null;
    readonly since: Date;
  },
): Promise<{ readonly completed: number; readonly rejected: number; readonly settledUsdc: string }> {
  // Provider address is the public payee key. When we also know agentId,
  // still key off provider_address so cross-org hires to that wallet count.
  if (input.providerAddress === null) {
    return { completed: 0, rejected: 0, settledUsdc: '0.000000' };
  }

  const result = await pool.query<{
    completed: string;
    rejected: string;
    settled_usdc: string | null;
  }>(
    `SELECT
        COUNT(*) FILTER (WHERE state = 'completed')::text AS completed,
        COUNT(*) FILTER (WHERE state IN ('rejected', 'expired'))::text AS rejected,
        COALESCE(SUM(budget_usdc) FILTER (WHERE state = 'completed'), 0)::text AS settled_usdc
       FROM escrow_jobs
      WHERE lower(provider_address) = lower($1)
        AND ${NOT_SEEDED_ESCROW}
        AND created_at >= $2`,
    [input.providerAddress, input.since],
  );
  const row = result.rows[0];
  return {
    completed: Number.parseInt(row?.completed ?? '0', 10) || 0,
    rejected: Number.parseInt(row?.rejected ?? '0', 10) || 0,
    settledUsdc: row?.settled_usdc ?? '0.000000',
  };
}

async function loadActivitySeries(
  pool: pg.Pool,
  input: {
    readonly agentId: string | null;
    readonly providerAddress: string | null;
    readonly since: Date;
  },
): Promise<readonly MarketplaceActivityPoint[]> {
  const byDay = new Map<string, MarketplaceActivityPoint>();

  if (input.providerAddress !== null) {
    const escrowDays = await pool.query<{
      day: string;
      settled_usdc: string;
      completed: string;
    }>(
      `SELECT to_char(date_trunc('day', updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
              COALESCE(SUM(budget_usdc) FILTER (WHERE state = 'completed'), 0)::text AS settled_usdc,
              COUNT(*) FILTER (WHERE state = 'completed')::text AS completed
         FROM escrow_jobs
        WHERE lower(provider_address) = lower($1)
          AND ${NOT_SEEDED_ESCROW}
          AND created_at >= $2
        GROUP BY 1
        ORDER BY 1 ASC`,
      [input.providerAddress, input.since],
    );
    for (const row of escrowDays.rows) {
      byDay.set(row.day, {
        day: row.day,
        settledUsdc: row.settled_usdc,
        completedJobs: Number.parseInt(row.completed, 10) || 0,
        reputationEvents: 0,
      });
    }

    const fleetDays = await pool.query<{
      day: string;
      settled_usdc: string;
      completed: string;
    }>(
      input.agentId !== null
        ? `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                  COALESCE(SUM(amount_usdc), 0)::text AS settled_usdc,
                  COUNT(*)::text AS completed
             FROM payment_events
            WHERE decision = 'settled'
              AND coalesce(result->>'lane', '') = 'permit2_intra_fleet'
              AND result->>'payee_agent_id' = $1
              AND ${NOT_SEEDED_PAYMENT}
              AND created_at >= $2
            GROUP BY 1
            ORDER BY 1 ASC`
        : `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                  COALESCE(SUM(amount_usdc), 0)::text AS settled_usdc,
                  COUNT(*)::text AS completed
             FROM payment_events
            WHERE decision = 'settled'
              AND lower(recipient) = lower($1)
              AND coalesce(result->>'lane', '') = 'permit2_intra_fleet'
              AND ${NOT_SEEDED_PAYMENT}
              AND created_at >= $2
            GROUP BY 1
            ORDER BY 1 ASC`,
      input.agentId !== null
        ? [input.agentId, input.since]
        : [input.providerAddress, input.since],
    );
    for (const row of fleetDays.rows) {
      const existing = byDay.get(row.day);
      const fleetJobs = Number.parseInt(row.completed, 10) || 0;
      if (existing === undefined) {
        byDay.set(row.day, {
          day: row.day,
          settledUsdc: row.settled_usdc,
          completedJobs: fleetJobs,
          reputationEvents: 0,
        });
      } else {
        byDay.set(row.day, {
          ...existing,
          settledUsdc: addUsdc(existing.settledUsdc, row.settled_usdc),
          completedJobs: existing.completedJobs + fleetJobs,
        });
      }
    }
  }

  if (input.agentId !== null) {
    const repDays = await pool.query<{ day: string; events: string }>(
      `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
              COUNT(*)::text AS events
         FROM agent_reputation_events
        WHERE agent_id = $1
          AND created_at >= $2
        GROUP BY 1
        ORDER BY 1 ASC`,
      [input.agentId, input.since],
    );
    for (const row of repDays.rows) {
      const existing = byDay.get(row.day);
      if (existing === undefined) {
        byDay.set(row.day, {
          day: row.day,
          settledUsdc: '0.000000',
          completedJobs: 0,
          reputationEvents: Number.parseInt(row.events, 10) || 0,
        });
      } else {
        byDay.set(row.day, {
          ...existing,
          reputationEvents: Number.parseInt(row.events, 10) || 0,
        });
      }
    }
  }

  return [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day));
}

function explorerUrlFor(chain: string, txHash: string | null): string | null {
  if (txHash === null || txHash.length === 0) return null;
  const base = EXPLORER_TX[chain];
  return base === undefined ? null : `${base}${txHash}`;
}

async function loadRecentEvents(
  pool: pg.Pool,
  input: {
    readonly agentId: string | null;
    readonly providerAddress: string | null;
    readonly since: Date;
  },
): Promise<readonly MarketplaceActivityEvent[]> {
  const events: MarketplaceActivityEvent[] = [];

  if (input.agentId !== null || input.providerAddress !== null) {
    const payments = await pool.query<{
      id: string;
      day: string;
      amount_usdc: string;
      chain: string;
      tx_hash: string | null;
      lane: string | null;
      label: string | null;
      occurred_at: string;
    }>(
      input.agentId !== null
        ? `SELECT id,
                  to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                  amount_usdc::text,
                  chain,
                  result->>'tx_hash' AS tx_hash,
                  result->>'lane' AS lane,
                  coalesce(resource_category, result->>'payee_name', 'Fleet hire') AS label,
                  created_at::text AS occurred_at
             FROM payment_events
            WHERE decision = 'settled'
              AND ${NOT_SEEDED_PAYMENT}
              AND result->>'payee_agent_id' = $1
              AND created_at >= $2
            ORDER BY created_at DESC
            LIMIT 40`
        : `SELECT id,
                  to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                  amount_usdc::text,
                  chain,
                  result->>'tx_hash' AS tx_hash,
                  result->>'lane' AS lane,
                  coalesce(resource_category, 'Hire') AS label,
                  created_at::text AS occurred_at
             FROM payment_events
            WHERE decision = 'settled'
              AND ${NOT_SEEDED_PAYMENT}
              AND lower(recipient) = lower($1)
              AND created_at >= $2
            ORDER BY created_at DESC
            LIMIT 40`,
      input.agentId !== null
        ? [input.agentId, input.since]
        : [input.providerAddress, input.since],
    );
    for (const row of payments.rows) {
      const kind = row.lane === 'permit2_intra_fleet' ? 'fleet_hire' : 'x402';
      events.push({
        id: row.id,
        day: row.day,
        kind,
        label: row.label ?? 'Hire',
        amountUsdc: row.amount_usdc,
        chain: row.chain,
        txHash: row.tx_hash,
        explorerUrl: explorerUrlFor(row.chain, row.tx_hash),
        occurredAt: row.occurred_at,
      });
    }
  }

  if (input.providerAddress !== null) {
    const escrow = await pool.query<{
      id: string;
      day: string;
      amount_usdc: string;
      chain: string;
      tx_hash: string | null;
      occurred_at: string;
    }>(
      `SELECT id,
              to_char(date_trunc('day', updated_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
              budget_usdc::text AS amount_usdc,
              chain,
              coalesce(terminal_tx_hash, submit_tx_hash, fund_tx_hash, create_tx_hash) AS tx_hash,
              updated_at::text AS occurred_at
         FROM escrow_jobs
        WHERE lower(provider_address) = lower($1)
          AND state = 'completed'
          AND ${NOT_SEEDED_ESCROW}
          AND created_at >= $2
        ORDER BY updated_at DESC
        LIMIT 20`,
      [input.providerAddress, input.since],
    );
    for (const row of escrow.rows) {
      events.push({
        id: row.id,
        day: row.day,
        kind: 'escrow',
        label: 'Escrow completion',
        amountUsdc: row.amount_usdc,
        chain: row.chain,
        txHash: row.tx_hash,
        explorerUrl: explorerUrlFor(row.chain, row.tx_hash),
        occurredAt: row.occurred_at,
      });
    }
  }

  return events
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 40);
}
