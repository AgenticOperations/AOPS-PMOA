import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { sha256Hex } from './canonical-json.js';
import { redactAuditPayload } from './redaction.js';

export class IdempotencyConflictError extends Error {
  constructor() {
    super('idempotency_conflict');
    this.name = 'IdempotencyConflictError';
  }
}

type AuditActorType = 'user' | 'agent' | 'connection' | 'system' | 'service' | 'key' | 'unknown';
type AuditOutcome = 'success' | 'denied' | 'error' | 'pending';
type AuditRetentionClass = 'standard' | 'payment' | 'security' | 'legal_hold';
type AuditEventDomain = 'identity' | 'credential' | 'policy' | 'wallet' | 'payment' | 'treasury' | 'system';
type AuditEventCategory = 'configuration' | 'policy' | 'runtime' | 'financial' | 'security' | 'compliance';
type AuditSeverity = 'info' | 'warning' | 'critical';

export type RecordAuditEventInput = {
  readonly orgId: string;
  readonly idempotencyKey?: string;
  readonly eventType: string;
  readonly occurredAt?: Date;
  readonly actor: {
    readonly type: AuditActorType;
    readonly id?: string;
  };
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly reasonCode?: string;
  readonly resource?: {
    readonly type: string;
    readonly id: string;
  };
  readonly classification?: {
    readonly domain?: AuditEventDomain;
    readonly category?: AuditEventCategory;
    readonly severity?: AuditSeverity;
    readonly tags?: readonly string[];
  };
  readonly relations?: {
    readonly agent?: string;
    readonly team?: string;
    readonly connection?: string;
    readonly walletRef?: string;
    readonly policy?: string;
    readonly wallet?: string;
  };
  readonly requestId?: string;
  readonly source?: {
    readonly section?: string;
    readonly system?: string;
    readonly ref?: string;
  };
  readonly refs?: {
    readonly policy?: string;
    readonly decision?: string;
    readonly approval?: string;
  };
  readonly externalRefs?: Record<string, unknown>;
  readonly retentionClass?: AuditRetentionClass;
  readonly payload?: unknown;
};

export type AuditEventRecord = {
  readonly id: string;
  readonly orgId: string;
  readonly sequence: number;
  readonly idempotencyKey: string | null;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actorType: AuditActorType;
  readonly actorId: string | null;
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly reasonCode: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly eventDomain: AuditEventDomain;
  readonly eventCategory: AuditEventCategory;
  readonly severity: AuditSeverity;
  readonly tags: string[];
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
  readonly retentionClass: AuditRetentionClass;
  readonly redactionState: 'none' | 'redacted';
  readonly canonicalBodyHash: string;
  readonly previousHash: string | null;
  readonly eventHash: string;
};

type AuditEventRow = {
  readonly id: string;
  readonly org_id: string;
  readonly sequence: string;
  readonly idempotency_key: string | null;
  readonly event_type: string;
  readonly occurred_at: Date;
  readonly recorded_at: Date;
  readonly actor_type: AuditActorType;
  readonly actor_id: string | null;
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly reason_code: string | null;
  readonly resource_type: string | null;
  readonly resource_id: string | null;
  readonly event_domain: AuditEventDomain;
  readonly event_category: AuditEventCategory;
  readonly severity: AuditSeverity;
  readonly tags: string[];
  readonly related_agent_id: string | null;
  readonly related_team_id: string | null;
  readonly related_connection_id: string | null;
  readonly related_wallet_ref_id: string | null;
  readonly related_policy_id: string | null;
  readonly related_wallet_id: string | null;
  readonly request_id: string | null;
  readonly source_section: string | null;
  readonly source_system: string | null;
  readonly source_ref: string | null;
  readonly policy_ref: string | null;
  readonly decision_ref: string | null;
  readonly approval_ref: string | null;
  readonly retention_class: AuditRetentionClass;
  readonly redaction_state: 'none' | 'redacted';
  readonly canonical_body_hash: string;
  readonly previous_hash: string | null;
  readonly event_hash: string;
};

