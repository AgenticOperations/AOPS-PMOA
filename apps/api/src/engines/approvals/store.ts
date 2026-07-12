import type pg from 'pg';
import { sha256Hex } from '../evidence/canonical-json.js';
import { recordAuditEvent } from '../evidence/audit-writer.js';
import { badRequest, conflict, forbidden, notFound } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import type { ConnectionAuthResult } from '../identity/store.js';
import type { OperatorContext } from '../identity/types.js';
import { checkPolicyDecision } from '../policy/store.js';
import type { PolicyDecisionRequest } from '../policy/types.js';
import type {
  ActivityCategory,
  ActivityOutcome,
  ActivityRecord,
  ApprovalActionRecord,
  ApprovalConsumptionRecord,
  ApprovalRecord,
} from './types.js';

type Db = pg.Pool | pg.PoolClient;

type ApprovalRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly connection_id: string;
  readonly decision_id: string;
  readonly status: ApprovalRecord['status'];
  readonly action_id: string;
  readonly target_type: string;
  readonly target_id: string | null;
  readonly context: unknown;
  readonly context_hash: string;
  readonly requested_by: string;
  readonly approved_by: string | null;
  readonly approved_at: Date | null;
  readonly denied_by: string | null;
  readonly denied_at: Date | null;
  readonly consumed_at: Date | null;
  readonly expires_at: Date;
  readonly note: string;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type ActivityRow = {
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
  readonly payload: unknown;
  readonly created_at: Date;
};

type ApprovalActionRow = {
  readonly id: string;
  readonly approval_id: string;
  readonly actor_type: ApprovalActionRecord['actor_type'];
  readonly actor_id: string;
  readonly action: ApprovalActionRecord['action'];
  readonly note: string;
  readonly created_at: Date;
};

type ApprovalConsumptionRow = {
  readonly id: string;
  readonly approval_id: string;
  readonly decision_id: string;
  readonly connection_id: string;
  readonly context_hash: string;
  readonly created_at: Date;
};

function objectFromJson(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function effectiveApprovalStatus(row: ApprovalRow): ApprovalRecord['status'] {
  if (row.status === 'pending' && row.expires_at.getTime() <= Date.now()) return 'expired';
  return row.status;
}

function approvalFromRow(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    connection_id: row.connection_id,
    decision_id: row.decision_id,
    status: effectiveApprovalStatus(row),
    action_id: row.action_id,
    target_type: row.target_type,
    target_id: row.target_id,
    context: objectFromJson(row.context),
    context_hash: row.context_hash,
    requested_by: row.requested_by,
    approved_by: row.approved_by,
    approved_at: row.approved_at?.toISOString() ?? null,
    denied_by: row.denied_by,
    denied_at: row.denied_at?.toISOString() ?? null,
    consumed_at: row.consumed_at?.toISOString() ?? null,
    expires_at: row.expires_at.toISOString(),
    note: row.note,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function activityFromRow(row: ActivityRow): ActivityRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    connection_id: row.connection_id,
    decision_id: row.decision_id,
    approval_id: row.approval_id,
    category: row.category,
    action: row.action,
    outcome: row.outcome,
    summary: row.summary,
    payload: objectFromJson(row.payload),
    created_at: row.created_at.toISOString(),
  };
}

function approvalActionFromRow(row: ApprovalActionRow): ApprovalActionRecord {
  return {
    id: row.id,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    action: row.action,
    note: row.note,
    created_at: row.created_at.toISOString(),
  };
}

function approvalConsumptionFromRow(row: ApprovalConsumptionRow): ApprovalConsumptionRecord {
  return {
    id: row.id,
    decision_id: row.decision_id,
    connection_id: row.connection_id,
    context_hash: row.context_hash,
    created_at: row.created_at.toISOString(),
  };
}

