import 'server-only';
import { cookies } from 'next/headers';
import { readWebEnv } from '../env';
import type {
  AgentPaymentAccountRecord,
  AgentPaymentSummary,
  CircleChainBalanceRecord,
  CircleChainCapabilityRecord,
  CircleChainWalletRecord,
  CircleConnectionChallenge,
  CircleConnectionRecord,
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

export class PaymentsApiError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? body.error ?? `API request failed with ${status}`);
    this.name = 'PaymentsApiError';
    this.code = body.error ?? null;
    this.status = status;
  }
}

export type ProviderReadResult<T> =
  | { readonly status: 'available'; readonly value: T }
  | { readonly status: 'unavailable'; readonly value: null };

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
    throw new PaymentsApiError(response.status, body);
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

export async function getAgentPayments(orgId: string, agentId: string): Promise<AgentPaymentSummary> {
  return apiFetch<AgentPaymentSummary>(`/v1/orgs/${orgId}/agents/${agentId}/payments`);
}

export async function listAgentPaymentAccounts(orgId: string): Promise<{
  readonly accounts: AgentPaymentAccountRecord[];
  readonly sources: PaymentSourceRecord[];
}> {
  return apiFetch<{ readonly accounts: AgentPaymentAccountRecord[]; readonly sources: PaymentSourceRecord[] }>(
    `/v1/orgs/${orgId}/payments/agent-accounts`,
  );
}

export async function getProviderMode(orgId: string): Promise<OrgPaymentModeRecord> {
  const body = await apiFetch<{ readonly mode: OrgPaymentModeRecord }>(`/v1/orgs/${orgId}/payments/provider-mode`);
  return body.mode;
}

export async function getCircleConnection(orgId: string): Promise<CircleConnectionRecord> {
  const body = await apiFetch<{ readonly connection: CircleConnectionRecord }>(
    `/v1/orgs/${orgId}/payments/circle/connection`,
  );
  return body.connection;
}

export async function readCircleConnection(orgId: string): Promise<ProviderReadResult<CircleConnectionRecord>> {
  try {
    return { status: 'available', value: await getCircleConnection(orgId) };
  } catch (error) {
    if (error instanceof PaymentsApiError && error.status >= 500) {
      return { status: 'unavailable', value: null };
    }
    throw error;
  }
}

