import { encodeFunctionData, parseAbi } from 'viem';
import type pg from 'pg';
import { badRequest, conflict } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import { chainRpcUrl } from './agent-wallets.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import type { PaymentChain, PaymentMode } from './types.js';

// Canonical Permit2 address, identical across every EVM chain (CREATE2
// deployment) -- verified live on Arc in spike S4 (docs/spike-results.md).
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

const permit2AllowanceAbi = parseAbi([
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]);

const NONCE_READ_MAX_ATTEMPTS = 6;
const NONCE_READ_RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads Permit2's CURRENT on-chain nonce for owner/token/spender. Permit2
 * requires strictly increasing nonces per owner/token/spender -- a stale
 * nonce (e.g. always 0) makes permit() silently revert on any delegation
 * after the first one for that triple. Never assume nonce 0; always read
 * the real value. Retry-with-backoff matches nativeBalanceMicros's
 * pattern (Arc's public RPC found failing ~56% of calls, spike S6) --
 * a failed read must throw, never be coerced to a guessed nonce.
 */
export async function readPermit2Nonce(
  ownerAddress: string,
  tokenAddress: string,
  spenderAddress: string,
  chain: PaymentChain,
): Promise<bigint> {
  const rpcUrl = chainRpcUrl(chain);
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    throw new Error(`permit2_nonce_rpc_not_configured:${chain}`);
  }
  const data = encodeFunctionData({
    abi: permit2AllowanceAbi,
    functionName: 'allowance',
    args: [ownerAddress as `0x${string}`, tokenAddress as `0x${string}`, spenderAddress as `0x${string}`],
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= NONCE_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: PERMIT2_ADDRESS, data }, 'latest'] }),
      });
      const body = await response.json() as { readonly result?: string; readonly error?: { readonly message?: string } };
      if (body.error !== undefined) throw new Error(body.error.message ?? 'eth_call_rpc_error');
      if (body.result === undefined) throw new Error('eth_call_empty_response');
      const hex = body.result.slice(2);
      // amount (uint160), expiration (uint48), nonce (uint48) -- each
      // right-padded into its own 32-byte word by the ABI encoder.
      return BigInt(`0x${hex.slice(128, 192)}`);
    } catch (error) {
      lastError = error;
      if (attempt < NONCE_READ_MAX_ATTEMPTS) await sleep(NONCE_READ_RETRY_DELAY_MS);
    }
  }
  throw new Error(`permit2_nonce_unavailable:${lastError instanceof Error ? lastError.message : 'unknown'}`);
}

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

// Duplicated from store.ts (not imported) for the same reason Phase 4's
// allocations.ts duplicates it: store.ts doesn't (yet) import from this
// module, but keeping this self-contained avoids depending on store.ts's
// large internal surface for one small pure function.
export function parseUsdcMicros(value: string | number): bigint {
  const raw = typeof value === 'number' ? value.toString() : value.trim();
  const match = /^(\d+)(?:\.(\d{1,6})?)?$/.exec(raw);
  if (match === null) throw badRequest('invalid_usdc_amount', 'USDC amount must be a positive decimal with up to 6 places.');
  const whole = BigInt(match[1] ?? '0') * 1_000_000n;
  const decimals = (match[2] ?? '').padEnd(6, '0');
  return whole + BigInt(decimals.length === 0 ? '0' : decimals);
}

function formatUsdc(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const decimal = (micros % 1_000_000n).toString().padStart(6, '0');
  return `${whole.toString()}.${decimal}`;
}

export type PermitSingle = {
  readonly details: {
    readonly token: string;
    readonly amount: bigint;
    readonly expiration: bigint;
    readonly nonce: bigint;
  };
  readonly spender: string;
  readonly sigDeadline: bigint;
};

/**
 * Builds the EIP-712 typed-data payload for a Permit2 PermitSingle.
 * Verified live against real Circle signTypedData + Permit2's actual
 * DOMAIN_SEPARATOR on Arc (spike S4) -- this exact shape (domain name
 * "Permit2", the PermitDetails/PermitSingle type tree) produced a
 * signature Permit2's permit() accepted on-chain.
 */
