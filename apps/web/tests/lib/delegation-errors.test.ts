import { describe, expect, it } from 'vitest';
import {
  formatDelegationFailure,
  formatDelegationFailureFromBody,
  isGasIndexerInsufficientMessage,
} from '@/lib/delegation-errors';

describe('delegation-errors', () => {
  it('detects Circle gas / asset insufficiency copy', () => {
    expect(
      isGasIndexerInsufficientMessage(
        'the asset amount owned by the wallet is insufficient for the transaction.',
      ),
    ).toBe(true);
  });

  it('explains Arc/Circle gas indexer work instead of dumping raw JSON', () => {
    const text = formatDelegationFailureFromBody(
      JSON.stringify({
        error: 'delegation_record_failed',
        message: 'the asset amount owned by the wallet is insufficient for the transaction.',
      }),
    );
    expect(text).toContain('working with the Arc team');
    expect(text).toContain('indexer');
    expect(text).not.toContain('delegation_record_failed');
  });

  it('keeps known ceiling errors readable', () => {
    expect(
      formatDelegationFailure({
        error: 'treasury_insufficient_for_ceiling',
        message: 'ignored',
      }),
    ).toMatch(/Treasury does not hold enough USDC/);
  });
});
