export type AuditOutcome = 'success' | 'denied' | 'error' | 'pending';
export type AuditEventDomain = 'identity' | 'credential' | 'policy' | 'wallet' | 'payment' | 'treasury' | 'system';
export type AuditEventCategory = 'configuration' | 'policy' | 'runtime' | 'financial' | 'security' | 'compliance';
export type AuditSeverity = 'info' | 'warning' | 'critical';

export type AuditEventRecord = {
  readonly id: string;
  readonly orgId: string;
  readonly sequence: number;
  readonly idempotencyKey: string | null;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly reasonCode: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly eventDomain: AuditEventDomain;
  readonly eventCategory: AuditEventCategory;
  readonly severity: AuditSeverity;
  readonly tags: readonly string[];
  readonly relatedAgentId: string | null;
  readonly relatedTeamId: string | null;
  readonly relatedConnectionId: string | null;
  readonly relatedWalletRefId: string | null;
  readonly relatedPolicyId: string | null;
  readonly relatedWalletId: string | null;
  readonly requestId: string | null;
  readonly sourceSection: string | null;
  readonly sourceSystem: string | null;
  readonly sourceRef: string | null;
  readonly policyRef: string | null;
  readonly decisionRef: string | null;
  readonly approvalRef: string | null;
  readonly retentionClass: string;
  readonly redactionState: 'none' | 'redacted';
  readonly canonicalBodyHash: string;
  readonly previousHash: string | null;
  readonly eventHash: string;
};

export type AuditEventList = {
  readonly events: readonly AuditEventRecord[];
};