async function attachApprovalDetails(db: Db, orgId: string, approvals: readonly ApprovalRecord[]): Promise<ApprovalRecord[]> {
  if (approvals.length === 0) return [];

  const approvalIds = approvals.map((approval) => approval.id);
  const [actionsResult, consumptionsResult] = await Promise.all([
    db.query<ApprovalActionRow>(
      `SELECT id, approval_id, actor_type, actor_id, action, note, created_at
         FROM approval_actions
        WHERE org_id = $1
          AND approval_id = ANY($2::text[])
        ORDER BY created_at ASC, id ASC`,
      [orgId, approvalIds],
    ),
    db.query<ApprovalConsumptionRow>(
      `SELECT id, approval_id, decision_id, connection_id, context_hash, created_at
         FROM approval_consumptions
        WHERE org_id = $1
          AND approval_id = ANY($2::text[])
        ORDER BY created_at ASC, id ASC`,
      [orgId, approvalIds],
    ),
  ]);

  const actionsByApproval = new Map<string, ApprovalActionRecord[]>();
  for (const row of actionsResult.rows) {
    const current = actionsByApproval.get(row.approval_id) ?? [];
    current.push(approvalActionFromRow(row));
    actionsByApproval.set(row.approval_id, current);
  }

  const consumptionByApproval = new Map<string, ApprovalConsumptionRecord>();
  for (const row of consumptionsResult.rows) {
    consumptionByApproval.set(row.approval_id, approvalConsumptionFromRow(row));
  }

  return approvals.map((approval) => ({
    ...approval,
    actions: actionsByApproval.get(approval.id) ?? [],
    consumption: consumptionByApproval.get(approval.id) ?? null,
  }));
}

async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function approvalContextHash(input: {
  readonly action: string;
  readonly target: { readonly type: string; readonly id?: string | undefined };
  readonly context: Record<string, unknown>;
}): string {
  return sha256Hex({
    action: input.action,
    context: input.context,
    target: {
      id: input.target.id ?? null,
      type: input.target.type,
    },
  });
}

