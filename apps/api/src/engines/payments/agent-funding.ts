import type pg from 'pg';
import type { CircleTreasuryProvider } from './circle-provider.js';
import { drawDown, parseUsdcMicros } from './permit2.js';
import type { PaymentChain, PaymentMode } from './types.js';

export type JustInTimeFundingInput = {
  readonly orgId: string;
  readonly agentId: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  // What the agent is about to spend. Only the shortfall is drawn -- an
  // agent that already earned enough is left alone.
  readonly neededMicros: bigint;
};

export type JustInTimeFundingResult =
  | { readonly funded: false; readonly reason: 'already_funded' | 'no_user_delegation' }
  | { readonly funded: true; readonly amountUsdc: string; readonly txHash: string };

type NativeBalanceReader = (address: string, chain: PaymentChain, mode: PaymentMode) => Promise<bigint>;

function formatUsdc(micros: bigint): string {
  const whole = micros / 1_000_000n;
  return `${whole.toString()}.${(micros % 1_000_000n).toString().padStart(6, '0')}`;
}

/**
 * Tops an agent's wallet up from a delegation its operator signed with
 * their OWN wallet, at the moment the agent needs the money.
 *
 * This is the non-custodial replacement for the allocation + treasury
 * top-up path. There, the operator had to move real USDC into a treasury
 * this platform custodies, then allocate it out to each agent in advance.
 * Here the funds stay in the operator's wallet until an agent actually
 * spends, and the delegation ceiling caps total exposure regardless.
 *
 * Deliberately NOT an error when no user delegation exists: an org may
 * still be funding its agents the custodial way, and this runs on the same
 * path for both. The caller decides whether an unfunded agent is a problem
 * -- which it discovers anyway when the payment itself fails.
 */
export async function fundAgentFromUserDelegation(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  nativeBalanceMicros: NativeBalanceReader,
  input: JustInTimeFundingInput,
): Promise<JustInTimeFundingResult> {
  const wallet = await pool.query<{ address: string }>(
    `SELECT address FROM agent_chain_wallets
      WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
      LIMIT 1`,
    [input.agentId, input.mode, input.chain],
  );
  const address = wallet.rows[0]?.address;
  if (address === undefined) return { funded: false, reason: 'no_user_delegation' };

  const balance = await nativeBalanceMicros(address, input.chain, input.mode);
  if (balance >= input.neededMicros) return { funded: false, reason: 'already_funded' };
  const shortfall = input.neededMicros - balance;

  // payer_agent_id IS NULL is precisely what marks a user-owned payer: the
  // operator's own wallet, which this platform holds no key for. The payee
  // is this agent, so drawing moves USDC straight from the operator's
  // wallet into the agent's -- the agent itself submits, paying gas.
  const delegations = await pool.query<{ id: string; ceiling_usdc: string; drawn_usdc: string }>(
    `SELECT id, ceiling_usdc, drawn_usdc FROM agent_delegations
      WHERE org_id = $1 AND payee_agent_id = $2 AND payer_agent_id IS NULL
        AND mode = $3 AND chain = $4 AND status = 'active' AND expires_at > now()
      ORDER BY created_at DESC`,
    [input.orgId, input.agentId, input.mode, input.chain],
  );

  for (const row of delegations.rows) {
    const remaining = parseUsdcMicros(row.ceiling_usdc) - parseUsdcMicros(row.drawn_usdc);
    if (remaining < shortfall) continue;
    const amountUsdc = formatUsdc(shortfall);
    const draw = await drawDown(pool, provider, { delegationId: row.id, amountUsdc });
    return { funded: true, amountUsdc, txHash: draw.txHash };
  }

  return { funded: false, reason: 'no_user_delegation' };
}
