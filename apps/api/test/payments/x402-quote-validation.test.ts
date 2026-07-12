import { describe, expect, it } from 'vitest';
import { selectRuntimeQuoteForTest } from '../../src/engines/payments/store.js';

const canonicalBaseQuote = {
  accepts: [
    {
      amount: '10000',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      extra: { name: 'USDC', version: '2' },
      network: 'eip155:84532',
      payTo: '0x000000000000000000000000000000000000dEaD',
      scheme: 'exact',
    },
  ],
  resource: {
    category: 'weather',
    url: 'http://localhost:8080/v1/testnet/x402/weather',
  },
} as const;

describe('x402 quote validation', () => {
  it('accepts the canonical testnet USDC asset for the selected exact rail', () => {
    expect(selectRuntimeQuoteForTest(canonicalBaseQuote, 'test', ['exact_base'])).toMatchObject({
      asset: 'USDC',
      rail: 'exact_base',
      x402Network: 'eip155:84532',
    });
  });

  it('rejects an arbitrary token contract on an otherwise valid testnet network', () => {
    const input = {
      ...canonicalBaseQuote,
      accepts: [
        {
          ...canonicalBaseQuote.accepts[0],
          asset: '0x0000000000000000000000000000000000000001',
        },
      ],
    };

    expect(selectRuntimeQuoteForTest(input, 'test', ['exact_base'])).toBeNull();
  });

  it('rejects a mainnet CAIP network while the organization is in test mode', () => {
    const input = {
      ...canonicalBaseQuote,
      accepts: [
        {
          ...canonicalBaseQuote.accepts[0],
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          network: 'eip155:8453',
        },
      ],
    };

    expect(selectRuntimeQuoteForTest(input, 'test', ['exact_base'])).toBeNull();
  });
});
