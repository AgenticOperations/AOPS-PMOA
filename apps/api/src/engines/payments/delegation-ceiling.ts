import type pg from 'pg';
import { conflict } from '../identity/errors.js';
import { formatUsdc, parseUsdcMicros } from './permit2.js';
import type { PaymentChain, PaymentMode } from './types.js';

type Db = pg.Pool | pg.PoolClient;

export type PayerScope = {
  readonly orgId: string;
  readonly payerAddress: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly tokenAddress: string;
};

/**
 * Total UNDRAWN headroom across every live delegation from one payer.
 *
 * This is the number the payer's ERC-20 approval to Permit2 must cover.
 * ERC-20 approve SETS rather than adds, so approving only the newest
 * delegation's ceiling silently strips every earlier agent's ability to
 * draw -- they revert with TRANSFER_FROM_FAILED, far from the cause.
 *
 * Expired rows are excluded by expires_at rather than trusting status:
 * nothing sweeps 'active' rows to 'expired' on a timer, so status alone
 * would over-report headroom and over-approve.
 */
export async function outstandingHeadroomMicros(db: Db, scope: PayerScope): Promise<bigint> {
  const result = await db.query<{ outstanding: string }>(
    `SELECT COALESCE(SUM(ceiling_usdc - drawn_usdc), 0)::text AS outstanding
       FROM agent_delegations
      WHERE org_id = $1 AND payer_address = $2 AND mode = $3 AND chain = $4
        AND token_address = $5 AND status = 'active' AND expires_at > now()`,
    [scope.orgId, scope.payerAddress, scope.mode, scope.chain, scope.tokenAddress],
  );
  return parseUsdcMicros(result.rows[0]?.outstanding ?? '0');
}

/** The configured org-wide cap, or null when the org has not set one. */
export async function orgCeilingMicros(
  db: Db,
  input: { readonly orgId: string; readonly mode: PaymentMode; readonly chain: PaymentChain },
): Promise<bigint | null> {
  const result = await db.query<{ ceiling_usdc: string }>(
    `SELECT ceiling_usdc::text FROM org_delegation_ceilings
      WHERE org_id = $1 AND mode = $2 AND chain = $3`,
    [input.orgId, input.mode, input.chain],
  );
  const row = result.rows[0];
  return row === undefined ? null : parseUsdcMicros(row.ceiling_usdc);
}

/**
 * Bounds a proposed new delegation. Called before any on-chain write.
 *
 * balanceMicros is injected rather than read here: Arc's public RPC was
 * measured failing ~56% of identical calls (spike S6), so the caller owns
 * the retry policy, and tests can stub it without a live chain.
 */
export async function assertDelegationWithinCeilings(
  db: Db,
  scope: PayerScope,
  newCeilingMicros: bigint,
  balanceMicros: bigint,
): Promise<void> {
  const outstanding = await outstandingHeadroomMicros(db, scope);
  const total = outstanding + newCeilingMicros;

  const configured = await orgCeilingMicros(db, {
    orgId: scope.orgId, mode: scope.mode, chain: scope.chain,
  });
  if (configured !== null && total > configured) {
    throw conflict(
      'org_delegation_ceiling_exceeded',
      `This delegation would bring total delegated spend to ${formatUsdc(total)} USDC, above the org ceiling of ${formatUsdc(configured)} USDC.`,
    );
  }

  // Solvency. A ceiling the treasury cannot cover is not a cap, it is a
  // deferred failure that lands on whichever agent happens to draw last.
  if (total > balanceMicros) {
    throw conflict(
      'treasury_insufficient_for_ceiling',
      `The treasury holds ${formatUsdc(balanceMicros)} USDC but ${formatUsdc(total)} USDC would be delegated. Fund the treasury first.`,
    );
  }
}
