import { describe, expect, it } from 'vitest';
import { selectRuntimeQuoteForTest } from '../../src/engines/payments/store.js';

describe('Arc chain support', () => {
  it('selects a direct exact offer on Arc testnet by its CAIP-2 network id', () => {
    // eip155:5042002 verified live against both Arc's own RPC (eth_chainId)
    // and Circle's x402 facilitator /v1/x402/supported (spike S1,
    // docs/spike-results.md).
    const quote = selectRuntimeQuoteForTest(
      {
        accepts: [
          {
            amount: '1000',
            asset: '0x3600000000000000000000000000000000000000',
            network: 'eip155:5042002',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
      },
      'test',
      ['exact_arc'],
    );

    expect(quote?.rail).toBe('exact_arc');
    expect(quote?.settlementKind).toBe('direct_exact');
    expect(quote?.x402Requirements.network).toBe('eip155:5042002');
    expect(quote?.x402Requirements.asset).toBe('0x3600000000000000000000000000000000000000');
  });

  it('selects a Gateway offer on Arc when the agent is only allowed gateway_arc', () => {
    const quote = selectRuntimeQuoteForTest(
      {
        accepts: [
          {
            amount: '1000',
            asset: 'USDC',
            extra: { name: 'GatewayWalletBatched' },
            network: 'eip155:5042002',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
      },
      'test',
      ['gateway_arc'],
    );

    expect(quote?.rail).toBe('gateway_arc');
    expect(quote?.settlementKind).toBe('gateway');
  });

  it('normalizes the arc-testnet alias to the eip155 chain id', () => {
    const quote = selectRuntimeQuoteForTest(
      {
        accepts: [
          {
            amount: '1000',
            asset: '0x3600000000000000000000000000000000000000',
            network: 'arc-testnet',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
      },
      'test',
      ['exact_arc'],
    );

    expect(quote?.rail).toBe('exact_arc');
    expect(quote?.x402Requirements.network).toBe('eip155:5042002');
  });

  it('rejects an Arc offer in live mode -- Arc mainnet does not exist', () => {
    // Constraint I.1: "Arc is currently available on Testnet only." There
    // is deliberately no live CAIP-2 id for Arc anywhere in the codebase.
    const quote = selectRuntimeQuoteForTest(
      {
        accepts: [
          {
            amount: '1000',
            asset: '0x3600000000000000000000000000000000000000',
            network: 'eip155:5042002',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
      },
      'live',
      ['exact_arc'],
    );

    expect(quote).toBeNull();
  });

  it('does not select an Arc offer for an agent only allowed non-Arc rails', () => {
    const quote = selectRuntimeQuoteForTest(
      {
        accepts: [
          {
            amount: '1000',
            asset: '0x3600000000000000000000000000000000000000',
            network: 'eip155:5042002',
            payTo: '0x1111111111111111111111111111111111111111',
            scheme: 'exact',
          },
        ],
      },
      'test',
      ['exact_base'],
    );

    expect(quote).toBeNull();
  });
});
