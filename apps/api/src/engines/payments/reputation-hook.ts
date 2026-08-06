import type pg from 'pg';
import { prefixedId } from '../identity/ids.js';
import { findAgentWallet } from './agent-wallets.js';
import type { CircleTreasuryProvider } from './circle-provider.js';
import type { EscrowJobRow } from './escrow.js';
import type { PaymentChain, PaymentMode } from './types.js';

// ---------------------------------------------------------------------------
// Payment-gated ERC-8004 reputation [manifest D4].
//
// ERC-8004's own spec forbids only SELF-feedback -- any other address may
// write feedback with zero proof a real job happened. This module is the
// gate the standard itself lacks: the ONLY call path into
// agent_reputation_events is this file, and the table's escrow_job_id column
// is NOT NULL with a foreign key into escrow_jobs, so "reputation with no
// settled job" is refused by Postgres, not by a convention someone could
// route around later.
//
// The on-chain broadcast (Reputation Registry's giveFeedback) is
// deliberately best-effort. A DB row proving the job earned reputation is
// written FIRST; the on-chain write happens after and its failure is
// swallowed. ERC-8183 flags hooks as running inside the state-change path --
// a reputation failure is an operational problem, a reverted escrow
// completion is a money problem, and this module must never turn the first
// into the second.
// ---------------------------------------------------------------------------

// Deployed as a singleton per chain by the ERC-8004 reference deployer,
// confirmed live against Arc testnet via eth_getCode (identical proxy
// bytecode to the Identity registry -- both delegatecall proxies from the
// same factory) and cross-checked against the canonical
// erc-8004/erc-8004-contracts source for giveFeedback's real signature.
export const REPUTATION_REGISTRY_ADDRESS = '0x8004B663056A597Dffe9eCcC1965A193B7388713';

export const REPUTATION_GIVE_FEEDBACK_SIGNATURE =
  'giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)';

const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

// Payment-gated reputation is a binary earned signal -- "this job genuinely
// completed" -- not a qualitative 1-100 rating from a human. ERC-8183's
// complete() carries no separate score, so every genuine completion writes
// the same value; Task 3's allocation feedback aggregates across jobs rather
// than trusting any single number.
const COMPLETION_SCORE = 100;

export type ReputationRegistryClient = {
  readonly writeFeedback: (input: {
    readonly mode: PaymentMode;
    readonly chain: PaymentChain;
    readonly senderAddress: string;
    readonly agentTokenId: string;
    readonly score: number;
  }) => Promise<{ readonly txHash: string }>;
};

/** The real registry client: submits giveFeedback via the Circle provider. */
export function reputationRegistryFromProvider(provider: CircleTreasuryProvider): ReputationRegistryClient {
  return {
    writeFeedback: async (input) => {
      const sent = await provider.executePermit2Transaction({
        mode: input.mode,
        chain: input.chain,
        senderAddress: input.senderAddress,
        abiFunctionSignature: REPUTATION_GIVE_FEEDBACK_SIGNATURE,
        abiParameters: [
          input.agentTokenId,
          input.score.toString(), // int128 value
          '0', // uint8 valueDecimals -- score is already a plain 0-100 integer
          'escrow_completion', // tag1
          '', // tag2
          '', // endpoint
          '', // feedbackURI
          ZERO_BYTES32, // feedbackHash
        ],
        contractAddress: REPUTATION_REGISTRY_ADDRESS,
        refId: `agentops-reputation-${crypto.randomUUID()}`,
      });
      return { txHash: sent.txHash };
    },
  };
}

export type AgentReputationEventRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly escrow_job_id: string;
  readonly score: number;
  readonly feedback_tx_hash: string | null;
};

export type WriteReputationInput = {
  readonly orgId: string;
  readonly agentId: string;
  // string | null rather than a required string: the whole point is that
  // Postgres, not TypeScript, is what refuses a null here (NOT NULL + the
  // escrow_jobs foreign key) -- "rejected at the database level" per the
  // Phase 8 done criteria, not merely rejected by a type that could be
  // widened later without anyone noticing.
  readonly escrowJobId: string | null;
  readonly score: number;
};

/**
 * Writes one reputation event. UNIQUE(escrow_job_id) makes a second write
 * for the same job a no-op (returns undefined) rather than a second, milked
 * feedback entry for one completion.
 */
