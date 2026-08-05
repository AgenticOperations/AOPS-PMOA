import { encodeFunctionData, parseAbi } from 'viem';
import type pg from 'pg';
import { badRequest, conflict } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import { chainRpcUrl } from './agent-wallets.js';
import { outstandingHeadroomMicros } from './delegation-ceiling.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import { usdcTokenAddress } from './circle-provider.js';
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
  // NULL when the payer is a user-owned wallet rather than an agent.
  readonly payer_agent_id: string | null;
  readonly payer_address: string;
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
  // Discriminates the three payer kinds. payer_agent_id IS NULL cannot do
  // it alone: that is true for BOTH a user-owned wallet and the treasury.
  readonly payer_kind: 'user' | 'agent' | 'treasury';
};

export type RecordSignedDelegationInput = {
  readonly orgId: string;
  // Set when the payer is an agent this platform holds keys for. Omitted
  // for a user-owned wallet, which supplies payerAddress + signature
  // instead -- see the userSigned pair below.
  readonly payerAgentId?: string | undefined;
  readonly payeeAgentId?: string | undefined;
  // Draws from the ORG TREASURY rather than an agent or a user wallet.
  // Mutually exclusive with userSigned and payerAgentId: the treasury is a
  // platform-controlled wallet, so the platform signs the permit itself.
  readonly payerTreasury?: boolean | undefined;
  readonly payeeAddress: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly tokenAddress?: string | undefined;
  readonly ceilingUsdc: string;
  readonly expiresAt: Date;
  readonly approvedBy: string;
  // A delegation signed by the operator's own wallet in the browser. The
  // platform never holds this key, so it can neither produce the signature
  // nor send the ERC-20 approve() -- both happen client-side. Supplying
  // this pair is what makes the non-custodial flow possible.
  readonly userSigned?: {
    readonly payerAddress: string;
    readonly signature: string;
    // Echoed back from the typed-data call. Permit2 nonces are strictly
    // increasing per (owner, token, spender); re-reading it here could
    // pick up a different value than the user actually signed over, which
    // would revert on-chain with no useful error.
    readonly nonce: bigint;
  } | undefined;
};

// EIP-712 domain chainId per PaymentChain -- Permit2's signature is only
// valid on the chain named in the domain, so a cross-chain delegation
// (e.g. Orchestrator -> Base SeniorReviewer) MUST sign against Base's
// chainId, not Arc's. Verified live for Arc only (spike S4); Base uses
// the well-known public chainId (Base Sepolia testnet).
const PERMIT2_DOMAIN_CHAIN_ID: Record<PaymentChain, number> = {
  arc: 5042002,
  base: 84532,
  arbitrum: 421614,
  polygon: 80002,
  optimism: 11155420,
  avalanche: 43113,
};

/**
 * Picks an address the platform can actually send permit() from.
 *
 * Permit2 recovers the owner from the signature, so the submitter is free
 * -- it only needs a key this platform holds and enough gas. Order:
 *
 *   1. the payer, when it's an agent wallet (agent-to-agent: unchanged)
 *   2. the payee, when it's an agent wallet (user-owned payer)
 *   3. the org treasury (user-owned payer paying an off-fleet address)
 *
 * Throws rather than guessing if none qualify: submitting from an address
 * without a key fails deep inside Circle with an opaque error.
 */
