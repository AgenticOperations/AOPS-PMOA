import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { recordAuditEvent } from '../evidence/audit-writer.js';
import { badRequest, conflict, notFound } from './errors.js';
import { prefixedId, slugifyName } from './ids.js';
import type {
  AgentRecord,
  AgentRosterItem,
  AgentStatus,
  ConnectionHealth,
  ConnectionKind,
  ConnectionRecord,
  OperatorContext,
  OrgRecord,
  TeamRecord,
  WalletRefRecord,
} from './types.js';

type Db = pg.Pool | pg.PoolClient;

type OrgRow = {
  readonly id: string;
  readonly display_name: string;
  readonly slug: string;
  readonly default_team_id: string;
  readonly settings: Record<string, unknown>;
  readonly status: string;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type TeamRow = {
  readonly id: string;
  readonly org_id: string;
  readonly name: string;
  readonly description: string;
  readonly is_default: boolean;
  readonly archived_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type AgentRow = {
  readonly id: string;
  readonly org_id: string;
  readonly team_id: string;
  readonly parent_agent_id: string | null;
  readonly name: string;
  readonly status: AgentStatus;
  readonly description: string;
  readonly labels: unknown;
  readonly default_environment: string | null;
  readonly metadata: unknown;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type ConnectionRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly kind: ConnectionKind;
  readonly name: string;
  readonly status: 'active' | 'revoked';
  readonly secret_last4: string | null;
  readonly last_tested_at: Date | null;
  readonly last_used_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type WalletRefRow = {
  readonly id: string;
  readonly org_id: string;
  readonly agent_id: string;
  readonly provider: string;
  readonly external_wallet_id: string | null;
  readonly address: string | null;
  readonly chain: string | null;
  readonly label: string;
  readonly status: 'attached' | 'detached';
  readonly attached_at: Date;
  readonly detached_at: Date | null;
};

type AgentActivityRow = {
  readonly id: string;
  readonly event_type: string;
  readonly action: string;
  readonly outcome: string;
  readonly actor_type: string;
  readonly actor_id: string | null;
  readonly event_domain: string;
  readonly event_category: string;
  readonly severity: string;
  readonly tags: string[];
  readonly resource_type: string | null;
  readonly resource_id: string | null;
  readonly related_agent_id: string | null;
  readonly related_connection_id: string | null;
  readonly related_wallet_ref_id: string | null;
  readonly connection_name: string | null;
  readonly payload: unknown;
  readonly recorded_at: Date;
};

type AgentRuntimeActivityRow = {
  readonly id: string;
  readonly connection_id: string | null;
  readonly decision_id: string | null;
  readonly approval_id: string | null;
  readonly category: string;
  readonly action: string;
  readonly outcome: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly created_at: Date;
};

export type CreateOrgInput = {
  readonly name: string;
  readonly slug?: string | undefined;
  readonly domain?: string | undefined;
  readonly primary_use_case?: string | undefined;
  readonly owner?: {
    readonly email: string;
    readonly name: string;
  } | undefined;
};

export type CreateTeamInput = {
  readonly name: string;
  readonly description?: string | undefined;
};

export type UpdateTeamInput = {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
};

export type CreateAgentInput = {
  readonly name: string;
  readonly team_id?: string | undefined;
  readonly parent_agent_id?: string | null | undefined;
  readonly description?: string | undefined;
  readonly labels?: string[] | undefined;
  readonly default_environment?: string | null | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
};

export type UpdateAgentInput = {
  readonly name?: string | undefined;
  readonly team_id?: string | undefined;
  readonly parent_agent_id?: string | null | undefined;
  readonly description?: string | undefined;
  readonly labels?: string[] | undefined;
  readonly default_environment?: string | null | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
};

export type CreateConnectionInput = {
  readonly kind: ConnectionKind;
  readonly name: string;
};

export type AttachWalletRefInput = {
  readonly provider: string;
  readonly external_wallet_id?: string | null | undefined;
  readonly address?: string | null | undefined;
  readonly chain?: string | null | undefined;
  readonly label?: string | undefined;
};

export type AgentDetail = AgentRecord & {
  readonly team: { readonly id: string; readonly name: string };
  readonly parent: { readonly id: string; readonly name: string } | null;
  readonly children: Array<{ readonly id: string; readonly name: string; readonly status: AgentStatus }>;
  readonly connection_health: ConnectionHealth;
  readonly wallet_refs_count: number;
};

export type AgentActivityItem = {
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

export type AgentLiveStatus = 'active' | 'idle' | 'offline';

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
    readonly status: AgentLiveStatus;
    readonly last_seen_at: string | null;
    readonly latest_event_at: string | null;
    readonly active_connection_count: number;
  };
  readonly events: AgentActivityFeedItem[];
};

export type AgentDetailBundle = {
  readonly agent: AgentDetail;
  readonly connections: ConnectionRecord[];
  readonly wallet_refs: WalletRefRecord[];
  readonly activity: AgentActivityItem[];
};

export type ConnectionSecretResult = {
  readonly connection: ConnectionRecord;
  readonly secret: string | null;
};

export type ConnectionAuthResult = {
  readonly org_id: string;
  readonly agent_id: string;
  readonly connection_id: string;
};

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

function jsonObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function orgFromRow(row: OrgRow): OrgRecord {
  return {
    id: row.id,
    name: row.display_name,
    slug: row.slug,
    default_team_id: row.default_team_id,
    settings: row.settings,
    status: row.status,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function teamFromRow(row: TeamRow): TeamRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    description: row.description,
    is_default: row.is_default,
    archived_at: row.archived_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function agentFromRow(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    team_id: row.team_id,
    parent_agent_id: row.parent_agent_id,
    name: row.name,
    status: row.status,
    description: row.description,
    labels: stringArray(row.labels),
    default_environment: row.default_environment,
    metadata: jsonObject(row.metadata),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function connectionFromRow(row: ConnectionRow): ConnectionRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    secret_last4: row.secret_last4,
    last_tested_at: row.last_tested_at?.toISOString() ?? null,
    last_used_at: row.last_used_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function walletRefFromRow(row: WalletRefRow): WalletRefRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    provider: row.provider,
    external_wallet_id: row.external_wallet_id,
    address: row.address,
    chain: row.chain,
    label: row.label,
    status: row.status,
    attached_at: row.attached_at.toISOString(),
    detached_at: row.detached_at?.toISOString() ?? null,
  };
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function issueConnectionSecret(): string {
  const prefix = process.env.NODE_ENV === 'production' ? 'conn_live_' : 'conn_test_';
  return `${prefix}${randomBytes(24).toString('base64url')}`;
}

async function getDefaultTeamId(db: Db, orgId: string): Promise<string> {
  const result = await db.query<{ default_team_id: string | null }>(
    'SELECT default_team_id FROM orgs WHERE id = $1',
    [orgId],
  );
  const defaultTeamId = result.rows[0]?.default_team_id;
  if (defaultTeamId === undefined || defaultTeamId === null) throw notFound('Org was not found.');
  return defaultTeamId;
}

async function ensureTeamInOrg(db: Db, orgId: string, teamId: string): Promise<void> {
  const result = await db.query(
    'SELECT 1 FROM teams WHERE id = $1 AND org_id = $2 AND archived_at IS NULL',
    [teamId, orgId],
  );
  if (result.rowCount !== 1) throw notFound('Team was not found.');
}

async function getAgentRow(db: Db, orgId: string, agentId: string): Promise<AgentRow> {
  const result = await db.query<AgentRow>(
    'SELECT * FROM agents WHERE id = $1 AND org_id = $2',
    [agentId, orgId],
  );
  const row = result.rows[0];
  if (row === undefined) throw notFound('Agent was not found.');
  return row;
}

async function ensureParentInOrg(
  db: Db,
  orgId: string,
  parentAgentId: string | null | undefined,
): Promise<void> {
  if (parentAgentId === undefined || parentAgentId === null) return;
  await getAgentRow(db, orgId, parentAgentId);
}

async function wouldCreateParentCycle(
  db: Db,
  orgId: string,
  agentId: string,
  parentAgentId: string | null | undefined,
): Promise<boolean> {
  if (parentAgentId === undefined || parentAgentId === null) return false;

  const result = await db.query<{ id: string }>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_agent_id
         FROM agents
        WHERE id = $1 AND org_id = $2
       UNION ALL
       SELECT a.id, a.parent_agent_id
         FROM agents a
         JOIN ancestors p ON a.id = p.parent_agent_id
        WHERE a.org_id = $2
     )
     SELECT id FROM ancestors WHERE id = $3 LIMIT 1`,
    [parentAgentId, orgId, agentId],
  );

  return result.rowCount === 1;
}

function cleanLabels(labels: string[] | undefined): string[] {
  if (labels === undefined) return [];
  return Array.from(
    new Set(
      labels
        .map((label) => label.trim())
        .filter((label) => label.length > 0)
        .slice(0, 24),
    ),
  );
}

function cleanMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return metadata ?? {};
}

type IdentityAuditOptions = {
  readonly classification?: {
    readonly domain?: 'identity' | 'credential' | 'wallet' | 'system';
    readonly category?: 'configuration' | 'security';
    readonly severity?: 'info' | 'warning' | 'critical';
    readonly tags?: readonly string[];
  };
  readonly relations?: {
    readonly agent?: string;
    readonly team?: string;
    readonly connection?: string;
    readonly walletRef?: string;
  };
};

function auditDomainFor(action: string, resourceType: string): 'identity' | 'credential' | 'wallet' | 'system' {
  if (action.startsWith('connection.') || resourceType === 'connection') return 'credential';
  if (action.startsWith('wallet_ref.') || resourceType === 'wallet_ref') return 'wallet';
  if (
    action.startsWith('org.') ||
    action.startsWith('team.') ||
    action.startsWith('agent.') ||
    action.startsWith('onboarding.')
  ) {
    return 'identity';
  }
  return 'system';
}

function auditTagsFor(action: string, resourceType: string, extra: readonly string[] | undefined): string[] {
  const base = ['section_1'];
  if (resourceType === 'agent' || action.startsWith('agent.')) base.push('agent');
  if (resourceType === 'team' || action.startsWith('team.')) base.push('team');
  if (resourceType === 'org' || action.startsWith('org.') || action.startsWith('onboarding.')) base.push('org');
  if (resourceType === 'connection' || action.startsWith('connection.')) {
    base.push('agent', 'credential');
  }
  if (resourceType === 'wallet_ref' || action.startsWith('wallet_ref.')) {
    base.push('agent', 'wallet_ref');
  }
  return Array.from(new Set([...base, ...(extra ?? [])]));
}

function auditRelationsFor(
  resource: { readonly type: string; readonly id: string },
  relations: IdentityAuditOptions['relations'],
): Record<string, string> {
  const merged: Record<string, string> = {};
  if (resource.type === 'agent') merged.agent = resource.id;
  if (resource.type === 'team') merged.team = resource.id;
  if (resource.type === 'connection') merged.connection = resource.id;
  if (resource.type === 'wallet_ref') merged.walletRef = resource.id;
  if (relations?.agent !== undefined) merged.agent = relations.agent;
  if (relations?.team !== undefined) merged.team = relations.team;
  if (relations?.connection !== undefined) merged.connection = relations.connection;
  if (relations?.walletRef !== undefined) merged.walletRef = relations.walletRef;
  return merged;
}

function auditSummaryFor(action: string): string {
  const labels: Record<string, string> = {
    'agent.registered': 'Agent registered',
    'agent.updated': 'Agent updated',
    'agent.activated': 'Agent activated',
    'agent.paused': 'Agent paused',
    'agent.deactivated': 'Agent deactivated',
    'connection.created': 'Credential created',
    'connection.tested': 'Credential tested',
    'connection.rotated': 'Credential rotated',
    'connection.revoked': 'Credential revoked',
    'wallet_ref.attached': 'Wallet reference attached',
    'wallet_ref.detached': 'Wallet reference detached',
  };
  return labels[action] ?? action;
}

function stringPayload(payload: unknown, key: string): string | null {
  const value = jsonObject(payload)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function activitySubjectFor(event: AgentActivityRow): string | null {
  if (event.action.startsWith('connection.')) {
    return stringPayload(event.payload, 'display_name') ?? stringPayload(event.payload, 'name') ?? event.connection_name ?? 'Credential';
  }
  if (event.action.startsWith('agent.')) {
    return stringPayload(event.payload, 'name') ?? 'Agent';
  }
  return null;
}

function activityDescriptionFor(event: AgentActivityRow): string | null {
  if (event.action === 'connection.created' || event.action === 'connection.revoked') {
    const last4 = stringPayload(event.payload, 'last4') ?? stringPayload(event.payload, 'secret_last4');
    if (last4 !== null) return `Credential ending ${last4}`;
    return event.action === 'connection.created' ? 'Credential created for this agent' : 'Credential access revoked';
  }

  if (event.action === 'connection.rotated') {
    const previous = stringPayload(event.payload, 'previous_last4') ?? stringPayload(event.payload, 'previous_secret_last4');
    const next = stringPayload(event.payload, 'new_last4') ?? stringPayload(event.payload, 'new_secret_last4');
    if (previous !== null && next !== null) return `Credential changed from ${previous} to ${next}`;
    if (next !== null) return `Credential ending ${next}`;
    return 'Credential rotated';
  }

  if (event.action === 'agent.registered') {
    return 'Agent identity created';
  }

  return 'Configuration change recorded';
}

function liveStatusFromLastSeen(lastSeenAt: Date | null): AgentLiveStatus {
  if (lastSeenAt === null) return 'offline';
  const twoMinutesMs = 2 * 60 * 1000;
  return Date.now() - lastSeenAt.getTime() <= twoMinutesMs ? 'active' : 'idle';
}

function runtimeActivitySubject(row: AgentRuntimeActivityRow): string | null {
  const payload = jsonObject(row.payload);
  const action = typeof payload.action === 'string' ? payload.action : null;
  if (row.action === 'runtime.check' || row.action === 'runtime.check.needs_more_info') return action ?? 'Runtime check';
  if (row.action === 'runtime.onboarded') return 'Runtime contract';
  if (row.action === 'mcp.activity_recorded') return 'MCP activity';
  if (row.action.startsWith('approval.')) return row.approval_id ?? 'Approval';
  return null;
}

function runtimeActivityDescription(row: AgentRuntimeActivityRow): string | null {
  const payload = jsonObject(row.payload);
  if (row.action === 'runtime.check') {
    const decision = typeof payload.decision === 'string' ? payload.decision : row.outcome;
    const action = typeof payload.action === 'string' ? payload.action : 'runtime action';
    return `${decision} for ${action}`;
  }
  if (row.action === 'runtime.check.needs_more_info') {
    const missing = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((item): item is string => typeof item === 'string')
      : [];
    return missing.length > 0 ? `Missing ${missing.join(', ')}` : 'More information required';
  }
  if (row.action === 'runtime.onboarded') {
    const contract = typeof payload.contract_version === 'string' ? payload.contract_version : null;
    return contract === null ? 'Runtime contract issued' : `Runtime contract ${contract}`;
  }
  if (row.action === 'mcp.activity_recorded') return row.summary;
  if (row.action === 'approval.requested') return 'Human approval requested';
  if (row.action === 'approval.approved') return 'Human approval granted';
  if (row.action === 'approval.consumed') return 'Approval consumed by runtime credential';
  return row.summary;
}

async function recordIdentityEvent(
  client: pg.PoolClient,
  orgId: string,
  operator: OperatorContext,
  action: string,
  resource: { readonly type: string; readonly id: string },
  payload: Record<string, unknown> = {},
  options: IdentityAuditOptions = {},
): Promise<void> {
  await recordAuditEvent(client, {
    orgId,
    idempotencyKey: `${action}:${resource.id}:${prefixedId('idem')}`,
    eventType: action,
    actor: { type: 'user', id: operator.actorId },
    action,
    outcome: 'success',
    resource,
    classification: {
      domain: options.classification?.domain ?? auditDomainFor(action, resource.type),
      category: options.classification?.category ?? 'configuration',
      severity: options.classification?.severity ?? 'info',
      tags: auditTagsFor(action, resource.type, options.classification?.tags),
    },
    relations: auditRelationsFor(resource, options.relations),
    source: { section: 'section_1', system: 'identity' },
    payload,
  });
}

export async function listOrgs(pool: pg.Pool): Promise<OrgRecord[]> {
  const result = await pool.query<OrgRow>(
    `SELECT id, display_name, slug, default_team_id, settings, status, created_at, updated_at
       FROM orgs
      ORDER BY created_at ASC, id ASC`,
  );
  return result.rows.map(orgFromRow);
}

export async function listOrgsForUser(pool: pg.Pool, userId: string): Promise<OrgRecord[]> {
  const result = await pool.query<OrgRow>(
    `SELECT o.id, o.display_name, o.slug, o.default_team_id, o.settings, o.status, o.created_at, o.updated_at
       FROM orgs o
       JOIN memberships m ON m.org_id = o.id
      WHERE m.user_id = $1
        AND m.status = 'active'
        AND o.status = 'active'
      ORDER BY o.created_at ASC, o.id ASC`,
    [userId],
  );
  return result.rows.map(orgFromRow);
}

export async function getMembershipRole(
  pool: pg.Pool,
  orgId: string,
  userId: string,
): Promise<OperatorContext['role'] | null> {
  const result = await pool.query<{ role: OperatorContext['role'] }>(
    `SELECT role
       FROM memberships
      WHERE org_id = $1
        AND user_id = $2
        AND status = 'active'
      LIMIT 1`,
    [orgId, userId],
  );
  return result.rows[0]?.role ?? null;
}

export async function getOrgBySlugForUser(
  pool: pg.Pool,
  slug: string,
  userId: string,
): Promise<OrgRecord> {
  const result = await pool.query<OrgRow>(
    `SELECT o.id, o.display_name, o.slug, o.default_team_id, o.settings, o.status, o.created_at, o.updated_at
       FROM orgs o
       JOIN memberships m ON m.org_id = o.id
      WHERE o.slug = $1
        AND o.status = 'active'
        AND m.user_id = $2
        AND m.status = 'active'
      LIMIT 1`,
    [slug, userId],
  );
  const row = result.rows[0];
  if (row === undefined) throw notFound('Workspace was not found.');
  return orgFromRow(row);
}

export async function createOrgForUser(
  pool: pg.Pool,
  operator: OperatorContext,
  input: CreateOrgInput,
): Promise<OrgRecord> {
  return withTransaction(pool, async (client) => {
    const orgId = prefixedId('org');
    const defaultTeamId = prefixedId('team');
    const memberId = prefixedId('mem');
    const baseSlug = input.slug?.trim() || slugifyName(input.name);
    const normalizedSlug = baseSlug.toLowerCase();
    const slugTaken = await client.query('SELECT 1 FROM orgs WHERE slug = $1 LIMIT 1', [
      normalizedSlug,
    ]);
    const slug =
      input.slug === undefined && slugTaken.rowCount === 1
        ? `${normalizedSlug}-${orgId.slice(4, 12)}`
        : normalizedSlug;

    const inserted = await client.query<OrgRow>(
      `INSERT INTO orgs (id, display_name, slug, status, settings)
       VALUES ($1, $2, $3, 'active', $4::jsonb)
       RETURNING id, display_name, slug, default_team_id, settings, status, created_at, updated_at`,
      [
        orgId,
        input.name,
        slug,
        JSON.stringify({
          domain: input.domain ?? null,
          primary_use_case: input.primary_use_case ?? null,
        }),
      ],
    );

    await client.query(
      `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
       VALUES ($1, $2, $3, 'owner', 'active', now())`,
      [memberId, orgId, operator.actorId],
    );

    await client.query(
      `INSERT INTO teams (id, org_id, name, description, is_default)
       VALUES ($1, $2, 'Default', '', true)`,
      [defaultTeamId, orgId],
    );

    const updated = await client.query<OrgRow>(
      `UPDATE orgs
          SET default_team_id = $2,
              updated_at = now()
        WHERE id = $1
        RETURNING id, display_name, slug, default_team_id, settings, status, created_at, updated_at`,
      [orgId, defaultTeamId],
    );

    await client.query(
      `INSERT INTO org_onboarding_states (
         id,
         org_id,
         flow_key,
         status,
         payload,
         completed_at,
         created_by_user_id
       )
       VALUES ($1, $2, 'section_1_foundation', 'completed', $3::jsonb, now(), $4)`,
      [
        prefixedId('onb'),
        orgId,
        JSON.stringify({
          domain: input.domain ?? null,
          primary_use_case: input.primary_use_case ?? null,
        }),
        operator.actorId,
      ],
    );

    await recordIdentityEvent(client, orgId, operator, 'org.created', { type: 'org', id: orgId }, {
      name: input.name,
      slug,
    });
    await recordIdentityEvent(
      client,
      orgId,
      operator,
      'team.created',
      { type: 'team', id: defaultTeamId },
      { name: 'Default', is_default: true },
    );
    await recordIdentityEvent(client, orgId, operator, 'onboarding.completed', { type: 'org', id: orgId }, {
      flow_key: 'section_1_foundation',
    });

    const row = updated.rows[0] ?? inserted.rows[0];
    if (row === undefined) throw new Error('org_create_failed');
    return orgFromRow(row);
  });
}

export async function createOrg(
  pool: pg.Pool,
  operator: OperatorContext,
  input: CreateOrgInput,
): Promise<OrgRecord> {
  return withTransaction(pool, async (client) => {
    const orgId = prefixedId('org');
    const defaultTeamId = prefixedId('team');
    const baseSlug = input.slug?.trim() || slugifyName(input.name);
    const normalizedSlug = baseSlug.toLowerCase();
    const slugTaken = await client.query('SELECT 1 FROM orgs WHERE slug = $1 LIMIT 1', [
      normalizedSlug,
    ]);
    const slug =
      input.slug === undefined && slugTaken.rowCount === 1
        ? `${normalizedSlug}-${orgId.slice(4, 12)}`
        : normalizedSlug;
    const userId = prefixedId('usr');
    const memberId = prefixedId('mem');
    const ownerEmail = input.owner?.email.toLowerCase() ?? `${orgId}@local.agentops`;
    const ownerName = input.owner?.name ?? 'Local operator';

    const inserted = await client.query<OrgRow>(
      `INSERT INTO orgs (id, display_name, slug, status, settings)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb)
       RETURNING id, display_name, slug, default_team_id, settings, status, created_at, updated_at`,
      [orgId, input.name, slug],
    );

    await client.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name,
             updated_at = now()`,
      [userId, ownerEmail, ownerName],
    );

    const userResult = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      ownerEmail,
    ]);
    const resolvedUserId = userResult.rows[0]?.id ?? userId;

    await client.query(
      `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
       VALUES ($1, $2, $3, 'owner', 'active', now())`,
      [memberId, orgId, resolvedUserId],
    );

    await client.query(
      `INSERT INTO teams (id, org_id, name, description, is_default)
       VALUES ($1, $2, 'Default', '', true)`,
      [defaultTeamId, orgId],
    );

    const updated = await client.query<OrgRow>(
      `UPDATE orgs
          SET default_team_id = $2,
              updated_at = now()
        WHERE id = $1
        RETURNING id, display_name, slug, default_team_id, settings, status, created_at, updated_at`,
      [orgId, defaultTeamId],
    );

    await recordIdentityEvent(client, orgId, operator, 'org.created', { type: 'org', id: orgId }, {
      name: input.name,
      slug,
    });
    await recordIdentityEvent(
      client,
      orgId,
      operator,
      'team.created',
      { type: 'team', id: defaultTeamId },
      { name: 'Default', is_default: true },
    );

    const row = updated.rows[0] ?? inserted.rows[0];
    if (row === undefined) throw new Error('org_create_failed');
    return orgFromRow(row);
  });
}

