import 'server-only';
import { cookies } from 'next/headers';
import { readWebEnv } from '../env';

export type FleetChecklistItem = {
  readonly id: string;
  readonly label: string;
  readonly tool: string;
  readonly required: boolean;
  readonly status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  readonly goalClause: string;
};

export type FleetResolvedAgent = {
  readonly agentId: string;
  readonly name: string;
  readonly role: string;
  readonly chain: string;
  readonly endpointUrl: string;
};

export type FleetRunEvent = {
  readonly id: string;
  readonly seq: number;
  readonly kind: string;
  readonly tool: string | null;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
};

export type FleetRunRecord = {
  readonly id: string;
  readonly orgId: string;
  readonly goal: string;
  readonly status: 'planned' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly orchestratorAgentId: string | null;
  readonly checklist: readonly FleetChecklistItem[];
  readonly agents: Readonly<Record<string, FleetResolvedAgent>>;
  readonly fruit: Record<string, unknown> | null;
  readonly error: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly events: readonly FleetRunEvent[];
};

export class FleetRunApiError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(status: number, body: { readonly error?: string; readonly message?: string }) {
    super(body.message ?? body.error ?? `Fleet Run API failed (${status})`);
    this.name = 'FleetRunApiError';
    this.code = body.error ?? null;
    this.status = status;
  }
}

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
    let body: { error?: string; message?: string } = {};
    try {
      body = (await response.json()) as { error?: string; message?: string };
    } catch {
      body = {};
    }
    throw new FleetRunApiError(response.status, body);
  }
  return (await response.json()) as T;
}

export async function getCanonicalFleetGoal(orgId: string): Promise<{ goal: string; checklist: readonly FleetChecklistItem[] }> {
  return apiFetch(`/v1/orgs/${encodeURIComponent(orgId)}/fleet-runs/canonical-goal`);
}

export async function listFleetRuns(orgId: string): Promise<readonly FleetRunRecord[]> {
  const body = await apiFetch<{ runs: FleetRunRecord[] }>(`/v1/orgs/${encodeURIComponent(orgId)}/fleet-runs`);
  return body.runs;
}

export async function getFleetRun(orgId: string, runId: string): Promise<FleetRunRecord> {
  const body = await apiFetch<{ run: FleetRunRecord }>(
    `/v1/orgs/${encodeURIComponent(orgId)}/fleet-runs/${encodeURIComponent(runId)}`,
  );
  return body.run;
}

export async function createFleetRun(orgId: string, goal: string): Promise<FleetRunRecord> {
  const body = await apiFetch<{ run: FleetRunRecord }>(`/v1/orgs/${encodeURIComponent(orgId)}/fleet-runs`, {
    method: 'POST',
    body: JSON.stringify({ goal }),
  });
  return body.run;
}

export async function executeFleetRun(orgId: string, runId: string): Promise<FleetRunRecord> {
  const body = await apiFetch<{ run: FleetRunRecord }>(
    `/v1/orgs/${encodeURIComponent(orgId)}/fleet-runs/${encodeURIComponent(runId)}/execute`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return body.run;
}
