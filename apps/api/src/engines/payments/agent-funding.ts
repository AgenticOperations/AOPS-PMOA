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
  | { readonly funded: false; readonly reason: 'already_funded' | 'no_treasury_delegation' }
  | { readonly funded: true; readonly amountUsdc: string; readonly txHash: string };

type NativeBalanceReader = (address: string, chain: PaymentChain, mode: PaymentMode) => Promise<bigint>;

function formatUsdc(micros: bigint): string {
  const whole = micros / 1_000_000n;
  return `${whole.toString()}.${(micros % 1_000_000n).toString().padStart(6, '0')}`;
}

// Enough to submit a handful of transferFrom calls, no more. On Arc this is
// literally gas, because USDC is the native gas asset there.
const AGENT_GAS_FLOOR_MICROS = 100_000n; // 0.10 USDC

/**
 * Bootstraps an agent wallet so it can submit its OWN Permit2 drawdown.
 *
 * Permit2 requires msg.sender == spender, so the agent -- not the treasury
 * -- submits transferFrom, and pays gas for it. A freshly provisioned agent
 * wallet holds nothing, so without this the very first drawdown can never
 * be sent and the agent is stuck.
 *
 * A DIRECT treasury transfer, not a Permit2 draw: the treasury is
 * platform-controlled, and this is the platform funding its own plumbing.
 * Bounded to a small fixed floor so it never becomes a second uncapped
 * funding path that sidesteps the delegation ceiling.
 *
 * Base and the other ERC-20 chains need NATIVE gas (ETH), which the Circle
 * provider exposes no method to send -- there, an agent wallet must be
 * funded with gas out of band. Returns false so the caller can surface that
 * rather than failing opaquely at submit time.
 */
async function ensureAgentGasFloor(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: {
    readonly orgId: string;
    readonly agentAddress: string;
    readonly balanceMicros: bigint;
    readonly chain: PaymentChain;
    readonly mode: PaymentMode;
  },
): Promise<boolean> {
  if (input.chain !== 'arc') return false;
  if (input.balanceMicros >= AGENT_GAS_FLOOR_MICROS) return true;

  const treasury = await pool.query<{ address: string }>(
    `SELECT address FROM circle_chain_wallets
      WHERE org_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
      LIMIT 1`,
    [input.orgId, input.mode, input.chain],
  );
  const treasuryAddress = treasury.rows[0]?.address;
  if (treasuryAddress === undefined) return false;

  await provider.transferWallet({
    amountMicros: AGENT_GAS_FLOOR_MICROS - input.balanceMicros,
    chain: input.chain,
    destinationAddress: input.agentAddress,
    mode: input.mode,
    refId: `agentops-gas-${crypto.randomUUID()}`,
    sourceAddress: treasuryAddress,
  });
  return true;
}

/**
 * Tops an agent's wallet up from the ORG TREASURY's delegation, at the
 * moment the agent needs the money.
 *
 * One shared pool pays every agent. Each agent draws against its own
 * Permit2 allowance -- isolation comes from allowance[treasury][USDC][agent]
 * being keyed by spender address -- and the org-wide ceiling bounds the sum.
 * The funds sit in the treasury until an agent actually spends.
 *
 * Deliberately NOT an error when no treasury delegation exists: an org may
 * still be funding its agents the allocation way, and this runs on the same
 * path for both. The caller decides whether an unfunded agent is a problem
 * -- which it discovers anyway when the payment itself fails.
 */
export async function fundAgentFromTreasuryDelegation(
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
  if (address === undefined) return { funded: false, reason: 'no_treasury_delegation' };

  const balance = await nativeBalanceMicros(address, input.chain, input.mode);
  if (balance >= input.neededMicros) return { funded: false, reason: 'already_funded' };
  const shortfall = input.neededMicros - balance;

  // Before drawing: make sure the agent can actually SUBMIT the drawdown.
  // Reuses the balance already read above rather than re-reading -- Arc's
  // public RPC was measured failing ~56% of calls (spike S6), so every
  // avoided round trip is one less thing to retry.
  await ensureAgentGasFloor(pool, provider, {
    orgId: input.orgId,
    agentAddress: address,
    balanceMicros: balance,
    chain: input.chain,
    mode: input.mode,
  });

  // payer_kind = 'treasury' selects the org's shared pool. Deliberately NOT
  // `payer_agent_id IS NULL`, which since migration 0030 matches BOTH a
  // treasury payer and a user-owned wallet -- drawing against the wrong one
  // would bypass the org ceiling entirely.
  const delegations = await pool.query<{ id: string; ceiling_usdc: string; drawn_usdc: string }>(
    `SELECT id, ceiling_usdc, drawn_usdc FROM agent_delegations
      WHERE org_id = $1 AND payee_agent_id = $2 AND payer_kind = 'treasury'
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

  return { funded: false, reason: 'no_treasury_delegation' };
}
