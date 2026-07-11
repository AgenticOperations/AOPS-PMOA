import type pg from 'pg';
import { createApprovalRequest, recordActivity } from '../approvals/store.js';
import { recordAuditEvent } from '../evidence/audit-writer.js';
import { badRequest, notFound } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import type { ConnectionAuthResult } from '../identity/store.js';
import type { OperatorContext } from '../identity/types.js';
import { checkPolicyDecision } from '../policy/store.js';
import type { PolicyDecisionMatch, PolicyStatement } from '../policy/types.js';
import type {
  AgentAllowedActionRecord,
  BlockedOperationRecord,
  CreateRateLimitInput,
  ImportToolInput,
  McpSessionRecord,
  OperationCheckInput,
  OperationDecisionListInput,
  OperationalAction,
  OperationalDecisionRecord,
  OperationalDecisionValue,
  OperationRecordInput,
  OperationRecordResult,
  RateLimitRecord,
  RateLimitUtilizationRecord,
  RuntimeOperationCheckInput,
  RuntimeOperationRecordInput,
  ToolCatalogRecord,
  ToolRiskLevel,
  UpdateRateLimitInput,
  UpdateToolInput,
} from './types.js';

type Db = pg.Pool | pg.PoolClient;

type AgentScope = {
  readonly agent_id: string;
  readonly team_id: string;
};

type ToolCatalogRow = {
  readonly id: string;
  readonly org_id: string;
  readonly name: string;
  readonly display_name: string;
  readonly category: string;
  readonly risk_level: ToolRiskLevel;
  readonly description: string;
  readonly source: ToolCatalogRecord['source'];
  readonly status: ToolCatalogRecord['status'];
  readonly metadata: unknown;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type OperationalDecisionRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly connection_id: string | null;
  readonly policy_decision_id: string | null;
  readonly approval_id: string | null;
  readonly action_id: OperationalAction;
  readonly decision: OperationalDecisionValue;
  readonly reason_code: string;
  readonly explanation: string;
  readonly tool_name: string | null;
  readonly tool_risk_level: string | null;
  readonly resource_label: string | null;
  readonly resource_domain: string | null;
  readonly resource_category: string | null;
  readonly context: unknown;
  readonly matched: unknown;
  readonly created_at: Date;
};

type RateLimitRow = {
  readonly id: string;
  readonly org_id: string;
  readonly target_type: RateLimitRecord['target_type'];
  readonly target_id: string;
  readonly action_id: OperationalAction;
  readonly bucket: string;
  readonly limit_count: number;
  readonly window_seconds: number;
  readonly status: RateLimitRecord['status'];
  readonly created_at: Date;
};

type RateLimitUtilizationRow = RateLimitRow & {
  readonly current_bucket: string | null;
  readonly current_count: number | null;
  readonly current_window_start: Date | null;
};

type McpSessionRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly connection_id: string;
  readonly protocol: string;
  readonly last_seen_at: Date;
  readonly created_at: Date;
};

type AgentPolicyRow = {
  readonly policy_id: string;
  readonly version: number;
  readonly name: string;
  readonly statements: unknown;
  readonly binding_target_type: RateLimitRecord['target_type'];
};

const supportedOperationalActions = new Set<OperationalAction>(['runtime.http.request', 'tool.call']);

function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function statementsFromJson(value: unknown): PolicyStatement[] {
  return Array.isArray(value) ? (value as PolicyStatement[]) : [];
}

function toolFromContext(context: Record<string, unknown>): Record<string, unknown> {
  return jsonObject(context.tool);
}

function resourceFromContext(context: Record<string, unknown>): Record<string, unknown> {
  return jsonObject(context.resource);
}

