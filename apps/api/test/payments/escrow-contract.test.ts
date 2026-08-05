import { describe, expect, it } from 'vitest';
import {
  escrowAddressFor,
  escrowTokenAddressFor,
  ESCROW_FUND_SIGNATURE,
  parseJobCreated,
} from '../../src/engines/payments/escrow-contract.js';

const ESCROW_ADDRESS = '0x31C050d9D20504c4E11b2A894051d8181B14e0F5';

// keccak256("JobCreated(uint256,address,address,address,uint48,address)").
// Hardcoded rather than recomputed with viem so this fixture is a real log
// shape, not a round-trip through the same encoder the parser uses.
const JOB_CREATED_TOPIC = '0x834a72f190664642fdcd90aae4371388adece09d5bbc96f411c84fc61b3e31aa';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

/**
 * A real JobCreated log: jobId/client/provider are indexed (topics 1-3),
 * evaluator/expiredAt/hook are three ABI words of `data`.
 */
function jobCreatedLog(jobId: bigint, address: string) {
  return {
    address,
    topics: [
      JOB_CREATED_TOPIC,
      `0x${word(jobId.toString(16))}`,
      `0x${word('0x1111111111111111111111111111111111111111')}`,
      `0x${word('0x2222222222222222222222222222222222222222')}`,
    ],
    data: `0x${word('0x3333333333333333333333333333333333333333')}${word('68e7f100')}${word('0')}`,
  };
}

describe('escrow contract config', () => {
  it('resolves the deployed escrow per chain', () => {
    expect(escrowAddressFor('arc')).toBe('0x31C050d9D20504c4E11b2A894051d8181B14e0F5');
    expect(escrowAddressFor('base')).toBe('0x31C050d9D20504c4E11b2A894051d8181B14e0F5');
  });

  it('refuses chains where no escrow is deployed', () => {
    // Only Arc and Base Sepolia were deployed in piece 1. Anything else must
    // fail loudly rather than default to a same-looking address.
    expect(() => escrowAddressFor('polygon')).toThrow(/escrow_not_deployed_on_chain/);
  });

  it('resolves the token each escrow was allowed to hold', () => {
    // Unlike the escrow addresses, these genuinely differ per chain -- the
    // proof that the lookup is per-chain and not a shared constant.
    expect(escrowTokenAddressFor('arc')).toBe('0x3600000000000000000000000000000000000000');
    expect(escrowTokenAddressFor('base')).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(() => escrowTokenAddressFor('optimism')).toThrow(/escrow_not_deployed_on_chain/);
  });

  it('always uses the guarded fund signature, never the stale one', () => {
    expect(ESCROW_FUND_SIGNATURE).toBe('fund(uint256,address,uint256,bytes)');
    expect(ESCROW_FUND_SIGNATURE).not.toBe('fund(uint256,bytes)');
  });
});

describe('parseJobCreated', () => {
  it('reads the chain-assigned job id out of a createJob receipt', () => {
    // createJob returns uint256 on-chain, but the treasury provider hands
    // back only a tx hash -- the id can only come from the event.
    const logs = [jobCreatedLog(4242n, ESCROW_ADDRESS)];

    expect(parseJobCreated(logs, ESCROW_ADDRESS)).toBe(4242n);
  });

  it('matches the escrow address case-insensitively', () => {
    // Receipts carry lowercase addresses; deployments.json is checksummed.
    const logs = [jobCreatedLog(7n, ESCROW_ADDRESS.toLowerCase())];

    expect(parseJobCreated(logs, ESCROW_ADDRESS)).toBe(7n);
  });

  it('ignores JobCreated logs emitted by a different contract', () => {
    // A receipt can contain logs from any contract the tx touched. Reading
    // an id off someone else's escrow would bind our row to a job we do
    // not own -- returning undefined is the only safe answer.
    const logs = [jobCreatedLog(99n, '0x9999999999999999999999999999999999999999')];

    expect(parseJobCreated(logs, ESCROW_ADDRESS)).toBeUndefined();
  });

  it('ignores unrelated logs from the escrow itself', () => {
    const logs = [
      {
        address: ESCROW_ADDRESS,
        // ERC-20 Transfer, not JobCreated.
        topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
        data: '0x',
      },
      jobCreatedLog(12n, ESCROW_ADDRESS),
    ];

    expect(parseJobCreated(logs, ESCROW_ADDRESS)).toBe(12n);
  });

  it('returns undefined when the receipt has no logs at all', () => {
    expect(parseJobCreated([], ESCROW_ADDRESS)).toBeUndefined();
  });
});