export async function getOrg(pool: pg.Pool, orgId: string): Promise<OrgRecord> {
  const result = await pool.query<OrgRow>(
    `SELECT id, display_name, slug, default_team_id, settings, status, created_at, updated_at
       FROM orgs
      WHERE id = $1`,
    [orgId],
  );
  const row = result.rows[0];
  if (row === undefined) throw notFound('Org was not found.');
  return orgFromRow(row);
}

export async function listTeams(pool: pg.Pool, orgId: string): Promise<TeamRecord[]> {
  const result = await pool.query<TeamRow>(
    `SELECT *
       FROM teams
      WHERE org_id = $1
      ORDER BY is_default DESC, created_at ASC, id ASC`,
    [orgId],
  );
  return result.rows.map(teamFromRow);
}

export async function createTeam(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: CreateTeamInput,
): Promise<TeamRecord> {
  return withTransaction(pool, async (client) => {
    await getOrg(pool, orgId);
    const teamId = prefixedId('team');
    const result = await client.query<TeamRow>(
      `INSERT INTO teams (id, org_id, name, description, is_default)
       VALUES ($1, $2, $3, $4, false)
       RETURNING *`,
      [teamId, orgId, input.name, input.description ?? ''],
    );
    await recordIdentityEvent(client, orgId, operator, 'team.created', { type: 'team', id: teamId }, {
      name: input.name,
    });
    const row = result.rows[0];
    if (row === undefined) throw new Error('team_create_failed');
    return teamFromRow(row);
  });
}

