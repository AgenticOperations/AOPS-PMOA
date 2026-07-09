import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { runMigrations } from '../src/migrate.js';

const POSTGRES_PORT = 5432;
const POSTGRES_USER = 'agentops';
const POSTGRES_PASSWORD = 'agentops';
const POSTGRES_DB = 'agentops_pmoa_test';

describe('PMOA database migrations', () => {
  let container: StartedTestContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER,
        POSTGRES_PASSWORD,
        POSTGRES_DB,
      })
      .withExposedPorts(POSTGRES_PORT)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(60_000)
      .start();

    pool = new pg.Pool({
      connectionString: `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${container.getHost()}:${container.getMappedPort(
        POSTGRES_PORT,
      )}/${POSTGRES_DB}`,
    });
  }, 90_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('applies PMOA migrations once and records them', async () => {
    const firstRun = await runMigrations(pool);
    const secondRun = await runMigrations(pool);

    expect(firstRun).toContain('0001_section_11a_audit');
    expect(firstRun).toContain('0002_section_1_core_spine');
    expect(firstRun).toContain('0003_section_1_agent_credential_kind');
    expect(firstRun).toContain('0004_section_1_auth_onboarding');
    expect(firstRun).toContain('0005_audit_event_classification');
    expect(firstRun).toContain('0006_policy_decision_core');
    expect(firstRun).toContain('0007_runtime_approval_integration_core');
    expect(firstRun).toContain('0008_section_5_operational_controls');
    expect(firstRun).toContain('0009_section_6_8_payment_control');
    expect(firstRun).toContain('0010_section_9_circle_treasury');
    expect(firstRun).toContain('0011_section_9_testnet_faucet');
    expect(firstRun).toContain('0012_section_9_circle_agent_wallet_sca');
    expect(firstRun).toContain('0013_section_9_rebalance_jobs');
    expect(firstRun).toContain('0014_section_9_liquidity_manager');
    expect(secondRun).toEqual([]);

    const applied = await pool.query<{ id: string }>(
      'SELECT id FROM schema_migrations ORDER BY id ASC',
    );

    expect(applied.rows.map((row) => row.id)).toEqual([
      '0001_section_11a_audit',
      '0002_section_1_core_spine',
      '0003_section_1_agent_credential_kind',
      '0004_section_1_auth_onboarding',
      '0005_audit_event_classification',
      '0006_policy_decision_core',
      '0007_runtime_approval_integration_core',
      '0008_section_5_operational_controls',
      '0009_section_6_8_payment_control',
      '0010_section_9_circle_treasury',
      '0011_section_9_testnet_faucet',
      '0012_section_9_circle_agent_wallet_sca',
      '0013_section_9_rebalance_jobs',
      '0014_section_9_liquidity_manager',
    ]);

    const sectionOneTable = await pool.query<{ exists: string }>(
      "SELECT to_regclass('public.connections')::text AS exists",
    );
    expect(sectionOneTable.rows[0]?.exists).toBe('connections');

    await pool.query("INSERT INTO orgs (id, display_name) VALUES ('org_seed', 'Seed Org')");
    await pool.query(
      "INSERT INTO teams (id, org_id, name, is_default) VALUES ('team_seed', 'org_seed', 'Default', true)",
    );
    await pool.query(
      "UPDATE orgs SET default_team_id = 'team_seed' WHERE id = 'org_seed'",
    );
    await pool.query(
      "INSERT INTO agents (id, org_id, team_id, name) VALUES ('agt_seed', 'org_seed', 'team_seed', 'Seed Agent')",
    );
    await pool.query(
      `INSERT INTO connections (id, org_id, agent_id, kind, name)
       VALUES ('conn_test', 'org_seed', 'agt_seed', 'agent_credential', 'Default credential')`,
    );

    const policyTable = await pool.query<{ exists: string }>(
      "SELECT to_regclass('public.policy_versions')::text AS exists",
    );
    expect(policyTable.rows[0]?.exists).toBe('policy_versions');
  });

  it('creates tenant anchor and canonical audit tables with restrict retention', async () => {
    await runMigrations(pool);

    await pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_test', 'Test Org')",
    );
    await pool.query(
      `INSERT INTO audit_event_heads (org_id, last_sequence, last_event_hash)
       VALUES ('org_test', 1, repeat('a', 64))`,
    );
    await pool.query(
      `INSERT INTO audit_events (
         id,
         org_id,
         sequence,
         event_type,
         actor_type,
         action,
         outcome,
         canonical_body,
         canonical_body_hash,
         event_hash,
         redaction_state,
         payload
       )
       VALUES (
         'aud_test',
         'org_test',
         1,
         'org.created',
         'system',
         'org.create',
         'success',
         '{"action":"org.create"}'::jsonb,
         repeat('b', 64),
         repeat('c', 64),
         'redacted',
         '{"safe":true}'::jsonb
       )`,
    );

    await expect(pool.query("DELETE FROM orgs WHERE id = 'org_test'")).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('classifies audit events and links them to related product resources', async () => {
    await runMigrations(pool);

    await pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_audit_classified', 'Audit Classified Org')",
    );
    await pool.query(
      `INSERT INTO audit_event_heads (org_id, last_sequence, last_event_hash)
       VALUES ('org_audit_classified', 1, repeat('d', 64))`,
    );
    await pool.query(
      `INSERT INTO audit_events (
         id,
         org_id,
         sequence,
         event_type,
         actor_type,
         action,
         outcome,
         event_domain,
         event_category,
         severity,
         tags,
         related_agent_id,
         related_connection_id,
         canonical_body,
         canonical_body_hash,
         event_hash,
         redaction_state,
         payload
       )
       VALUES (
         'aud_classified',
         'org_audit_classified',
         1,
         'connection.rotated',
         'user',
         'connection.rotated',
         'success',
         'credential',
         'configuration',
         'info',
         ARRAY['section_1', 'credential', 'agent'],
         'agt_classified',
         'conn_classified',
         '{"action":"connection.rotated"}'::jsonb,
         repeat('e', 64),
         repeat('f', 64),
         'none',
         '{"safe":true}'::jsonb
       )`,
    );

    const event = await pool.query<{
      event_domain: string;
      event_category: string;
      severity: string;
      tags: string[];
      related_agent_id: string | null;
      related_connection_id: string | null;
    }>(
      `SELECT event_domain, event_category, severity, tags, related_agent_id, related_connection_id
         FROM audit_events
        WHERE id = 'aud_classified'`,
    );

    expect(event.rows[0]).toEqual({
      event_domain: 'credential',
      event_category: 'configuration',
      severity: 'info',
      tags: ['section_1', 'credential', 'agent'],
      related_agent_id: 'agt_classified',
      related_connection_id: 'conn_classified',
    });
  });

  it('creates Section 2 policy decision tables and seeds enforceable Section 1 actions', async () => {
    await runMigrations(pool);

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'policy_drafts',
            'policy_versions',
            'policy_bindings',
            'policy_decisions',
            'policy_simulations',
            'policy_action_registry'
          )
        ORDER BY table_name ASC`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'policy_action_registry',
      'policy_bindings',
      'policy_decisions',
      'policy_drafts',
      'policy_simulations',
      'policy_versions',
    ]);

    const actions = await pool.query<{ action_id: string; enforceability: string }>(
      `SELECT action_id, enforceability
         FROM policy_action_registry
        WHERE introduced_section = 2
        ORDER BY action_id ASC`,
    );
    expect(actions.rows).toEqual([
      { action_id: 'management.agent.activate', enforceability: 'enforceable' },
      { action_id: 'management.agent.create', enforceability: 'enforceable' },
      { action_id: 'management.agent.deactivate', enforceability: 'enforceable' },
      { action_id: 'management.agent.pause', enforceability: 'enforceable' },
      { action_id: 'management.connection.issue', enforceability: 'enforceable' },
      { action_id: 'management.connection.revoke', enforceability: 'enforceable' },
      { action_id: 'management.connection.rotate', enforceability: 'enforceable' },
      { action_id: 'management.policy.activate', enforceability: 'enforceable' },
      { action_id: 'management.policy.archive', enforceability: 'enforceable' },
      { action_id: 'management.policy.bind', enforceability: 'enforceable' },
      { action_id: 'management.policy.create', enforceability: 'enforceable' },
    ]);
  });

  it('creates Section 3/4 approval, activity, runtime, and MCP foundations', async () => {
    await runMigrations(pool);

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'approval_requests',
            'approval_actions',
            'approval_consumptions',
            'activity_items',
            'mcp_sessions',
            'connection_rate_limits'
          )
        ORDER BY table_name ASC`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'activity_items',
      'approval_actions',
      'approval_consumptions',
      'approval_requests',
      'connection_rate_limits',
      'mcp_sessions',
    ]);

    const actions = await pool.query<{ action_id: string; introduced_section: number }>(
      `SELECT action_id, introduced_section
         FROM policy_action_registry
        WHERE action_id IN ('runtime.http.request', 'payment.x402.authorize', 'tool.call')
        ORDER BY action_id ASC`,
    );
    expect(actions.rows).toEqual([
      { action_id: 'payment.x402.authorize', introduced_section: 4 },
      { action_id: 'runtime.http.request', introduced_section: 4 },
      { action_id: 'tool.call', introduced_section: 4 },
    ]);
  });
});