export async function initializeCircleConnection(
  orgId: string,
  input: { readonly email: string },
): Promise<CircleConnectionChallenge> {
  return apiFetch<CircleConnectionChallenge>(`/v1/orgs/${orgId}/payments/circle/connection/init`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function completeCircleConnection(
  orgId: string,
  input: { readonly challenge_id: string; readonly otp: string },
): Promise<CircleConnectionRecord> {
  return apiFetch<CircleConnectionRecord>(`/v1/orgs/${orgId}/payments/circle/connection/complete`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function disconnectCircleConnection(orgId: string): Promise<CircleConnectionRecord> {
  return apiFetch<CircleConnectionRecord>(`/v1/orgs/${orgId}/payments/circle/connection`, {
    method: 'DELETE',
  });
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

export async function readProviderHealth(orgId: string): Promise<ProviderReadResult<CircleProviderHealth>> {
  try {
    return { status: 'available', value: await getProviderHealth(orgId) };
  } catch (error) {
    if (error instanceof PaymentsApiError && error.status >= 500) {
      return { status: 'unavailable', value: null };
    }
    throw error;
  }
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
    // Was pinned to `false` at the type level, which made provisioning an
    // agent wallet from the console impossible rather than merely unused.
    readonly dedicated_wallet_required: boolean;
    readonly per_request_cap_usdc: string;
    readonly status: 'active' | 'disabled';
  },
): Promise<void> {
  await apiFetch(`/v1/orgs/${orgId}/agents/${agentId}/payment-access`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// --- Delegations from a user-owned wallet ---------------------------------
//
// The operator's own wallet is the payer. This platform holds no key for it,
// so the browser produces the signature and sends approve() itself; these
// calls only build the payload to sign and record the result.

export type DelegationTypedDataRequest = {
  readonly payer_address: string;
  readonly chain: string;
  readonly ceiling_usdc: string;
  readonly expires_at: string;
  readonly payee_agent_id?: string;
  readonly payee_address?: string;
};

export type DelegationTypedDataResponse = {
  readonly typedData: Record<string, unknown>;
  readonly nonce: string;
  readonly tokenAddress: string;
  readonly permit2Address: string;
};

export async function buildDelegationTypedData(
  orgId: string,
  body: DelegationTypedDataRequest,
): Promise<DelegationTypedDataResponse> {
  return apiFetch<DelegationTypedDataResponse>(`/v1/orgs/${orgId}/payments/delegations/typed-data`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export type RecordDelegationRequest = DelegationTypedDataRequest & {
  readonly signature: string;
  // Echoed back exactly as issued by typed-data. Re-deriving it here could
  // produce a different nonce than the wallet signed over.
  readonly nonce: string;
};

export async function recordDelegation(orgId: string, body: RecordDelegationRequest): Promise<unknown> {
  return apiFetch(`/v1/orgs/${orgId}/payments/delegations`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// The treasury pays, so there is nothing for a wallet to sign: no payer
// address, no signature, no nonce. That absence is the whole point.
export type TreasuryDelegationRequest = {
  readonly chain: PaymentChain;
  readonly ceiling_usdc: string;
  readonly expires_at: string;
  readonly payee_agent_id?: string;
  readonly payee_address?: string;
};

export async function createTreasuryDelegation(
  orgId: string,
  body: TreasuryDelegationRequest,
): Promise<unknown> {
  return apiFetch(`/v1/orgs/${orgId}/payments/delegations/treasury`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export type OrgCeilingRecord = {
  readonly chain: string;
  readonly treasury_address: string | null;
  // null when the org has never set one: bounded only by treasury solvency.
  readonly ceiling_usdc: string | null;
  readonly outstanding_usdc: string;
  // The treasury WALLET balance -- what solvency is judged on. Excludes
  // Circle Gateway, which cannot back a Permit2 pull. null means the chain
  // RPC was unreachable, which is not the same as a zero balance.
  readonly treasury_balance_usdc: string | null;
};

export async function listOrgCeilings(orgId: string): Promise<readonly OrgCeilingRecord[]> {
  const body = await apiFetch<{ readonly ceilings: readonly OrgCeilingRecord[] }>(
    `/v1/orgs/${orgId}/payments/delegations/ceiling`,
  );
  return body.ceilings;
}

export async function setOrgCeiling(
  orgId: string,
  body: { readonly chain: PaymentChain; readonly ceiling_usdc: string },
): Promise<unknown> {
  return apiFetch(`/v1/orgs/${orgId}/payments/delegations/ceiling`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export type DelegationSummary = {
  readonly id: string;
  readonly payerAgentId: string | null;
  readonly payerAddress: string;
  readonly payeeAgentId: string | null;
  readonly payeeAddress: string;
  readonly chain: string;
  readonly ceilingUsdc: string;
  readonly drawnUsdc: string;
  readonly remainingUsdc: string;
  readonly expiresAt: string;
  readonly status: string;
  readonly platformControlsPayer: boolean;
};

export async function listDelegations(orgId: string): Promise<readonly DelegationSummary[]> {
  const body = await apiFetch<{ readonly delegations: readonly DelegationSummary[] }>(
    `/v1/orgs/${orgId}/payments/delegations`,
  );
  return body.delegations;
}

/**
 * Revoking always stops THIS control plane from issuing further drawdowns.
 * onChainRevoked is false when the payer is a user-owned wallet: Permit2's
 * lockdown() may only be called by the allowance owner, so the on-chain
 * allowance survives until the user signs it. Callers must surface that.
 */
export async function revokeDelegation(
  orgId: string,
  delegationId: string,
): Promise<{ readonly onChainRevoked: boolean }> {
  return apiFetch(`/v1/orgs/${orgId}/payments/delegations/${delegationId}/revoke`, { method: 'POST' });
}

// --- Escrow trust graduation ------------------------------------------------
//
// `jobs` comes back as raw `escrow_jobs` rows (trust.ts deliberately reuses
// EscrowJobRow rather than shaping a second DTO) -- snake_case, and each job
// carries four separate tx-hash columns rather than one. The console only
// wants the single most-recent hash, so that reduction happens here rather
// than asking every caller to repeat it.

export type EscrowJobRecord = {
  readonly id: string;
  readonly state: 'open' | 'funded' | 'submitted' | 'completed' | 'rejected' | 'expired';
  readonly budgetUsdc: string;
  readonly txHash: string | null;
};

type RawEscrowJobRow = {
  readonly id: string;
  readonly state: EscrowJobRecord['state'];
  readonly budget_usdc: string;
  readonly create_tx_hash: string | null;
  readonly fund_tx_hash: string | null;
  readonly submit_tx_hash: string | null;
  readonly terminal_tx_hash: string | null;
};

function escrowJobRecordFromRow(row: RawEscrowJobRow): EscrowJobRecord {
  return {
    id: row.id,
    state: row.state,
    budgetUsdc: row.budget_usdc,
    // Terminal first: once a job settles, that tx is the one worth linking
    // to, not an earlier step in its life.
    txHash: row.terminal_tx_hash ?? row.submit_tx_hash ?? row.fund_tx_hash ?? row.create_tx_hash,
  };
}

export type TrustEvidenceRecord = {
  readonly completedCount: number;
  readonly rejectedCount: number;
  readonly expiredCount: number;
  readonly settledUsdc: string;
  readonly trusted: boolean;
  readonly jobs: readonly EscrowJobRecord[];
};

export async function getTrustEvidence(
  orgId: string,
  chain: PaymentChain,
  address: string,
): Promise<TrustEvidenceRecord> {
  const body = await apiFetch<{
    readonly evidence: Omit<TrustEvidenceRecord, 'jobs'> & { readonly jobs: readonly RawEscrowJobRow[] };
  }>(`/v1/orgs/${orgId}/payments/trust/${chain}/${address}`);
  return { ...body.evidence, jobs: body.evidence.jobs.map(escrowJobRecordFromRow) };
}

export type TrustPromoteRequest = {
  readonly label: string;
  readonly ceiling_usdc: string;
  readonly expires_at: string;
};

export async function trustExternalAgent(
  orgId: string,
  chain: PaymentChain,
  address: string,
  body: TrustPromoteRequest,
): Promise<unknown> {
  return apiFetch(`/v1/orgs/${orgId}/payments/trust/${chain}/${address}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function revokeTrust(orgId: string, chain: PaymentChain, address: string): Promise<unknown> {
  return apiFetch(`/v1/orgs/${orgId}/payments/trust/${chain}/${address}/revoke`, { method: 'POST' });
}

export type EscrowCounterpartyRecord = {
  readonly chain: PaymentChain;
  readonly providerAddress: string;
};

export async function listEscrowCounterparties(orgId: string): Promise<readonly EscrowCounterpartyRecord[]> {
  const body = await apiFetch<{ readonly counterparties: readonly EscrowCounterpartyRecord[] }>(
    `/v1/orgs/${orgId}/payments/escrow/counterparties`,
  );
  return body.counterparties;
}

export type EscrowLivenessRiskRecord = {
  readonly escrowJobId: string;
  readonly providerAddress: string;
  readonly expiresAt: string;
};

export async function listEscrowLivenessRisks(orgId: string): Promise<readonly EscrowLivenessRiskRecord[]> {
  const body = await apiFetch<{ readonly risks: readonly EscrowLivenessRiskRecord[] }>(
    `/v1/orgs/${orgId}/payments/escrow/liveness-risks`,
  );
  return body.risks;
}

// --- Funding hierarchy: org treasury -> agent wallet -> the agent ---------

export type AgentWalletFundingRecord = {
  readonly agentId: string;
  readonly agentName: string;
  readonly chain: PaymentChain;
  readonly address: string;
  readonly status: string;
  // Null when the on-chain read failed; the screen shows "—" rather than
  // pretending the balance is zero, which would look like an empty wallet.
  readonly usdcMicros: string | null;
  readonly allocatedUsdc: string | null;
  readonly lowWaterMarkUsdc: string | null;
};

export async function listAgentWalletFunding(orgId: string): Promise<readonly AgentWalletFundingRecord[]> {
  const body = await apiFetch<{ readonly wallets: readonly AgentWalletFundingRecord[] }>(
    `/v1/orgs/${orgId}/payments/agent-wallets`,
  );
  return body.wallets;
}

export type AgentOnchainIdentityRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly mode: string;
  readonly chain: string;
  readonly registry_address: string;
  readonly token_id: string | null;
  readonly agent_uri: string;
  readonly register_tx_hash: string | null;
  readonly status: 'pending' | 'registered' | 'failed';
};

export async function getAgentOnchainIdentity(
  orgId: string,
  agentId: string,
): Promise<AgentOnchainIdentityRecord | null> {
  const body = await apiFetch<{ readonly identity: AgentOnchainIdentityRecord | null }>(
    `/v1/orgs/${orgId}/agents/${agentId}/identity`,
  );
  return body.identity;
}

export async function registerAgentOnchainIdentity(
  orgId: string,
  agentId: string,
  input: { readonly endpoint_url: string; readonly agent_uri?: string | undefined },
): Promise<AgentOnchainIdentityRecord> {
  const body = await apiFetch<{ readonly identity: AgentOnchainIdentityRecord }>(
    `/v1/orgs/${orgId}/agents/${agentId}/identity/register`,
    {
      method: 'POST',
      body: JSON.stringify({
        endpoint_url: input.endpoint_url,
        agent_uri: input.agent_uri,
        chain: 'arc',
      }),
    },
  );
  return body.identity;
}
