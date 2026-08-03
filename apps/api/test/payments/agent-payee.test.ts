import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import { resolveAgentPayee } from '../../src/engines/payments/agent-payee.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

describe('resolveAgentPayee', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  async function setupTwoAgentFleet(suffix: string) {
    const orgId = `org_payee_${suffix}`;
    const teamId = `team_payee_${suffix}`;
    const payeeAgentId = `agt_payee_${suffix}`;
    const walletSetId = `ws_payee_${suffix}`;

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Agent Payee Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      payeeAgentId, orgId, teamId, 'Payee Agent',
    ]);
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'Payee wallet set', 'usr_1')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId: payeeAgentId, mode: 'test', chain: 'arc',
      circleWalletId: `w_payee_${suffix}`,
      address: `0xaaaa${suffix}0000000000000000000000000000000`.slice(0, 42),
      refId: `ref_payee_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
    });

    return { orgId, payeeAgentId, pool: store.pool };
  }

  it('resolves a fleet agent as a payment destination', async () => {
    const { orgId, payeeAgentId, pool } = await setupTwoAgentFleet('resolve');
    const payee = await resolveAgentPayee(pool, { orgId, agentId: payeeAgentId, mode: 'test', chain: 'arc' });
    expect(payee.address).toMatch(/^0x/);
  });

  it('auto-allowlists fleet agent addresses', async () => {
    // Intra-fleet payees come from OUR database, not from a 402 response,
    // so Phase 5's payTo guard should accept them without manual listing.
    const { orgId, payeeAgentId, pool } = await setupTwoAgentFleet('allowlist');
    const payee = await resolveAgentPayee(pool, { orgId, agentId: payeeAgentId, mode: 'test', chain: 'arc' });

    const listed = await pool.query<{ source: string; address: string; status: string }>(
      'SELECT source, address, status FROM payment_destination_allowlist WHERE org_id = $1', [orgId],
    );
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]).toEqual({ source: 'agent_wallet', address: payee.address.toLowerCase(), status: 'active' });
  });

  it('is idempotent -- resolving the same agent twice does not duplicate the allowlist row', async () => {
    const { orgId, payeeAgentId, pool } = await setupTwoAgentFleet('idempotent');
    await resolveAgentPayee(pool, { orgId, agentId: payeeAgentId, mode: 'test', chain: 'arc' });
    await resolveAgentPayee(pool, { orgId, agentId: payeeAgentId, mode: 'test', chain: 'arc' });

    const listed = await pool.query('SELECT 1 FROM payment_destination_allowlist WHERE org_id = $1', [orgId]);
    expect(listed.rowCount).toBe(1);
  });

  it('throws when the agent has no wallet on the requested chain', async () => {
    const orgId = 'org_payee_no_wallet';
    const teamId = 'team_payee_no_wallet';
    const agentId = 'agt_payee_no_wallet';
    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'No Wallet Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      agentId, orgId, teamId, 'No Wallet Agent',
    ]);

    await expect(
      resolveAgentPayee(store.pool, { orgId, agentId, mode: 'test', chain: 'arc' }),
    ).rejects.toThrow();
  });
});