export async function writeReputation(
  pool: pg.Pool,
  input: WriteReputationInput,
): Promise<AgentReputationEventRow | undefined> {
  const inserted = await pool.query<AgentReputationEventRow>(
    `INSERT INTO agent_reputation_events (id, org_id, agent_id, escrow_job_id, score)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (escrow_job_id) DO NOTHING
     RETURNING *`,
    [prefixedId('repev'), input.orgId, input.agentId, input.escrowJobId, input.score],
  );
  return inserted.rows[0];
}

/**
 * The address, when it belongs to one of THIS platform's own agents.
 *
 * agent_reputation_events.agent_id references our own `agents` table, so an
 * escrow provider that is not one of our agents (a genuinely external
 * counterparty) has no row to attach reputation to -- returning null here is
 * the normal case for most escrow jobs, not an error.
 */
async function resolveProviderAgentId(
  pool: pg.Pool,
  input: { readonly orgId: string; readonly address: string; readonly mode: PaymentMode; readonly chain: PaymentChain },
): Promise<string | null> {
  const result = await pool.query<{ agent_id: string }>(
    `SELECT agent_id FROM agent_chain_wallets
      WHERE org_id = $1 AND lower(address) = lower($2) AND mode = $3 AND chain = $4 AND status = 'active'
      LIMIT 1`,
    [input.orgId, input.address, input.mode, input.chain],
  );
  return result.rows[0]?.agent_id ?? null;
}

export type OnEscrowCompletedInput = {
  readonly jobId: string;
};

/**
 * Fires on a genuine escrow `complete` -- re-reads the job's OWN state
 * rather than trusting whatever a caller claims, so this can never be used
 * to write feedback for a job that never actually settled.
 *
 * Deliberately a plain function called after an escrow completion commits,
 * not code that runs inside that transaction: the ERC-8183 spec calls hooks
 * a footgun precisely because they run in the state-change path, and this
 * function's own errors (past the not_completed guard) never propagate.
 */
export async function onEscrowCompleted(
  pool: pg.Pool,
  input: OnEscrowCompletedInput,
  registry: ReputationRegistryClient,
): Promise<void> {
  const jobResult = await pool.query<EscrowJobRow>('SELECT * FROM escrow_jobs WHERE id = $1', [input.jobId]);
  const job = jobResult.rows[0];
  if (job === undefined) throw new Error('escrow_job_not_found');
  // expired means "delivered but never evaluated" -- not a proven
  // completion, and rejected obviously isn't one either. Only a genuine
  // 'completed' state earns anything.
  if (job.state !== 'completed') throw new Error(`reputation_write_refused:not_completed:${job.state}`);

  const agentId = await resolveProviderAgentId(pool, {
    orgId: job.org_id, address: job.provider_address, mode: job.mode, chain: job.chain,
  });
  if (agentId === null) return;

  const event = await writeReputation(pool, {
    orgId: job.org_id, agentId, escrowJobId: job.id, score: COMPLETION_SCORE,
  });
  // undefined means a feedback row for this job already existed (the UNIQUE
  // constraint's ON CONFLICT DO NOTHING) -- already earned, nothing more to
  // broadcast.
  if (event === undefined) return;

  try {
    const identity = await pool.query<{ token_id: string | null }>(
      `SELECT token_id FROM agent_onchain_identities
        WHERE agent_id = $1 AND mode = $2 AND chain = $3 AND status = 'registered'`,
      [agentId, job.mode, job.chain],
    );
    const tokenId = identity.rows[0]?.token_id;
    // No on-chain identity to attach feedback to yet -- the DB event above
    // already stands as the earned-reputation record.
    if (tokenId === null || tokenId === undefined) return;

    // The CLIENT submits feedback about the PROVIDER -- ERC-8004's Reputation
    // Registry reverts "Self-feedback not allowed" when the submitter is the
    // agentId's own owner/operator, so this must never be the provider's own
    // wallet.
    const clientWallet = await findAgentWallet(pool, job.client_agent_id, job.mode, job.chain);
    if (clientWallet === null) return;

    const sent = await registry.writeFeedback({
      mode: job.mode,
      chain: job.chain,
      senderAddress: clientWallet.address,
      agentTokenId: tokenId,
      score: COMPLETION_SCORE,
    });
    await pool.query('UPDATE agent_reputation_events SET feedback_tx_hash = $2 WHERE id = $1', [event.id, sent.txHash]);
  } catch {
    // Operational problem, not a money problem -- see the module doc
    // comment. The earned-reputation DB row above already stands.
  }
}