export function buildPermitSingle(input: {
  readonly chainId: number;
  readonly tokenAddress: string;
  readonly spenderAddress: string;
  readonly amountMicros: bigint;
  readonly expiration: number;
  readonly nonce: bigint;
}): { readonly typedData: Record<string, unknown>; readonly permit: PermitSingle } {
  const sigDeadline = BigInt(input.expiration);
  const permit: PermitSingle = {
    details: {
      token: input.tokenAddress,
      amount: input.amountMicros,
      expiration: BigInt(input.expiration),
      nonce: input.nonce,
    },
    spender: input.spenderAddress,
    sigDeadline,
  };
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    },
    domain: {
      name: 'Permit2',
      chainId: input.chainId,
      verifyingContract: PERMIT2_ADDRESS,
    },
    primaryType: 'PermitSingle',
    message: {
      details: {
        token: input.tokenAddress,
        amount: input.amountMicros.toString(),
        expiration: input.expiration.toString(),
        nonce: input.nonce.toString(),
      },
      spender: input.spenderAddress,
      sigDeadline: sigDeadline.toString(),
    },
  };
  return { typedData, permit };
}

export type AgentDelegationRow = {
  readonly id: string;
  readonly org_id: string;
  readonly payer_agent_id: string;
  readonly payee_agent_id: string | null;
  readonly payee_address: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly token_address: string;
  readonly ceiling_usdc: string;
  readonly drawn_usdc: string;
  readonly expires_at: Date;
  readonly permit_nonce: string;
  readonly signature: string | null;
  readonly status: 'pending' | 'active' | 'exhausted' | 'expired' | 'revoked';
  readonly approved_by: string;
};

export type RecordSignedDelegationInput = {
  readonly orgId: string;
  readonly payerAgentId: string;
  readonly payeeAgentId?: string | undefined;
  readonly payeeAddress: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly tokenAddress?: string | undefined;
  readonly ceilingUsdc: string;
  readonly expiresAt: Date;
  readonly approvedBy: string;
};

const ARC_CHAIN_ID = 5042002;
const DEFAULT_PERMIT2_TOKEN_ADDRESS = '0x3600000000000000000000000000000000000000'; // Arc's native-USDC precompile address (spike S4/S6).

/**
 * Signs a fresh PermitSingle for a payer->payee delegation and persists
 * it as 'active'. The on-chain allowance is the authority -- this row is
 * the control plane's mirror of it, not a replacement.
 */
