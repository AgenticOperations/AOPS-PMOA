export type Org = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly default_team_id: string;
  readonly settings: Record<string, unknown>;
  readonly status: string;
};

export type CurrentUser = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly avatar_url?: string | null;
};

export type CurrentSession = {
  readonly user: CurrentUser;
  readonly orgs: Org[];
};

export type Role = 'owner' | 'admin' | 'operator' | 'auditor' | 'viewer' | 'member';

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

export type AgentStatus = 'active' | 'paused' | 'deactivated' | 'retired' | 'suspended';
export type ConnectionHealth = 'not_connected' | 'healthy' | 'stale' | 'revoked';

export type AgentRosterItem = {
  readonly id: string;
  readonly name: string;
  readonly status: AgentStatus;
  readonly labels: string[];
  readonly team: { readonly id: string; readonly name: string };
  readonly connection_health: ConnectionHealth;
  readonly wallet_refs_count: number;
  readonly policy_coverage: number;
  readonly last_activity_at: string | null;
  readonly identity_token_id?: string | null;
  readonly reputation_score?: number;
  readonly reputation_events?: number;
};

export type AgentRosterPage = {
  readonly agents: AgentRosterItem[];
  readonly pagination: {
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
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

export type ConnectionRecord = {
  readonly id: string;
  readonly agent_id: string;
  readonly kind: string;
  readonly name: string;
  readonly status: 'active' | 'revoked';
  readonly secret_last4: string | null;
  readonly last_tested_at: string | null;
  readonly last_used_at: string | null;
  readonly created_at: string;
};

export type WalletRefRecord = {
  readonly id: string;
  readonly agent_id: string;
  readonly provider: string;
  readonly external_wallet_id: string | null;
  readonly address: string | null;
  readonly chain: string | null;
  readonly label: string;
  readonly status: 'attached' | 'detached';
};

export type AgentDetail = {
  readonly id: string;
  readonly org_id?: string;
  readonly team_id?: string;
  readonly parent_agent_id?: string | null;
  readonly name: string;
  readonly status: AgentStatus;
  readonly description: string;
  readonly labels: string[];
  readonly default_environment: string | null;
  readonly metadata: Record<string, unknown>;
  readonly team: { readonly id: string; readonly name: string };
  readonly parent: { readonly id: string; readonly name: string } | null;
  readonly children: Array<{ readonly id: string; readonly name: string; readonly status: AgentStatus }>;
  readonly connection_health: ConnectionHealth;
  readonly wallet_refs_count: number;
};

export type ActivityItem = {
  readonly id: string;
  readonly eventType: string;
  readonly action: string;
  readonly outcome: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly eventDomain: string;
  readonly eventCategory: string;
  readonly severity: string;
  readonly tags: string[];
  readonly summary: string;
  readonly subject: string | null;
  readonly description: string | null;
  readonly recordedAt: string;
};

export type AgentActivityFeedItem = {
  readonly id: string;
  readonly source: 'activity' | 'audit';
  readonly category: string;
  readonly action: string;
  readonly outcome: string;
  readonly summary: string;
  readonly subject: string | null;
  readonly description: string | null;
  readonly connectionId: string | null;
  readonly decisionId: string | null;
  readonly approvalId: string | null;
  readonly occurredAt: string;
  readonly payload: Record<string, unknown>;
};

export type AgentActivityFeed = {
  readonly live: {
    readonly status: 'active' | 'idle' | 'offline';
    readonly last_seen_at: string | null;
    readonly latest_event_at: string | null;
    readonly active_connection_count: number;
  };
  readonly events: AgentActivityFeedItem[];
};

export type AgentDetailBundle = {
  readonly agent: AgentDetail;
  readonly connections: ConnectionRecord[];
  readonly walletRefs: WalletRefRecord[];
  readonly activity: ActivityItem[];
  readonly activityFeed?: AgentActivityFeed;
};
