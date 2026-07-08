import type pg from 'pg';
import { recordAuditEvent } from '../evidence/audit-writer.js';
import { IdentityError, badRequest, notFound } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import type { OperatorContext } from '../identity/types.js';
import { evaluatePolicyDecision } from './decision-engine.js';
import type {
  AgentPolicyAssignment,
  AgentPolicyBindingScope,
  CreatePolicyDraftInput,
  EffectivePolicy,
  PolicyBindingRecord,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyDraftRecord,
  PolicyStatement,
  PolicyValidationResult,
  PolicyVersionRecord,
} from './types.js';
import { validatePolicyStatements } from './validator.js';

type Db = pg.Pool | pg.PoolClient;

type PolicyDraftRow = {
  readonly id: string;
  readonly org_id: string;
  readonly source: PolicyDraftRecord['source'];
  readonly name: string;
  readonly description: string;
  readonly category: PolicyDraftRecord['category'];
  readonly status: PolicyDraftRecord['status'];
  readonly statements: unknown;
  readonly validation: unknown;
  readonly created_by: string;
  readonly updated_by: string;
  readonly activated_policy_id: string | null;
  readonly activated_version: number | null;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type PolicyVersionRow = {
  readonly policy_id: string;
  readonly version: number;
  readonly org_id: string;
  readonly draft_id: string | null;
  readonly name: string;
  readonly description: string;
  readonly category: PolicyVersionRecord['category'];
  readonly status: PolicyVersionRecord['status'];
  readonly statements: unknown;
  readonly validation: unknown;
  readonly change_reason: string;
  readonly created_by: string;
  readonly created_at: Date;
  readonly bindings_count: string | null;
};

type PolicyBindingRow = {
  readonly id: string;
  readonly org_id: string;
  readonly policy_id: string;
  readonly policy_version: number;
  readonly target_type: PolicyBindingRecord['target_type'];
  readonly target_id: string;
  readonly status: PolicyBindingRecord['status'];
  readonly created_by: string;
  readonly created_at: Date;
};

type PolicyAssignmentRow = PolicyVersionRow & {
  readonly binding_id: string;
  readonly binding_target_type: PolicyBindingRecord['target_type'];
  readonly binding_target_id: string;
  readonly binding_target_label: string;
};

export type RecordedDecision = PolicyDecisionResult & {
  readonly id: string;
};

function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function statementsFromJson(value: unknown): PolicyStatement[] {
  return Array.isArray(value) ? (value as PolicyStatement[]) : [];
}

function validationFromJson(value: unknown): PolicyValidationResult {
  const object = jsonObject(value);
  return {
    valid: object.valid === true,
    errors: Array.isArray(object.errors) ? object.errors.filter((item): item is string => typeof item === 'string') : [],
    warnings: Array.isArray(object.warnings)
      ? object.warnings.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function draftFromRow(row: PolicyDraftRow): PolicyDraftRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    source: row.source,
    name: row.name,
    description: row.description,
    category: row.category,
    status: row.status,
    statements: statementsFromJson(row.statements),
    validation: validationFromJson(row.validation),
    created_by: row.created_by,
    updated_by: row.updated_by,
    activated_policy_id: row.activated_policy_id,
    activated_version: row.activated_version,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function versionFromRow(row: PolicyVersionRow): PolicyVersionRecord {
  const statements = statementsFromJson(row.statements);
  return {
    id: row.policy_id,
    version: row.version,
    org_id: row.org_id,
    draft_id: row.draft_id,
    name: row.name,
    description: row.description,
    category: row.category,
    status: row.status,
    statements,
    validation: validationFromJson(row.validation),
    change_reason: row.change_reason,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    binding_target_types: bindingTargetTypesForStatements(statements),
    bindings: [],
    bindings_count: Number(row.bindings_count ?? 0),
  };
}

function bindingFromRow(row: PolicyBindingRow): PolicyBindingRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    policy_id: row.policy_id,
    policy_version: row.policy_version,
    target_type: row.target_type,
    target_id: row.target_id,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
  };
}

const targetTypeOrder: PolicyBindingRecord['target_type'][] = ['org', 'team', 'agent', 'connection'];

function bindingTargetTypesForAction(action: string): PolicyBindingRecord['target_type'][] {
  if (action === '*') return targetTypeOrder;
  if (action === 'management.connection.rotate' || action === 'management.connection.revoke') return ['connection'];
  if (action === 'management.agent.create') return ['org', 'team'];
  return ['org', 'team', 'agent'];
}

function bindingTargetTypesForStatements(statements: readonly PolicyStatement[]): PolicyBindingRecord['target_type'][] {
  const allowed = new Set<PolicyBindingRecord['target_type']>();
  for (const statement of statements) {
    for (const action of statement.actions) {
      for (const targetType of bindingTargetTypesForAction(action)) {
        allowed.add(targetType);
      }
    }
  }
  return targetTypeOrder.filter((targetType) => allowed.has(targetType));
}

function assertBindingTargetTypeAllowed(
  statements: readonly PolicyStatement[],
  input: { readonly target_type: PolicyBindingRecord['target_type'] },
): void {
  const allowedTypes = bindingTargetTypesForStatements(statements);
  if (!allowedTypes.includes(input.target_type)) {
    throw badRequest(
      'invalid_policy_binding_target',
      `This policy cannot be bound to a ${input.target_type} target.`,
    );
  }
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

async function knownActions(db: Db): Promise<Set<string>> {
  const result = await db.query<{ action_id: string }>('SELECT action_id FROM policy_action_registry');
  return new Set(result.rows.map((row) => row.action_id));
}

async function validateStatements(db: Db, statements: readonly PolicyStatement[]): Promise<PolicyValidationResult> {
  return validatePolicyStatements({
    knownActions: await knownActions(db),
    statements,
  });
}

async function assertBindingTargetExists(
  db: Db,
  orgId: string,
  input: {
    readonly target_type: PolicyBindingRecord['target_type'];
    readonly target_id: string;
  },
): Promise<void> {
  const queryByTargetType: Record<PolicyBindingRecord['target_type'], string> = {
    agent: 'SELECT 1 FROM agents WHERE org_id = $1 AND id = $2',
    connection: 'SELECT 1 FROM connections WHERE org_id = $1 AND id = $2',
    org: 'SELECT 1 FROM orgs WHERE id = $1 AND id = $2',
    team: 'SELECT 1 FROM teams WHERE org_id = $1 AND id = $2',
  };

  const result = await db.query(queryByTargetType[input.target_type], [orgId, input.target_id]);
  if (result.rowCount !== 1) throw notFound('Policy binding target was not found.');
}

async function recordPolicyEvent(
  client: pg.PoolClient,
  input: {
    readonly orgId: string;
    readonly operator: OperatorContext;
    readonly action: string;
    readonly resource: { readonly type: string; readonly id: string };
    readonly policyId?: string | undefined;
    readonly outcome?: 'success' | 'denied' | 'error' | 'pending' | undefined;
    readonly reasonCode?: string | undefined;
    readonly payload?: Record<string, unknown> | undefined;
  },
) {
  return recordAuditEvent(client, {
    orgId: input.orgId,
    idempotencyKey: `${input.action}:${input.resource.id}:${prefixedId('idem')}`,
    eventType: input.action,
    actor: { type: 'user', id: input.operator.actorId },
    action: input.action,
    outcome: input.outcome ?? 'success',
    resource: input.resource,
    classification: {
      domain: 'policy',
      category: 'policy',
      severity: input.outcome === 'denied' ? 'warning' : 'info',
      tags: ['section_2', 'policy'],
    },
    source: { section: 'section_2', system: 'policy' },
    payload: input.payload ?? {},
    ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
    ...(input.policyId === undefined ? {} : { relations: { policy: input.policyId } }),
  });
}

export async function createPolicyDraft(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: CreatePolicyDraftInput,
): Promise<PolicyDraftRecord> {
  return withTransaction(pool, async (client) => {
    const draftId = prefixedId('pdraft');
    const validation = {
      valid: false,
      errors: [],
      warnings: ['Draft has not been validated yet.'],
    } satisfies PolicyValidationResult;
    const inserted = await client.query<PolicyDraftRow>(
      `INSERT INTO policy_drafts (
         id, org_id, source, name, description, category, status,
         statements, validation, created_by, updated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7::jsonb, $8::jsonb, $9, $9)
       RETURNING *`,
      [
        draftId,
        orgId,
        input.source,
        input.name,
        input.description ?? '',
        input.category,
        JSON.stringify(input.statements),
        JSON.stringify(validation),
        operator.actorId,
      ],
    );

    await recordPolicyEvent(client, {
      orgId,
      operator,
      action: 'policy.draft.created',
      resource: { type: 'policy_draft', id: draftId },
      payload: { name: input.name, category: input.category, statements_count: input.statements.length },
    });

    const row = inserted.rows[0];
    if (row === undefined) throw new Error('policy_draft_create_failed');
    return draftFromRow(row);
  });
}

export async function validatePolicyDraft(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  draftId: string,
): Promise<{ readonly draft: PolicyDraftRecord; readonly validation: PolicyValidationResult }> {
  return withTransaction(pool, async (client) => {
    const current = await client.query<PolicyDraftRow>(
      `SELECT *
         FROM policy_drafts
        WHERE org_id = $1 AND id = $2
        FOR UPDATE`,
      [orgId, draftId],
    );
    const row = current.rows[0];
    if (row === undefined) throw notFound('Policy draft was not found.');
    if (row.status === 'activated' || row.status === 'discarded') {
      throw badRequest('policy_draft_locked', 'Policy draft can no longer be changed.');
    }

    const validation = await validateStatements(client, statementsFromJson(row.statements));
    const updated = await client.query<PolicyDraftRow>(
      `UPDATE policy_drafts
          SET status = $3,
              validation = $4::jsonb,
              updated_by = $5,
              updated_at = now()
        WHERE org_id = $1 AND id = $2
        RETURNING *`,
      [orgId, draftId, validation.valid ? 'validated' : 'draft', JSON.stringify(validation), operator.actorId],
    );

    await recordPolicyEvent(client, {
      orgId,
      operator,
      action: 'policy.validated',
      resource: { type: 'policy_draft', id: draftId },
      outcome: validation.valid ? 'success' : 'error',
      reasonCode: validation.valid ? undefined : 'policy_validation_failed',
      payload: validation,
    });

    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) throw new Error('policy_draft_validate_failed');
    return { draft: draftFromRow(updatedRow), validation };
  });
}

export async function activatePolicyDraft(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  draftId: string,
  input: { readonly change_reason?: string | undefined },
): Promise<PolicyVersionRecord> {
  return withTransaction(pool, async (client) => {
    const current = await client.query<PolicyDraftRow>(
      `SELECT *
         FROM policy_drafts
        WHERE org_id = $1 AND id = $2
        FOR UPDATE`,
      [orgId, draftId],
    );
    const draftRow = current.rows[0];
    if (draftRow === undefined) throw notFound('Policy draft was not found.');
    const draft = draftFromRow(draftRow);
    const validation = await validateStatements(client, draft.statements);
    if (!validation.valid) {
      throw badRequest('policy_validation_failed', 'Policy draft must validate before activation.');
    }

    const policyId = prefixedId('pol');
    const version = 1;
    const inserted = await client.query<PolicyVersionRow>(
      `INSERT INTO policy_versions (
         policy_id, version, org_id, draft_id, name, description, category, status,
         statements, validation, change_reason, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8::jsonb, $9::jsonb, $10, $11)
       RETURNING *, '0'::text AS bindings_count`,
      [
        policyId,
        version,
        orgId,
        draftId,
        draft.name,
        draft.description,
        draft.category,
        JSON.stringify(draft.statements),
        JSON.stringify(validation),
        input.change_reason ?? '',
        operator.actorId,
      ],
    );

    await client.query(
      `UPDATE policy_drafts
          SET status = 'activated',
              validation = $3::jsonb,
              activated_policy_id = $4,
              activated_version = $5,
              updated_by = $6,
              updated_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, draftId, JSON.stringify(validation), policyId, version, operator.actorId],
    );

    await recordPolicyEvent(client, {
      orgId,
      operator,
      action: 'policy.activated',
      resource: { type: 'policy', id: policyId },
      policyId,
      payload: { draft_id: draftId, version, change_reason: input.change_reason ?? '' },
    });

    const row = inserted.rows[0];
    if (row === undefined) throw new Error('policy_activation_failed');
    return versionFromRow(row);
  });
}

export async function bindPolicy(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  policyId: string,
  input: {
    readonly policy_version: number;
    readonly target_type: PolicyBindingRecord['target_type'];
    readonly target_id: string;
  },
): Promise<PolicyBindingRecord> {
  return withTransaction(pool, async (client) => {
    const policy = await client.query<{ readonly statements: unknown }>(
      `SELECT statements
         FROM policy_versions
        WHERE org_id = $1
          AND policy_id = $2
          AND version = $3
          AND status = 'active'`,
      [orgId, policyId, input.policy_version],
    );
    const policyRow = policy.rows[0];
    if (policyRow === undefined) throw notFound('Active policy version was not found.');
    assertBindingTargetTypeAllowed(statementsFromJson(policyRow.statements), input);
    await assertBindingTargetExists(client, orgId, input);

    const bindingId = prefixedId('pbind');
    const inserted = await client.query<PolicyBindingRow>(
      `INSERT INTO policy_bindings (
         id, org_id, policy_id, policy_version, target_type, target_id, status, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
       RETURNING *`,
      [bindingId, orgId, policyId, input.policy_version, input.target_type, input.target_id, operator.actorId],
    );

    await recordPolicyEvent(client, {
      orgId,
      operator,
      action: 'policy.bound',
      resource: { type: 'policy_binding', id: bindingId },
      policyId,
      payload: {
        policy_version: input.policy_version,
        target_type: input.target_type,
        target_id: input.target_id,
      },
    });

    const row = inserted.rows[0];
    if (row === undefined) throw new Error('policy_bind_failed');
    return bindingFromRow(row);
  });
}

export async function listPolicyLibrary(pool: pg.Pool, orgId: string): Promise<{
  readonly drafts: PolicyDraftRecord[];
  readonly policies: PolicyVersionRecord[];
}> {
  const drafts = await pool.query<PolicyDraftRow>(
    `SELECT *
       FROM policy_drafts
      WHERE org_id = $1
      ORDER BY updated_at DESC, id DESC`,
    [orgId],
  );

  const policies = await pool.query<PolicyVersionRow>(
    `SELECT pv.*,
            COALESCE(count(pb.id) FILTER (WHERE pb.status = 'active'), 0)::text AS bindings_count
       FROM policy_versions pv
       LEFT JOIN policy_bindings pb
         ON pb.org_id = pv.org_id
        AND pb.policy_id = pv.policy_id
        AND pb.policy_version = pv.version
      WHERE pv.org_id = $1
      GROUP BY pv.policy_id, pv.version
      ORDER BY pv.created_at DESC, pv.policy_id DESC`,
    [orgId],
  );

  const bindings = await pool.query<PolicyBindingRow>(
    `SELECT *
       FROM policy_bindings
      WHERE org_id = $1
        AND status = 'active'
      ORDER BY created_at ASC, id ASC`,
    [orgId],
  );
  const bindingsByPolicyVersion = new Map<string, PolicyBindingRecord[]>();
  for (const binding of bindings.rows.map(bindingFromRow)) {
    const key = `${binding.policy_id}:${binding.policy_version}`;
    const existing = bindingsByPolicyVersion.get(key) ?? [];
    existing.push(binding);
    bindingsByPolicyVersion.set(key, existing);
  }

  return {
    drafts: drafts.rows.map(draftFromRow),
    policies: policies.rows.map((row) => {
      const policy = versionFromRow(row);
      const activeBindings = bindingsByPolicyVersion.get(`${policy.id}:${policy.version}`) ?? [];
      return {
        ...policy,
        bindings: activeBindings,
        bindings_count: activeBindings.length,
      };
    }),
  };
}

async function targetBindingCandidates(
  db: Db,
  orgId: string,
  target: PolicyDecisionRequest['target'],
): Promise<Array<{ readonly type: string; readonly id: string }>> {
  const candidates = [{ type: 'org', id: orgId }];

  if (target.type === 'org') return candidates;
  if (target.id === undefined) return candidates;

  if (target.type === 'team') {
    candidates.push({ type: 'team', id: target.id });
    return candidates;
  }

  if (target.type === 'agent') {
    const result = await db.query<{ team_id: string }>(
      'SELECT team_id FROM agents WHERE org_id = $1 AND id = $2',
      [orgId, target.id],
    );
    const agent = result.rows[0];
    if (agent === undefined) return candidates;
    candidates.push({ type: 'team', id: agent.team_id }, { type: 'agent', id: target.id });
    return candidates;
  }

  const result = await db.query<{ agent_id: string; team_id: string }>(
    `SELECT c.agent_id, a.team_id
       FROM connections c
       JOIN agents a ON a.org_id = c.org_id AND a.id = c.agent_id
      WHERE c.org_id = $1 AND c.id = $2`,
    [orgId, target.id],
  );
  const connection = result.rows[0];
  if (connection === undefined) return candidates;
  candidates.push(
    { type: 'team', id: connection.team_id },
    { type: 'agent', id: connection.agent_id },
    { type: 'connection', id: target.id },
  );
  return candidates;
}

async function agentPolicyBindingCandidates(
  db: Db,
  orgId: string,
  agentId: string,
): Promise<Array<{
  readonly id: string;
  readonly label: string;
  readonly scope: AgentPolicyBindingScope;
  readonly type: PolicyBindingRecord['target_type'];
}>> {
  const agentResult = await db.query<{
    readonly agent_name: string;
    readonly org_name: string;
    readonly team_id: string;
    readonly team_name: string;
  }>(
    `SELECT a.name AS agent_name,
            o.display_name AS org_name,
            t.id AS team_id,
            t.name AS team_name
       FROM agents a
       JOIN orgs o ON o.id = a.org_id
       JOIN teams t ON t.org_id = a.org_id AND t.id = a.team_id
      WHERE a.org_id = $1 AND a.id = $2`,
    [orgId, agentId],
  );
  const agent = agentResult.rows[0];
  if (agent === undefined) throw notFound('Agent was not found.');

  const connections = await db.query<{ readonly id: string; readonly name: string }>(
    `SELECT id, name
       FROM connections
      WHERE org_id = $1
        AND agent_id = $2
        AND status = 'active'
      ORDER BY created_at ASC, id ASC`,
    [orgId, agentId],
  );

  return [
    { id: orgId, label: agent.org_name, scope: 'workspace', type: 'org' },
    { id: agent.team_id, label: agent.team_name, scope: 'team', type: 'team' },
    { id: agentId, label: agent.agent_name, scope: 'direct', type: 'agent' },
    ...connections.rows.map((connection) => ({
      id: connection.id,
      label: connection.name,
      scope: 'credential' as const,
      type: 'connection' as const,
    })),
  ];
}

export async function listAgentEffectivePolicies(
  pool: pg.Pool,
  orgId: string,
  agentId: string,
): Promise<{ readonly policies: AgentPolicyAssignment[] }> {
  const candidates = await agentPolicyBindingCandidates(pool, orgId, agentId);
  const candidateKeyByTypeId = new Map(
    candidates.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate]),
  );

  const result = await pool.query<PolicyAssignmentRow>(
    `SELECT pv.*,
            '0'::text AS bindings_count,
            pb.id AS binding_id,
            pb.target_type AS binding_target_type,
            pb.target_id AS binding_target_id,
            ''::text AS binding_target_label
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
          WHEN 'connection' THEN 2
          WHEN 'team' THEN 3
          ELSE 4
        END,
        pv.created_at DESC,
        pv.policy_id DESC`,
    [orgId, candidates.map((candidate) => candidate.type), candidates.map((candidate) => candidate.id)],
  );

  return {
    policies: result.rows.map((row) => {
      const candidate = candidateKeyByTypeId.get(`${row.binding_target_type}:${row.binding_target_id}`);
      return {
        id: row.policy_id,
        version: row.version,
        name: row.name,
        description: row.description,
        category: row.category,
        binding: {
          id: row.binding_id,
          scope: candidate?.scope ?? 'direct',
          target_type: row.binding_target_type,
          target_id: row.binding_target_id,
          target_label: candidate?.label ?? row.binding_target_id,
        },
      };
    }),
  };
}

async function effectivePoliciesForRequest(
  db: Db,
  orgId: string,
  request: PolicyDecisionRequest,
): Promise<EffectivePolicy[]> {
  const candidates = await targetBindingCandidates(db, orgId, request.target);
  const result = await db.query<{
    readonly policy_id: string;
    readonly version: number;
    readonly name: string;
    readonly statements: unknown;
  }>(
    `SELECT DISTINCT ON (pv.policy_id, pv.version)
            pv.policy_id,
            pv.version,
            pv.name,
            pv.statements
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
      ORDER BY pv.policy_id, pv.version, pb.created_at ASC`,
    [orgId, candidates.map((candidate) => candidate.type), candidates.map((candidate) => candidate.id)],
  );

  return result.rows.map((row) => ({
    policyId: row.policy_id,
    version: row.version,
    name: row.name,
    statements: statementsFromJson(row.statements),
  }));
}

function decisionOutcome(decision: PolicyDecisionResult['decision']): 'success' | 'denied' | 'pending' {
  if (decision === 'deny') return 'denied';
  if (decision === 'approval_required') return 'pending';
  return 'success';
}

function decisionRelations(request: PolicyDecisionRequest): { readonly agent?: string; readonly connection?: string } | undefined {
  if (request.target.id === undefined) return undefined;
  if (request.target.type === 'agent') return { agent: request.target.id };
  if (request.target.type === 'connection') return { connection: request.target.id };
  return undefined;
}

function auditActorFromRequest(
  operator: OperatorContext,
  request: PolicyDecisionRequest,
): { readonly type: 'user' | 'agent' | 'connection' | 'system'; readonly id?: string } {
  return {
    type: request.actor.type,
    id: request.actor.id ?? operator.actorId,
  };
}

export async function checkPolicyDecision(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  request: PolicyDecisionRequest,
): Promise<RecordedDecision> {
  return withTransaction(pool, async (client) => {
    const action = await client.query('SELECT 1 FROM policy_action_registry WHERE action_id = $1', [request.action]);
    if (action.rowCount !== 1) {
      throw badRequest('unknown_policy_action', 'Policy action is not registered.');
    }

    const result = evaluatePolicyDecision({
      request,
      policies: await effectivePoliciesForRequest(client, orgId, request),
    });
    const decisionId = prefixedId('pdec');
    const relations = decisionRelations(request);
    const audit = await recordAuditEvent(client, {
      orgId,
      idempotencyKey: `policy.decision.recorded:${decisionId}`,
      eventType: 'policy.decision.recorded',
      actor: auditActorFromRequest(operator, request),
      action: 'policy.decision.recorded',
      outcome: decisionOutcome(result.decision),
      reasonCode: result.reasonCode,
      resource: { type: 'policy_decision', id: decisionId },
      classification: {
        domain: 'policy',
        category: 'policy',
        severity: result.decision === 'deny' ? 'warning' : 'info',
        tags: ['section_2', 'policy', 'decision'],
      },
      source: { section: 'section_2', system: 'policy' },
      refs: { decision: decisionId },
      payload: {
        action: request.action,
        target_type: request.target.type,
        target_id: request.target.id ?? null,
        decision: result.decision,
        matched: result.matched,
      },
      ...(relations === undefined ? {} : { relations }),
    });

    await client.query(
      `INSERT INTO policy_decisions (
         id, org_id, actor_type, actor_id, actor_role, action_id, target_type, target_id,
         context, decision, enforceability, reason_code, explanation, matched, audit_event_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14::jsonb, $15)`,
      [
        decisionId,
        orgId,
        request.actor.type,
        request.actor.id ?? null,
        request.actor.role ?? null,
        request.action,
        request.target.type,
        request.target.id ?? null,
        JSON.stringify(request.context),
        result.decision,
        result.enforceability,
        result.reasonCode,
        result.explanation,
        JSON.stringify(result.matched),
        audit.id,
      ],
    );

    return { id: decisionId, ...result };
  });
}

export async function assertPolicyAllows(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  request: Omit<PolicyDecisionRequest, 'actor'>,
): Promise<void> {
  const decision = await checkPolicyDecision(pool, operator, orgId, {
    ...request,
    actor: { type: 'user', id: operator.actorId, role: operator.role },
  });

  if (decision.decision === 'deny') {
    throw new IdentityError(decision.reasonCode, 403, decision.explanation);
  }

  if (decision.decision === 'approval_required') {
    throw new IdentityError(decision.reasonCode, 409, decision.explanation);
  }
}
