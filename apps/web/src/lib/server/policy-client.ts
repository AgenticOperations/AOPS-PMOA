import 'server-only';
import { cookies } from 'next/headers';
import { readWebEnv } from '../env';
import type {
  AgentPolicyLibrary,
  PolicyDraft,
  PolicyActionRecord,
  PolicyDecisionRequest,
  PolicyLibrary,
  PolicyVersion,
  PolicySimulationRecord,
} from '../policy-types';

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

export async function listPolicyLibrary(orgId: string): Promise<PolicyLibrary> {
  return apiFetch<PolicyLibrary>(`/v1/orgs/${orgId}/policies`);
}

export async function listPolicyActions(orgId: string): Promise<PolicyActionRecord[]> {
  const body = await apiFetch<{ readonly actions: PolicyActionRecord[] }>(`/v1/orgs/${orgId}/policy-actions`);
  return body.actions;
}

export async function listPolicySimulations(orgId: string): Promise<PolicySimulationRecord[]> {
  const body = await apiFetch<{ readonly simulations: PolicySimulationRecord[] }>(
    `/v1/orgs/${orgId}/policy-simulations`,
  );
  return body.simulations;
}

export async function simulatePolicyDraft(
  orgId: string,
  draftId: string,
  request: PolicyDecisionRequest,
): Promise<PolicySimulationRecord> {
  const body = await apiFetch<{ readonly simulation: PolicySimulationRecord }>(
    `/v1/orgs/${orgId}/policy-drafts/${draftId}/simulations`,
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
  );
  return body.simulation;
}

export async function updatePolicyDraft(
  orgId: string,
  draftId: string,
  input: {
    readonly name?: string | undefined;
    readonly description?: string | undefined;
    readonly category?: 'management' | 'operational' | 'capability' | undefined;
  },
): Promise<PolicyDraft> {
  const body = await apiFetch<{ readonly draft: PolicyDraft }>(`/v1/orgs/${orgId}/policy-drafts/${draftId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.draft;
}

export async function discardPolicyDraft(orgId: string, draftId: string): Promise<PolicyDraft> {
  const body = await apiFetch<{ readonly draft: PolicyDraft }>(`/v1/orgs/${orgId}/policy-drafts/${draftId}/discard`, {
    method: 'POST',
  });
  return body.draft;
}

export async function listAgentPolicies(orgId: string, agentId: string): Promise<AgentPolicyLibrary> {
  return apiFetch<AgentPolicyLibrary>(`/v1/orgs/${orgId}/agents/${agentId}/policies`);
}

export async function createPolicyDraft(
  orgId: string,
  input: {
    readonly name: string;
    readonly description?: string | undefined;
    readonly action: string;
    readonly decision: string;
    readonly actorRole?: string | undefined;
    readonly resourceCategory?: string | undefined;
    readonly resourceDomain?: string | undefined;
    readonly paymentMinAmount?: string | undefined;
    readonly paymentAsset?: string | undefined;
    readonly toolName?: string | undefined;
  },
): Promise<void> {
  function csvList(value: string | undefined): string[] | undefined {
    if (value === undefined) return undefined;
    const values = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return values.length === 0 ? undefined : values;
  }

  function targetTypesForAction(action: string): string[] {
    return actions.find((candidate) => candidate.action_id === action)?.binding_target_types ?? ['agent'];
  }

  const actions = await listPolicyActions(orgId);

  const resource =
    input.resourceCategory === undefined && input.resourceDomain === undefined
      ? undefined
      : {
          ...(csvList(input.resourceCategory) === undefined ? {} : { categories: csvList(input.resourceCategory) }),
          ...(csvList(input.resourceDomain) === undefined ? {} : { domains: csvList(input.resourceDomain) }),
        };
  const payment =
    input.paymentMinAmount === undefined && input.paymentAsset === undefined
      ? undefined
      : {
          ...(input.paymentMinAmount === undefined ? {} : { minAmount: input.paymentMinAmount }),
          ...(csvList(input.paymentAsset) === undefined ? {} : { assets: csvList(input.paymentAsset) }),
        };
  const tool = csvList(input.toolName) === undefined ? undefined : { names: csvList(input.toolName) };
  const conditions =
    resource === undefined && payment === undefined && tool === undefined
      ? undefined
      : {
          ...(resource === undefined ? {} : { resource }),
          ...(payment === undefined ? {} : { payment }),
          ...(tool === undefined ? {} : { tool }),
        };

  await apiFetch(`/v1/orgs/${orgId}/policy-drafts`, {
    method: 'POST',
    body: JSON.stringify({
      source: 'structured',
      name: input.name,
      description: input.description,
      category: input.action.startsWith('management.') ? 'management' : 'operational',
      statements: [
        {
          id: `stmt_${Date.now().toString(36)}`,
          decision: input.decision,
          actions: [input.action],
          actor: input.actorRole === undefined ? undefined : { roles: [input.actorRole] },
          target: {
            types: targetTypesForAction(input.action),
          },
          conditions,
          audit: 'detailed',
        },
      ],
    }),
  });
}

export async function validatePolicyDraft(orgId: string, draftId: string): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/policy-drafts/${draftId}/validate`, { method: 'POST' });
}

export async function activatePolicyDraft(orgId: string, draftId: string, changeReason: string): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/policy-drafts/${draftId}/activate`, {
    method: 'POST',
    body: JSON.stringify({ change_reason: changeReason }),
  });
}

export async function bindPolicy(
  orgId: string,
  input: {
    readonly policyId: string;
    readonly policyVersion: number;
    readonly targetType: string;
    readonly targetId: string;
  },
): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/policies/${input.policyId}/bindings`, {
    method: 'POST',
    body: JSON.stringify({
      policy_version: input.policyVersion,
      target_type: input.targetType,
      target_id: input.targetId,
    }),
  });
}

export async function removePolicyBinding(orgId: string, policyId: string, bindingId: string): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/policies/${policyId}/bindings/${bindingId}/remove`, { method: 'POST' });
}

export async function archivePolicy(orgId: string, policyId: string, changeReason: string): Promise<PolicyVersion> {
  const body = await apiFetch<{ readonly policy: PolicyVersion }>(`/v1/orgs/${orgId}/policies/${policyId}/archive`, {
    method: 'POST',
    body: JSON.stringify({ change_reason: changeReason }),
  });
  return body.policy;
}

export async function createPolicyVersion(
  orgId: string,
  policyId: string,
  input: {
    readonly name?: string | undefined;
    readonly description?: string | undefined;
    readonly category?: 'management' | 'operational' | 'capability' | undefined;
    readonly change_reason?: string | undefined;
  },
): Promise<PolicyVersion> {
  const body = await apiFetch<{ readonly policy: PolicyVersion }>(`/v1/orgs/${orgId}/policies/${policyId}/versions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.policy;
}
