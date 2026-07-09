import { describe, expect, it } from 'vitest';
import { x402UsdcMicrosFromAccept } from '../../src/engines/payments/store.js';

describe('x402 payment amount parsing', () => {
  it('treats v2 x402 integer amount as USDC atomic units', () => {
    expect(x402UsdcMicrosFromAccept({ amount: '1000', network: 'eip155:84532', scheme: 'exact' })).toBe(1000n);
  });

  it('treats v1 maxAmountRequired as USDC atomic units', () => {
    expect(x402UsdcMicrosFromAccept({ maxAmountRequired: '2500', network: 'base-sepolia', scheme: 'exact' })).toBe(2500n);
  });

  it('keeps legacy decimal amount support for simple internal network aliases', () => {
    expect(x402UsdcMicrosFromAccept({ amount: '1.25', network: 'base', scheme: 'exact' })).toBe(1_250_000n);
  });
});
