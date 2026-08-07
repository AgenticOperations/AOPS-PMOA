import { decodeEventLog, parseAbi } from 'viem';
import type pg from 'pg';
import { prefixedId } from './ids.js';
import { findAgentWallet, chainRpcUrl } from '../payments/agent-wallets.js';
import type { CircleTreasuryProvider } from '../payments/circle-provider.js';
import type { PaymentChain, PaymentMode } from '../payments/types.js';

// ---------------------------------------------------------------------------
// ERC-8004 IdentityRegistry. Deployed as a singleton PER CHAIN by the
// standard's reference deployer -- confirmed live against Arc testnet via
// eth_getCode (262 bytes, proxy-shaped, matching the Reputation registry's
// bytecode exactly -- both delegatecall proxies from the same factory) and
// cross-checked against the canonical erc-8004/erc-8004-contracts source for
// the real register()/giveFeedback() signatures. Tutorial docs alone were
// NOT trusted -- piece 1's escrow deploy already caught a tutorial ABI that
// did not match the deployed struct layout, and that lesson applies here.
// ---------------------------------------------------------------------------

export const IDENTITY_REGISTRY_ADDRESS = '0x8004A818BFB912233c491871b3d84c89A494BD9e';

// Overload with agentURI and no metadata -- Task 1 does not need per-agent
// metadata entries, and omitting them keeps the call (and this signature)
// simple. MetadataEntry[] stays available in the registry for whoever needs
// it later; this engine just doesn't reach for it yet.
export const IDENTITY_REGISTER_SIGNATURE = 'register(string)';

const registeredEventAbi = parseAbi([
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
]);

/** One entry of a transaction receipt's `logs`, as any EVM provider returns it. */
export type Erc8004ReceiptLog = {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
};

/**
 * Extracts the minted agentId from a register() receipt.
 *
 * register() returns uint256 on-chain, but the treasury provider hands back
 * only a tx hash -- so the id is recovered from the Registered event, the
 * same reasoning escrow-contract.ts's parseJobCreated already relies on.
 * Only logs emitted by the registry itself count.
 */
export function parseRegistered(
  logs: readonly Erc8004ReceiptLog[],
  registryAddress: string,
): bigint | undefined {
  const target = registryAddress.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== target) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: registeredEventAbi,
        data: log.data as `0x${string}`,
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== 'Registered') continue;
    return decoded.args.agentId;
  }
  return undefined;
}

const RECEIPT_MAX_ATTEMPTS = 6;
const RECEIPT_RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads a transaction receipt's logs. Injected so tests can supply a fixture. */
export type ReadReceiptLogs = (txHash: string, chain: PaymentChain) => Promise<readonly Erc8004ReceiptLog[]>;

/** The default receipt reader: a plain eth_getTransactionReceipt, retried. */
export const readReceiptLogsViaRpc: ReadReceiptLogs = async (txHash, chain) => {
  const rpcUrl = chainRpcUrl(chain);
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    throw new Error(`erc8004_receipt_rpc_not_configured:${chain}`);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= RECEIPT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }),
      });
      const body = await response.json() as {
        readonly result?: { readonly logs?: readonly Erc8004ReceiptLog[] } | null;
        readonly error?: { readonly message?: string };
      };
      if (body.error !== undefined) throw new Error(body.error.message ?? 'eth_getTransactionReceipt_rpc_error');
      if (body.result === undefined || body.result === null) throw new Error('erc8004_receipt_not_available');
      return body.result.logs ?? [];
    } catch (error) {
      lastError = error;
      if (attempt < RECEIPT_MAX_ATTEMPTS) await sleep(RECEIPT_RETRY_DELAY_MS);
    }
  }
  throw new Error(`erc8004_receipt_unavailable:${lastError instanceof Error ? lastError.message : 'unknown'}`);
};

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

export type AgentOnchainIdentityRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  readonly registry_address: string;
  readonly token_id: string | null;
  readonly agent_uri: string;
  readonly register_tx_hash: string | null;
  readonly status: 'pending' | 'registered' | 'failed';
};

