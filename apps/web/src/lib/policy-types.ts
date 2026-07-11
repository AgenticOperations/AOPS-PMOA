export type PolicyDraft = {
  readonly id: string;
  readonly source: 'preset' | 'blank' | 'request' | 'structured';
  readonly name: string;
  readonly description: string;
  readonly category: 'management' | 'operational' | 'capability';
  readonly status: 'draft' | 'validated' | 'activated' | 'discarded';
  readonly updated_at: string;
};

export type PolicyVersion = {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly category: 'management' | 'operational' | 'capability';
  readonly status: 'active' | 'archived';
  readonly statements?: PolicyStatement[] | undefined;
  readonly binding_target_types: Array<'agent' | 'connection' | 'org' | 'team'>;
  readonly bindings: PolicyBinding[];
  readonly bindings_count: number;
  readonly created_at: string;
};

export type PolicyStatement = {
  readonly id?: string | undefined;
  readonly decision?: string | undefined;
  readonly actions?: string[] | undefined;
  readonly actor?: {
    readonly roles?: string[] | undefined;
  } | undefined;
  readonly target?: {
    readonly types?: Array<'agent' | 'connection' | 'org' | 'team'> | undefined;
  } | undefined;
  readonly conditions?: {
    readonly resource?: {
      readonly categories?: string[] | undefined;
      readonly domains?: string[] | undefined;
    } | undefined;
    readonly payment?: {
      readonly minAmount?: string | number | undefined;
      readonly assets?: string[] | undefined;
    } | undefined;
    readonly tool?: {
      readonly names?: string[] | undefined;
    } | undefined;
  } | undefined;
};

export type PolicyDecisionRequest = {
  readonly actor: {
    readonly type: 'agent' | 'connection' | 'system' | 'user';
    readonly id?: string | undefined;
    readonly role?: string | undefined;
  };
  readonly action: string;
  readonly target: {
    readonly type: 'agent' | 'connection' | 'org' | 'team';
    readonly id?: string | undefined;
  };
  readonly context: Record<string, unknown>;
};

export type PolicyDecisionResult = {
  readonly decision: 'allow' | 'approval_required' | 'deny' | 'observe';
  readonly enforceability: 'enforceable';
  readonly explanation: string;
  readonly matched: Array<{
    readonly decision: string;
    readonly policyId: string;
    readonly policyName: string;
    readonly policyVersion: number;
    readonly statementId: string;
  }>;
  readonly reasonCode: string;
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

export type PolicyDecisionRecord = {
  readonly id: string;
  readonly actor_type: PolicyDecisionRequest['actor']['type'];
  readonly actor_id: string | null;
  readonly actor_role: string | null;
  readonly action_id: string;
  readonly target_type: PolicyDecisionRequest['target']['type'];
  readonly target_id: string | null;
  readonly context: Record<string, unknown>;
  readonly decision: PolicyDecisionResult['decision'];
  readonly enforceability: PolicyDecisionResult['enforceability'];
  readonly reason_code: string;
  readonly explanation: string;
  readonly matched: PolicyDecisionResult['matched'];
  readonly audit_event_id: string | null;
  readonly created_at: string;
};

export type PolicyActionRecord = {
  readonly action_id: string;
  readonly category: string;
  readonly label: string;
  readonly description: string;
  readonly enforceability: 'enforceable';
  readonly introduced_section: number;
  readonly condition_groups: Array<'payment' | 'resource' | 'tool'>;
  readonly binding_target_types: Array<'agent' | 'connection' | 'org' | 'team'>;
};

export type PolicyBinding = {
  readonly id: string;
  readonly target_id: string;
  readonly target_type: 'agent' | 'connection' | 'org' | 'team';
  readonly status: 'active' | 'removed';
  readonly created_at: string;
};

export type PolicyLibrary = {
  readonly drafts: PolicyDraft[];
  readonly policies: PolicyVersion[];
};

export type AgentPolicyAssignment = {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly category: 'management' | 'operational' | 'capability';
  readonly binding: {
    readonly id: string;
    readonly scope: 'credential' | 'direct' | 'team' | 'workspace';
    readonly target_type: 'agent' | 'connection' | 'org' | 'team';
    readonly target_id: string;
    readonly target_label: string;
  };
};

export type AgentPolicyLibrary = {
  readonly policies: AgentPolicyAssignment[];
};
