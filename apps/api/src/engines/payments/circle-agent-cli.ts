import { execFile } from 'node:child_process';
import type { PaymentChain, PaymentMode } from './types.js';
import { normalizePaidHttpRequest, type PaidHttpRequest } from './x402-http.js';

export type CircleCliInvocation = {
  readonly args: readonly string[];
  readonly command: string;
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly timeoutMs: number;
};

export type CircleCliResult = {
  readonly stderr: string;
  readonly stdout: string;
};

export type CircleCliRunner = (invocation: CircleCliInvocation) => Promise<CircleCliResult>;

export type CircleAgentCliExecutorOptions = {
  readonly command?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly maxRetries?: number | undefined;
  readonly retryDelayMs?: number | undefined;
  readonly runner?: CircleCliRunner | undefined;
  readonly timeoutMs?: number | undefined;
};

const DEFAULT_CIRCLE_CLI_TIMEOUT_MS = 240_000;

export type CircleAgentSession = {
  readonly email: string | null;
  readonly expiresIn: string | null;
  readonly tokenStatus: string;
};

export type CircleAgentWallet = {
  readonly address: string;
  readonly blockchain: string;
  readonly createDate: string | null;
};

export type CircleAgentTokenBalance = {
  readonly amount: string;
  readonly blockchain: string | null;
  readonly isNative: boolean;
  readonly symbol: string | null;
  readonly tokenAddress: string | null;
};

export type CircleAgentGatewayBalance = {
  readonly available: string;
  readonly domain: number;
  readonly total: string;
  readonly withdrawable: string;
  readonly withdrawing: string;
};

export type CircleAgentGatewayDeposit = {
  readonly amount: string;
  readonly approvalTransactionHash: string | null;
  readonly backingEOA: string | null;
  readonly depositTransactionHash: string | null;
  readonly destinationChain: string | null;
  readonly ecoDepositAddress: string | null;
  readonly gatewayWalletAddress: string | null;
  readonly gatewayDomain: number | null;
  readonly transferTxHash: string | null;
};

export type CircleAgentServicePayment = {
  readonly payment: {
    readonly amount: string | null;
    readonly chain: string | null;
    readonly receipt: unknown;
    readonly scheme: string | null;
    readonly seller: string | null;
  } | null;
  readonly raw: unknown;
  readonly response?: unknown;
  readonly transaction: string | null;
};

export type CircleAgentCliPaidRequestFailureClassification =
  | 'pre_submit'
  | 'ambiguous_post_submit';

export class CircleAgentCliPaidRequestError extends Error {
  readonly attemptId: string;
  readonly classification: CircleAgentCliPaidRequestFailureClassification;
  readonly code:
    | 'circle_cli_paid_request_pre_submit'
    | 'circle_cli_paid_request_ambiguous_post_submit';
  readonly killed: boolean;
  override readonly name = 'CircleAgentCliPaidRequestError';
  readonly processCode: number | string | null;
  readonly signal: string | null;

  constructor(
    attemptId: string,
    classification: CircleAgentCliPaidRequestFailureClassification,
    metadata: {
      readonly code: number | string | null;
      readonly killed: boolean;
      readonly signal: string | null;
    },
  ) {
    const code = classification === 'pre_submit'
      ? 'circle_cli_paid_request_pre_submit'
      : 'circle_cli_paid_request_ambiguous_post_submit';
    super(code);
    this.attemptId = attemptId;
    this.classification = classification;
    this.code = code;
    this.killed = metadata.killed;
    this.processCode = metadata.code;
    this.signal = metadata.signal;
  }
}

export type CircleAgentTransfer = {
  readonly raw: unknown;
  readonly transaction: string | null;
};

export type CircleAgentBridgeTransfer = {
  readonly raw: unknown;
  readonly transaction: string | null;
};

export type CircleAgentContractExecution = {
  readonly raw: unknown;
  readonly transaction: string | null;
};

