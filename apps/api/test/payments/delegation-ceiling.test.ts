import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { outstandingHeadroomMicros } from '../../src/engines/payments/delegation-ceiling.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

const TREASURY = '0x7ea50000000000000000000000000000000000a1';
const USDC = '0x3600000000000000000000000000000000000000';

/**
 * Seeds one payer with two live delegations and one revoked, so the sum can
 * be checked against a number that is wrong in an obvious way if revoked or
 * expired rows leak in.
 */
async function seedTwoActiveAndOneRevoked(pool: pg.Pool): Promise<{ readonly orgId: string }> {
  const orgId = 'org_ceiling_sum';
  await pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Ceiling Org')", [orgId]);

  const insert = async (
    id: string,
    ceiling: string,
    drawn: string,
    status: string,
    nonce: number,
    expiresAt: Date,
  ): Promise<void> => {
    await pool.query(
      `INSERT INTO agent_delegations (
         id, org_id, payer_agent_id, payer_address, payee_agent_id, payee_address,
         mode, chain, token_address, ceiling_usdc, drawn_usdc, expires_at,
         permit_nonce, signature, status, approved_by, payer_kind
       ) VALUES ($1, $2, NULL, $3, NULL, $4, 'test', 'arc', $5, $6::numeric, $7::numeric,
                 $8, $9, '0xsig', $10, 'usr_1', 'treasury')`,
      [id, orgId, TREASURY, `0xpayee${id.slice(-2)}`, USDC, ceiling, drawn, expiresAt, nonce, status],
    );
  };

  const future = new Date(Date.now() + 3_600_000);
  await insert('dele_sum_a1', '10.00', '4.00', 'active', 0, future);
  await insert('dele_sum_b2', '5.00', '0.00', 'active', 1, future);
  // Revoked headroom is not headroom: the allowance is dead on-chain.
  await insert('dele_sum_c3', '100.00', '0.00', 'revoked', 2, future);
  // Expired likewise, and nothing sweeps 'active' rows to 'expired' on a
  // timer -- so this row is still status='active' and MUST be excluded by
  // expires_at, which is exactly the case status alone would get wrong.
  await insert('dele_sum_d4', '50.00', '0.00', 'active', 3, new Date(Date.now() - 1000));

  return { orgId };
}

describe('outstandingHeadroomMicros', () => {
  let store: PostgresTestStore;
  beforeAll(async () => { store = await startPostgres(); }, 90_000);
  afterAll(async () => { if (store !== undefined) await store.stop(); });

  it('sums remaining headroom across every active delegation for one payer', async () => {
    const { orgId } = await seedTwoActiveAndOneRevoked(store.pool);
    const total = await outstandingHeadroomMicros(store.pool, {
      orgId, payerAddress: TREASURY, mode: 'test', chain: 'arc', tokenAddress: USDC,
    });
    expect(total).toBe(11_000_000n);
  });
});