export async function updateTeam(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  teamId: string,
  input: UpdateTeamInput,
): Promise<TeamRecord> {
  return withTransaction(pool, async (client) => {
    const current = await client.query<TeamRow>('SELECT * FROM teams WHERE id = $1 AND org_id = $2', [
      teamId,
      orgId,
    ]);
    const existing = current.rows[0];
    if (existing === undefined) throw notFound('Team was not found.');
    if (existing.archived_at !== null) throw conflict('team_archived', 'Archived teams cannot be changed.');

    const result = await client.query<TeamRow>(
      `UPDATE teams
          SET name = $3,
              description = $4,
              updated_at = now()
        WHERE id = $1 AND org_id = $2
        RETURNING *`,
      [teamId, orgId, input.name ?? existing.name, input.description ?? existing.description],
    );
    await recordIdentityEvent(client, orgId, operator, 'team.updated', { type: 'team', id: teamId }, input);
    const row = result.rows[0];
    if (row === undefined) throw notFound('Team was not found.');
    return teamFromRow(row);
  });
}

export async function archiveTeam(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  teamId: string,
): Promise<TeamRecord> {
  return withTransaction(pool, async (client) => {
    const current = await client.query<TeamRow>('SELECT * FROM teams WHERE id = $1 AND org_id = $2', [
      teamId,
      orgId,
    ]);
    const existing = current.rows[0];
    if (existing === undefined) throw notFound('Team was not found.');
    if (existing.is_default) throw conflict('default_team', 'Default team cannot be archived.');

    const activeAgents = await client.query('SELECT 1 FROM agents WHERE org_id = $1 AND team_id = $2 AND status = $3 LIMIT 1', [
      orgId,
      teamId,
      'active',
    ]);
    if (activeAgents.rowCount === 1) {
      throw conflict('team_has_active_agents', 'Team has active agents.');
    }

    const result = await client.query<TeamRow>(
      `UPDATE teams
          SET archived_at = COALESCE(archived_at, now()),
              updated_at = now()
        WHERE id = $1 AND org_id = $2
        RETURNING *`,
      [teamId, orgId],
    );
    await recordIdentityEvent(client, orgId, operator, 'team.archived', { type: 'team', id: teamId });
    const row = result.rows[0];
    if (row === undefined) throw notFound('Team was not found.');
    return teamFromRow(row);
  });
}