function domainFromUrl(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function normalizedContext(input: {
  readonly context?: Record<string, unknown> | undefined;
  readonly resource?: Record<string, unknown> | undefined;
  readonly tool?: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  const context = input.context ?? {};
  const resource = input.resource ?? {};
  const url = stringValue(resource.url);
  const domain = stringValue(resource.domain) ?? domainFromUrl(url);
  const normalizedResource = {
    ...resource,
    ...(url === null ? {} : { url }),
    ...(domain === null ? {} : { domain }),
  };
  return {
    ...context,
    ...(Object.keys(normalizedResource).length === 0 ? {} : { resource: normalizedResource }),
    ...(input.tool === undefined || Object.keys(input.tool).length === 0 ? {} : { tool: input.tool }),
  };
}

function validateOperationalInput(input: {
  readonly action: string;
  readonly context: Record<string, unknown>;
}): void {
  if (!supportedOperationalActions.has(input.action as OperationalAction)) {
    throw badRequest('unsupported_operational_action', 'Section 5 operations support tool calls and external API requests.');
  }

  if (input.action === 'tool.call' && stringValue(toolFromContext(input.context).name) === null) {
    throw badRequest('operation_needs_more_info', 'Tool operation checks require tool.name.');
  }

  if (input.action === 'runtime.http.request') {
    const resource = resourceFromContext(input.context);
    if (stringValue(resource.url) === null && stringValue(resource.category) === null) {
      throw badRequest('operation_needs_more_info', 'External API operation checks require resource.url or resource.category.');
    }
  }
}

function toolName(context: Record<string, unknown>): string | null {
  return stringValue(toolFromContext(context).name);
}

function toolRiskLevel(context: Record<string, unknown>): string | null {
  return stringValue(toolFromContext(context).riskLevel) ?? stringValue(toolFromContext(context).risk_level);
}

function resourceLabel(context: Record<string, unknown>): string | null {
  const resource = resourceFromContext(context);
  return stringValue(resource.url) ?? stringValue(resource.domain) ?? stringValue(resource.category);
}

function resourceDomain(context: Record<string, unknown>): string | null {
  return stringValue(resourceFromContext(context).domain);
}

function resourceCategory(context: Record<string, unknown>): string | null {
  return stringValue(resourceFromContext(context).category);
}

function operationBucket(action: OperationalAction, context: Record<string, unknown>): string {
  if (action === 'tool.call') return `tool:${toolName(context) ?? 'unknown'}`;
  const resource = resourceFromContext(context);
  return `resource:${stringValue(resource.domain) ?? stringValue(resource.category) ?? stringValue(resource.url) ?? 'unknown'}`;
}

function decisionOutcome(decision: OperationalDecisionValue): 'success' | 'denied' | 'pending' {
  if (decision === 'deny' || decision === 'rate_limited') return 'denied';
  if (decision === 'approval_required') return 'pending';
  return 'success';
}

function operationSummary(decision: OperationalDecisionValue): string {
  if (decision === 'rate_limited') return 'Operation check rate-limited';
  return `Operation check ${decision}`;
}

function operationFromRow(row: OperationalDecisionRow): OperationalDecisionRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    connection_id: row.connection_id,
    policyDecisionId: row.policy_decision_id,
    approvalId: row.approval_id,
    action: row.action_id,
    decision: row.decision,
    reasonCode: row.reason_code,
    explanation: row.explanation,
    matched: Array.isArray(row.matched) ? (row.matched as PolicyDecisionMatch[]) : [],
    tool_name: row.tool_name,
    tool_risk_level: row.tool_risk_level,
    resource_label: row.resource_label,
    resource_domain: row.resource_domain,
    resource_category: row.resource_category,
    context: jsonObject(row.context),
    created_at: row.created_at.toISOString(),
  };
}

function toolFromRow(row: ToolCatalogRow): ToolCatalogRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    display_name: row.display_name,
    category: row.category,
    risk_level: row.risk_level,
    description: row.description,
    source: row.source,
    status: row.status,
    metadata: jsonObject(row.metadata),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function rateLimitFromRow(row: RateLimitRow): RateLimitRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    target_type: row.target_type,
    target_id: row.target_id,
    action: row.action_id,
    bucket: row.bucket,
    limit: row.limit_count,
    window_seconds: row.window_seconds,
    status: row.status,
    created_at: row.created_at.toISOString(),
  };
}

