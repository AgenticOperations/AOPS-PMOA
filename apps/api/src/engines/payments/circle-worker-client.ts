import type { CircleConnectionService } from './circle-connection-service.js';
import type {
  CircleCanonicalX402SettlementInput,
  CircleGatewayX402SettlementInput,
  CircleTreasuryProvider,
  ProviderMode,
} from './circle-provider.js';
import { serializePaidHttpDestination } from './x402-http.js';
import { IdentityError } from '../identity/errors.js';

type WorkerClientOptions = {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly token: string;
};

type WorkerProviderOptions = WorkerClientOptions & {
  readonly orgId: string;
};

export type CircleConnectionController = Pick<
  CircleConnectionService,
  'complete' | 'disconnect' | 'initialize' | 'status'
>;

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

function workerUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

async function workerRequest<T>(
  options: WorkerClientOptions,
  path: string,
  body: unknown,
  transportFailureClassification?: 'ambiguous_post_submit',
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(workerUrl(options.baseUrl, path), {
      body: JSON.stringify(jsonSafe(body)),
      headers: {
        authorization: `Bearer ${options.token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch {
    const error = new IdentityError(
      'circle_worker_unavailable',
      503,
      'Circle Agent Wallet worker is unavailable.',
    );
    throw transportFailureClassification === undefined
      ? error
      : Object.assign(error, { classification: transportFailureClassification });
  }
  const payload = await response.json() as { readonly error?: string; readonly message?: string } & T;
  if (!response.ok) {
    const code = payload.error ?? `circle_worker_${response.status}`;
    const publicStatus = response.status === 401 ? 503 : response.status;
    throw new IdentityError(code, publicStatus, payload.message ?? code);
  }
  return payload;
}

export function createCircleWorkerConnectionClient(options: WorkerClientOptions): CircleConnectionController {
  return {
    complete: (input) => workerRequest(options, '/internal/circle/connections/complete', input),
    disconnect: (input) => workerRequest(options, '/internal/circle/connections/disconnect', input),
    initialize: (input) => workerRequest(options, '/internal/circle/connections/init', input),
    status: (input) => workerRequest(options, '/internal/circle/connections/status', input),
  };
}

export function createCircleWorkerTreasuryProvider(options: WorkerProviderOptions): CircleTreasuryProvider {
  const execute = <T>(
    operation: string,
    input: { readonly mode: ProviderMode } & object,
    transportFailureClassification?: 'ambiguous_post_submit',
  ): Promise<T> => {
    if (input.mode !== 'test') return Promise.reject(new Error('circle_worker_testnet_only'));
    return workerRequest<T>(options, '/internal/circle/provider/execute', {
      input,
      operation,
      orgId: options.orgId,
    }, transportFailureClassification);
  };
  const assertOrg = (orgId: string): void => {
    if (orgId !== options.orgId) throw new Error('circle_worker_org_mismatch');
  };
  const serializeSettlementInput = (
    input: CircleGatewayX402SettlementInput,
  ): CircleGatewayX402SettlementInput | (Omit<CircleCanonicalX402SettlementInput, 'destination'> & {
    readonly destination: ReturnType<typeof serializePaidHttpDestination>;
  }) => 'destination' in input
    ? { ...input, destination: serializePaidHttpDestination(input.destination) }
    : input;

  return {
    bridgeWalletTopUp: (input) => execute('bridgeWalletTopUp', input),
    createWallet: (input) => {
      assertOrg(input.orgId);
      return execute('createWallet', input);
    },
    createWalletSet: (input) => {
      assertOrg(input.orgId);
      return execute('createWalletSet', input);
    },
    getGatewayBalance: (input) => execute('getGatewayBalance', input),
    getWalletBalances: (input) => execute('getWalletBalances', input),
    health: (mode) => ({
      configured: mode === 'test',
      missing: mode === 'test' ? [] : ['testnet_only'],
      mode,
      provider: 'circle',
    }),
    initiateGatewayDeposit: (input) => execute('initiateGatewayDeposit', input),
    requestTestnetFunds: (input) => execute('requestTestnetFunds', input),
    settleExactX402: (input) => execute(
      'settleExactX402',
      serializeSettlementInput(input),
      'ambiguous_post_submit',
    ),
    settleGatewayX402: (input) => execute(
      'settleGatewayX402',
      serializeSettlementInput(input),
      'ambiguous_post_submit',
    ),
    transferWallet: (input) => execute('transferWallet', input),
  };
}
