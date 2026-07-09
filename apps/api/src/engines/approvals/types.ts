export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled' | 'consumed';

export type ApprovalRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly connection_id: string;
  readonly decision_id: string;
  readonly status: ApprovalStatus;
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
};

export type ActivityCategory = 'policy' | 'approval' | 'runtime' | 'integration' | 'operation' | 'payment' | 'treasury';
export type ActivityOutcome = 'success' | 'denied' | 'pending' | 'error';

export type ActivityRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string | null;
  readonly connection_id: string | null;
  readonly decision_id: string | null;
  readonly approval_id: string | null;
  readonly category: ActivityCategory;
  readonly action: string;
  readonly outcome: ActivityOutcome;
  readonly summary: string;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
};
