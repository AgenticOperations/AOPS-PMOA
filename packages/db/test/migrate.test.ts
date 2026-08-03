import pg from 'pg';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
    expect(firstRun).toContain('0015_functional_hardening_core');
    expect(firstRun).toContain('0016_rail_verify_provider_jobs');
    expect(firstRun).toContain('0017_policy_lifecycle_revisions');
    expect(firstRun).toContain('0018_circle_org_connections');
    expect(firstRun).toContain('0019_x402_action_execution_copy');
    expect(firstRun).toContain('0020_liquidity_job_idempotency');
    expect(firstRun).toContain('0021_runtime_payment_attempts');
    expect(firstRun).toContain('0022_fail_closed_policy_and_freeze');
    expect(firstRun).toContain('0023_arc_chain_support');
    expect(firstRun).toContain('0024_pin_eoa_account_type');
    expect(firstRun).toContain('0025_agent_chain_wallets');
    expect(firstRun).toContain('0026_agent_allocations');
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
      '0015_functional_hardening_core',
      '0016_rail_verify_provider_jobs',
      '0017_policy_lifecycle_revisions',
      '0018_circle_org_connections',
      '0019_x402_action_execution_copy',
      '0020_liquidity_job_idempotency',
      '0021_runtime_payment_attempts',
      '0022_fail_closed_policy_and_freeze',
      '0023_arc_chain_support',
      '0024_pin_eoa_account_type',
      '0025_agent_chain_wallets',
      '0026_agent_allocations',
    ]);

    const attemptConstraints = await pool.query<{ conname: string }>(
      `SELECT conname
         FROM pg_constraint
        WHERE conrelid = 'runtime_payment_attempts'::regclass`,
    );
    expect(attemptConstraints.rows.map(({ conname }) => conname)).toContain(
      'runtime_payment_attempts_result_retention_check',
    );
    const attemptIndexes = await pool.query<{ indexname: string }>(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'runtime_payment_attempts'`,
    );
    expect(attemptIndexes.rows.map(({ indexname }) => indexname)).toContain(
      'runtime_payment_attempts_result_expiry_idx',
    );

    const x402Action = await pool.query<{ description: string }>(
      `SELECT description FROM policy_action_registry WHERE action_id = 'payment.x402.authorize'`,
    );
    expect(x402Action.rows[0]?.description).toBe(
      'Control whether an agent may execute a supported x402 USDC payment through agentOps.',
    );

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

  it('serializes concurrent migration runners with a PostgreSQL advisory lock', async () => {
    const migrationsDir = await mkdtemp(path.join(tmpdir(), 'agentops-migrations-'));
    const migrationId = '9000_concurrent_migration_lock_probe';
    await writeFile(
      path.join(migrationsDir, `${migrationId}.sql`),
      `SELECT pg_sleep(0.1);
       CREATE TABLE concurrent_migration_lock_probe (id text PRIMARY KEY);`,
    );

    try {
      const results = await Promise.allSettled([
        runMigrations(pool, { migrationsDir }),
        runMigrations(pool, { migrationsDir }),
      ]);

      expect(results).toEqual(expect.arrayContaining([
        { status: 'fulfilled', value: [migrationId] },
        { status: 'fulfilled', value: [] },
      ]));
    } finally {
      await pool.query('DROP TABLE IF EXISTS concurrent_migration_lock_probe');
      await pool.query('DELETE FROM schema_migrations WHERE id = $1', [migrationId]);
      await rm(migrationsDir, { force: true, recursive: true });
    }
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

    const actions = await pool.query<{
      action_id: string;
      introduced_section: number;
      condition_groups: string[];
      binding_target_types: string[];
    }>(
      `SELECT action_id, introduced_section, condition_groups, binding_target_types
         FROM policy_action_registry
        WHERE action_id IN ('runtime.http.request', 'payment.x402.authorize', 'tool.call')
        ORDER BY action_id ASC`,
    );
    expect(actions.rows).toEqual([
      {
        action_id: 'payment.x402.authorize',
        binding_target_types: ['org', 'team', 'agent'],
        condition_groups: ['resource', 'payment'],
        introduced_section: 4,
      },
      {
        action_id: 'runtime.http.request',
        binding_target_types: ['org', 'team', 'agent'],
        condition_groups: ['resource'],
        introduced_section: 4,
      },
      {
        action_id: 'tool.call',
        binding_target_types: ['org', 'team', 'agent'],
        condition_groups: ['tool'],
        introduced_section: 4,
      },
    ]);

    const chainCapabilities = await pool.query<{
      chain: string;
      exact_settlement_verified: boolean;
      gateway_settlement_verified: boolean;
    }>(
      `SELECT chain, exact_settlement_verified, gateway_settlement_verified
         FROM circle_chain_capabilities
        WHERE mode = 'test'
          AND chain IN ('arbitrum', 'base')
        ORDER BY chain ASC`,
    );
    expect(chainCapabilities.rows).toEqual([
      {
        chain: 'arbitrum',
        exact_settlement_verified: true,
        gateway_settlement_verified: false,
      },
      {
        chain: 'base',
        exact_settlement_verified: true,
        gateway_settlement_verified: true,
      },
    ]);

    const arcCapability = await pool.query<{
      chain: string;
      circle_blockchain: string;
      gateway_domain: number;
      wallet_account_type: string;
    }>(
      `SELECT chain, circle_blockchain, gateway_domain, wallet_account_type
         FROM circle_chain_capabilities
        WHERE mode = 'test' AND chain = 'arc'`,
    );
    expect(arcCapability.rows).toEqual([
      {
        chain: 'arc',
        circle_blockchain: 'ARC-TESTNET',
        gateway_domain: 26,
        wallet_account_type: 'eoa',
      },
    ]);
    const liveArcCapability = await pool.query(
      "SELECT 1 FROM circle_chain_capabilities WHERE mode = 'live' AND chain = 'arc'",
    );
    // Constraint I.1: Arc mainnet does not exist -- no live-mode row.
    expect(liveArcCapability.rowCount).toBe(0);

    // K-16 (migration 0024): 0012 flipped these DEFAULTs to 'sca'. A new
    // row that omits account_type must default back to 'eoa', or Gateway
    // signing fails at payment time rather than wallet-creation time.
    await pool.query(
      "INSERT INTO orgs (id, display_name) VALUES ('org_eoa_default', 'EOA Default Org')",
    );
    await pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ('ws_eoa_default_test', 'org_eoa_default', 'test', 'circle_ws_eoa_default', 'Default wallet set', 'usr_migrate_test')`,
    );
    const walletSetDefault = await pool.query<{ account_type: string }>(
      "SELECT account_type FROM circle_wallet_sets WHERE id = 'ws_eoa_default_test'",
    );
    expect(walletSetDefault.rows[0]?.account_type).toBe('eoa');

    await pool.query(
      `INSERT INTO circle_chain_wallets (
         id, org_id, wallet_set_id, mode, chain, circle_blockchain, circle_wallet_id, address
       ) VALUES (
         'cwallet_eoa_default_test', 'org_eoa_default', 'ws_eoa_default_test', 'test', 'arc', 'ARC-TESTNET',
         'circle_wallet_eoa_default', '0x1111111111111111111111111111111111111111'
       )`,
    );
    const chainWalletDefault = await pool.query<{ account_type: string }>(
      "SELECT account_type FROM circle_chain_wallets WHERE id = 'cwallet_eoa_default_test'",
    );
    expect(chainWalletDefault.rows[0]?.account_type).toBe('eoa');

    // 0024 resets only the DEFAULT, not the CHECK -- 'sca' rows (the Agent
    // Wallet fallback path, per A3) must still be insertable explicitly.
    // This DB was bootstrapped fresh for this test, so there is no
    // pre-existing 0012-backfilled data to assert against directly; this
    // proves the constraint itself wasn't accidentally re-tightened.
    await pool.query(
      `INSERT INTO circle_chain_wallets (
         id, org_id, wallet_set_id, mode, chain, circle_blockchain, circle_wallet_id, address, account_type
       ) VALUES (
         'cwallet_sca_survivor_test', 'org_eoa_default', 'ws_eoa_default_test', 'test', 'base', 'BASE-SEPOLIA',
         'circle_wallet_sca_survivor', '0x2222222222222222222222222222222222222222', 'sca'
       )`,
    );
    const scaRow = await pool.query<{ account_type: string }>(
      "SELECT account_type FROM circle_chain_wallets WHERE id = 'cwallet_sca_survivor_test'",
    );
    expect(scaRow.rows[0]?.account_type).toBe('sca');

    // Migration 0025: agent_chain_wallets table and the widened
    // circle_provider_jobs job_type CHECK. The CHECK has been widened five
    // times before this migration (0011, 0013, 0014, 0015, 0016) -- assert
    // every pre-existing value plus the three new agent_wallet.* ones are
    // all still admitted in one query, so a future migration that narrows
    // this list again is caught here.
    await pool.query(
      `INSERT INTO teams (id, org_id, name) VALUES ('team_eoa_default', 'org_eoa_default', 'Default Team')`,
    );
    await pool.query(
      `INSERT INTO agents (id, org_id, team_id, name)
       VALUES ('agt_eoa_default', 'org_eoa_default', 'team_eoa_default', 'EOA Default Agent')`,
    );
    // Reuses ws_eoa_default_test (created above) -- circle_wallet_sets is
    // UNIQUE (org_id, mode), so org_eoa_default can only have one test-mode
    // wallet set.
    await pool.query(
      `INSERT INTO agent_chain_wallets (
         id, org_id, agent_id, wallet_set_id, mode, chain, circle_blockchain, circle_wallet_id, address, ref_id
       ) VALUES (
         'acw_migrate_test', 'org_eoa_default', 'agt_eoa_default', 'ws_eoa_default_test', 'test', 'arc', 'ARC-TESTNET',
         'circle_wallet_agent_test', '0x3333333333333333333333333333333333333333', 'ref_migrate_test'
       )`,
    );
    const agentWalletRow = await pool.query<{ account_type: string; status: string }>(
      "SELECT account_type, status FROM agent_chain_wallets WHERE id = 'acw_migrate_test'",
    );
    expect(agentWalletRow.rows[0]).toEqual({ account_type: 'eoa', status: 'provisioning' });

    await expect(pool.query(
      `INSERT INTO agent_chain_wallets (
         id, org_id, agent_id, wallet_set_id, mode, chain, circle_blockchain, circle_wallet_id, address, account_type, ref_id
       ) VALUES (
         'acw_sca_rejected_test', 'org_eoa_default', 'agt_eoa_default', 'ws_eoa_default_test', 'test', 'base', 'BASE-SEPOLIA',
         'circle_wallet_sca_rejected', '0x4444444444444444444444444444444444444444', 'sca', 'ref_sca_rejected'
       )`,
    )).rejects.toThrow();

    for (const jobType of [
      'wallet_set.create', 'wallet.create', 'wallet.faucet', 'wallet.rebalance',
      'liquidity.prepare', 'rail.verify', 'gateway.deposit', 'gateway.transfer',
      'wallet.balance_sync', 'webhook.reconcile',
      'agent_wallet.create', 'agent_wallet.topup', 'agent_wallet.sweep',
    ]) {
      await pool.query(
        `INSERT INTO circle_provider_jobs (id, org_id, mode, job_type, status, created_by)
         VALUES ($1, 'org_eoa_default', 'test', $2, 'queued', 'usr_migrate_test')`,
        [`cjob_${jobType.replace(/\./g, '_')}`, jobType],
      );
    }
    const jobCount = await pool.query<{ count: string }>(
      "SELECT count(*) FROM circle_provider_jobs WHERE org_id = 'org_eoa_default'",
    );
    expect(Number(jobCount.rows[0]?.count)).toBe(13);

    // Migration 0026: agent_allocations. The two invariant CHECKs
    // (ceiling >= allocated, allocated >= low_water_mark) are the last line
    // of defense if application code ever writes a row directly -- assert
    // both reject a violating row.
    await pool.query(
      `INSERT INTO agent_allocations (
         id, org_id, agent_id, mode, chain, allocated_usdc, gas_reserve_usdc,
         low_water_mark_usdc, ceiling_usdc, created_by
       ) VALUES (
         'aalloc_migrate_test', 'org_eoa_default', 'agt_eoa_default', 'test', 'arc',
         5.00, 0.50, 1.00, 10.00, 'usr_migrate_test'
       )`,
    );
    const allocationRow = await pool.query<{ status: string }>(
      "SELECT status FROM agent_allocations WHERE id = 'aalloc_migrate_test'",
    );
    expect(allocationRow.rows[0]?.status).toBe('active');

    await expect(pool.query(
      `INSERT INTO agent_allocations (
         id, org_id, agent_id, mode, chain, allocated_usdc, ceiling_usdc, created_by
       ) VALUES (
         'aalloc_ceiling_violation_test', 'org_eoa_default', 'agt_eoa_default', 'test', 'base',
         20.00, 10.00, 'usr_migrate_test'
       )`,
    )).rejects.toThrow();

    await expect(pool.query(
      `INSERT INTO agent_allocations (
         id, org_id, agent_id, mode, chain, allocated_usdc, low_water_mark_usdc, ceiling_usdc, created_by
       ) VALUES (
         'aalloc_low_water_violation_test', 'org_eoa_default', 'agt_eoa_default', 'test', 'polygon',
         1.00, 5.00, 10.00, 'usr_migrate_test'
       )`,
    )).rejects.toThrow();

    // UNIQUE (agent_id, mode, chain) -- a second allocation for the same
    // agent/mode/chain must be rejected, not silently create a duplicate row.
    await expect(pool.query(
      `INSERT INTO agent_allocations (
         id, org_id, agent_id, mode, chain, allocated_usdc, ceiling_usdc, created_by
       ) VALUES (
         'aalloc_duplicate_test', 'org_eoa_default', 'agt_eoa_default', 'test', 'arc',
         1.00, 10.00, 'usr_migrate_test'
       )`,
    )).rejects.toThrow();
  });
});