export async function recordActivity(
  db: Db,
  input: {
    readonly orgId: string;
    readonly agentId?: string | undefined;
    readonly connectionId?: string | undefined;
    readonly decisionId?: string | undefined;
    readonly approvalId?: string | undefined;
    readonly category: ActivityCategory;
    readonly action: string;
    readonly outcome: ActivityOutcome;
    readonly summary: string;
    readonly payload?: Record<string, unknown> | undefined;
  },
): Promise<ActivityRecord> {
  const id = prefixedId('act');
  const result = await db.query<ActivityRow>(
    `INSERT INTO activity_items (
       id, org_id, agent_id, connection_id, decision_id, approval_id,
       category, action, outcome, summary, payload
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     RETURNING *`,
    [
      id,
      input.orgId,
      input.agentId ?? null,
      input.connectionId ?? null,
      input.decisionId ?? null,
      input.approvalId ?? null,
      input.category,
      input.action,
      input.outcome,
      input.summary,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('activity_insert_failed');
  return activityFromRow(row);
}

export async function createApprovalRequest(
  pool: pg.Pool,
  input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly connectionId: string;
    readonly decisionId: string;
    readonly action: string;
    readonly target: { readonly type: string; readonly id?: string | undefined };
    readonly context: Record<string, unknown>;
  },
): Promise<ApprovalRecord> {
  return withTransaction(pool, async (client) => {
    const approvalId = prefixedId('apv');
    const contextHash = approvalContextHash({
      action: input.action,
      target: input.target,
      context: input.context,
    });
    const inserted = await client.query<ApprovalRow>(
      `INSERT INTO approval_requests (
         id, org_id, agent_id, connection_id, decision_id, status,
         action_id, target_type, target_id, context, context_hash,
         requested_by, expires_at
       )
       VALUES (
         $1, $2, $3, $4, $5, 'pending',
         $6, $7, $8, $9::jsonb, $10,
         $4, now() + interval '15 minutes'
       )
       RETURNING *`,
      [
        approvalId,
        input.orgId,
        input.agentId,
        input.connectionId,
        input.decisionId,
        input.action,
        input.target.type,
        input.target.id ?? null,
        JSON.stringify(input.context),
        contextHash,
      ],
    );

    await client.query(
      `INSERT INTO approval_actions (id, org_id, approval_id, actor_type, actor_id, action)
       VALUES ($1, $2, $3, 'connection', $4, 'requested')`,
      [prefixedId('apact'), input.orgId, approvalId, input.connectionId],
    );

    await recordActivity(client, {
      orgId: input.orgId,
      agentId: input.agentId,
      connectionId: input.connectionId,
      decisionId: input.decisionId,
      approvalId,
      category: 'approval',
      action: 'approval.requested',
      outcome: 'pending',
      summary: 'Approval requested',
      payload: { action: input.action, target: input.target },
    });

    await recordAuditEvent(client, {
      orgId: input.orgId,
      idempotencyKey: `approval.requested:${approvalId}`,
      eventType: 'approval.requested',
      actor: { type: 'connection', id: input.connectionId },
      action: 'approval.requested',
      outcome: 'pending',
      resource: { type: 'approval', id: approvalId },
      classification: {
        domain: 'policy',
        category: 'runtime',
        severity: 'info',
        tags: ['section_3', 'approval', 'runtime'],
      },
      relations: { agent: input.agentId, connection: input.connectionId },
      refs: { decision: input.decisionId, approval: approvalId },
      source: { section: 'section_3', system: 'approvals' },
      payload: {
        action: input.action,
        context_hash: contextHash,
        target_id: input.target.id ?? null,
        target_type: input.target.type,
      },
    });

    const row = inserted.rows[0];
    if (row === undefined) throw new Error('approval_create_failed');
    return approvalFromRow(row);
  });
}

export async function approveApproval(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  approvalId: string,
  note: string,
): Promise<ApprovalRecord> {
  return withTransaction(pool, async (client) => {
    const updated = await client.query<ApprovalRow>(
      `UPDATE approval_requests
          SET status = 'approved',
              approved_by = $3,
              approved_at = now(),
              note = $4,
              updated_at = now()
        WHERE org_id = $1
          AND id = $2
          AND status = 'pending'
          AND expires_at > now()
        RETURNING *`,
      [orgId, approvalId, operator.actorId, note],
    );
    const row = updated.rows[0];
    if (row === undefined) throw conflict('approval_not_pending', 'Approval is not pending or has expired.');

    await client.query(
      `INSERT INTO approval_actions (id, org_id, approval_id, actor_type, actor_id, action, note)
       VALUES ($1, $2, $3, 'user', $4, 'approved', $5)`,
      [prefixedId('apact'), orgId, approvalId, operator.actorId, note],
    );

    await recordActivity(client, {
      orgId,
      agentId: row.agent_id,
      connectionId: row.connection_id,
      decisionId: row.decision_id,
      approvalId,
      category: 'approval',
      action: 'approval.approved',
      outcome: 'success',
      summary: 'Approval granted',
      payload: { note },
    });

    await recordAuditEvent(client, {
      orgId,
      idempotencyKey: `approval.approved:${approvalId}`,
      eventType: 'approval.approved',
      actor: { type: 'user', id: operator.actorId },
      action: 'approval.approved',
      outcome: 'success',
      resource: { type: 'approval', id: approvalId },
      classification: {
        domain: 'policy',
        category: 'runtime',
        severity: 'info',
        tags: ['section_3', 'approval'],
      },
      relations: { agent: row.agent_id, connection: row.connection_id },
      refs: { decision: row.decision_id, approval: approvalId },
      source: { section: 'section_3', system: 'approvals' },
      payload: { note },
    });

    return approvalFromRow(row);
  });
}

export async function denyApproval(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  approvalId: string,
  note: string,
): Promise<ApprovalRecord> {
  return withTransaction(pool, async (client) => {
    const updated = await client.query<ApprovalRow>(
      `UPDATE approval_requests
          SET status = 'denied',
              denied_by = $3,
              denied_at = now(),
              note = $4,
              updated_at = now()
        WHERE org_id = $1
          AND id = $2
          AND status = 'pending'
          AND expires_at > now()
        RETURNING *`,
      [orgId, approvalId, operator.actorId, note],
    );
    const row = updated.rows[0];
    if (row === undefined) throw conflict('approval_not_pending', 'Approval is not pending or has expired.');
    await client.query(
      `INSERT INTO approval_actions (id, org_id, approval_id, actor_type, actor_id, action, note)
       VALUES ($1, $2, $3, 'user', $4, 'denied', $5)`,
      [prefixedId('apact'), orgId, approvalId, operator.actorId, note],
    );

    await recordActivity(client, {
      orgId,
      agentId: row.agent_id,
      connectionId: row.connection_id,
      decisionId: row.decision_id,
      approvalId,
      category: 'approval',
      action: 'approval.denied',
      outcome: 'denied',
      summary: 'Approval denied',
      payload: { note },
    });

    await recordAuditEvent(client, {
      orgId,
      idempotencyKey: `approval.denied:${approvalId}`,
      eventType: 'approval.denied',
      actor: { type: 'user', id: operator.actorId },
      action: 'approval.denied',
      outcome: 'denied',
      resource: { type: 'approval', id: approvalId },
      classification: {
        domain: 'policy',
        category: 'runtime',
        severity: 'info',
        tags: ['section_3', 'approval'],
      },
      relations: { agent: row.agent_id, connection: row.connection_id },
      refs: { decision: row.decision_id, approval: approvalId },
      source: { section: 'section_3', system: 'approvals' },
      payload: { note },
    });
    return approvalFromRow(row);
  });
}

export async function getApproval(pool: pg.Pool, orgId: string, approvalId: string): Promise<ApprovalRecord> {
  const result = await pool.query<ApprovalRow>('SELECT * FROM approval_requests WHERE org_id = $1 AND id = $2', [
    orgId,
    approvalId,
  ]);
  const row = result.rows[0];
  if (row === undefined) throw notFound('Approval was not found.');
  const [approval] = await attachApprovalDetails(pool, orgId, [approvalFromRow(row)]);
  if (approval === undefined) throw notFound('Approval was not found.');
  return approval;
}

export async function listApprovals(pool: pg.Pool, orgId: string): Promise<ApprovalRecord[]> {
  const result = await pool.query<ApprovalRow>(
    `SELECT *
       FROM approval_requests
      WHERE org_id = $1
      ORDER BY created_at DESC, id DESC`,
    [orgId],
  );
  return attachApprovalDetails(pool, orgId, result.rows.map(approvalFromRow));
}

export async function consumeApproval(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  approvalId: string,
  decisionId: string,
): Promise<ApprovalRecord> {
  const approval = await getApproval(pool, auth.org_id, approvalId);
  if (approval.connection_id !== auth.connection_id || approval.agent_id !== auth.agent_id) {
    throw forbidden('Approval does not belong to this agent connection.');
  }
  if (approval.decision_id !== decisionId) {
    throw badRequest('approval_decision_mismatch', 'Approval does not match the supplied decision.');
  }
  if (approval.status !== 'approved') {
    throw conflict('approval_not_approved', 'Approval must be approved before it can be consumed.');
  }
  if (new Date(approval.expires_at).getTime() <= Date.now()) {
    throw conflict('approval_expired', 'Approval has expired.');
  }

  const recheck = await checkPolicyDecision(
    pool,
    { actorId: auth.connection_id, role: 'member', orgId: auth.org_id },
    auth.org_id,
    {
      actor: { type: 'connection', id: auth.connection_id },
      action: approval.action_id,
      target: { type: approval.target_type as PolicyDecisionRequest['target']['type'], id: approval.target_id ?? undefined },
      context: approval.context,
    },
  );
  if (recheck.decision === 'deny') {
    throw forbidden('Approval can no longer be consumed because current policy denies the action.');
  }

  return withTransaction(pool, async (client) => {
    const updated = await client.query<ApprovalRow>(
      `UPDATE approval_requests
          SET status = 'consumed',
              consumed_at = now(),
              updated_at = now()
        WHERE org_id = $1
          AND id = $2
          AND status = 'approved'
        RETURNING *`,
      [auth.org_id, approvalId],
    );
    const row = updated.rows[0];
    if (row === undefined) throw conflict('approval_not_approved', 'Approval was already consumed or changed.');

    await client.query(
      `INSERT INTO approval_consumptions (id, org_id, approval_id, decision_id, connection_id, context_hash)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [prefixedId('apcons'), auth.org_id, approvalId, decisionId, auth.connection_id, approval.context_hash],
    );
    await client.query(
      `INSERT INTO approval_actions (id, org_id, approval_id, actor_type, actor_id, action)
       VALUES ($1, $2, $3, 'connection', $4, 'consumed')`,
      [prefixedId('apact'), auth.org_id, approvalId, auth.connection_id],
    );

    await recordActivity(client, {
      orgId: auth.org_id,
      agentId: auth.agent_id,
      connectionId: auth.connection_id,
      decisionId,
      approvalId,
      category: 'approval',
      action: 'approval.consumed',
      outcome: 'success',
      summary: 'Approval consumed',
      payload: { recheck_decision_id: recheck.id },
    });

    await recordAuditEvent(client, {
      orgId: auth.org_id,
      idempotencyKey: `approval.consumed:${approvalId}`,
      eventType: 'approval.consumed',
      actor: { type: 'connection', id: auth.connection_id },
      action: 'approval.consumed',
      outcome: 'success',
      resource: { type: 'approval', id: approvalId },
      classification: {
        domain: 'policy',
        category: 'runtime',
        severity: 'info',
        tags: ['section_3', 'approval', 'runtime'],
      },
      relations: { agent: auth.agent_id, connection: auth.connection_id },
      refs: { decision: decisionId, approval: approvalId },
      source: { section: 'section_3', system: 'approvals' },
      payload: { recheck_decision_id: recheck.id },
    });

    return approvalFromRow(row);
  });
}
