export type OperationalAction = 'runtime.http.request' | 'tool.call';
export type OperationDecision = 'allow' | 'deny' | 'observe' | 'approval_required' | 'rate_limited';
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ToolCatalogRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly name: string;
  readonly display_name: string;
  readonly category: string;
  readonly risk_level: ToolRiskLevel;
  readonly description: string;
  readonly source: 'manual' | 'runtime' | 'import';
  readonly status: 'active' | 'archived';
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
};

export type BlockedOperationRecord = {
  readonly id: string;
  readonly action: OperationalAction;
  readonly agent_id: string;
  readonly connection_id: string | null;
  readonly decision: 'deny' | 'rate_limited';
  readonly reasonCode: string;
  readonly explanation: string;
  readonly tool_name: string | null;
  readonly resource_label: string | null;
  readonly created_at: string;
};

export type AgentAllowedActionRecord = {
  readonly action: OperationalAction;
  readonly label: string;
  readonly decision: Exclude<OperationDecision, 'rate_limited'>;
  readonly policyName: string;
};

export type OperationsAgentOption = {
  readonly id: string;
  readonly name: string;
};

export type RateLimitUtilizationRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly target_type: 'org' | 'team' | 'agent' | 'connection';
  readonly target_id: string;
  readonly action: OperationalAction;
  readonly bucket: string;
  readonly limit: number;
  readonly window_seconds: number;
  readonly status: 'active' | 'disabled';
  readonly created_at: string;
  readonly utilization: {
    readonly current_count: number;
    readonly current_bucket: string | null;
    readonly current_window_start: string | null;
  };
};
