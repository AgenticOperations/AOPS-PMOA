export type RuntimeApiClientOptions = {
  readonly apiBaseUrl: string;
  readonly credential: string;
  readonly timeoutMs: number;
};

export type RuntimeCheckInput = {
  readonly intent?: string | undefined;
  readonly action?: string | undefined;
  readonly resource?: Record<string, unknown> | undefined;
  readonly payment?: Record<string, unknown> | undefined;
  readonly tool?: Record<string, unknown> | undefined;
  readonly context?: Record<string, unknown> | undefined;
};

export type RuntimeOperationInput = {
  readonly action: 'runtime.http.request' | 'tool.call';
  readonly resource?: Record<string, unknown> | undefined;
  readonly tool?: Record<string, unknown> | undefined;
  readonly context?: Record<string, unknown> | undefined;
};

export type RuntimePaidHttpBody =
  | { readonly kind: 'json'; readonly value: unknown }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'base64'; readonly value: string };

export type RuntimePaidHttpRequest = {
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly body?: RuntimePaidHttpBody | undefined;
};

export type RuntimeX402PaymentInput = Record<string, unknown> & {
  readonly idempotency_key: string;
  readonly request: RuntimePaidHttpRequest;
};

export type RuntimeX402PaymentTruth = {
  readonly id: string | null;
  readonly attemptId: string;
  readonly status: 'reserved' | 'submitting' | 'settled' | 'failed' | 'unknown';
  readonly providerMode: 'simulation' | 'test' | 'live' | null;
  readonly rail: string | null;
  readonly chain: string | null;
  readonly amount: string | null;
  readonly asset: string | null;
  readonly agentId: string;
  readonly connectionId: string;
  readonly sourceId: string | null;
  readonly reservationId: string | null;
  readonly recipient: string | null;
  readonly network: string | null;
  readonly transaction?: string | undefined;
  readonly payer?: string | undefined;
  readonly errorCode?: string | undefined;
  readonly responseAvailable: boolean;
};

export type RuntimePaidHttpResponse = {
  readonly status: number;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly contentType?: string | undefined;
  readonly bodyEncoding: 'json' | 'text' | 'base64';
  readonly body: unknown;
  readonly sizeBytes: number;
  readonly truncated: false;
};

export type RuntimeX402PaymentResult = Record<string, unknown> & {
  readonly payment: RuntimeX402PaymentTruth;
  readonly response?: RuntimePaidHttpResponse | undefined;
};

export type RuntimeIntraFleetPaymentInput = {
  readonly payee_agent_id: string;
  readonly chain: 'base' | 'arbitrum' | 'polygon' | 'optimism' | 'avalanche' | 'arc';
  readonly url: string;
};

export type RuntimeIntraFleetPaymentResult = Record<string, unknown> & {
  readonly payment: {
    readonly status: number;
    readonly body: unknown;
    readonly txHash: string;
    readonly amountUsdc: string;
  };
};

export class RuntimeApiError extends Error {
  readonly code: string | null;
  readonly details: Record<string, unknown>;
  readonly statusCode: number;

  constructor(statusCode: number, message: string, code: string | null = null, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RuntimeApiError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

type ApiErrorBody = {
  readonly approvalId?: string;
  readonly decisionId?: string;
  readonly error?: string;
  readonly message?: string;
};

type RequestOptions = {
  readonly body?: Record<string, unknown> | RuntimeCheckInput | undefined;
  readonly method: 'GET' | 'POST';
};

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error('AGENTOPS_API_BASE_URL is required.');
  return trimmed.replace(/\/+$/, '');
}

function requireCredential(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error('AgentOps agent credential is required.');
  return trimmed;
}

async function parseErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return {};
  }
}

export class RuntimeApiClient {
  private readonly apiBaseUrl: string;
  private readonly credential: string;
  private readonly timeoutMs: number;

  constructor(options: RuntimeApiClientOptions) {
    this.apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
    this.credential = requireCredential(options.credential);
    this.timeoutMs = options.timeoutMs;
  }

  async onboard(): Promise<Record<string, unknown>> {
    return this.request('/v1/runtime/onboard', { method: 'POST' });
  }

  async check(input: RuntimeCheckInput): Promise<Record<string, unknown>> {
    return this.request('/v1/runtime/check', { body: input, method: 'POST' });
  }

