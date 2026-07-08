import type { ActivityRecord } from '../approvals/types.js';
import type { PolicyDecisionMatch, PolicyDecisionValue } from '../policy/types.js';

export type OperationalAction = 'runtime.http.request' | 'tool.call';
export type OperationalDecisionValue = PolicyDecisionValue | 'rate_limited';
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type OperationalTargetType = 'org' | 'team' | 'agent' | 'connection';

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

export type ImportToolInput = {
  readonly name: string;
  readonly display_name?: string | undefined;
  readonly category?: string | undefined;
  readonly risk_level?: ToolRiskLevel | undefined;
  readonly description?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
};

export type OperationCheckInput = {
  readonly agent_id: string;
  readonly connection_id?: string | null | undefined;
  readonly action: OperationalAction;
  readonly resource?: Record<string, unknown> | undefined;
  readonly tool?: Record<string, unknown> | undefined;
  readonly context?: Record<string, unknown> | undefined;
};

export type RuntimeOperationCheckInput = Omit<OperationCheckInput, 'agent_id' | 'connection_id'>;

export type OperationRecordInput = {
  readonly agent_id: string;
  readonly connection_id?: string | null | undefined;
  readonly action: OperationalAction;
  readonly summary: string;
  readonly outcome?: 'success' | 'denied' | 'pending' | 'error' | undefined;
  readonly resource?: Record<string, unknown> | undefined;
  readonly tool?: Record<string, unknown> | undefined;
  readonly context?: Record<string, unknown> | undefined;
};

export type RuntimeOperationRecordInput = Omit<OperationRecordInput, 'agent_id' | 'connection_id'>;

export type OperationalDecisionRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly connection_id: string | null;
  readonly policyDecisionId: string | null;
  readonly approvalId: string | null;
  readonly action: OperationalAction;
  readonly decision: OperationalDecisionValue;
  readonly reasonCode: string;
  readonly explanation: string;
  readonly matched: readonly PolicyDecisionMatch[];
  readonly tool_name: string | null;
  readonly tool_risk_level: string | null;
  readonly resource_label: string | null;
  readonly resource_domain: string | null;
  readonly resource_category: string | null;
  readonly context: Record<string, unknown>;
  readonly created_at: string;
};

export type BlockedOperationRecord = Omit<OperationalDecisionRecord, 'decision'> & {
  readonly decision: 'deny' | 'rate_limited';
};

export type RateLimitRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly target_type: OperationalTargetType;
  readonly target_id: string;
  readonly action: OperationalAction;
  readonly bucket: string;
  readonly limit: number;
  readonly window_seconds: number;
  readonly status: 'active' | 'disabled';
  readonly created_at: string;
};

export type CreateRateLimitInput = {
  readonly target_type: OperationalTargetType;
  readonly target_id: string;
  readonly action: OperationalAction;
  readonly bucket?: string | undefined;
  readonly limit: number;
  readonly window_seconds: number;
};

export type AgentAllowedActionRecord = {
  readonly action: OperationalAction;
  readonly label: string;
  readonly decision: PolicyDecisionValue;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly policyName: string;
  readonly statementId: string;
  readonly scope: OperationalTargetType;
};

export type OperationRecordResult = {
  readonly activity: ActivityRecord;
};
