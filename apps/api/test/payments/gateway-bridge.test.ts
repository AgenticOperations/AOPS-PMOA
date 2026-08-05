import { describe, expect, it, vi } from 'vitest';
import {
  bridgeWalletTopUp,
  TESTNET_GATEWAY_MINTER,
  TESTNET_GATEWAY_WALLET,
  type GatewayBridgeDeps,
} from '../../src/engines/payments/gateway-bridge.js';

type MockGatewayBridgeDeps = {
  readonly gatewayBalance: ReturnType<typeof vi.fn<GatewayBridgeDeps['gatewayBalance']>>;
  readonly signTypedData: ReturnType<typeof vi.fn<GatewayBridgeDeps['signTypedData']>>;
  readonly postTransfer: ReturnType<typeof vi.fn<GatewayBridgeDeps['postTransfer']>>;
  readonly contractExecution: ReturnType<typeof vi.fn<GatewayBridgeDeps['contractExecution']>>;
};

function baseDeps(overrides: Partial<MockGatewayBridgeDeps> = {}): MockGatewayBridgeDeps {
  return {
    gatewayBalance: vi.fn<GatewayBridgeDeps['gatewayBalance']>(() => Promise.resolve(10_000_000n)), // $10.00 available
    signTypedData: vi.fn<GatewayBridgeDeps['signTypedData']>(() => Promise.resolve('0xsig')),
    postTransfer: vi.fn<GatewayBridgeDeps['postTransfer']>(() => Promise.resolve({ attestation: '0xa', signature: '0xs' })),
    contractExecution: vi.fn<GatewayBridgeDeps['contractExecution']>(() => Promise.resolve({ txHash: '0xmint' })),
    ...overrides,
  };
}

const INPUT = {
  amount: '5.00',
  fromAddress: '0xecf29492264424ae73fc1434a30a66d2f6a9b48f',
  fromChain: 'arc',
  toAddress: '0x216c05b8d3409d2fd2b82375334d4b87e789367e',
  toChain: 'base',
  mode: 'test',
} as const;

function firstCallArgs<T extends readonly unknown[]>(mock: { readonly mock: { readonly calls: readonly T[] } }): T {
  const call = mock.mock.calls[0];
  if (call === undefined) throw new Error('expected mock to have been called');
  return call;
}

describe('just-in-time Gateway bridge', () => {
  it('burns on the source chain, attests, and mints on the destination', async () => {
    const calls: string[] = [];
    const deps = baseDeps({
      signTypedData: vi.fn<GatewayBridgeDeps['signTypedData']>(() => {
        calls.push('signTypedData');
        return Promise.resolve('0xsig');
      }),
      postTransfer: vi.fn<GatewayBridgeDeps['postTransfer']>(() => {
        calls.push('transfer');
        return Promise.resolve({ attestation: '0xa', signature: '0xs' });
      }),
      contractExecution: vi.fn<GatewayBridgeDeps['contractExecution']>(() => {
        calls.push('gatewayMint');
        return Promise.resolve({ txHash: '0xmint' });
      }),
    });

    const result = await bridgeWalletTopUp(INPUT, deps);

    expect(calls).toEqual(['signTypedData', 'transfer', 'gatewayMint']);
    expect(result.success).toBe(true);
    expect(result.transaction).toBe('0xmint');
  });

  it('signs a burn intent with the real Gateway protocol shape (domain, spec, addresses)', async () => {
    const deps = baseDeps();

    await bridgeWalletTopUp({ ...INPUT, amount: '1.50' }, deps);

    expect(deps.signTypedData).toHaveBeenCalledTimes(1);
    const [typedData] = firstCallArgs(deps.signTypedData);
    expect(typedData.domain).toEqual({ name: 'GatewayWallet', version: '1' });
    expect(typedData.primaryType).toBe('BurnIntent');
    expect(typedData.message.spec.sourceDomain).toBe(26); // Arc
    expect(typedData.message.spec.destinationDomain).toBe(6); // Base Sepolia
    expect(typedData.message.spec.sourceContract.toLowerCase())
      .toBe(`0x${'0'.repeat(24)}${TESTNET_GATEWAY_WALLET.slice(2).toLowerCase()}`);
    expect(typedData.message.spec.destinationContract.toLowerCase())
      .toBe(`0x${'0'.repeat(24)}${TESTNET_GATEWAY_MINTER.slice(2).toLowerCase()}`);
    expect(typedData.message.spec.value).toBe('1500000');
    expect(typedData.message.spec.destinationCaller).toBe(`0x${'0'.repeat(64)}`);

    const [postCall] = firstCallArgs(deps.postTransfer);
    expect(postCall.signature).toBe('0xsig');
    expect(postCall.burnIntent.spec.value).toBe('1500000');

    const [mintCall] = firstCallArgs(deps.contractExecution);
    expect(mintCall.attestation).toBe('0xa');
    expect(mintCall.operatorSignature).toBe('0xs');
    expect(mintCall.toChain).toBe('base');
  });

  it('fails clearly when the wallet was never deposited into Gateway, without attempting a burn', async () => {
    const deps = baseDeps({ gatewayBalance: vi.fn<GatewayBridgeDeps['gatewayBalance']>(() => Promise.resolve(0n)) });

    const result = await bridgeWalletTopUp(INPUT, deps);

    expect(result).toMatchObject({ success: false, errorReason: 'gateway_wallet_not_deposited' });
    expect(deps.signTypedData).not.toHaveBeenCalled();
    expect(deps.postTransfer).not.toHaveBeenCalled();
    expect(deps.contractExecution).not.toHaveBeenCalled();
  });

  it('fails clearly when the deposited Gateway balance is less than the requested amount', async () => {
    const deps = baseDeps({
      gatewayBalance: vi.fn<GatewayBridgeDeps['gatewayBalance']>(() => Promise.resolve(1_000_000n)), // $1.00 available
    });

    const result = await bridgeWalletTopUp(INPUT, deps); // requests $5.00

    expect(result).toMatchObject({ success: false, errorReason: 'gateway_wallet_not_deposited' });
  });

  it('no longer returns the not-supported stub', async () => {
    const deps = baseDeps();
    const result = await bridgeWalletTopUp(INPUT, deps);
    expect(result.errorReason).not.toBe('developer_controlled_bridge_topup_not_supported');
  });

  it('surfaces a signing failure as a clean error result rather than throwing', async () => {
    const deps = baseDeps({
      signTypedData: vi.fn<GatewayBridgeDeps['signTypedData']>(() => Promise.reject(new Error('circle_signature_missing'))),
    });

    const result = await bridgeWalletTopUp(INPUT, deps);

    expect(result).toMatchObject({ success: false, errorReason: 'circle_signature_missing' });
  });

  it('refuses live mode until the mainnet Gateway Minter address is independently verified', async () => {
    const deps = baseDeps();
    const result = await bridgeWalletTopUp(
      { ...INPUT, fromChain: 'base', toChain: 'polygon', mode: 'live' },
      deps,
    );
    expect(result).toMatchObject({ success: false, errorReason: 'gateway_bridge_live_mode_not_verified' });
    expect(deps.gatewayBalance).not.toHaveBeenCalled();
  });
});
