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

export type RuntimeX402PaymentInput = {
  readonly accepts: ReadonlyArray<Record<string, unknown>>;
  readonly context?: Record<string, unknown> | undefined;
  readonly resource?: Record<string, unknown> | undefined;
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
  if (trimmed.length === 0) throw new Error('AGENTOPS_MCP_CREDENTIAL is required.');
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

  async paymentX402(input: RuntimeX402PaymentInput): Promise<Record<string, unknown>> {
    return this.request('/v1/runtime/payments/x402', {
      body: {
        accepts: input.accepts,
        context: input.context ?? {},
        resource: input.resource ?? {},
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
