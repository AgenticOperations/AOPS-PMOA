import 'server-only';
import { cookies } from 'next/headers';
import { readWebEnv } from '../env';
import type { ApprovalList } from '../approval-types';

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
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(await sessionHeaders()),
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

export async function listApprovals(orgId: string): Promise<ApprovalList> {
  return apiFetch<ApprovalList>(`/v1/orgs/${orgId}/approvals`);
}

export async function approveApproval(orgId: string, approvalId: string, reason: string): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/approvals/${approvalId}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: reason }),
  });
}

export async function denyApproval(orgId: string, approvalId: string, reason: string): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/approvals/${approvalId}/deny`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: reason }),
  });
}
