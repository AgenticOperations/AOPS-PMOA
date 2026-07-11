import 'server-only';
import { cookies } from 'next/headers';
import { readWebEnv } from '../env';
import type {
  AgentAllowedActionRecord,
  BlockedOperationRecord,
  OperationalAction,
  RateLimitUtilizationRecord,
  ToolCatalogRecord,
  ToolRiskLevel,
} from '../operations-types';

type ApiErrorBody = {
  readonly error?: string;
  readonly message?: string;
};

function apiBaseUrl(): string {
  return readWebEnv().AGENTOPS_API_BASE_URL.replace(/\/$/, '');
}

async function sessionHeaders(): Promise<Record<string, string>> {
  const env = readWebEnv();
  const cookieStore = await cookies();
  const token = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const hasBody = init.body !== undefined && init.body !== null;
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(await sessionHeaders()),
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = {};
    }
    throw new Error(body.message ?? body.error ?? `API request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function listTools(orgId: string): Promise<ToolCatalogRecord[]> {
  const body = await apiFetch<{ readonly tools: ToolCatalogRecord[] }>(`/v1/orgs/${orgId}/tools`);
  return body.tools;
}

export async function importTools(
  orgId: string,
  tools: ReadonlyArray<{
    readonly name: string;
    readonly display_name?: string | undefined;
    readonly category?: string | undefined;
    readonly risk_level?: ToolRiskLevel | undefined;
    readonly description?: string | undefined;
  }>,
): Promise<ToolCatalogRecord[]> {
  const body = await apiFetch<{ readonly tools: ToolCatalogRecord[] }>(`/v1/orgs/${orgId}/tools/import`, {
    method: 'POST',
    body: JSON.stringify({ tools }),
  });
  return body.tools;
}

export async function updateTool(
  orgId: string,
  toolId: string,
  input: {
    readonly display_name?: string | undefined;
    readonly category?: string | undefined;
    readonly risk_level?: ToolRiskLevel | undefined;
    readonly description?: string | undefined;
  },
): Promise<ToolCatalogRecord> {
  const body = await apiFetch<{ readonly tool: ToolCatalogRecord }>(`/v1/orgs/${orgId}/tools/${toolId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.tool;
}

export async function archiveTool(orgId: string, toolId: string): Promise<ToolCatalogRecord> {
  const body = await apiFetch<{ readonly tool: ToolCatalogRecord }>(`/v1/orgs/${orgId}/tools/${toolId}/archive`, {
    method: 'POST',
  });
  return body.tool;
}

export async function listBlockedOperations(
  orgId: string,
  input: { readonly agentId?: string | undefined; readonly limit?: number | undefined } = {},
): Promise<BlockedOperationRecord[]> {
  const query = new URLSearchParams();
  if (input.agentId !== undefined) query.set('agent_id', input.agentId);
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const body = await apiFetch<{ readonly blocked: BlockedOperationRecord[] }>(`/v1/orgs/${orgId}/operations/blocked${suffix}`);
  return body.blocked;
}

export async function createRateLimit(
  orgId: string,
  input: {
    readonly target_type: 'agent';
    readonly target_id: string;
    readonly action: OperationalAction;
    readonly bucket?: string | undefined;
    readonly limit: number;
    readonly window_seconds: number;
  },
): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/operations/rate-limits`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listRateLimits(orgId: string): Promise<RateLimitUtilizationRecord[]> {
  const body = await apiFetch<{ readonly rate_limits: RateLimitUtilizationRecord[] }>(
    `/v1/orgs/${orgId}/operations/rate-limits`,
  );
  return body.rate_limits;
}

export async function updateRateLimit(
  orgId: string,
  rateLimitId: string,
  input: {
    readonly bucket?: string | undefined;
    readonly limit?: number | undefined;
    readonly window_seconds?: number | undefined;
    readonly status?: 'active' | 'disabled' | undefined;
  },
): Promise<RateLimitUtilizationRecord> {
  const body = await apiFetch<{ readonly rate_limit: RateLimitUtilizationRecord }>(
    `/v1/orgs/${orgId}/operations/rate-limits/${rateLimitId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
  return body.rate_limit;
}

export async function disableRateLimit(orgId: string, rateLimitId: string): Promise<RateLimitUtilizationRecord> {
  const body = await apiFetch<{ readonly rate_limit: RateLimitUtilizationRecord }>(
    `/v1/orgs/${orgId}/operations/rate-limits/${rateLimitId}/disable`,
    { method: 'POST' },
  );
  return body.rate_limit;
}

export async function listAgentAllowedActions(
  orgId: string,
  agentId: string,
): Promise<AgentAllowedActionRecord[]> {
  const body = await apiFetch<{
    readonly actions: Array<
      AgentAllowedActionRecord & {
        readonly policyId?: string;
        readonly policyVersion?: number;
        readonly statementId?: string;
        readonly scope?: string;
      }
    >;
  }>(`/v1/orgs/${orgId}/agents/${agentId}/allowed-actions`);
  return body.actions.map((action) => ({
    action: action.action,
    label: action.label,
    decision: action.decision,
    policyName: action.policyName,
  }));
}
