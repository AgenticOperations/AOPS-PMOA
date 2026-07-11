export type ApprovalActionRecord = {
  readonly id: string;
  readonly actor_type: 'user' | 'agent' | 'connection' | 'system';
  readonly actor_id: string;
  readonly action: 'requested' | 'approved' | 'denied' | 'cancelled' | 'expired' | 'consumed';
  readonly note: string;
  readonly created_at: string;
};

export type ApprovalConsumptionRecord = {
  readonly id: string;
  readonly decision_id: string;
  readonly connection_id: string;
  readonly context_hash: string;
  readonly created_at: string;
};

export type ApprovalRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly connection_id: string;
  readonly decision_id: string;
  readonly status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled' | 'consumed';
  readonly action_id: string;
  readonly target_type: string;
  readonly target_id: string | null;
  readonly context: Record<string, unknown>;
  readonly context_hash: string;
  readonly requested_by: string;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly denied_by: string | null;
  readonly denied_at: string | null;
  readonly consumed_at: string | null;
  readonly expires_at: string;
  readonly note: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly actions?: readonly ApprovalActionRecord[] | undefined;
  readonly consumption?: ApprovalConsumptionRecord | null | undefined;
};

export type ApprovalList = {
  readonly approvals: ApprovalRecord[];
};
