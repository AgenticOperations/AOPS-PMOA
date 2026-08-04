import { encodeFunctionData, parseAbi } from 'viem';
import type pg from 'pg';
import { prefixedId } from '../identity/ids.js';
import { parseUsdcMicros } from './allocations.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import { usdcTokenAddress } from './circle-provider.js';
import type { PaymentChain, PaymentMode } from './types.js';

type Db = pg.Pool | pg.PoolClient;

// wei (18dp native) -> USDC micros (6dp), the unit the rest of the
// payments engine uses throughout (see parseUsdcMicros in store.ts).
// Confirmed 1:1 empirically in spike S6 (docs/spike-results.md):
// balanceOf() == floor(native / 1e12) on every sampled Arc account.
const WEI_PER_MICRO = 1_000_000_000_000n;

// Read at call time, not module-load time -- process.env can be populated
// after this module is imported (env-file loading order, tests stubbing
// the var), and a frozen-at-import constant would silently never see it.
export function chainRpcUrl(chain: PaymentChain): string | undefined {
  if (chain === 'arc') return process.env.ARC_RPC_URL;
  if (chain === 'base') return process.env.BASE_SEPOLIA_RPC_URL;
  return undefined;
}

const NATIVE_BALANCE_MAX_ATTEMPTS = 6;
const NATIVE_BALANCE_RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpcCallWithRetry(
  rpcUrl: string,
  method: string,
  params: readonly unknown[],
  errorPrefix: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= NATIVE_BALANCE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const body = await response.json() as { readonly result?: string; readonly error?: { readonly message?: string } };
      if (body.error !== undefined) throw new Error(body.error.message ?? `${errorPrefix}_rpc_error`);
      if (body.result === undefined) throw new Error(`${errorPrefix}_empty_response`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt < NATIVE_BALANCE_MAX_ATTEMPTS) await sleep(NATIVE_BALANCE_RETRY_DELAY_MS);
    }
  }
  throw new Error(`${errorPrefix}_unavailable:${lastError instanceof Error ? lastError.message : 'unknown'}`);
}

const erc20BalanceOfAbi = parseAbi(['function balanceOf(address account) view returns (uint256)']);

// USDC's real on-chain decimals differ by chain: 6 on Arc (matches
// micros 1:1) and every Circle-supported EVM chain EXCEPT native-gas
// chains -- Base/Arbitrum/Polygon/Optimism/Avalanche USDC is all 6dp
// too, so no scaling is needed here; this constant exists so a future
// chain with different USDC decimals doesn't silently misconvert.
const USDC_DECIMALS_MICROS_SCALE = 1n;

/**
 * Reads an address's spendable balance and converts it to USDC micros.
 *
 * On Arc, USDC IS the native gas asset -- the ERC-20 view truncates
 * (constraint I.8, confirmed in spike S6): balanceOf can read 0 while the
 * native balance is genuinely non-zero. Budget and gas decisions on Arc
 * must read the native balance, never the ERC-20 view.
 *
 * On every OTHER chain (Base, etc.), USDC is a real ERC-20, separate from
 * the native gas token -- reading eth_getBalance there would report ETH,
 * not USDC, which is simply wrong. This reads the real balanceOf via the
 * same USDC token address every other settlement path already uses
 * (circle-provider.ts's usdcTokenAddress).
 *
 * Retries with backoff on both paths: spike S6 found Arc's public RPC
 * failing ~56% of identical calls. A failed read must never be silently
 * coerced to zero -- that would reject valid payments and could trigger
 * spurious top-ups -- so this throws after exhausting retries rather than
 * returning a default.
 */
export async function nativeBalanceMicros(address: string, chain: PaymentChain, mode: PaymentMode = 'test'): Promise<bigint> {
  const rpcUrl = chainRpcUrl(chain);
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    throw new Error(`agent_wallet_balance_rpc_not_configured:${chain}`);
  }

  if (chain === 'arc') {
    const result = await rpcCallWithRetry(rpcUrl, 'eth_getBalance', [address, 'latest'], 'agent_wallet_balance');
    return BigInt(result) / WEI_PER_MICRO;
  }

  const tokenAddress = usdcTokenAddress(mode, chain);
  const data = encodeFunctionData({ abi: erc20BalanceOfAbi, functionName: 'balanceOf', args: [address as `0x${string}`] });
  const result = await rpcCallWithRetry(
    rpcUrl,
    'eth_call',
    [{ to: tokenAddress, data }, 'latest'],
    'agent_wallet_balance',
  );
  return BigInt(result) / USDC_DECIMALS_MICROS_SCALE;
}