export async function createAgent(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: CreateAgentInput,
): Promise<AgentRecord> {
  return withTransaction(pool, async (client) => {
    const teamId = input.team_id ?? (await getDefaultTeamId(client, orgId));
    await ensureTeamInOrg(client, orgId, teamId);
    await ensureParentInOrg(client, orgId, input.parent_agent_id);

    const agentId = prefixedId('agt');
    const result = await client.query<AgentRow>(
      `INSERT INTO agents (
         id, org_id, team_id, parent_agent_id, name, status, description, labels,
         default_environment, metadata, created_by_member_id
       )
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        agentId,
        orgId,
        teamId,
        input.parent_agent_id ?? null,
        input.name,
        input.description ?? '',
        JSON.stringify(cleanLabels(input.labels)),
        input.default_environment ?? null,
        JSON.stringify(cleanMetadata(input.metadata)),
        operator.actorId,
      ],
    );
    await recordIdentityEvent(
      client,
      orgId,
      operator,
      'agent.registered',
      { type: 'agent', id: agentId },
      { name: input.name, labels: cleanLabels(input.labels), team_id: teamId },
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('agent_create_failed');
    return agentFromRow(row);
  });
}

export async function updateAgent(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  agentId: string,
  input: UpdateAgentInput,
): Promise<AgentRecord> {
  return withTransaction(pool, async (client) => {
    const existing = await getAgentRow(client, orgId, agentId);
    const teamId = input.team_id ?? existing.team_id;
    const parentAgentId =
      input.parent_agent_id === undefined ? existing.parent_agent_id : input.parent_agent_id;
    await ensureTeamInOrg(client, orgId, teamId);
    await ensureParentInOrg(client, orgId, parentAgentId);
    if (await wouldCreateParentCycle(client, orgId, agentId, parentAgentId)) {
      throw conflict('parent_cycle', 'Parent assignment would create a cycle.');
    }

    const result = await client.query<AgentRow>(
      `UPDATE agents
          SET team_id = $3,
              parent_agent_id = $4,
              name = $5,
              description = $6,
              labels = $7,
              default_environment = $8,
              metadata = $9,
              updated_at = now()
        WHERE id = $1 AND org_id = $2
        RETURNING *`,
      [
        agentId,
        orgId,
        teamId,
        parentAgentId,
        input.name ?? existing.name,
        input.description ?? existing.description,
        JSON.stringify(input.labels === undefined ? stringArray(existing.labels) : cleanLabels(input.labels)),
        input.default_environment === undefined
          ? existing.default_environment
          : input.default_environment,
        JSON.stringify(input.metadata === undefined ? jsonObject(existing.metadata) : input.metadata),
      ],
    );

    await recordIdentityEvent(client, orgId, operator, 'agent.updated', { type: 'agent', id: agentId }, input);
    const row = result.rows[0];
    if (row === undefined) throw notFound('Agent was not found.');
    return agentFromRow(row);
  });
}

export async function setAgentStatus(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  agentId: string,
  status: Extract<AgentStatus, 'active' | 'paused' | 'deactivated'>,
): Promise<AgentRecord> {
  const action =
    status === 'active'
      ? 'agent.activated'
      : status === 'paused'
        ? 'agent.paused'
        : 'agent.deactivated';

  return withTransaction(pool, async (client) => {
    await getAgentRow(client, orgId, agentId);
    const result = await client.query<AgentRow>(
      `UPDATE agents
          SET status = $3,
              updated_at = now()
        WHERE id = $1 AND org_id = $2
        RETURNING *`,
      [agentId, orgId, status],
    );
    await recordIdentityEvent(client, orgId, operator, action, { type: 'agent', id: agentId });
    const row = result.rows[0];
    if (row === undefined) throw notFound('Agent was not found.');
    return agentFromRow(row);
  });
}

export async function listAgents(pool: pg.Pool, orgId: string): Promise<AgentRosterItem[]> {
  const result = await pool.query<
    AgentRow & {
      readonly team_name: string;
      readonly connection_health: ConnectionHealth;
      readonly wallet_refs_count: string;
    }
  >(
    `SELECT
       a.*,
       t.name AS team_name,
       COALESCE(w.active_wallet_refs, 0)::text AS wallet_refs_count,
       CASE
         WHEN c.total_connections IS NULL THEN 'not_connected'
         WHEN COALESCE(c.active_recent, 0) > 0 THEN 'healthy'
         WHEN COALESCE(c.active_connections, 0) > 0 THEN 'stale'
         ELSE 'revoked'
       END AS connection_health
     FROM agents a
     JOIN teams t ON t.id = a.team_id AND t.org_id = a.org_id
     LEFT JOIN (
       SELECT
         agent_id,
         count(*) AS total_connections,
         count(*) FILTER (WHERE status = 'active') AS active_connections,
         count(*) FILTER (WHERE status = 'active' AND last_tested_at > now() - interval '24 hours') AS active_recent
       FROM connections
       WHERE org_id = $1
       GROUP BY agent_id
     ) c ON c.agent_id = a.id
     LEFT JOIN (
       SELECT agent_id, count(*) AS active_wallet_refs
       FROM wallet_refs
       WHERE org_id = $1 AND status = 'attached'
       GROUP BY agent_id
     ) w ON w.agent_id = a.id
     WHERE a.org_id = $1
     ORDER BY a.created_at ASC, a.id ASC`,
    [orgId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    labels: stringArray(row.labels),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    team: { id: row.team_id, name: row.team_name },
    connection_health: row.connection_health,
    wallet_refs_count: Number(row.wallet_refs_count),
  }));
}

export async function getAgentDetail(
  pool: pg.Pool,
  orgId: string,
  agentId: string,
): Promise<AgentDetailBundle> {
  const detail = await pool.query<
    AgentRow & {
      readonly team_name: string;
      readonly parent_name: string | null;
      readonly connection_health: ConnectionHealth;
      readonly wallet_refs_count: string;
    }
  >(
    `SELECT
       a.*,
       t.name AS team_name,
       p.name AS parent_name,
       COALESCE(w.active_wallet_refs, 0)::text AS wallet_refs_count,
       CASE
         WHEN c.total_connections IS NULL THEN 'not_connected'
         WHEN COALESCE(c.active_recent, 0) > 0 THEN 'healthy'
         WHEN COALESCE(c.active_connections, 0) > 0 THEN 'stale'
         ELSE 'revoked'
       END AS connection_health
     FROM agents a
     JOIN teams t ON t.id = a.team_id AND t.org_id = a.org_id
     LEFT JOIN agents p ON p.id = a.parent_agent_id AND p.org_id = a.org_id
     LEFT JOIN (
       SELECT
         agent_id,
         count(*) AS total_connections,
         count(*) FILTER (WHERE status = 'active') AS active_connections,
         count(*) FILTER (WHERE status = 'active' AND last_tested_at > now() - interval '24 hours') AS active_recent
       FROM connections
       WHERE org_id = $1
       GROUP BY agent_id
     ) c ON c.agent_id = a.id
     LEFT JOIN (
       SELECT agent_id, count(*) AS active_wallet_refs
       FROM wallet_refs
       WHERE org_id = $1 AND status = 'attached'
       GROUP BY agent_id
     ) w ON w.agent_id = a.id
     WHERE a.org_id = $1 AND a.id = $2`,
    [orgId, agentId],
  );

  const row = detail.rows[0];
  if (row === undefined) throw notFound('Agent was not found.');

  const children = await pool.query<{ id: string; name: string; status: AgentStatus }>(
    `SELECT id, name, status
       FROM agents
      WHERE org_id = $1 AND parent_agent_id = $2
      ORDER BY created_at ASC, id ASC`,
    [orgId, agentId],
  );

  const connections = await listConnections(pool, orgId, agentId);
  const walletRefs = await listWalletRefs(pool, orgId, agentId);
  const activity = await pool.query<AgentActivityRow>(
    `SELECT
        ae.id,
        ae.event_type,
        ae.action,
        ae.outcome,
        ae.actor_type,
        ae.actor_id,
        ae.event_domain,
        ae.event_category,
        ae.severity,
        ae.tags,
        ae.resource_type,
        ae.resource_id,
        ae.related_agent_id,
        ae.related_connection_id,
        ae.related_wallet_ref_id,
        c.name AS connection_name,
        ae.payload,
        ae.recorded_at
       FROM audit_events ae
       LEFT JOIN connections c
         ON c.org_id = ae.org_id
        AND c.id = COALESCE(ae.related_connection_id, ae.resource_id)
      WHERE ae.org_id = $1
        AND ae.event_category = 'configuration'
        AND ae.action <> 'connection.tested'
        AND (
          ae.related_agent_id = $2
          OR (ae.resource_type = 'agent' AND ae.resource_id = $2)
          OR (
            ae.resource_type = 'connection'
            AND ae.resource_id IN (
              SELECT id FROM connections WHERE org_id = $1 AND agent_id = $2
            )
          )
          OR (
            ae.resource_type = 'wallet_ref'
            AND ae.resource_id IN (
              SELECT id FROM wallet_refs WHERE org_id = $1 AND agent_id = $2
            )
          )
        )
      ORDER BY ae.sequence DESC
      LIMIT 50`,
    [orgId, agentId],
  );

  return {
    agent: {
      ...agentFromRow(row),
      team: { id: row.team_id, name: row.team_name },
      parent:
        row.parent_agent_id === null
          ? null
          : { id: row.parent_agent_id, name: row.parent_name ?? row.parent_agent_id },
      children: children.rows,
      connection_health: row.connection_health,
      wallet_refs_count: Number(row.wallet_refs_count),
    },
    connections,
    wallet_refs: walletRefs,
    activity: activity.rows.map((event) => ({
      id: event.id,
      eventType: event.event_type,
      action: event.action,
      outcome: event.outcome,
      actorType: event.actor_type,
      actorId: event.actor_id,
      eventDomain: event.event_domain,
      eventCategory: event.event_category,
      severity: event.severity,
      tags: event.tags,
      summary: auditSummaryFor(event.action),
      subject: activitySubjectFor(event),
      description: activityDescriptionFor(event),
      recordedAt: event.recorded_at.toISOString(),
    })),
  };
}

export async function listAgentActivityFeed(
  pool: pg.Pool,
  orgId: string,
  agentId: string,
  limit = 80,
): Promise<AgentActivityFeed> {
  await getAgentRow(pool, orgId, agentId);
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);

  const live = await pool.query<{
    readonly last_seen_at: Date | null;
    readonly latest_event_at: Date | null;
    readonly active_connection_count: string;
  }>(
    `WITH connection_state AS (
       SELECT
         max(last_used_at) AS last_used_at,
         count(*) FILTER (WHERE status = 'active')::text AS active_connection_count
       FROM connections
       WHERE org_id = $1 AND agent_id = $2
     ),
     activity_state AS (
       SELECT max(created_at) AS latest_event_at
       FROM activity_items
       WHERE org_id = $1 AND agent_id = $2
     )
     SELECT
       GREATEST(connection_state.last_used_at, activity_state.latest_event_at) AS last_seen_at,
       activity_state.latest_event_at,
       connection_state.active_connection_count
     FROM connection_state, activity_state`,
    [orgId, agentId],
  );
  const liveRow = live.rows[0];
  const lastSeenAt = liveRow?.last_seen_at ?? null;
  const latestEventAt = liveRow?.latest_event_at ?? null;

  const runtimeActivity = await pool.query<AgentRuntimeActivityRow>(
    `SELECT
       id,
       connection_id,
       decision_id,
       approval_id,
       category,
       action,
       outcome,
       summary,
       payload,
       created_at
     FROM activity_items
     WHERE org_id = $1 AND agent_id = $2
     ORDER BY created_at DESC, id DESC
     LIMIT $3`,
    [orgId, agentId, boundedLimit],
  );

  const configurationActivity = await pool.query<AgentActivityRow>(
    `SELECT
        ae.id,
        ae.event_type,
        ae.action,
        ae.outcome,
        ae.actor_type,
        ae.actor_id,
        ae.event_domain,
        ae.event_category,
        ae.severity,
        ae.tags,
        ae.resource_type,
        ae.resource_id,
        ae.related_agent_id,
        ae.related_connection_id,
        ae.related_wallet_ref_id,
        c.name AS connection_name,
        ae.payload,
        ae.recorded_at
       FROM audit_events ae
       LEFT JOIN connections c
         ON c.org_id = ae.org_id
        AND c.id = COALESCE(ae.related_connection_id, ae.resource_id)
      WHERE ae.org_id = $1
        AND ae.event_category = 'configuration'
        AND ae.action <> 'connection.tested'
        AND (
          ae.related_agent_id = $2
          OR (ae.resource_type = 'agent' AND ae.resource_id = $2)
          OR (
            ae.resource_type = 'connection'
            AND ae.resource_id IN (
              SELECT id FROM connections WHERE org_id = $1 AND agent_id = $2
            )
          )
          OR (
            ae.resource_type = 'wallet_ref'
            AND ae.resource_id IN (
              SELECT id FROM wallet_refs WHERE org_id = $1 AND agent_id = $2
            )
          )
        )
      ORDER BY ae.sequence DESC
      LIMIT $3`,
    [orgId, agentId, boundedLimit],
  );

  const runtimeEvents: AgentActivityFeedItem[] = runtimeActivity.rows.map((row) => ({
    id: row.id,
    source: 'activity',
    category: row.category,
    action: row.action,
    outcome: row.outcome,
    summary: row.summary,
    subject: runtimeActivitySubject(row),
    description: runtimeActivityDescription(row),
    connectionId: row.connection_id,
    decisionId: row.decision_id,
    approvalId: row.approval_id,
    occurredAt: row.created_at.toISOString(),
    payload: jsonObject(row.payload),
  }));

  const auditEvents: AgentActivityFeedItem[] = configurationActivity.rows.map((event) => ({
    id: event.id,
    source: 'audit',
    category: event.event_domain,
    action: event.action,
    outcome: event.outcome,
    summary: auditSummaryFor(event.action),
    subject: activitySubjectFor(event),
    description: activityDescriptionFor(event),
    connectionId: event.related_connection_id,
    decisionId: null,
    approvalId: null,
    occurredAt: event.recorded_at.toISOString(),
    payload: jsonObject(event.payload),
  }));

  const events = [...runtimeEvents, ...auditEvents]
    .sort((left, right) => {
      const byTime = new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
      return byTime === 0 ? right.id.localeCompare(left.id) : byTime;
    })
    .slice(0, boundedLimit);

  return {
    live: {
      status: liveStatusFromLastSeen(lastSeenAt),
      last_seen_at: lastSeenAt?.toISOString() ?? null,
      latest_event_at: latestEventAt?.toISOString() ?? null,
      active_connection_count: Number(liveRow?.active_connection_count ?? 0),
    },
    events,
  };
}

export async function listConnections(
  pool: pg.Pool,
  orgId: string,
  agentId: string,
): Promise<ConnectionRecord[]> {
  await getAgentRow(pool, orgId, agentId);
  const result = await pool.query<ConnectionRow>(
    `SELECT *
       FROM connections
      WHERE org_id = $1 AND agent_id = $2
      ORDER BY created_at ASC, id ASC`,
    [orgId, agentId],
  );
  return result.rows.map(connectionFromRow);
}

export async function createConnection(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  agentId: string,
  input: CreateConnectionInput,
): Promise<ConnectionSecretResult> {
  return withTransaction(pool, async (client) => {
    const agent = await getAgentRow(client, orgId, agentId);
    if (agent.status === 'deactivated' || agent.status === 'retired') {
      throw conflict('agent_inactive', 'Inactive agents cannot receive new connections.');
    }

    const connectionId = prefixedId('conn');
    const secret = input.kind === 'manual_observe' ? null : issueConnectionSecret();
    const secretLast4 = secret === null ? null : secret.slice(-4);
    const result = await client.query<ConnectionRow>(
      `INSERT INTO connections (
         id, org_id, agent_id, created_by, kind, name, status, secret_last4, secret_revealed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, now())
       RETURNING *`,
      [connectionId, orgId, agentId, operator.actorId, input.kind, input.name, secretLast4],
    );

    if (secret !== null) {
      await client.query(
        `INSERT INTO connection_credentials (id, org_id, connection_id, secret_hash, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [prefixedId('ccred'), orgId, connectionId, hashSecret(secret)],
      );
    }

    await recordIdentityEvent(
      client,
      orgId,
      operator,
      'connection.created',
      { type: 'connection', id: connectionId },
      {
        agent_id: agentId,
        connection_id: connectionId,
        kind: input.kind,
        display_name: input.name,
        last4: secretLast4,
      },
      { relations: { agent: agentId, connection: connectionId } },
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('connection_create_failed');
    return { connection: connectionFromRow(row), secret };
  });
}

export async function testConnection(
  pool: pg.Pool,
  _operator: OperatorContext,
  orgId: string,
  connectionId: string,
): Promise<ConnectionRecord> {
  return withTransaction(pool, async (client) => {
    const result = await client.query<ConnectionRow>(
      `UPDATE connections
          SET last_tested_at = now(),
              updated_at = now()
        WHERE org_id = $1 AND id = $2 AND status = 'active'
        RETURNING *`,
      [orgId, connectionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw notFound('Connection was not found.');
    return connectionFromRow(row);
  });
}

export async function rotateConnection(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  connectionId: string,
): Promise<ConnectionSecretResult> {
  return withTransaction(pool, async (client) => {
    const current = await client.query<ConnectionRow>(
      `SELECT *
         FROM connections
        WHERE org_id = $1 AND id = $2 AND status = 'active'
        FOR UPDATE`,
      [orgId, connectionId],
    );
    const existing = current.rows[0];
    if (existing === undefined) throw notFound('Connection was not found.');
    if (existing.kind === 'manual_observe') {
      throw badRequest('observe_only_connection', 'Observe-only connections do not have secrets.');
    }

    await client.query(
      `UPDATE connection_credentials
          SET status = 'revoked',
              revoked_at = COALESCE(revoked_at, now())
        WHERE org_id = $1 AND connection_id = $2 AND status = 'active'`,
      [orgId, connectionId],
    );

    const secret = issueConnectionSecret();
    await client.query(
      `INSERT INTO connection_credentials (id, org_id, connection_id, secret_hash, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [prefixedId('ccred'), orgId, connectionId, hashSecret(secret)],
    );

    const updated = await client.query<ConnectionRow>(
      `UPDATE connections
          SET secret_last4 = $3,
              secret_revealed_at = now(),
              updated_at = now()
        WHERE org_id = $1 AND id = $2
        RETURNING *`,
      [orgId, connectionId, secret.slice(-4)],
    );
    const row = updated.rows[0];
    if (row === undefined) throw notFound('Connection was not found.');
    await recordIdentityEvent(client, orgId, operator, 'connection.rotated', {
      type: 'connection',
      id: connectionId,
    }, {
      agent_id: existing.agent_id,
      connection_id: connectionId,
      kind: existing.kind,
      display_name: existing.name,
      previous_last4: existing.secret_last4,
      new_last4: row.secret_last4,
    }, {
      relations: { agent: existing.agent_id, connection: connectionId },
    });
    return { connection: connectionFromRow(row), secret };
  });
}

export async function revokeConnection(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  connectionId: string,
): Promise<ConnectionRecord> {
  return withTransaction(pool, async (client) => {
    const updated = await client.query<ConnectionRow>(
      `UPDATE connections
          SET status = 'revoked',
              revoked_at = COALESCE(revoked_at, now()),
              updated_at = now()
        WHERE org_id = $1 AND id = $2
        RETURNING *`,
      [orgId, connectionId],
    );
    const row = updated.rows[0];
    if (row === undefined) throw notFound('Connection was not found.');

    await client.query(
      `UPDATE connection_credentials
          SET status = 'revoked',
              revoked_at = COALESCE(revoked_at, now())
        WHERE org_id = $1 AND connection_id = $2 AND status = 'active'`,
      [orgId, connectionId],
    );

    await recordIdentityEvent(client, orgId, operator, 'connection.revoked', {
      type: 'connection',
      id: connectionId,
    }, {
      agent_id: row.agent_id,
      connection_id: connectionId,
      kind: row.kind,
      display_name: row.name,
      last4: row.secret_last4,
    }, {
      relations: { agent: row.agent_id, connection: connectionId },
    });
    return connectionFromRow(row);
  });
}

export async function authenticateConnection(
  pool: pg.Pool,
  token: string,
): Promise<ConnectionAuthResult | null> {
  const result = await pool.query<{
    readonly org_id: string;
    readonly agent_id: string;
    readonly connection_id: string;
  }>(
    `SELECT c.org_id, c.agent_id, c.id AS connection_id
       FROM connection_credentials cc
       JOIN connections c ON c.id = cc.connection_id AND c.org_id = cc.org_id
       JOIN agents a ON a.id = c.agent_id AND a.org_id = c.org_id
      WHERE cc.secret_hash = $1
        AND cc.status = 'active'
        AND c.status = 'active'
        AND a.status = 'active'
      LIMIT 1`,
    [hashSecret(token)],
  );
  const row = result.rows[0];
  if (row === undefined) return null;

  await pool.query('UPDATE connections SET last_used_at = now(), updated_at = now() WHERE id = $1', [
    row.connection_id,
  ]);

  return row;
}

export async function listWalletRefs(
  pool: pg.Pool,
  orgId: string,
  agentId: string,
): Promise<WalletRefRecord[]> {
  await getAgentRow(pool, orgId, agentId);
  const result = await pool.query<WalletRefRow>(
    `SELECT *
       FROM wallet_refs
      WHERE org_id = $1 AND agent_id = $2 AND status = 'attached'
      ORDER BY attached_at ASC, id ASC`,
    [orgId, agentId],
  );
  return result.rows.map(walletRefFromRow);
}

export async function attachWalletRef(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  agentId: string,
  input: AttachWalletRefInput,
): Promise<WalletRefRecord> {
  return withTransaction(pool, async (client) => {
    await getAgentRow(client, orgId, agentId);
    const walletRefId = prefixedId('wref');
    try {
      const result = await client.query<WalletRefRow>(
        `INSERT INTO wallet_refs (
           id, org_id, agent_id, provider, external_wallet_id, address, chain, label, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'attached')
         RETURNING *`,
        [
          walletRefId,
          orgId,
          agentId,
          input.provider,
          input.external_wallet_id ?? null,
          input.address ?? null,
          input.chain ?? null,
          input.label ?? '',
        ],
      );
      await recordIdentityEvent(
        client,
        orgId,
        operator,
        'wallet_ref.attached',
        { type: 'wallet_ref', id: walletRefId },
        { agent_id: agentId, provider: input.provider, chain: input.chain ?? null },
        { relations: { agent: agentId, walletRef: walletRefId } },
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('wallet_ref_attach_failed');
      return walletRefFromRow(row);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw conflict('duplicate_wallet_ref', 'Wallet reference is already attached.');
      }
      throw error;
    }
  });
}

export async function detachWalletRef(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  agentId: string,
  walletRefId: string,
): Promise<WalletRefRecord> {
  return withTransaction(pool, async (client) => {
    await getAgentRow(client, orgId, agentId);
    const result = await client.query<WalletRefRow>(
      `UPDATE wallet_refs
          SET status = 'detached',
              detached_at = COALESCE(detached_at, now()),
              updated_at = now()
        WHERE org_id = $1 AND agent_id = $2 AND id = $3
        RETURNING *`,
      [orgId, agentId, walletRefId],
    );
    const row = result.rows[0];
    if (row === undefined) throw notFound('Wallet reference was not found.');
    await recordIdentityEvent(client, orgId, operator, 'wallet_ref.detached', {
      type: 'wallet_ref',
      id: walletRefId,
    }, {}, {
      relations: { agent: agentId, walletRef: walletRefId },
    });
    return walletRefFromRow(row);
  });
}
