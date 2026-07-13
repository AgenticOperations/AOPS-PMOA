import { createRequire } from 'node:module';
import { inspect } from 'node:util';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCircleAgentWalletTreasuryProvider,
  createDeveloperControlledCircleTreasuryProvider,
  createCircleTreasuryProvider,
  normalizeTypedDataForCircle,
  takeCircleProviderPaidRequestDebug,
  waitForCircleTransaction,
} from '../../src/engines/payments/circle-provider.js';
import {
  CircleAgentCliPaidRequestError,
  createCircleAgentCliExecutor,
  type CircleAgentCliExecutor,
} from '../../src/engines/payments/circle-agent-cli.js';

const require = createRequire(import.meta.url);
const CircleWalletsSdk = require('@circle-fin/developer-controlled-wallets') as {
  initiateDeveloperControlledWalletsClient: (...args: readonly unknown[]) => unknown;
};

function paymentResponseHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function mockDeveloperSigner(signature = `0x${'11'.repeat(65)}`): void {
  vi.spyOn(CircleWalletsSdk, 'initiateDeveloperControlledWalletsClient')
    .mockReturnValue({
      signTypedData: vi.fn(() => Promise.resolve({ data: { signature } })),
    });
}

function createDeveloperProviderWithExecutor(executeHttpRequest: ReturnType<typeof vi.fn>) {
  return (createDeveloperControlledCircleTreasuryProvider as unknown as (
    options: { executeHttpRequest: typeof executeHttpRequest }
  ) => ReturnType<typeof createDeveloperControlledCircleTreasuryProvider>)({ executeHttpRequest });
}

function canonicalDeveloperInput(rail: 'exact' | 'gateway' = 'exact') {
  const request = {
    body: { kind: 'json' as const, value: { city: 'Mumbai' } },
    headers: [['content-type', 'application/json']] as const,
    method: 'POST' as const,
    url: `https://merchant.example/${rail}`,
  };
  return {
    attemptId: `attempt_dev_${rail}`,
    destination: {
      addresses: ['203.0.113.40'],
      hostname: 'merchant.example',
      resolveHostname: () => Promise.resolve(['203.0.113.40']),
      url: request.url,
    },
    mode: 'test' as const,
    request,
    requirements: {
      amount: '10000',
      asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      extra: rail === 'gateway'
        ? {
            name: 'GatewayWalletBatched',
            version: '1',
            verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
          }
        : { name: 'USDC', version: '2' },
      maxTimeoutSeconds: rail === 'gateway' ? 604900 : 300,
      network: 'eip155:84532',
      payTo: '0x000000000000000000000000000000000000dEaD',
      scheme: 'exact' as const,
    },
    walletAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
    walletId: 'circle_wallet_1',
  };
}