export type CircleAgentCliExecutor = {
  readonly bridgeUsdc: (input: {
    readonly amount: string;
    readonly fromAddress: string;
    readonly fromChain: PaymentChain;
    readonly idempotencyKey?: string | undefined;
    readonly mode: PaymentMode;
    readonly toAddress: string;
    readonly toChain: PaymentChain;
  }) => Promise<CircleAgentBridgeTransfer>;
  readonly executeContract: (input: {
    readonly abiFunctionSignature: string;
    readonly abiParameters: readonly string[];
    readonly address: string;
    readonly chain: PaymentChain;
    readonly contractAddress: string;
    readonly idempotencyKey?: string | undefined;
    readonly mode: PaymentMode;
  }) => Promise<CircleAgentContractExecution>;
  readonly fundTestnetUsdc: (input: {
    readonly address: string;
    readonly chain: PaymentChain;
    readonly mode: PaymentMode;
  }) => Promise<unknown>;
  readonly gatewayBalance: (input: {
    readonly address: string;
    readonly chain: PaymentChain;
    readonly mode: PaymentMode;
  }) => Promise<CircleAgentGatewayBalance>;
  readonly gatewayDepositEco: (input: {
    readonly address: string;
    readonly amount: string;
    readonly mode: PaymentMode;
    readonly sourceChain: PaymentChain;
  }) => Promise<CircleAgentGatewayDeposit>;
  readonly gatewayDepositDirect: (input: {
    readonly address: string;
    readonly amount: string;
    readonly mode: PaymentMode;
    readonly sourceChain: PaymentChain;
  }) => Promise<CircleAgentGatewayDeposit>;
  readonly initializeLogin: (input: {
    readonly email: string;
    readonly mode: PaymentMode;
  }) => Promise<{ readonly email: string; readonly requestId: string }>;
  readonly completeLogin: (input: {
    readonly otp: string;
    readonly requestId: string;
  }) => Promise<{ readonly email: string }>;
  readonly listWallet: (input: {
    readonly chain: PaymentChain;
    readonly mode: PaymentMode;
  }) => Promise<CircleAgentWallet>;
  readonly payService: (input:
    | {
        readonly address: string;
        readonly attemptId: string;
        readonly chain: PaymentChain;
        readonly maxAmount: string;
        readonly mode: PaymentMode;
        readonly rail: 'exact' | 'gateway';
        readonly request: PaidHttpRequest;
        readonly timeoutSeconds: number;
      }
    | {
        readonly address: string;
        readonly chain: PaymentChain;
        readonly maxAmount: string;
        readonly mode: PaymentMode;
        readonly rail: 'exact' | 'gateway';
        readonly url: string;
      }
  ) => Promise<CircleAgentServicePayment>;
  readonly status: () => Promise<{
    readonly live: CircleAgentSession;
    readonly test: CircleAgentSession;
  }>;
  readonly transferUsdc: (input: {
    readonly address: string;
    readonly amount: string;
    readonly chain: PaymentChain;
    readonly idempotencyKey?: string | undefined;
    readonly mode: PaymentMode;
    readonly toAddress: string;
    readonly tokenAddress: string;
  }) => Promise<CircleAgentTransfer>;
  readonly walletBalance: (input: {
    readonly address: string;
    readonly chain: PaymentChain;
    readonly mode: PaymentMode;
  }) => Promise<readonly CircleAgentTokenBalance[]>;
};

const CIRCLE_BLOCKCHAINS: Record<PaymentMode, Record<PaymentChain, string>> = {
  live: {
    arbitrum: 'ARB',
    avalanche: 'AVAX',
    base: 'BASE',
    optimism: 'OP',
    polygon: 'MATIC',
  },
  test: {
    arbitrum: 'ARB-SEPOLIA',
    avalanche: 'AVAX-FUJI',
    base: 'BASE-SEPOLIA',
    optimism: 'OP-SEPOLIA',
    polygon: 'MATIC-AMOY',
  },
};

