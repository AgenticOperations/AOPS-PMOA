import type pg from 'pg';
import { canonicalJson, sha256Hex } from './canonical-json.js';
import type { AuditEventRecord } from './audit-writer.js';

type AuditEventDetail = AuditEventRecord & {
  readonly payload: unknown;
  readonly canonicalBody: unknown;
};

type AuditEventQueryRow = {
  readonly id: string;
  readonly org_id: string;
  readonly sequence: string;
  readonly idempotency_key: string | null;
  readonly event_type: string;
  readonly occurred_at: Date;
  readonly recorded_at: Date;
  readonly actor_type: AuditEventRecord['actorType'];
  readonly actor_id: string | null;
  readonly action: string;
  readonly outcome: AuditEventRecord['outcome'];
  readonly reason_code: string | null;
  readonly resource_type: string | null;
  readonly resource_id: string | null;
  readonly event_domain: AuditEventRecord['eventDomain'];
  readonly event_category: AuditEventRecord['eventCategory'];
  readonly severity: AuditEventRecord['severity'];
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
  readonly retention_class: AuditEventRecord['retentionClass'];
  readonly redaction_state: AuditEventRecord['redactionState'];
  readonly payload: unknown;
  readonly canonical_body: unknown;
  readonly canonical_body_hash: string;
  readonly previous_hash: string | null;
  readonly event_hash: string;
};

const detailColumns = `
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
  payload,
  canonical_body,
  canonical_body_hash,
  previous_hash,
  event_hash
`;

export type ListAuditEventsParams = {
  readonly limit?: number;
  readonly beforeSequence?: number;
};

export type ListAuditEventsResult = {
  readonly events: AuditEventDetail[];
};

export type VerifyAuditResult = {
  readonly valid: boolean;
  readonly eventId: string;
  readonly reason?: 'not_found' | 'canonical_body_hash_mismatch' | 'event_hash_mismatch';
};

export type VerifyAuditChainResult = {
  readonly valid: boolean;
  readonly checked: number;
  readonly failedEventId?: string;
  readonly reason?:
    | 'canonical_body_hash_mismatch'
    | 'event_hash_mismatch'
    | 'previous_hash_mismatch'
    | 'event_count_mismatch'
    | 'tail_hash_mismatch';
};

function toDetail(row: AuditEventQueryRow): AuditEventDetail {
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
    payload: row.payload,
    canonicalBody: row.canonical_body,
    canonicalBodyHash: row.canonical_body_hash,
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
  };
}

function boundedLimit(limit: number | undefined): number {
  return Math.min(500, Math.max(1, Math.trunc(limit ?? 100)));
}

function expectedEventHash(event: AuditEventDetail): string {
  return sha256Hex({
    canonicalBodyHash: event.canonicalBodyHash,
    orgId: event.orgId,
    previousHash: event.previousHash,
    sequence: event.sequence.toString(),
  });
}

function verifyDetail(event: AuditEventDetail): VerifyAuditResult {
  const canonicalBodyHash = sha256Hex(canonicalJson(event.canonicalBody));
  if (canonicalBodyHash !== event.canonicalBodyHash) {
    return {
      valid: false,
      eventId: event.id,
      reason: 'canonical_body_hash_mismatch',
    };
  }

  if (expectedEventHash(event) !== event.eventHash) {
    return {
      valid: false,
      eventId: event.id,
      reason: 'event_hash_mismatch',
    };
  }

  return { valid: true, eventId: event.id };
}

export async function listAuditEvents(
  pool: pg.Pool,
  orgId: string,
  params: ListAuditEventsParams = {},
): Promise<ListAuditEventsResult> {
  const limit = boundedLimit(params.limit);
  const values: unknown[] = [orgId, limit];
  const beforeClause =
    params.beforeSequence === undefined
      ? ''
      : (() => {
          values.push(params.beforeSequence);
          return 'AND sequence < $3';
        })();

  const result = await pool.query<AuditEventQueryRow>(
    `SELECT ${detailColumns}
       FROM audit_events
      WHERE org_id = $1
      ${beforeClause}
      ORDER BY sequence DESC
      LIMIT $2`,
    values,
  );

  return { events: result.rows.map(toDetail) };
}

export async function getAuditEvent(
  pool: pg.Pool,
  orgId: string,
  eventId: string,
): Promise<AuditEventDetail | null> {
  const result = await pool.query<AuditEventQueryRow>(
    `SELECT ${detailColumns}
       FROM audit_events
      WHERE org_id = $1 AND id = $2`,
    [orgId, eventId],
  );

  const row = result.rows[0];
  return row === undefined ? null : toDetail(row);
}

export async function verifyAuditEvent(
  pool: pg.Pool,
  orgId: string,
  eventId: string,
): Promise<VerifyAuditResult> {
  const event = await getAuditEvent(pool, orgId, eventId);
  if (event === null) return { valid: false, eventId, reason: 'not_found' };
  return verifyDetail(event);
}

const VERIFY_PAGE_SIZE = 500;

/**
 * Walks the FULL chain for an org, paging internally in batches of
 * VERIFY_PAGE_SIZE and carrying previousHash across page boundaries --
 * boundedLimit correctly bounds the list endpoints, but verification must
 * never stop at a page size, only at chain exhaustion or a real mismatch.
 * After the walk, compares the final computed hash and event count against
 * audit_event_heads: without this tail check, an attacker who deletes a
 * chain's suffix and rewrites the head pointer produces a chain that
 * verifies perfectly on its own -- the truncation is only visible by
 * comparing against the independently-maintained head.
 */
export async function verifyAuditChain(
  pool: pg.Pool,
  orgId: string,
  params: ListAuditEventsParams = {},
): Promise<VerifyAuditChainResult> {
  let previousHash: string | null = null;
  let checked = 0;
  let afterSequence = 0;

  for (;;) {
    const result = await pool.query<AuditEventQueryRow>(
      `SELECT ${detailColumns}
         FROM audit_events
        WHERE org_id = $1 AND sequence > $2
        ORDER BY sequence ASC
        LIMIT $3`,
      [orgId, afterSequence, VERIFY_PAGE_SIZE],
    );
    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      const event = toDetail(row);
      checked += 1;
      afterSequence = event.sequence;

      const canonicalBodyHash = sha256Hex(canonicalJson(event.canonicalBody));
      if (canonicalBodyHash !== event.canonicalBodyHash) {
        return {
          valid: false,
          checked,
          failedEventId: event.id,
          reason: 'canonical_body_hash_mismatch',
        };
      }

      if (event.previousHash !== previousHash) {
        return {
          valid: false,
          checked,
          failedEventId: event.id,
          reason: 'previous_hash_mismatch',
        };
      }

      if (expectedEventHash(event) !== event.eventHash) {
        return {
          valid: false,
          checked,
          failedEventId: event.id,
          reason: 'event_hash_mismatch',
        };
      }

      previousHash = event.eventHash;
    }

    if (result.rows.length < VERIFY_PAGE_SIZE) break;
  }

  const head = await pool.query<{ last_sequence: string; last_event_hash: string | null }>(
    'SELECT last_sequence, last_event_hash FROM audit_event_heads WHERE org_id = $1',
    [orgId],
  );
  const headRow = head.rows[0];
  if (headRow !== undefined) {
    if (Number(headRow.last_sequence) !== checked) {
      return { valid: false, checked, reason: 'event_count_mismatch' };
    }
    if (headRow.last_event_hash !== previousHash) {
      return { valid: false, checked, reason: 'tail_hash_mismatch' };
    }
  }

  void params; // limit no longer bounds full-chain verification; kept for API compatibility.
  return { valid: true, checked };
}