describe('Circle treasury provider configuration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it.each(['test', 'live'] as const)(
  'replays the complete paid request through the Agent Wallet exact service in %s mode', async (mode) => {
    const paidBody = { paid: true, result: 'exact service response' };
    const payService = vi.fn(() => Promise.resolve({
      maintenance: { cleanupPending: false, debugErasureFailed: false },
      payment: {
        amount: '0.01',
        chain: 'Base Sepolia',
        receipt: { transaction: 'circle_tx_1', success: true },
        scheme: 'exact',
        seller: '0x000000000000000000000000000000000000dEaD',
      },
      raw: {},
      response: paidBody,
      transaction: 'circle_tx_1',
    }));
    const executor = {
      fundTestnetUsdc: vi.fn(),
      gatewayBalance: vi.fn(),
      gatewayDepositEco: vi.fn(),
      listWallet: vi.fn(),
      payService,
      status: vi.fn(),
      transferUsdc: vi.fn(),
      walletBalance: vi.fn(),
    } as unknown as CircleAgentCliExecutor;
    const provider = createCircleAgentWalletTreasuryProvider({ executor });
    const request = {
      body: { kind: 'json' as const, value: { city: 'Mumbai' } },
      headers: [
        ['accept', 'application/json'],
        ['x-request-id', 'req_exact_1'],
      ] as const,
      method: 'POST' as const,
      url: 'https://merchant.example/weather',
    };
    const destination = {
      addresses: ['203.0.113.10'],
      hostname: 'merchant.example',
      resolveHostname: () => Promise.resolve(['203.0.113.10']),
      url: 'https://merchant.example/weather',
    };

    const input = {
      attemptId: 'attempt_exact_1',
      destination,
      mode,
      request,
      requirements: {
        amount: '10000',
        asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
        extra: { name: 'USDC', version: '2' },
        maxTimeoutSeconds: 300,
        network: 'eip155:84532',
        payTo: '0x000000000000000000000000000000000000dEaD',
        scheme: 'exact',
      },
      walletAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      walletId: `circle_agent_wallet:${mode}:base:0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839`,
    };
    const result = await (provider.settleExactX402 as (value: typeof input) => Promise<{
      payment: { readonly status: string };
      response?: unknown;
    }>)(input);

    expect(result).toMatchObject({
      payment: {
        network: 'eip155:84532',
        payer: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
        receipt: { transaction: 'circle_tx_1', success: true },
        status: 'settled',
        transaction: 'circle_tx_1',
      },
      response: {
        body: paidBody,
        bodyEncoding: 'json',
        contentType: 'application/json',
        headers: [],
        sizeBytes: Buffer.byteLength(JSON.stringify(paidBody)),
        status: 200,
        truncated: false,
      },
    });
    expect(payService).toHaveBeenCalledWith({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      attemptId: 'attempt_exact_1',
      chain: 'base',
      maxAmount: '0.01',
      mode,
      rail: 'exact',
      request,
      timeoutSeconds: 30,
    });
    expect(executor.transferUsdc).not.toHaveBeenCalled();
  });

  it('submits an exact proof with the original request and treats a successful 422 receipt as settled', async () => {
    vi.stubEnv('CIRCLE_TEST_API_KEY', 'test_api_key');
    vi.stubEnv('CIRCLE_TEST_ENTITY_SECRET', 'test_entity_secret');
    const signTypedData = vi.fn(() => Promise.resolve({
      data: { signature: `0x${'11'.repeat(65)}` },
    }));
    vi.spyOn(CircleWalletsSdk, 'initiateDeveloperControlledWalletsClient')
      .mockReturnValue({ signTypedData });
    const receipt = {
      success: true,
      network: 'eip155:84532',
      payer: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      transaction: '0xsettled',
    };
    const executeHttpRequest = vi.fn(() => Promise.resolve({
      status: 422,
      headers: [
        ['content-type', 'application/json'],
        ['payment-response', paymentResponseHeader(receipt)],
      ] as const,
      contentType: 'application/json',
      bodyEncoding: 'json' as const,
      body: { validation: 'merchant rejected the paid input' },
      sizeBytes: 49,
      truncated: false as const,
    }));
    const fetchMock = vi.fn(() => Promise.reject(new Error('global fetch must not be used')));
    vi.stubGlobal('fetch', fetchMock);
    const provider = (createDeveloperControlledCircleTreasuryProvider as unknown as (
      options: { executeHttpRequest: typeof executeHttpRequest }
    ) => ReturnType<typeof createDeveloperControlledCircleTreasuryProvider>)({ executeHttpRequest });
    const request = {
      body: { kind: 'json' as const, value: { z: 2, a: 1 } },
      headers: [
        ['x-request-id', 'req_dev_exact'],
        ['content-type', 'application/json'],
      ] as const,
      method: 'POST' as const,
      url: 'https://merchant.example/exact',
    };
    const destination = {
      addresses: ['203.0.113.20'],
      hostname: 'merchant.example',
      resolveHostname: () => Promise.resolve(['203.0.113.20']),
      url: request.url,
    };
    const input = {
      attemptId: 'attempt_dev_exact',
      destination,
      mode: 'test' as const,
      request,
      requirements: {
        amount: '10000',
        asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
        extra: { name: 'USDC', version: '2' },
        maxTimeoutSeconds: 300,
        network: 'eip155:84532',
        payTo: '0x000000000000000000000000000000000000dEaD',
        scheme: 'exact' as const,
      },
      walletAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      walletId: 'circle_wallet_1',
    };

    const result = await provider.settleExactX402(input);

    expect(result).toMatchObject({
      payment: {
        network: 'eip155:84532',
        payer: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
        receipt,
        status: 'settled',
        transaction: '0xsettled',
      },
      response: { status: 422, body: { validation: 'merchant rejected the paid input' } },
    });
    expect(executeHttpRequest).toHaveBeenCalledTimes(1);
    const [executedRequest, executedDestination, options] = (
      executeHttpRequest.mock.calls[0] as unknown as [
        {
          readonly body?: Uint8Array | undefined;
          readonly headers: readonly (readonly [string, string])[];
          readonly method: string;
          readonly url: string;
        },
        unknown,
        unknown,
      ]
    );
    expect(executedRequest).toMatchObject({
      headers: [
        ['x-request-id', 'req_dev_exact'],
        ['content-type', 'application/json'],
        ['PAYMENT-SIGNATURE', expect.any(String)],
      ],
      method: 'POST',
      url: request.url,
    });
    expect(Buffer.from(executedRequest?.body ?? []).toString('utf8')).toBe('{"a":1,"z":2}');
    const proofHeader = executedRequest?.headers?.[2]?.[1] as string;
    const proof = JSON.parse(Buffer.from(proofHeader, 'base64').toString('utf8')) as Record<string, unknown>;
    expect(proof).toMatchObject({
      accepted: input.requirements,
      x402Version: 2,
      payload: { signature: `0x${'11'.repeat(65)}` },
    });
    expect(executedDestination).toBe(destination);
    expect(options).toEqual({ timeoutMs: 30_000 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'missing',
      headers: [] as const,
      expectedStatus: 'unknown',
      expectedCode: 'payment_response_missing',
    },
    {
      label: 'malformed',
      headers: [['payment-response', 'not base64']] as const,
      expectedStatus: 'unknown',
      expectedCode: 'payment_response_malformed',
    },
    {
      label: 'explicit failure',
      headers: [[
        'payment-response',
        paymentResponseHeader({
          success: false,
          errorReason: 'merchant_settlement_rejected',
          network: 'eip155:84532',
          payer: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
        }),
      ]] as const,
      expectedStatus: 'failed',
      expectedCode: 'merchant_settlement_rejected',
    },
  ])('classifies a $label exact receipt independently from HTTP delivery', async ({
    headers,
    expectedStatus,
    expectedCode,
  }) => {
    mockDeveloperSigner();
    const executeHttpRequest = vi.fn(() => Promise.resolve({
      status: 200,
      headers,
      contentType: 'application/json',
      bodyEncoding: 'json' as const,
      body: { delivered: true },
      sizeBytes: 18,
      truncated: false as const,
    }));
    const provider = createDeveloperProviderWithExecutor(executeHttpRequest);

    const result = await provider.settleExactX402(canonicalDeveloperInput());

    expect(result.payment).toMatchObject({
      status: expectedStatus,
      errorCode: expectedCode,
    });
    expect(result.response).toMatchObject({ status: 200, body: { delivered: true } });
  });

  it('returns unknown when transport fails after an exact proof is created', async () => {
    mockDeveloperSigner();
    const executeHttpRequest = vi.fn(() => Promise.reject(new Error('socket_closed_after_write')));
    const provider = createDeveloperProviderWithExecutor(executeHttpRequest);

    const result = await provider.settleExactX402(canonicalDeveloperInput());

    expect(result.payment).toMatchObject({
      status: 'unknown',
      errorCode: 'socket_closed_after_write',
    });
    expect(executeHttpRequest).toHaveBeenCalledTimes(1);
  });

  it('returns failed without executing HTTP when exact signing fails before proof submission', async () => {
    mockDeveloperSigner('');
    const executeHttpRequest = vi.fn();
    const provider = createDeveloperProviderWithExecutor(executeHttpRequest);

    const result = await provider.settleExactX402(canonicalDeveloperInput());

    expect(result.payment).toMatchObject({
      status: 'failed',
      errorCode: 'circle_signature_missing',
    });
    expect(executeHttpRequest).not.toHaveBeenCalled();
  });

  it('sends the official Gateway proof to the merchant without importing a facilitator client', async () => {
    mockDeveloperSigner();
    const receipt = {
      success: true,
      network: 'eip155:84532',
      payer: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      transaction: '0xgateway',
    };
    const executeHttpRequest = vi.fn(() => Promise.resolve({
      status: 200,
      headers: [['payment-response', paymentResponseHeader(receipt)]] as const,
      contentType: 'application/json',
      bodyEncoding: 'json' as const,
      body: { paid: true },
      sizeBytes: 13,
      truncated: false as const,
    }));
    const provider = createDeveloperProviderWithExecutor(executeHttpRequest);
    const input = canonicalDeveloperInput('gateway');

    const result = await provider.settleGatewayX402(input);

    expect(result.payment).toMatchObject({ status: 'settled', receipt, transaction: '0xgateway' });
    const [replayedRequest, destination] = (
      executeHttpRequest.mock.calls[0] as unknown as [
        { readonly headers: readonly (readonly [string, string])[]; readonly method: string },
        unknown,
      ]
    );
    expect(replayedRequest).toMatchObject({
      method: 'POST',
      headers: [
        ['content-type', 'application/json'],
        ['PAYMENT-SIGNATURE', expect.any(String)],
      ],
    });
    const encodedProof = replayedRequest?.headers?.[1]?.[1] as string;
    const proof = JSON.parse(Buffer.from(encodedProof, 'base64').toString('utf8')) as Record<string, unknown>;
    expect(proof).toMatchObject({ accepted: input.requirements, x402Version: 2 });
    expect(destination).toBe(input.destination);
    const source = await readFile(
      new URL('../../src/engines/payments/circle-provider.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('BatchFacilitatorClient');
    expect(source).not.toContain('@circle-fin/x402-batching/server');
  });

  it.each([
    ['pre_submit', 'failed', 'circle_cli_paid_request_pre_submit'],
    ['ambiguous_post_submit', 'unknown', 'circle_cli_paid_request_ambiguous_post_submit'],
  ] as const)(
    'maps a typed Agent Wallet %s failure without retrying',
    async (classification, expectedStatus, expectedCode) => {
      const error = new CircleAgentCliPaidRequestError('attempt_typed', classification, {
        code: classification === 'pre_submit' ? 'ENOENT' : 1,
        killed: classification === 'ambiguous_post_submit',
        signal: null,
      });
      const payService = vi.fn(() => Promise.reject(error));
      const executor = {
        fundTestnetUsdc: vi.fn(),
        gatewayBalance: vi.fn(),
        gatewayDepositEco: vi.fn(),
        listWallet: vi.fn(),
        payService,
        status: vi.fn(),
        transferUsdc: vi.fn(),
        walletBalance: vi.fn(),
      } as unknown as CircleAgentCliExecutor;
      const provider = createCircleAgentWalletTreasuryProvider({ executor });
      const input = canonicalDeveloperInput();

      const result = await provider.settleExactX402(input);

      expect(result.payment).toMatchObject({ status: expectedStatus, errorCode: expectedCode });
      expect(payService).toHaveBeenCalledTimes(1);
    },
  );

  it('moves Agent Wallet failure debug into a private one-shot provider channel', async () => {
    const privateDebug = {
      phase: 'proof_submitted',
      merchantDiagnostic: 'private diagnostic body',
    };
    const runner = vi.fn(async (invocation: {
      readonly environment?: NodeJS.ProcessEnv | undefined;
    }) => {
      const isolatedHome = invocation.environment?.CIRCLE_CLI_HOME;
      if (isolatedHome === undefined) throw new Error('missing isolated CLI home');
      await writeFile(
        join(isolatedHome, 'payments', 'payment-attempt_typed.json'),
        JSON.stringify(privateDebug),
      );
      throw Object.assign(new Error('private runner failure'), {
        code: 1,
        killed: true,
        signal: 'SIGTERM',
      });
    });
    const executor = createCircleAgentCliExecutor({ runner });
    const provider = createCircleAgentWalletTreasuryProvider({ executor });
    const input = canonicalDeveloperInput('gateway');

    const result = await provider.settleGatewayX402(input);

    expect(result.payment).toMatchObject({
      status: 'unknown',
      errorCode: 'circle_cli_paid_request_ambiguous_post_submit',
    });
    expect(inspect(result, { depth: 10 })).not.toContain('private diagnostic body');
    expect(Object.keys(result)).not.toContain('debug');
    expect(takeCircleProviderPaidRequestDebug(result)).toEqual(privateDebug);
    expect(takeCircleProviderPaidRequestDebug(result)).toBeUndefined();
    expect(runner).toHaveBeenCalledTimes(1);
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

  it('returns a transaction-less text response after an Agent Wallet Gateway payment succeeds', async () => {
    const response = 'agentOps Gateway x402 QA evidence';
    const payService = vi.fn(() => Promise.resolve({
      maintenance: { cleanupPending: false, debugErasureFailed: false },
      payment: {
        amount: '0.001',
        chain: 'Base Sepolia',
        receipt: { success: true, gateway: 'batched' },
        scheme: 'GatewayWalletBatched',
        seller: '0x000000000000000000000000000000000000dEaD',
      },
      raw: {
        data: {
          payment: {
            amount: '0.001',
            chain: 'Base Sepolia',
            receipt: { success: true, gateway: 'batched' },
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

    const request = {
      headers: [['accept', 'text/plain']] as const,
      method: 'GET' as const,
      url: 'https://x402.testnet.local/weather',
    };
    const result = await provider.settleGatewayX402({
      attemptId: 'attempt_gateway_1',
      destination: {
        addresses: ['203.0.113.30'],
        hostname: 'x402.testnet.local',
        resolveHostname: () => Promise.resolve(['203.0.113.30']),
        url: request.url,
      },
      mode: 'test',
      request,
      requirements: {
        amount: '1000',
        asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
        extra: { name: 'GatewayWalletBatched', version: '1' },
        maxTimeoutSeconds: 604800,
        network: 'eip155:84532',
        payTo: '0x000000000000000000000000000000000000dEaD',
        scheme: 'exact',
      },
      walletAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      walletId: 'circle_agent_wallet:test:base:0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
    });

    expect(result).toMatchObject({
      fulfillment: {
        body: response,
        status: 'delivered',
      },
      payment: {
        network: 'eip155:84532',
        payer: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
        receipt: { success: true, gateway: 'batched' },
        status: 'settled',
      },
      response: {
        body: response,
        bodyEncoding: 'text',
        contentType: 'text/plain; charset=utf-8',
        headers: [],
        sizeBytes: Buffer.byteLength(response),
        status: 200,
        truncated: false,
      },
    });
    expect(result.transaction).toBeUndefined();
    expect(payService).toHaveBeenCalledWith(expect.objectContaining({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      attemptId: 'attempt_gateway_1',
      chain: 'base',
      maxAmount: '0.001',
      mode: 'test',
      rail: 'gateway',
      request,
      timeoutSeconds: 30,
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
