import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { IdentityError } from '../identity/errors.js';
import { prefixedId } from '../identity/ids.js';
import {
  createAgent,
  createConnection,
  updateAgent,
} from '../identity/store.js';
import type { OperatorContext } from '../identity/types.js';

export type AgentJoinInviteRecord = {
  readonly id: string;
  readonly org_id: string;
  readonly label: string;
  readonly max_uses: number;
  readonly use_count: number;
  readonly expires_at: string | null;
  readonly revoked_at: string | null;
  readonly created_at: string;
};

export type AgentJoinResult = {
  readonly agent_id: string;
  readonly org_id: string;
  readonly connection_id: string;
  readonly mcp_url: string;
  readonly credential: string;
  readonly payment_access: 'disabled';
  readonly join_mode: 'invite' | 'open';
};

export type CreateInviteInput = {
  readonly label?: string | undefined;
  readonly max_uses?: number | undefined;
  readonly expires_in_hours?: number | undefined;
};

export type OpenJoinConfig = {
  readonly enabled: boolean;
  readonly orgId: string;
  readonly maxPerFingerprintPerHour: number;
  readonly maxPerOrgPerDay: number;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function issueInviteToken(): string {
  return `ajoin_${randomBytes(24).toString('base64url')}`;
}

function normalizeMcpPublicUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.pathname === '' || url.pathname === '/') {
      url.pathname = '/mcp';
    }
    return `${url.origin}${url.pathname === '/mcp' ? '/mcp' : url.pathname.replace(/\/$/, '')}`;
  } catch {
    const base = trimmed.replace(/\/+$/, '');
    return base.endsWith('/mcp') ? base : `${base}/mcp`;
  }
}

function defaultMcpUrl(): string {
  const fromEnv =
    process.env.PUBLIC_MCP_URL?.trim() ||
    process.env.MCP_PUBLIC_URL?.trim() ||
    '';
  if (fromEnv.length > 0) return normalizeMcpPublicUrl(fromEnv);
  // Local-only fallback. Production API must set MCP_PUBLIC_URL / PUBLIC_MCP_URL
  // to https://…/mcp (Railway: https://agentops-pmoamcp-production.up.railway.app/mcp).
  return 'http://127.0.0.1:8070/mcp';
}

function joinOperator(orgId: string, memberId: string | null): OperatorContext {
  return {
    actorId: memberId !== null && memberId.length > 0 ? memberId : `system_join_${orgId}`,
    role: 'operator',
    orgId,
  };
}

async function provisionJoinedAgent(
  pool: pg.Pool,
  orgId: string,
  operator: OperatorContext,
  name: string,
  joinMode: 'invite' | 'open',
): Promise<AgentJoinResult> {
  const agent = await createAgent(pool, operator, orgId, {
    name,
    description: joinMode === 'open' ? 'Open-join autonomous agent' : 'Invite-join autonomous agent',
    labels: joinMode === 'open' ? ['open-join'] : ['invite-join'],
    metadata: {
      setup_mode: 'mcp',
      joined_via: joinMode,
      payment_access_default: 'disabled',
    },
  });
  const connection = await createConnection(pool, operator, orgId, agent.id, {
    kind: 'agent_credential',
    name: `${name} MCP`,
  });
  if (connection.secret === null) {
    throw new IdentityError('join_credential_missing', 500, 'Join did not issue a credential secret.');
  }
  return {
    agent_id: agent.id,
    org_id: orgId,
    connection_id: connection.connection.id,
    mcp_url: defaultMcpUrl(),
    credential: connection.secret,
    payment_access: 'disabled',
    join_mode: joinMode,
  };
}

export async function createAgentJoinInvite(
  pool: pg.Pool,
  operator: OperatorContext,
  orgId: string,
  input: CreateInviteInput = {},
): Promise<{ readonly invite: AgentJoinInviteRecord; readonly token: string }> {
  const token = issueInviteToken();
  const id = prefixedId('ajoin');
  const maxUses = input.max_uses ?? 1;
  const label = input.label?.trim() ?? '';
  const expiresAt =
    input.expires_in_hours !== undefined && input.expires_in_hours > 0
      ? new Date(Date.now() + input.expires_in_hours * 3600_000)
      : null;

  const result = await pool.query<{
    readonly id: string;
    readonly org_id: string;
    readonly label: string;
    readonly max_uses: number;
    readonly use_count: number;
    readonly expires_at: Date | null;
    readonly revoked_at: Date | null;
    readonly created_at: Date;
  }>(
    `INSERT INTO agent_join_invites (
       id, org_id, created_by_member_id, token_hash, label, max_uses, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, org_id, label, max_uses, use_count, expires_at, revoked_at, created_at`,
    [id, orgId, operator.actorId, hashToken(token), label, maxUses, expiresAt],
  );
  const row = result.rows[0];
  if (row === undefined) throw new IdentityError('join_invite_create_failed', 500, 'Could not create join invite.');
  return {
    token,
    invite: {
      id: row.id,
      org_id: row.org_id,
      label: row.label,
      max_uses: row.max_uses,
      use_count: row.use_count,
      expires_at: row.expires_at?.toISOString() ?? null,
      revoked_at: row.revoked_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
    },
  };
}