const GATEWAY_BALANCE_DOMAINS: Record<PaymentChain, number> = {
  arbitrum: 3,
  avalanche: 1,
  base: 6,
  optimism: 2,
  polygon: 7,
};

export function circleBlockchainForChain(mode: PaymentMode, chain: PaymentChain): string {
  return CIRCLE_BLOCKCHAINS[mode][chain];
}

export function gatewayBalanceBlockchainForChain(mode: PaymentMode, chain: PaymentChain): string {
  return circleBlockchainForChain(mode, chain);
}

function modeArgs(mode: PaymentMode): readonly string[] {
  return mode === 'test' ? ['--testnet'] : [];
}

function defaultCircleCliTimeoutMs(): number {
  const configured = Number(process.env.CIRCLE_CLI_TIMEOUT_MS ?? '');
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return DEFAULT_CIRCLE_CLI_TIMEOUT_MS;
}

async function defaultRunner(invocation: CircleCliInvocation): Promise<CircleCliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      invocation.command,
      [...invocation.args],
      {
        encoding: 'utf8',
        env: invocation.environment === undefined
          ? process.env
          : { ...process.env, ...invocation.environment },
        maxBuffer: 1024 * 1024,
        timeout: invocation.timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          const processError = error as Error & {
            readonly code?: number | string | null;
            readonly killed?: boolean;
            readonly signal?: NodeJS.Signals | null;
          };
          if (processError.killed === true && processError.signal !== null) {
            reject(Object.assign(
              new Error(`circle_cli_process_timeout:${invocation.timeoutMs}`),
              {
                code: processError.code,
                killed: processError.killed,
                signal: processError.signal,
              },
            ));
            return;
          }
          reject(Object.assign(
            new Error(stderr.trim().length > 0 ? stderr.trim() : error.message),
            {
              code: processError.code,
              killed: processError.killed,
              signal: processError.signal,
            },
          ));
          return;
        }
        resolve({ stderr, stdout });
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientCircleCliError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('error 429') ||
    message.includes('rate limit') ||
    message.includes('too many request') ||
    message.includes('error 500') ||
    message.includes('error 502') ||
    message.includes('error 503') ||
    message.includes('error 504')
  );
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    const suffix = error instanceof Error ? `: ${error.message}` : '';
    throw new Error(`circle_cli_invalid_json${suffix}`);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cliData(value: unknown): unknown {
  const item = record(value);
  return item.data ?? value;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function amountField(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toString();
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return '0';
}

function sessionFrom(value: unknown): CircleAgentSession {
  const item = record(value);
  return {
    email: stringField(item.email),
    expiresIn: stringField(item.expiresIn),
    tokenStatus: stringField(item.tokenStatus) ?? 'UNKNOWN',
  };
}

function walletFrom(value: unknown): CircleAgentWallet {
  const data = cliData(value);
  const item = record(Array.isArray(data) ? data[0] : data);
  const nestedWallets = Array.isArray(item.wallets) ? item.wallets : [];
  const wallet = nestedWallets.length > 0 ? record(nestedWallets[0]) : item;
  const address = stringField(wallet.address);
  const blockchain = stringField(wallet.blockchain);
  if (address === null || blockchain === null) throw new Error('circle_agent_wallet_missing_address_or_blockchain');
  return {
    address,
    blockchain,
    createDate: stringField(wallet.createDate),
  };
}

function tokenBalancesFrom(value: unknown): readonly CircleAgentTokenBalance[] {
  const data = cliData(value);
  const item = record(data);
  const balances = Array.isArray(item.balances) ? item.balances : Array.isArray(data) ? data : [];
  return balances.map((balance) => {
    const row = record(balance);
    const token = record(row.token);
    return {
      amount: amountField(row.amount),
      blockchain: stringField(token.blockchain),
      isNative: token.isNative === true,
      symbol: stringField(token.symbol),
      tokenAddress: stringField(token.tokenAddress),
    };
  });
}

function gatewayBalanceFrom(value: unknown, domain: number): CircleAgentGatewayBalance {
  const data = cliData(value);
  const item = record(data);
  const balances = Array.isArray(item.balances) ? item.balances : Array.isArray(data) ? data : [data];
  const selected = balances.map(record).find((balance) => numberField(balance.domain) === domain) ?? record(balances[0]);
  return {
    available: amountField(selected.available ?? selected.balance),
    domain: numberField(selected.domain) ?? domain,
    total: amountField(selected.total ?? selected.balance),
    withdrawable: amountField(selected.withdrawable),
    withdrawing: amountField(selected.withdrawing),
  };
}

function transactionHashFrom(value: unknown): string | null {
  const direct = stringField(value);
  if (direct !== null) return direct;
  const item = record(value);
  return stringField(
    item.transactionHash ??
    item.txHash ??
    item.hash ??
    item.id ??
    item.transactionId ??
    item.transaction,
  );
}

function gatewayDepositFrom(value: unknown): CircleAgentGatewayDeposit {
  const item = record(cliData(value));
  const transactions = Array.isArray(item.transactions) ? item.transactions.map(record) : [];
  const approvalRecord = transactions.find((transaction) => {
    const kind = stringField(transaction.type ?? transaction.kind ?? transaction.action ?? transaction.name)?.toLowerCase();
    return kind === 'approval' || kind === 'approve' || kind === 'allowance';
  });
  const depositRecord =
    transactions.find((transaction) => {
      const kind = stringField(transaction.type ?? transaction.kind ?? transaction.action ?? transaction.name)?.toLowerCase();
      return kind === 'deposit' || kind === 'gateway_deposit';
    }) ?? (transactions.length === 1 ? transactions[0] : undefined);
  const approvalTx = stringField(
    item.approvalTransactionHash ??
    item.approvalTxHash ??
    item.approvalTransactionId ??
    item.approvalTxId ??
    transactionHashFrom(item.approvalTransaction) ??
    transactionHashFrom(item.approval) ??
    transactionHashFrom(approvalRecord),
  );
  const depositTx = stringField(
    item.depositTransactionHash ??
    item.depositTxHash ??
    item.depositTransactionId ??
    item.depositTxId ??
    item.transactionHash ??
    item.txHash ??
    item.hash ??
    item.transaction ??
    item.transactionId ??
    item.transferTxHash ??
    transactionHashFrom(item.depositTransaction) ??
    transactionHashFrom(item.deposit) ??
    transactionHashFrom(depositRecord),
  );
  if (approvalTx === null && depositTx === null) throw new Error('circle_gateway_deposit_missing_transaction_hash');
  return {
    amount: amountField(item.amount),
    approvalTransactionHash: approvalTx,
    backingEOA: stringField(item.backingEOA),
    depositTransactionHash: depositTx,
    destinationChain: stringField(item.destinationChain),
    ecoDepositAddress: stringField(item.ecoDepositAddress),
    gatewayWalletAddress: stringField(item.gatewayWalletAddress),
    gatewayDomain: numberField(item.gatewayDomain),
    transferTxHash: stringField(item.transferTxHash),
  };
}

function servicePaymentFrom(value: unknown): CircleAgentServicePayment {
  const item = record(cliData(value));
  const payment = record(item.payment);
  const hasPayment = item.payment !== null && typeof item.payment === 'object' && !Array.isArray(item.payment);
  return {
    payment: hasPayment
      ? {
          amount: stringField(payment.amount) ?? (
            typeof payment.amount === 'number' && Number.isFinite(payment.amount)
              ? payment.amount.toString()
              : null
          ),
          chain: stringField(payment.chain),
          receipt: payment.receipt ?? null,
          scheme: stringField(payment.scheme),
          seller: stringField(payment.seller),
        }
      : null,
    raw: value,
    ...('response' in item ? { response: item.response } : {}),
    transaction: stringField(item.transaction ?? item.transactionHash ?? item.txHash),
  };
}

function paidRequestData(body: Uint8Array | undefined): string | undefined {
  if (body === undefined) return undefined;
  const bytes = Buffer.from(body);
  const decoded = bytes.toString('utf8');
  if (decoded.includes('\0') || !Buffer.from(decoded, 'utf8').equals(bytes)) {
    throw new Error('circle_cli_paid_body_binary_unsupported');
  }
  return decoded;
}

function paidRequestErrorMetadata(error: unknown): {
  readonly code: number | string | null;
  readonly killed: boolean;
  readonly signal: string | null;
} {
  if (!(error instanceof Error)) {
    return { code: null, killed: false, signal: null };
  }
  const processError = error as Error & {
    readonly code?: number | string | null;
    readonly killed?: boolean;
    readonly signal?: string | null;
  };
  return {
    code: typeof processError.code === 'number' || typeof processError.code === 'string'
      ? processError.code
      : null,
    killed: processError.killed === true,
    signal: typeof processError.signal === 'string' ? processError.signal : null,
  };
}

const PRE_SUBMIT_PROCESS_CODES = new Set([
  'EACCES',
  'ENOENT',
  'ENOEXEC',
  'ENOTDIR',
  'ERR_INVALID_ARG_TYPE',
  'ERR_INVALID_ARG_VALUE',
]);

function paidRequestErrorFrom(
  error: unknown,
  attemptId: string,
  forcedClassification?: CircleAgentCliPaidRequestFailureClassification,
): CircleAgentCliPaidRequestError {
  const metadata = paidRequestErrorMetadata(error);
  const classification = forcedClassification ?? (
    typeof metadata.code === 'string' && PRE_SUBMIT_PROCESS_CODES.has(metadata.code)
      ? 'pre_submit'
      : 'ambiguous_post_submit'
  );
  return new CircleAgentCliPaidRequestError(attemptId, classification, metadata);
}

function loginChallengeFrom(value: unknown, expectedEmail: string): { readonly email: string; readonly requestId: string } {
  const item = record(cliData(value));
  const message = stringField(item.message) ?? '';
  const requestId = message.match(/--request\s+([0-9a-f-]{36})\b/i)?.[1];
  if (requestId === undefined) throw new Error('circle_agent_wallet_login_request_id_missing');
  return { email: expectedEmail, requestId };
}

function completedLoginFrom(value: unknown): { readonly email: string } {
  const item = record(cliData(value));
  const message = stringField(item.message) ?? '';
  const email = message.match(/Logged in as\s+([^\s]+)/i)?.[1];
  if (email === undefined) throw new Error('circle_agent_wallet_login_email_missing');
  return { email };
}

function transferFrom(value: unknown): CircleAgentTransfer {
  const item = record(cliData(value));
  const transaction = stringField(
    item.transaction ??
    item.transactionHash ??
    item.txHash ??
    item.transactionId ??
    item.id ??
    record(item.transaction).id,
  );
  return {
    raw: value,
    transaction,
  };
}

function bridgeTransferFrom(value: unknown): CircleAgentBridgeTransfer {
  const item = record(cliData(value));
  const transaction = stringField(
    item.mintTxHash ??
    item.mintTransactionHash ??
    item.destinationTransactionHash ??
    item.destinationTxHash ??
    item.transaction ??
    item.transactionHash ??
    item.txHash ??
    item.transactionId ??
    item.id ??
    record(item.transaction).id ??
    item.burnTxHash ??
    item.burnTransactionHash,
  );
  return {
    raw: value,
    transaction,
  };
}

function contractExecutionFrom(value: unknown): CircleAgentContractExecution {
  return transferFrom(value);
}

function assertEcoDepositChain(chain: PaymentChain): void {
  if (chain !== 'base') {
    throw new Error('circle_gateway_eco_deposit_only_supports_base_source');
  }
}

export function createCircleAgentCliExecutor(options: CircleAgentCliExecutorOptions = {}): CircleAgentCliExecutor {
  const command = options.command ?? 'circle';
  const environment = options.environment;
  const maxRetries = options.maxRetries ?? Number(process.env.CIRCLE_CLI_MAX_RETRIES ?? '3');
  const retryDelayMs = options.retryDelayMs ?? Number(process.env.CIRCLE_CLI_RETRY_DELAY_MS ?? '5000');
  const runner = options.runner ?? defaultRunner;
  const timeoutMs = options.timeoutMs ?? defaultCircleCliTimeoutMs();
  const runJson = async (args: readonly string[]): Promise<unknown> => {
    let lastError: unknown;
    const attempts = Math.max(1, Math.floor(maxRetries) + 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await runner({ args, command, environment, timeoutMs });
        return parseJson(result.stdout);
      } catch (error) {
        lastError = error;
        if (!isTransientCircleCliError(error) || attempt >= attempts - 1) throw error;
        const delay = Math.max(0, Math.floor(retryDelayMs)) * (attempt + 1);
        if (delay > 0) await sleep(delay);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('circle_cli_failed');
  };

  return {
    bridgeUsdc: async ({ amount, fromAddress, fromChain, idempotencyKey, mode, toAddress, toChain }) => {
      const value = await runJson([
        'bridge',
        'transfer',
        circleBlockchainForChain(mode, toChain),
        toAddress,
        '--amount',
        amount,
        '--address',
        fromAddress,
        '--chain',
        circleBlockchainForChain(mode, fromChain),
        ...(idempotencyKey === undefined ? [] : ['--idempotency-key', idempotencyKey]),
        '--output',
        'json',
      ]);
      return bridgeTransferFrom(value);
    },
    executeContract: async ({ abiFunctionSignature, abiParameters, address, chain, contractAddress, idempotencyKey, mode }) => {
      const value = await runJson([
        'wallet',
        'execute',
        abiFunctionSignature,
        ...abiParameters,
        '--contract',
        contractAddress,
        '--address',
        address,
        '--chain',
        circleBlockchainForChain(mode, chain),
        ...(idempotencyKey === undefined ? [] : ['--idempotency-key', idempotencyKey]),
        ...modeArgs(mode),
        '--output',
        'json',
      ]);
      return contractExecutionFrom(value);
    },
    fundTestnetUsdc: async ({ address, chain, mode }) => {
      if (mode !== 'test') throw new Error('circle_agent_wallet_faucet_requires_test_mode');
      try {
        return await runJson([
          'wallet',
          'fund',
          '--address',
          address,
          '--chain',
          circleBlockchainForChain(mode, chain),
          '--token',
          'usdc',
          ...modeArgs(mode),
          '--output',
          'json',
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('429') || message.includes('rate limit')) {
          throw new Error('circle_testnet_faucet_rate_limited');
        }
        throw error;
      }
    },
    gatewayBalance: async ({ address, chain, mode }) => {
      const value = await runJson([
        'gateway',
        'balance',
        '--address',
        address,
        '--chain',
        gatewayBalanceBlockchainForChain(mode, chain),
        '--all',
        ...modeArgs(mode),
        '--output',
        'json',
      ]);
      return gatewayBalanceFrom(value, GATEWAY_BALANCE_DOMAINS[chain]);
    },
    gatewayDepositDirect: async ({ address, amount, mode, sourceChain }) => {
      const value = await runJson([
        'gateway',
        'deposit',
        '--amount',
        amount,
        '--address',
        address,
        '--chain',
        circleBlockchainForChain(mode, sourceChain),
        '--method',
        'direct',
        '--timeout',
        '180',
        ...modeArgs(mode),
        '--output',
        'json',
      ]);
      return gatewayDepositFrom(value);
    },
    initializeLogin: async ({ email, mode }) => {
      if (mode !== 'test') throw new Error('circle_agent_wallet_login_requires_test_mode');
      const value = await runJson([
        'wallet',
        'login',
        email,
        '--type',
        'agent',
        '--init',
        '--testnet',
        '--output',
        'json',
      ]);
      return loginChallengeFrom(value, email);
    },
    completeLogin: async ({ otp, requestId }) => {
      const value = await runJson([
        'wallet',
        'login',
        '--request',
        requestId,
        '--otp',
        otp,
        '--output',
        'json',
      ]);
      return completedLoginFrom(value);
    },
    gatewayDepositEco: async ({ address, amount, mode, sourceChain }) => {
      assertEcoDepositChain(sourceChain);
      const value = await runJson([
        'gateway',
        'deposit',
        '--amount',
        amount,
        '--address',
        address,
        '--chain',
        circleBlockchainForChain(mode, sourceChain),
        '--method',
        'eco',
        '--timeout',
        '180',
        ...modeArgs(mode),
        '--output',
        'json',
      ]);
      return gatewayDepositFrom(value);
    },
    listWallet: async ({ chain, mode }) => {
      const value = await runJson([
        'wallet',
        'list',
        '--chain',
        circleBlockchainForChain(mode, chain),
        '--type',
        'agent',
        ...modeArgs(mode),
        '--output',
        'json',
      ]);
      return walletFrom(value);
    },
    payService: async (input) => {
      const paymentChain = circleBlockchainForChain(input.mode, input.chain);
      const isPaidRequest = 'request' in input;
      const attemptId = isPaidRequest ? input.attemptId : 'legacy_circle_cli_paid_request';
      let args: readonly string[];
      try {
        args = isPaidRequest
          ? (() => {
            const normalized = normalizePaidHttpRequest(input.request);
            const data = paidRequestData(normalized.body);
            return [
              'services',
              'pay',
              normalized.url,
              '--address',
              input.address,
              '--chain',
              paymentChain,
              '--max-amount',
              input.maxAmount,
              '--method',
              normalized.method,
              ...(data === undefined ? [] : ['--data', data]),
              ...normalized.headers.flatMap(([name, headerValue]) => [
                '--header',
                `${name}: ${headerValue}`,
              ]),
              '--timeout',
              input.timeoutSeconds.toString(),
              ...modeArgs(input.mode),
              '--output',
              'json',
            ];
          })()
          : [
            'services',
            'pay',
            input.url,
            '--address',
            input.address,
            '--chain',
            paymentChain,
            '--max-amount',
            input.maxAmount,
            '--output',
            'json',
          ];
      } catch (error) {
        throw paidRequestErrorFrom(error, attemptId, 'pre_submit');
      }
      let result: CircleCliResult;
      try {
        result = await runner({ args, command, environment, timeoutMs });
      } catch (error) {
        throw paidRequestErrorFrom(error, attemptId);
      }
      let value: unknown;
      try {
        value = parseJson(result.stdout);
      } catch (error) {
        throw paidRequestErrorFrom(error, attemptId, 'ambiguous_post_submit');
      }
      return servicePaymentFrom(value);
    },
    status: async () => {
      const value = await runJson(['wallet', 'status', '--type', 'agent', '--output', 'json']);
      const item = record(cliData(value));
      return {
        live: sessionFrom(item.mainnet),
        test: sessionFrom(item.testnet),
      };
    },
    transferUsdc: async ({ address, amount, chain, idempotencyKey, mode, toAddress, tokenAddress }) => {
      const value = await runJson([
        'wallet',
        'transfer',
        toAddress,
        '--amount',
        amount,
        '--token',
        tokenAddress,
        '--address',
        address,
        '--chain',
        circleBlockchainForChain(mode, chain),
        ...(idempotencyKey === undefined ? [] : ['--idempotency-key', idempotencyKey]),
        ...modeArgs(mode),
        '--output',
        'json',
      ]);
      return transferFrom(value);
    },
    walletBalance: async ({ address, chain, mode }) => {
      const value = await runJson([
        'wallet',
        'balance',
        '--address',
        address,
        '--chain',
        circleBlockchainForChain(mode, chain),
        ...modeArgs(mode),
        '--output',
        'json',
      ]);
      return tokenBalancesFrom(value);
    },
  };
}