const auditEventColumns = `
  id,
  org_id,
  sequence,
  idempotency_key,
  event_type,
  occurred_at,
  recorded_at,
  actor_type,
  actor_id,
  action,
  outcome,
  reason_code,
  resource_type,
  resource_id,
  event_domain,
  event_category,
  severity,
  tags,
  related_agent_id,
  related_team_id,
  related_connection_id,
  related_wallet_ref_id,
  related_policy_id,
  related_wallet_id,
  request_id,
  source_section,
  source_system,
  source_ref,
  policy_ref,
  decision_ref,
  approval_ref,
  retention_class,
  redaction_state,
  canonical_body_hash,
  previous_hash,
  event_hash
`;

function toRecord(row: AuditEventRow): AuditEventRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    sequence: Number(row.sequence),
    idempotencyKey: row.idempotency_key,
    eventType: row.event_type,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    outcome: row.outcome,
    reasonCode: row.reason_code,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    eventDomain: row.event_domain,
    eventCategory: row.event_category,
    severity: row.severity,
    tags: row.tags,
    relatedAgentId: row.related_agent_id,
    relatedTeamId: row.related_team_id,
    relatedConnectionId: row.related_connection_id,
    relatedWalletRefId: row.related_wallet_ref_id,
    relatedPolicyId: row.related_policy_id,
    relatedWalletId: row.related_wallet_id,
    requestId: row.request_id,
    sourceSection: row.source_section,
    sourceSystem: row.source_system,
    sourceRef: row.source_ref,
    policyRef: row.policy_ref,
    decisionRef: row.decision_ref,
    approvalRef: row.approval_ref,
    retentionClass: row.retention_class,
    redactionState: row.redaction_state,
    canonicalBodyHash: row.canonical_body_hash,
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
  };
}

function optionalString(value: string | undefined): string | null {
  return value ?? null;
}

function normalizedTags(tags: readonly string[] | undefined): string[] {
  if (tags === undefined) return [];
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .slice(0, 32),
    ),
  );
}

function classification(input: RecordAuditEventInput): {
  readonly eventDomain: AuditEventDomain;
  readonly eventCategory: AuditEventCategory;
  readonly severity: AuditSeverity;
  readonly tags: string[];
} {
  return {
    eventDomain: input.classification?.domain ?? 'system',
    eventCategory: input.classification?.category ?? 'configuration',
    severity: input.classification?.severity ?? 'info',
    tags: normalizedTags(input.classification?.tags),
  };
}

function buildCanonicalBody(input: RecordAuditEventInput): Record<string, unknown> {
  const redacted = redactAuditPayload(input.payload ?? {});
  const auditClassification = classification(input);

  return {
    action: input.action,
    actorId: input.actor.id ?? null,
    actorType: input.actor.type,
    approvalRef: input.refs?.approval ?? null,
    decisionRef: input.refs?.decision ?? null,
    eventType: input.eventType,
    externalRefs: input.externalRefs ?? {},
    eventCategory: auditClassification.eventCategory,
    eventDomain: auditClassification.eventDomain,
    occurredAt: input.occurredAt?.toISOString() ?? null,
    outcome: input.outcome,
    payload: redacted.value,
    policyRef: input.refs?.policy ?? null,
    reasonCode: input.reasonCode ?? null,
    redactionState: redacted.redacted ? 'redacted' : 'none',
    relatedAgentId: input.relations?.agent ?? null,
    relatedConnectionId: input.relations?.connection ?? null,
    relatedPolicyId: input.relations?.policy ?? null,
    relatedTeamId: input.relations?.team ?? null,
    relatedWalletId: input.relations?.wallet ?? null,
    relatedWalletRefId: input.relations?.walletRef ?? null,
    requestId: input.requestId ?? null,
    resourceId: input.resource?.id ?? null,
    resourceType: input.resource?.type ?? null,
    retentionClass: input.retentionClass ?? 'standard',
    severity: auditClassification.severity,
    sourceRef: input.source?.ref ?? null,
    sourceSection: input.source?.section ?? null,
    sourceSystem: input.source?.system ?? null,
    tags: auditClassification.tags,
  };
}

