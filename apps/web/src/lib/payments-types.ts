export type PaymentMode = 'test' | 'live';
export type PaymentChain = 'base' | 'arbitrum' | 'polygon' | 'optimism' | 'avalanche';
export type PaymentRail =
  | 'gateway_base'
  | 'gateway_arbitrum'
  | 'gateway_polygon'
  | 'gateway_optimism'
  | 'gateway_avalanche'
  | 'exact_base'
  | 'exact_arbitrum'
  | 'exact_polygon'
  | 'exact_optimism'
  | 'exact_avalanche';
export type PaymentStatus = 'active' | 'disabled';

export type OrgPaymentModeRecord = {
  readonly mode: PaymentMode;
  readonly org_id: string;
  readonly updated_at: string;
  readonly updated_by: string;
};

export type CircleProviderHealth = {
  readonly configured: boolean;
  readonly missing: readonly string[];
  readonly mode: PaymentMode;
  readonly provider: 'circle';
};

export type CircleChainCapabilityRecord = {
  readonly chain: PaymentChain;
  readonly circle_blockchain: string;
  readonly gateway_domain: number;
  readonly gateway_supported: boolean;
  readonly id: string;
  readonly mode: PaymentMode;
  readonly nanopayments_supported: boolean;
  readonly network_label: string | null;
  readonly status: PaymentStatus;
  readonly wallet_account_type: 'eoa' | 'sca';
  readonly wallet_supported: boolean;
};

export type CircleChainWalletRecord = {
  readonly account_type: 'eoa' | 'sca';
  readonly address: string;
  readonly chain: PaymentChain;
  readonly circle_blockchain: string;
  readonly circle_wallet_id: string;
  readonly created_at: string;
  readonly id: string;
  readonly metadata: Record<string, unknown>;
  readonly mode: PaymentMode;
  readonly org_id: string;
  readonly status: PaymentStatus;
  readonly updated_at: string;
  readonly wallet_set_id: string;
};

export type CircleWalletSetRecord = {
  readonly account_type: 'eoa' | 'sca';
  readonly circle_wallet_set_id: string;
  readonly created_at: string;
  readonly id: string;
  readonly label: string;
  readonly metadata: Record<string, unknown>;
  readonly mode: PaymentMode;
  readonly org_id: string;
  readonly provider: 'circle_wallets';
  readonly status: PaymentStatus;
  readonly updated_at: string;
};

export type CircleTokenBalanceRecord = {
  readonly amount: string;
  readonly blockchain: string | null;
  readonly is_native: boolean;
  readonly symbol: string | null;
  readonly token_address: string | null;
};

export type CircleGatewayBalanceRecord = {
  readonly available: string;
  readonly domain: number;
  readonly total: string;
  readonly withdrawable: string;
  readonly withdrawing: string;
};

export type CircleChainBalanceRecord = {
  readonly address: string;
  readonly chain: PaymentChain;
  readonly circle_wallet_id: string;
  readonly gateway: CircleGatewayBalanceRecord | null;
  readonly mode: PaymentMode;
  readonly tokens: readonly CircleTokenBalanceRecord[];
};

export type CircleProviderJobRecord = {
  readonly amount_usdc: string | null;
  readonly chain: PaymentChain | null;
  readonly created_at: string;
  readonly error_code: string | null;
  readonly id: string;
  readonly job_type: string;
  readonly metadata: Record<string, unknown>;
  readonly mode: PaymentMode;
  readonly org_id: string;
  readonly provider_ref: string | null;
  readonly status: 'queued' | 'submitted' | 'complete' | 'failed' | 'blocked';
  readonly updated_at: string;
};

export type TreasuryOverviewRecord = {
  readonly mode: PaymentMode;
  readonly totals: {
    readonly gateway_usdc: string;
    readonly wallet_usdc: string;
    readonly treasury_usdc: string;
  };
  readonly liquidity: {
    readonly pending_jobs: number;
    readonly failed_jobs: number;
    readonly last_job: CircleProviderJobRecord | null;
  };
  readonly payments: {
    readonly agents_with_access: number;
    readonly total_spent_usdc: string;
    readonly last_payment: {
      readonly amount: string;
      readonly rail: PaymentRail;
      readonly created_at: string;
    } | null;
  };
};

export type RebalanceRecommendationRecord = {
  readonly amount_usdc: string;
  readonly chain: PaymentChain;
  readonly current_wallet_usdc: string;
  readonly deficit_usdc: string;
  readonly reason_code: 'exact_wallet_below_recent_demand_floor';
  readonly recent_exact_spend_usdc: string;
  readonly recommended_min_usdc: string;
  readonly source_chain: PaymentChain;
};

export type TreasuryRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly treasury_type: 'gateway';
  readonly provider: 'circle_gateway' | 'simulation';
  readonly chain: PaymentChain;
  readonly label: string;
  readonly status: PaymentStatus;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
};

export type PaymentSourceRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly treasury_id: string | null;
  readonly source_type: 'gateway' | 'direct_exact' | 'dedicated_wallet';
  readonly provider: 'circle_gateway' | 'circle_wallets' | 'manual' | 'simulation';
  readonly rail: PaymentRail;
  readonly chain: PaymentChain;
  readonly label: string;
  readonly status: PaymentStatus;
  readonly account_type: 'eoa' | 'sca' | 'virtual' | 'unknown';
  readonly address: string | null;
  readonly external_wallet_id: string | null;
  readonly simulated_balance_usdc: string;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
};

export type AgentPaymentAccountRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly status: PaymentStatus;
  readonly payment_access: boolean;
  readonly budget_usdc: string;
  readonly spent_usdc: string;
  readonly reserved_usdc: string;
  readonly per_request_cap_usdc: string;
  readonly approval_threshold_usdc: string | null;
  readonly dedicated_wallet_required: boolean;
  readonly allowed_rails: PaymentRail[];
  readonly created_at: string;
  readonly updated_at: string;
};

export type AgentPaymentSummary = {
  readonly account: AgentPaymentAccountRecord | null;
  readonly sources: PaymentSourceRecord[];
};
