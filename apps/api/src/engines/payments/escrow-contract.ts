import { decodeEventLog, parseAbi } from 'viem';
import type { PaymentChain } from './types.js';

// ERC-8183 escrow function signatures, in the `abiFunctionSignature` shape
// the Circle provider's contract-execution calls take. Every one of these
// was verified against the deployed proxy by selector in piece 1 -- do not
// re-derive them by hand.
export const ESCROW_CREATE_JOB_SIGNATURE = 'createJob(address,address,uint48,string,address,uint256)';
export const ESCROW_SET_BUDGET_SIGNATURE = 'setBudget(uint256,address,uint256,bytes)';
// The GUARDED fund overload -- always this one. Earlier ERC-8183 drafts
// shipped a two-argument fund taking only (jobId, data): it names neither
// token nor amount, so it cannot express what is actually being escrowed.
// That stale overload must never appear anywhere in this codebase.
export const ESCROW_FUND_SIGNATURE = 'fund(uint256,address,uint256,bytes)';
export const ESCROW_SUBMIT_SIGNATURE = 'submit(uint256,bytes32,bytes)';
export const ESCROW_COMPLETE_SIGNATURE = 'complete(uint256,bytes32,bytes)';
export const ESCROW_REJECT_SIGNATURE = 'reject(uint256,bytes32,bytes)';
export const ESCROW_CLAIM_REFUND_SIGNATURE = 'claimRefund(uint256)';
export const ESCROW_GET_JOB_SIGNATURE = 'getJob(uint256)';

type EscrowDeployment = {
  readonly escrowAddress: string;
  // The token the escrow was actually allowed to hold (its allowToken tx),
  // not merely "the USDC of that chain". The contract rejects anything else.
  readonly tokenAddress: string;
};

// Read from packages/onchain/deployments.json. The two escrow addresses are
// identical only by coincidence -- same deployer, same nonce, plain CREATE.
// Always look the address up per chain; never collapse them into one shared
// constant, or the next deployment on either chain silently pays the wrong
// contract.
const ESCROW_DEPLOYMENTS: Partial<Record<PaymentChain, EscrowDeployment>> = {
  arc: {
    escrowAddress: '0x31C050d9D20504c4E11b2A894051d8181B14e0F5',
    tokenAddress: '0x3600000000000000000000000000000000000000',
  },
  base: {
    escrowAddress: '0x31C050d9D20504c4E11b2A894051d8181B14e0F5',
    tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
};

function escrowDeploymentFor(chain: PaymentChain): EscrowDeployment {
  const deployment = ESCROW_DEPLOYMENTS[chain];
  // Fail loudly. Defaulting to a same-looking address on an undeployed
  // chain would send a real fund() into an empty account.
  if (deployment === undefined) throw new Error(`escrow_not_deployed_on_chain:${chain}`);
  return deployment;
}

/** The ERC-8183 escrow proxy deployed on `chain`. Throws if none exists. */
export function escrowAddressFor(chain: PaymentChain): string {
  return escrowDeploymentFor(chain).escrowAddress;
}

/** The one token that chain's escrow will accept. Throws if none exists. */
export function escrowTokenAddressFor(chain: PaymentChain): string {
  return escrowDeploymentFor(chain).tokenAddress;
}

// Matches the vendored ERC8183.sol exactly: jobId/client/provider are
// indexed (topics 1-3), evaluator/expiredAt/hook live in `data`. Getting
// the indexed/non-indexed split wrong changes topic0 and nothing decodes.
const jobCreatedAbi = parseAbi([
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint48 expiredAt, address hook)',
]);

/** One entry of a transaction receipt's `logs`, as any EVM provider returns it. */
export type EscrowReceiptLog = {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
};

/**
 * Extracts the chain-assigned job id from a createJob receipt.
 *
 * createJob returns uint256 on-chain, but the treasury provider only hands
 * back a tx hash -- so the event is the ONLY way to learn the id, and
 * without it an escrow_jobs row can never be linked to the chain.
 *
 * Only logs emitted by `escrowAddress` count. A receipt may carry logs from
 * every contract the transaction touched, and reading an id off a different
 * escrow would bind our row to a job we do not own. Returns undefined
 * rather than guessing when no matching log is present.
 */
export function parseJobCreated(
  logs: readonly EscrowReceiptLog[],
  escrowAddress: string,
): bigint | undefined {
  // Receipts carry lowercase addresses; deployments.json is checksummed.
  const target = escrowAddress.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== target) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: jobCreatedAbi,
        data: log.data as `0x${string}`,
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      });
    } catch {
      // Some other event from the same contract -- topic0 does not match
      // JobCreated, so viem refuses to decode it. Not an error here.
      continue;
    }
    if (decoded.eventName !== 'JobCreated') continue;
    return decoded.args.jobId;
  }
  return undefined;
}