function rateLimitWithUtilizationFromRow(row: RateLimitUtilizationRow): RateLimitUtilizationRecord {
  return {
    ...rateLimitFromRow(row),
    utilization: {
      current_bucket: row.current_bucket,
      current_count: row.current_count ?? 0,
      current_window_start: row.current_window_start === null ? null : row.current_window_start.toISOString(),
    },
  };
}

function mcpSessionFromRow(row: McpSessionRow): McpSessionRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    connection_id: row.connection_id,
    protocol: row.protocol,
    last_seen_at: row.last_seen_at.toISOString(),
    created_at: row.created_at.toISOString(),
  };
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

async function getAgentScope(db: Db, orgId: string, agentId: string): Promise<AgentScope> {
  const result = await db.query<AgentScope>(
    'SELECT id AS agent_id, team_id FROM agents WHERE org_id = $1 AND id = $2',
    [orgId, agentId],
  );
  const row = result.rows[0];
  if (row === undefined) throw notFound('Agent was not found.');
  return row;
}

async function assertConnectionBelongsToAgent(
  db: Db,
  orgId: string,
  agentId: string,
  connectionId: string,
): Promise<void> {
  const result = await db.query(
    'SELECT 1 FROM connections WHERE org_id = $1 AND agent_id = $2 AND id = $3 AND status = $4',
    [orgId, agentId, connectionId, 'active'],
  );
  if (result.rowCount !== 1) throw notFound('Connection was not found.');
}

function targetCandidates(input: {
  readonly orgId: string;
  readonly agentId: string;
  readonly teamId: string;
  readonly connectionId: string | null;
}): Array<{ readonly type: RateLimitRecord['target_type']; readonly id: string }> {
  const candidates: Array<{ readonly type: RateLimitRecord['target_type']; readonly id: string }> = [
    { type: 'connection', id: input.connectionId ?? '' },
    { type: 'agent', id: input.agentId },
    { type: 'team', id: input.teamId },
    { type: 'org', id: input.orgId },
  ];
  return candidates.filter((candidate) => candidate.id.length > 0);
}

async function applyRateLimit(
  pool: pg.Pool,
  input: {
    readonly action: OperationalAction;
    readonly agentId: string;
    readonly bucket: string;
    readonly connectionId: string | null;
    readonly context: Record<string, unknown>;
    readonly orgId: string;
    readonly teamId: string;
  },
): Promise<null | { readonly explanation: string; readonly reasonCode: 'operation_rate_limited' }> {
  if (input.connectionId === null) return null;
  const candidates = targetCandidates(input);
  const result = await pool.query<RateLimitRow>(
    `SELECT *
       FROM operational_rate_limits
      WHERE org_id = $1
        AND action_id = $2
        AND status = 'active'
        AND (bucket = $3 OR bucket = 'default')
        AND (target_type, target_id) IN (
          SELECT *
            FROM unnest($4::text[], $5::text[])
        )
      ORDER BY
        CASE target_type
          WHEN 'connection' THEN 1
          WHEN 'agent' THEN 2
          WHEN 'team' THEN 3
          ELSE 4
        END,
        CASE WHEN bucket = $3 THEN 1 ELSE 2 END,
        created_at ASC
      LIMIT 1`,
    [
      input.orgId,
      input.action,
      input.bucket,
      candidates.map((candidate) => candidate.type),
      candidates.map((candidate) => candidate.id),
    ],
  );
  const limit = result.rows[0];
  if (limit === undefined) return null;

  const windowMs = limit.window_seconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
  const counter = await pool.query<{ count: number }>(
    `INSERT INTO operational_rate_counters (
       org_id, rate_limit_id, agent_id, connection_id, action_id, bucket, window_start, count
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, 1)
     ON CONFLICT (rate_limit_id, agent_id, connection_id, bucket, window_start)
     DO UPDATE
        SET count = operational_rate_counters.count + 1,
            updated_at = now()
     RETURNING count`,
    [input.orgId, limit.id, input.agentId, input.connectionId, input.action, input.bucket, windowStart],
  );
  const count = counter.rows[0]?.count ?? 1;
  if (count <= limit.limit_count) return null;
  return {
    reasonCode: 'operation_rate_limited',
    explanation: `Operation exceeded ${limit.limit_count} request${limit.limit_count === 1 ? '' : 's'} per ${limit.window_seconds} seconds.`,
  };
}