export async function recordSignedDelegation(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: RecordSignedDelegationInput,
): Promise<AgentDelegationRow> {
  return withTransaction(pool, async (client) => {
    const payer = await client.query<{ address: string }>(
      `SELECT address FROM agent_chain_wallets
        WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
        LIMIT 1`,
      [input.payerAgentId, input.mode, input.chain],
    );
    const payerRow = payer.rows[0];
    if (payerRow === undefined) throw new Error('agent_wallet_not_found');

    const tokenAddress = input.tokenAddress ?? DEFAULT_PERMIT2_TOKEN_ADDRESS;
    const ceilingMicros = parseUsdcMicros(input.ceilingUsdc);
    const expirationSeconds = Math.floor(input.expiresAt.getTime() / 1000);
    // Permit2 requires a strictly increasing nonce per owner/token/spender
    // -- MUST read the real current value, never assume 0. A hardcoded 0
    // makes every delegation after the first for the same triple silently
    // revert on-chain (confirmed live: a stale nonce produced an opaque
    // "API parameter invalid" from Circle rather than a clear revert
    // reason, so this bug would have been very hard to diagnose from the
    // error message alone).
    const nonce = await readPermit2Nonce(payerRow.address, tokenAddress, input.payeeAddress, input.chain);

    const { typedData } = buildPermitSingle({
      chainId: ARC_CHAIN_ID,
      tokenAddress,
      spenderAddress: input.payeeAddress,
      amountMicros: ceilingMicros,
      expiration: expirationSeconds,
      nonce,
    });

    const signed = await provider.signPermit2Delegation({
      chain: input.chain,
      mode: input.mode,
      ownerAddress: payerRow.address,
      typedData,
    });

    // The signature alone does nothing -- Permit2 only recognizes it once
    // permit() has actually submitted it on-chain, recording the
    // allowance in Permit2's own storage. Without this step, drawDown's
    // transferFrom would fail against a real zero allowance forever.
    // Submitted by the PAYER (the signer) rather than the payee: Permit2
    // recovers the owner from the signature regardless of who calls
    // permit(), and the payer already has a wallet in every case (needed
    // to sign), while the payee might not (payeeAgentId is optional --
    // Task 3 covers off-fleet payees too).
    await provider.executePermit2Transaction({
      mode: input.mode,
      chain: input.chain,
      senderAddress: payerRow.address,
      abiFunctionSignature: 'permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)',
      abiParameters: [
        payerRow.address,
        [[tokenAddress, ceilingMicros.toString(), expirationSeconds.toString(), nonce.toString()], input.payeeAddress, expirationSeconds.toString()],
        signed.signature,
      ],
      // Kept short deliberately: confirmed live that a long refId
      // (~100 chars, e.g. embedding both orgId and a full address) makes
      // Circle reject the whole call with an opaque "API parameter
      // invalid" error that gives no hint refId is the cause. A random
      // UUID suffix is enough to distinguish calls without the fixed
      // orgId/address text driving the length up.
      refId: `agentops-permit-${crypto.randomUUID()}`,
    });

    const inserted = await client.query<AgentDelegationRow>(
      `INSERT INTO agent_delegations (
         id, org_id, payer_agent_id, payee_agent_id, payee_address, mode, chain,
         token_address, ceiling_usdc, expires_at, permit_nonce, signature,
         status, approved_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10, $11, $12, 'active', $13)
       RETURNING *`,
      [
        prefixedId('dele'), input.orgId, input.payerAgentId, input.payeeAgentId ?? null,
        input.payeeAddress, input.mode, input.chain, tokenAddress,
        input.ceilingUsdc, input.expiresAt, nonce, signed.signature, input.approvedBy,
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error('agent_delegation_insert_failed');
    return row;
  });
}

export type DrawDownInput = {
  readonly delegationId: string;
  readonly amountUsdc: string;
};

/**
 * Draws down against a signed delegation: locks the delegation row
 * (SELECT ... FOR UPDATE is what makes concurrent drawdowns serialize
 * rather than both reading a stale drawn_usdc and both passing), checks
 * status/expiry/remaining ceiling, calls Permit2's transferFrom via the
 * provider, and records the drawdown with the REAL on-chain tx hash.
 *
 * Local accounting (drawn_usdc) is never authoritative -- the on-chain
 * allowance is. If a provider call fails, nothing here is left partially
 * committed: the whole transaction rolls back.
 */
export async function drawDown(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: DrawDownInput,
): Promise<{ readonly txHash: string; readonly drawnUsdc: string }> {
  return withTransaction(pool, async (client) => {
    const locked = await client.query<AgentDelegationRow>(
      'SELECT * FROM agent_delegations WHERE id = $1 FOR UPDATE',
      [input.delegationId],
    );
    const delegation = locked.rows[0];
    if (delegation === undefined) throw new Error('agent_delegation_not_found');

    if (delegation.status === 'revoked') throw conflict('delegation_revoked', 'This delegation has been revoked.');
    if (delegation.status !== 'active') throw conflict('delegation_not_active', `Delegation is ${delegation.status}, not active.`);
    if (delegation.expires_at.getTime() <= Date.now()) {
      throw conflict('delegation_expired', 'This delegation has expired.');
    }

    const amountMicros = parseUsdcMicros(input.amountUsdc);
    const ceilingMicros = parseUsdcMicros(delegation.ceiling_usdc);
    const drawnMicros = parseUsdcMicros(delegation.drawn_usdc);
    if (drawnMicros + amountMicros > ceilingMicros) {
      throw conflict('delegation_ceiling_exceeded', 'Drawdown would exceed the remaining delegation ceiling.');
    }

    const payer = await client.query<{ address: string }>(
      `SELECT address FROM agent_chain_wallets
        WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
        LIMIT 1`,
      [delegation.payer_agent_id, delegation.mode, delegation.chain],
    );
    const payerRow = payer.rows[0];
    if (payerRow === undefined) throw new Error('agent_wallet_not_found');

    const drawdownId = prefixedId('deledraw');
    // Inserted 'submitted' before the provider call so a crash mid-call
    // leaves a record, matching the shape of every other job-style write
    // in this codebase -- but see the note below: this whole function
    // runs in one DB transaction, so a mid-call crash still rolls this
    // back. If drawdowns move to a worker/job model later, split this
    // insert into its own committed transaction first.
    await client.query(
      `INSERT INTO agent_delegation_drawdowns (id, delegation_id, amount_usdc, status)
       VALUES ($1, $2, $3::numeric, 'submitted')`,
      [drawdownId, input.delegationId, input.amountUsdc],
    );

    const executed = await provider.executePermit2Transaction({
      mode: delegation.mode,
      chain: delegation.chain,
      senderAddress: delegation.payee_address,
      abiFunctionSignature: 'transferFrom(address,address,uint160,address)',
      abiParameters: [payerRow.address, delegation.payee_address, amountMicros.toString(), delegation.token_address],
      // Kept short -- see recordSignedDelegation's note on refId length.
      refId: `agentops-draw-${crypto.randomUUID()}`,
    });

    await client.query(
      `UPDATE agent_delegation_drawdowns SET tx_hash = $2, status = 'confirmed' WHERE id = $1`,
      [drawdownId, executed.txHash],
    );

    const newDrawnMicros = drawnMicros + amountMicros;
    const newStatus = newDrawnMicros >= ceilingMicros ? 'exhausted' : 'active';
    await client.query(
      `UPDATE agent_delegations SET drawn_usdc = $2::numeric, status = $3, updated_at = now() WHERE id = $1`,
      [input.delegationId, formatUsdc(newDrawnMicros), newStatus],
    );

    return { txHash: executed.txHash, drawnUsdc: formatUsdc(newDrawnMicros) };
  });
}

export type RevokeDelegationInput = {
  readonly delegationId: string;
};

/**
 * Revokes a delegation via Permit2's lockdown(), which invalidates the
 * allowance on-chain instantly -- not just a local status flip.
 */
export async function revokeDelegation(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: RevokeDelegationInput,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const locked = await client.query<AgentDelegationRow>(
      'SELECT * FROM agent_delegations WHERE id = $1 FOR UPDATE',
      [input.delegationId],
    );
    const delegation = locked.rows[0];
    if (delegation === undefined) throw new Error('agent_delegation_not_found');
    if (delegation.status === 'revoked') return;

    const payer = await client.query<{ address: string }>(
      `SELECT address FROM agent_chain_wallets
        WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
        LIMIT 1`,
      [delegation.payer_agent_id, delegation.mode, delegation.chain],
    );
    const payerRow = payer.rows[0];
    if (payerRow === undefined) throw new Error('agent_wallet_not_found');

    // lockdown(AllowanceTransferDetails[]) -- a single-entry array
    // revoking exactly this token/spender pair, submitted by the payer
    // (only the owner can revoke their own allowance).
    await provider.executePermit2Transaction({
      mode: delegation.mode,
      chain: delegation.chain,
      senderAddress: payerRow.address,
      abiFunctionSignature: 'lockdown((address,address)[])',
      abiParameters: [[[delegation.token_address, delegation.payee_address]]],
      // Kept short -- see recordSignedDelegation's note on refId length.
      refId: `agentops-revoke-${crypto.randomUUID()}`,
    });

    await client.query(
      `UPDATE agent_delegations SET status = 'revoked', updated_at = now() WHERE id = $1`,
      [input.delegationId],
    );
  });
}