  async approvalStatus(approvalId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/runtime/approvals/${encodeURIComponent(approvalId)}`, { method: 'GET' });
  }

  async approvalConsume(approvalId: string, decisionId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/runtime/approvals/${encodeURIComponent(approvalId)}/consume`, {
      body: { decision_id: decisionId },
      method: 'POST',
    });
  }

  async activityRecord(input: {
    readonly payload?: Record<string, unknown> | undefined;
    readonly summary: string;
  }): Promise<Record<string, unknown>> {
    return this.request('/v1/runtime/activity', {
      body: {
        payload: input.payload ?? {},
        summary: input.summary,
      },
      method: 'POST',
    });
  }

  async operationCheck(input: RuntimeOperationInput): Promise<Record<string, unknown>> {
    return this.request('/v1/runtime/operations/check', { body: input, method: 'POST' });
  }

  async operationRecord(input: RuntimeOperationInput & {
    readonly outcome?: 'success' | 'denied' | 'pending' | 'error' | undefined;
    readonly summary: string;
  }): Promise<Record<string, unknown>> {
    return this.request('/v1/runtime/operations/record', {
      body: {
        action: input.action,
        context: input.context ?? {},
        outcome: input.outcome ?? 'success',
        resource: input.resource ?? {},
        summary: input.summary,
        tool: input.tool ?? {},
      },
      method: 'POST',
    });
  }

  async paymentX402(input: RuntimeX402PaymentInput): Promise<RuntimeX402PaymentResult> {
    return this.request<RuntimeX402PaymentResult>('/v1/runtime/payments/x402', {
      body: input,
      method: 'POST',
    });
  }

  async paymentIntraFleet(input: RuntimeIntraFleetPaymentInput): Promise<RuntimeIntraFleetPaymentResult> {
    return this.request<RuntimeIntraFleetPaymentResult>('/v1/runtime/payments/intra-fleet', {
      body: input,
      method: 'POST',
    });
  }

  async publish(input: { readonly public_endpoint_url: string }): Promise<Record<string, unknown>> {
    return this.request('/v1/runtime/publish', {
      body: { public_endpoint_url: input.public_endpoint_url },
      method: 'POST',
    });
  }

  async identityStatus(): Promise<Record<string, unknown>> {
    return this.request('/v1/runtime/identity', { method: 'GET' });
  }

  async identityRegister(input: {
    readonly endpoint_url: string;
    readonly agent_uri?: string | undefined;
    readonly chain?: 'arc' | undefined;
  }): Promise<Record<string, unknown>> {
    return this.request('/v1/runtime/identity/register', {
      body: {
        endpoint_url: input.endpoint_url,
        ...(input.agent_uri === undefined ? {} : { agent_uri: input.agent_uri }),
        chain: input.chain ?? 'arc',
      },
      method: 'POST',
    });
  }

  private async request<T extends Record<string, unknown>>(path: string, options: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${this.credential}`,
    };
    const init: RequestInit = {
      headers,
      method: options.method,
      signal: controller.signal,
    };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}${path}`, init);
      if (!response.ok) {
        const body = await parseErrorBody(response);
        throw new RuntimeApiError(
          response.status,
          body.message ?? body.error ?? `agentOps API request failed with ${response.status}`,
          body.error ?? null,
          body,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type AgentJoinResult = {
  readonly agent_id: string;
  readonly org_id: string;
  readonly connection_id: string;
  readonly mcp_url: string;
  readonly credential: string;
  readonly payment_access: 'disabled';
  readonly join_mode: 'invite' | 'open';
};

export type AgentJoinClientOptions = {
  readonly apiBaseUrl: string;
  readonly timeoutMs?: number | undefined;
};

/** Unauthenticated client for Phase 1 invite redeem and Phase 3 open register. */
export class AgentJoinClient {
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: AgentJoinClientOptions) {
    this.apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async redeemInvite(input: {
    readonly token: string;
    readonly agent_name?: string | undefined;
  }): Promise<AgentJoinResult> {
    const body = await this.postJson<{ readonly join: AgentJoinResult }>('/v1/agent-join/invite/redeem', {
      token: input.token,
      ...(input.agent_name === undefined ? {} : { agent_name: input.agent_name }),
    });
    return body.join;
  }

  async openRegister(input: { readonly agent_name?: string | undefined } = {}): Promise<AgentJoinResult> {
    const body = await this.postJson<{ readonly join: AgentJoinResult }>('/v1/agent-join/open', {
      ...(input.agent_name === undefined ? {} : { agent_name: input.agent_name }),
    });
    return body.join;
  }

  async openStatus(): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.apiBaseUrl}/v1/agent-join/open/status`, {
        headers: { accept: 'application/json' },
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) {
        const errBody = await parseErrorBody(response);
        throw new RuntimeApiError(
          response.status,
          errBody.message ?? errBody.error ?? `agentOps join status failed with ${response.status}`,
          errBody.error ?? null,
          errBody,
        );
      }
      return (await response.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.apiBaseUrl}${path}`, {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        method: 'POST',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errBody = await parseErrorBody(response);
        throw new RuntimeApiError(
          response.status,
          errBody.message ?? errBody.error ?? `agentOps join request failed with ${response.status}`,
          errBody.error ?? null,
          errBody,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