async function insertOperationalDecision(
  pool: pg.Pool,
  input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly connectionId: string | null;
    readonly action: OperationalAction;
    readonly decision: OperationalDecisionValue;
    readonly reasonCode: string;
    readonly explanation: string;
    readonly context: Record<string, unknown>;
    readonly matched: readonly PolicyDecisionMatch[];
    readonly policyDecisionId: string | null;
    readonly approvalId: string | null;
  },
): Promise<OperationalDecisionRecord> {
  return withTransaction(pool, async (client) => {
    const operationId = prefixedId('opdec');
    const activity = await recordActivity(client, {
      orgId: input.orgId,
      agentId: input.agentId,
      connectionId: input.connectionId ?? undefined,
      decisionId: input.policyDecisionId ?? undefined,
      approvalId: input.approvalId ?? undefined,
      category: 'operation',
      action: 'operation.check',
      outcome: decisionOutcome(input.decision),
      summary: operationSummary(input.decision),
      payload: {
        action: input.action,
        decision: input.decision,
        reason_code: input.reasonCode,
        resource: resourceFromContext(input.context),
        tool: toolFromContext(input.context),
      },
    });
    const audit = await recordAuditEvent(client, {
      orgId: input.orgId,
      idempotencyKey: `operation.checked:${operationId}`,
      eventType: 'operation.checked',
      actor: input.connectionId === null ? { type: 'system' } : { type: 'connection', id: input.connectionId },
      action: 'operation.checked',
      outcome: decisionOutcome(input.decision),
      reasonCode: input.reasonCode,
      resource: { type: 'operational_decision', id: operationId },
      classification: {
        domain: 'policy',
        category: 'runtime',
        severity: input.decision === 'deny' || input.decision === 'rate_limited' ? 'warning' : 'info',
        tags: ['section_5', 'operation'],
      },
      relations: {
        agent: input.agentId,
        ...(input.connectionId === null ? {} : { connection: input.connectionId }),
      },
      refs: {
        ...(input.policyDecisionId === null ? {} : { decision: input.policyDecisionId }),
        ...(input.approvalId === null ? {} : { approval: input.approvalId }),
      },
      source: { section: 'section_5', system: 'operations' },
      payload: {
        action: input.action,
        decision: input.decision,
        matched: input.matched,
      },
    });
    const inserted = await client.query<OperationalDecisionRow>(
      `INSERT INTO operational_decisions (
         id, org_id, agent_id, connection_id, policy_decision_id, approval_id,
         action_id, decision, reason_code, explanation,
         tool_name, tool_risk_level, resource_label, resource_domain, resource_category,
         context, audit_event_id, activity_id
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10,
         $11, $12, $13, $14, $15,
         $16::jsonb, $17, $18
       )
       RETURNING *, $19::jsonb AS matched`,
      [
        operationId,
        input.orgId,
        input.agentId,
        input.connectionId,
        input.policyDecisionId,
        input.approvalId,
        input.action,
        input.decision,
        input.reasonCode,
        input.explanation,
        toolName(input.context),
        toolRiskLevel(input.context),
        resourceLabel(input.context),
        resourceDomain(input.context),
        resourceCategory(input.context),
        JSON.stringify(input.context),
        audit.id,
        activity.id,
        JSON.stringify(input.matched),
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error('operational_decision_insert_failed');
    return operationFromRow(row);
  });
}

export async function importTools(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  tools: readonly ImportToolInput[],
): Promise<ToolCatalogRecord[]> {
  return withTransaction(pool, async (client) => {
    const records: ToolCatalogRecord[] = [];
    for (const tool of tools) {
      const id = prefixedId('tool');
      const name = tool.name.trim();
      const inserted = await client.query<ToolCatalogRow>(
        `INSERT INTO tool_catalog (
           id, org_id, name, display_name, category, risk_level,
           description, source, status, metadata, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'import', 'active', $8::jsonb, $9)
         ON CONFLICT (org_id, name)
         DO UPDATE
            SET display_name = EXCLUDED.display_name,
                category = EXCLUDED.category,
                risk_level = EXCLUDED.risk_level,
                description = EXCLUDED.description,
                metadata = EXCLUDED.metadata,
                status = 'active',
                updated_at = now()
         RETURNING *`,
        [
          id,
          orgId,
          name,
          tool.display_name?.trim() || name,
          tool.category?.trim() || 'tool',
          tool.risk_level ?? 'medium',
          tool.description?.trim() ?? '',
          JSON.stringify(tool.metadata ?? {}),
          operator.actorId,
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error('tool_import_failed');
      records.push(toolFromRow(row));
    }
    return records;
  });
}

export async function listTools(pool: pg.Pool, orgId: string): Promise<ToolCatalogRecord[]> {
  const result = await pool.query<ToolCatalogRow>(
    `SELECT *
       FROM tool_catalog
      WHERE org_id = $1
        AND status = 'active'
      ORDER BY name ASC`,
    [orgId],
  );
  return result.rows.map(toolFromRow);
}

export async function updateTool(
  pool: pg.Pool,
  _operator: OperatorContext,
  orgId: string,
  toolId: string,
  input: UpdateToolInput,
): Promise<ToolCatalogRecord> {
  const current = await pool.query<ToolCatalogRow>('SELECT * FROM tool_catalog WHERE org_id = $1 AND id = $2', [
    orgId,
    toolId,
  ]);
  const existing = current.rows[0];
  if (existing === undefined) throw notFound('Tool was not found.');
  if (existing.status === 'archived') throw badRequest('tool_archived', 'Archived tools cannot be changed.');

  const updated = await pool.query<ToolCatalogRow>(
    `UPDATE tool_catalog
        SET display_name = $3,
            category = $4,
            risk_level = $5,
            description = $6,
            metadata = $7::jsonb,
            updated_at = now()
      WHERE org_id = $1 AND id = $2
      RETURNING *`,
    [
      orgId,
      toolId,
      input.display_name?.trim() || existing.display_name,
      input.category?.trim() || existing.category,
      input.risk_level ?? existing.risk_level,
      input.description?.trim() ?? existing.description,
      JSON.stringify(input.metadata ?? jsonObject(existing.metadata)),
    ],
  );
  const row = updated.rows[0];
  if (row === undefined) throw new Error('tool_update_failed');
  return toolFromRow(row);
}

export async function archiveTool(
  pool: pg.Pool,
  _operator: OperatorContext,
  orgId: string,
  toolId: string,
): Promise<ToolCatalogRecord> {
  const updated = await pool.query<ToolCatalogRow>(
    `UPDATE tool_catalog
        SET status = 'archived',
            updated_at = now()
      WHERE org_id = $1 AND id = $2
      RETURNING *`,
    [orgId, toolId],
  );
  const row = updated.rows[0];
  if (row === undefined) throw notFound('Tool was not found.');
  return toolFromRow(row);
}

export async function createRateLimit(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: CreateRateLimitInput,
): Promise<RateLimitRecord> {
  await assertTargetExists(pool, orgId, input.target_type, input.target_id);
  const action = await pool.query('SELECT 1 FROM policy_action_registry WHERE action_id = $1', [input.action]);
  if (action.rowCount !== 1) throw badRequest('unknown_policy_action', 'Policy action is not registered.');

  const inserted = await pool.query<RateLimitRow>(
    `INSERT INTO operational_rate_limits (
       id, org_id, target_type, target_id, action_id, bucket,
       limit_count, window_seconds, status, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
     RETURNING *`,
    [
      prefixedId('oprl'),
      orgId,
      input.target_type,
      input.target_id,
      input.action,
      input.bucket ?? 'default',
      input.limit,
      input.window_seconds,
      operator.actorId,
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('operational_rate_limit_create_failed');
  return rateLimitFromRow(row);
}

export async function listRateLimits(pool: pg.Pool, orgId: string): Promise<RateLimitUtilizationRecord[]> {
  const result = await pool.query<RateLimitUtilizationRow>(
    `SELECT rl.*,
            latest.bucket AS current_bucket,
            latest.count AS current_count,
            latest.window_start AS current_window_start
       FROM operational_rate_limits rl
       LEFT JOIN LATERAL (
         SELECT bucket, count, window_start
           FROM operational_rate_counters
          WHERE org_id = rl.org_id
            AND rate_limit_id = rl.id
          ORDER BY window_start DESC, updated_at DESC
          LIMIT 1
       ) latest ON true
      WHERE rl.org_id = $1
      ORDER BY rl.status ASC, rl.created_at DESC, rl.id DESC`,
    [orgId],
  );
  return result.rows.map(rateLimitWithUtilizationFromRow);
}

export async function updateRateLimit(
  pool: pg.Pool,
  _operator: OperatorContext,
  orgId: string,
  rateLimitId: string,
  input: UpdateRateLimitInput,
): Promise<RateLimitRecord> {
  const current = await pool.query<RateLimitRow>('SELECT * FROM operational_rate_limits WHERE org_id = $1 AND id = $2', [
    orgId,
    rateLimitId,
  ]);
  const existing = current.rows[0];
  if (existing === undefined) throw notFound('Rate limit was not found.');

  const updated = await pool.query<RateLimitRow>(
    `UPDATE operational_rate_limits
        SET bucket = $3,
            limit_count = $4,
            window_seconds = $5,
            status = $6,
            updated_at = now()
      WHERE org_id = $1 AND id = $2
      RETURNING *`,
    [
      orgId,
      rateLimitId,
      input.bucket ?? existing.bucket,
      input.limit ?? existing.limit_count,
      input.window_seconds ?? existing.window_seconds,
      input.status ?? existing.status,
    ],
  );
  const row = updated.rows[0];
  if (row === undefined) throw new Error('operational_rate_limit_update_failed');
  return rateLimitFromRow(row);
}

export async function disableRateLimit(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  rateLimitId: string,
): Promise<RateLimitRecord> {
  return updateRateLimit(pool, operator, orgId, rateLimitId, { status: 'disabled' });
}

async function assertTargetExists(
  db: Db,
  orgId: string,
  targetType: RateLimitRecord['target_type'],
  targetId: string,
): Promise<void> {
  const queries: Record<RateLimitRecord['target_type'], string> = {
    agent: 'SELECT 1 FROM agents WHERE org_id = $1 AND id = $2',
    connection: 'SELECT 1 FROM connections WHERE org_id = $1 AND id = $2',
    org: 'SELECT 1 FROM orgs WHERE id = $1 AND id = $2',
    team: 'SELECT 1 FROM teams WHERE org_id = $1 AND id = $2',
  };
  const result = await db.query(queries[targetType], [orgId, targetId]);
  if (result.rowCount !== 1) throw notFound('Operational target was not found.');
}

export async function checkOperation(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: OperationCheckInput,
): Promise<OperationalDecisionRecord> {
  const context = normalizedContext(input);
  validateOperationalInput({ action: input.action, context });
  const agent = await getAgentScope(pool, orgId, input.agent_id);
  const connectionId = input.connection_id ?? null;
  if (connectionId !== null) await assertConnectionBelongsToAgent(pool, orgId, input.agent_id, connectionId);

  const policyDecision = await checkPolicyDecision(pool, operator, orgId, {
    actor:
      connectionId === null
        ? { type: 'user', id: operator.actorId, role: operator.role }
        : { type: 'connection', id: connectionId, role: 'member' },
    action: input.action,
    target: { type: 'agent', id: input.agent_id },
    context,
  });

  const rateLimited =
    policyDecision.decision === 'allow' || policyDecision.decision === 'observe'
      ? await applyRateLimit(pool, {
          action: input.action,
          agentId: input.agent_id,
          bucket: operationBucket(input.action, context),
          connectionId,
          context,
          orgId,
          teamId: agent.team_id,
        })
      : null;
  const decision = rateLimited === null ? policyDecision.decision : 'rate_limited';
  const reasonCode = rateLimited?.reasonCode ?? policyDecision.reasonCode;
  const explanation = rateLimited?.explanation ?? policyDecision.explanation;
  const approval =
    decision === 'approval_required' && connectionId !== null
      ? await createApprovalRequest(pool, {
          orgId,
          agentId: input.agent_id,
          connectionId,
          decisionId: policyDecision.id,
          action: input.action,
          target: { type: 'agent', id: input.agent_id },
          context,
        })
      : null;

  return insertOperationalDecision(pool, {
    orgId,
    agentId: input.agent_id,
    connectionId,
    action: input.action,
    decision,
    reasonCode,
    explanation,
    context,
    matched: policyDecision.matched,
    policyDecisionId: policyDecision.id,
    approvalId: approval?.id ?? null,
  });
}

export async function checkRuntimeOperation(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  input: RuntimeOperationCheckInput,
): Promise<OperationalDecisionRecord> {
  return checkOperation(
    pool,
    { actorId: auth.connection_id, orgId: auth.org_id, role: 'member' },
    auth.org_id,
    {
      ...input,
      agent_id: auth.agent_id,
      connection_id: auth.connection_id,
    },
  );
}

export async function recordOperation(
  pool: pg.Pool,
  orgId: string,
  input: OperationRecordInput,
): Promise<OperationRecordResult> {
  const context = normalizedContext(input);
  validateOperationalInput({ action: input.action, context });
  await getAgentScope(pool, orgId, input.agent_id);
  if (input.connection_id !== undefined && input.connection_id !== null) {
    await assertConnectionBelongsToAgent(pool, orgId, input.agent_id, input.connection_id);
  }
  return {
    activity: await recordActivity(pool, {
      orgId,
      agentId: input.agent_id,
      connectionId: input.connection_id ?? undefined,
      category: 'operation',
      action: 'operation.recorded',
      outcome: input.outcome ?? 'success',
      summary: input.summary,
      payload: {
        action: input.action,
        resource: resourceFromContext(context),
        tool: toolFromContext(context),
      },
    }),
  };
}

export async function recordRuntimeOperation(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  input: RuntimeOperationRecordInput,
): Promise<OperationRecordResult> {
  return recordOperation(pool, auth.org_id, {
    ...input,
    agent_id: auth.agent_id,
    connection_id: auth.connection_id,
  });
}

export async function listBlockedOperations(
  pool: pg.Pool,
  orgId: string,
  input: { readonly agentId?: string | undefined; readonly limit?: number | undefined },
): Promise<BlockedOperationRecord[]> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);
  const result = await pool.query<OperationalDecisionRow>(
    `SELECT od.*, '[]'::jsonb AS matched
       FROM operational_decisions od
      WHERE od.org_id = $1
        AND od.decision IN ('deny', 'rate_limited')
        AND ($2::text IS NULL OR od.agent_id = $2)
      ORDER BY od.created_at DESC, od.id DESC
      LIMIT $3`,
    [orgId, input.agentId ?? null, limit],
  );
  return result.rows.map(operationFromRow) as BlockedOperationRecord[];
}

export async function listOperationDecisions(
  pool: pg.Pool,
  orgId: string,
  input: OperationDecisionListInput,
): Promise<OperationalDecisionRecord[]> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 100), 1), 200);
  const result = await pool.query<OperationalDecisionRow>(
    `SELECT od.*, '[]'::jsonb AS matched
       FROM operational_decisions od
      WHERE od.org_id = $1
        AND ($2::text IS NULL OR od.agent_id = $2)
        AND ($3::text IS NULL OR od.action_id = $3)
        AND ($4::text IS NULL OR od.decision = $4)
      ORDER BY od.created_at DESC, od.id DESC
      LIMIT $5`,
    [orgId, input.agentId ?? null, input.action ?? null, input.decision ?? null, limit],
  );
  return result.rows.map(operationFromRow);
}