async function resolvePermitSubmitter(
  db: pg.PoolClient,
  input: {
    readonly orgId: string;
    readonly mode: PaymentMode;
    readonly chain: PaymentChain;
    readonly payerAddress: string;
    readonly payerIsPlatformControlled: boolean;
    readonly payeeAgentId?: string | undefined;
    readonly payeeAddress: string;
  },
): Promise<string> {
  if (input.payerIsPlatformControlled) return input.payerAddress;

  if (input.payeeAgentId !== undefined) {
    const payee = await db.query<{ address: string }>(
      `SELECT address FROM agent_chain_wallets
        WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
        LIMIT 1`,
      [input.payeeAgentId, input.mode, input.chain],
    );
    const address = payee.rows[0]?.address;
    if (address !== undefined) return address;
  }

  const treasury = await db.query<{ address: string }>(
    `SELECT address FROM circle_chain_wallets
      WHERE org_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
      LIMIT 1`,
    [input.orgId, input.mode, input.chain],
  );
  const treasuryAddress = treasury.rows[0]?.address;
  if (treasuryAddress !== undefined) return treasuryAddress;

  throw new Error('permit_submitter_unavailable');
}

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
    // Three payer kinds, resolved to one address. Everything downstream
    // works off payerAddress alone; payerKind is recorded so just-in-time
    // funding can tell a treasury delegation from a user-owned one --
    // payer_agent_id IS NULL is true for BOTH and cannot discriminate.
    let payerAddress: string;
    let payerKind: 'user' | 'agent' | 'treasury';
    if (input.userSigned !== undefined) {
      payerAddress = input.userSigned.payerAddress;
      payerKind = 'user';
    } else if (input.payerTreasury === true) {
      const treasury = await client.query<{ address: string }>(
        `SELECT address FROM circle_chain_wallets
          WHERE org_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
          LIMIT 1`,
        [input.orgId, input.mode, input.chain],
      );
      const treasuryRow = treasury.rows[0];
      if (treasuryRow === undefined) throw new Error('org_treasury_wallet_not_found');
      payerAddress = treasuryRow.address;
      payerKind = 'treasury';
    } else {
      if (input.payerAgentId === undefined) throw new Error('delegation_payer_required');
      const payer = await client.query<{ address: string }>(
        `SELECT address FROM agent_chain_wallets
          WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
          LIMIT 1`,
        [input.payerAgentId, input.mode, input.chain],
      );
      const payerRow = payer.rows[0];
      if (payerRow === undefined) throw new Error('agent_wallet_not_found');
      payerAddress = payerRow.address;
      payerKind = 'agent';
    }

    const tokenAddress = input.tokenAddress ?? usdcTokenAddress(input.mode, input.chain);
    const ceilingMicros = parseUsdcMicros(input.ceilingUsdc);
    const expirationSeconds = Math.floor(input.expiresAt.getTime() / 1000);
    // Permit2 requires a strictly increasing nonce per owner/token/spender
    // -- MUST read the real current value, never assume 0. A hardcoded 0
    // makes every delegation after the first for the same triple silently
    // revert on-chain (confirmed live: a stale nonce produced an opaque
    // "API parameter invalid" from Circle rather than a clear revert
    // reason, so this bug would have been very hard to diagnose from the
    // error message alone).
    // A user-signed delegation carries the nonce it was actually signed
    // over. Re-reading it here could return a different value (another
    // delegation may have landed in between), and the signature would then
    // revert on-chain against a nonce nobody signed.
    const nonce = input.userSigned?.nonce
      ?? await readPermit2Nonce(payerAddress, tokenAddress, input.payeeAddress, input.chain);

    let signature: string;
    if (input.userSigned !== undefined) {
      // The operator's wallet already signed this in the browser, and sent
      // the ERC-20 approve() itself. The platform holds no key for this
      // address, so it can do neither -- which is the whole point.
      signature = input.userSigned.signature;
    } else {
      const { typedData } = buildPermitSingle({
        chainId: PERMIT2_DOMAIN_CHAIN_ID[input.chain],
        tokenAddress,
        spenderAddress: input.payeeAddress,
        amountMicros: ceilingMicros,
        expiration: expirationSeconds,
        nonce,
      });

      const signed = await provider.signPermit2Delegation({
        chain: input.chain,
        mode: input.mode,
        ownerAddress: payerAddress,
        typedData,
      });
      signature = signed.signature;

      // Permit2 moves funds via the TOKEN's own transferFrom, so the token
      // must first allow Permit2 to spend the payer's balance. Without this
      // the whole flow still signs and permits cleanly, then reverts at
      // drawDown with `TRANSFER_FROM_FAILED` -- the token refusing a pull it
      // was never approved for. Spike S4 proved this exact ordering on Arc:
      // approve(Permit2) -> permit() -> transferFrom().
      //
      // Approved at TOTAL OUTSTANDING HEADROOM, not this delegation's
      // ceiling. ERC-20 approve SETS rather than adds, so with one treasury
      // paying many agents, approving just this ceiling would silently strip
      // every earlier agent's allowance. Still bounded rather than
      // maxUint160: a Permit2 compromise can never exceed what the org has
      // actually delegated.
      const approvalMicros = await outstandingHeadroomMicros(client, {
        orgId: input.orgId,
        payerAddress,
        mode: input.mode,
        chain: input.chain,
        tokenAddress,
      }) + ceilingMicros;

      await provider.executePermit2Transaction({
        mode: input.mode,
        chain: input.chain,
        senderAddress: payerAddress,
        abiFunctionSignature: 'approve(address,uint256)',
        abiParameters: [PERMIT2_ADDRESS, approvalMicros.toString()],
        contractAddress: tokenAddress,
        refId: `agentops-p2-approve-${crypto.randomUUID()}`,
      });
    }

    // The signature alone does nothing -- Permit2 only recognizes it once
    // permit() has actually submitted it on-chain, recording the allowance
    // in Permit2's own storage. Without this step, drawDown's transferFrom
    // would fail against a real zero allowance forever.
    //
    // Permit2 recovers the owner from the signature, so ANYONE may submit
    // permit(). That matters: a user-owned payer has no key here, so the
    // platform submits from a wallet it does control. Preference order is
    // payer (agent-to-agent, unchanged) -> payee -> org treasury.
    const permitSubmitter = await resolvePermitSubmitter(client, {
      orgId: input.orgId,
      mode: input.mode,
      chain: input.chain,
      payerAddress,
      payerIsPlatformControlled: input.userSigned === undefined,
      payeeAgentId: input.payeeAgentId,
      payeeAddress: input.payeeAddress,
    });

    await provider.executePermit2Transaction({
      mode: input.mode,
      chain: input.chain,
      senderAddress: permitSubmitter,
      abiFunctionSignature: 'permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)',
      abiParameters: [
        payerAddress,
        [[tokenAddress, ceilingMicros.toString(), expirationSeconds.toString(), nonce.toString()], input.payeeAddress, expirationSeconds.toString()],
        signature,
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
         id, org_id, payer_agent_id, payer_address, payee_agent_id, payee_address, mode, chain,
         token_address, ceiling_usdc, expires_at, permit_nonce, signature,
         status, approved_by, payer_kind
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11, $12, $13, 'active', $14, $15)
       RETURNING *`,
      [
        prefixedId('dele'), input.orgId, payerKind === 'agent' ? input.payerAgentId : null, payerAddress,
        input.payeeAgentId ?? null,
        input.payeeAddress, input.mode, input.chain, tokenAddress,
        input.ceilingUsdc, input.expiresAt, nonce, signature, input.approvedBy, payerKind,
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

    // payer_address is recorded on the delegation itself, so a drawdown
    // works whether the payer is an agent wallet or a user-owned one the
    // platform holds no key for -- the payee submits transferFrom either way.
    const payerAddress = delegation.payer_address;

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
      abiParameters: [payerAddress, delegation.payee_address, amountMicros.toString(), delegation.token_address],
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
export type RevokeDelegationResult = {
  // false when the payer is a user-owned wallet: the row is revoked, but
  // the on-chain Permit2 allowance survives until the user signs lockdown()
  // themselves. Callers must surface that difference, never assume it.
  readonly onChainRevoked: boolean;
};

export async function revokeDelegation(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: RevokeDelegationInput,
): Promise<RevokeDelegationResult> {
  return withTransaction(pool, async (client) => {
    const locked = await client.query<AgentDelegationRow>(
      'SELECT * FROM agent_delegations WHERE id = $1 FOR UPDATE',
      [input.delegationId],
    );
    const delegation = locked.rows[0];
    if (delegation === undefined) throw new Error('agent_delegation_not_found');
    if (delegation.status === 'revoked') return { onChainRevoked: delegation.payer_agent_id !== null };

    // Permit2's lockdown() may ONLY be called by the allowance owner, so
    // for a user-owned payer this platform cannot submit it -- the user
    // signs that transaction in their own wallet.
    //
    // The row is still marked revoked either way, and that alone stops
    // this control plane from issuing further drawdowns. But be precise
    // about what that does and does not mean: until the on-chain lockdown
    // lands, the Permit2 allowance itself is still live. The caller learns
    // which case it got from onChainRevoked, and the UI must prompt for
    // the user's signature when it is false.
    const platformControlsPayer = delegation.payer_agent_id !== null;
    if (platformControlsPayer) {
      await provider.executePermit2Transaction({
        mode: delegation.mode,
        chain: delegation.chain,
        senderAddress: delegation.payer_address,
        abiFunctionSignature: 'lockdown((address,address)[])',
        abiParameters: [[[delegation.token_address, delegation.payee_address]]],
        // Kept short -- see recordSignedDelegation's note on refId length.
        refId: `agentops-revoke-${crypto.randomUUID()}`,
      });
    }

    await client.query(
      `UPDATE agent_delegations SET status = 'revoked', updated_at = now() WHERE id = $1`,
      [input.delegationId],
    );
    return { onChainRevoked: platformControlsPayer };
  });
}

export type BuildUserDelegationTypedDataInput = {
  readonly orgId: string;
  readonly payerAddress: string;
  readonly payeeAddress: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly tokenAddress?: string | undefined;
  readonly ceilingUsdc: string;
  readonly expiresAt: Date;
};

export type UserDelegationTypedData = {
  readonly typedData: Record<string, unknown>;
  // Returned so the caller can hand back the SAME nonce when recording the
  // signature. Re-reading it at record time could pick up a newer value and
  // the signature would revert on-chain against a nonce nobody signed.
  readonly nonce: string;
  readonly tokenAddress: string;
  // The user must have approved Permit2 for at least the ceiling before any
  // drawdown can succeed -- Permit2 pulls through the token's own
  // transferFrom. Surfaced so the UI can prompt for approve() only when it
  // is actually needed, instead of on every delegation.
  readonly permit2Address: string;
};

/**
 * Builds the exact EIP-712 payload a user's wallet should sign to delegate
 * spending authority to an agent. Nothing is written and nothing is sent
 * on-chain -- this is a pure read plus a payload the browser signs.
 */
export async function buildUserDelegationTypedData(
  input: BuildUserDelegationTypedDataInput,
): Promise<UserDelegationTypedData> {
  const tokenAddress = input.tokenAddress ?? usdcTokenAddress(input.mode, input.chain);
  const ceilingMicros = parseUsdcMicros(input.ceilingUsdc);
  const expirationSeconds = Math.floor(input.expiresAt.getTime() / 1000);
  const nonce = await readPermit2Nonce(input.payerAddress, tokenAddress, input.payeeAddress, input.chain);

  const { typedData } = buildPermitSingle({
    chainId: PERMIT2_DOMAIN_CHAIN_ID[input.chain],
    tokenAddress,
    spenderAddress: input.payeeAddress,
    amountMicros: ceilingMicros,
    expiration: expirationSeconds,
    nonce,
  });

  return {
    typedData,
    nonce: nonce.toString(),
    tokenAddress,
    permit2Address: PERMIT2_ADDRESS,
  };
}

export type DelegationSummary = {
  readonly id: string;
  readonly payerAgentId: string | null;
  readonly payerAddress: string;
  readonly payeeAgentId: string | null;
  readonly payeeAddress: string;
  readonly chain: PaymentChain;
  readonly tokenAddress: string;
  readonly ceilingUsdc: string;
  readonly drawnUsdc: string;
  readonly remainingUsdc: string;
  readonly expiresAt: Date;
  readonly status: string;
  // false for a user-owned payer: revoking here stops this control plane,
  // but only the owner can kill the on-chain allowance via lockdown().
  readonly platformControlsPayer: boolean;
};

export async function listDelegations(
  pool: pg.Pool,
  orgId: string,
  mode: PaymentMode,
): Promise<readonly DelegationSummary[]> {
  const result = await pool.query<AgentDelegationRow>(
    `SELECT * FROM agent_delegations
      WHERE org_id = $1 AND mode = $2
      ORDER BY created_at DESC`,
    [orgId, mode],
  );
  return result.rows.map((row) => {
    const remaining = parseUsdcMicros(row.ceiling_usdc) - parseUsdcMicros(row.drawn_usdc);
    return {
      id: row.id,
      payerAgentId: row.payer_agent_id,
      payerAddress: row.payer_address,
      payeeAgentId: row.payee_agent_id,
      payeeAddress: row.payee_address,
      chain: row.chain,
      tokenAddress: row.token_address,
      ceilingUsdc: row.ceiling_usdc,
      drawnUsdc: row.drawn_usdc,
      remainingUsdc: formatUsdc(remaining > 0n ? remaining : 0n),
      expiresAt: row.expires_at,
      status: row.status,
      platformControlsPayer: row.payer_agent_id !== null,
    };
  });
}