async function circleBlockchainForChain(db: Db, mode: PaymentMode, chain: PaymentChain): Promise<string> {
  const result = await db.query<{ circle_blockchain: string }>(
    'SELECT circle_blockchain FROM circle_chain_capabilities WHERE mode = $1 AND chain = $2',
    [mode, chain],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('circle_chain_capability_not_found');
  return row.circle_blockchain;
}

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
 * Any wallet already provisioned for this agent, on any chain -- used to
 * derive a new chain onto the SAME address (Circle's unified EVM
 * addressing via deriveWallet), rather than provisioning an unrelated
 * independent wallet. Deliberately picks the oldest (first-provisioned)
 * row so every later chain derives from the one true "primary" wallet
 * instead of chaining derivations off whichever row happens to be found.
 */
export async function findAnyAgentWallet(
  db: Db,
  agentId: string,
  mode: PaymentMode,
): Promise<AgentChainWalletRow | null> {
  const result = await db.query<AgentChainWalletRow>(
    `SELECT id, org_id, agent_id, chain, circle_wallet_id, address, status
       FROM agent_chain_wallets
      WHERE agent_id = $1 AND mode = $2 AND status = 'active'
      ORDER BY provisioned_at ASC
      LIMIT 1`,
    [agentId, mode],
  );
  return result.rows[0] ?? null;
}

type AgentWalletCreateJobRow = {
  readonly id: string;
  readonly org_id: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain | null;
  readonly status: string;
  readonly metadata: unknown;
};

function jobAgentId(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const agentId = (metadata as Record<string, unknown>).agent_id;
  return typeof agentId === 'string' && agentId.length > 0 ? agentId : null;
}

/**
 * Processes one queued 'agent_wallet.create' job: resolves whether this is
 * the agent's first wallet (independent create) or an additional chain
 * (derive onto the same address via Circle's unified EVM addressing), calls
 * the provider, records the result, and marks the job complete or failed.
 *
 * Caller is responsible for the per-org advisory lock and for selecting
 * only 'agent_wallet.create' jobs with status 'queued' -- this function
 * does not re-check status itself, matching the shape of the existing
 * liquidity-worker job handlers it sits alongside.
 */
export async function processAgentWalletCreateJob(
  db: Db,
  jobId: string,
  provider: CircleTreasuryProvider,
): Promise<void> {
  const jobResult = await db.query<AgentWalletCreateJobRow>(
    `SELECT id, org_id, mode, chain, status, metadata
       FROM circle_provider_jobs
      WHERE id = $1 AND job_type = 'agent_wallet.create'
      LIMIT 1`,
    [jobId],
  );
  const job = jobResult.rows[0];
  if (job === undefined) return;

  const agentId = jobAgentId(job.metadata);
  if (agentId === null || job.chain === null) {
    await db.query(
      `UPDATE circle_provider_jobs
          SET status = 'failed', error_code = 'agent_wallet_job_metadata_invalid', updated_at = now()
        WHERE id = $1`,
      [jobId],
    );
    return;
  }

  try {
    const walletSet = await db.query<{ id: string; circle_wallet_set_id: string }>(
      `SELECT id, circle_wallet_set_id FROM circle_wallet_sets
        WHERE org_id = $1 AND mode = $2 AND status = 'active' LIMIT 1`,
      [job.org_id, job.mode],
    );
    const walletSetRow = walletSet.rows[0];
    if (walletSetRow === undefined) throw new Error('circle_wallet_set_not_found');

    const circleBlockchain = await circleBlockchainForChain(db, job.mode, job.chain);

    // An agent's FIRST wallet is created independently; every SUBSEQUENT
    // chain derives from it so all of the agent's wallets share one
    // address (K-13) -- same address, independent per-chain balances.
    const existingWallet = await findAnyAgentWallet(db, agentId, job.mode);

    const created = await provider.createWallet({
      chain: job.chain,
      circleBlockchain,
      mode: job.mode,
      orgId: job.org_id,
      walletSetId: walletSetRow.circle_wallet_set_id,
      ...(existingWallet === null ? {} : { deriveFromWalletId: existingWallet.circle_wallet_id }),
    });

    await recordProvisionedWallet(db, {
      orgId: job.org_id,
      agentId,
      mode: job.mode,
      chain: job.chain,
      circleWalletId: created.circleWalletId,
      address: created.address,
      refId: existingWallet?.id ?? prefixedId('aref'),
      walletSetId: walletSetRow.id,
      circleBlockchain,
    });

    await db.query(
      `UPDATE circle_provider_jobs
          SET status = 'complete', provider_ref = $2, updated_at = now()
        WHERE id = $1`,
      [jobId, created.circleWalletId],
    );
  } catch (error) {
    await db.query(
      `UPDATE circle_provider_jobs
          SET status = 'failed',
              error_code = $2,
              updated_at = now()
        WHERE id = $1`,
      [jobId, error instanceof Error ? error.message : 'agent_wallet_create_failed'],
    );
  }
}

type AgentWalletTopUpJobRow = {
  readonly id: string;
  readonly org_id: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain | null;
  readonly amount_usdc: string | null;
  readonly metadata: unknown;
};

/**
 * Processes one queued 'agent_wallet.topup' job: transfers amount_usdc
 * from the org's treasury wallet to the target agent's wallet on the same
 * chain, via the provider's transferWallet. evaluateTopUps (allocations.ts)
 * is responsible for computing the amount and re-checking solvency before
 * enqueueing this job -- this function trusts the stored amount and just
 * executes the transfer.
 */
export async function processAgentWalletTopUpJob(
  db: Db,
  jobId: string,
  provider: CircleTreasuryProvider,
): Promise<void> {
  const jobResult = await db.query<AgentWalletTopUpJobRow>(
    `SELECT id, org_id, mode, chain, amount_usdc, metadata
       FROM circle_provider_jobs
      WHERE id = $1 AND job_type = 'agent_wallet.topup'
      LIMIT 1`,
    [jobId],
  );
  const job = jobResult.rows[0];
  if (job === undefined) return;

  const agentId = jobAgentId(job.metadata);
  if (agentId === null || job.chain === null || job.amount_usdc === null) {
    await db.query(
      `UPDATE circle_provider_jobs
          SET status = 'failed', error_code = 'agent_wallet_job_metadata_invalid', updated_at = now()
        WHERE id = $1`,
      [jobId],
    );
    return;
  }

  try {
    const treasuryWallet = await db.query<{ address: string }>(
      `SELECT address FROM circle_chain_wallets
        WHERE org_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
        LIMIT 1`,
      [job.org_id, job.mode, job.chain],
    );
    const treasuryRow = treasuryWallet.rows[0];
    if (treasuryRow === undefined) throw new Error('circle_wallet_missing');

    const agentWallet = await findAgentWallet(db, agentId, job.mode, job.chain);
    if (agentWallet === null) throw new Error('agent_wallet_not_found');

    const amountMicros = parseUsdcMicros(job.amount_usdc);
    const transfer = await provider.transferWallet({
      amountMicros,
      chain: job.chain,
      destinationAddress: agentWallet.address,
      mode: job.mode,
      refId: `agentops-topup-${jobId}`,
      sourceAddress: treasuryRow.address,
    });

    await db.query(
      `UPDATE circle_provider_jobs
          SET status = 'complete', provider_ref = $2, updated_at = now()
        WHERE id = $1`,
      [jobId, transfer.transactionId],
    );
  } catch (error) {
    await db.query(
      `UPDATE circle_provider_jobs
          SET status = 'failed',
              error_code = $2,
              updated_at = now()
        WHERE id = $1`,
      [jobId, error instanceof Error ? error.message : 'agent_wallet_topup_failed'],
    );
  }
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
  deps: { readonly nativeBalanceMicros: (address: string, chain: PaymentChain, mode: PaymentMode) => Promise<bigint> },
  mode: PaymentMode,
): Promise<bigint> {
  const balance = await deps.nativeBalanceMicros(wallet.address, wallet.chain, mode);
  const spendable = balance - gasReserveMicros;
  return spendable > 0n ? spendable : 0n;
}

export type AgentWalletFundingRow = {
  readonly agentId: string;
  readonly agentName: string;
  readonly chain: PaymentChain;
  readonly address: string;
  readonly status: string;
  // On-chain USDC, in micros, as a decimal string. Null when the balance
  // could not be read -- Arc's public RPC was measured failing ~56% of
  // identical calls (spike S6), and a funding screen that 500s because one
  // RPC blipped is worse than one showing an unknown balance.
  readonly usdcMicros: string | null;
  // Allocation, when the org funds this agent the custodial way. Null under
  // just-in-time funding, where the operator's own wallet is the source.
  readonly allocatedUsdc: string | null;
  readonly lowWaterMarkUsdc: string | null;
};

/**
 * Every agent wallet in the org with its real on-chain balance -- the
 * middle tier of the funding hierarchy (treasury -> agent wallet -> the
 * agent spending it). No HTTP route exposed this before, which is why
 * demo/reset.mjs reads the table directly.
 */
export async function listAgentWalletFunding(
  pool: pg.Pool,
  orgId: string,
  mode: PaymentMode,
): Promise<readonly AgentWalletFundingRow[]> {
  const result = await pool.query<{
    agent_id: string;
    agent_name: string;
    chain: PaymentChain;
    address: string;
    status: string;
    allocated_usdc: string | null;
    low_water_mark_usdc: string | null;
  }>(
    `SELECT w.agent_id, a.name AS agent_name, w.chain, w.address, w.status,
            al.allocated_usdc, al.low_water_mark_usdc
       FROM agent_chain_wallets w
       JOIN agents a ON a.id = w.agent_id
       LEFT JOIN agent_allocations al
         ON al.agent_id = w.agent_id AND al.chain = w.chain
        AND al.mode = w.mode AND al.status = 'active'
      WHERE w.org_id = $1 AND w.mode = $2 AND w.status = 'active'
      ORDER BY a.name, w.chain`,
    [orgId, mode],
  );

  return Promise.all(result.rows.map(async (row) => {
    let usdcMicros: string | null = null;
    try {
      usdcMicros = (await nativeBalanceMicros(row.address, row.chain, mode)).toString();
    } catch {
      usdcMicros = null;
    }
    return {
      agentId: row.agent_id,
      agentName: row.agent_name,
      chain: row.chain,
      address: row.address,
      status: row.status,
      usdcMicros,
      allocatedUsdc: row.allocated_usdc,
      lowWaterMarkUsdc: row.low_water_mark_usdc,
    };
  }));
}
