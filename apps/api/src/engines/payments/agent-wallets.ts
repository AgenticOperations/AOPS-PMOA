import type pg from 'pg';
import { prefixedId } from '../identity/ids.js';
import type { PaymentChain, PaymentMode } from './types.js';

type Db = pg.Pool | pg.PoolClient;

export type AgentChainWalletRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly chain: PaymentChain;
  readonly circle_wallet_id: string;
  readonly address: string;
  readonly status: string;
};

export async function enqueueAgentWalletProvisioning(
  db: Db,
  input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly mode: PaymentMode;
    readonly chains: readonly PaymentChain[];
    readonly createdBy: string;
  },
): Promise<void> {
  for (const chain of input.chains) {
    await db.query(
      `INSERT INTO circle_provider_jobs
         (id, org_id, mode, job_type, chain, status, metadata, created_by)
       VALUES ($1, $2, $3, 'agent_wallet.create', $4, 'queued', $5::jsonb, $6)`,
      [
        prefixedId('cjob'),
        input.orgId,
        input.mode,
        chain,
        JSON.stringify({ agent_id: input.agentId }),
        input.createdBy,
      ],
    );
  }
}

export async function recordProvisionedWallet(
  db: Db,
  input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly mode: PaymentMode;
    readonly chain: PaymentChain;
    readonly circleWalletId: string;
    readonly address: string;
    readonly refId: string;
    readonly walletSetId: string;
    readonly circleBlockchain: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO agent_chain_wallets
       (id, org_id, agent_id, wallet_set_id, mode, chain, circle_blockchain,
        circle_wallet_id, address, ref_id, status, provisioned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', now())
     ON CONFLICT (agent_id, mode, chain) DO NOTHING`,
    [
      prefixedId('acw'), input.orgId, input.agentId, input.walletSetId,
      input.mode, input.chain, input.circleBlockchain,
      input.circleWalletId, input.address, input.refId,
    ],
  );
}

export async function findAgentWallet(
  db: Db,
  agentId: string,
  mode: PaymentMode,
  chain: PaymentChain,
): Promise<AgentChainWalletRow | null> {
  const result = await db.query<AgentChainWalletRow>(
    `SELECT id, org_id, agent_id, chain, circle_wallet_id, address, status
       FROM agent_chain_wallets
      WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'`,
    [agentId, mode, chain],
  );
  return result.rows[0] ?? null;
}

/**
 * Spendable balance for budget decisions.
 *
 * On Arc, USDC IS the native gas asset -- the ERC-20 view and the native
 * balance are the same pool, and the ERC-20 view TRUNCATES (constraint I.8).
 * A balanceOf of 0 does NOT mean zero native balance. Gas decisions must
 * therefore read the native balance. See docs/spike-results.md (S6).
 *
 * Spendable = balance - gasReserve. Never compare against the raw balance:
 * an agent that spends to zero on Arc cannot transact at all, cannot be
 * swept, and is bricked.
 */
export async function readSpendableMicros(
  wallet: Pick<AgentChainWalletRow, 'address' | 'chain'>,
  gasReserveMicros: bigint,
  deps: { readonly nativeBalanceMicros: (address: string, chain: PaymentChain) => Promise<bigint> },
): Promise<bigint> {
  const balance = await deps.nativeBalanceMicros(wallet.address, wallet.chain);
  const spendable = balance - gasReserveMicros;
  return spendable > 0n ? spendable : 0n;
}
