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
