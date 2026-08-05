import type pg from 'pg';
import { conflict } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import type { PaymentChain, PaymentMode } from './types.js';

export type ResolveAgentPayeeInput = {
  readonly orgId: string;
  readonly agentId: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
};

export type ResolvedAgentPayee = {
  readonly address: string;
  readonly agentId: string;
};

/**
 * Resolves a fleet agent as a payment destination and auto-allowlists its
 * wallet address for Phase 5's payTo guard. Intra-fleet payees come from
 * OUR database (a wallet this system provisioned), not from an untrusted
 * 402 response -- source = 'agent_wallet' distinguishes this from a
 * manually-approved marketplace/tenant_configured entry, matching the
 * plan's D2b Mode 1 rule that trust already exists between agents
 * answering to the same treasury.
 *
 * Idempotent: resolving the same agent twice does not duplicate the
 * allowlist row (ON CONFLICT DO NOTHING on the existing UNIQUE
 * (org_id, chain, address) constraint).
 */
export async function resolveAgentPayee(
  pool: pg.Pool,
  input: ResolveAgentPayeeInput,
): Promise<ResolvedAgentPayee> {
  const wallet = await pool.query<{ address: string }>(
    `SELECT address FROM agent_chain_wallets
      WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'active'
      LIMIT 1`,
    [input.agentId, input.mode, input.chain],
  );
  const walletRow = wallet.rows[0];
  // An expected state, not a fault: an agent only has a wallet once payment
  // access was granted with a dedicated wallet for a rail on THIS chain, and
  // the circle-worker finished provisioning it to 'active'. A bare Error
  // here surfaced as a 500 with no indication of which of those steps was
  // missing, or that the chain is the part that has to match.
  if (walletRow === undefined) {
    throw conflict(
      'agent_wallet_not_found',
      `This agent has no active wallet on ${input.chain}. Grant it payment access with a dedicated wallet on a ${input.chain} rail, and wait for provisioning to finish, then try again.`,
    );
  }

  await pool.query(
    `INSERT INTO payment_destination_allowlist (id, org_id, chain, address, label, source, created_by)
     VALUES ($1, $2, $3, $4, $5, 'agent_wallet', $6)
     ON CONFLICT (org_id, chain, address) DO NOTHING`,
    [
      prefixedId('payto'), input.orgId, input.chain, walletRow.address,
      `Fleet agent ${input.agentId}`, 'system',
    ],
  );

  return { address: walletRow.address, agentId: input.agentId };
}
