import { describe, expect, it } from 'vitest';
import { selectRuntimeQuoteForTest } from '../../src/engines/payments/store.js';

describe('x402 runtime quote selection', () => {
  it('selects a Gateway offer when the agent is only allowed to use Gateway rails', () => {
    const quote = selectRuntimeQuoteForTest(
      {
        accepts: [
          {
            amount: '1000',
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            network: 'eip155:84532',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
          {
            amount: '1000',
            asset: 'USDC',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:84532',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
      },
      'test',
      ['gateway_base'],
    );

    expect(quote?.rail).toBe('gateway_base');
    expect(quote?.settlementKind).toBe('gateway');
  });

  it('selects a direct exact offer when the agent is only allowed to use exact rails', () => {
    const quote = selectRuntimeQuoteForTest(
      {
        accepts: [
          {
            amount: '1000',
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            network: 'eip155:84532',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
          {
            amount: '1000',
            asset: 'USDC',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:84532',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
      },
      'test',
      ['exact_base'],
    );

    expect(quote?.rail).toBe('exact_base');
    expect(quote?.settlementKind).toBe('direct_exact');
    expect(quote?.x402Requirements.asset).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(quote?.x402Requirements.extra).toMatchObject({
      name: 'USDC',
      version: '2',
    });
  });

  it('normalizes direct exact network aliases to eip155 chain ids', () => {
    const quote = selectRuntimeQuoteForTest(
      {
        accepts: [
          {
            amount: '1000',
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            network: 'base-sepolia',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
      },
      'test',
      ['exact_base'],
    );

    expect(quote?.rail).toBe('exact_base');
    expect(quote?.x402Requirements.network).toBe('eip155:84532');
  });
});
