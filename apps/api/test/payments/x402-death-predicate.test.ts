import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deriveSpentUsdc } from '../../src/engines/payments/ledger.js';
import {
  isProvablyDead,
  releaseOnProof,
  type DeathPredicateChainReader,
} from '../../src/engines/payments/x402-attempt-store.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

const NOW_SECONDS = Math.floor(Date.now() / 1000);

function fakeChainReader(
  result: { readonly validBeforeUnixSeconds: number; readonly authorizationUsed: boolean },
): DeathPredicateChainReader {
  return () => Promise.resolve(result);
}

describe('proof-based reservation release', () => {
  describe('isProvablyDead (pure predicate)', () => {
    it('is dead once past validBefore AND never used', () => {
      expect(isProvablyDead({
        validBeforeUnixSeconds: NOW_SECONDS - 60, authorizationUsed: false, nowUnixSeconds: NOW_SECONDS,
      })).toBe(true);
    });

    it('is NOT dead while still within the valid window', () => {
      expect(isProvablyDead({
        validBeforeUnixSeconds: NOW_SECONDS + 3600, authorizationUsed: false, nowUnixSeconds: NOW_SECONDS,
      })).toBe(false);
    });

    it('is NOT dead when already used, even past validBefore', () => {
      // Past validBefore but USED means it settled -- treating it as dead
      // would double-count money the payee already received.
      expect(isProvablyDead({
        validBeforeUnixSeconds: NOW_SECONDS - 60, authorizationUsed: true, nowUnixSeconds: NOW_SECONDS,
      })).toBe(false);
    });
  });

  describe('releaseOnProof', () => {
    let store: PostgresTestStore;

    beforeAll(async () => {
      store = await startPostgres();
    }, 90_000);

    afterAll(async () => {
      if (store !== undefined) await store.stop();
    });

    async function seedReservedPayment(suffix: string) {
      const orgId = `org_deathpred_${suffix}`;
      const teamId = `team_deathpred_${suffix}`;
      const agentId = `agt_deathpred_${suffix}`;
      const sourceId = `paysrc_deathpred_${suffix}`;
      const reservationId = `payres_deathpred_${suffix}`;

      await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Death Predicate Org')", [orgId]);
      await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
      await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
        agentId, orgId, teamId, 'Death Predicate Agent',
      ]);
      await store.pool.query(
        `INSERT INTO agent_payment_accounts (id, org_id, agent_id, status, payment_access, budget_usdc, reserved_usdc, created_by)
         VALUES ($1, $2, $3, 'active', true, '10.00', '4.00', 'usr_1')`,
        [`apacct_deathpred_${suffix}`, orgId, agentId],
      );
      await store.pool.query(
        `INSERT INTO payment_sources (id, org_id, source_type, provider, rail, chain, label, created_by)
         VALUES ($1, $2, 'dedicated_wallet', 'circle_wallets', 'exact_arc', 'arc', 'Death predicate source', 'usr_1')`,
        [sourceId, orgId],
      );
      await store.pool.query(
        `INSERT INTO payment_reservations (id, org_id, agent_id, source_id, amount_usdc, rail, status, reason_code, quote_hash, quote, expires_at)
         VALUES ($1, $2, $3, $4, '4.00', 'exact_arc', 'reserved', 'death_predicate_test', 'hash', '{}'::jsonb, now() + interval '1 hour')`,
        [reservationId, orgId, agentId, sourceId],
      );

      return { orgId, agentId, reservationId };
    }

    it('releases when the authorization is provably dead', async () => {
      const { orgId, agentId, reservationId } = await seedReservedPayment('dead');

      await releaseOnProof(
        store.pool,
        { reservationId },
        fakeChainReader({ validBeforeUnixSeconds: NOW_SECONDS - 60, authorizationUsed: false }),
      );

      const row = await store.pool.query<{ status: string }>(
        'SELECT status FROM payment_reservations WHERE id = $1', [reservationId],
      );
      expect(row.rows[0]?.status).toBe('released');

      const account = await store.pool.query<{ reserved_usdc: string }>(
        'SELECT reserved_usdc FROM agent_payment_accounts WHERE org_id = $1 AND agent_id = $2', [orgId, agentId],
      );
      expect(account.rows[0]?.reserved_usdc).toBe('0.000000');

      // A release posting exists (mirrors the counter), but nothing was
      // ever settled -- derived spent stays zero.
      expect(await deriveSpentUsdc(store.pool, { orgId, agentId, mode: 'test' })).toBe('0.000000');
    });

    it('does NOT release while the authorization could still be used', async () => {
      const { reservationId } = await seedReservedPayment('stillvalid');

      await expect(releaseOnProof(
        store.pool,
        { reservationId },
        fakeChainReader({ validBeforeUnixSeconds: NOW_SECONDS + 3600, authorizationUsed: false }),
      )).rejects.toThrow(/not_provably_dead/);

      const row = await store.pool.query<{ status: string }>(
        'SELECT status FROM payment_reservations WHERE id = $1', [reservationId],
      );
      expect(row.rows[0]?.status).toBe('reserved');
    });

    it('does NOT release when the authorization was already used', async () => {
      const { reservationId } = await seedReservedPayment('used');

      await expect(releaseOnProof(
        store.pool,
        { reservationId },
        fakeChainReader({ validBeforeUnixSeconds: NOW_SECONDS - 60, authorizationUsed: true }),
      )).rejects.toThrow(/not_provably_dead/);

      const row = await store.pool.query<{ status: string }>(
        'SELECT status FROM payment_reservations WHERE id = $1', [reservationId],
      );
      expect(row.rows[0]?.status).toBe('reserved');
    });

    it('refuses a reservation that is not in reserved status', async () => {
      const { reservationId } = await seedReservedPayment('notreserved');
      await store.pool.query("UPDATE payment_reservations SET status = 'settled' WHERE id = $1", [reservationId]);

      await expect(releaseOnProof(
        store.pool,
        { reservationId },
        fakeChainReader({ validBeforeUnixSeconds: NOW_SECONDS - 60, authorizationUsed: false }),
      )).rejects.toMatchObject({ code: 'reservation_not_reserved' });
    });

    it('throws for a reservation that does not exist', async () => {
      await expect(releaseOnProof(
        store.pool,
        { reservationId: 'payres_does_not_exist' },
        fakeChainReader({ validBeforeUnixSeconds: NOW_SECONDS - 60, authorizationUsed: false }),
      )).rejects.toMatchObject({ code: 'reservation_not_found' });
    });
  });
});
