import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { correctPosting, deriveSpentUsdc, writePosting } from '../../src/engines/payments/ledger.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

describe('append-only ledger', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  async function seedOrgAndAgent(suffix: string) {
    const orgId = `org_ledger_${suffix}`;
    const teamId = `team_ledger_${suffix}`;
    const agentId = `agt_ledger_${suffix}`;
    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Ledger Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      agentId, orgId, teamId, 'Ledger Agent',
    ]);
    return { orgId, agentId };
  }

  async function seedReservation(orgId: string, agentId: string, suffix: string) {
    const sourceId = `paysrc_ledger_${suffix}`;
    const reservationId = `payres_ledger_${suffix}`;
    await store.pool.query(
      `INSERT INTO payment_sources (id, org_id, source_type, provider, rail, chain, label, created_by)
       VALUES ($1, $2, 'dedicated_wallet', 'circle_wallets', 'exact_arc', 'arc', 'Ledger source', 'usr_1')`,
      [sourceId, orgId],
    );
    await store.pool.query(
      `INSERT INTO payment_reservations (id, org_id, agent_id, source_id, amount_usdc, rail, status, reason_code, quote_hash, quote, expires_at)
       VALUES ($1, $2, $3, $4, '5.00', 'exact_arc', 'reserved', 'ledger_test', 'hash', '{}'::jsonb, now() + interval '1 hour')`,
      [reservationId, orgId, agentId, sourceId],
    );
    return reservationId;
  }

  it('derives the same balance a manually-summed settle history reports', async () => {
    const { orgId, agentId } = await seedOrgAndAgent('parity');
    const first = await seedReservation(orgId, agentId, 'parity1');
    const second = await seedReservation(orgId, agentId, 'parity2');

    await writePosting(store.pool, {
      orgId, agentId, mode: 'test', entryType: 'reserve', amountUsdc: '-3.00',
      reservationId: first, reasonCode: 'test_reserve', createdBy: 'usr_1',
    });
    await writePosting(store.pool, {
      orgId, agentId, mode: 'test', entryType: 'settle', amountUsdc: '3.00',
      reservationId: first, reasonCode: 'test_settle', createdBy: 'usr_1',
    });
    await writePosting(store.pool, {
      orgId, agentId, mode: 'test', entryType: 'reserve', amountUsdc: '-1.50',
      reservationId: second, reasonCode: 'test_reserve', createdBy: 'usr_1',
    });
    await writePosting(store.pool, {
      orgId, agentId, mode: 'test', entryType: 'settle', amountUsdc: '1.50',
      reservationId: second, reasonCode: 'test_settle', createdBy: 'usr_1',
    });

    const derived = await deriveSpentUsdc(store.pool, { orgId, agentId, mode: 'test' });
    expect(derived).toBe('4.500000');
  });

  it('rejects UPDATE on a posting', async () => {
    const { orgId, agentId } = await seedOrgAndAgent('noupdate');
    const reservationId = await seedReservation(orgId, agentId, 'noupdate');
    const posting = await writePosting(store.pool, {
      orgId, agentId, mode: 'test', entryType: 'reserve', amountUsdc: '-5.00',
      reservationId, reasonCode: 'test_reserve', createdBy: 'usr_1',
    });

    await expect(store.pool.query(
      'UPDATE ledger_postings SET amount_usdc = 999 WHERE id = $1', [posting.id],
    )).rejects.toThrow(/append-only/);
  });

  it('rejects DELETE on a posting', async () => {
    const { orgId, agentId } = await seedOrgAndAgent('nodelete');
    const reservationId = await seedReservation(orgId, agentId, 'nodelete');
    const posting = await writePosting(store.pool, {
      orgId, agentId, mode: 'test', entryType: 'reserve', amountUsdc: '-5.00',
      reservationId, reasonCode: 'test_reserve', createdBy: 'usr_1',
    });

    await expect(store.pool.query('DELETE FROM ledger_postings WHERE id = $1', [posting.id]))
      .rejects.toThrow(/append-only/);
  });

  it('refuses a posting with none of reservation_id, attempt_id, job_id, or corrects_posting_id', async () => {
    const { orgId, agentId } = await seedOrgAndAgent('nocause');
    await expect(writePosting(store.pool, {
      orgId, agentId, mode: 'test', entryType: 'topup', amountUsdc: '10.00', reasonCode: 'test_no_cause', createdBy: 'usr_1',
    })).rejects.toThrow();
  });

  it('corrects by appending an offsetting row, never editing the original', async () => {
    const { orgId, agentId } = await seedOrgAndAgent('correct');
    const reservationId = await seedReservation(orgId, agentId, 'correct');
    const posting = await writePosting(store.pool, {
      orgId, agentId, mode: 'test', entryType: 'settle', amountUsdc: '5.00',
      reservationId, reasonCode: 'test_settle', createdBy: 'usr_1',
    });

    const correction = await correctPosting(store.pool, { postingId: posting.id, reasonCode: 'operator_adjustment', createdBy: 'usr_1' });

    expect(correction.amount_usdc).toBe('-5.000000');
    expect(correction.corrects_posting_id).toBe(posting.id);
    expect(correction.entry_type).toBe('correction');

    // The original is untouched -- only a new row was appended.
    const original = await store.pool.query<{ amount_usdc: string }>(
      'SELECT amount_usdc FROM ledger_postings WHERE id = $1', [posting.id],
    );
    expect(original.rows[0]?.amount_usdc).toBe('5.000000');
  });

  it('a correction moves the derived balance, proving it is not just a record', async () => {
    const { orgId, agentId } = await seedOrgAndAgent('correctderive');
    const reservationId = await seedReservation(orgId, agentId, 'correctderive');
    const posting = await writePosting(store.pool, {
      orgId, agentId, mode: 'test', entryType: 'settle', amountUsdc: '5.00',
      reservationId, reasonCode: 'test_settle', createdBy: 'usr_1',
    });
    expect(await deriveSpentUsdc(store.pool, { orgId, agentId, mode: 'test' })).toBe('5.000000');

    await correctPosting(store.pool, { postingId: posting.id, reasonCode: 'operator_adjustment', createdBy: 'usr_1' });

    expect(await deriveSpentUsdc(store.pool, { orgId, agentId, mode: 'test' })).toBe('0.000000');
  });
});
