import { describe, expect, it } from 'vitest';
import {
  CircleAgentCliPaidRequestError,
  circleBlockchainForChain,
  createCircleAgentCliExecutor,
  gatewayBalanceBlockchainForChain,
  type CircleCliInvocation,
  type CircleCliRunner,
} from '../../src/engines/payments/circle-agent-cli.js';

function runnerFrom(outputs: readonly unknown[]): { readonly calls: CircleCliInvocation[]; readonly runner: CircleCliRunner } {
  const calls: CircleCliInvocation[] = [];
  const queue = [...outputs];
  return {
    calls,
    runner: (invocation) => {
      calls.push(invocation);
      const next = queue.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({
        stderr: '',
        stdout: typeof next === 'string' ? next : JSON.stringify(next),
      });
    },
  };
}

describe('Circle Agent Wallet CLI executor', () => {
  it('passes the isolated worker environment to every Circle invocation', async () => {
    const { calls, runner } = runnerFrom([{ data: { mainnet: {}, testnet: {} } }]);
    const executor = createCircleAgentCliExecutor({
      environment: {
        CIRCLE_CLI_HOME: '/run/agentops/org_test/.circle-cli',
        HOME: '/run/agentops/org_test',
      },
      runner,
    });

    await executor.status();

    expect(calls[0]?.environment).toMatchObject({
      CIRCLE_CLI_HOME: '/run/agentops/org_test/.circle-cli',
      HOME: '/run/agentops/org_test',
    });
  });

  it('initializes a testnet email login and extracts the single-use request id', async () => {
    const { calls, runner } = runnerFrom([
      {
        message: 'OTP code sent to owner@example.com\nPlease run: circle wallet login --request 68c34a64-bf7a-4ca5-a2ac-125cab514bc9 --otp <code>',
      },
    ]);
    const executor = createCircleAgentCliExecutor({ runner });

    const challenge = await executor.initializeLogin({ email: 'owner@example.com', mode: 'test' });

    expect(challenge).toEqual({
      email: 'owner@example.com',
      requestId: '68c34a64-bf7a-4ca5-a2ac-125cab514bc9',
    });
    expect(calls[0]?.args).toEqual([
      'wallet',
      'login',
      'owner@example.com',
      '--type',
      'agent',
      '--init',
      '--testnet',
      '--output',
      'json',
    ]);
  });

  it('completes a login without retaining the OTP in the executor result', async () => {
    const { calls, runner } = runnerFrom([{ message: 'Logged in as owner@example.com' }]);
    const executor = createCircleAgentCliExecutor({ runner });

    const session = await executor.completeLogin({
      otp: 'ABC-123456',
      requestId: '68c34a64-bf7a-4ca5-a2ac-125cab514bc9',
    });

    expect(session).toEqual({ email: 'owner@example.com' });
    expect(JSON.stringify(session)).not.toContain('ABC-123456');
    expect(calls[0]?.args).toEqual([
      'wallet',
      'login',
      '--request',
      '68c34a64-bf7a-4ca5-a2ac-125cab514bc9',
      '--otp',
      'ABC-123456',
      '--output',
      'json',
    ]);
  });

  it('maps product chains to Circle agent wallet blockchains', () => {
    expect(circleBlockchainForChain('test', 'base')).toBe('BASE-SEPOLIA');
    expect(circleBlockchainForChain('live', 'base')).toBe('BASE');
    expect(circleBlockchainForChain('test', 'polygon')).toBe('MATIC-AMOY');
    expect(gatewayBalanceBlockchainForChain('test', 'base')).toBe('BASE-SEPOLIA');
  });

  it('lists testnet SCA wallets with the hidden Circle CLI testnet flag', async () => {
    const { calls, runner } = runnerFrom([
      {
        data: {
          address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
          blockchain: 'BASE-SEPOLIA',
          createDate: '2026-07-09T05:42:46Z',
        },
      },
    ]);
    const executor = createCircleAgentCliExecutor({ runner });

    const wallet = await executor.listWallet({ chain: 'base', mode: 'test' });

    expect(wallet).toMatchObject({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      blockchain: 'BASE-SEPOLIA',
    });
    expect(calls[0]).toMatchObject({
      command: 'circle',
      args: ['wallet', 'list', '--chain', 'BASE-SEPOLIA', '--type', 'agent', '--testnet', '--output', 'json'],
    });
  });

  it('submits a Base Sepolia eco Gateway deposit without native-gas direct deposit arguments', async () => {
    const { calls, runner } = runnerFrom([
      {
        data: {
          amount: '0.5',
          backingEOA: '0x7d3f0acb46b1de6f4427d5464ead7b2b108102a0',
          destinationChain: 'MATIC-AMOY',
          ecoDepositAddress: '0x8A235a58d536987C0585B85E848179401196D17c',
          gatewayDomain: 7,
          transferTxHash: '0x6a5f5fbb0d3f1e01afea501e686d845a13904a75eb2deeae61e7ac363d46567f',
        },
      },
    ]);
    const executor = createCircleAgentCliExecutor({ runner });

    const deposit = await executor.gatewayDepositEco({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      amount: '0.5',
      mode: 'test',
      sourceChain: 'base',
    });

    expect(deposit).toMatchObject({
      destinationChain: 'MATIC-AMOY',
      gatewayDomain: 7,
      transferTxHash: '0x6a5f5fbb0d3f1e01afea501e686d845a13904a75eb2deeae61e7ac363d46567f',
    });
    expect(calls[0]?.args).toEqual([
      'gateway',
      'deposit',
      '--amount',
      '0.5',
      '--address',
      '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      '--chain',
      'BASE-SEPOLIA',
      '--method',
      'eco',
      '--timeout',
      '180',
      '--testnet',
      '--output',
      'json',
    ]);
  });

  it('executes Gateway contract calls through the Circle Agent Wallet CLI', async () => {
    const { calls, runner } = runnerFrom([{ data: { id: 'circle_tx_execute' } }]);
    const executor = createCircleAgentCliExecutor({ runner });

    const result = await executor.executeContract({
      abiFunctionSignature: 'deposit(address,uint256)',
      abiParameters: ['0x036CbD53842c5426634e7929541eC2318f3dCF7e', '10000'],
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      chain: 'base',
      contractAddress: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
      idempotencyKey: '47d28ad2-f1e9-4c45-bb66-9c0f1890dc54',
      mode: 'test',
    });

    expect(result.transaction).toBe('circle_tx_execute');
    expect(calls[0]?.args).toEqual([
      'wallet',
      'execute',
      'deposit(address,uint256)',
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      '10000',
      '--contract',
      '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
      '--address',
      '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      '--chain',
      'BASE-SEPOLIA',
      '--idempotency-key',
      '47d28ad2-f1e9-4c45-bb66-9c0f1890dc54',
      '--testnet',
      '--output',
      'json',
    ]);
  });

  it('submits direct Gateway deposits through the Circle Agent Wallet CLI', async () => {
    const { calls, runner } = runnerFrom([
      {
        data: {
          amount: '0.5',
          approvalTransactionHash: '0xapprove',
          backingEOA: '0x7d3f0acb46b1de6f4427d5464ead7b2b108102a0',
          depositTransactionHash: '0xdeposit',
          gatewayDomain: 6,
          gatewayWalletAddress: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
        },
      },
    ]);
    const executor = createCircleAgentCliExecutor({ runner });

    const deposit = await executor.gatewayDepositDirect({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      amount: '0.5',
      mode: 'test',
      sourceChain: 'base',
    });

    expect(deposit).toMatchObject({
      approvalTransactionHash: '0xapprove',
      backingEOA: '0x7d3f0acb46b1de6f4427d5464ead7b2b108102a0',
      depositTransactionHash: '0xdeposit',
      gatewayDomain: 6,
    });
    expect(calls[0]?.timeoutMs).toBeGreaterThanOrEqual(240_000);
    expect(calls[0]?.args).toEqual([
      'gateway',
      'deposit',
      '--amount',
      '0.5',
      '--address',
      '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      '--chain',
      'BASE-SEPOLIA',
      '--method',
      'direct',
      '--timeout',
      '180',
      '--testnet',
      '--output',
      'json',
    ]);
  });

  it('retries transient Circle CLI 429 responses before parsing JSON', async () => {
    const { calls, runner } = runnerFrom([
      new Error('Service returned error 429: rate limited'),
      {
        data: {
          balances: [
            { available: '0.496000', domain: 6, total: '0.496000', withdrawable: '0.496000', withdrawing: '0' },
          ],
        },
      },
    ]);
    const executor = createCircleAgentCliExecutor({ retryDelayMs: 1, runner });

    const balance = await executor.gatewayBalance({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      chain: 'base',
      mode: 'test',
    });

    expect(balance).toMatchObject({ available: '0.496000', domain: 6 });
    expect(calls).toHaveLength(2);
  });

  it('reports an exhausted testnet faucet cooldown without exposing raw CLI output', async () => {
    const { runner } = runnerFrom([
      new Error('Service returned error 429: faucet request is rate limited for this wallet'),
    ]);
    const executor = createCircleAgentCliExecutor({ maxRetries: 0, runner });

    await expect(executor.fundTestnetUsdc({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      chain: 'base',
      mode: 'test',
    })).rejects.toThrow('circle_testnet_faucet_rate_limited');
  });

  it('parses Gateway balances from Circle all-domain balance output', async () => {
    const { calls, runner } = runnerFrom([
      {
        data: {
          balances: [
            { available: '0.5', domain: 6, total: '0.5', withdrawable: '0.5', withdrawing: '0' },
            { available: '0', domain: 7, total: '0', withdrawable: '0', withdrawing: '0' },
          ],
        },
      },
    ]);
    const executor = createCircleAgentCliExecutor({ runner });

    const balance = await executor.gatewayBalance({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      chain: 'base',
      mode: 'test',
    });

    expect(balance).toMatchObject({ available: '0.5', domain: 6, total: '0.5' });
    expect(calls[0]?.args).toEqual([
      'gateway',
      'balance',
      '--address',
      '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      '--chain',
      'BASE-SEPOLIA',
      '--all',
      '--testnet',
      '--output',
      'json',
    ]);
  });

  it('passes the normalized JSON paid request to the Circle CLI in exact argument order', async () => {
    const { calls, runner } = runnerFrom([{
      data: {
        payment: {
          amount: '0.01',
          chain: 'BASE-SEPOLIA',
          receipt: { transactionHash: '0xexact' },
          scheme: 'exact',
          seller: '0xseller',
        },
        response: { paid: true },
        transactionHash: '0xexact',
      },
    }]);
    const executor = createCircleAgentCliExecutor({ runner });

    const payment = await executor.payService({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      attemptId: 'attempt_exact_1',
      chain: 'base',
      maxAmount: '0.01',
      mode: 'test',
      rail: 'exact',
      request: {
        body: { kind: 'json', value: { prompt: 'hello' } },
        headers: [['content-type', 'application/json']],
        method: 'POST',
        url: 'https://x402.example.test/data',
      },
      timeoutSeconds: 30,
    });

    expect(calls[0]?.args).toEqual([
      'services',
      'pay',
      'https://x402.example.test/data',
      '--address',
      '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      '--chain',
      'BASE-SEPOLIA',
      '--max-amount',
      '0.01',
      '--method',
      'POST',
      '--data',
      '{"prompt":"hello"}',
      '--header',
      'content-type: application/json',
      '--timeout',
      '30',
      '--testnet',
      '--output',
      'json',
    ]);
    expect(payment).toMatchObject({
      payment: {
        amount: '0.01',
        chain: 'BASE-SEPOLIA',
        receipt: { transactionHash: '0xexact' },
        scheme: 'exact',
        seller: '0xseller',
      },
      response: { paid: true },
      transaction: '0xexact',
    });
  });

  it('preserves text bodies and repeated header input order', async () => {
    const output = {
      data: {
        payment: {
          amount: '0.01',
          chain: 'BASE-SEPOLIA',
          receipt: { id: 'receipt_gateway' },
          scheme: 'gateway',
          seller: '0xseller',
        },
        response: 'Gateway result',
        transactionHash: '0xgateway',
      },
    };
    const { calls, runner } = runnerFrom([output]);
    const executor = createCircleAgentCliExecutor({ runner });

    const payment = await executor.payService({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      attemptId: 'attempt_gateway_1',
      chain: 'base',
      maxAmount: '0.01',
      mode: 'test',
      rail: 'gateway',
      request: {
        body: { kind: 'text', value: 'hello world' },
        headers: [
          ['x-trace', 'first'],
          ['x-trace', 'second'],
        ],
        method: 'PUT',
        url: 'https://x402.example.test/data',
      },
      timeoutSeconds: 45,
    });

    expect(payment.response).toBe('Gateway result');
    expect(payment.payment).toEqual({
      amount: '0.01',
      chain: 'BASE-SEPOLIA',
      receipt: { id: 'receipt_gateway' },
      scheme: 'gateway',
      seller: '0xseller',
    });
    expect(payment.transaction).toBe('0xgateway');
    expect(payment.raw).toEqual(output);

    expect(calls[0]?.args).toEqual([
      'services',
      'pay',
      'https://x402.example.test/data',
      '--address',
      '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      '--chain',
      'BASE-SEPOLIA',
      '--max-amount',
      '0.01',
      '--method',
      'PUT',
      '--data',
      'hello world',
      '--header',
      'x-trace: first',
      '--header',
      'x-trace: second',
      '--timeout',
      '45',
      '--testnet',
      '--output',
      'json',
    ]);
  });

  it('decodes a valid UTF-8 base64 body for the CLI data argument', async () => {
    const { calls, runner } = runnerFrom([{ data: { response: 'ok' } }]);
    const executor = createCircleAgentCliExecutor({ runner });

    await executor.payService({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      attemptId: 'attempt_base64_1',
      chain: 'base',
      maxAmount: '0.01',
      mode: 'live',
      rail: 'exact',
      request: {
        body: { kind: 'base64', value: Buffer.from('decoded text', 'utf8').toString('base64') },
        headers: [],
        method: 'PATCH',
        url: 'https://x402.example.test/base64',
      },
      timeoutSeconds: 15,
    });

    expect(calls[0]?.args).toContain('decoded text');
  });

  it('omits data and header flags when the paid request has neither', async () => {
    const { calls, runner } = runnerFrom([{ data: { response: 'ok' } }]);
    const executor = createCircleAgentCliExecutor({ runner });

    await executor.payService({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      attemptId: 'attempt_get_1',
      chain: 'base',
      maxAmount: '0.01',
      mode: 'live',
      rail: 'exact',
      request: {
        headers: [],
        method: 'GET',
        url: 'https://x402.example.test/no-body',
      },
      timeoutSeconds: 10,
    });

    expect(calls[0]?.args).toEqual([
      'services',
      'pay',
      'https://x402.example.test/no-body',
      '--address',
      '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      '--chain',
      'BASE',
      '--max-amount',
      '0.01',
      '--method',
      'GET',
      '--timeout',
      '10',
      '--output',
      'json',
    ]);
  });

  it.each([
    ['invalid UTF-8', Buffer.from([0xff]).toString('base64')],
    ['NUL bytes', Buffer.from('before\0after', 'utf8').toString('base64')],
  ])('fails closed on base64 bodies containing %s', async (_label, value) => {
    const { calls, runner } = runnerFrom([{ data: { response: 'must not run' } }]);
    const executor = createCircleAgentCliExecutor({ runner });

    await expect(executor.payService({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      attemptId: 'attempt_binary_1',
      chain: 'base',
      maxAmount: '0.01',
      mode: 'test',
      rail: 'exact',
      request: {
        body: { kind: 'base64', value },
        headers: [],
        method: 'POST',
        url: 'https://x402.example.test/binary',
      },
      timeoutSeconds: 30,
    })).rejects.toThrow('circle_cli_paid_body_binary_unsupported');
    expect(calls).toHaveLength(0);
  });

  it('classifies known spawn failures as pre-submit without retrying or exposing the runner message', async () => {
    const runnerError = Object.assign(new Error('sensitive spawn failure'), {
      code: 'ENOENT',
      killed: false,
      signal: null,
    });
    const { calls, runner } = runnerFrom([runnerError, { data: { response: 'must not retry' } }]);
    const executor = createCircleAgentCliExecutor({ maxRetries: 3, retryDelayMs: 1, runner });

    const failure = await executor.payService({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      attemptId: 'attempt_pre_submit_1',
      chain: 'base',
      maxAmount: '0.01',
      mode: 'test',
      rail: 'exact',
      request: {
        headers: [],
        method: 'POST',
        url: 'https://x402.example.test/pre-submit',
      },
      timeoutSeconds: 30,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CircleAgentCliPaidRequestError);
    expect(failure).toMatchObject({
      attemptId: 'attempt_pre_submit_1',
      classification: 'pre_submit',
      code: 'circle_cli_paid_request_pre_submit',
      processCode: 'ENOENT',
    });
    expect((failure as Error).message).not.toContain('sensitive spawn failure');
    expect(calls).toHaveLength(1);
  });

  it('classifies a started process failure as ambiguous post-submit without retrying', async () => {
    const runnerError = Object.assign(new Error('Service returned error 503 after submission'), {
      code: 1,
      killed: false,
      signal: null,
    });
    const { calls, runner } = runnerFrom([runnerError, { data: { response: 'must not retry' } }]);
    const executor = createCircleAgentCliExecutor({ maxRetries: 3, retryDelayMs: 1, runner });

    const failure = await executor.payService({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      attemptId: 'attempt_ambiguous_1',
      chain: 'base',
      maxAmount: '0.01',
      mode: 'test',
      rail: 'gateway',
      request: {
        headers: [],
        method: 'POST',
        url: 'https://x402.example.test/ambiguous',
      },
      timeoutSeconds: 30,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CircleAgentCliPaidRequestError);
    expect(failure).toMatchObject({
      attemptId: 'attempt_ambiguous_1',
      classification: 'ambiguous_post_submit',
      code: 'circle_cli_paid_request_ambiguous_post_submit',
      processCode: 1,
    });
    expect(calls).toHaveLength(1);
  });

  it('submits a real testnet USDC transfer for exact x402 settlement', async () => {
    const { calls, runner } = runnerFrom([{ data: { id: 'circle_tx_1' } }]);
    const executor = createCircleAgentCliExecutor({ runner });

    const transfer = await executor.transferUsdc({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      amount: '0.01',
      chain: 'base',
      idempotencyKey: '5b2e29ed-775b-44fa-b49c-780a7342406d',
      mode: 'test',
      toAddress: '0x000000000000000000000000000000000000dEaD',
      tokenAddress: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    });

    expect(transfer.transaction).toBe('circle_tx_1');
    expect(calls[0]?.args).toEqual([
      'wallet',
      'transfer',
      '0x000000000000000000000000000000000000dEaD',
      '--amount',
      '0.01',
      '--token',
      '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      '--address',
      '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      '--chain',
      'BASE-SEPOLIA',
      '--idempotency-key',
      '5b2e29ed-775b-44fa-b49c-780a7342406d',
      '--testnet',
      '--output',
      'json',
    ]);
  });

  it('bridges exact-wallet liquidity across testnet chains through Circle CCTP forwarding', async () => {
    const { calls, runner } = runnerFrom([{ data: { burnTxHash: '0xburn', mintTxHash: '0xmint' } }]);
    const executor = createCircleAgentCliExecutor({ runner });

    const bridge = await executor.bridgeUsdc({
      amount: '0.05',
      fromAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      fromChain: 'base',
      idempotencyKey: 'b699675f-5d12-408d-9ba1-6a02ecad2136',
      mode: 'test',
      toAddress: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      toChain: 'arbitrum',
    });

    expect(bridge.transaction).toBe('0xmint');
    expect(calls[0]?.timeoutMs).toBeGreaterThanOrEqual(240_000);
    expect(calls[0]?.args).toEqual([
      'bridge',
      'transfer',
      'ARB-SEPOLIA',
      '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      '--amount',
      '0.05',
      '--address',
      '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      '--chain',
      'BASE-SEPOLIA',
      '--idempotency-key',
      'b699675f-5d12-408d-9ba1-6a02ecad2136',
      '--output',
      'json',
    ]);
  });

  it('parses direct Gateway deposits with a single transaction hash', async () => {
    const { runner } = runnerFrom([{ data: { amount: '0.5', transactionHash: '0xdeposit' } }]);
    const executor = createCircleAgentCliExecutor({ runner });

    const deposit = await executor.gatewayDepositDirect({
      address: '0xf8ea6209f5dd5a8b8ac34bb90990a3f5f32fa839',
      amount: '0.5',
      mode: 'test',
      sourceChain: 'arbitrum',
    });

    expect(deposit).toMatchObject({
      approvalTransactionHash: null,
      depositTransactionHash: '0xdeposit',
    });
  });

  it('fails closed on malformed Circle CLI JSON', async () => {
    const executor = createCircleAgentCliExecutor({ runner: runnerFrom(['not-json']).runner });

    await expect(executor.status()).rejects.toThrow('circle_cli_invalid_json');
  });
});
