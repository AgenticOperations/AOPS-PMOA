import type { OperatorContext } from '../identity/types.js';

export type PolicyDecisionValue = 'allow' | 'deny' | 'approval_required' | 'observe';

/**
 * What an org does with an action that no authored policy statement matches.
 * Defaults to 'deny' (fail closed); 'allow' is an explicit, auditable opt-in.
 */
export type PolicyDefaultEffect = 'deny' | 'allow';
export type PolicyEnforceability = 'enforceable';
export type PolicyCategory = 'management' | 'operational' | 'capability';
export type PolicyDraftSource = 'preset' | 'blank' | 'request' | 'structured';
export type PolicyDraftStatus = 'draft' | 'validated' | 'activated' | 'discarded';
export type PolicyVersionStatus = 'active' | 'superseded' | 'archived';
export type PolicyRevisionMode = 'revision' | 'restore';
export type PolicyTargetType = 'org' | 'team' | 'agent' | 'connection';
export type PolicyAuditLevel = 'standard' | 'detailed';
export type PolicyConditionGroup = 'resource' | 'payment' | 'tool';

export type PolicyActionRecord = {
  readonly action_id: string;
  readonly category: string;
  readonly label: string;
  readonly description: string;
  readonly enforceability: PolicyEnforceability;
  readonly introduced_section: number;
  readonly condition_groups: PolicyConditionGroup[];
  readonly binding_target_types: PolicyTargetType[];
};

export type PolicyStatementConditions = {
  readonly resource?: {
    readonly categories?: readonly string[] | undefined;
    readonly domains?: readonly string[] | undefined;
  } | undefined;
  readonly payment?: {
    readonly minAmount?: string | undefined;
    readonly maxAmount?: string | undefined;
    readonly assets?: readonly string[] | undefined;
    readonly networks?: readonly string[] | undefined;
    readonly recipients?: readonly string[] | undefined;
  } | undefined;
  readonly tool?: {
    readonly names?: readonly string[] | undefined;
    readonly riskLevels?: readonly string[] | undefined;
  } | undefined;
};

export type PolicyStatement = {
  readonly id: string;
  readonly decision: PolicyDecisionValue;
  readonly actions: readonly string[];
  readonly actor?: {
    readonly roles?: readonly OperatorContext['role'][] | undefined;
  } | undefined;
  readonly target?: {
    readonly types?: readonly PolicyTargetType[] | undefined;
    readonly ids?: readonly string[] | undefined;
  } | undefined;
  readonly conditions?: PolicyStatementConditions | undefined;
  readonly audit: PolicyAuditLevel;
};

export type PolicyDecisionRequest = {
  readonly actor: {
    readonly type: 'user' | 'agent' | 'connection' | 'system';
    readonly id?: string | undefined;
    readonly role?: OperatorContext['role'] | undefined;
  };
  readonly action: string;
  readonly target: {
    readonly type: PolicyTargetType;
    readonly id?: string | undefined;
  };
  readonly context: Record<string, unknown>;
};

export type EffectivePolicy = {
  readonly policyId: string;
  readonly version: number;
  readonly name: string;
  readonly statements: readonly PolicyStatement[];
};

export type PolicyDecisionMatch = {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly policyName: string;
  readonly statementId: string;
  readonly decision: PolicyDecisionValue;
};

export type PolicyDecisionResult = {
  readonly decision: PolicyDecisionValue;
  readonly enforceability: PolicyEnforceability;
  readonly reasonCode: string;
  readonly explanation: string;
  readonly matched: readonly PolicyDecisionMatch[];
};

export type PolicyDecisionRecord = {
  readonly id: string;
  readonly actor_type: PolicyDecisionRequest['actor']['type'];
  readonly actor_id: string | null;
  readonly actor_role: OperatorContext['role'] | null;
  readonly action_id: string;
  readonly target_type: PolicyTargetType;
  readonly target_id: string | null;
  readonly context: Record<string, unknown>;
  readonly decision: PolicyDecisionValue;
  readonly enforceability: PolicyEnforceability;
  readonly reason_code: string;
  readonly explanation: string;
  readonly matched: readonly PolicyDecisionMatch[];
  readonly audit_event_id: string | null;
  readonly created_at: string;
};

export type PolicyDraftRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly source: PolicyDraftSource;
  readonly name: string;
  readonly description: string;
  readonly category: PolicyCategory;
  readonly status: PolicyDraftStatus;
  readonly statements: PolicyStatement[];
  readonly validation: PolicyValidationResult;
  readonly created_by: string;
  readonly updated_by: string;
  readonly activated_policy_id: string | null;
  readonly activated_version: number | null;
  readonly revision_policy_id: string | null;
  readonly revision_base_version: number | null;
  readonly revision_mode: PolicyRevisionMode | null;
  readonly revision_restore_bindings: PolicyRestoreBindingInput[];
  readonly created_at: string;
  readonly updated_at: string;
};

export type PolicyVersionRecord = {
  readonly id: string;
  readonly version: number;
  readonly org_id: string;
  readonly draft_id: string | null;
  readonly name: string;
  readonly description: string;
  readonly category: PolicyCategory;
  readonly status: PolicyVersionStatus;
  readonly statements: PolicyStatement[];
  readonly validation: PolicyValidationResult;
  readonly change_reason: string;
  readonly created_by: string;
  readonly archived_by: string | null;
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly binding_target_types: PolicyTargetType[];
  readonly bindings: PolicyBindingRecord[];
  readonly bindings_count: number;
};

export type PolicyBindingRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly policy_id: string;
  readonly policy_version: number;
  readonly target_type: PolicyTargetType;
  readonly target_id: string;
  readonly status: 'active' | 'removed';
  readonly created_by: string;
  readonly created_at: string;
  readonly removed_by: string | null;
  readonly removed_at: string | null;
  readonly removed_reason: string | null;
};

export type AgentPolicyBindingScope = 'credential' | 'direct' | 'team' | 'workspace';

export type AgentPolicyAssignment = {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly category: PolicyCategory;
  readonly binding: {
    readonly id: string;
    readonly scope: AgentPolicyBindingScope;
    readonly target_type: PolicyTargetType;
    readonly target_id: string;
    readonly target_label: string;
  };
};

export type PolicyValidationResult = {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
};

export type PolicySimulationRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly draft_id: string | null;
  readonly request: PolicyDecisionRequest;
  readonly result: PolicyDecisionResult;
  readonly created_by: string;
  readonly created_at: string;
};

export type CreatePolicyDraftInput = {
  readonly source: PolicyDraftSource;
  readonly name: string;
  readonly description?: string | undefined;
  readonly category: PolicyCategory;
  readonly statements: readonly PolicyStatement[];
};

export type UpdatePolicyDraftInput = {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly category?: PolicyCategory | undefined;
  readonly statements?: readonly PolicyStatement[] | undefined;
};

export type CreatePolicyVersionInput = {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly category?: PolicyCategory | undefined;
  readonly statements?: readonly PolicyStatement[] | undefined;
  readonly change_reason?: string | undefined;
};

export type CreatePolicyRevisionDraftInput = UpdatePolicyDraftInput;

export type PolicyRestoreBindingInput = {
  readonly target_type: PolicyTargetType;
  readonly target_id: string;
};

export type CreatePolicyRestoreDraftInput = UpdatePolicyDraftInput & {
  readonly restore_bindings?: readonly PolicyRestoreBindingInput[] | undefined;
};
