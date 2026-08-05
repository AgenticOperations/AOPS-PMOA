import { describe, expect, it } from 'vitest';
import { escrowAddressFor, ESCROW_FUND_SIGNATURE } from '../../src/engines/payments/escrow-contract.js';

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

  it('always uses the guarded fund signature, never the stale one', () => {
    expect(ESCROW_FUND_SIGNATURE).toBe('fund(uint256,address,uint256,bytes)');
    expect(ESCROW_FUND_SIGNATURE).not.toBe('fund(uint256,bytes)');
  });
});