export type RegisterAgentIdentityInput = {
  readonly orgId: string;
  readonly agentId: string;
  readonly mode: PaymentMode;
  readonly chain: PaymentChain;
  // Caller-supplied deliberately: this engine has no opinion on where an
  // agent's off-chain registration JSON is hosted, or whether one exists at
  // all yet. Reusing an env-config default here would hide that choice.
  readonly agentUri: string;
  readonly readReceiptLogs?: ReadReceiptLogs | undefined;
};

export async function getAgentOnchainIdentity(
  pool: pg.Pool,
  orgId: string,
  agentId: string,
  mode: PaymentMode,
  chain: PaymentChain,
): Promise<AgentOnchainIdentityRow | null> {
  const result = await pool.query<AgentOnchainIdentityRow>(
    `SELECT * FROM agent_onchain_identities
      WHERE org_id = $1 AND agent_id = $2 AND mode = $3 AND chain = $4`,
    [orgId, agentId, mode, chain],
  );
  return result.rows[0] ?? null;
}

/**
 * Registers an agent's ERC-8004 identity (an ERC-721 mint) and mirrors the
 * result locally.
 *
 * Idempotent against `UNIQUE (agent_id, mode, chain)`: a second call for an
 * already-registered agent returns the existing row rather than minting a
 * second NFT for the same agent.
 */
export async function registerAgentIdentity(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: RegisterAgentIdentityInput,
): Promise<AgentOnchainIdentityRow> {
  const readReceiptLogs = input.readReceiptLogs ?? readReceiptLogsViaRpc;

  return withTransaction(pool, async (client) => {
    const existing = await client.query<AgentOnchainIdentityRow>(
      `SELECT * FROM agent_onchain_identities
        WHERE agent_id = $1 AND mode = $2 AND chain = $3`,
      [input.agentId, input.mode, input.chain],
    );
    const existingRow = existing.rows[0];
    if (existingRow !== undefined && existingRow.status === 'registered') return existingRow;

    const wallet = await findAgentWallet(client, input.agentId, input.mode, input.chain);
    if (wallet === null) throw new Error(`erc8004_agent_wallet_not_found:${input.agentId}`);

    // The agent's own wallet submits and becomes the NFT owner -- ERC-8004
    // gives the token owner control of the entry, and Reputation Registry's
    // self-feedback guard checks ownership of exactly this identity later.
    const registered = await provider.executePermit2Transaction({
      mode: input.mode,
      chain: input.chain,
      senderAddress: wallet.address,
      abiFunctionSignature: IDENTITY_REGISTER_SIGNATURE,
      abiParameters: [input.agentUri],
      contractAddress: IDENTITY_REGISTRY_ADDRESS,
      refId: `agentops-erc8004-register-${crypto.randomUUID()}`,
    });

    const logs = await readReceiptLogs(registered.txHash, input.chain);
    const tokenId = parseRegistered(logs, IDENTITY_REGISTRY_ADDRESS);
    if (tokenId === undefined) {
      throw new Error(`erc8004_agent_id_not_in_receipt:${registered.txHash}`);
    }

    const upserted = await client.query<AgentOnchainIdentityRow>(
      `INSERT INTO agent_onchain_identities (
         id, org_id, agent_id, mode, chain, registry_address, token_id,
         agent_uri, register_tx_hash, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, 'registered')
       ON CONFLICT (agent_id, mode, chain) DO UPDATE SET
         token_id = EXCLUDED.token_id,
         agent_uri = EXCLUDED.agent_uri,
         register_tx_hash = EXCLUDED.register_tx_hash,
         status = 'registered',
         updated_at = now()
       RETURNING *`,
      [
        existingRow?.id ?? prefixedId('agtid'),
        input.orgId,
        input.agentId,
        input.mode,
        input.chain,
        IDENTITY_REGISTRY_ADDRESS,
        tokenId.toString(),
        input.agentUri,
        registered.txHash,
      ],
    );
    const row = upserted.rows[0];
    if (row === undefined) throw new Error('erc8004_identity_upsert_failed');
    return row;
  });
}
