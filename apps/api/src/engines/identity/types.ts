export type Role = 'owner' | 'admin' | 'operator' | 'auditor' | 'viewer' | 'member';

export type OperatorContext = {
  readonly actorId: string;
  readonly role: Role;
  readonly userId?: string | undefined;
  readonly orgId?: string | undefined;
};

export type MemberRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly user_id: string;
  readonly email: string;
  readonly name: string;
  readonly avatar_url: string | null;
  readonly role: Role;
  readonly status: 'active' | 'invited' | 'removed';
  readonly joined_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type OnboardingStateRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly flow_key: string;
  readonly status: 'not_started' | 'in_progress' | 'completed';
  readonly payload: Record<string, unknown>;
  readonly completed_at: string | null;
  readonly created_by_user_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type OrgRecord = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly default_team_id: string;
  readonly settings: Record<string, unknown>;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
};

export type TeamRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly name: string;
  readonly description: string;
  readonly is_default: boolean;
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type AgentStatus = 'active' | 'paused' | 'deactivated' | 'retired' | 'suspended';
export type ConnectionHealth = 'not_connected' | 'healthy' | 'stale' | 'revoked';

export type AgentRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly team_id: string;
  readonly parent_agent_id: string | null;
  readonly name: string;
  readonly status: AgentStatus;
  readonly description: string;
  readonly labels: string[];
  readonly default_environment: string | null;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
};

export type AgentRosterItem = Pick<
  AgentRecord,
  'id' | 'name' | 'status' | 'labels' | 'created_at' | 'updated_at'
> & {
  readonly team: { readonly id: string; readonly name: string };
  readonly connection_health: ConnectionHealth;
  readonly wallet_refs_count: number;
  readonly policy_coverage: number;
  readonly last_activity_at: string | null;
};

export type ConnectionKind =
  | 'agent_credential'
  | 'mcp_local'
  | 'mcp_remote'
  | 'mcp_http'
  | 'api_key'
  | 'sdk'
  | 'cli'
  | 'proxy'
  | 'manual_observe';

export type ConnectionStatus = 'active' | 'revoked';

export type ConnectionRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly kind: ConnectionKind;
  readonly name: string;
  readonly status: ConnectionStatus;
  readonly secret_last4: string | null;
  readonly last_tested_at: string | null;
  readonly last_used_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type WalletRefRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly provider: string;
  readonly external_wallet_id: string | null;
  readonly address: string | null;
  readonly chain: string | null;
  readonly label: string;
  readonly status: 'attached' | 'detached';
  readonly attached_at: string;
  readonly detached_at: string | null;
};