export async function recordAuditEvent(
  client: pg.PoolClient,
  input: RecordAuditEventInput,
): Promise<AuditEventRecord> {
  const canonicalBody = buildCanonicalBody(input);
  const canonicalBodyHash = sha256Hex(canonicalBody);

  if (input.idempotencyKey !== undefined) {
    const existing = await client.query<AuditEventRow & { canonical_body_hash: string }>(
      `SELECT ${auditEventColumns}, canonical_body_hash
         FROM audit_events
        WHERE org_id = $1 AND idempotency_key = $2
        FOR UPDATE`,
      [input.orgId, input.idempotencyKey],
    );

    if (existing.rows[0] !== undefined) {
      if (existing.rows[0].canonical_body_hash !== canonicalBodyHash) {
        throw new IdempotencyConflictError();
      }
      return toRecord(existing.rows[0]);
    }
  }

  await client.query(
    `INSERT INTO audit_event_heads (org_id, last_sequence, last_event_hash)
     VALUES ($1, 0, NULL)
     ON CONFLICT (org_id) DO NOTHING`,
    [input.orgId],
  );

  const head = await client.query<{
    readonly last_sequence: string;
    readonly last_event_hash: string | null;
  }>(
    `SELECT last_sequence, last_event_hash
       FROM audit_event_heads
      WHERE org_id = $1
      FOR UPDATE`,
    [input.orgId],
  );

  if (head.rows[0] === undefined) {
    throw new Error('audit_head_not_found');
  }

  const sequence = Number(head.rows[0].last_sequence) + 1;
  const previousHash = head.rows[0].last_event_hash;
  const eventHash = sha256Hex({
    canonicalBodyHash,
    orgId: input.orgId,
    previousHash,
    sequence: sequence.toString(),
  });
  const eventId = `aud_${randomUUID()}`;
  const occurredAt = input.occurredAt ?? new Date();
  const redactionState = canonicalBody.redactionState === 'redacted' ? 'redacted' : 'none';
  const auditClassification = classification(input);

  const inserted = await client.query<AuditEventRow>(
    `INSERT INTO audit_events (
       id,
       org_id,
       sequence,
       idempotency_key,
       event_type,
       occurred_at,
       actor_type,
       actor_id,
       action,
       outcome,
       reason_code,
       resource_type,
       resource_id,
       event_domain,
       event_category,
       severity,
       tags,
       related_agent_id,
       related_team_id,
       related_connection_id,
       related_wallet_ref_id,
       related_policy_id,
       related_wallet_id,
       request_id,
       source_section,
       source_system,
       source_ref,
       policy_ref,
       decision_ref,
       approval_ref,
       external_refs,
       retention_class,
       redaction_state,
       payload,
       canonical_body,
       canonical_body_hash,
       previous_hash,
       event_hash
     )
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
       $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
       $29,$30,$31,$32,$33,$34,$35,$36,$37,$38
     )
     RETURNING ${auditEventColumns}`,
    [
      eventId,
      input.orgId,
      sequence,
      input.idempotencyKey ?? null,
      input.eventType,
      occurredAt,
      input.actor.type,
      input.actor.id ?? null,
      input.action,
      input.outcome,
      input.reasonCode ?? null,
      input.resource?.type ?? null,
      input.resource?.id ?? null,
      auditClassification.eventDomain,
      auditClassification.eventCategory,
      auditClassification.severity,
      auditClassification.tags,
      input.relations?.agent ?? null,
      input.relations?.team ?? null,
      input.relations?.connection ?? null,
      input.relations?.walletRef ?? null,
      input.relations?.policy ?? null,
      input.relations?.wallet ?? null,
      input.requestId ?? null,
      optionalString(input.source?.section),
      optionalString(input.source?.system),
      optionalString(input.source?.ref),
      optionalString(input.refs?.policy),
      optionalString(input.refs?.decision),
      optionalString(input.refs?.approval),
      input.externalRefs ?? {},
      input.retentionClass ?? 'standard',
      redactionState,
      canonicalBody.payload,
      canonicalBody,
      canonicalBodyHash,
      previousHash,
      eventHash,
    ],
  );

  await client.query(
    `UPDATE audit_event_heads
        SET last_sequence = $2,
            last_event_hash = $3,
            updated_at = now()
      WHERE org_id = $1`,
    [input.orgId, sequence, eventHash],
  );

  const row = inserted.rows[0];
  if (row === undefined) throw new Error('audit_event_insert_failed');

  return toRecord(row);
}
