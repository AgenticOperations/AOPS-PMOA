import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCircleAgentWalletTreasuryProvider,
  createDeveloperControlledCircleTreasuryProvider,
  createCircleTreasuryProvider,
  normalizeTypedDataForCircle,
  waitForCircleTransaction,
} from '../../src/engines/payments/circle-provider.js';
import type { CircleAgentCliExecutor } from '../../src/engines/payments/circle-agent-cli.js';

describe('Circle treasury provider configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('keeps the default provider on the Circle Agent Wallet path without an entity secret', () => {
    vi.stubEnv('CIRCLE_API_KEY', 'test_api_key');
    vi.stubEnv('CIRCLE_CLIENT_KEY', 'test_client_key');
    vi.stubEnv('CIRCLE_ENTITY_SECRET', '');
    vi.stubEnv('CIRCLE_TEST_ENTITY_SECRET', '');

    const health = createCircleTreasuryProvider().health('test');

    expect(health).toMatchObject({
      configured: true,
      missing: [],
      mode: 'test',
    });
  });

  it('does not treat the Circle client key as a wallet signer secret on the legacy developer-controlled path', () => {
    vi.stubEnv('CIRCLE_API_KEY', 'test_api_key');
    vi.stubEnv('CIRCLE_CLIENT_KEY', 'test_client_key');
    vi.stubEnv('CIRCLE_ENTITY_SECRET', '');
    vi.stubEnv('CIRCLE_TEST_ENTITY_SECRET', '');

    const health = createDeveloperControlledCircleTreasuryProvider().health('test');

    expect(health.configured).toBe(false);
    expect(health.missing).toContain('CIRCLE_TEST_ENTITY_SECRET');
    expect(health.missing).not.toContain('CIRCLE_CLIENT_KEY');
  });

  it('adds the explicit EIP-712 domain type Circle requires without changing payload fields', () => {
    const normalized = normalizeTypedDataForCircle({
      domain: {
        chainId: 84532,
        name: 'GatewayWalletBatched',
        verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
        version: '1',
      },
      message: {
        from: '0x345e92e79d971f726bea347ca004af28e5c83b47',
        nonce: '0x1234',
        to: '0x1111111111111111111111111111111111111111',
        validAfter: '0',
        validBefore: '999999',
        value: 1000n,
      },
      primaryType: 'TransferWithAuthorization',
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
    });

    expect(normalized.types.EIP712Domain).toEqual([
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ]);
    expect(normalized.primaryType).toBe('TransferWithAuthorization');
    expect(normalized.message).toMatchObject({ value: '1000' });
  });

  it('waits for Circle transactions to reach a successful terminal state', async () => {
    const states = ['QUEUED', 'SENT', 'COMPLETE'];
    const client = {
      getTransaction: vi.fn(() => Promise.resolve({
        data: {
          transaction: {
            state: states.shift(),
          },
        },
      })),
    };

    await expect(
      waitForCircleTransaction(client, 'circle_tx_1', 'gateway_deposit', { intervalMs: 1, maxAttempts: 5 }),
    ).resolves.toBe('COMPLETE');
    expect(client.getTransaction).toHaveBeenCalledTimes(3);
  });

  it('fails Circle transaction waits on failed terminal states', async () => {
    const client = {
      getTransaction: vi.fn(() => Promise.resolve({
        data: {
          transaction: {
            state: 'DENIED',
          },
        },
      })),
    };

    await expect(
      waitForCircleTransaction(client, 'circle_tx_2', 'gateway_deposit', { intervalMs: 1, maxAttempts: 2 }),
    ).rejects.toThrow('gateway_deposit_transaction_denied');
  });

  it('times out Circle transaction waits when no terminal state arrives', async () => {
    const client = {
      getTransaction: vi.fn(() => Promise.resolve({
        data: {
          transaction: {
            state: 'QUEUED',
          },
        },
      })),
    };

    await expect(
      waitForCircleTransaction(client, 'circle_tx_3', 'gateway_deposit', { intervalMs: 1, maxAttempts: 2 }),
    ).rejects.toThrow('gateway_deposit_transaction_timeout');
    expect(client.getTransaction).toHaveBeenCalledTimes(2);
  });

  it('settles testnet exact x402 with a Circle Agent Wallet USDC transfer', async () => {
    const transferUsdc = vi.fn(() => Promise.resolve({ raw: {}, transaction: 'circle_tx_1' }));
    const executor = {
      fundTestnetUsdc: vi.fn(),
      gatewayBalance: vi.fn(),
      gatewayDepositEco: vi.fn(),
      listWallet: vi.fn(),
      payService: vi.fn(),
      status: vi.fn(),
      transferUsdc,
      walletBalance: vi.fn(),
    } as unknown as CircleAgentCliExecutor;
    const provider = createCircleAgentWalletTreasuryProvider({ executor });

    const result = await provider.settleExactX402({
      mode: 'test',
      requirements: {
        amount: '10000',
        asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
        extra: { name: 'USDC', version: '2' },
        maxTimeoutSeconds: 300,
        network: 'eip155:84532',
        payTo: '0x000000000000000000000000000000000000dEaD',
        scheme: 'exact',
      },
      resource: {
        description: 'test x402 endpoint',
        mimeType: 'application/json',
        url: 'https://x402.testnet.local/weather',
      },
      walletAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      walletId: 'circle_agent_wallet:test:base:0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
    });

    expect(result).toMatchObject({
      network: 'eip155:84532',
      providerMode: 'test',
      success: true,
      transaction: 'circle_tx_1',
    });
    expect(transferUsdc).toHaveBeenCalledWith(expect.objectContaining({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      amount: '0.01',
      chain: 'base',
      mode: 'test',
      toAddress: '0x000000000000000000000000000000000000dEaD',
      tokenAddress: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    }));
  });

  it('deposits Agent Wallet Gateway funds through the Circle direct Gateway deposit path', async () => {
    const executeContract = vi.fn();
    const gatewayDepositDirect = vi.fn(() => Promise.resolve({
      amount: '0.5',
      approvalTransactionHash: 'circle_tx_approve',
      backingEOA: '0x7d3f0acb46b1de6f4427d5464ead7b2b108102a0',
      depositTransactionHash: 'circle_tx_deposit',
      destinationChain: 'BASE-SEPOLIA',
      ecoDepositAddress: null,
      gatewayDomain: 6,
      gatewayWalletAddress: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
      transferTxHash: null,
    }));
    const executor = {
      executeContract,
      fundTestnetUsdc: vi.fn(),
      gatewayBalance: vi.fn(),
      gatewayDepositDirect,
      gatewayDepositEco: vi.fn(),
      listWallet: vi.fn(),
      payService: vi.fn(),
      status: vi.fn(),
      transferUsdc: vi.fn(),
      walletBalance: vi.fn(),
    } as unknown as CircleAgentCliExecutor;
    const provider = createCircleAgentWalletTreasuryProvider({ executor });

    const result = await provider.initiateGatewayDeposit({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      amountMicros: 500000n,
      chain: 'base',
      mode: 'test',
      walletId: 'circle_agent_wallet:test:base:0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
    });

    expect(result).toMatchObject({
      amount: '0.5',
      amountMicros: '500000',
      approvalTransactionId: 'circle_tx_approve',
      depositTransactionId: 'circle_tx_deposit',
      gatewayDepositorAddress: '0x7d3f0acb46b1de6f4427d5464ead7b2b108102a0',
      gatewayWalletAddress: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
      providerMode: 'test',
      usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    });
    expect(executeContract).not.toHaveBeenCalled();
    expect(gatewayDepositDirect).toHaveBeenCalledWith({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      amount: '0.5',
      mode: 'test',
      sourceChain: 'base',
    });
  });

  it('accepts a direct Gateway deposit without a separate approval transaction', async () => {
    const gatewayDepositDirect = vi.fn(() => Promise.resolve({
      amount: '0.5',
      approvalTransactionHash: null,
      backingEOA: '0x7d3f0acb46b1de6f4427d5464ead7b2b108102a0',
      depositTransactionHash: 'circle_tx_deposit',
      destinationChain: 'ARB-SEPOLIA',
      ecoDepositAddress: null,
      gatewayDomain: 3,
      gatewayWalletAddress: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
      transferTxHash: null,
    }));
    const executor = {
      executeContract: vi.fn(),
      fundTestnetUsdc: vi.fn(),
      gatewayBalance: vi.fn(),
      gatewayDepositDirect,
      gatewayDepositEco: vi.fn(),
      listWallet: vi.fn(),
      payService: vi.fn(),
      status: vi.fn(),
      transferUsdc: vi.fn(),
      walletBalance: vi.fn(),
    } as unknown as CircleAgentCliExecutor;
    const provider = createCircleAgentWalletTreasuryProvider({ executor });

    const result = await provider.initiateGatewayDeposit({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      amountMicros: 500000n,
      chain: 'arbitrum',
      mode: 'test',
      walletId: 'circle_agent_wallet:test:arbitrum:0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
    });

    expect(result).toMatchObject({
      approvalTransactionId: 'circle_tx_deposit',
      depositTransactionId: 'circle_tx_deposit',
      providerMode: 'test',
    });
  });

  it('reads Agent Wallet Gateway balances from the public Gateway API for the persisted depositor', async () => {
    const gatewayBalance = vi.fn();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      balances: [{ balance: '0.750000', domain: 6, withdrawable: '0.750000', withdrawing: '0' }],
      token: 'USDC',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    const executor = {
      executeContract: vi.fn(),
      fundTestnetUsdc: vi.fn(),
      gatewayBalance,
      gatewayDepositDirect: vi.fn(),
      gatewayDepositEco: vi.fn(),
      listWallet: vi.fn(),
      payService: vi.fn(),
      status: vi.fn(),
      transferUsdc: vi.fn(),
      walletBalance: vi.fn(),
    } as unknown as CircleAgentCliExecutor;
    const provider = createCircleAgentWalletTreasuryProvider({ executor });

    const balance = await provider.getGatewayBalance({
      address: '0x7d3f0acb46b1de6f4427d5464ead7b2b108102a0',
      chain: 'base',
      mode: 'test',
    });

    expect(balance).toMatchObject({
      available: '0.750000',
      domain: 6,
      providerMode: 'test',
      total: '0.750000',
    });
    expect(gatewayBalance).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway-api-testnet.circle.com/v1/balances',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('records Circle Agent Wallet service payment failures without throwing', async () => {
    const executor = {
      fundTestnetUsdc: vi.fn(),
      gatewayBalance: vi.fn(),
      gatewayDepositEco: vi.fn(),
      listWallet: vi.fn(),
      payService: vi.fn(() => Promise.reject(new Error('Seller does not accept --chain BASE-SEPOLIA.'))),
      status: vi.fn(),
      transferUsdc: vi.fn(),
      walletBalance: vi.fn(),
    } as unknown as CircleAgentCliExecutor;
    const provider = createCircleAgentWalletTreasuryProvider({ executor });

    const result = await provider.settleGatewayX402({
      mode: 'test',
      requirements: {
        amount: '10000',
        asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
        extra: { name: 'GatewayWalletBatched', version: '1' },
        maxTimeoutSeconds: 300,
        network: 'eip155:84532',
        payTo: '0x000000000000000000000000000000000000dEaD',
        scheme: 'exact',
      },
      resource: {
        description: 'gateway x402 endpoint',
        mimeType: 'application/json',
        url: 'https://x402.testnet.local/weather',
      },
      walletAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      walletId: 'circle_agent_wallet:test:base:0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
    });

    expect(result).toMatchObject({
      errorReason: 'Seller does not accept --chain BASE-SEPOLIA.',
      network: 'eip155:84532',
      providerMode: 'test',
      success: false,
    });
  });

  it('returns the paid resource after a Gateway x402 service payment succeeds', async () => {
    const response = {
      paid: true,
      resource: 'agentOps Gateway x402 QA evidence',
    };
    const payService = vi.fn(() => Promise.resolve({
      raw: {
        data: {
          payment: {
            amount: '0.001',
            chain: 'Base Sepolia',
            receipt: null,
            scheme: 'GatewayWalletBatched',
            seller: '0x000000000000000000000000000000000000dEaD',
          },
          response,
        },
      },
      response,
      transaction: null,
    }));
    const executor = {
      fundTestnetUsdc: vi.fn(),
      gatewayBalance: vi.fn(),
      gatewayDepositDirect: vi.fn(),
      gatewayDepositEco: vi.fn(),
      listWallet: vi.fn(),
      payService,
      status: vi.fn(),
      transferUsdc: vi.fn(),
      walletBalance: vi.fn(),
    } as unknown as CircleAgentCliExecutor;
    const provider = createCircleAgentWalletTreasuryProvider({ executor });

    const result = await provider.settleGatewayX402({
      mode: 'test',
      requirements: {
        amount: '1000',
        asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
        extra: { name: 'GatewayWalletBatched', version: '1' },
        maxTimeoutSeconds: 604800,
        network: 'eip155:84532',
        payTo: '0x000000000000000000000000000000000000dEaD',
        scheme: 'exact',
      },
      resource: {
        description: 'gateway x402 endpoint',
        mimeType: 'application/json',
        url: 'https://x402.testnet.local/weather',
      },
      walletAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      walletId: 'circle_agent_wallet:test:base:0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
    });

    expect(result).toMatchObject({
      fulfillment: {
        body: {
          paid: true,
          resource: 'agentOps Gateway x402 QA evidence',
        },
        status: 'delivered',
      },
      network: 'eip155:84532',
      providerMode: 'test',
      success: true,
    });
    expect(result.transaction).toBeUndefined();
    expect(payService).toHaveBeenCalledWith(expect.objectContaining({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      chain: 'base',
      maxAmount: '0.001',
      mode: 'test',
      rail: 'gateway',
      url: 'https://x402.testnet.local/weather',
    }));
  });

  it('bridges exact-wallet liquidity through the Circle Agent Wallet bridge path', async () => {
    const bridgeUsdc = vi.fn(() => Promise.resolve({ raw: { ok: true }, transaction: '0xmint' }));
    const executor = {
      bridgeUsdc,
      executeContract: vi.fn(),
      fundTestnetUsdc: vi.fn(),
      gatewayBalance: vi.fn(),
      gatewayDepositDirect: vi.fn(),
      gatewayDepositEco: vi.fn(),
      listWallet: vi.fn(),
      payService: vi.fn(),
      status: vi.fn(),
      transferUsdc: vi.fn(),
      walletBalance: vi.fn(),
    } as unknown as CircleAgentCliExecutor;
    const provider = createCircleAgentWalletTreasuryProvider({ executor });

    const result = await provider.bridgeWalletTopUp({
      amount: '0.05',
      fromAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      fromChain: 'base',
      mode: 'test',
      toAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      toChain: 'arbitrum',
    });

    expect(result).toMatchObject({
      amount: '0.05',
      fromChain: 'base',
      providerMode: 'test',
      success: true,
      toChain: 'arbitrum',
      transaction: '0xmint',
    });
    expect(bridgeUsdc).toHaveBeenCalledWith(expect.objectContaining({
      amount: '0.05',
      fromChain: 'base',
      mode: 'test',
      toChain: 'arbitrum',
    }));
  });
});
