import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { readWebEnv } from '../env';
import type {
  AgentDetailBundle,
  AgentActivityFeed,
  AgentReputationEventRecord,
  AgentRosterItem,
  AgentRosterPage,
  ConnectionRecord,
  CurrentSession,
  MemberRecord,
  OnboardingStateRecord,
  Org,
  Role,
  TeamRecord,
  WalletRefRecord,
} from '../identity-spine-types';

type ApiErrorBody = {
  readonly error?: string;
  readonly message?: string;
};

type CreateConnectionResult = {
  readonly connection: ConnectionRecord;
  readonly secret: string | null;
};

function apiBaseUrl(): string {
  return readWebEnv().AGENTOPS_API_BASE_URL.replace(/\/$/, '');
}

export async function currentSessionToken(): Promise<string | null> {
  const env = readWebEnv();
  const cookieStore = await cookies();
  return cookieStore.get(env.SESSION_COOKIE_NAME)?.value ?? null;
}

async function sessionHeaders(): Promise<Record<string, string>> {
  const token = await currentSessionToken();
  return token === null ? {} : { authorization: `Bearer ${token}` };
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const authHeaders = await sessionHeaders();
  const hasBody = init.body !== undefined && init.body !== null;
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...authHeaders,
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

export async function getCurrentSession(): Promise<CurrentSession | null> {
  const token = await currentSessionToken();
  if (token === null) return null;

  try {
    const body = await apiFetch<CurrentSession>('/v1/auth/me');
    return body;
  } catch (error) {
    if ((error as Error).message.includes('unauthorized')) return null;
    return null;
  }
}

export async function exchangeGoogleCode(input: {
  readonly code: string;
  readonly redirectUri: string;
}): Promise<{
  readonly session_token: string;
  readonly expires_at: string;
  readonly user: CurrentSession['user'];
}> {
  return apiFetch('/v1/auth/google/exchange', {
    method: 'POST',
    body: JSON.stringify({ code: input.code, redirect_uri: input.redirectUri }),
    headers: {},
  });
}

export async function getGoogleAuthorizeUrl(input: {
  readonly redirectUri: string;
  readonly state: string;
}): Promise<string> {
  const query = new URLSearchParams({
    redirect_uri: input.redirectUri,
    state: input.state,
  });
  const body = await apiFetch<{ readonly url: string }>(`/v1/auth/google/authorize-url?${query.toString()}`);
  return body.url;
}

export async function logoutSession(): Promise<void> {
  await apiFetch('/v1/auth/logout', { method: 'POST' });
}

export async function listOrgs(): Promise<Org[]> {
  const body = await apiFetch<{ readonly orgs: Org[] }>('/v1/orgs');
  return body.orgs;
}

export const getOrgBySlug = cache(async (slug: string): Promise<Org> => {
  const body = await apiFetch<{ readonly org: Org }>(`/v1/orgs/by-slug/${slug}`);
  return body.org;
});

export async function createOrg(input: {
  readonly name: string;
  readonly domain?: string | undefined;
  readonly primary_use_case?: string | undefined;
}): Promise<Org> {
  const body = await apiFetch<{ readonly org: Org }>('/v1/orgs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.org;
}

export async function listAgents(orgId: string): Promise<AgentRosterItem[]> {
  const body = await apiFetch<{ readonly agents: AgentRosterItem[] }>(`/v1/orgs/${orgId}/agents`);
  return body.agents;
}

export async function listAgentsPage(
  orgId: string,
  input: {
    readonly search?: string | undefined;
    readonly teamId?: string | undefined;
    readonly status?: AgentRosterItem['status'] | undefined;
    readonly limit: number;
    readonly offset: number;
  },
): Promise<AgentRosterPage> {
  const query = new URLSearchParams({
    limit: String(input.limit),
    offset: String(input.offset),
  });
  if (input.search !== undefined) query.set('search', input.search);
  if (input.teamId !== undefined) query.set('team_id', input.teamId);
  if (input.status !== undefined) query.set('status', input.status);
  return apiFetch<AgentRosterPage>(`/v1/orgs/${orgId}/agents?${query.toString()}`);
}

export async function listTeams(orgId: string): Promise<TeamRecord[]> {
  const body = await apiFetch<{ readonly teams: TeamRecord[] }>(`/v1/orgs/${orgId}/teams`);
  return body.teams;
}

export async function createTeam(
  orgId: string,
  input: { readonly name: string; readonly description?: string | undefined },
): Promise<TeamRecord> {
  const body = await apiFetch<{ readonly team: TeamRecord }>(`/v1/orgs/${orgId}/teams`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.team;
}

export async function updateTeam(
  orgId: string,
  teamId: string,
  input: { readonly name?: string | undefined; readonly description?: string | undefined },
): Promise<TeamRecord> {
  const body = await apiFetch<{ readonly team: TeamRecord }>(`/v1/orgs/${orgId}/teams/${teamId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.team;
}

export async function archiveTeam(orgId: string, teamId: string): Promise<TeamRecord> {
  const body = await apiFetch<{ readonly team: TeamRecord }>(`/v1/orgs/${orgId}/teams/${teamId}/archive`, {
    method: 'POST',
  });
  return body.team;
}

export async function listMembers(orgId: string): Promise<MemberRecord[]> {
  const body = await apiFetch<{ readonly members: MemberRecord[] }>(`/v1/orgs/${orgId}/members`);
  return body.members;
}

export async function addMember(
  orgId: string,
  input: { readonly email: string; readonly name?: string | undefined; readonly role: Role },
): Promise<MemberRecord> {
  const body = await apiFetch<{ readonly member: MemberRecord }>(`/v1/orgs/${orgId}/members`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.member;
}

export async function updateMember(orgId: string, memberId: string, input: { readonly role: Role }): Promise<MemberRecord> {
  const body = await apiFetch<{ readonly member: MemberRecord }>(`/v1/orgs/${orgId}/members/${memberId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.member;
}

export async function removeMember(orgId: string, memberId: string): Promise<MemberRecord> {
  const body = await apiFetch<{ readonly member: MemberRecord }>(`/v1/orgs/${orgId}/members/${memberId}/remove`, {
    method: 'POST',
  });
  return body.member;
}

export async function listOnboardingStates(orgId: string): Promise<OnboardingStateRecord[]> {
  const body = await apiFetch<{ readonly states: OnboardingStateRecord[] }>(`/v1/orgs/${orgId}/onboarding-states`);
  return body.states;
}

export async function upsertOnboardingState(
  orgId: string,
  flowKey: string,
  input: { readonly status: OnboardingStateRecord['status']; readonly payload?: Record<string, unknown> | undefined },
): Promise<OnboardingStateRecord> {
  const body = await apiFetch<{ readonly state: OnboardingStateRecord }>(
    `/v1/orgs/${orgId}/onboarding-states/${encodeURIComponent(flowKey)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ payload: input.payload ?? {}, status: input.status }),
    },
  );
  return body.state;
}

export async function createAgent(
  orgId: string,
  input: {
    readonly name: string;
    readonly team_id?: string | undefined;
    readonly parent_agent_id?: string | null | undefined;
    readonly description?: string | undefined;
    readonly labels?: string[] | undefined;
    readonly default_environment?: string | null | undefined;
    readonly metadata?: Record<string, unknown> | undefined;
  },
): Promise<AgentRosterItem> {
  const body = await apiFetch<{ readonly agent: AgentRosterItem }>(`/v1/orgs/${orgId}/agents`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.agent;
}

export async function getAgentDetail(orgId: string, agentId: string): Promise<AgentDetailBundle> {
  const body = await apiFetch<{
    readonly agent: AgentDetailBundle['agent'];
    readonly connections: ConnectionRecord[];
    readonly wallet_refs: WalletRefRecord[];
    readonly activity: AgentDetailBundle['activity'];
    readonly reputation_history?: readonly AgentReputationEventRecord[];
  }>(`/v1/orgs/${orgId}/agents/${agentId}`);

  return {
    agent: body.agent,
    connections: body.connections,
    walletRefs: body.wallet_refs,
    activity: body.activity,
    reputationHistory: body.reputation_history ?? [],
  };
}

export async function updateAgent(
  orgId: string,
  agentId: string,
  input: {
    readonly name?: string | undefined;
    readonly team_id?: string | undefined;
    readonly parent_agent_id?: string | null | undefined;
    readonly description?: string | undefined;
    readonly labels?: string[] | undefined;
    readonly default_environment?: string | null | undefined;
    readonly metadata?: Record<string, unknown> | undefined;
  },
): Promise<AgentDetailBundle['agent']> {
  const body = await apiFetch<{ readonly agent: AgentDetailBundle['agent'] }>(`/v1/orgs/${orgId}/agents/${agentId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.agent;
}

export async function getAgentActivityFeed(
  orgId: string,
  agentId: string,
  limit = 80,
): Promise<AgentActivityFeed> {
  const query = new URLSearchParams({ limit: String(limit) });
  return apiFetch<AgentActivityFeed>(`/v1/orgs/${orgId}/agents/${agentId}/activity?${query.toString()}`);
}

export async function pauseAgent(orgId: string, agentId: string): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/agents/${agentId}/pause`, { method: 'POST' });
}

export async function activateAgent(orgId: string, agentId: string): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/agents/${agentId}/activate`, { method: 'POST' });
}

export async function deactivateAgent(orgId: string, agentId: string): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/agents/${agentId}/deactivate`, { method: 'POST' });
}

export async function createConnection(
  orgId: string,
  agentId: string,
  input: { readonly kind: string; readonly name: string },
): Promise<CreateConnectionResult> {
  return apiFetch<CreateConnectionResult>(`/v1/orgs/${orgId}/agents/${agentId}/connections`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listConnections(orgId: string, agentId: string): Promise<ConnectionRecord[]> {
  const body = await apiFetch<{ readonly connections: ConnectionRecord[] }>(`/v1/orgs/${orgId}/agents/${agentId}/connections`);
  return body.connections;
}

export async function testConnection(orgId: string, connectionId: string): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/connections/${connectionId}/test`, { method: 'POST' });
}

export async function rotateConnection(orgId: string, connectionId: string): Promise<CreateConnectionResult> {
  return apiFetch<CreateConnectionResult>(`/v1/orgs/${orgId}/connections/${connectionId}/rotate`, {
    method: 'POST',
  });
}

export async function revokeConnection(orgId: string, connectionId: string): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/connections/${connectionId}/revoke`, { method: 'POST' });
}

export async function attachWalletRef(
  orgId: string,
  agentId: string,
  input: {
    readonly provider: string;
    readonly external_wallet_id?: string | null | undefined;
    readonly address?: string | null | undefined;
    readonly chain?: string | null | undefined;
    readonly label?: string | undefined;
  },
): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/agents/${agentId}/wallet-refs`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function detachWalletRef(
  orgId: string,
  agentId: string,
  walletRefId: string,
): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/agents/${agentId}/wallet-refs/${walletRefId}`, {
    method: 'DELETE',
  });
}

export type AgentJoinInviteRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly label: string;
  readonly max_uses: number;
  readonly use_count: number;
  readonly expires_at: string | null;
  readonly revoked_at: string | null;
  readonly created_at: string;
};

export type CreateAgentJoinInviteResult = {
  readonly invite: AgentJoinInviteRecord;
  readonly token: string;
};

export async function listAgentJoinInvites(orgId: string): Promise<readonly AgentJoinInviteRecord[]> {
  const body = await apiFetch<{ readonly invites: readonly AgentJoinInviteRecord[] }>(
    `/v1/orgs/${orgId}/agent-join/invites`,
  );
  return body.invites;
}

export async function createAgentJoinInvite(
  orgId: string,
  input: {
    readonly label?: string | undefined;
    readonly max_uses?: number | undefined;
    readonly expires_in_hours?: number | undefined;
  } = {},
): Promise<CreateAgentJoinInviteResult> {
  return apiFetch<CreateAgentJoinInviteResult>(`/v1/orgs/${orgId}/agent-join/invites`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function revokeAgentJoinInvite(orgId: string, inviteId: string): Promise<AgentJoinInviteRecord> {
  const body = await apiFetch<{ readonly invite: AgentJoinInviteRecord }>(
    `/v1/orgs/${orgId}/agent-join/invites/${inviteId}/revoke`,
    { method: 'POST' },
  );
  return body.invite;
}