export async function listAgentJoinInvites(
  pool: pg.Pool,
  orgId: string,
): Promise<readonly AgentJoinInviteRecord[]> {
  const result = await pool.query<{
    readonly id: string;
    readonly org_id: string;
    readonly label: string;
    readonly max_uses: number;
    readonly use_count: number;
    readonly expires_at: Date | null;
    readonly revoked_at: Date | null;
    readonly created_at: Date;
  }>(
    `SELECT id, org_id, label, max_uses, use_count, expires_at, revoked_at, created_at
       FROM agent_join_invites
      WHERE org_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [orgId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    org_id: row.org_id,
    label: row.label,
    max_uses: row.max_uses,
    use_count: row.use_count,
    expires_at: row.expires_at?.toISOString() ?? null,
    revoked_at: row.revoked_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  }));
}

export async function revokeAgentJoinInvite(
  pool: pg.Pool,
  orgId: string,
  inviteId: string,
): Promise<AgentJoinInviteRecord> {
  const result = await pool.query<{
    readonly id: string;
    readonly org_id: string;
    readonly label: string;
    readonly max_uses: number;
    readonly use_count: number;
    readonly expires_at: Date | null;
    readonly revoked_at: Date | null;
    readonly created_at: Date;
  }>(
    `UPDATE agent_join_invites
        SET revoked_at = now()
      WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL
      RETURNING id, org_id, label, max_uses, use_count, expires_at, revoked_at, created_at`,
    [inviteId, orgId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new IdentityError('join_invite_not_found', 404, 'Join invite was not found or already revoked.');
  }
  return {
    id: row.id,
    org_id: row.org_id,
    label: row.label,
    max_uses: row.max_uses,
    use_count: row.use_count,
    expires_at: row.expires_at?.toISOString() ?? null,
    revoked_at: row.revoked_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}

export async function redeemAgentJoinInvite(
  pool: pg.Pool,
  input: { readonly token: string; readonly agent_name?: string | undefined },
): Promise<AgentJoinResult> {
  const token = input.token.trim();
  if (token.length < 16) {
    throw new IdentityError('join_invite_invalid', 401, 'Join invite token is invalid.');
  }

  const client = await pool.connect();
  let inviteId: string | null = null;
  try {
    await client.query('BEGIN');
    const invite = await client.query<{
      readonly id: string;
      readonly org_id: string;
      readonly created_by_member_id: string | null;
      readonly max_uses: number;
      readonly use_count: number;
      readonly expires_at: Date | null;
      readonly revoked_at: Date | null;
    }>(
      `SELECT id, org_id, created_by_member_id, max_uses, use_count, expires_at, revoked_at
         FROM agent_join_invites
        WHERE token_hash = $1
        FOR UPDATE`,
      [hashToken(token)],
    );
    const row = invite.rows[0];
    if (row === undefined) {
      throw new IdentityError('join_invite_invalid', 401, 'Join invite token is invalid.');
    }
    if (row.revoked_at !== null) {
      throw new IdentityError('join_invite_revoked', 410, 'Join invite was revoked.');
    }
    if (row.expires_at !== null && row.expires_at.getTime() <= Date.now()) {
      throw new IdentityError('join_invite_expired', 410, 'Join invite has expired.');
    }
    if (row.use_count >= row.max_uses) {
      throw new IdentityError('join_invite_exhausted', 410, 'Join invite has no remaining uses.');
    }

    await client.query(
      `UPDATE agent_join_invites SET use_count = use_count + 1 WHERE id = $1`,
      [row.id],
    );
    inviteId = row.id;
    await client.query('COMMIT');

    const name = input.agent_name?.trim() || `joined-agent-${Date.now().toString(36)}`;
    try {
      return await provisionJoinedAgent(
        pool,
        row.org_id,
        joinOperator(row.org_id, row.created_by_member_id),
        name,
        'invite',
      );
    } catch (provisionError) {
      await pool.query(
        `UPDATE agent_join_invites
            SET use_count = GREATEST(use_count - 1, 0)
          WHERE id = $1`,
        [row.id],
      );
      throw provisionError;
    }
  } catch (error) {
    if (inviteId === null) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export function readOpenJoinConfig(env: NodeJS.ProcessEnv = process.env): OpenJoinConfig {
  const enabled = env.AGENT_OPEN_JOIN_ENABLED === 'true' || env.AGENT_OPEN_JOIN_ENABLED === '1';
  const orgId = env.AGENT_OPEN_JOIN_ORG_ID?.trim() ?? '';
  return {
    enabled,
    orgId,
    maxPerFingerprintPerHour: Number(env.AGENT_OPEN_JOIN_MAX_PER_HOUR ?? '5') || 5,
    maxPerOrgPerDay: Number(env.AGENT_OPEN_JOIN_MAX_PER_DAY ?? '50') || 50,
  };
}

export async function openRegisterAgent(
  pool: pg.Pool,
  input: {
    readonly agent_name?: string | undefined;
    readonly client_fingerprint?: string | undefined;
  },
  config: OpenJoinConfig = readOpenJoinConfig(),
): Promise<AgentJoinResult> {
  if (!config.enabled || config.orgId.length === 0) {
    throw new IdentityError(
      'open_join_disabled',
      403,
      'Open agent join is disabled. Use an invite token or ask an operator for a credential.',
    );
  }

  const org = await pool.query(`SELECT id FROM orgs WHERE id = $1`, [config.orgId]);
  if (org.rowCount !== 1) {
    throw new IdentityError('open_join_org_missing', 500, 'Open-join org is not configured correctly.');
  }

  const fingerprint = (input.client_fingerprint ?? 'anonymous').slice(0, 128);
  const hourCount = await pool.query<{ readonly c: string }>(
    `SELECT count(*)::text AS c FROM agent_open_join_events
      WHERE client_fingerprint = $1 AND created_at > now() - interval '1 hour'`,
    [fingerprint],
  );
  if (Number(hourCount.rows[0]?.c ?? '0') >= config.maxPerFingerprintPerHour) {
    throw new IdentityError('open_join_rate_limited', 429, 'Open join rate limit exceeded for this client.');
  }

  const dayCount = await pool.query<{ readonly c: string }>(
    `SELECT count(*)::text AS c FROM agent_open_join_events
      WHERE org_id = $1 AND created_at > now() - interval '1 day'`,
    [config.orgId],
  );
  if (Number(dayCount.rows[0]?.c ?? '0') >= config.maxPerOrgPerDay) {
    throw new IdentityError('open_join_org_capped', 429, 'Open join daily org cap reached.');
  }

  const name = input.agent_name?.trim() || `open-agent-${Date.now().toString(36)}`;
  const joined = await provisionJoinedAgent(
    pool,
    config.orgId,
    joinOperator(config.orgId, null),
    name,
    'open',
  );

  await pool.query(
    `INSERT INTO agent_open_join_events (id, org_id, agent_id, client_fingerprint)
     VALUES ($1, $2, $3, $4)`,
    [prefixedId('ajoinev'), config.orgId, joined.agent_id, fingerprint],
  );

  return joined;
}

export async function publishAgentPublicEndpoint(
  pool: pg.Pool,
  auth: { readonly org_id: string; readonly agent_id: string; readonly connection_id: string },
  endpointUrl: string,
): Promise<{ readonly agent_id: string; readonly public_endpoint_url: string }> {
  const url = endpointUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IdentityError('publish_url_invalid', 400, 'public_endpoint_url must be a valid absolute URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new IdentityError('publish_url_invalid', 400, 'public_endpoint_url must be http(s).');
  }

  const existing = await pool.query<{ readonly metadata: unknown }>(
    `SELECT metadata FROM agents WHERE id = $1 AND org_id = $2`,
    [auth.agent_id, auth.org_id],
  );
  const row = existing.rows[0];
  if (row === undefined) throw new IdentityError('agent_not_found', 404, 'Agent was not found.');
  const metadata =
    row.metadata !== null && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? { ...(row.metadata as Record<string, unknown>) }
      : {};

  const operator = joinOperator(auth.org_id, auth.connection_id);
  await updateAgent(pool, operator, auth.org_id, auth.agent_id, {
    metadata: {
      ...metadata,
      public_endpoint_url: url,
      setup_mode: 'publish',
      published_via: 'runtime_mcp',
      published_at: new Date().toISOString(),
    },
  });

  return { agent_id: auth.agent_id, public_endpoint_url: url };
}
