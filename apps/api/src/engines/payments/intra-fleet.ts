import type pg from 'pg';
import { resolveAgentPayee } from './agent-payee.js';
import { nativeBalanceMicros } from './agent-wallets.js';
import { fundAgentFromTreasuryDelegation } from './agent-funding.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import { drawDown, recordSignedDelegation } from './permit2.js';
import type { PaymentChain, PaymentMode } from './types.js';

// Intra-fleet payments settle via Permit2 drawdown -- a direct
// transferFrom() against a standing delegation -- not Circle's x402
// exact/gateway settlement built for external merchants. x402's 402
// response is still the real price-discovery protocol; only the
// SETTLEMENT mechanism differs, matching the plan's "funds never leave
// the payer's wallet" architecture (Permit2 IS the settlement here).

type X402Accept = {
  readonly amount?: string;
  readonly maxAmountRequired?: string;
  readonly payTo: string;
};

type X402PaymentRequired = {
  readonly accepts: readonly X402Accept[];
};

function amountMicrosFromAccept(accept: X402Accept): bigint {
  const raw = accept.maxAmountRequired ?? accept.amount;
  if (raw === undefined) throw new Error('intra_fleet_amount_missing');
  // x402 atomic amounts on Arc are already 6dp USDC micros (no decimal
  // point) -- consistent with x402UsdcMicrosFromAccept's atomic-network
  // branch in store.ts, reproduced narrowly here rather than importing
  // store.ts's much larger runtime-quote machinery for one conversion.
  if (!/^\d+$/.test(raw)) throw new Error('intra_fleet_invalid_amount');
  return BigInt(raw);
}

// Delegations get generous headroom above any single observed price so a
// short-lived fleet run doesn't re-sign a new PermitSingle (a real
// on-chain permit() transaction) for every payment -- reuse is the point
// of a standing ceiling, not a per-payment signature.
const DEFAULT_DELEGATION_CEILING_USDC = '5.00';
const DEFAULT_DELEGATION_TTL_MS = 24 * 60 * 60 * 1000;

export type PayIntraFleetInput = {
  readonly orgId: string;
  readonly payerAgentId: string;
  readonly payeeAgentId: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly url: string;
  readonly approvedBy: string;
};

export type PayIntraFleetResult = {
  readonly status: number;
  readonly body: unknown;
  readonly txHash: string;
  readonly amountUsdc: string;
};

function formatUsdc(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const decimal = (micros % 1_000_000n).toString().padStart(6, '0');
  return `${whole.toString()}.${decimal}`;
}

async function findActiveDelegationWithHeadroom(
  pool: pg.Pool,
  input: { readonly payerAgentId: string; readonly payeeAddress: string; readonly mode: PaymentMode; readonly chain: PaymentChain; readonly neededMicros: bigint },
): Promise<{ readonly id: string } | null> {
  const result = await pool.query<{ id: string; ceiling_usdc: string; drawn_usdc: string }>(
    `SELECT id, ceiling_usdc, drawn_usdc FROM agent_delegations
      WHERE payer_agent_id = $1 AND payee_address = $2 AND mode = $3 AND chain = $4
        AND status = 'active' AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [input.payerAgentId, input.payeeAddress, input.mode, input.chain],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  const ceilingMicros = BigInt(Math.round(Number(row.ceiling_usdc) * 1_000_000));
  const drawnMicros = BigInt(Math.round(Number(row.drawn_usdc) * 1_000_000));
  if (drawnMicros + input.neededMicros > ceilingMicros) return null;
  return { id: row.id };
}

/**
 * Pays a fleet agent for a paid HTTP resource: discovers the 402 (real
 * x402 price quote), resolves the payee as an auto-allowlisted fleet
 * wallet, reuses an active delegation with enough headroom or signs a
 * fresh one, draws down the real amount via Permit2, then re-requests the
 * resource with a payment proof header and returns the served content.
 */
export async function payIntraFleet(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: PayIntraFleetInput,
): Promise<PayIntraFleetResult> {
  const payee = await resolveAgentPayee(pool, {
    orgId: input.orgId,
    agentId: input.payeeAgentId,
    mode: input.mode,
    chain: input.chain,
  });

  const discovery = await fetch(input.url, { method: 'GET' });
  if (discovery.status !== 402) throw new Error('intra_fleet_payment_not_required');
  const quote = await discovery.json() as X402PaymentRequired;
  const accept = quote.accepts[0];
  if (accept === undefined) throw new Error('intra_fleet_no_accepts');
  const amountMicros = amountMicrosFromAccept(accept);

  // Permit2 pulls from the PAYER's wallet, so this agent must actually hold
  // the USDC it is about to spend. It holds nothing up front: it draws what
  // it needs, when it needs it, from the org treasury's delegation. A no-op
  // when the agent is already funded (it earned enough, or the allocation
  // path topped it up), so both funding models share this path.
  await fundAgentFromTreasuryDelegation(pool, provider, nativeBalanceMicros, {
    orgId: input.orgId,
    agentId: input.payerAgentId,
    mode: input.mode,
    chain: input.chain,
    neededMicros: amountMicros,
  });

  let delegation = await findActiveDelegationWithHeadroom(pool, {
    payerAgentId: input.payerAgentId,
    payeeAddress: payee.address,
    mode: input.mode,
    chain: input.chain,
    neededMicros: amountMicros,
  });
  if (delegation === null) {
    const signed = await recordSignedDelegation(pool, provider, {
      orgId: input.orgId,
      payerAgentId: input.payerAgentId,
      payeeAgentId: input.payeeAgentId,
      payeeAddress: payee.address,
      mode: input.mode,
      chain: input.chain,
      ceilingUsdc: DEFAULT_DELEGATION_CEILING_USDC,
      expiresAt: new Date(Date.now() + DEFAULT_DELEGATION_TTL_MS),
      approvedBy: input.approvedBy,
    });
    delegation = { id: signed.id };
  }

  const draw = await drawDown(pool, provider, { delegationId: delegation.id, amountUsdc: formatUsdc(amountMicros) });

  const paid = await fetch(input.url, {
    method: 'GET',
    headers: { 'x-payment': draw.txHash },
  });
  const body = await paid.json().catch(() => undefined);

  return { status: paid.status, body, txHash: draw.txHash, amountUsdc: formatUsdc(amountMicros) };
}
