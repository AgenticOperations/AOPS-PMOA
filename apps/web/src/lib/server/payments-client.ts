import 'server-only';
import { cookies } from 'next/headers';
import { readWebEnv } from '../env';
import type {
  AgentPaymentSummary,
  CircleChainBalanceRecord,
  CircleChainCapabilityRecord,
  CircleChainWalletRecord,
  CircleProviderJobRecord,
  CircleProviderHealth,
  CircleWalletSetRecord,
  OrgPaymentModeRecord,
  PaymentChain,
  PaymentEventRecord,
  PaymentMode,
  PaymentRail,
  PaymentRailReadinessRecord,
  PaymentReservationRecord,
  PaymentRouteObservationRecord,
  PaymentSourceRecord,
  RebalanceRecommendationRecord,
  TreasuryOverviewRecord,
  TreasuryRecord,
} from '../payments-types';

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

export async function listTreasuries(orgId: string): Promise<TreasuryRecord[]> {
  const body = await apiFetch<{ readonly treasuries: TreasuryRecord[] }>(`/v1/orgs/${orgId}/payments/treasury`);
  return body.treasuries;
}

export async function createTreasury(
  orgId: string,
  input: { readonly chain: PaymentChain; readonly label: string; readonly treasury_type: 'gateway' },
): Promise<TreasuryRecord> {
  const body = await apiFetch<{ readonly treasury: TreasuryRecord }>(`/v1/orgs/${orgId}/payments/treasury`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.treasury;
}

export async function listPaymentSources(orgId: string): Promise<PaymentSourceRecord[]> {
  const body = await apiFetch<{ readonly sources: PaymentSourceRecord[] }>(`/v1/orgs/${orgId}/payments/sources`);
  return body.sources;
}

export async function listPaymentEvents(orgId: string, limit = 50): Promise<PaymentEventRecord[]> {
  const body = await apiFetch<{ readonly events: PaymentEventRecord[] }>(
    `/v1/orgs/${orgId}/payments/events?limit=${encodeURIComponent(String(limit))}`,
  );
  return body.events;
}

export async function listPaymentRouteObservations(orgId: string, limit = 50): Promise<PaymentRouteObservationRecord[]> {
  const body = await apiFetch<{ readonly observations: PaymentRouteObservationRecord[] }>(
    `/v1/orgs/${orgId}/payments/route-observations?limit=${encodeURIComponent(String(limit))}`,
  );
  return body.observations;
}

export async function listPaymentReservations(orgId: string, limit = 50): Promise<PaymentReservationRecord[]> {
  const body = await apiFetch<{ readonly reservations: PaymentReservationRecord[] }>(
    `/v1/orgs/${orgId}/payments/reservations?limit=${encodeURIComponent(String(limit))}`,
  );
  return body.reservations;
}

export async function createPaymentSource(
  orgId: string,
  input: {
    readonly chain: PaymentChain;
    readonly label: string;
    readonly provider: 'circle_gateway' | 'circle_wallets' | 'manual' | 'simulation';
    readonly rail: PaymentRail;
    readonly source_type: 'gateway' | 'direct_exact' | 'dedicated_wallet';
    readonly account_type?: 'eoa' | 'sca' | 'virtual' | 'unknown' | undefined;
    readonly address?: string | null | undefined;
    readonly external_wallet_id?: string | null | undefined;
    readonly metadata?: Record<string, unknown> | undefined;
    readonly simulated_balance_usdc?: string | undefined;
    readonly treasury_id?: string | null | undefined;
  },
): Promise<PaymentSourceRecord> {
  const body = await apiFetch<{ readonly source: PaymentSourceRecord }>(`/v1/orgs/${orgId}/payments/sources`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.source;
}

export async function getAgentPayments(orgId: string, agentId: string): Promise<AgentPaymentSummary> {
  return apiFetch<AgentPaymentSummary>(`/v1/orgs/${orgId}/agents/${agentId}/payments`);
}

export async function getProviderMode(orgId: string): Promise<OrgPaymentModeRecord> {
  const body = await apiFetch<{ readonly mode: OrgPaymentModeRecord }>(`/v1/orgs/${orgId}/payments/provider-mode`);
  return body.mode;
}

export async function setProviderMode(orgId: string, input: { readonly mode: PaymentMode }): Promise<OrgPaymentModeRecord> {
  const body = await apiFetch<{ readonly mode: OrgPaymentModeRecord }>(`/v1/orgs/${orgId}/payments/provider-mode`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return body.mode;
}

export async function getProviderHealth(orgId: string): Promise<CircleProviderHealth> {
  const body = await apiFetch<{ readonly health: CircleProviderHealth }>(`/v1/orgs/${orgId}/payments/provider-health`);
  return body.health;
}

export async function listPaymentCapabilities(orgId: string): Promise<CircleChainCapabilityRecord[]> {
  const body = await apiFetch<{ readonly capabilities: CircleChainCapabilityRecord[] }>(
    `/v1/orgs/${orgId}/payments/capabilities`,
  );
  return body.capabilities;
}

export async function listPaymentRailReadiness(orgId: string): Promise<PaymentRailReadinessRecord[]> {
  const body = await apiFetch<{ readonly rails: PaymentRailReadinessRecord[] }>(
    `/v1/orgs/${orgId}/payments/rail-readiness`,
  );
  return body.rails;
}

export async function verifyPaymentRail(orgId: string, rail: PaymentRail): Promise<CircleProviderJobRecord> {
  const response = await fetch(`${apiBaseUrl()}/v1/orgs/${orgId}/payments/rail-readiness/${encodeURIComponent(rail)}/verify`, {
    cache: 'no-store',
    headers: {
      ...(await sessionHeaders()),
      'content-type': 'application/json',
    },
    method: 'POST',
    body: JSON.stringify({}),
  });
  const body = (await response.json()) as { readonly error?: string; readonly job?: CircleProviderJobRecord; readonly message?: string };
  if (!response.ok && body.job === undefined) {
    throw new Error(body.message ?? body.error ?? `API request failed with ${response.status}`);
  }
  if (body.job === undefined) throw new Error('Rail verification response did not include a provider job.');
  return body.job;
}

export async function verifyPaymentRails(
  orgId: string,
  input: { readonly only_unverified?: boolean | undefined; readonly rails?: readonly PaymentRail[] | undefined } = {},
): Promise<CircleProviderJobRecord[]> {
  const body = await apiFetch<{ readonly failed: number; readonly jobs: CircleProviderJobRecord[] }>(
    `/v1/orgs/${orgId}/payments/rail-readiness/verify`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return body.jobs;
}

export async function createCircleTreasury(
  orgId: string,
  input: { readonly label: string },
): Promise<{ readonly walletSet: CircleWalletSetRecord; readonly wallets: CircleChainWalletRecord[] }> {
  return apiFetch<{ readonly walletSet: CircleWalletSetRecord; readonly wallets: CircleChainWalletRecord[] }>(
    `/v1/orgs/${orgId}/payments/circle/treasury`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function listCircleWallets(orgId: string): Promise<CircleChainWalletRecord[]> {
  const body = await apiFetch<{ readonly wallets: CircleChainWalletRecord[] }>(`/v1/orgs/${orgId}/payments/circle/wallets`);
  return body.wallets;
}

export async function listCircleBalances(orgId: string): Promise<CircleChainBalanceRecord[]> {
  const body = await apiFetch<{ readonly balances: CircleChainBalanceRecord[] }>(`/v1/orgs/${orgId}/payments/circle/balances`);
  return body.balances;
}

export async function getPaymentsConsoleSnapshot(orgId: string): Promise<{
  readonly balances: CircleChainBalanceRecord[];
  readonly overview: TreasuryOverviewRecord;
  readonly rebalanceRecommendations: RebalanceRecommendationRecord[];
}> {
  return apiFetch<{
    readonly balances: CircleChainBalanceRecord[];
    readonly overview: TreasuryOverviewRecord;
    readonly rebalanceRecommendations: RebalanceRecommendationRecord[];
  }>(`/v1/orgs/${orgId}/payments/console-snapshot`);
}

export async function listCircleProviderJobs(orgId: string): Promise<CircleProviderJobRecord[]> {
  const body = await apiFetch<{ readonly jobs: CircleProviderJobRecord[] }>(`/v1/orgs/${orgId}/payments/circle/jobs`);
  return body.jobs;
}

export async function reconcileCircleProviderJobs(orgId: string): Promise<CircleProviderJobRecord[]> {
  const body = await apiFetch<{ readonly jobs: CircleProviderJobRecord[] }>(
    `/v1/orgs/${orgId}/payments/circle/jobs/reconcile`,
    { method: 'POST' },
  );
  return body.jobs;
}

export async function getTreasuryOverview(orgId: string): Promise<TreasuryOverviewRecord> {
  const body = await apiFetch<{ readonly overview: TreasuryOverviewRecord }>(`/v1/orgs/${orgId}/payments/treasury/overview`);
  return body.overview;
}

export async function listLiquidityJobs(orgId: string): Promise<CircleProviderJobRecord[]> {
  const body = await apiFetch<{ readonly jobs: CircleProviderJobRecord[] }>(`/v1/orgs/${orgId}/payments/liquidity-jobs`);
  return body.jobs;
}

export async function retryLiquidityJob(orgId: string, jobId: string): Promise<CircleProviderJobRecord> {
  const body = await apiFetch<{ readonly job: CircleProviderJobRecord }>(
    `/v1/orgs/${orgId}/payments/liquidity-jobs/${encodeURIComponent(jobId)}/retry`,
    { method: 'POST' },
  );
  return body.job;
}

export async function cancelLiquidityJob(orgId: string, jobId: string): Promise<CircleProviderJobRecord> {
  const body = await apiFetch<{ readonly job: CircleProviderJobRecord }>(
    `/v1/orgs/${orgId}/payments/liquidity-jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST' },
  );
  return body.job;
}

export async function listRebalanceRecommendations(orgId: string): Promise<RebalanceRecommendationRecord[]> {
  const body = await apiFetch<{ readonly recommendations: RebalanceRecommendationRecord[] }>(
    `/v1/orgs/${orgId}/payments/rebalance/recommendations`,
  );
  return body.recommendations;
}

export async function bridgeExactWalletTopUp(
  orgId: string,
  input: { readonly amount_usdc: string; readonly from_chain: PaymentChain; readonly to_chain: PaymentChain },
): Promise<CircleProviderJobRecord> {
  const response = await fetch(`${apiBaseUrl()}/v1/orgs/${orgId}/payments/rebalance/bridge-topup`, {
    cache: 'no-store',
    headers: {
      ...(await sessionHeaders()),
      'content-type': 'application/json',
    },
    method: 'POST',
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { readonly error?: string; readonly job?: CircleProviderJobRecord; readonly message?: string };
  if (!response.ok && body.job === undefined) {
    throw new Error(body.message ?? body.error ?? `API request failed with ${response.status}`);
  }
  if (body.job === undefined) throw new Error('Bridge top-up response did not include a provider job.');
  return body.job;
}

export async function initiateGatewayDeposit(
  orgId: string,
  input: { readonly amount_usdc: string; readonly chain: PaymentChain },
): Promise<CircleProviderJobRecord> {
  const response = await fetch(`${apiBaseUrl()}/v1/orgs/${orgId}/payments/circle/gateway-deposits`, {
    cache: 'no-store',
    headers: {
      ...(await sessionHeaders()),
      'content-type': 'application/json',
    },
    method: 'POST',
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { readonly error?: string; readonly job?: CircleProviderJobRecord; readonly message?: string };
  if (!response.ok && body.job === undefined) {
    throw new Error(body.message ?? body.error ?? `API request failed with ${response.status}`);
  }
  if (body.job === undefined) throw new Error('Gateway deposit response did not include a provider job.');
  return body.job;
}

export async function requestTestnetFunds(
  orgId: string,
  input: { readonly chains: readonly PaymentChain[] },
): Promise<CircleProviderJobRecord[]> {
  const body = await apiFetch<{ readonly jobs: CircleProviderJobRecord[] }>(
    `/v1/orgs/${orgId}/payments/circle/testnet-faucet`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return body.jobs;
}

export async function setAgentPaymentAccess(
  orgId: string,
  agentId: string,
  input: {
    readonly allowed_rails: readonly PaymentRail[];
    readonly approval_threshold_usdc?: string | null | undefined;
    readonly budget_usdc: string;
    readonly dedicated_wallet_required: false;
    readonly per_request_cap_usdc: string;
    readonly status: 'active' | 'disabled';
  },
): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/agents/${agentId}/payment-access`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