export async function listMcpSessions(pool: pg.Pool, orgId: string): Promise<McpSessionRecord[]> {
  const result = await pool.query<McpSessionRow>(
    `SELECT id, org_id, agent_id, connection_id, protocol, last_seen_at, created_at
       FROM mcp_sessions
      WHERE org_id = $1
      ORDER BY last_seen_at DESC, id DESC
      LIMIT 100`,
    [orgId],
  );
  return result.rows.map(mcpSessionFromRow);
}

export async function listAgentAllowedActions(
  pool: pg.Pool,
  orgId: string,
  agentId: string,
): Promise<AgentAllowedActionRecord[]> {
  const agent = await getAgentScope(pool, orgId, agentId);
  const candidates = targetCandidates({ orgId, agentId, teamId: agent.team_id, connectionId: null });
  const policies = await pool.query<AgentPolicyRow>(
    `SELECT pv.policy_id,
            pv.version,
            pv.name,
            pv.statements,
            pb.target_type AS binding_target_type
       FROM policy_versions pv
       JOIN policy_bindings pb
         ON pb.org_id = pv.org_id
        AND pb.policy_id = pv.policy_id
        AND pb.policy_version = pv.version
      WHERE pv.org_id = $1
        AND pv.status = 'active'
        AND pb.status = 'active'
        AND (pb.target_type, pb.target_id) IN (
          SELECT *
            FROM unnest($2::text[], $3::text[])
        )
      ORDER BY
        CASE pb.target_type
          WHEN 'agent' THEN 1
          WHEN 'team' THEN 2
          ELSE 3
        END,
        pv.created_at DESC`,
    [orgId, candidates.map((candidate) => candidate.type), candidates.map((candidate) => candidate.id)],
  );

  return policies.rows.flatMap((policy) =>
    statementsFromJson(policy.statements).flatMap((statement) =>
      statement.actions
        .filter((action): action is OperationalAction => supportedOperationalActions.has(action as OperationalAction))
        .map((action) => ({
          action,
          label: labelForStatement(action, statement),
          decision: statement.decision,
          policyId: policy.policy_id,
          policyVersion: policy.version,
          policyName: policy.name,
          statementId: statement.id,
          scope: policy.binding_target_type,
        })),
    ),
  );
}

function labelForStatement(action: OperationalAction, statement: PolicyStatement): string {
  if (action === 'tool.call') {
    const names = statement.conditions?.tool?.names;
    return names !== undefined && names.length > 0 ? names.join(', ') : 'Tool call';
  }
  const resource = statement.conditions?.resource;
  if (resource?.domains !== undefined && resource.domains.length > 0) return resource.domains.join(', ');
  if (resource?.categories !== undefined && resource.categories.length > 0) return resource.categories.join(', ');
  return 'External API request';
}
