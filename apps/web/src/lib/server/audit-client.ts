import 'server-only';
import { cookies } from 'next/headers';
import type { AuditEventList } from '../audit-types';
import { readWebEnv } from '../env';

type ApiErrorBody = {
  readonly error?: string;
  readonly message?: string;
};

function apiBaseUrl(): string {
  return readWebEnv().AGENTOPS_API_BASE_URL.replace(/\/$/, '');
}

async function sessionHeaders(orgId: string): Promise<Record<string, string>> {
  const env = readWebEnv();
  const cookieStore = await cookies();
  const token = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;
  return token === undefined ? { 'x-agentops-org-id': orgId } : { authorization: `Bearer ${token}`, 'x-agentops-org-id': orgId };
}

async function apiFetch<T>(orgId: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(await sessionHeaders(orgId)),
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

export async function listAuditEvents(orgId: string, limit = 20): Promise<AuditEventList> {
  const params = new URLSearchParams({ limit: String(limit) });
  return apiFetch<AuditEventList>(orgId, `/v1/evidence/events?${params.toString()}`);
}
