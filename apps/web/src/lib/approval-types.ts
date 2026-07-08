export type ApprovalRecord = {
  readonly id: string;
  readonly agent_id: string;
  readonly connection_id: string;
  readonly decision_id: string;
  readonly status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled' | 'consumed';
  readonly action_id: string;
  readonly target_type: string;
  readonly target_id: string | null;
  readonly context: Record<string, unknown>;
  readonly context_hash: string;
  readonly expires_at: string;
  readonly note: string;
  readonly created_at: string;
};

export type ApprovalList = {
  readonly approvals: ApprovalRecord[];
};
