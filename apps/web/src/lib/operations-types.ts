export type OperationalAction = 'runtime.http.request' | 'tool.call';
export type OperationDecision = 'allow' | 'deny' | 'observe' | 'approval_required' | 'rate_limited';
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ToolCatalogRecord = {
  readonly id: string;
  readonly name: string;
  readonly display_name: string;
  readonly category: string;
  readonly risk_level: ToolRiskLevel;
  readonly description: string;
  readonly status: 'active' | 'archived';
  readonly created_at: string;
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
